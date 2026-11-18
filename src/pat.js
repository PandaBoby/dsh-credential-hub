import { isLoopbackHostname } from './config.js'
import { CredentialHubError } from './errors.js'
import { createRedactor } from './redact.js'

const SENSITIVE_REQUEST_HEADERS = new Set([
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'private-token',
  // Framing headers are owned by fetch; accepting them from the model would
  // let a call desynchronize the request framing.
  'host',
  'content-length',
  'connection',
  'transfer-encoding',
  'te',
  'trailer',
  'upgrade',
])

/**
 * @param {Record<string, unknown>} headers
 * @param {string | undefined} configuredHeader
 * @returns {Record<string, string>}
 */
function normalizeRequestHeaders(headers, configuredHeader) {
  if (headers === undefined) return {}
  if (headers === null || typeof headers !== 'object' || Array.isArray(headers)) {
    throw new CredentialHubError('PAT_HEADERS_INVALID', 'headers must be an object of string values')
  }
  const result = {}
  const configured = configuredHeader?.toLowerCase()
  for (const [rawName, rawValue] of Object.entries(headers)) {
    const name = String(rawName).trim()
    if (name === '') throw new CredentialHubError('PAT_HEADERS_INVALID', 'header names must be non-empty')
    const lower = name.toLowerCase()
    if (SENSITIVE_REQUEST_HEADERS.has(lower) || lower === configured) {
      throw new CredentialHubError(
        'PAT_HEADERS_INVALID',
        `header "${name}" is managed by the credential hub and cannot be supplied in tool arguments`,
      )
    }
    if (typeof rawValue !== 'string') {
      throw new CredentialHubError('PAT_HEADERS_INVALID', `header "${name}" must have a string value`)
    }
    result[lower] = rawValue
  }
  return result
}

/**
 * @param {string} secret
 * @param {object} record
 * @returns {{name: string, value: string}}
 */
function authHeader(secret, record) {
  const scheme = record.authScheme ?? 'bearer'
  if (scheme === 'bearer') {
    return { name: (record.headerName ?? 'Authorization'), value: `Bearer ${secret}` }
  }
  if (scheme === 'token') {
    return { name: (record.headerName ?? 'Authorization'), value: `token ${secret}` }
  }
  if (scheme === 'basic') {
    const username = record.username
    if (typeof username !== 'string' || username === '') {
      throw new CredentialHubError('PAT_CONFIG_INVALID', `${record.alias}: authScheme basic needs a username in the inventory`)
    }
    return {
      name: (record.headerName ?? 'Authorization'),
      value: `Basic ${Buffer.from(`${username}:${secret}`, 'utf8').toString('base64')}`,
    }
  }
  if (scheme === 'header') {
    if (typeof record.headerName !== 'string' || record.headerName === '') {
      throw new CredentialHubError('PAT_CONFIG_INVALID', `${record.alias}: authScheme header needs headerName in the inventory`)
    }
    return { name: record.headerName, value: secret }
  }
  throw new CredentialHubError('PAT_CONFIG_INVALID', `${record.alias}: unsupported authScheme ${String(scheme)}`)
}

/**
 * Resolve the request URL and enforce the origin policy before the secret is
 * attached. A PAT must not follow a model-supplied URL to an unrelated host.
 * @param {object} record
 * @param {{url?: string, path?: string}} args
 * @param {object} config
 * @returns {URL}
 */
export function resolvePatUrl(record, args, config) {
  let target
  if (args.url !== undefined && args.path !== undefined) {
    throw new CredentialHubError('PAT_URL_INVALID', 'pass either url or path, not both')
  }
  if (args.url !== undefined) {
    try {
      target = new URL(args.url)
    } catch {
      throw new CredentialHubError('PAT_URL_INVALID', 'url must be an absolute URL')
    }
  } else if (record.baseUrl !== undefined) {
    try {
      target = new URL(args.path ?? '', record.baseUrl)
    } catch {
      throw new CredentialHubError('PAT_URL_INVALID', `${record.alias}: path cannot be resolved against baseUrl`)
    }
  } else {
    throw new CredentialHubError(
      'PAT_URL_REQUIRED',
      `${record.alias} has no baseUrl in the inventory; pass an absolute https URL`,
    )
  }
  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new CredentialHubError('PAT_URL_INVALID', 'only http and https URLs are supported')
  }
  if (target.username !== '' || target.password !== '') {
    throw new CredentialHubError('PAT_URL_INVALID', 'URLs must not embed credentials')
  }
  if (target.protocol === 'http:'
    && (config.allowLoopbackHttp === false || !isLoopbackHostname(target.hostname))) {
    throw new CredentialHubError(
      'PAT_INSECURE_HTTP',
      config.allowLoopbackHttp === false
        ? 'refusing to send a PAT over plain HTTP: allowLoopbackHttp is false'
        : `refusing to send a PAT to ${target.origin} over plain HTTP; use https or a loopback address`,
    )
  }
  if (record.baseUrl !== undefined && !config.allowCrossOriginPat) {
    const base = new URL(record.baseUrl)
    if (target.origin !== base.origin) {
      throw new CredentialHubError(
        'PAT_CROSS_ORIGIN',
        `${record.alias} is scoped to ${base.origin}; refusing to send its PAT to ${target.origin}. `
        + 'Set allowCrossOriginPat only if this redirect of trust is intentional.',
      )
    }
  }
  if (record.baseUrl === undefined && target.protocol !== 'https:') {
    throw new CredentialHubError('PAT_INSECURE_HTTP', 'a PAT record without baseUrl must use an https URL')
  }
  return target
}

