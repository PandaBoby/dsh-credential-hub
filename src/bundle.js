import { createCipheriv, createDecipheriv, randomBytes, scrypt as scryptCallback } from 'node:crypto'
import { promisify } from 'node:util'
import { CredentialHubError } from './errors.js'

const scrypt = promisify(scryptCallback)

const BUNDLE_FORMAT = 'dsh-credential-hub.encrypted'
const PAYLOAD_FORMAT = 'dsh-credential-hub.payload'
const BUNDLE_VERSION = 1
const PAYLOAD_VERSION = 1
const AAD = Buffer.from(`${BUNDLE_FORMAT}.v${BUNDLE_VERSION}`, 'utf8')
const KDF = Object.freeze({ name: 'scrypt', N: 32768, r: 8, p: 1, keyLength: 32, maxmem: 64 * 1024 * 1024 })
const SALT_BYTES = 16
const IV_BYTES = 12
const TAG_BYTES = 16
const MAX_BUNDLE_BYTES = 8 * 1024 * 1024
const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024
const MIN_PASSPHRASE_LENGTH = 8
const MAX_PASSPHRASE_LENGTH = 1024

/**
 * @param {unknown} passphrase
 * @returns {string}
 */
export function validatePassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.length < MIN_PASSPHRASE_LENGTH) {
    throw new CredentialHubError('PASSPHRASE_WEAK', `passphrase must be at least ${MIN_PASSPHRASE_LENGTH} characters`)
  }
  if (passphrase.length > MAX_PASSPHRASE_LENGTH) {
    throw new CredentialHubError('PASSPHRASE_INVALID', 'passphrase is too long')
  }
  return passphrase
}

/**
 * @param {Buffer} buffer
 * @returns {string}
 */
function toBase64(buffer) {
  return buffer.toString('base64')
}

/**
 * @param {unknown} value
 * @param {number | undefined} length exact byte length, or undefined to accept any non-empty value
 * @param {string} field
 * @returns {Buffer}
 */
function fromBase64(value, length, field) {
  if (typeof value !== 'string' || value === '' || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw new CredentialHubError('BUNDLE_INVALID', `${field} must be non-empty base64`)
  }
  const buffer = Buffer.from(value, 'base64')
  if (length !== undefined && buffer.byteLength !== length) {
    throw new CredentialHubError('BUNDLE_INVALID', `${field} has the wrong length`)
  }
  return buffer
}

/**
 * Encrypt one payload. The caller must keep the plaintext in Host memory only;
 * the returned object is safe to hand to the browser or write to a file.
 * @param {object} payload
 * @param {unknown} passphrase
 * @returns {Promise<object>}
 */
export async function encryptBundle(payload, passphrase) {
  const password = validatePassphrase(passphrase)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
    throw new CredentialHubError('BUNDLE_TOO_LARGE', 'the export payload is too large')
  }
  const salt = randomBytes(SALT_BYTES)
  const iv = randomBytes(IV_BYTES)
  const key = await scrypt(password, salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: KDF.maxmem,
  })
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    createdAt: new Date().toISOString(),
    kdf: {
      name: KDF.name,
      N: KDF.N,
      r: KDF.r,
      p: KDF.p,
      salt: toBase64(salt),
    },
    cipher: {
      name: 'aes-256-gcm',
      iv: toBase64(iv),
      tag: toBase64(tag),
    },
    payload: toBase64(ciphertext),
  }
}

/**
 * Decrypt and validate the envelope. The wrong passphrase and a tampered file
 * deliberately produce the same error; neither path returns partial plaintext.
 * @param {unknown} bundle
 * @param {unknown} passphrase
 * @returns {Promise<object>}
 */
export async function decryptBundle(bundle, passphrase) {
  const password = validatePassphrase(passphrase)
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) {
    throw new CredentialHubError('BUNDLE_INVALID', 'file is not a credential-hub bundle')
  }
  if (bundle.format !== BUNDLE_FORMAT || bundle.version !== BUNDLE_VERSION) {
    throw new CredentialHubError('BUNDLE_INVALID', 'unsupported bundle format or version')
  }
  if (Buffer.byteLength(JSON.stringify(bundle), 'utf8') > MAX_BUNDLE_BYTES) {
    throw new CredentialHubError('BUNDLE_TOO_LARGE', 'bundle file is too large')
  }
  const kdf = bundle.kdf
  if (kdf === null || typeof kdf !== 'object'
    || kdf.name !== KDF.name || kdf.N !== KDF.N || kdf.r !== KDF.r || kdf.p !== KDF.p) {
    throw new CredentialHubError('BUNDLE_INVALID', 'unsupported key-derivation parameters')
  }
  const cipher = bundle.cipher
  if (cipher === null || typeof cipher !== 'object' || cipher.name !== 'aes-256-gcm') {
    throw new CredentialHubError('BUNDLE_INVALID', 'unsupported cipher')
  }
  const salt = fromBase64(kdf.salt, SALT_BYTES, 'kdf.salt')
  const iv = fromBase64(cipher.iv, IV_BYTES, 'cipher.iv')
  const tag = fromBase64(cipher.tag, TAG_BYTES, 'cipher.tag')
  const ciphertext = fromBase64(bundle.payload, undefined, 'payload')
  if (ciphertext.byteLength > MAX_BUNDLE_BYTES) {
    throw new CredentialHubError('BUNDLE_TOO_LARGE', 'bundle payload is too large')
  }
  const key = await scrypt(password, salt, KDF.keyLength, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    maxmem: KDF.maxmem,
  })
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAAD(AAD)
  decipher.setAuthTag(tag)
  let plaintext
  try {
    plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()])
  } catch {
    throw new CredentialHubError('BUNDLE_DECRYPT_FAILED', 'wrong passphrase or corrupted bundle')
  }
  if (plaintext.byteLength > MAX_PAYLOAD_BYTES) {
    throw new CredentialHubError('BUNDLE_TOO_LARGE', 'bundle payload is too large')
  }
  let payload
  try {
    payload = JSON.parse(plaintext.toString('utf8'))
  } catch {
    throw new CredentialHubError('BUNDLE_INVALID', 'bundle payload is not valid JSON')
  }
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)
    || payload.format !== PAYLOAD_FORMAT || payload.version !== PAYLOAD_VERSION) {
    throw new CredentialHubError('BUNDLE_INVALID', 'unsupported payload format or version')
  }
  return payload
}

