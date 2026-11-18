/**
 * One error type for every credential-hub failure. `code` is stable enough for
 * logs and tests; the message is written for the model or the inventory owner
 * and never contains a secret value.
 */
export class CredentialHubError extends Error {
  /**
   * @param {string} code stable failure code, such as INVENTORY_INVALID.
   * @param {string} message actionable, secret-free message.
   * @param {{ cause?: unknown }} [options]
   */
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'CredentialHubError'
    this.code = code
  }
}
