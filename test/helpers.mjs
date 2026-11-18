import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { resolveConfig } from '../src/config.js'
import { CredentialHub } from '../src/hub.js'
import { isCredentialRefName } from '../src/refs.js'

export const SSH_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtz
c2gtZWQyNTUxOQAAACDxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
-----END OPENSSH PRIVATE KEY-----
`

export const PAT = 'pat_test_abcdefghijklmnopqrstuvwxyz012345'
export const SSH_SECRET = SSH_KEY

export const SAMPLE_INVENTORY = `version: 1
ssh:
  - alias: prod-web-01
    tags: ["env:production", "service:web"]
    description: 生产环境 Web 应用主机
    host: 127.0.0.1
    port: 2222
    username: deploy
    credentialRef: SSH_PROD_WEB_KEY
  - alias: staging-db
    tags: ["env:staging", "service:db"]
    description: 测试环境数据库主机
    host: 127.0.0.1
    port: 2223
    username: deploy
    credentialRef: SSH_STAGING_DB_KEY
pat:
  - alias: github-prod-token
    tags: ["platform:github", "env:production"]
    description: GitHub 生产环境令牌
    platform: github
    baseUrl: http://127.0.0.1:18080
    credentialRef: PAT_GITHUB_PROD
  - alias: github-staging-token
    tags: ["platform:github", "env:staging"]
    description: GitHub 测试环境令牌
    platform: github
    baseUrl: http://127.0.0.1:18080
    credentialRef: PAT_GITHUB_STAGING
`

/**
 * Create a temporary directory that the caller removes with its `dispose`.
 * @returns {{dir: string, dispose: () => void}}
 */
export function tempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'credhub-test-'))
  return {
    dir,
    dispose: () => rmSync(dir, { recursive: true, force: true }),
  }
}

/**
 * Write one inventory file into a fresh temp directory and return a configured
 * hub plus its cleanup.
 * @param {string} [text]
 * @param {object} [configOverrides]
 * @returns {{dir: string, path: string, hub: CredentialHub, config: object, dispose: () => void}}
 */
export function fixture(text = SAMPLE_INVENTORY, configOverrides = {}) {
  const temp = tempDir()
  const path = join(temp.dir, 'inventory.yml')
  writeFileSync(path, text, { encoding: 'utf8', mode: 0o600 })
  const config = resolveConfig({ inventoryPath: path, ...configOverrides })
  const hub = new CredentialHub({
    inventoryPath: path,
    maxPromptEntriesPerKind: config.maxPromptEntriesPerKind,
    validateRef: isCredentialRefName,
  })
  hub.loadSync({ createIfMissing: false })
  return {
    dir: temp.dir,
    path,
    hub,
    config,
    dispose: temp.dispose,
  }
}

/**
 * Minimal brand helper with the official grammar, so tool tests exercise the
 * same rejection branch production uses.
 * @param {string} value
 * @returns {string}
 */
export function brandRef(value) {
  if (!isCredentialRefName(value)) {
    throw new TypeError(`credential ref "${value}" must match /^[A-Za-z_][A-Za-z0-9_]*$`)
  }
  return value
}

/**
 * A ctx double with only the services the tool definitions use.
 * @param {Record<string, string>} refs
 * @returns {object}
 */
export function fakeCtx(refs) {
  return {
    credentials: {
      async resolve(ref) {
        const value = refs[ref]
        return value === undefined ? undefined : { value, source: 'test' }
      },
      async describe(ref) {
        return {
          configured: refs[ref] !== undefined,
          writable: true,
          ...refs[ref] !== undefined ? { masked: 'should-not-be-returned' } : {},
        }
      },
    },
  }
}

/**
 * A defineTool double. The real implementation validates schemas; these tests
 * exercise the execute bodies and tool metadata, not the registry.
 * @param {object} definition
 * @returns {object}
 */
export function identityDefineTool(definition) {
  return definition
}

/**
 * Replace prompt variables in a section text the way the renderer does.
 * @param {string} text
 * @param {Record<string, string>} variables
 * @returns {string}
 */
export function interpolate(text, variables) {
  return text.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (_match, name) => {
    if (variables[name] === undefined) throw new Error(`unresolved prompt variable ${name}`)
    return variables[name]
  })
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Collect schema violations for one value, using only the dialect the Host's
 * tool registry understands: `type`, `oneOf`, `properties`, a per-property
 * boolean `required`, `additionalProperties: false`, `items`, and `enum`.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} path
 * @returns {string[]}
 */
function schemaErrors(schema, value, path) {
  const errors = []
  if (schema === undefined) return errors

  if (Array.isArray(schema.oneOf)) {
    const matching = schema.oneOf.filter((branch) => schemaErrors(branch, value, path).length === 0)
    if (matching.length !== 1) {
      errors.push(`${path}: expected exactly one matching oneOf branch, matched ${matching.length}`)
      return errors
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
    errors.push(`${path}: ${JSON.stringify(value)} is not one of ${JSON.stringify(schema.enum)}`)
  }

  switch (schema.type) {
    case 'null':
      if (value !== null) errors.push(`${path}: expected null, got ${typeof value}`)
      break
    case 'string':
      if (typeof value !== 'string') errors.push(`${path}: expected string, got ${typeof value}`)
      break
    case 'boolean':
      if (typeof value !== 'boolean') errors.push(`${path}: expected boolean, got ${typeof value}`)
      break
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push(`${path}: expected number, got ${typeof value}`)
      break
    case 'integer':
      if (!Number.isInteger(value)) errors.push(`${path}: expected integer, got ${typeof value}`)
      break
    case 'array':
      if (!Array.isArray(value)) {
        errors.push(`${path}: expected array, got ${typeof value}`)
        break
      }
      value.forEach((item, index) => {
        errors.push(...schemaErrors(schema.items, item, `${path}[${index}]`))
      })
      break
    case 'object': {
      if (!isPlainObject(value)) {
        errors.push(`${path}: expected object, got ${Array.isArray(value) ? 'array' : typeof value}`)
        break
      }
      const properties = schema.properties ?? {}
      for (const [name, propertySchema] of Object.entries(properties)) {
        if (value[name] === undefined) {
          if (propertySchema.required === true) errors.push(`${path}.${name}: required`)
          continue
        }
        errors.push(...schemaErrors(propertySchema, value[name], `${path}.${name}`))
      }
      if (schema.additionalProperties === false) {
        for (const name of Object.keys(value)) {
          if (value[name] === undefined) continue
          if (!Object.hasOwn(properties, name)) errors.push(`${path}.${name}: additional property`)
        }
      }
      break
    }
    default:
      break
  }
  return errors
}

/**
 * Assert a tool result satisfies its declared output schema.
 *
 * The unit tests call `execute()` directly, so they never run the Host's
 * registry validation. Without this check a schema can be stricter than the
 * actual return value (e.g. `signal: {type:'string'}` against `signal: null`)
 * and every live call fails with "returned invalid output" while the suite
 * stays green.
 * @param {object} schema
 * @param {unknown} value
 * @param {string} [label]
 * @returns {void}
 */
export function assertMatchesSchema(schema, value, label = 'output') {
  const errors = schemaErrors(schema, value, '$')
  if (errors.length > 0) throw new Error(`${label} does not match its declared schema:\n  ${errors.join('\n  ')}`)
}
