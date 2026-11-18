import { homedir } from 'node:os'
import { isAbsolute, resolve } from 'node:path'

/** The harness home the shipped credential store uses. */
export function harnessHome() {
  const configured = process.env.DSH_HOME
  return configured !== undefined && configured !== '' ? configured : resolve(homedir(), '.dsh')
}

/** Default inventory path: `<harness home>/credential-hub/inventory.yml`. */
export function defaultInventoryPath() {
  return resolve(harnessHome(), 'credential-hub', 'inventory.yml')
}

/**
 * Pick the inventory override in the documented order: explicit config path,
 * then the test/ops environment variable, then the harness-home default.
 * @param {unknown} configured
 * @returns {string}
 */
export function resolveInventoryPath(configured) {
  if (typeof configured === 'string' && configured.trim() !== '') {
    const value = configured.trim()
    return isAbsolute(value) ? value : resolve(process.cwd(), value)
  }
  const fromEnv = process.env.DSH_CREDENTIAL_HUB_INVENTORY
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') {
    const value = fromEnv.trim()
    return isAbsolute(value) ? value : resolve(process.cwd(), value)
  }
  return defaultInventoryPath()
}

/**
 * @param {unknown} value
 * @param {number} fallback
 * @param {number} minimum
 * @param {number} maximum
 * @returns {number}
 */
function numberInRange(value, fallback, minimum, maximum) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(minimum, Math.min(maximum, value))
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @returns {string}
 */
function text(value, fallback) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/**
 * @param {unknown} value
 * @param {string} fallback
 * @param {readonly string[]} allowed
 * @returns {string}
 */
function choice(value, fallback, allowed) {
  return typeof value === 'string' && allowed.includes(value) ? value : fallback
}

/**
 * Normalize the bundle row config. Unknown keys are ignored rather than copied,
 * so a typo cannot silently become a policy switch the tools never read.
 * @param {unknown} raw
 * @returns {{
 *   inventoryPath: string,
 *   promptSection: boolean,
 *   maxPromptEntriesPerKind: number,
 *   sshTimeoutMs: number,
 *   httpTimeoutMs: number,
 *   maxOutputBytes: number,
 *   maxHttpResponseBytes: number,
 *   allowLoopbackHttp: boolean,
 *   allowCrossOriginPat: boolean,
 *   followRedirects: boolean,
 *   sshBinary: string,
 *   sshConfigFile: string,
 *   sshKnownHostsFile: string,
 *   sshStrictHostKeyChecking: string,
 *   sshConnectTimeoutMs: number,
 * }}
 */
export function resolveConfig(raw) {
  const source = raw !== null && typeof raw === 'object' ? raw : {}
  return {
    inventoryPath: resolveInventoryPath(source.inventoryPath),
    promptSection: source.promptSection !== false,
    maxPromptEntriesPerKind: numberInRange(source.maxPromptEntriesPerKind, 20, 1, 100),
    sshTimeoutMs: numberInRange(source.sshTimeoutMs, 60_000, 1_000, 30 * 60_000),
    httpTimeoutMs: numberInRange(source.httpTimeoutMs, 30_000, 1_000, 5 * 60_000),
    maxOutputBytes: numberInRange(source.maxOutputBytes, 64 * 1024, 1_024, 1024 * 1024),
    maxHttpResponseBytes: numberInRange(source.maxHttpResponseBytes, 256 * 1024, 1_024, 4 * 1024 * 1024),
    allowLoopbackHttp: source.allowLoopbackHttp !== false,
    allowCrossOriginPat: source.allowCrossOriginPat === true,
    followRedirects: source.followRedirects === true,
    sshBinary: text(source.sshBinary, 'ssh'),
    sshConfigFile: text(source.sshConfigFile, ''),
    sshKnownHostsFile: text(source.sshKnownHostsFile, ''),
    sshStrictHostKeyChecking: choice(source.sshStrictHostKeyChecking, 'accept-new', ['yes', 'accept-new', 'no']),
    sshConnectTimeoutMs: numberInRange(source.sshConnectTimeoutMs, 10_000, 1_000, 120_000),
  }
}

/**
 * Loopback HTTP is allowed for local gateways; every other plain-HTTP endpoint
 * would send a PAT in the clear.
 * @param {string} hostname
 * @returns {boolean}
 */
export function isLoopbackHostname(hostname) {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
}
