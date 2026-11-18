/**
 * Live acceptance run for dsh-credential-hub.
 *
 * This is deliberately end-to-end: a real `dsh --profile ... headless` process
 * loads the installed bundle, a real model chooses the tools, a real `ssh`
 * process authenticates to a local mock SSH server with the key resolved from
 * ctx.credentials, and a real fetch sends the PAT to a local HTTP endpoint.
 *
 * The endpoints are test doubles (no production host or GitHub account is
 * touched), but the routing, credential resolution, and redaction paths are
 * the production paths.
 *
 * Prerequisite:
 *   dsh --profile credhub-test --from-default-profile headless --help
 *   dsh plugin --profile credhub-test add /absolute/path/to/dsh-credential-hub
 *
 * Usage:
 *   npm run test:live
 */
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import ssh2 from 'ssh2'
import { CredentialHub } from '../src/hub.js'
import { registerPrompt } from '../src/prompt.js'
import { isCredentialRefName } from '../src/refs.js'
import { startMockPatServer, startMockSshServer } from './support/mock-servers.mjs'

// This file is intentionally opt-in: test discovery must never start a real DSH
// process or need a model key just because the file lives under test/.
if (!process.argv.includes('--live')) {
  console.log('live scenarios skipped; run `npm run test:live`')
  process.exit(0)
}

const { utils } = ssh2
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const EVIDENCE = join(ROOT, 'docs', 'verification')
const PROFILE = process.env.DSH_TEST_PROFILE ?? 'credhub-test'
const DSH_BIN = process.env.DSH_BIN ?? 'dsh'
// Generated per run so no secret-shaped constant lives in the repository.
const PAT = `gpat_live_${randomBytes(16).toString('hex')}`
const SSH_KEY_PAIR = utils.generateKeyPairSync('ed25519')
const SSH_SECRET = SSH_KEY_PAIR.private
const SSH_PUBLIC = SSH_KEY_PAIR.public

/**
 * @param {string[]} args
 * @param {NodeJS.ProcessEnv} env
 * @param {string} cwd
 * @returns {Promise<{stdout: string, stderr: string, code: number | null, signal: string | null}>}
 */
function run(args, env, cwd) {
  return new Promise((resolveRun) => {
    const child = spawn(DSH_BIN, args, { cwd, env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    const timeout = setTimeout(() => child.kill('SIGTERM'), 8 * 60_000)
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      resolveRun({ stdout, stderr, code, signal })
    })
  })
}

/**
 * @param {string} stdout
 * @returns {object[]}
 */
function parseEvents(stdout) {
  const events = []
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim().startsWith('{')) continue
    try {
      events.push(JSON.parse(line))
    } catch {
      // A non-JSON diagnostic line is kept in the raw transcript.
    }
  }
  return events
}

/**
 * @param {object[]} events
 * @param {string} tool
 * @returns {object[]}
 */
function callsOf(events, tool) {
  return events.filter((event) => event.type === 'tool_call' && event.tool === tool)
}

/**
 * @param {object[]} events
 * @param {string} callId
 * @returns {object | undefined}
 */
function resultOf(events, callId) {
  return events.find((event) => event.type === 'tool_result' && event.callId === callId)
}

/**
 * @param {string[]} texts
 * @param {string} label
 * @param {string[]} secrets
 */
function assertNoSecret(texts, label, secrets) {
  const joined = texts.join('\n')
  for (const secret of secrets) {
    const variants = new Set([
      secret,
      encodeURIComponent(secret),
      Buffer.from(secret, 'utf8').toString('base64'),
    ])
    if (secret.includes('PRIVATE KEY-----')) {
      for (const line of secret.split(/\r?\n/)) {
        const trimmed = line.trim()
        // PEM armor is public formatting, not key material; the body lines are
        // the part that must never appear.
        if (trimmed.length >= 16 && !trimmed.startsWith('-----')) variants.add(trimmed)
      }
    }
    for (const variant of variants) {
      if (joined.includes(variant)) {
        throw new Error(`${label}: leaked secret fragment ${variant.slice(0, 16)}…`)
      }
    }
  }
}

/**
 * @param {object[]} events
 * @param {string} name
 * @returns {string}
 */
function summarizeCall(events, name) {
  const calls = callsOf(events, name)
  if (calls.length === 0) return `(no ${name} call)`
  return calls.map((call) => {
    const result = resultOf(events, call.callId)
    return `${name} ${JSON.stringify(call.input)} -> ${result?.status ?? 'no-result'}: ${String(result?.result ?? '').slice(0, 400)}`
  }).join('\n')
}

