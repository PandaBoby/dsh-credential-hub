import assert from 'node:assert/strict'
import { statSync, writeFileSync } from 'node:fs'
import { test } from 'node:test'
import {
  buildSummaries,
  normalizeInventory,
  parseInventory,
  readInventorySync,
  renderInventorySummary,
} from '../src/inventory.js'
import { CredentialHubError } from '../src/errors.js'
import { fixture, SAMPLE_INVENTORY, tempDir } from './helpers.mjs'

test('normalizes the sample inventory and applies SSH port defaults', () => {
  const inventory = parseInventory(SAMPLE_INVENTORY)
  assert.equal(inventory.version, 1)
  assert.equal(inventory.ssh.length, 2)
  assert.equal(inventory.pat.length, 2)
  assert.deepEqual(inventory.ssh[0].tags, ['env:production', 'service:web'])
  assert.equal(inventory.ssh[0].kind, 'ssh')
  assert.equal(inventory.ssh[0].port, 2222)
  assert.equal(inventory.pat[0].authScheme, 'bearer')
  assert.equal(inventory.pat[0].baseUrl, 'http://127.0.0.1:18080/')
  assert.ok(Object.isFrozen(inventory))
  assert.ok(Object.isFrozen(inventory.ssh[0]))
})

test('missing tags are rejected rather than guessed', () => {
  assert.throws(
    () => parseInventory(`version: 1\nssh:\n  - alias: a\n    description: d\n    host: h\n    username: u\n    credentialRef: A_KEY\n`),
    (error) => error instanceof CredentialHubError
      && error.code === 'INVENTORY_INVALID'
      && /ssh\[0\]\.tags is required/.test(error.message),
  )
})

test('slash-shaped references are rejected with the POSIX grammar explanation', () => {
  assert.throws(
    () => parseInventory(`version: 1
ssh:
  - alias: prod-web-01
    tags: ["env:production"]
    description: 生产环境
    host: 10.0.0.1
    username: deploy
    credentialRef: ssh/prod-web-key
`),
    (error) => error instanceof CredentialHubError
      && /POSIX identifier like SSH_PROD_WEB_KEY/.test(error.message)
      && !error.message.includes('ssh/prod-web-key'),
  )
})

test('a secret pasted into the inventory is rejected without echoing its value', () => {
  const secret = 'sk-live-SHOULD-NOT-APPEAR'
  let message = ''
  try {
    parseInventory(`version: 1
ssh:
  - alias: prod-web-01
    tags: ["env:production"]
    description: 生产环境
    host: 10.0.0.1
    username: deploy
    credentialRef: SSH_PROD_WEB_KEY
    privateKey: ${secret}
`)
  } catch (error) {
    message = error.message
  }
  assert.match(message, /secret-like field/)
  assert.match(message, /never secret values/)
  assert.equal(message.includes(secret), false)
})

test('aliases are unique across both inventories', () => {
  assert.throws(
    () => parseInventory(`version: 1
ssh:
  - alias: same
    tags: []
    description: ssh
    host: 10.0.0.1
    username: deploy
    credentialRef: SSH_KEY_A
pat:
  - alias: same
    tags: []
    description: pat
    credentialRef: PAT_A
`),
    /already used|aliases are unique/,
  )
})

test('hosts and usernames cannot be parsed as ssh options', () => {
  assert.throws(
    () => parseInventory(`version: 1
ssh:
  - alias: bad
    tags: []
    description: bad
    host: -oProxyCommand=evil
    username: deploy
    credentialRef: SSH_KEY_A
`),
    /host must be a hostname or IP address/,
  )
  assert.throws(
    () => parseInventory(`version: 1
ssh:
  - alias: bad2
    tags: []
    description: bad
    host: 10.0.0.1
    username: -oProxyCommand=evil
    credentialRef: SSH_KEY_A
`),
    /username must be an SSH login name/,
  )
})

