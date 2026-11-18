import { CredentialHubError } from './errors.js'

const STATE_PATH = '/api/credential-hub/state'
const ACTION_PATH = '/api/credential-hub/action'

const BAD_REQUEST_CODES = new Set([
  'INVENTORY_INVALID',
  'RECORD_INVALID',
  'CONFIG_INVALID',
  'INVENTORY_WRITE_FAILED',
  'CREDENTIAL_REF_INVALID',
  'CREDENTIAL_VALUE_EMPTY',
  'CREDENTIAL_VALUE_TOO_LARGE',
  'PASSPHRASE_WEAK',
  'PASSPHRASE_INVALID',
  'BUNDLE_INVALID',
  'BUNDLE_DECRYPT_FAILED',
  'BUNDLE_TOO_LARGE',
])

/**
 * @param {unknown} error
 * @returns {{status: number, body: object}}
 */
function failure(error) {
  const code = error instanceof CredentialHubError ? error.code : 'INTERNAL'
  let status = 500
  if (code === 'RECORD_NOT_FOUND') status = 404
  else if (code === 'CONFIG_READ_ONLY' || code === 'INVENTORY_UNSAFE') status = 409
  else if (BAD_REQUEST_CODES.has(code)) status = 400
  return {
    status,
    body: {
      ok: false,
      error: {
        code,
        message: error instanceof Error ? error.message : String(error),
      },
    },
  }
}

/**
 * @param {unknown} value
 * @param {number} [status]
 * @returns {Response}
 */
function json(value, status = 200) {
  return Response.json(value, {
    status,
    headers: { 'cache-control': 'no-store' },
  })
}

/**
 * Register the authenticated settings routes on the Web connection. The route
 * handler never returns a plaintext credential: state carries presence facts, and the
 * transfer actions return ciphertext or counts only.
 *
 * @param {object} scope context that has `connection`
 * @param {import('./settings.js').CredentialHubSettings} settings
 * @returns {() => void} cleanup for the owning effect
 */
export function registerSettingsRoutes(scope, settings) {
  const connection = scope.get?.('connection') ?? scope.connection
  const register = connection?.fetch?.register
  if (typeof register !== 'function') return () => {}

  const stateDispose = register({
    path: STATE_PATH,
    methods: ['GET'],
    requestBody: 'buffered',
    fetch: async () => {
      try {
        return json(await settings.state())
      } catch (error) {
        const { status, body } = failure(error)
        return json(body, status)
      }
    },
  })

  const actionDispose = register({
    path: ACTION_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: async (request) => {
      let payload
      try {
        payload = await request.json()
      } catch {
        return json({ ok: false, error: { code: 'BAD_JSON', message: 'request body must be JSON' } }, 400)
      }
      if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
        return json({ ok: false, error: { code: 'BAD_JSON', message: 'request body must be a JSON object' } }, 400)
      }
      try {
        if (payload.action === 'save-record') {
          return json(await settings.saveRecord(payload))
        }
        if (payload.action === 'delete-record') {
          return json(await settings.deleteRecord(payload))
        }
        if (payload.action === 'set-credential') {
          return json(await settings.setCredential(payload))
        }
        if (payload.action === 'export-bundle') {
          return json(await settings.exportBundle(payload))
        }
        if (payload.action === 'import-bundle') {
          return json(await settings.importBundle(payload))
        }
        if (payload.action === 'save-config') {
          return json({ ok: true, ...await settings.saveConfig(payload.config) })
        }
        return json({
          ok: false,
          error: {
            code: 'UNKNOWN_ACTION',
            message: 'action must be save-record, delete-record, set-credential, export-bundle, import-bundle, or save-config',
          },
        }, 400)
      } catch (error) {
        const { status, body } = failure(error)
        return json(body, status)
      }
    },
  })

  return () => {
    void stateDispose?.()
    void actionDispose?.()
  }
}

export { ACTION_PATH, STATE_PATH }
