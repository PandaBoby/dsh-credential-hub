/**
 * Local, deterministic endpoints for the live acceptance run.
 *
 * These are test doubles, not production services: the goal is to prove that a
 * real `ssh` process authenticates with the key the Host resolved and that a
 * real HTTP request carries the PAT, without sending either secret to a third
 * party. The SSH server accepts only the generated public key; the HTTP server
 * reports whether the Authorization header matched.
 */
import { createServer } from 'node:http'
import ssh2 from 'ssh2'

const { Server, utils } = ssh2

/**
 * @param {string} publicKey OpenSSH public key line.
 * @param {Buffer} data public key blob presented by the client.
 * @param {string} algo algorithm name presented by the client.
 * @returns {boolean}
 */
function acceptsKey(publicKey, data, algo) {
  const parsed = utils.parseKey(publicKey)
  if (parsed instanceof Error) return false
  return parsed.type === algo && parsed.getPublicSSH().equals(data)
}


const WEB_APP_LOG = [
  '2026-11-18T09:00:01Z INFO  web-1 request GET /health 200 3ms',
  '2026-11-18T09:00:02Z INFO  web-1 request GET /api/orders 200 12ms',
  '2026-11-18T09:00:03Z WARN  web-1 upstream latency 850ms',
]
const WEB_ERROR_LOG = [
  '2026-11-18T09:00:04Z ERROR web-1 upstream timeout route=/api/orders',
]

/**
 * A tiny command interpreter, not a shell. It keeps the acceptance transcript
 * readable: asking for a log returns a log, asking for a count returns a count.
 * @param {string} command
 * @param {string} username
 * @returns {string[]}
 */
function simulateSshCommand(command, username) {
  const output = []
  for (const raw of command.split(/\s*(?:;|&&|\|\|)\s*/)) {
    const segment = raw.trim()
    if (segment === '') continue
    if (/^true$|^:$/.test(segment)) continue
    if (/\bhostname\b/.test(segment)) {
      output.push('prod-web-01')
    } else if (/^\s*(whoami|id)\b/.test(segment)) {
      output.push(username)
    } else if (/^\s*date\b/.test(segment)) {
      output.push('Tue Nov 18 09:00:00 UTC 2026')
    } else if (/^\s*ls\b/.test(segment)) {
      output.push('-rw-r----- 1 deploy deploy 48213 Nov 18 09:00 /var/log/web/app.log')
      output.push('-rw-r----- 1 deploy deploy 12044 Nov 18 09:00 /var/log/web/error.log')
    } else if (/^\s*stat\b/.test(segment)) {
      output.push('48213 /var/log/web/app.log')
      output.push('12044 /var/log/web/error.log')
    } else if (/^\s*wc\b/.test(segment)) {
      output.push('      42 /var/log/web/app.log')
      output.push('       1 /var/log/web/error.log')
    } else if (/^\s*grep\s+-c\b/.test(segment)) {
      output.push(/ERROR/.test(segment) ? '1' : '4')
    } else if (/^\s*grep\b/.test(segment)) {
      output.push(...(/error\.log|ERROR/.test(segment) ? WEB_ERROR_LOG : WEB_APP_LOG.filter((line) => /WARN|ERROR/.test(line))))
    } else if (/^\s*(tail|head|cat|less|journalctl)\b/.test(segment)) {
      output.push(...(/error\.log|ERROR/.test(segment) ? WEB_ERROR_LOG : WEB_APP_LOG))
    } else if (/^\s*echo\b/.test(segment)) {
      const value = segment.replace(/^\s*echo\s+/, '').replace(/^['"]|['"]$/g, '')
      output.push(value)
    } else if (/^\s*printf\b/.test(segment)) {
      output.push('A', 'B', 'C')
    } else {
      output.push(`mock ssh: unsupported command: ${segment}`)
    }
  }
  return output
}

/**
 * Start a one-user SSH server that accepts public-key auth and answers every
 * exec request with a small fake web log.
 * @param {{ publicKey: string, hostKey?: string }} options
 * @returns {Promise<{port: number, commands: Array<{command: string, user: string}>, close: () => Promise<void>}>}
 */
export async function startMockSshServer(options) {
  const hostKey = options.hostKey ?? utils.generateKeyPairSync('ed25519').private
  const commands = []
  const server = new Server({ hostKeys: [hostKey] }, (client) => {
    let username = ''
    client.on('authentication', (context) => {
      if (context.method !== 'publickey') {
        context.reject(['publickey'])
        return
      }
      if (!acceptsKey(options.publicKey, context.key.data, context.key.algo)) {
        context.reject(['publickey'])
        return
      }
      if (context.signature === undefined) {
        // Tell the client the key is acceptable so it can sign the request.
        context.accept()
        return
      }
      username = context.username
      context.accept()
    })
    client.on('session', (accept) => {
      const session = accept()
      session.on('exec', (acceptExec, _rejectExec, info) => {
        const stream = acceptExec()
        commands.push({ command: info.command, user: username })
        for (const line of simulateSshCommand(info.command, username)) stream.write(`${line}\n`)
        stream.exit(0)
        stream.end()
      })
      session.on('shell', (acceptShell) => {
        const stream = acceptShell()
        stream.write('mock shell is not interactive in this test\n')
        stream.exit(0)
        stream.end()
      })
    })
    client.on('error', () => {})
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    port: server.address().port,
    commands,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}

/**
 * Start an HTTP endpoint that requires `Authorization: Bearer <token>` and
 * echoes the token back in its JSON body. Echoing is intentional: the tool's
 * redaction must hold even against a hostile or careless upstream.
 * @param {{ token: string }} options
 * @returns {Promise<{baseUrl: string, requests: Array<{url: string, authorization?: string, method: string}>, close: () => Promise<void>}>}
 */
export async function startMockPatServer(options) {
  const requests = []
  const server = createServer((request, response) => {
    requests.push({
      method: request.method ?? 'GET',
      url: request.url ?? '/',
      authorization: request.headers.authorization,
    })
    if (request.headers.authorization !== `Bearer ${options.token}`) {
      response.writeHead(401, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ authenticated: false, repo: 'acme/web', status: 'unauthorized' }))
      return
    }
    const path = request.url ?? '/'
    let payload
    if (path === '/user') {
      payload = { authenticated: true, login: 'acme-bot', repo: 'acme/web', status: 'healthy' }
    } else if (path === '/repos/acme/web') {
      payload = {
        authenticated: true,
        full_name: 'acme/web',
        private: false,
        default_branch: 'main',
        open_issues_count: 0,
        status: 'healthy',
      }
    } else if (path === '/repos/acme/web/actions/runs') {
      payload = {
        authenticated: true,
        repo: 'acme/web',
        status: 'healthy',
        total_count: 1,
        workflow_runs: [{ name: 'ci', status: 'completed', conclusion: 'success' }],
      }
    } else if (path === '/repos/acme/web/issues') {
      payload = { authenticated: true, repo: 'acme/web', status: 'healthy', total_count: 0, issues: [] }
    } else {
      payload = {
        authenticated: true,
        repo: 'acme/web',
        status: 'healthy',
        openIssues: 0,
        lastRun: 'success',
        tokenEcho: options.token,
        tokenEchoBase64: Buffer.from(options.token).toString('base64'),
      }
    }
    response.writeHead(200, { 'content-type': 'application/json' })
    response.end(JSON.stringify(payload))
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  return {
    baseUrl: `http://127.0.0.1:${server.address().port}`,
    requests,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  }
}