test('PAT baseUrl cannot carry embedded credentials, a query, or a fragment', () => {
  const base = (suffix) => `version: 1\npat:\n  - alias: t\n    tags: []\n    description: d\n    credentialRef: PAT_A\n    baseUrl: ${suffix}\n`
  assert.throws(() => parseInventory(base('https://user:pass@example.com')), /must not embed credentials/)
  assert.throws(() => parseInventory(base('https://example.com/api?token=abc')), /must not contain a query or fragment/)
  assert.throws(() => parseInventory(base('https://example.com/api#frag')), /must not contain a query or fragment/)
})

test('basic auth requires a username and header auth requires headerName', () => {
  assert.throws(
    () => parseInventory(`version: 1\npat:\n  - alias: t\n    tags: []\n    description: d\n    credentialRef: PAT_A\n    authScheme: basic\n`),
    /username is required when authScheme is basic/,
  )
  assert.throws(
    () => parseInventory(`version: 1\npat:\n  - alias: t\n    tags: []\n    description: d\n    credentialRef: PAT_A\n    authScheme: header\n`),
    /headerName is required when authScheme is header/,
  )
})

test('summaries contain metadata only and escape prompt braces', () => {
  const inventory = normalizeInventory({
    version: 1,
    ssh: [{
      alias: 'prod-web-01',
      tags: ['env:production', 'service:web'],
      description: '生产环境 Web {{danger}} 主机',
      host: '10.0.0.10',
      port: 22,
      username: 'deploy',
      credentialRef: 'SSH_PROD_WEB_KEY',
    }],
    pat: [],
  })
  const summaries = buildSummaries(inventory, 20)
  assert.match(summaries.sshInventorySummary, /prod-web-01/)
  assert.match(summaries.sshInventorySummary, /env:production, service:web/)
  assert.match(summaries.sshInventorySummary, /credentialRef: SSH_PROD_WEB_KEY/)
  assert.match(summaries.sshInventorySummary, /\{ \{danger\} \}/)
  assert.equal(summaries.sshInventorySummary.includes('10.0.0.10'), false)
  assert.equal(summaries.sshInventorySummary.includes('deploy'), false)
  assert.match(summaries.patInventorySummary, /未配置 PAT/)
})

test('summary truncation reports the omitted count', () => {
  const records = Array.from({ length: 3 }, (_, index) => ({
    alias: `host-${index}`,
    tags: [], description: `host ${index}`, credentialRef: `REF_${index}`,
  }))
  const text = renderInventorySummary(records, 'ssh', 2)
  assert.match(text, /host-0/)
  assert.match(text, /host-1/)
  assert.equal(text.includes('host-2'), false)
  assert.match(text, /另有 1 条/)
})

test('inventory creation is 0600 and an owner-only file stays usable', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX mode assertion')
  const temp = tempDir()
  t.after(temp.dispose)
  const path = `${temp.dir}/inventory.yml`
  const loaded = readInventorySync(path, { createIfMissing: true })
  assert.equal(loaded.created, true)
  assert.equal(statSync(path).mode & 0o777, 0o600)
  assert.equal(loaded.inventory.ssh.length, 0)
  const again = readInventorySync(path, { createIfMissing: true })
  assert.equal(again.created, false)
})

test('YAML parser errors cite line numbers without echoing source content', () => {
  const secret = 'sk-mistake-DO-NOT-LEAK-123456'
  let message = ''
  try {
    parseInventory(`version: 1
ssh:
  - alias: [${secret}
    description: d
`)
  } catch (error) {
    message = error.message
  }
  assert.match(message, /invalid YAML/)
  assert.match(message, /line \d+/)
  assert.equal(message.includes(secret), false)
})

test('a broken edit keeps the last good prompt snapshot and fails tool reads', (t) => {
  const f = fixture()
  t.after(f.dispose)
  assert.match(f.hub.summaries().sshInventorySummary, /prod-web-01/)
  writeFileSync(f.path, 'version: 1\nssh: "not-an-array"\n', { encoding: 'utf8' })
  const summary = f.hub.summaries().sshInventorySummary
  assert.match(summary, /prod-web-01/)
  assert.match(summary, /最近一次修改无法解析/)
  assert.throws(() => f.hub.match('生产环境', undefined), /ssh must be an array/)
})
