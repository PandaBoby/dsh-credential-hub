import assert from 'node:assert/strict'
import { existsSync, readFileSync, statSync, unlinkSync } from 'node:fs'
import { test } from 'node:test'
import { resolveConfig } from '../src/config.js'
import { CredentialHubSettings } from '../src/settings.js'
import { decryptBundle, encryptBundle } from '../src/bundle.js'
import { registerSettingsRoutes } from '../src/settings-routes.js'
import { fixture, PAT, SSH_SECRET } from './helpers.mjs'

/**
 * @param {object} f fixture
 * @param {{ editor?: boolean, entry?: boolean, refs?: Record<string,string>, describeThrows?: boolean, setThrowsFor?: string[] }} [options]
 * @returns {object}
 */
function harness(f, options = {}) {
  const described = []
  const edited = []
  const written = new Map()
  const editor = {
    async edit(entry, change) {
      edited.push({ entry, config: change({ ...f.config, inventoryPath: f.path }) })
    },
  }
  const ctx = {
    credentials: {
      async describe(ref) {
        described.push(ref)
        if (options.describeThrows === true) throw new Error(`provider detail ${SSH_SECRET}`)
        return written.has(ref) || (options.refs !== undefined && options.refs[ref] !== undefined)
          ? { configured: true, source: 'test', writable: true, masked: 'should-not-be-returned' }
          : { configured: false, writable: true, masked: 'should-not-be-returned' }
      },
      async resolve(ref) {
        const value = written.has(ref) ? written.get(ref) : options.refs?.[ref]
        return value === undefined ? undefined : { value, source: 'test' }
      },
      async set(ref, value) {
        if (options.setThrowsFor?.includes(ref)) throw new Error(`provider detail ${value}`)
        written.set(ref, value)
      },
    },
    get(name) {
      return name === 'configEditor' && options.editor !== false ? editor : undefined
    },
  }
  const settings = new CredentialHubSettings({
    ctx,
    hub: f.hub,
    config: resolveConfig({ inventoryPath: f.path }),
    inventoryPath: f.path,
    entry: options.entry === false ? undefined : { id: 'credential-hub' },
    credentialRef: (value) => value,
  })
  return { settings, editor, edited, described, written, ctx }
}

test('state returns metadata and presence facts only', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { refs: { SSH_PROD_WEB_KEY: SSH_SECRET, PAT_GITHUB_PROD: PAT } })
  const result = await settings.state()
  assert.equal(result.ok, true)
  assert.equal(result.state.records.length, 4)
  const ssh = result.state.records.find((record) => record.alias === 'prod-web-01')
  assert.deepEqual(ssh.credential, { configured: true, source: 'test', writable: true })
  assert.equal(ssh.host, '127.0.0.1')
  assert.equal(JSON.stringify(result).includes('should-not-be-returned'), false)
  assert.equal(JSON.stringify(result).includes(SSH_SECRET), false)
  assert.equal(JSON.stringify(result).includes(PAT), false)
  assert.equal(result.state.configEditable, true)
  assert.equal(result.state.inventoryPermissions, '0600')
})

test('state reports an unconfigured ref and works without a config editor', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { editor: false })
  const result = await settings.state()
  assert.equal(result.state.records[0].credential.configured, false)
  assert.equal(result.state.configEditable, false)
  assert.equal(result.state.configReadOnlyCode, 'no-editor')
})

test('saveRecord adds and updates without touching secret values', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings, described } = harness(f)
  await settings.saveRecord({
    kind: 'ssh',
    record: {
      alias: 'new-host',
      tags: ['env:production', 'service:api'],
      description: '新主机',
      host: '10.0.0.42',
      port: 2222,
      username: 'deploy',
      credentialRef: 'SSH_NEW_HOST_KEY',
    },
  })
  assert.ok(f.hub.findByAlias('new-host'))
  assert.equal(statSync(f.path).mode & 0o777, 0o600)
  const saved = readFileSync(f.path, 'utf8')
  assert.match(saved, /new-host/)
  assert.match(saved, /SSH_NEW_HOST_KEY/)
  assert.equal(saved.includes(SSH_SECRET), false)
  const result = await settings.saveRecord({
    kind: 'ssh',
    originalAlias: 'new-host',
    record: {
      alias: 'renamed-host',
      tags: ['env:staging'],
      description: '改名后的主机',
      host: '10.0.0.43',
      port: 22,
      username: 'deploy',
      credentialRef: 'SSH_RENAMED_KEY',
    },
  })
  assert.equal(result.ok, true)
  assert.equal(f.hub.findByAlias('new-host'), undefined)
  assert.ok(f.hub.findByAlias('renamed-host'))
  assert.ok(described.some((ref) => ref === 'SSH_RENAMED_KEY'))
})