async function main() {
  const dir = mkdtempSync(join(tmpdir(), 'credhub-live-'))
  const workspace = join(dir, 'workspace')
  const inventoryPath = join(dir, 'inventory.yml')
  const knownHosts = join(dir, 'known_hosts')
  const patchPath = join(dir, 'patch.yml')
  mkdirSync(workspace, { recursive: true })
  const ssh = await startMockSshServer({ publicKey: SSH_PUBLIC })
  const pat = await startMockPatServer({ token: PAT })
  let scenarioA
  let scenarioB
  try {
    writeFileSync(inventoryPath, `version: 1
ssh:
  - alias: prod-web-01
    tags: ["env:production", "service:web"]
    description: 生产环境 Web 应用主机（本地验收 SSH 端点）
    host: 127.0.0.1
    port: ${ssh.port}
    username: deploy
    credentialRef: SSH_PROD_WEB_KEY
  - alias: staging-db
    tags: ["env:staging", "service:db"]
    description: 测试环境数据库主机（本地验收 SSH 端点）
    host: 127.0.0.1
    port: ${ssh.port}
    username: deploy
    credentialRef: SSH_STAGING_DB_KEY
pat:
  - alias: github-prod-token
    tags: ["platform:github", "env:production"]
    description: GitHub 生产环境令牌（本地验收 HTTP 端点）
    platform: github
    baseUrl: ${pat.baseUrl}
    credentialRef: PAT_GITHUB_PROD
  - alias: github-staging-token
    tags: ["platform:github", "env:staging"]
    description: GitHub 测试环境令牌（本地验收 HTTP 端点）
    platform: github
    baseUrl: ${pat.baseUrl}
    credentialRef: PAT_GITHUB_STAGING
`, { encoding: 'utf8', mode: 0o600 })

    // The headless template disables the local credential store; enable it so
    // DEEPSEEK_API_KEY resolves from the same store the Desktop app uses.
    writeFileSync(patchPath, `- id: credentials
  disabled: false
  config:
    path: ${join(process.env.DSH_HOME ?? join(process.env.HOME ?? '', '.dsh'), '.credentials.yaml')}
- id: credential-hub
  config:
    inventoryPath: ${inventoryPath}
    sshKnownHostsFile: ${knownHosts}
    sshStrictHostKeyChecking: accept-new
`, { encoding: 'utf8' })

    // The model runs in an empty workspace: the acceptance run exercises the
    // installed Host plugin, not the repository's test sources.
    const hub = new CredentialHub({
      inventoryPath,
      maxPromptEntriesPerKind: 20,
      validateRef: isCredentialRefName,
    })
    hub.loadSync({ createIfMissing: false })
    const promptVariables = new Map()
    const promptSections = []
    registerPrompt({
      systemPrompt: {
        variable(name, provider) { promptVariables.set(name, provider); return () => {} },
        section(section) { promptSections.push(section); return () => {} },
      },
    }, hub)
    const promptSection = promptSections[0].text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (match, name) => {
      const provider = promptVariables.get(name)
      return provider === undefined ? match : provider({})
    })
    assertNoSecret([promptSection], 'system prompt section', [SSH_SECRET, PAT])

    const baseEnv = {
      ...process.env,
      DSH_CREDENTIAL_HUB_INVENTORY: inventoryPath,
      SSH_PROD_WEB_KEY: SSH_SECRET,
      SSH_STAGING_DB_KEY: SSH_SECRET,
      PAT_GITHUB_PROD: PAT,
      PAT_GITHUB_STAGING: PAT,
      NO_COLOR: '1',
    }
    const common = ['--profile', PROFILE, '--patch', patchPath, '--permission-mode', 'danger-full-access', '--json']

    process.stdout.write('\n=== scenario A: "去生产环境看下 web 日志" ===\n')
    scenarioA = await run([...common, '去生产环境看下 web 日志'], baseEnv, workspace)
    const eventsA = parseEvents(scenarioA.stdout)
    const matchA = callsOf(eventsA, 'credential_hub_match')
    const sshA = callsOf(eventsA, 'credential_hub_ssh_exec')
    if (matchA.length === 0) throw new Error('scenario A: model did not call credential_hub_match')
    if (!sshA.some((call) => call.input.alias === 'prod-web-01')) {
      throw new Error(`scenario A: no ssh_exec for prod-web-01; calls=${JSON.stringify(sshA)}`)
    }
    if (ssh.commands.length === 0) throw new Error('scenario A: mock SSH server received no command')
    assertNoSecret([scenarioA.stdout, scenarioA.stderr], 'scenario A', [SSH_SECRET, PAT])
    process.stdout.write(`${summarizeCall(eventsA, 'credential_hub_match')}\n${summarizeCall(eventsA, 'credential_hub_ssh_exec')}\n`)
    process.stdout.write(`mock SSH command: ${JSON.stringify(ssh.commands)}\n`)

    process.stdout.write('\n=== scenario B: "用生产令牌查一下 GitHub 仓库状态" ===\n')
    scenarioB = await run([...common, '用生产令牌查一下 GitHub 仓库状态'], baseEnv, workspace)
    const eventsB = parseEvents(scenarioB.stdout)
    const matchB = callsOf(eventsB, 'credential_hub_match')
    const patB = callsOf(eventsB, 'credential_hub_pat_request')
    if (matchB.length === 0) throw new Error('scenario B: model did not call credential_hub_match')
    if (!patB.some((call) => call.input.alias === 'github-prod-token')) {
      throw new Error(`scenario B: no pat_request for github-prod-token; calls=${JSON.stringify(patB)}`)
    }
    if (pat.requests.length === 0) throw new Error('scenario B: mock PAT server received no request')
    const authenticated = pat.requests.some((request) => request.authorization === `Bearer ${PAT}`)
    if (!authenticated) throw new Error('scenario B: mock PAT server did not receive the Bearer token')
    const patResult = patB.map((call) => String(resultOf(eventsB, call.callId)?.result ?? '')).join('\n')
    if (!/"authenticated":true/.test(patResult) || !/"status":"healthy"/.test(patResult)) {
      throw new Error(`scenario B: response did not show the authenticated health result: ${patResult.slice(0, 800)}`)
    }
    assertNoSecret([scenarioB.stdout, scenarioB.stderr], 'scenario B', [SSH_SECRET, PAT])
    process.stdout.write(`${summarizeCall(eventsB, 'credential_hub_match')}\n${summarizeCall(eventsB, 'credential_hub_pat_request')}\n`)
    const publicPatRequests = pat.requests.map((request) => ({
      method: request.method,
      url: request.url,
      authorizationPresent: request.authorization !== undefined,
      authorizationMatches: request.authorization === `Bearer ${PAT}`,
    }))
    process.stdout.write(`mock PAT requests: ${JSON.stringify(publicPatRequests)}\n`)

    process.stdout.write('\n=== scenario C: metadata-only boundary ===\n')
    assertNoSecret([scenarioA.stdout, scenarioA.stderr, scenarioB.stdout, scenarioB.stderr], 'live outputs', [SSH_SECRET, PAT])
    process.stdout.write('PASS: no private-key or PAT fragment appeared in live model/tool output.\n')

    mkdirSync(EVIDENCE, { recursive: true })
    writeFileSync(join(EVIDENCE, 'system-prompt-section.txt'), promptSection, 'utf8')
    writeFileSync(join(EVIDENCE, 'security-scan.txt'), [
      'Secret scan: PASS',
      '',
      'Scanned:',
      '- system prompt section rendered from the same inventory',
      '- scenario A JSONL (model thinking, tool calls, tool results, final text)',
      '- scenario B JSONL (model thinking, tool calls, tool results, final text)',
      '- stderr of both headless runs',
      '',
      'Secret variants: raw SSH private key, PEM body lines, raw PAT, URL-encoded PAT, base64 PAT.',
      'No match was found.',
      '',
    ].join('\n'), 'utf8')
    writeFileSync(join(EVIDENCE, 'scenario-a.jsonl'), scenarioA.stdout, 'utf8')
    writeFileSync(join(EVIDENCE, 'scenario-b.jsonl'), scenarioB.stdout, 'utf8')
    writeFileSync(join(EVIDENCE, 'scenario-a.stderr.txt'), scenarioA.stderr, 'utf8')
    writeFileSync(join(EVIDENCE, 'scenario-b.stderr.txt'), scenarioB.stderr, 'utf8')
    writeFileSync(join(EVIDENCE, 'live-run.json'), JSON.stringify({
      ranAt: new Date().toISOString(),
      profile: PROFILE,
      endpoints: {
        ssh: { port: ssh.port, commands: ssh.commands },
        pat: {
          baseUrl: pat.baseUrl,
          requests: pat.requests.map((request) => ({
            method: request.method,
            url: request.url,
            authorizationPresent: request.authorization !== undefined,
            authorizationMatches: request.authorization === `Bearer ${PAT}`,
          })),
        },
      },
      scenarios: {
        a: { toolCalls: callsOf(eventsA, 'credential_hub_match').length + callsOf(eventsA, 'credential_hub_ssh_exec').length, final: eventsA.find((event) => event.type === 'final')?.text },
        b: { toolCalls: callsOf(eventsB, 'credential_hub_match').length + callsOf(eventsB, 'credential_hub_pat_request').length, final: eventsB.find((event) => event.type === 'final')?.text },
      },
      secretScan: 'PASS',
    }, null, 2), 'utf8')
    process.stdout.write(`\nEvidence written to ${EVIDENCE}\n`)
  } finally {
    await ssh.close()
    await pat.close()
    rmSync(dir, { recursive: true, force: true })
  }
}

main().catch((error) => {
  console.error(`\nlive scenarios FAILED: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
  process.exitCode = 1
})
