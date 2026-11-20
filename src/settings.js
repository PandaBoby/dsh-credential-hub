import { chmodSync, existsSync, lstatSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { stringify } from 'yaml'
import { decryptBundle, encryptBundle, validatePassphrase } from './bundle.js'
import { CredentialHubError } from './errors.js'
import { normalizeInventory } from './inventory.js'

/**
 * Header for a UI-written inventory. The file is rewritten from the normalized
 * metadata whenever a record changes, so a hand-written comment next to a
 * record is not preserved; the security warning and schema example are.
 */
const INVENTORY_HEADER = `# dsh-credential-hub inventory
#
# SECURITY: this file stores credential *references*, never values.
# Put private keys and PATs in the DSH credential store, then write the
# credentialRef here. A privateKey/token/password field is rejected on load.
#
# credentialRef grammar (from @deepseek-ai/dsh-credentials):
#   ^[A-Za-z_][A-Za-z0-9_]*$
#
`

const SSH_FIELDS = ['alias', 'tags', 'description', 'credentialRef', 'host', 'port', 'username']
const PAT_FIELDS = [
  'alias', 'tags', 'description', 'credentialRef',
  'platform', 'baseUrl', 'authScheme', 'headerName', 'username',
]
const EDITABLE_CONFIG_FIELDS = new Set([
  'promptSection',
  'maxPromptEntriesPerKind',
  'sshTimeoutMs',
  'httpTimeoutMs',
  'allowLoopbackHttp',
  'allowCrossOriginPat',
  'followRedirects',
  'sshStrictHostKeyChecking',
])
const STRICT_HOST_KEY_VALUES = ['yes', 'accept-new', 'no']
/** A generous cap for a PEM key or a long-lived token; the store remains the owner. */
const MAX_SECRET_BYTES = 256 * 1024
const MAX_IMPORT_RECORDS = 1000
const MAX_IMPORT_CREDENTIALS = 2000

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function text(value, fallback = '') {
  return typeof value === 'string' ? value.trim() : fallback
}

/**
 * Normalize the shape of a multi-line secret — an SSH private key — before it
 * reaches the credential store. The store renders a value as a `|` block
 * scalar only when every line is LF-terminated and none keeps trailing
 * whitespace; otherwise YAML falls back to a folded scalar (which a reader
 * gets back with the line breaks turned into spaces) or to a double-quoted
 * one. A single-line token is returned untouched, so no trailing newline can
 * leak into an HTTP header.
 * @param {string} value
 * @returns {string}
 */
function normalizeSecretValue(value) {
  if (!value.includes('\n') && !value.includes('\r')) return value
  const lines = value.replace(/\r\n?/g, '\n').split('\n').map((line) => line.replace(/[ \t]+$/, ''))
  while (lines.length > 0 && lines.at(-1) === '') lines.pop()
  return `${lines.join('\n')}\n`
}

/**
 * Accept a UI comma-separated tag string as well as a JSON array; the Host is
 * the authority, so it normalizes both instead of trusting the browser.
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeTagsInput(value) {
  if (Array.isArray(value)) return value.map((tag) => String(tag).trim()).filter((tag) => tag !== '')
  if (typeof value === 'string') {
    return value.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '')
  }
  return []
}

/**
 * @param {'ssh'|'pat'} kind
 * @param {unknown} input
 * @returns {Record<string, unknown>}
 */
function normalizeRecordInput(kind, input) {
  if (!isObject(input)) throw new CredentialHubError('RECORD_INVALID', 'record must be an object')
  const allowed = kind === 'ssh' ? SSH_FIELDS : PAT_FIELDS
  const allowedSet = new Set(allowed)
  for (const field of Object.keys(input)) {
    if (allowedSet.has(field)) continue
    if (/key|token|secret|password|passphrase|private|pat/i.test(field) && field !== 'credentialRef') {
      throw new CredentialHubError(
        'RECORD_INVALID',
        'record has a secret-like field: this UI stores only metadata and credentialRef, never secret values',
      )
    }
    throw new CredentialHubError('RECORD_INVALID', 'record contains an unrecognized field')
  }
  const record = {}
  for (const field of allowed) {
    if (input[field] === undefined) continue
    record[field] = input[field]
  }
  record.tags = normalizeTagsInput(record.tags)
  if (record.alias !== undefined) record.alias = text(record.alias)
  if (record.description !== undefined) record.description = text(record.description)
  if (record.credentialRef !== undefined) record.credentialRef = text(record.credentialRef)
  if (kind === 'ssh') {
    if (record.host !== undefined) record.host = text(record.host)
    if (record.username !== undefined) record.username = text(record.username)
    if (record.port === '' || record.port === null) delete record.port
    else if (typeof record.port === 'string') record.port = Number(record.port)
  } else {
    for (const field of ['platform', 'baseUrl', 'authScheme', 'headerName', 'username']) {
      if (record[field] === undefined) continue
      record[field] = text(record[field])
      if (record[field] === '') delete record[field]
    }
  }
  return record
}

/**
 * Convert normalized, frozen records to a plain YAML document. `kind` is a
 * runtime discriminant, not an inventory field, so it is stripped here.
 * @param {{ssh: readonly object[], pat: readonly object[]}} inventory
 * @returns {{version: 1, ssh: object[], pat: object[]}}
 */
function inventoryToDocument(inventory) {
  const ssh = inventory.ssh.map((record) => {
    const out = {
      alias: record.alias,
      tags: [...record.tags],
      description: record.description,
      credentialRef: record.credentialRef,
      host: record.host,
      port: record.port,
      username: record.username,
    }
    return out
  })
  const pat = inventory.pat.map((record) => {
    const out = {
      alias: record.alias,
      tags: [...record.tags],
      description: record.description,
      credentialRef: record.credentialRef,
      ...record.platform !== undefined ? { platform: record.platform } : {},
      ...record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {},
      ...record.authScheme !== undefined ? { authScheme: record.authScheme } : {},
      ...record.headerName !== undefined ? { headerName: record.headerName } : {},
      ...record.username !== undefined ? { username: record.username } : {},
    }
    return out
  })
  return { version: 1, ssh, pat }
}

/**
 * Remove one alias from both lists; aliases are unique across kinds, but an
 * edit may change the kind, so searching both is the safe operation.
 * @param {{version: 1, ssh: object[], pat: object[]}} document
 * @param {string} alias
 */
function removeAlias(document, alias) {
  const needle = alias.toLowerCase()
  document.ssh = document.ssh.filter((record) => String(record.alias).toLowerCase() !== needle)
  document.pat = document.pat.filter((record) => String(record.alias).toLowerCase() !== needle)
}

/**
 * Merge imported records into the current document; an imported alias replaces
 * the current record with the same alias (case-insensitive).
 * @param {{version: 1, ssh: object[], pat: object[]}} current
 * @param {{version: 1, ssh: object[], pat: object[]}} imported
 * @returns {{version: 1, ssh: object[], pat: object[]}}
 */
function mergeDocuments(current, imported) {
  const aliases = new Set([
    ...imported.ssh.map((record) => String(record.alias).toLowerCase()),
    ...imported.pat.map((record) => String(record.alias).toLowerCase()),
  ])
  return {
    version: 1,
    ssh: [
      ...current.ssh.filter((record) => !aliases.has(String(record.alias).toLowerCase())),
      ...imported.ssh,
    ],
    pat: [
      ...current.pat.filter((record) => !aliases.has(String(record.alias).toLowerCase())),
      ...imported.pat,
    ],
  }
}

/**
 * @param {object} record
 * @returns {object}
 */
function publicRecord(record) {
  return {
    kind: record.kind,
    alias: record.alias,
    tags: [...record.tags],
    description: record.description,
    credentialRef: record.credentialRef,
    ...record.kind === 'ssh' ? {
      host: record.host,
      port: record.port,
      username: record.username,
    } : {
      ...record.platform !== undefined ? { platform: record.platform } : {},
      ...record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {},
      ...record.authScheme !== undefined ? { authScheme: record.authScheme } : {},
      ...record.headerName !== undefined ? { headerName: record.headerName } : {},
      ...record.username !== undefined ? { username: record.username } : {},
    },
  }
}

/**
 * @param {object} config resolved plugin config
 * @returns {object}
 */
function publicConfig(config) {
  return {
    promptSection: config.promptSection,
    maxPromptEntriesPerKind: config.maxPromptEntriesPerKind,
    sshTimeoutMs: config.sshTimeoutMs,
    httpTimeoutMs: config.httpTimeoutMs,
    allowLoopbackHttp: config.allowLoopbackHttp,
    allowCrossOriginPat: config.allowCrossOriginPat,
    followRedirects: config.followRedirects,
    sshStrictHostKeyChecking: config.sshStrictHostKeyChecking,
  }
}

/**
 * Host-side operations behind the settings page. The UI and the agent tools do
 * not share these record-editing operations (the agent has no inventory write
 * tool), but both paths use the same normalizer and the same credentialRef
 * validation.
 */
export class CredentialHubSettings {
  /**
   * @param {{
   *   ctx: object,
   *   hub: import('./hub.js').CredentialHub,
   *   config: object,
   *   inventoryPath: string,
   *   entry?: object,
   *   credentialRef: (value: string) => unknown,
   *   logger?: object,
   * }} options
   */
  constructor(options) {
    this.ctx = options.ctx
    this.hub = options.hub
    this.config = options.config
    this.inventoryPath = options.inventoryPath
    this.entry = options.entry
    this.credentialRef = options.credentialRef
    this.logger = options.logger
    this.queue = Promise.resolve()
  }

  /**
   * Serialize inventory writes so two settings actions cannot interleave their
   * read-modify-write cycles.
   * @template T
   * @param {() => Promise<T>} task
   * @returns {Promise<T>}
   */
  exclusive(task) {
    const next = this.queue.then(task, task)
    this.queue = next.then(() => undefined, () => undefined)
    return next
  }

  /**
   * @param {string} ref
   * @returns {Promise<{configured: boolean, source?: string, writable?: boolean, error?: string}>}
   */
  async credentialStatus(ref) {
    if (!this.hub.validateRef(ref)) {
      return { configured: false, error: 'credentialRef must be a POSIX identifier' }
    }
    try {
      const info = await this.ctx.credentials.describe(this.credentialRef(ref))
      return {
        configured: info.configured === true,
        ...info.source !== undefined ? { source: info.source } : {},
        ...info.writable !== undefined ? { writable: info.writable } : {},
      }
    } catch {
      // Provider errors can contain provider-specific request details. Keep
      // them out of the browser response; the record badge only needs to say
      // that the status could not be read.
      return {
        configured: false,
        error: 'credential provider could not describe this ref',
      }
    }
  }

  /**
   * Read the inventory plus credential-presence facts for the settings page.
   * Values are never included: `describe()` never returns one, and the
   * provider's masked preview is deliberately omitted.
   * @returns {Promise<object>}
   */
  async state() {
    let inventory
    let loadError
    try {
      inventory = this.hub.inventory()
    } catch (error) {
      inventory = { version: 1, ssh: [], pat: [] }
      loadError = {
        code: error instanceof CredentialHubError ? error.code : 'INVENTORY_INVALID',
        message: error instanceof Error ? error.message : String(error),
      }
    }
    const rawRecords = [...inventory.ssh, ...inventory.pat]
    const refs = [...new Set(rawRecords.map((record) => record.credentialRef))]
    const statusPairs = await Promise.all(refs.map(async (ref) => [ref, await this.credentialStatus(ref)]))
    const statuses = new Map(statusPairs)
    const records = rawRecords.map((record) => ({
      ...publicRecord(record),
      credential: statuses.get(record.credentialRef) ?? { configured: false },
    }))
    let configEditor
    try {
      configEditor = this.ctx.get('configEditor')
    } catch {
      configEditor = undefined
    }
    const configEditable = this.entry !== undefined && configEditor !== undefined
    const state = {
      inventoryPath: this.inventoryPath,
      inventoryPermissions: this.inventoryPermissions(),
      records,
      config: publicConfig(this.config),
      configEditable,
      ...!configEditable ? {
        configReadOnlyCode: this.entry === undefined ? 'no-entry' : 'no-editor',
      } : {},
    }
    return loadError === undefined
      ? { ok: true, state }
      : { ok: false, error: loadError, state }
  }

  /**
   * @returns {string}
   */
  inventoryPermissions() {
    try {
      if (!existsSync(this.inventoryPath)) return 'missing'
      const mode = statSync(this.inventoryPath).mode & 0o777
      return mode.toString(8).padStart(4, '0')
    } catch {
      return 'unknown'
    }
  }

  /**
   * @param {unknown} input
   * @returns {{kind: 'ssh'|'pat', originalAlias?: string, record: object}}
   */
  validateSaveInput(input) {
    if (!isObject(input)) throw new CredentialHubError('RECORD_INVALID', 'save payload must be an object')
    const kind = input.kind === 'ssh' || input.kind === 'pat' ? input.kind : undefined
    if (kind === undefined) throw new CredentialHubError('RECORD_INVALID', 'kind must be ssh or pat')
    const originalAlias = input.originalAlias === undefined ? undefined : text(input.originalAlias)
    const record = normalizeRecordInput(kind, input.record)
    return { kind, ...originalAlias !== undefined ? { originalAlias } : {}, record }
  }

  /**
   * Add or replace one record. The whole candidate document is validated with
   * the same rules the loader uses before anything is written.
   * @param {unknown} input
   * @returns {Promise<object>}
   */
  async saveRecord(input) {
    return this.exclusive(async () => {
      const { kind, originalAlias, record } = this.validateSaveInput(input)
      const document = inventoryToDocument(this.hub.inventory())
      if (originalAlias !== undefined && originalAlias !== '') removeAlias(document, originalAlias)
      document[kind].push(record)
      normalizeInventory(document, {
        validateRef: this.hub.validateRef,
        source: this.inventoryPath,
      })
      this.writeInventory(document)
      this.logger?.info?.(`credential-hub: settings saved ${kind} record ${String(record.alias)}`)
      return this.state()
    })
  }

  /**
   * @param {unknown} input
   * @returns {Promise<object>}
   */
  async deleteRecord(input) {
    return this.exclusive(async () => {
      if (!isObject(input)) throw new CredentialHubError('RECORD_INVALID', 'delete payload must be an object')
      const kind = input.kind === 'ssh' || input.kind === 'pat' ? input.kind : undefined
      const alias = text(input.alias)
      if (kind === undefined) throw new CredentialHubError('RECORD_INVALID', 'kind must be ssh or pat')
      if (alias === '') throw new CredentialHubError('RECORD_INVALID', 'alias is required')
      const document = inventoryToDocument(this.hub.inventory())
      const existsInKind = document[kind]
        .some((record) => String(record.alias).toLowerCase() === alias.toLowerCase())
      if (!existsInKind) {
        throw new CredentialHubError('RECORD_NOT_FOUND', `no ${kind} record has alias ${alias}`)
      }
      removeAlias(document, alias)
      normalizeInventory(document, {
        validateRef: this.hub.validateRef,
        source: this.inventoryPath,
      })
      this.writeInventory(document)
      this.logger?.info?.(`credential-hub: settings deleted ${kind} record ${alias}`)
      return this.state()
    })
  }

  /**
   * Export the inventory plus every configured credential value in one
   * encrypted envelope. The plaintext exists only in Host memory; the returned
   * bundle is AES-256-GCM ciphertext and is safe to hand to the browser.
   * @param {unknown} input
   * @returns {Promise<object>}
   */
  async exportBundle(input) {
    if (!isObject(input)) throw new CredentialHubError('BUNDLE_INVALID', 'export payload must be an object')
    const passphrase = validatePassphrase(input.passphrase)
    return this.exclusive(async () => {
      const inventory = this.hub.inventory()
      const document = inventoryToDocument(inventory)
      const refs = [...new Set([...inventory.ssh, ...inventory.pat].map((record) => record.credentialRef))]
      // A valid ref may be "__proto__"; a plain object would mutate its
      // prototype instead of storing the credential under that name.
      const credentials = Object.create(null)
      const missingRefs = []
      for (const ref of refs) {
        try {
          const hit = await this.ctx.credentials.resolve(this.credentialRef(ref))
          if (hit !== undefined && typeof hit.value === 'string' && hit.value !== '') {
            credentials[ref] = hit.value
          } else {
            missingRefs.push(ref)
          }
        } catch {
          missingRefs.push(ref)
        }
      }
      const payload = {
        format: 'dsh-credential-hub.payload',
        version: 1,
        exportedAt: new Date().toISOString(),
        inventory: document,
        credentials,
        missingRefs,
      }
      const bundle = await encryptBundle(payload, passphrase)
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      return {
        ok: true,
        fileName: `credential-hub-${stamp}.dshcredhub.json`,
        bundle,
        summary: {
          ssh: document.ssh.length,
          pat: document.pat.length,
          credentials: Object.keys(credentials).length,
          missing: missingRefs.length,
        },
        missingRefs,
      }
    })
  }

  /**
   * Decrypt an imported bundle in the Host, validate the whole candidate before
   * touching disk, then write the inventory and the included credential values.
   * The response contains counts and failed ref names only — never a value.
   *
   * `merge` keeps current records and lets imported aliases win; `replace`
   * makes the imported inventory the whole inventory. Old credential entries
   * for refs no longer referenced are intentionally left in the credential
   * store; removing unrelated secrets is more dangerous than leaving them.
   *
   * @param {unknown} input
   * @returns {Promise<object>}
   */
  async importBundle(input) {
    if (!isObject(input)) throw new CredentialHubError('BUNDLE_INVALID', 'import payload must be an object')
    const mode = input.mode === 'replace' ? 'replace' : 'merge'
    return this.exclusive(async () => {
      const payload = await decryptBundle(input.bundle, input.passphrase)
      if (!isObject(payload.inventory)) {
        throw new CredentialHubError('BUNDLE_INVALID', 'bundle has no inventory')
      }
      const importedInventory = normalizeInventory(payload.inventory, {
        validateRef: this.hub.validateRef,
        source: 'imported bundle',
      })
      const importedDocument = inventoryToDocument(importedInventory)
      if (importedDocument.ssh.length + importedDocument.pat.length > MAX_IMPORT_RECORDS) {
        throw new CredentialHubError('BUNDLE_TOO_LARGE', `bundle has more than ${MAX_IMPORT_RECORDS} records`)
      }
      const currentDocument = inventoryToDocument(this.hub.inventory())
      const finalDocument = mode === 'replace'
        ? importedDocument
        : mergeDocuments(currentDocument, importedDocument)
      normalizeInventory(finalDocument, {
        validateRef: this.hub.validateRef,
        source: 'imported bundle',
      })
      if (finalDocument.ssh.length + finalDocument.pat.length > MAX_IMPORT_RECORDS) {
        throw new CredentialHubError('BUNDLE_TOO_LARGE', `the combined inventory has more than ${MAX_IMPORT_RECORDS} records`)
      }

      const importedRefs = new Set([
        ...importedDocument.ssh.map((record) => record.credentialRef),
        ...importedDocument.pat.map((record) => record.credentialRef),
      ])
      const rawCredentials = payload.credentials === undefined ? {} : payload.credentials
      if (!isObject(rawCredentials)) {
        throw new CredentialHubError('BUNDLE_INVALID', 'bundle credentials must be an object')
      }
      const writes = []
      let ignoredCredentials = 0
      for (const [ref, value] of Object.entries(rawCredentials)) {
        if (!this.hub.validateRef(ref) || !importedRefs.has(ref)
          || typeof value !== 'string' || value === ''
          || Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
          ignoredCredentials += 1
          continue
        }
        writes.push([ref, value])
        if (writes.length > MAX_IMPORT_CREDENTIALS) {
          throw new CredentialHubError('BUNDLE_TOO_LARGE', `bundle has more than ${MAX_IMPORT_CREDENTIALS} credentials`)
        }
      }

      // The inventory write is the atomic step; credentials follow. If a
      // credential write fails, the inventory is still usable and the response
      // names the ref so the UI can report a partial import.
      this.writeInventory(finalDocument)
      const credentialFailures = []
      for (const [ref, value] of writes) {
        try {
          await this.ctx.credentials.set(this.credentialRef(ref), value)
        } catch {
          credentialFailures.push(ref)
        }
      }
      const state = await this.state()
      return {
        ...state,
        import: {
          mode,
          ssh: importedDocument.ssh.length,
          pat: importedDocument.pat.length,
          credentials: writes.length - credentialFailures.length,
          credentialFailures,
          ignoredCredentials,
        },
      }
    })
  }

  /**
   * Write one credential value through the DSH seam. This is the only path
   * from the settings UI to `ctx.credentials.set`; the value is accepted,
   * stored, and then discarded. It is never returned in the response, logged,
   * or written into the inventory.
   * @param {unknown} input
   * @returns {Promise<object>} credential-presence state, never the value
   */
  async setCredential(input) {
    if (!isObject(input)) throw new CredentialHubError('RECORD_INVALID', 'credential payload must be an object')
    const ref = text(input.ref)
    const value = normalizeSecretValue(typeof input.value === 'string' ? input.value : '')
    if (ref === '') throw new CredentialHubError('CREDENTIAL_REF_INVALID', 'credentialRef is required')
    if (!this.hub.validateRef(ref)) {
      throw new CredentialHubError('CREDENTIAL_REF_INVALID', 'credentialRef must be a POSIX identifier such as SSH_PROD_WEB_KEY')
    }
    if (value.trim() === '') throw new CredentialHubError('CREDENTIAL_VALUE_EMPTY', 'credential value must not be empty; leave the field blank to keep the existing value')
    if (Buffer.byteLength(value, 'utf8') > MAX_SECRET_BYTES) {
      throw new CredentialHubError('CREDENTIAL_VALUE_TOO_LARGE', `credential value must be at most ${MAX_SECRET_BYTES} bytes`)
    }
    try {
      await this.ctx.credentials.set(this.credentialRef(ref), value)
    } catch (error) {
      // Never include the value (or an error string that might contain it) in
      // the response. The provider's message is useful only in the Host log.
      // Do not log the provider error either: a provider is free to include
      // request details, and this path handles a secret value.
      this.logger?.warn?.('credential-hub: credential write failed (details withheld to avoid secret logging)')
      throw new CredentialHubError(
        'CREDENTIAL_WRITE_FAILED',
        'could not store the credential value; check that the credential store is writable and the ref is valid',
      )
    }
    return this.state()
  }

  /**
   * @param {unknown} input
   * @returns {object}
   */
  validateConfigPatch(input) {
    if (!isObject(input)) throw new CredentialHubError('CONFIG_INVALID', 'config payload must be an object')
    const patch = {}
    for (const [key, value] of Object.entries(input)) {
      if (key === 'inventoryPath') {
        throw new CredentialHubError('CONFIG_INVALID', 'inventoryPath can only be changed in cordis.patch.yml')
      }
      if (!EDITABLE_CONFIG_FIELDS.has(key)) {
        throw new CredentialHubError('CONFIG_INVALID', `unknown config field "${key}"`)
      }
      if (['promptSection', 'allowLoopbackHttp', 'allowCrossOriginPat', 'followRedirects'].includes(key)) {
        if (typeof value !== 'boolean') throw new CredentialHubError('CONFIG_INVALID', `${key} must be a boolean`)
        patch[key] = value
      } else if (key === 'sshStrictHostKeyChecking') {
        if (!STRICT_HOST_KEY_VALUES.includes(value)) {
          throw new CredentialHubError('CONFIG_INVALID', `sshStrictHostKeyChecking must be ${STRICT_HOST_KEY_VALUES.join(', ')}`)
        }
        patch[key] = value
      } else {
        if (typeof value !== 'number' || !Number.isFinite(value)) {
          throw new CredentialHubError('CONFIG_INVALID', `${key} must be a finite number`)
        }
        const ranges = {
          maxPromptEntriesPerKind: [1, 100],
          sshTimeoutMs: [1_000, 30 * 60_000],
          httpTimeoutMs: [1_000, 5 * 60_000],
        }
        const range = ranges[key]
        if (range !== undefined && (value < range[0] || value > range[1])) {
          throw new CredentialHubError('CONFIG_INVALID', `${key} must be between ${range[0]} and ${range[1]}`)
        }
        patch[key] = value
      }
    }
    if (Object.keys(patch).length === 0) throw new CredentialHubError('CONFIG_INVALID', 'no config fields supplied')
    return patch
  }

  /**
   * Persist behavior settings through the profile's config editor. Ordinary
   * fields restart the plugin row, so the response reports that state instead
   * of pretending the in-memory config already changed.
   * @param {unknown} input
   * @returns {Promise<{restarting: true}>}
   */
  async saveConfig(input) {
    const patch = this.validateConfigPatch(input)
    let editor
    try {
      editor = this.ctx.get('configEditor')
    } catch {
      editor = undefined
    }
    if (this.entry === undefined || editor === undefined) {
      throw new CredentialHubError('CONFIG_READ_ONLY', 'config editor is unavailable in this profile')
    }
    await editor.edit(this.entry, (current) => ({ ...current, ...patch }))
    return { restarting: true }
  }

  /**
   * Atomically replace the inventory with the normalized document, preserving
   * the previous content if the post-write load fails.
   * @param {{version: 1, ssh: object[], pat: object[]}} document
   * @returns {void}
   */
  writeInventory(document) {
    if (existsSync(this.inventoryPath) && lstatSync(this.inventoryPath).isSymbolicLink()) {
      throw new CredentialHubError('INVENTORY_UNSAFE', 'inventory path is a symbolic link; refusing to write through it')
    }
    const previous = existsSync(this.inventoryPath) ? readFileSync(this.inventoryPath, 'utf8') : undefined
    const temporary = `${this.inventoryPath}.tmp-${process.pid}-${Date.now()}`
    const body = `${INVENTORY_HEADER}${stringify({ version: 1, ssh: document.ssh, pat: document.pat }, { lineWidth: 0 })}`
    try {
      writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
      if (process.platform !== 'win32') chmodSync(temporary, 0o600)
      renameSync(temporary, this.inventoryPath)
      if (process.platform !== 'win32') chmodSync(this.inventoryPath, 0o600)
      this.hub.loadSync({ createIfMissing: false })
    } catch (error) {
      rmSync(temporary, { force: true })
      try {
        if (previous === undefined) {
          // The file did not exist before this write; do not leave a new file
          // behind when the post-write load fails.
          rmSync(this.inventoryPath, { force: true })
        } else {
          writeFileSync(this.inventoryPath, previous, { encoding: 'utf8', mode: 0o600 })
          if (process.platform !== 'win32') chmodSync(this.inventoryPath, 0o600)
        }
        this.hub.loadSync({ createIfMissing: false })
      } catch {
        // The original error is the useful one; the hub keeps its last good
        // snapshot and the settings page reports the failure on refresh.
      }
      throw error instanceof CredentialHubError
        ? error
        : new CredentialHubError('INVENTORY_WRITE_FAILED', `could not write the inventory: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}