test('saveRecord rejects secret fields without echoing their values', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f)
  const secret = 'sk-ui-should-not-persist'
  await assert.rejects(
    () => settings.saveRecord({
      kind: 'ssh',
      record: {
        alias: 'bad', tags: [], description: 'bad', host: 'h', username: 'u', credentialRef: 'SSH_BAD_KEY',
        privateKey: secret,
      },
    }),
    (error) => {
      assert.match(error.message, /secret-like|forbidden/)
      assert.equal(error.message.includes(secret), false)
      return true
    },
  )
  const saved = readFileSync(f.path, 'utf8')
  assert.equal(saved.includes(secret), false)
})

test('saveRecord rejects an invalid slash-shaped ref', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f)
  await assert.rejects(
    () => settings.saveRecord({
      kind: 'pat',
      record: {
        alias: 'bad-pat', tags: [], description: 'bad', credentialRef: 'pat/github-prod',
      },
    }),
    /POSIX identifier/,
  )
})

test('invalid ref errors never echo a pasted secret-shaped value', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f)
  const pasted = 'sk-live-pasted-by-mistake-123456'
  await assert.rejects(
    () => settings.saveRecord({
      kind: 'pat',
      record: { alias: 'bad-ref', tags: [], description: 'bad', credentialRef: pasted },
    }),
    (error) => {
      assert.match(error.message, /POSIX identifier/)
      assert.equal(error.message.includes(pasted), false)
      return true
    },
  )
})

test('deleteRecord removes one kind and reports a missing alias', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f)
  const result = await settings.deleteRecord({ kind: 'ssh', alias: 'staging-db' })
  assert.equal(result.ok, true)
  assert.equal(f.hub.findByAlias('staging-db'), undefined)
  assert.ok(f.hub.findByAlias('prod-web-01'))
  await assert.rejects(
    () => settings.deleteRecord({ kind: 'ssh', alias: 'staging-db' }),
    /no ssh record has alias/,
  )
})

test('exportBundle returns ciphertext and exports configured credentials', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { refs: { SSH_PROD_WEB_KEY: SSH_SECRET, PAT_GITHUB_PROD: PAT } })
  const passphrase = 'correct horse battery staple'
  const result = await settings.exportBundle({ passphrase })
  assert.equal(result.ok, true)
  assert.match(result.fileName, /^credential-hub-.*\.dshcredhub\.json$/)
  assert.equal(result.summary.ssh, 2)
  assert.equal(result.summary.pat, 2)
  assert.equal(result.summary.credentials, 2)
  assert.equal(result.missingRefs.includes('SSH_STAGING_DB_KEY'), true)
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(SSH_SECRET), false)
  assert.equal(serialized.includes(PAT), false)
  const payload = await decryptBundle(result.bundle, passphrase)
  assert.equal(payload.inventory.ssh.length, 2)
  assert.equal(payload.credentials.SSH_PROD_WEB_KEY, SSH_SECRET)
  assert.equal(payload.credentials.PAT_GITHUB_PROD, PAT)
  assert.equal(readFileSync(f.path, 'utf8').includes(SSH_SECRET), false)
  await assert.rejects(() => settings.exportBundle({ passphrase: 'short' }), /at least 8/)
})

test('importBundle merges records and writes included credentials without echoing values', async (t) => {
  const source = fixture()
  t.after(source.dispose)
  const sourceSettings = harness(source, {
    refs: { SSH_PROD_WEB_KEY: SSH_SECRET, PAT_GITHUB_PROD: PAT },
  }).settings
  const exported = await sourceSettings.exportBundle({ passphrase: 'correct horse battery staple' })

  const target = fixture('version: 1\nssh: []\npat: []\n')
  t.after(target.dispose)
  const targetHarness = harness(target)
  const result = await targetHarness.settings.importBundle({
    bundle: exported.bundle,
    passphrase: 'correct horse battery staple',
    mode: 'merge',
  })
  assert.equal(result.ok, true)
  assert.equal(result.import.mode, 'merge')
  assert.equal(result.import.ssh, 2)
  assert.equal(result.import.pat, 2)
  assert.equal(result.import.credentials, 2)
  assert.ok(target.hub.findByAlias('prod-web-01'))
  assert.ok(target.hub.findByAlias('github-prod-token'))
  assert.equal(targetHarness.written.get('SSH_PROD_WEB_KEY'), SSH_SECRET)
  assert.equal(targetHarness.written.get('PAT_GITHUB_PROD'), PAT)
  const serialized = JSON.stringify(result)
  assert.equal(serialized.includes(SSH_SECRET), false)
  assert.equal(serialized.includes(PAT), false)
})

