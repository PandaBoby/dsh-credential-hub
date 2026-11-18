import assert from 'node:assert/strict'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { buildToolDefinitions } from '../src/tools.js'
import {
  assertMatchesSchema,
  brandRef,
  fakeCtx,
  fixture,
  identityDefineTool,
  PAT,
  SAMPLE_INVENTORY,
  SSH_KEY,
  SSH_SECRET,
  tempDir,
} from './helpers.mjs'

/**
 * @param {object} f fixture
 * @param {Record<string, string>} refs
 * @param {object} [configOverrides]
 * @returns {Map<string, object>}
 */
function toolsFor(f, refs, configOverrides = {}) {
  const config = { ...f.config, ...configOverrides }
  const definitions = buildToolDefinitions({
    defineTool: identityDefineTool,
    credentialRef: brandRef,
    hub: f.hub,
    ctx: fakeCtx(refs),
    config,
  })
  return new Map(definitions.map((definition) => [definition.name, definition]))
}

const signal = () => new AbortController().signal

test('match returns metadata for scenario A and never reads credentials', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  let credentialReads = 0
  const ctx = {
    credentials: {
      async resolve() { credentialReads += 1; return undefined },
      async describe() { credentialReads += 1; return { configured: false, writable: false } },
    },
  }
  const definitions = buildToolDefinitions({
    defineTool: identityDefineTool,
    credentialRef: brandRef,
    hub: f.hub,
    ctx,
    config: f.config,
  })
  const match = definitions.find((definition) => definition.name === 'credential_hub_match')
  const result = await match.execute({ query: '去生产环境看下 web 日志' }, { signal: signal() })
  assert.equal(Array.isArray(result), true)
  assert.equal(result[0].alias, 'prod-web-01')
  assert.equal(JSON.stringify(result).includes(SSH_SECRET), false)
  assert.equal(credentialReads, 0)
})

test('match returns an empty array when nothing is anchored', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, {})
  assert.deepEqual(await tools.get('credential_hub_match').execute({ query: 'kubernetes dashboard' }, { signal: signal() }), [])
})

test('match rejects an empty query', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, {})
  await assert.rejects(
    () => tools.get('credential_hub_match').execute({ query: '   ' }, { signal: signal() }),
    /query must not be empty/,
  )
})

test('resolve reports existence and a fixed mask, never the value', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, { SSH_PROD_WEB_KEY: SSH_SECRET })
  const result = await tools.get('credential_hub_resolve').execute({ ref: 'SSH_PROD_WEB_KEY' }, { signal: signal() })
  assert.equal(result.ref, 'SSH_PROD_WEB_KEY')
  assert.equal(result.configured, true)
  assert.equal(result.source, 'test')
  assert.equal(result.writable, true)
  assert.equal(result.masked, '••••••••')
  assert.deepEqual(result.aliases, ['prod-web-01'])
  assert.deepEqual(result.kinds, ['ssh'])
  assert.equal(JSON.stringify(result).includes(SSH_SECRET), false)
  assert.equal(JSON.stringify(result).includes('should-not-be-returned'), false)
})

test('resolve reports an unconfigured ref without throwing', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, {})
  const result = await tools.get('credential_hub_resolve').execute({ ref: 'SSH_PROD_WEB_KEY' }, { signal: signal() })
  assert.equal(result.configured, false)
  assert.equal(result.masked, '••••••••')
  assert.deepEqual(result.aliases, ['prod-web-01'])
})

test('resolve errors never echo a secret-shaped ref', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, {})
  const pasted = 'sk-live-pasted-in-ref-field-123456'
  await assert.rejects(
    () => tools.get('credential_hub_resolve').execute({ ref: pasted }, { signal: signal() }),
    (error) => {
      assert.match(error.message, /POSIX identifier/)
      assert.equal(error.message.includes(pasted), false)
      return true
    },
  )
})

test('resolve rejects a slash-shaped key with the ref grammar error', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, {})
  await assert.rejects(
    () => tools.get('credential_hub_resolve').execute({ ref: 'ssh/prod-web-key' }, { signal: signal() }),
    /POSIX identifier such as SSH_PROD_WEB_KEY/,
  )
})