/**
 * Read at most `limit` bytes from a fetch body; binary data is decoded as UTF-8
 * with replacement because the tool's canonical value is JSON text.
 * @param {Response} response
 * @param {number} limit
 * @returns {Promise<{text: string, truncated: boolean}>}
 */
async function readBoundedBody(response, limit) {
  if (response.body === null) return { text: '', truncated: false }
  const reader = response.body.getReader()
  const chunks = []
  let bytes = 0
  let truncated = false
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value === undefined) continue
      const remaining = limit - bytes
      if (remaining <= 0) {
        truncated = true
        await reader.cancel()
        break
      }
      if (value.byteLength > remaining) {
        chunks.push(value.subarray(0, remaining))
        bytes = limit
        truncated = true
        await reader.cancel()
        break
      }
      chunks.push(value)
      bytes += value.byteLength
    }
  } finally {
    reader.releaseLock?.()
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString('utf8'),
    truncated,
  }
}

/**
 * Perform one HTTP request with a PAT attached on the Host side.
 *
 * Redirects are not followed by default: fetch's `follow` would forward the
 * Authorization header to another origin. The response body is redacted with
 * the token variants before it can reach the model or the session log.
 *
 * @param {{
 *   record: object,
 *   secret: string,
 *   args: {url?: string, path?: string, method?: string, headers?: object, body?: string, timeoutMs?: number},
 *   config: object,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<object>}
 */
export async function runPatRequest(options) {
  const { record, secret, args, config, signal } = options
  const method = (args.method ?? 'GET').toUpperCase()
  const url = resolvePatUrl(record, args, config)
  if (signal?.aborted === true) {
    throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
  }
  if (args.body !== undefined && (method === 'GET' || method === 'HEAD')) {
    throw new CredentialHubError('PAT_BODY_INVALID', `method ${method} cannot carry a body`)
  }

  const auth = authHeader(secret, record)
  const headers = normalizeRequestHeaders(args.headers, auth.name)
  headers[auth.name.toLowerCase()] = auth.value
  headers['user-agent'] = 'dsh-credential-hub/0.2.0'
  if (args.body !== undefined && headers['content-type'] === undefined) {
    headers['content-type'] = 'application/json'
  }

  const timeoutMs = args.timeoutMs ?? config.httpTimeoutMs
  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error(`HTTP request timed out after ${timeoutMs} ms`))
  }, timeoutMs)
  timer.unref?.()
  const onAbort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', onAbort, { once: true })
  const started = Date.now()
  try {
    let response
    try {
      response = await fetch(url, {
        method,
        headers,
        ...args.body !== undefined ? { body: args.body } : {},
        redirect: config.followRedirects ? 'follow' : 'manual',
        signal: controller.signal,
      })
    } catch (error) {
      if (signal?.aborted === true) {
        throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
      }
      if (timedOut) {
        throw new CredentialHubError(
          'PAT_TIMEOUT',
          `request to ${url.origin} timed out after ${timeoutMs} ms`,
        )
      }
      const message = error instanceof Error ? error.message : String(error)
      throw new CredentialHubError('PAT_REQUEST_FAILED', `request to ${url.origin} failed: ${message}`)
    }
    if (signal?.aborted === true) {
      throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
    }
    let body
    try {
      body = await readBoundedBody(response, config.maxHttpResponseBytes)
    } catch (error) {
      if (timedOut) {
        throw new CredentialHubError('PAT_TIMEOUT', `reading the response from ${url.origin} timed out after ${timeoutMs} ms`)
      }
      if (signal?.aborted === true) {
        throw signal.reason instanceof Error ? signal.reason : new Error('aborted')
      }
      throw error
    }
    const redact = createRedactor(secret, record.username)
    return {
      alias: record.alias,
      method,
      url: redact(response.url || url.href),
      status: response.status,
      statusText: redact(response.statusText),
      ok: response.ok,
      contentType: redact(response.headers.get('content-type') ?? ''),
      ...response.headers.get('location') !== null
        ? { location: redact(response.headers.get('location') ?? '') }
        : {},
      body: redact(body.text),
      truncated: body.truncated,
      durationMs: Date.now() - started,
    }
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', onAbort)
  }
}