test('importBundle merge lets an imported alias win over the current record', async (t) => {
  const source = fixture()
  t.after(source.dispose)
  const exported = await harness(source, { refs: { SSH_PROD_WEB_KEY: SSH_SECRET } }).settings.exportBundle({
    passphrase: 'correct horse battery staple',
  })
  const target = fixture(`version: 1
ssh:
  - alias: staging-db
    tags: [env:staging]
    description: 目标机器上的旧描述
    host: 10.9.9.9
    username: old
    credentialRef: SSH_STAGING_DB_KEY
pat: []
`)
  t.after(target.dispose)
  const result = await harness(target).settings.importBundle({
    bundle: exported.bundle,
    passphrase: 'correct horse battery staple',
    mode: 'merge',
  })
  assert.equal(result.ok, true)
  const merged = target.hub.findByAlias('staging-db')
  assert.equal(merged.host, '127.0.0.1')
  assert.equal(merged.description, '测试环境数据库主机')
  assert.equal(target.hub.inventory().ssh.filter((record) => record.alias === 'staging-db').length, 1)
})

test('importBundle replace mode clears the current inventory', async (t) => {
  const source = fixture()
  t.after(source.dispose)
  const sourceSettings = harness(source).settings
  const exported = await sourceSettings.exportBundle({ passphrase: 'correct horse battery staple' })
  const target = fixture(`version: 1
ssh:
  - alias: only-in-target
    tags: []
    description: 只在目标机器上的记录
    host: 10.0.0.9
    username: deploy
    credentialRef: SSH_ONLY_TARGET
pat: []
`)
  t.after(target.dispose)
  const targetSettings = harness(target).settings
  const result = await targetSettings.importBundle({
    bundle: exported.bundle,
    passphrase: 'correct horse battery staple',
    mode: 'replace',
  })
  assert.equal(result.ok, true)
  assert.equal(result.import.mode, 'replace')
  assert.equal(target.hub.findByAlias('only-in-target'), undefined)
  assert.ok(target.hub.findByAlias('prod-web-01'))
})

test('importBundle writes the inventory and reports partial credential failures without leaking values', async (t) => {
  const source = fixture()
  t.after(source.dispose)
  const exported = await harness(source, {
    refs: { SSH_PROD_WEB_KEY: SSH_SECRET, PAT_GITHUB_PROD: PAT },
  }).settings.exportBundle({ passphrase: 'correct horse battery staple' })
  const target = fixture('version: 1\nssh: []\npat: []\n')
  t.after(target.dispose)
  const targetHarness = harness(target, { setThrowsFor: ['PAT_GITHUB_PROD'] })
  const result = await targetHarness.settings.importBundle({
    bundle: exported.bundle,
    passphrase: 'correct horse battery staple',
    mode: 'merge',
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.import.credentialFailures, ['PAT_GITHUB_PROD'])
  assert.equal(result.import.credentials, 1)
  assert.ok(target.hub.findByAlias('prod-web-01'))
  assert.equal(targetHarness.written.has('SSH_PROD_WEB_KEY'), true)
  assert.equal(targetHarness.written.has('PAT_GITHUB_PROD'), false)
  assert.equal(JSON.stringify(result).includes(SSH_SECRET), false)
  assert.equal(JSON.stringify(result).includes(PAT), false)
})

test('importBundle rejects an encrypted inventory that smuggles a secret field', async (t) => {
  const target = fixture('version: 1\nssh: []\npat: []\n')
  t.after(target.dispose)
  const settings = harness(target).settings
  const passphrase = 'correct horse battery staple'
  const bundle = await encryptBundle({
    format: 'dsh-credential-hub.payload',
    version: 1,
    inventory: {
      version: 1,
      ssh: [{
        alias: 'evil',
        tags: [],
        description: 'not a real record',
        host: '127.0.0.1',
        username: 'deploy',
        credentialRef: 'EVIL_KEY',
        privateKey: '-----BEGIN OPENSSH PRIVATE KEY-----',
      }],
      pat: [],
    },
    credentials: {},
  }, passphrase)
  await assert.rejects(
    () => settings.importBundle({ bundle, passphrase, mode: 'merge' }),
    /secret-like|forbidden|not allowed/i,
  )
  assert.equal(target.hub.findByAlias('evil'), undefined)
})

test('importBundle rejects a wrong passphrase or tampered bundle before writing', async (t) => {
  const source = fixture()
  t.after(source.dispose)
  const exported = await harness(source).settings.exportBundle({ passphrase: 'correct horse battery staple' })
  const target = fixture('version: 1\nssh: []\npat: []\n')
  t.after(target.dispose)
  const settings = harness(target).settings
  await assert.rejects(
    () => settings.importBundle({
      bundle: exported.bundle,
      passphrase: 'wrong wrong',
      mode: 'merge',
    }),
    /wrong passphrase or corrupted/,
  )
  const tampered = { ...exported.bundle, payload: Buffer.from('tampered').toString('base64') }
  await assert.rejects(
    () => settings.importBundle({
      bundle: tampered,
      passphrase: 'correct horse battery staple',
      mode: 'merge',
    }),
    /wrong passphrase or corrupted/,
  )
  assert.equal(target.hub.findByAlias('prod-web-01'), undefined)
})

test('state hides provider describe errors', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { describeThrows: true })
  const result = await settings.state()
  assert.equal(result.ok, true)
  const record = result.state.records[0]
  assert.equal(record.credential.error, 'credential provider could not describe this ref')
  assert.equal(JSON.stringify(result).includes('provider detail'), false)
  assert.equal(JSON.stringify(result).includes(SSH_SECRET), false)
})

