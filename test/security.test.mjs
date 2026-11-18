import assert from 'node:assert/strict'
import { chmodSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { createRedactor } from '../src/redact.js'
import { registerPrompt } from '../src/prompt.js'
import { buildToolDefinitions } from '../src/tools.js'
import { resolvePatUrl } from '../src/pat.js'
import {
  brandRef,
  fakeCtx,
  fixture,
  identityDefineTool,
  interpolate,
  PAT,
  SAMPLE_INVENTORY,
  SSH_KEY,
  SSH_SECRET,
} from './helpers.mjs'

function secretVariants(secret) {
  const variants = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64')]
  if (secret.includes('PRIVATE KEY-----')) {
    for (const line of secret.split(/\r?\n/)) {
      const trimmed = line.trim()
      if (trimmed.length >= 16) variants.push(trimmed)
    }
  }
  return variants
}

function assertNoSecrets(label, value, secrets) {
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  for (const secret of secrets) {
    for (const variant of secretVariants(secret)) {
      assert.equal(text.includes(variant), false, `${label} leaked a secret fragment (${variant.slice(0, 12)}…)`)
    }
  }
}

test('redactor covers raw, URL-encoded, base64, and PEM lines', () => {
  const redact = createRedactor(SSH_KEY, 'deploy')
  const output = redact(`raw=${SSH_KEY}\nurl=${encodeURIComponent(SSH_KEY)}\nb64=${Buffer.from(SSH_KEY).toString('base64')}`)
  for (const variant of secretVariants(SSH_KEY)) assert.equal(output.includes(variant), false)
  assert.match(output, /••••••••/)
})

test('prompt, match, resolve, SSH, and PAT outputs contain no secret value', async (t) => {
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      authenticated: request.headers.authorization === `Bearer ${PAT}`,
      token: PAT,
      tokenBase64: Buffer.from(PAT).toString('base64'),
    }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise((resolve) => server.close(resolve)))
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  const inventory = SAMPLE_INVENTORY.replaceAll('http://127.0.0.1:18080', baseUrl)
  const f = fixture(inventory)
  t.after(f.dispose)

  const fakeSsh = join(f.dir, 'fake-ssh.sh')
  writeFileSync(fakeSsh, `#!/bin/sh
key=""
while [ "$#" -gt 0 ]; do
  case "$1" in
    -i) key="$2"; shift 2 ;;
    -p|-l|-o|-F) shift 2 ;;
    *) shift; break ;;
  esac
done
cat "$key"
`, { encoding: 'utf8', mode: 0o700 })
  chmodSync(fakeSsh, 0o700)

  const ctx = fakeCtx({ SSH_PROD_WEB_KEY: SSH_SECRET, PAT_GITHUB_PROD: PAT })
  const variables = new Map()
  const sections = []
  registerPrompt({
    systemPrompt: {
      variable(name, provider) { variables.set(name, provider); return () => {} },
      section(section) { sections.push(section); return () => {} },
    },
  }, f.hub)
  const prompt = interpolate(sections[0].text, Object.fromEntries(
    [...variables].map(([name, provider]) => [name, provider({})]),
  ))
  assertNoSecrets('prompt', prompt, [SSH_SECRET, PAT])

  const tools = new Map(buildToolDefinitions({
    defineTool: identityDefineTool,
    credentialRef: brandRef,
    hub: f.hub,
    ctx,
    config: { ...f.config, sshBinary: fakeSsh, allowLoopbackHttp: true },
  }).map((definition) => [definition.name, definition]))
  const signal = new AbortController().signal

  const matchA = await tools.get('credential_hub_match').execute({ query: '去生产环境看下 web 日志' }, { signal })
  const matchB = await tools.get('credential_hub_match').execute({ query: '用生产令牌查一下 GitHub 仓库状态' }, { signal })
  assertNoSecrets('match A', matchA, [SSH_SECRET, PAT])
  assertNoSecrets('match B', matchB, [SSH_SECRET, PAT])

  const resolved = await tools.get('credential_hub_resolve').execute({ ref: 'SSH_PROD_WEB_KEY' }, { signal })
  assertNoSecrets('resolve', resolved, [SSH_SECRET, PAT])
  assert.equal(resolved.masked, '••••••••')

  const ssh = await tools.get('credential_hub_ssh_exec').execute(
    { alias: 'prod-web-01', command: 'cat /var/log/web/app.log' },
    { signal },
  )
  assertNoSecrets('ssh result', ssh, [SSH_SECRET, PAT])
  assert.match(ssh.stdout, /••••••••/)

  const pat = await tools.get('credential_hub_pat_request').execute(
    { alias: 'github-prod-token', path: '/repos/acme/web' },
    { signal },
  )
  assertNoSecrets('pat result', pat, [SSH_SECRET, PAT])
  assert.match(pat.body, /"authenticated":true/)
})

test('errors raised by tools do not contain the resolved secret', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const tools = new Map(buildToolDefinitions({
    defineTool: identityDefineTool,
    credentialRef: brandRef,
    hub: f.hub,
    ctx: fakeCtx({ SSH_PROD_WEB_KEY: PAT }),
    config: f.config,
  }).map((definition) => [definition.name, definition]))
  await assert.rejects(
    () => tools.get('credential_hub_ssh_exec').execute(
      { alias: 'prod-web-01', command: 'true' },
      { signal: new AbortController().signal },
    ),
    (error) => {
      assert.equal(error.message.includes(PAT), false)
      return true
    },
  )
})


test('provider errors do not leak into model-visible tool errors', async (t) => {
  const f = fixture()
  t.after(f.dispose)
  const leaked = `provider detail ${PAT}`
  const ctx = {
    credentials: {
      async resolve() { throw new Error(leaked) },
      async describe() { throw new Error(leaked) },
    },
  }
  const tools = new Map(buildToolDefinitions({
    defineTool: identityDefineTool,
    credentialRef: brandRef,
    hub: f.hub,
    ctx,
    config: f.config,
  }).map((definition) => [definition.name, definition]))
  const signal = new AbortController().signal
  for (const [name, args] of [
    ['credential_hub_resolve', { ref: 'SSH_PROD_WEB_KEY' }],
    ['credential_hub_ssh_exec', { alias: 'prod-web-01', command: 'true' }],
    ['credential_hub_pat_request', { alias: 'github-prod-token', path: '/repos/acme/web' }],
  ]) {
    await assert.rejects(
      () => tools.get(name).execute(args, { signal }),
      (error) => {
        assert.equal(error.message.includes(PAT), false)
        assert.equal(error.message.includes('provider detail'), false)
        assert.match(error.message, /credential resolution failed/)
        return true
      },
    )
  }
})

test('allowLoopbackHttp=false rejects loopback plain HTTP even for a local record', () => {
  const record = {
    alias: 'local-dev',
    platform: 'local',
    baseUrl: 'http://127.0.0.1:18080',
    authScheme: 'bearer',
    credentialRef: 'PAT_LOCAL',
  }
  assert.throws(
    () => resolvePatUrl(record, { path: '/health' }, { allowLoopbackHttp: false, allowCrossOriginPat: false }),
    /allowLoopbackHttp is false/,
  )
  assert.equal(
    resolvePatUrl(record, { path: '/health' }, { allowLoopbackHttp: true, allowCrossOriginPat: false }).href,
    'http://127.0.0.1:18080/health',
  )
})
