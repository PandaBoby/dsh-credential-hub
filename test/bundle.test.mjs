import assert from 'node:assert/strict'
import { test } from 'node:test'
import { decryptBundle, encryptBundle, validatePassphrase } from '../src/bundle.js'

const PAYLOAD = {
  format: 'dsh-credential-hub.payload',
  version: 1,
  inventory: { version: 1, ssh: [], pat: [] },
  credentials: { SSH_PROD_WEB_KEY: '-----BEGIN OPENSSH PRIVATE KEY-----\nsecret\n' },
}

test('encrypts and decrypts a payload without leaving plaintext in the envelope', async () => {
  const bundle = await encryptBundle(PAYLOAD, 'correct horse battery staple')
  const serialized = JSON.stringify(bundle)
  assert.equal(serialized.includes('BEGIN OPENSSH'), false)
  assert.equal(serialized.includes('secret'), false)
  assert.equal(bundle.format, 'dsh-credential-hub.encrypted')
  assert.equal(bundle.cipher.name, 'aes-256-gcm')
  assert.equal(bundle.kdf.name, 'scrypt')
  const restored = await decryptBundle(bundle, 'correct horse battery staple')
  assert.deepEqual(restored, PAYLOAD)
})

test('a wrong passphrase fails generically', async () => {
  const bundle = await encryptBundle(PAYLOAD, 'correct horse battery staple')
  await assert.rejects(
    () => decryptBundle(bundle, 'not the passphrase'),
    (error) => {
      assert.equal(error.code, 'BUNDLE_DECRYPT_FAILED')
      assert.equal(error.message.includes('secret'), false)
      return true
    },
  )
})

test('tampering with the ciphertext or tag is rejected', async () => {
  const bundle = await encryptBundle(PAYLOAD, 'correct horse battery staple')
  const tampered = { ...bundle, payload: Buffer.from('different bytes').toString('base64') }
  await assert.rejects(() => decryptBundle(tampered, 'correct horse battery staple'), /wrong passphrase or corrupted/)
  const badTag = { ...bundle, cipher: { ...bundle.cipher, tag: Buffer.alloc(16, 1).toString('base64') } }
  await assert.rejects(() => decryptBundle(badTag, 'correct horse battery staple'), /wrong passphrase or corrupted/)
})

test('weak passphrases and unsupported KDF parameters are rejected', async () => {
  await assert.rejects(() => encryptBundle(PAYLOAD, 'short'), /at least 8/)
  assert.throws(() => validatePassphrase(123), /at least 8/)
  const bundle = await encryptBundle(PAYLOAD, 'correct horse battery staple')
  const unsupported = { ...bundle, kdf: { ...bundle.kdf, N: 1024 } }
  await assert.rejects(() => decryptBundle(unsupported, 'correct horse battery staple'), /key-derivation/)
})

test('invalid envelopes are rejected without parsing plaintext', async () => {
  await assert.rejects(() => decryptBundle(null, 'correct horse battery staple'), /not a credential-hub bundle/)
  await assert.rejects(() => decryptBundle({}, 'correct horse battery staple'), /unsupported bundle/)
  await assert.rejects(() => decryptBundle({ format: 'x', version: 1 }, 'correct horse battery staple'), /unsupported bundle/)
})
