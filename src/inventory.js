import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { parseDocument } from 'yaml'
import { CredentialHubError } from './errors.js'
import { credentialRefGrammarHint, isCredentialRefName } from './refs.js'

/** Fields every record may carry. */
const COMMON_FIELDS = ['alias', 'tags', 'description', 'credentialRef']
/** Fields an SSH host record may carry in addition to the common ones. */
const SSH_FIELDS = [...COMMON_FIELDS, 'host', 'port', 'username']
/** Fields a PAT record may carry in addition to the common ones. */
const PAT_FIELDS = [...COMMON_FIELDS, 'platform', 'baseUrl', 'authScheme', 'headerName', 'username']

const ALIAS_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const HOST_PATTERN = /^[A-Za-z0-9._:\[\]-]+$/
const USERNAME_PATTERN = /^[A-Za-z0-9._@-]+$/
const HEADER_PATTERN = /^[A-Za-z0-9!#$%&'*+.^_`|~-]+$/
const FORBIDDEN_HEADER_NAMES = new Set(['host', 'content-length', 'connection', 'transfer-encoding', 'cookie', 'set-cookie'])
const AUTH_SCHEMES = ['bearer', 'token', 'basic', 'header']

/** Text written when the inventory does not exist yet. No secret ever goes here. */
export const EMPTY_INVENTORY_TEXT = `# dsh-credential-hub inventory
#
# SECURITY: this file stores credential *references*, never values.
# Put private keys and PATs in the DSH credential store, then write the
# credentialRef here. A privateKey/token/password field is rejected on load.
#
# credentialRef grammar (from @deepseek-ai/dsh-credentials):
#   ^[A-Za-z_][A-Za-z0-9_]*$
#
# Example:
#   ssh:
#     - alias: prod-web-01
#       tags: ["env:production", "service:web"]
#       description: 生产环境 Web 应用主机
#       host: 10.0.0.10
#       port: 22
#       username: deploy
#       credentialRef: SSH_PROD_WEB_KEY
#   pat:
#     - alias: github-prod-token
#       tags: ["platform:github", "env:production"]
#       description: GitHub 生产环境令牌
#       platform: github
#       baseUrl: https://api.github.com
#       credentialRef: PAT_GITHUB_PROD
#
version: 1
ssh: []
pat: []
`

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * @param {string} value
 * @returns {string}
 */
function collapseWhitespace(value) {
  return value.replace(/\s+/g, ' ').trim()
}

/**
 * Keep prompt interpolation literal-safe. A description containing `{{x}}`
 * would otherwise be read as a prompt variable and could fail assembly.
 * @param {string} value
 * @returns {string}
 */
export function promptSafe(value) {
  return collapseWhitespace(value)
    .replace(/\{\{/g, '{ {')
    .replace(/\}\}/g, '} }')
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @returns {string | undefined}
 */
function requireString(value, where, errors) {
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${where} must be a non-empty string`)
    return undefined
  }
  return value.trim()
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @param {number} defaultValue
 * @returns {number}
 */
function optionalPort(value, where, errors, defaultValue) {
  if (value === undefined) return defaultValue
  if (!Number.isInteger(value) || value < 1 || value > 65535) {
    errors.push(`${where} must be an integer from 1 to 65535`)
    return defaultValue
  }
  return value
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @returns {string[]}
 */
function normalizeTags(value, where, errors) {
  if (value === undefined) {
    errors.push(`${where} is required (use [] when there are no tags)`)
    return []
  }
  if (!Array.isArray(value)) {
    errors.push(`${where} must be an array of strings`)
    return []
  }
  if (value.length > 32) {
    errors.push(`${where} has more than 32 tags`)
    return []
  }
  const result = []
  const seen = new Set()
  for (const [index, tag] of value.entries()) {
    if (typeof tag !== 'string' || tag.trim() === '') {
      errors.push(`${where}[${index}] must be a non-empty string`)
      continue
    }
    const clean = collapseWhitespace(tag)
    if (clean.length > 64) {
      errors.push(`${where}[${index}] is longer than 64 characters`)
      continue
    }
    const key = clean.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    result.push(clean)
  }
  return result
}

/**
 * Reject unknown fields, with a sharper message for a secret someone tried to
 * paste into the inventory. The value is never echoed back.
 * @param {Record<string, unknown>} record
 * @param {readonly string[]} allowed
 * @param {string} where
 * @param {string[]} errors
 */
function rejectUnknownFields(record, allowed, where, errors) {
  const allowedSet = new Set(allowed)
  for (const key of Object.keys(record)) {
    if (allowedSet.has(key)) continue
    if (/key|token|secret|password|passphrase|private|pat/i.test(key) && key !== 'credentialRef') {
      // Do not echo the field name: a user can accidentally paste the secret
      // into the key position, and errors may reach a model or a log.
      errors.push(`${where} has a secret-like field: the inventory stores only credentialRef names, never secret values. `
        + 'Store the value in the DSH credential store and reference its name here.')
    } else {
      errors.push(`${where} contains an unrecognized field; remove it or use credentialRef for secrets`)
    }
  }
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @returns {string | undefined}
 */
function normalizeBaseUrl(value, where, errors) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    errors.push(`${where} must be a non-empty absolute URL`)
    return undefined
  }
  let url
  try {
    url = new URL(value.trim())
  } catch {
    errors.push(`${where} must be an absolute http(s) URL`)
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    errors.push(`${where} must use http or https`)
    return undefined
  }
  if (url.username !== '' || url.password !== '') {
    errors.push(`${where} must not embed credentials`)
    return undefined
  }
  if (url.search !== '' || url.hash !== '') {
    errors.push(`${where} must not contain a query or fragment; a query can accidentally carry a secret`)
    return undefined
  }
  return url.href
}

/**
 * @param {unknown} value
 * @param {string} where
 * @param {string[]} errors
 * @returns {string | undefined}
 */
function normalizeHeaderName(value, where, errors) {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || !HEADER_PATTERN.test(value)) {
    errors.push(`${where} must be a valid HTTP header name`)
    return undefined
  }
  const lower = value.toLowerCase()
  if (FORBIDDEN_HEADER_NAMES.has(lower)) {
    errors.push(`${where} must not be a framing or cookie header`)
    return undefined
  }
  return value
}

/**
 * Normalize a parsed YAML document into the frozen inventory the rest of the
 * plugin uses. Validation is strict and all errors are collected so the owner
 * can fix the file in one pass.
 *
 * @param {unknown} document
 * @param {{ validateRef?: (value: string) => boolean, source?: string }} [options]
 * @returns {{version: 1, ssh: readonly object[], pat: readonly object[]}}
 */
export function normalizeInventory(document, options = {}) {
  const validateRef = options.validateRef ?? isCredentialRefName
  const source = options.source ?? 'inventory.yml'
  const errors = []
  if (document === null || document === undefined) {
    return Object.freeze({ version: 1, ssh: Object.freeze([]), pat: Object.freeze([]) })
  }
  if (!isObject(document)) {
    throw new CredentialHubError('INVENTORY_INVALID', `${source}: the root must be a YAML mapping`)
  }
  for (const key of Object.keys(document)) {
    if (!['version', 'ssh', 'pat'].includes(key)) {
      errors.push(`${source}: unknown top-level field "${key}"`)
    }
  }
  if (document.version !== undefined && document.version !== 1) {
    errors.push(`${source}: version must be 1`)
  }
  const sshInput = document.ssh ?? []
  const patInput = document.pat ?? []
  if (!Array.isArray(sshInput)) errors.push(`${source}: ssh must be an array`)
  if (!Array.isArray(patInput)) errors.push(`${source}: pat must be an array`)

  const aliases = new Map()
  const normalizedSsh = []
  const normalizedPat = []

  const normalizeCommon = (record, where, kind) => {
    rejectUnknownFields(record, kind === 'ssh' ? SSH_FIELDS : PAT_FIELDS, where, errors)
    const alias = requireString(record.alias, `${where}.alias`, errors)
    if (alias !== undefined) {
      if (!ALIAS_PATTERN.test(alias)) {
        errors.push(`${where}.alias must match ${String(ALIAS_PATTERN)}`)
      }
      const key = alias.toLowerCase()
      if (aliases.has(key)) {
        errors.push(`${where}.alias "${alias}" is already used by ${aliases.get(key)}; aliases are unique across ssh and pat`)
      } else {
        aliases.set(key, `${kind}:${alias}`)
      }
    }
    const tags = normalizeTags(record.tags, `${where}.tags`, errors)
    const description = requireString(record.description, `${where}.description`, errors)
    if (description !== undefined && description.length > 500) {
      errors.push(`${where}.description is longer than 500 characters`)
    }
    const ref = requireString(record.credentialRef, `${where}.credentialRef`, errors)
    if (ref !== undefined && !validateRef(ref)) {
      errors.push(`${where}: ${credentialRefGrammarHint()}`)
    }
    return { alias, tags, description, ref }
  }

  if (Array.isArray(sshInput)) {
    for (const [index, input] of sshInput.entries()) {
      const where = `ssh[${index}]`
      if (!isObject(input)) {
        errors.push(`${where} must be a mapping`)
        continue
      }
      const common = normalizeCommon(input, where, 'ssh')
      const host = requireString(input.host, `${where}.host`, errors)
      if (host !== undefined && (!HOST_PATTERN.test(host) || host.startsWith('-'))) {
        errors.push(`${where}.host must be a hostname or IP address without whitespace or shell metacharacters`)
      }
      const username = requireString(input.username, `${where}.username`, errors)
      if (username !== undefined && (!USERNAME_PATTERN.test(username) || username.startsWith('-'))) {
        errors.push(`${where}.username must be an SSH login name without whitespace or shell metacharacters`)
      }
      const port = optionalPort(input.port, `${where}.port`, errors, 22)
      if (common.alias === undefined || common.description === undefined || common.ref === undefined
        || host === undefined || username === undefined) continue
      normalizedSsh.push(Object.freeze({
        alias: common.alias,
        kind: 'ssh',
        tags: Object.freeze([...common.tags]),
        description: common.description,
        credentialRef: common.ref,
        host,
        port,
        username,
      }))
    }
  }

  if (Array.isArray(patInput)) {
    for (const [index, input] of patInput.entries()) {
      const where = `pat[${index}]`
      if (!isObject(input)) {
        errors.push(`${where} must be a mapping`)
        continue
      }
      const common = normalizeCommon(input, where, 'pat')
      let platform
      if (input.platform !== undefined) {
        platform = requireString(input.platform, `${where}.platform`, errors)
        if (platform !== undefined && platform.length > 64) {
          errors.push(`${where}.platform is longer than 64 characters`)
        }
      }
      const baseUrl = normalizeBaseUrl(input.baseUrl, `${where}.baseUrl`, errors)
      let authScheme = 'bearer'
      if (input.authScheme !== undefined) {
        if (typeof input.authScheme === 'string' && AUTH_SCHEMES.includes(input.authScheme)) {
          authScheme = input.authScheme
        } else {
          errors.push(`${where}.authScheme must be one of ${AUTH_SCHEMES.join(', ')}`)
        }
      }
      const headerName = normalizeHeaderName(input.headerName, `${where}.headerName`, errors)
      let username
      if (input.username !== undefined) {
        username = requireString(input.username, `${where}.username`, errors)
      }
      if (authScheme === 'basic' && username === undefined) {
        errors.push(`${where}.username is required when authScheme is basic`)
      }
      if (authScheme === 'header' && headerName === undefined) {
        errors.push(`${where}.headerName is required when authScheme is header`)
      }
      if (common.alias === undefined || common.description === undefined || common.ref === undefined) continue
      normalizedPat.push(Object.freeze({
        alias: common.alias,
        kind: 'pat',
        tags: Object.freeze([...common.tags]),
        description: common.description,
        credentialRef: common.ref,
        ...platform !== undefined ? { platform } : {},
        ...baseUrl !== undefined ? { baseUrl } : {},
        authScheme,
        ...headerName !== undefined ? { headerName } : {},
        ...username !== undefined ? { username } : {},
      }))
    }
  }

  if (errors.length > 0) {
    throw new CredentialHubError('INVENTORY_INVALID', `${source}: ${errors.join('; ')}`)
  }
  return Object.freeze({
    version: 1,
    ssh: Object.freeze(normalizedSsh),
    pat: Object.freeze(normalizedPat),
  })
}

/**
 * Describe parser failures without echoing the offending source line. A
 * malformed YAML file may contain a key or token someone pasted by mistake;
 * the parser's pretty code frame would copy it into a startup log and, after a
 * hot reload, into a tool error returned to the model.
 * @param {readonly object[]} errors
 * @returns {string}
 */
function yamlFailureDetail(errors) {
  return errors.map((error, index) => {
    const position = Array.isArray(error.linePos) && error.linePos.length > 0 ? error.linePos[0] : undefined
    const location = position !== undefined && Number.isInteger(position.line)
      ? ` at line ${position.line}${Number.isInteger(position.col) ? `, column ${position.col}` : ''}`
      : ''
    const code = typeof error.code === 'string' && error.code !== '' ? error.code : 'YAML_PARSE_ERROR'
    return `error ${index + 1}${location} (${code})`
  }).join('; ')
}

/**
 * @param {string} text
 * @param {{ source?: string, validateRef?: (value: string) => boolean }} [options]
 * @returns {{version: 1, ssh: readonly object[], pat: readonly object[]}}
 */
export function parseInventory(text, options = {}) {
  const source = options.source ?? 'inventory.yml'
  let document
  try {
    document = parseDocument(text, {
      prettyErrors: true,
      uniqueKeys: true,
      maxAliasCount: 100,
    })
  } catch (error) {
    // The parser rejected the document before producing a diagnostic; do not
    // include its message because it may quote source content.
    throw new CredentialHubError('INVENTORY_INVALID', `${source}: invalid YAML (parser rejected the document)`)
  }
  if (document.errors.length > 0) {
    throw new CredentialHubError('INVENTORY_INVALID', `${source}: invalid YAML: ${yamlFailureDetail(document.errors)}`)
  }
  let value
  try {
    value = document.toJS({ maxAliasCount: 100 })
  } catch {
    throw new CredentialHubError('INVENTORY_INVALID', `${source}: invalid YAML (document could not be materialized safely)`)
  }
  return normalizeInventory(value, options)
}

/**
 * Ensure the inventory directory exists with owner-only access and the file is
 * 0600. The inventory holds references rather than secrets, so this is defense
 * in depth, not the security boundary.
 * @param {string} inventoryPath
 * @param {{ logger?: object, createIfMissing?: boolean }} [options]
 * @returns {{ created: boolean }}
 */
export function ensureInventoryFile(inventoryPath, options = {}) {
  const logger = options.logger
  const absolute = resolve(inventoryPath)
  const directory = dirname(absolute)
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  if (process.platform !== 'win32') {
    try {
      chmodSync(directory, 0o700)
    } catch (error) {
      logger?.warn?.(`credential-hub: could not tighten inventory directory permissions: ${String(error?.message ?? error)}`)
    }
  }
  if (!existsSync(absolute)) {
    if (options.createIfMissing === false) {
      throw new CredentialHubError('INVENTORY_MISSING', `${absolute}: inventory file does not exist`)
    }
    const temporary = `${absolute}.tmp-${process.pid}`
    writeFileSync(temporary, EMPTY_INVENTORY_TEXT, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    if (process.platform !== 'win32') chmodSync(temporary, 0o600)
    renameSync(temporary, absolute)
    return { created: true }
  }
  if (process.platform !== 'win32') {
    const mode = statSync(absolute).mode & 0o777
    if ((mode & 0o077) !== 0) {
      try {
        chmodSync(absolute, 0o600)
        logger?.warn?.(`credential-hub: inventory was mode ${mode.toString(8)}; tightened to 0600`)
      } catch (error) {
        logger?.warn?.(`credential-hub: inventory is mode ${mode.toString(8)} and could not be tightened: ${String(error?.message ?? error)}`)
      }
    }
  }
  return { created: false }
}

/**
 * Read and validate the inventory. Missing files are created with an empty
 * document unless `createIfMissing` is false.
 * @param {string} inventoryPath
 * @param {{ createIfMissing?: boolean, validateRef?: (value: string) => boolean, logger?: object }} [options]
 * @returns {{inventory: object, mtimeMs: number, size: number, created: boolean, path: string}}
 */
export function readInventorySync(inventoryPath, options = {}) {
  const absolute = resolve(inventoryPath)
  const { created } = ensureInventoryFile(absolute, options)
  const stat = statSync(absolute)
  const text = readFileSync(absolute, 'utf8')
  const inventory = parseInventory(text, {
    source: absolute,
    ...options.validateRef !== undefined ? { validateRef: options.validateRef } : {},
  })
  return { inventory, mtimeMs: stat.mtimeMs, size: stat.size, created, path: absolute }
}

/**
 * Render one inventory summary line. Only alias, tags, description and
 * credentialRef appear here by design.
 * @param {object} record
 * @returns {string}
 */
function summaryLine(record) {
  const tags = record.tags.length > 0 ? record.tags.join(', ') : '无标签'
  return `- ${promptSafe(record.alias)}｜tags: ${promptSafe(tags)}｜${promptSafe(record.description)}｜credentialRef: ${promptSafe(record.credentialRef)}`
}

/**
 * Metadata-only overview used by the system prompt. No host, port, username,
 * URL, or value is included: those are operation details the tools can reveal
 * after a match, not prompt facts.
 * @param {readonly object[]} records
 * @param {'ssh'|'pat'} kind
 * @param {number} maxEntries
 * @returns {string}
 */
export function renderInventorySummary(records, kind, maxEntries) {
  const empty = kind === 'ssh' ? '（当前清单未配置 SSH 主机）' : '（当前清单未配置 PAT 令牌）'
  if (records.length === 0) return empty
  const shown = records.slice(0, maxEntries).map(summaryLine)
  if (records.length > maxEntries) {
    shown.push(`- …另有 ${records.length - maxEntries} 条未在概览中列出，请调用 credential_hub_match 查询。`)
  }
  return shown.join('\n')
}

/**
 * Both prompt variables, generated from the same snapshot.
 * @param {{ssh: readonly object[], pat: readonly object[]}} inventory
 * @param {number} maxEntries
 * @returns {{sshInventorySummary: string, patInventorySummary: string}}
 */
export function buildSummaries(inventory, maxEntries) {
  return {
    sshInventorySummary: renderInventorySummary(inventory.ssh, 'ssh', maxEntries),
    patInventorySummary: renderInventorySummary(inventory.pat, 'pat', maxEntries),
  }
}
