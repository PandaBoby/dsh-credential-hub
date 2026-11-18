import { CredentialHubError } from './errors.js'
import { runPatRequest } from './pat.js'
import { runSshCommand } from './ssh.js'

const JSON_RENDER = (_args, value) => [{ type: 'text', text: JSON.stringify(value, null, 2) }]

/**
 * @param {unknown} value
 * @returns {string}
 */
function stringValue(value) {
  return typeof value === 'string' ? value : ''
}

/**
 * Read one configured ref through the credential seam. The returned value is
 * used only by the calling Host-side operation; callers must never place it in
 * a tool result.
 * @param {object} ctx plugin context with `credentials`
 * @param {(value: string) => unknown} credentialRef official brand helper
 * @param {string} ref
 * @param {string} alias
 * @returns {Promise<{value: string, source: string}>}
 */
async function resolveSecret(ctx, credentialRef, ref, alias) {
  let brand
  try {
    brand = credentialRef(ref)
  } catch (error) {
    throw new CredentialHubError('CREDENTIAL_REF_INVALID', `${alias}: credentialRef must be a POSIX identifier such as SSH_PROD_WEB_KEY`)
  }
  let hit
  try {
    hit = await ctx.credentials.resolve(brand)
  } catch {
    // Provider errors may contain provider-specific details; do not expose
    // them through a model-visible tool result.
    throw new CredentialHubError(
      'CREDENTIAL_RESOLVE_FAILED',
      `${alias}: credential resolution failed; check the ref and the credential store`,
    )
  }
  if (hit === undefined || typeof hit.value !== 'string' || hit.value === '') {
    throw new CredentialHubError(
      'CREDENTIAL_NOT_CONFIGURED',
      `${alias}: credentialRef is not configured. Store the value in the DSH credential store (Settings → Account, `
      + 'or ctx.credentials.set) and keep only the ref in the inventory.',
    )
  }
  return hit
}

/**
 * Build every tool definition. `defineTool` and `credentialRef` are injected so
 * the core can be tested with small doubles while production uses the shipped
 * implementations.
 *
 * @param {{
 *   defineTool: (definition: object) => object,
 *   credentialRef: (value: string) => unknown,
 *   hub: import('./hub.js').CredentialHub,
 *   ctx: object,
 *   config: object,
 * }} options
 * @returns {object[]}
 */
