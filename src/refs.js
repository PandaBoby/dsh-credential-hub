/**
 * The official `credentialRef` grammar, repeated here so the inventory can be
 * validated without importing a Host package (tests and tooling run outside a
 * loaded Harness). `index.js` passes `isCredentialRefName` from
 * `@deepseek-ai/dsh-credentials` at runtime, so production validation follows
 * the installed package rather than this copy.
 */
export const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/

/**
 * @param {unknown} value
 * @returns {value is string}
 */
export function isCredentialRefName(value) {
  return typeof value === 'string' && CREDENTIAL_REF_PATTERN.test(value)
}

/**
 * Explain the grammar without echoing the rejected input. A user can paste a
 * secret-shaped value into the ref field by mistake; a helpful validator must
 * not copy it into an error message, a screenshot, or a network response.
 *
 * The slash form in the design brief (`ssh/prod-web-key`) is a credential
 * *key* shape, not a credential reference; the reference is the
 * environment-variable-shaped name the store resolves.
 * @returns {string}
 */
export function credentialRefGrammarHint() {
  return 'credentialRef must be a POSIX identifier like SSH_PROD_WEB_KEY '
    + `(matching ${String(CREDENTIAL_REF_PATTERN)}); slash-separated names are credential keys, not refs, `
    + 'and ctx.credentials.resolve() would reject them.'
}
