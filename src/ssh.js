import { spawn } from 'node:child_process'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CredentialHubError } from './errors.js'
import { createRedactor } from './redact.js'

/**
 * A private key must look like a PEM/OpenSSH private key. This catches the
 * common mistake of pointing an SSH record at a PAT ref before OpenSSH prints
 * a confusing "invalid format" error, and it keeps a non-key value out of the
 * temp-file path entirely.
 * @param {string} value
 * @returns {boolean}
 */
export function looksLikePrivateKey(value) {
  return /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(value)
    && /-----END (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/.test(value)
}

/**
 * @param {NodeJS.ReadableStream | null} stream
 * @param {number} limit
 * @param {(chunk: string) => void}
 * @param {() => void}
 * @returns {void}
 */
function collect(stream, limit, onChunk, onTruncate) {
  let bytes = 0
  let truncated = false
  stream?.on('data', (chunk) => {
    if (truncated) return
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))
    const remaining = limit - bytes
    if (remaining <= 0) {
      truncated = true
      onTruncate()
      return
    }
    if (buffer.byteLength > remaining) {
      onChunk(buffer.subarray(0, remaining).toString('utf8'))
      bytes = limit
      truncated = true
      onTruncate()
      return
    }
    bytes += buffer.byteLength
    onChunk(buffer.toString('utf8'))
  })
}

/**
 * Run one command through the system OpenSSH client.
 *
 * The key is written to a private temporary directory and passed with `-i`;
 * it never appears in argv, the environment, or the tool result. The result's
 * stdout/stderr are redacted as a second line of defense, because a remote
 * command can echo whatever it wants.
 *
 * @param {{
 *   record: object,
 *   privateKey: string,
 *   command: string,
 *   config: object,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<{
 *   alias: string,
 *   host: string,
 *   port: number,
 *   username: string,
 *   command: string,
 *   exitCode: number | null,
 *   signal: string | null,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean,
 *   aborted: boolean,
 *   truncated: boolean,
 *   durationMs: number,
 * }>}
 */
export async function runSshCommand(options) {
  const { record, privateKey, command, config, signal } = options
  if (!looksLikePrivateKey(privateKey)) {
    throw new CredentialHubError(
      'SSH_CREDENTIAL_NOT_A_KEY',
      `credentialRef for ${record.alias} resolved to a value that is not an OpenSSH/PEM private key. `
      + 'Check that the ref points at a private key, not a PAT or password.',
    )
  }
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }

  const redact = createRedactor(privateKey, record.username)
  const started = Date.now()
  const directory = mkdtempSync(join(tmpdir(), 'dsh-credential-hub-'))
  const keyPath = join(directory, 'id_key')
  try {
    if (process.platform !== 'win32') chmodSync(directory, 0o700)
    writeFileSync(keyPath, privateKey.endsWith('\n') ? privateKey : `${privateKey}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    })
    if (process.platform !== 'win32') chmodSync(keyPath, 0o600)

    const args = [
      '-o', 'BatchMode=yes',
      '-o', `StrictHostKeyChecking=${config.sshStrictHostKeyChecking}`,
      '-o', 'IdentitiesOnly=yes',
      '-o', 'PasswordAuthentication=no',
      '-o', 'KbdInteractiveAuthentication=no',
      '-o', `ConnectTimeout=${Math.max(1, Math.ceil(config.sshConnectTimeoutMs / 1000))}`,
      '-i', keyPath,
      '-p', String(record.port),
      '-l', record.username,
    ]
    if (config.sshConfigFile !== '') args.unshift('-F', config.sshConfigFile)
    if (config.sshKnownHostsFile !== '') args.push('-o', `UserKnownHostsFile=${config.sshKnownHostsFile}`)
    // The host was validated as an option-free hostname/IP at inventory load,
    // so it cannot be parsed as another ssh flag.
    args.push(record.host, command)

    const child = spawn(config.sshBinary, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        ...process.env,
        // BatchMode already prevents prompts; these make an accidental askpass
        // helper fail closed instead of hanging a background tool call.
        SSH_ASKPASS_REQUIRE: 'never',
        GIT_TERMINAL_PROMPT: '0',
      },
    })

    let stdout = ''
    let stderr = ''
    let truncated = false
    let timedOut = false
    let aborted = false
    const markTruncated = () => { truncated = true }
    collect(child.stdout, config.maxOutputBytes, (chunk) => { stdout += chunk }, markTruncated)
    collect(child.stderr, config.maxOutputBytes, (chunk) => { stderr += chunk }, markTruncated)

    const timeout = setTimeout(() => {
      timedOut = true
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 2_000)
      force.unref?.()
    }, config.sshTimeoutMs)
    timeout.unref?.()

    const onAbort = () => {
      aborted = true
      child.kill('SIGTERM')
      const force = setTimeout(() => child.kill('SIGKILL'), 2_000)
      force.unref?.()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    try {
      const result = await new Promise((resolvePromise, rejectPromise) => {
        child.once('error', (error) => {
          rejectPromise(new CredentialHubError(
            'SSH_UNAVAILABLE',
            `could not start the OpenSSH client (${config.sshBinary}): ${String(error?.message ?? error)}`,
          ))
        })
        child.once('close', (exitCode, exitSignal) => {
          resolvePromise({ exitCode, exitSignal })
        })
      })
      if (aborted) {
        throw signal?.reason instanceof Error ? signal.reason : new Error('aborted')
      }
      return {
        alias: record.alias,
        host: record.host,
        port: record.port,
        username: record.username,
        command,
        exitCode: result.exitCode,
        signal: result.exitSignal,
        stdout: redact(stdout),
        stderr: redact(stderr),
        timedOut,
        aborted,
        truncated,
        durationMs: Date.now() - started,
      }
    } finally {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