test('writeInventory removes a newly created file when the post-write load fails', (t) => {
  const f = fixture('version: 1\nssh: []\npat: []\n')
  t.after(f.dispose)
  const { settings } = harness(f)
  unlinkSync(f.path)
  const original = f.hub.loadSync
  f.hub.loadSync = () => { throw new Error('simulated load failure') }
  assert.throws(
    () => settings.writeInventory({ version: 1, ssh: [], pat: [] }),
    /could not write the inventory/,
  )
  assert.equal(existsSync(f.path), false)
  f.hub.loadSync = original
})

test('setCredential writes through the seam and returns no value', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings, written } = harness(f)
  const secret = 'gpat_live_UI_WRITE_ONLY_123456'
  const result = await settings.setCredential({ ref: 'PAT_GITHUB_PROD', value: secret })
  assert.equal(written.get('PAT_GITHUB_PROD'), secret)
  assert.equal(result.ok, true)
  assert.equal(JSON.stringify(result).includes(secret), false)
  assert.equal(JSON.stringify(result).includes('should-not-be-returned'), false)
  const record = result.state.records.find((entry) => entry.alias === 'github-prod-token')
  assert.equal(record.credential.configured, true)
  assert.equal(readFileSync(f.path, 'utf8').includes(secret), false)
})

test('setCredential rejects empty values and invalid refs without echoing them', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f)
  await assert.rejects(
    () => settings.setCredential({ ref: 'PAT_GITHUB_PROD', value: '' }),
    /must not be empty/,
  )
  const pasted = 'sk-live-pasted-in-value-ref-field-123456'
  await assert.rejects(
    () => settings.setCredential({ ref: pasted, value: 'value' }),
    (error) => {
      assert.match(error.message, /POSIX identifier/)
      assert.equal(error.message.includes(pasted), false)
      return true
    },
  )
})

test('saveConfig persists only validated behavior fields through the editor', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings, edited } = harness(f)
  const result = await settings.saveConfig({
    promptSection: false,
    maxPromptEntriesPerKind: 12,
    allowCrossOriginPat: false,
  })
  assert.deepEqual(result, { restarting: true })
  assert.equal(edited.length, 1)
  assert.equal(edited[0].config.promptSection, false)
  assert.equal(edited[0].config.maxPromptEntriesPerKind, 12)
  assert.equal(edited[0].config.inventoryPath, f.path)
  await assert.rejects(() => settings.saveConfig({ inventoryPath: '/tmp/x' }), /inventoryPath can only/)
  await assert.rejects(() => settings.saveConfig({ maxPromptEntriesPerKind: 0 }), /between 1 and 100/)
  await assert.rejects(() => settings.saveConfig({ sshTimeoutMs: 'fast' }), /finite number/)
})

