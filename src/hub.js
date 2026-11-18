import { statSync } from 'node:fs'
import { resolve } from 'node:path'
import { buildSummaries, readInventorySync } from './inventory.js'
import { matchRecords } from './matching.js'
import { isCredentialRefName } from './refs.js'

/**
 * Owns the loaded inventory snapshot and its freshness check.
 *
 * The prompt variable provider is synchronous by contract, so the inventory is
 * read synchronously at apply time and re-read when the file's mtime or size
 * changes. A broken edit keeps the last good snapshot for the prompt (and
 * surfaces a short warning there), while tool calls fail with the detailed
 * validation error so the owner notices immediately.
 */
export class CredentialHub {
  /**
   * @param {{
   *   inventoryPath: string,
   *   maxPromptEntriesPerKind: number,
   *   validateRef?: (value: string) => boolean,
   *   logger?: object,
   * }} options
   */
  constructor(options) {
    this.path = resolve(options.inventoryPath)
    this.maxPromptEntriesPerKind = options.maxPromptEntriesPerKind
    this.validateRef = options.validateRef ?? isCredentialRefName
    this.logger = options.logger
    /** @type {{inventory: object, mtimeMs: number, size: number} | undefined} */
    this.snapshot = undefined
    /** @type {import('./errors.js').CredentialHubError | undefined} */
    this.lastError = undefined
    /** @type {{ssh: readonly object[], pat: readonly object[]}} */
    this.emptyInventory = Object.freeze({ version: 1, ssh: Object.freeze([]), pat: Object.freeze([]) })
  }

  /**
   * Load the inventory at startup, creating an empty one when absent.
   * @param {{ createIfMissing?: boolean }} [options]
   * @returns {{created: boolean, ssh: number, pat: number}}
   */
  loadSync(options = {}) {
    const loaded = readInventorySync(this.path, {
      createIfMissing: options.createIfMissing,
      validateRef: this.validateRef,
      logger: this.logger,
    })
    this.snapshot = {
      inventory: loaded.inventory,
      mtimeMs: loaded.mtimeMs,
      size: loaded.size,
    }
    this.lastError = undefined
    return {
      created: loaded.created,
      ssh: loaded.inventory.ssh.length,
      pat: loaded.inventory.pat.length,
    }
  }

  /**
   * Reload when the file changed. Returns false (and records the error) when a
   * changed file cannot be parsed; the previous good snapshot stays usable.
   * @returns {boolean}
   */
  refreshSync() {
    let stat
    try {
      stat = statSync(this.path)
    } catch (error) {
      this.lastError = new Error(`${this.path}: cannot read inventory: ${String(error?.message ?? error)}`)
      return false
    }
    if (this.snapshot !== undefined
      && stat.mtimeMs === this.snapshot.mtimeMs
      && stat.size === this.snapshot.size) {
      return true
    }
    try {
      const loaded = readInventorySync(this.path, {
        createIfMissing: false,
        validateRef: this.validateRef,
        logger: this.logger,
      })
      this.snapshot = {
        inventory: loaded.inventory,
        mtimeMs: loaded.mtimeMs,
        size: loaded.size,
      }
      this.lastError = undefined
      this.logger?.info?.(`credential-hub: inventory reloaded (${loaded.inventory.ssh.length} ssh, ${loaded.inventory.pat.length} pat)`)
      return true
    } catch (error) {
      this.lastError = error instanceof Error ? error : new Error(String(error))
      this.logger?.warn?.(`credential-hub: inventory reload failed: ${this.lastError.message}`)
      return false
    }
  }

  /**
   * The current inventory. A changed-but-invalid file throws its validation
   * error instead of serving stale metadata to an operation.
   * @returns {{version: 1, ssh: readonly object[], pat: readonly object[]}}
   */
  inventory() {
    if (this.snapshot === undefined) {
      this.loadSync({ createIfMissing: true })
    } else if (!this.refreshSync() && this.lastError !== undefined) {
      throw this.lastError
    }
    return this.snapshot?.inventory ?? this.emptyInventory
  }

  /**
   * Prompt-facing summaries. Never throws: prompt assembly must not fail
   * because the owner is mid-edit.
   * @returns {{sshInventorySummary: string, patInventorySummary: string}}
   */
  summaries() {
    if (this.snapshot === undefined) {
      try {
        this.loadSync({ createIfMissing: true })
      } catch (error) {
        this.lastError = error instanceof Error ? error : new Error(String(error))
      }
    } else {
      this.refreshSync()
    }
    const inventory = this.snapshot?.inventory ?? this.emptyInventory
    const summaries = buildSummaries(inventory, this.maxPromptEntriesPerKind)
    if (this.lastError !== undefined) {
      // Keep the warning free of YAML content and values.
      const warning = '\n（注意：清单文件最近一次修改无法解析，当前展示的是上一次可用的元数据；工具调用会返回具体校验错误。）'
      return {
        sshInventorySummary: summaries.sshInventorySummary + warning,
        patInventorySummary: summaries.patInventorySummary,
      }
    }
    return summaries
  }

  /**
   * @param {string} alias
   * @returns {object | undefined}
   */
  findByAlias(alias) {
    const needle = alias.trim().toLowerCase()
    const inventory = this.inventory()
    return [...inventory.ssh, ...inventory.pat]
      .find((record) => record.alias.toLowerCase() === needle)
  }

  /**
   * @param {string} ref
   * @returns {{alias: string, kind: 'ssh'|'pat'}[]}
   */
  findAliasesByRef(ref) {
    const inventory = this.inventory()
    return [...inventory.ssh, ...inventory.pat]
      .filter((record) => record.credentialRef === ref)
      .map((record) => ({ alias: record.alias, kind: record.kind }))
  }

  /**
   * @param {string} query
   * @param {'ssh'|'pat'|undefined} kind
   * @returns {object[]}
   */
  match(query, kind) {
    return matchRecords(this.inventory(), query, kind)
  }
}