test('ssh_exec uses the resolved key, cleans it up, and redacts echoed key material', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const marker = join(f.dir, 'ssh-seen.json')
  const fakeSsh = join(f.dir, 'fake-ssh.sh')
  writeFileSync(fakeSsh, `#!/bin/sh
key=""
host=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -i) key="$2"; shift 2 ;;
    -p|-l|-o|-F) shift 2 ;;
    *) host="$1"; shift; break ;;
  esac
done
printf '{"key":"%s","host":"%s"}\\n' "$key" "$host" > '${marker}'
mode=$(stat -c '%a' "$key" 2>/dev/null || stat -f '%Lp' "$key" 2>/dev/null)
printf 'key_mode=%s\\n' "$mode"
printf 'fake log line 1\\n'
cat "$key"
exit 0
`, { encoding: 'utf8', mode: 0o700 })
  chmodSync(fakeSsh, 0o700)
  const tools = toolsFor(f, { SSH_PROD_WEB_KEY: SSH_SECRET }, { sshBinary: fakeSsh })
  const result = await tools.get('credential_hub_ssh_exec').execute(
    { alias: 'prod-web-01', command: 'tail -n 2 /var/log/web/app.log' },
    { signal: signal() },
  )
  assert.equal(result.alias, 'prod-web-01')
  assert.equal(result.exitCode, 0)
  assert.match(result.stdout, /fake log line 1/)
  assert.match(result.stdout, /key_mode=600/)
  assert.equal(result.stdout.includes('BEGIN OPENSSH'), false)
  assert.equal(result.stdout.includes('b3BlbnNzaC1rZXkt'), false)
  assert.match(result.stdout, /••••••••/)
  const seen = JSON.parse(readFileSync(marker, 'utf8'))
  assert.ok(seen.key.startsWith(f.dir) || seen.key.includes('dsh-credential-hub-'))
  assert.equal(existsSync(seen.key), false, 'temporary key must be removed')
  assert.equal(seen.host, '127.0.0.1')
})

test('ssh_exec refuses a PAT ref and an unknown alias', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = toolsFor(f, { SSH_PROD_WEB_KEY: PAT })
  await assert.rejects(
    () => tools.get('credential_hub_ssh_exec').execute(
      { alias: 'prod-web-01', command: 'true' },
      { signal: signal() },
    ),
    /not an OpenSSH\/PEM private key/,
  )
  await assert.rejects(
    () => tools.get('credential_hub_ssh_exec').execute(
      { alias: 'nope', command: 'true' },
      { signal: signal() },
    ),
    /no inventory record has alias/,
  )
})

test('PAT request attaches the secret Host-side and redacts an echoing response', async (t) => {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({
      url: request.url,
      authorization: request.headers.authorization,
      cookie: request.headers.cookie,
    })
    if (request.headers.authorization !== `Bearer ${PAT}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ authenticated: false }))
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      authenticated: true,
      repo: 'acme/web',
      status: 'healthy',
      token: PAT,
      tokenUrlEncoded: encodeURIComponent(PAT),
      tokenBase64: Buffer.from(PAT).toString('base64'),
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const address = server.address()
  const baseUrl = `http://127.0.0.1:${address.port}`
  const inventory = SAMPLE_INVENTORY.replaceAll('http://127.0.0.1:18080', baseUrl)
  const f = fixture(inventory, { allowLoopbackHttp: true })
  t.after(f.dispose)
  const tools = toolsFor(f, { PAT_GITHUB_PROD: PAT }, { allowLoopbackHttp: true })
  const result = await tools.get('credential_hub_pat_request').execute(
    { alias: 'github-prod-token', path: '/repos/acme/web' },
    { signal: signal() },
  )
  assert.equal(result.status, 200)
  assert.equal(result.ok, true)
  assert.match(result.body, /"authenticated":true/)
  assert.match(result.body, /"status":"healthy"/)
  assert.equal(result.body.includes(PAT), false)
  assert.equal(result.body.includes(encodeURIComponent(PAT)), false)
  assert.equal(result.body.includes(Buffer.from(PAT).toString('base64')), false)
  assert.match(result.body, /••••••••/)
  assert.equal(requests.length, 1)
  assert.equal(requests[0].authorization, `Bearer ${PAT}`)
  assert.equal(requests[0].cookie, undefined)
  assert.equal(JSON.stringify(result).includes(PAT), false)
  assertMatchesSchema(tools.get('credential_hub_pat_request').output.schema, result, 'pat_request')
})

test('PAT request refuses cross-origin URLs and injected auth headers', async (t) => {
  let evilRequests = 0
  const evil = createServer((_request, response) => {
    evilRequests += 1
    response.end('stolen')
  })
  await new Promise((resolve) => evil.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => evil.close(resolve)))
  const evilUrl = `http://127.0.0.1:${evil.address().port}/steal`

  let goodRequests = 0
  const good = createServer((_request, response) => {
    goodRequests += 1
    response.end('{}')
  })
  await new Promise((resolve) => good.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => good.close(resolve)))
  const baseUrl = `http://127.0.0.1:${good.address().port}`
  const inventory = SAMPLE_INVENTORY.replaceAll('http://127.0.0.1:18080', baseUrl)
  const f = fixture(inventory)
  t.after(f.dispose)
  const tools = toolsFor(f, { PAT_GITHUB_PROD: PAT })

  await assert.rejects(
    () => tools.get('credential_hub_pat_request').execute(
      { alias: 'github-prod-token', url: evilUrl },
      { signal: signal() },
    ),
    /refusing to send its PAT/,
  )
  assert.equal(evilRequests, 0)

  await assert.rejects(
    () => tools.get('credential_hub_pat_request').execute(
      { alias: 'github-prod-token', path: '/repos/acme/web', headers: { authorization: 'Bearer attacker' } },
      { signal: signal() },
    ),
    /managed by the credential hub/,
  )
  assert.equal(goodRequests, 0)

  await assert.rejects(
    () => tools.get('credential_hub_pat_request').execute(
      { alias: 'github-prod-token', path: '/repos/acme/web', headers: { host: 'evil.example' } },
      { signal: signal() },
    ),
    /managed by the credential hub/,
  )
  assert.equal(goodRequests, 0)
})