test('saveConfig reports a missing editor instead of pretending to save', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { editor: false })
  await assert.rejects(() => settings.saveConfig({ promptSection: false }), /config editor is unavailable/)
})

test('routes return JSON errors for malformed, unknown, missing, and read-only actions', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { entry: false })
  const routes = []
  const scope = {
    get(name) {
      if (name !== 'connection') return undefined
      return { fetch: { register(route) { routes.push(route); return async () => {} } } }
    },
  }
  const dispose = registerSettingsRoutes(scope, settings)
  const action = routes.find((route) => route.path.endsWith('/action'))
  const call = (body) => action.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? '{' : JSON.stringify(body),
  }))

  const bad = await call(undefined)
  assert.equal(bad.status, 400)
  assert.equal((await bad.json()).error.code, 'BAD_JSON')

  const unknown = await call({ action: 'nope' })
  assert.equal(unknown.status, 400)
  assert.equal((await unknown.json()).error.code, 'UNKNOWN_ACTION')

  const missing = await call({ action: 'delete-record', kind: 'ssh', alias: 'not-there' })
  assert.equal(missing.status, 404)
  assert.equal((await missing.json()).error.code, 'RECORD_NOT_FOUND')

  const readOnly = await call({ action: 'save-config', config: { promptSection: false } })
  assert.equal(readOnly.status, 409)
  assert.equal((await readOnly.json()).error.code, 'CONFIG_READ_ONLY')
  dispose()
})

test('authenticated routes expose state and actions without secrets', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const { settings } = harness(f, { refs: { SSH_PROD_WEB_KEY: SSH_SECRET } })
  const routes = []
  const scope = {
    get(name) {
      if (name !== 'connection') return undefined
      return {
        fetch: {
          register(route) {
            routes.push(route)
            return async () => {}
          },
        },
      }
    },
  }
  const dispose = registerSettingsRoutes(scope, settings)
  assert.equal(routes.length, 2)
  const stateRoute = routes.find((route) => route.path.endsWith('/state'))
  const actionRoute = routes.find((route) => route.path.endsWith('/action'))
  const stateResponse = await stateRoute.fetch(new Request('http://localhost/api/credential-hub/state'))
  assert.equal(stateResponse.status, 200)
  const statePayload = await stateResponse.json()
  assert.equal(statePayload.ok, true)
  assert.equal(JSON.stringify(statePayload).includes(SSH_SECRET), false)

  const actionResponse = await actionRoute.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'save-record',
      kind: 'pat',
      record: {
        alias: 'new-pat',
        tags: ['env:production'],
        description: '新 PAT',
        credentialRef: 'PAT_NEW',
      },
    }),
  }))
  assert.equal(actionResponse.status, 200)
  const actionPayload = await actionResponse.json()
  assert.equal(actionPayload.ok, true)
  assert.ok(actionPayload.state.records.some((record) => record.alias === 'new-pat'))

  const credentialResponse = await actionRoute.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'set-credential', ref: 'PAT_NEW', value: 'gpat_route_secret_123' }),
  }))
  assert.equal(credentialResponse.status, 200)
  const credentialPayload = await credentialResponse.json()
  assert.equal(credentialPayload.ok, true)
  assert.equal(JSON.stringify(credentialPayload).includes('gpat_route_secret_123'), false)

  const exportResponse = await actionRoute.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'export-bundle', passphrase: 'correct horse battery staple' }),
  }))
  assert.equal(exportResponse.status, 200)
  const exportPayload = await exportResponse.json()
  assert.equal(exportPayload.ok, true)
  assert.equal(JSON.stringify(exportPayload).includes(SSH_SECRET), false)

  const importResponse = await actionRoute.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      action: 'import-bundle',
      bundle: exportPayload.bundle,
      passphrase: 'correct horse battery staple',
      mode: 'merge',
    }),
  }))
  assert.equal(importResponse.status, 200)
  const importPayload = await importResponse.json()
  assert.equal(importPayload.ok, true)
  assert.equal(JSON.stringify(importPayload).includes(SSH_SECRET), false)

  const invalid = await actionRoute.fetch(new Request('http://localhost/api/credential-hub/action', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'save-record', kind: 'ssh', record: { alias: 'x', privateKey: SSH_SECRET } }),
  }))
  assert.equal(invalid.status, 400)
  const invalidPayload = await invalid.json()
  assert.equal(invalidPayload.ok, false)
  assert.equal(JSON.stringify(invalidPayload).includes(SSH_SECRET), false)
  dispose()
})
