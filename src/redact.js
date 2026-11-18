/**
 * Build a string redactor for one resolved secret. Tool results and remote
 * command output are model-visible and persisted, so a remote program that
 * echoes a token must not turn a temporary host-side read into a stored leak.
 *
 * The variants cover the ways an upstream service might echo the same value:
 * raw text, URL encoding, Basic base64 (`user:secret`), and the individual body
 * lines of a PEM private key (a shell error often prints one line, not the
 * whole file).
 *
 * @param {string} secret
 * @param {string} [username] used for the Basic variant
 * @returns {(text: string) => string}
 */
export function createRedactor(secret, username) {
  const variants = new Set()
  const add = (value) => {
    if (typeof value === 'string' && value !== '' && value !== '••••••••') variants.add(value)
  }
  add(secret)
  if (secret !== '') {
    try {
      add(encodeURIComponent(secret))
      add(Buffer.from(secret, 'utf8').toString('base64'))
    } catch {
      // Buffer/encodeURIComponent cannot fail for a string, but redaction must
      // never be the reason a tool call throws.
    }
    if (typeof username === 'string' && username !== '') {
      try {
        add(`${username}:${secret}`)
        add(Buffer.from(`${username}:${secret}`, 'utf8').toString('base64'))
        add(encodeURIComponent(`${username}:${secret}`))
      } catch {
        // See above.
      }
    }
    if (secret.includes('PRIVATE KEY-----')) {
      for (const line of secret.split(/\r?\n/)) {
        const trimmed = line.trim()
        // Short structural lines are not secret on their own; redacting them
        // would make every failure message unreadable.
        if (trimmed.length >= 16) add(trimmed)
      }
    }
  }
  const ordered = [...variants].sort((left, right) => right.length - left.length)
  return (text) => {
    let out = String(text ?? '')
    for (const variant of ordered) out = out.split(variant).join('••••••••')
    return out
  }
}