test('PAT redirects are returned, not followed', async (t) => {
  let evilRequests = 0
  const evil = createServer((_request, response) => {
    evilRequests += 1
    response.end('stolen')
  })
  await new Promise((resolve) => evil.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => evil.close(resolve)))

  const good = createServer((_request, response) => {
    response.writeHead(302, { location: `http://127.0.0.1:${evil.address().port}/steal` })
    response.end()
  })
  await new Promise((resolve) => good.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => good.close(resolve)))
  const baseUrl = `http://127.0.0.1:${good.address().port}`
  const inventory = SAMPLE_INVENTORY.replaceAll('http://127.0.0.1:18080', baseUrl)
  const f = fixture(inventory)
  t.after(f.dispose)
  const tools = toolsFor(f, { PAT_GITHUB_PROD: PAT })
  const result = await tools.get('credential_hub_pat_request').execute(
    { alias: 'github-prod-token', path: '/redirect' },
    { signal: signal() },
  )
  assert.equal(result.status, 302)
  assert.equal(result.ok, false)
  assert.match(result.location, /steal/)
  assert.equal(evilRequests, 0)
})

test('PAT request without baseUrl requires https', async (t) => {
  const inventory = SAMPLE_INVENTORY.replace('    baseUrl: http://127.0.0.1:18080\n', '')
  const f = fixture(inventory)
  t.after(f.dispose)
  const tools = toolsFor(f, { PAT_GITHUB_PROD: PAT })
  await assert.rejects(
    () => tools.get('credential_hub_pat_request').execute(
      { alias: 'github-prod-token', url: 'http://127.0.0.1:9/x' },
      { signal: signal() },
    ),
    /must use an https URL/,
  )
})

test('tool results satisfy their declared output schemas', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const okSsh = join(f.dir, 'ok-ssh.sh')
  writeFileSync(okSsh, '#!/bin/sh\nprintf "app log line\\n"\nexit 0\n', { encoding: 'utf8', mode: 0o700 })
  chmodSync(okSsh, 0o700)
  // Terminating itself makes Node report exitCode:null / signal:'SIGTERM', the
  // other half of the ssh_exec result contract.
  const killedSsh = join(f.dir, 'killed-ssh.sh')
  writeFileSync(killedSsh, '#!/bin/sh\nkill -TERM $$\n', { encoding: 'utf8', mode: 0o700 })
  chmodSync(killedSsh, 0o700)

  const tools = toolsFor(
    f,
    { SSH_PROD_WEB_KEY: SSH_SECRET, SSH_STAGING_DB_KEY: SSH_SECRET },
    { sshBinary: okSsh },
  )

  const matched = await tools.get('credential_hub_match').execute({ query: '生产 web' }, { signal: signal() })
  assertMatchesSchema(tools.get('credential_hub_match').output.schema, matched, 'match')

  const resolved = await tools.get('credential_hub_resolve').execute({ ref: 'SSH_PROD_WEB_KEY' }, { signal: signal() })
  assertMatchesSchema(tools.get('credential_hub_resolve').output.schema, resolved, 'resolve')

  const ran = await tools.get('credential_hub_ssh_exec').execute(
    { alias: 'prod-web-01', command: 'true' },
    { signal: signal() },
  )
  assert.equal(ran.signal, null)
  assert.equal(ran.exitCode, 0)
  assertMatchesSchema(tools.get('credential_hub_ssh_exec').output.schema, ran, 'ssh_exec (exit 0)')

  const killed = await toolsFor(f, { SSH_PROD_WEB_KEY: SSH_SECRET }, { sshBinary: killedSsh })
    .get('credential_hub_ssh_exec')
    .execute({ alias: 'prod-web-01', command: 'true' }, { signal: signal() })
  assert.equal(killed.exitCode, null)
  assert.equal(killed.signal, 'SIGTERM')
  assertMatchesSchema(tools.get('credential_hub_ssh_exec').output.schema, killed, 'ssh_exec (signalled)')
})