export function buildToolDefinitions(options) {
  const { defineTool, credentialRef, hub, ctx, config } = options

  const match = defineTool({
    name: 'credential_hub_match',
    description:
      'Find SSH hosts or PAT tokens in the credential-hub inventory using natural-language clues such as environment, '
      + 'service, platform, alias, or description. Returns metadata only — never a private key or token. '
      + 'Pass the returned alias to credential_hub_ssh_exec or credential_hub_pat_request to use the credential. '
      + 'Returns an empty array when nothing matches.',
    parameters: {
      query: {
        type: 'string',
        required: true,
        description: 'Natural-language clue, e.g. "生产环境 web 日志" or "GitHub 生产令牌".',
      },
      kind: {
        type: 'string',
        enum: ['ssh', 'pat'],
        description: 'Optional filter: ssh for hosts, pat for tokens. Omit to search both inventories.',
      },
    },
    output: {
      schema: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            alias: { type: 'string', required: true },
            kind: { type: 'string', enum: ['ssh', 'pat'], required: true },
            tags: { type: 'array', required: true, items: { type: 'string' } },
            description: { type: 'string', required: true },
            credentialRef: { type: 'string', required: true },
            host: { type: 'string' },
            port: { type: 'integer' },
            username: { type: 'string' },
            platform: { type: 'string' },
            baseUrl: { type: 'string' },
            score: { type: 'number', required: true },
          },
        },
      },
      render: JSON_RENDER,
    },
    async execute(args) {
      const query = stringValue(args.query).trim()
      if (query === '') throw new CredentialHubError('MATCH_QUERY_EMPTY', 'query must not be empty')
      const kind = args.kind === 'ssh' || args.kind === 'pat' ? args.kind : undefined
      // Deliberately metadata-only: this tool never touches ctx.credentials.
      return hub.match(query, kind)
    },
  })

  const resolve = defineTool({
    name: 'credential_hub_resolve',
    description:
      'Report whether a credentialRef is configured and which inventory aliases use it, without returning the value. '
      + 'The value is read only inside credential_hub_ssh_exec and credential_hub_pat_request on the Host. '
      + 'Use this to verify a match before acting; never ask the user for the key or token.',
    parameters: {
      ref: {
        type: 'string',
        required: true,
        description: 'DSH credentialRef, a POSIX identifier such as SSH_PROD_WEB_KEY (not a slash-separated key).',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          ref: { type: 'string', required: true },
          configured: { type: 'boolean', required: true },
          source: { type: 'string' },
          writable: { type: 'boolean' },
          masked: { type: 'string', required: true },
          aliases: { type: 'array', required: true, items: { type: 'string' } },
          kinds: { type: 'array', required: true, items: { type: 'string', enum: ['ssh', 'pat'] } },
        },
      },
      render: JSON_RENDER,
    },
    async execute(args) {
      const raw = stringValue(args.ref).trim()
      if (raw === '') throw new CredentialHubError('RESOLVE_REF_EMPTY', 'ref must not be empty')
      let brand
      try {
        brand = credentialRef(raw)
      } catch (error) {
        throw new CredentialHubError(
          'CREDENTIAL_REF_INVALID',
          'credentialRef must be a POSIX identifier such as SSH_PROD_WEB_KEY',
        )
      }
      let info
      try {
        info = await ctx.credentials.describe(brand)
      } catch {
        // describe() is a convenience; resolve() below is the existence check.
        info = undefined
      }
      let hit
      try {
        hit = await ctx.credentials.resolve(brand)
      } catch {
        throw new CredentialHubError(
          'CREDENTIAL_RESOLVE_FAILED',
          'credential resolution failed; check the ref and the credential store',
        )
      }
      const aliases = hub.findAliasesByRef(raw)
      const kinds = [...new Set(aliases.map((entry) => entry.kind))]
      return {
        ref: raw,
        configured: hit !== undefined && typeof hit.value === 'string' && hit.value !== '',
        ...hit !== undefined && typeof hit.source === 'string' ? { source: hit.source } : {},
        ...info !== undefined && typeof info.writable === 'boolean' ? { writable: info.writable } : {},
        // A fixed mask on purpose: the provider's own `masked` preview can
        // still carry a few real characters, and this tool's contract is
        // metadata only.
        masked: '••••••••',
        aliases: aliases.map((entry) => entry.alias),
        kinds,
      }
    },
  })

  const sshExec = defineTool({
    name: 'credential_hub_ssh_exec',
    description:
      'Run one command on an SSH host from the credential inventory. The private key is resolved from ctx.credentials '
      + 'and written to a 0600 temporary file for the system ssh client; it never enters the command, arguments, or result. '
      + 'Call credential_hub_match first to choose the alias. Returns exit status, stdout, and stderr.',
    parameters: {
      alias: {
        type: 'string',
        required: true,
        description: 'Inventory alias of the SSH host, e.g. prod-web-01 (from credential_hub_match).',
      },
      command: {
        type: 'string',
        required: true,
        description: 'Command to run on the remote host, e.g. "tail -n 20 /var/log/web/app.log".',
      },
      timeoutMs: {
        type: 'number',
        description: 'Command timeout in milliseconds. Defaults to the plugin sshTimeoutMs, capped at 30 minutes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          alias: { type: 'string', required: true },
          host: { type: 'string', required: true },
          port: { type: 'integer', required: true },
          username: { type: 'string', required: true },
          command: { type: 'string', required: true },
          exitCode: { oneOf: [{ type: 'number' }, { type: 'null' }] },
          // runSshCommand reports Node's exitSignal, which is null for every
          // normal exit. Declaring this as string-only made the Host reject
          // the output of *every* successful call, so the model saw only
          // "returned invalid output: value.signal must be a string".
          signal: { oneOf: [{ type: 'string' }, { type: 'null' }] },
          stdout: { type: 'string', required: true },
          stderr: { type: 'string', required: true },
          timedOut: { type: 'boolean', required: true },
          aborted: { type: 'boolean', required: true },
          truncated: { type: 'boolean', required: true },
          durationMs: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const lines = [
          `ssh ${value.alias} (${value.username}@${value.host}:${value.port})`,
          `$ ${value.command}`,
          `exit ${value.exitCode ?? 'null'}${value.signal ? ` (${value.signal})` : ''} in ${value.durationMs} ms`,
        ]
        if (value.timedOut) lines.push('（命令超时，已终止）')
        if (value.truncated) lines.push('（输出超过上限，已截断）')
        if (value.stdout !== '') lines.push(value.stdout)
        if (value.stderr !== '') lines.push(`[stderr]\n${value.stderr}`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const record = hub.findByAlias(stringValue(args.alias))
      if (record === undefined) {
        throw new CredentialHubError('ALIAS_NOT_FOUND', `no inventory record has alias ${JSON.stringify(args.alias)}`)
      }
      if (record.kind !== 'ssh') {
        throw new CredentialHubError('WRONG_KIND', `alias ${record.alias} is a ${record.kind} record, not an SSH host`)
      }
      const command = stringValue(args.command).trim()
      if (command === '') throw new CredentialHubError('SSH_COMMAND_EMPTY', 'command must not be empty')
      const secret = await resolveSecret(ctx, credentialRef, record.credentialRef, record.alias)
      const timeoutMs = Number.isFinite(args.timeoutMs)
        ? Math.max(1_000, Math.min(30 * 60_000, args.timeoutMs))
        : config.sshTimeoutMs
      return runSshCommand({
        record,
        privateKey: secret.value,
        command,
        config: { ...config, sshTimeoutMs: timeoutMs },
        signal: exec.signal,
      })
    },
  })

  const patRequest = defineTool({
    name: 'credential_hub_pat_request',
    description:
      'Send an HTTP request with a PAT from the credential inventory. The token is resolved on the Host and attached as '
      + 'the record\'s configured auth header; it never enters the request URL, tool arguments, or result. '
      + 'Redirects are not followed by default. Call credential_hub_match first to choose the alias. '
      + 'The response body is redacted for the token before it is returned.',
    parameters: {
      alias: {
        type: 'string',
        required: true,
        description: 'Inventory alias of the PAT record, e.g. github-prod-token (from credential_hub_match).',
      },
      path: {
        type: 'string',
        description: 'Path appended to the record baseUrl, e.g. "/repos/acme/web/actions/runs". Omit to request baseUrl itself.',
      },
      url: {
        type: 'string',
        description: 'Absolute URL. Only allowed on the record baseUrl origin unless allowCrossOriginPat is enabled.',
      },
      method: {
        type: 'string',
        enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
        description: 'HTTP method. Defaults to GET.',
      },
      headers: {
        type: 'object',
        additionalProperties: true,
        description: 'Additional request headers. Auth, cookie, and framing headers are supplied by the Host and rejected here.',
      },
      body: {
        type: 'string',
        description: 'Optional request body. Defaults to Content-Type application/json when no content-type header is supplied.',
      },
      timeoutMs: {
        type: 'number',
        description: 'Request timeout in milliseconds. Defaults to the plugin httpTimeoutMs, capped at 5 minutes.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          alias: { type: 'string', required: true },
          method: { type: 'string', required: true },
          url: { type: 'string', required: true },
          status: { type: 'number', required: true },
          statusText: { type: 'string', required: true },
          ok: { type: 'boolean', required: true },
          contentType: { type: 'string', required: true },
          location: { type: 'string' },
          body: { type: 'string', required: true },
          truncated: { type: 'boolean', required: true },
          durationMs: { type: 'number', required: true },
        },
      },
      render: (_args, value) => {
        const lines = [
          `${value.method} ${value.url}`,
          `${value.status} ${value.statusText} in ${value.durationMs} ms`,
        ]
        if (value.location !== undefined) lines.push(`location: ${value.location}`)
        if (value.truncated) lines.push('（响应体超过上限，已截断）')
        if (value.body !== '') lines.push(value.body)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    async execute(args, exec) {
      const record = hub.findByAlias(stringValue(args.alias))
      if (record === undefined) {
        throw new CredentialHubError('ALIAS_NOT_FOUND', `no inventory record has alias ${JSON.stringify(args.alias)}`)
      }
      if (record.kind !== 'pat') {
        throw new CredentialHubError('WRONG_KIND', `alias ${record.alias} is a ${record.kind} record, not a PAT token`)
      }
      const secret = await resolveSecret(ctx, credentialRef, record.credentialRef, record.alias)
      const timeoutMs = Number.isFinite(args.timeoutMs)
        ? Math.max(1_000, Math.min(5 * 60_000, args.timeoutMs))
        : config.httpTimeoutMs
      return runPatRequest({
        record,
        secret: secret.value,
        args: {
          ...(args.path !== undefined ? { path: stringValue(args.path) } : {}),
          ...(args.url !== undefined ? { url: stringValue(args.url) } : {}),
          ...(args.method !== undefined ? { method: stringValue(args.method) } : {}),
          ...(args.headers !== undefined && args.headers !== null ? { headers: args.headers } : {}),
          ...(args.body !== undefined ? { body: stringValue(args.body) } : {}),
        },
        config: { ...config, httpTimeoutMs: timeoutMs },
        signal: exec.signal,
      })
    },
  })

  return [match, resolve, sshExec, patRequest]
}
