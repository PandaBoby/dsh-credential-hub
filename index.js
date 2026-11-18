/**
 * dsh-credential-hub — Host half.
 *
 * A credential routing hub for DeepSeek Harness. Two metadata inventories (SSH
 * hosts and PAT tokens) carry alias/tags/description/credentialRef. The model
 * sees only those metadata facts in a prompt section, matches a natural-language
 * query with credential_hub_match, and then uses credential_hub_ssh_exec or
 * credential_hub_pat_request. Those tools resolve the ref through
 * ctx.credentials inside the Host and use the value directly; no tool result
 * ever carries a key or token.
 *
 * @module dsh-credential-hub
 */

import { credentialRef, isCredentialRefName } from '@deepseek-ai/dsh-credentials'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { resolveConfig } from './src/config.js'
import { CredentialHubError } from './src/errors.js'
import { CredentialHub } from './src/hub.js'
import { registerPrompt } from './src/prompt.js'
import { CredentialHubSettings } from './src/settings.js'
import { registerSettingsRoutes } from './src/settings-routes.js'
import { buildToolDefinitions } from './src/tools.js'

/** Registered plugin name; also the bundle row's module name. */
export const name = 'credential-hub'

/**
 * Required Host services. `credentials` is the seam that owns the values;
 * `systemPrompt` receives the metadata-only overview; `tools` is the registry
 * the four definitions land in.
 */
export const inject = ['tools', 'credentials', 'systemPrompt']

/**
 * Mount the hub: load (or create) the inventory, contribute the prompt
 * overview, and register the tools.
 *
 * @param {object} ctx Host plugin context
 * @param {object} [rawConfig] bundle row config
 */
export function apply(ctx, rawConfig) {
  const config = resolveConfig(rawConfig)
  const hub = new CredentialHub({
    inventoryPath: config.inventoryPath,
    maxPromptEntriesPerKind: config.maxPromptEntriesPerKind,
    validateRef: isCredentialRefName,
    logger: ctx.logger,
  })

  let loaded
  try {
    loaded = hub.loadSync({ createIfMissing: true })
  } catch (error) {
    // Startup failure is better than a plugin that silently serves an empty
    // inventory: the owner sees the exact validation error in the plugin row.
    throw error instanceof CredentialHubError
      ? error
      : new CredentialHubError('INVENTORY_LOAD_FAILED', `could not load ${config.inventoryPath}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (config.promptSection) {
    registerPrompt(ctx, hub)
  }

  // The settings page is a Web-only surface: headless and terminal profiles
  // still load the tools and prompt section without a Connection service.
  const settings = new CredentialHubSettings({
    ctx,
    hub,
    config,
    inventoryPath: config.inventoryPath,
    entry: ctx.fiber?.entry,
    credentialRef,
    logger: ctx.logger,
  })
  ctx.inject(['connection'], (web) => {
    web.effect(
      () => registerSettingsRoutes(web, settings),
      'credential-hub: settings routes',
    )
  })

  const definitions = buildToolDefinitions({
    defineTool,
    credentialRef,
    hub,
    ctx,
    config,
  })
  for (const definition of definitions) ctx.tools.register(definition)

  ctx.logger?.info?.(
    `credential-hub: ready (${loaded.ssh} ssh, ${loaded.pat} pat; inventory ${config.inventoryPath}`
    + `${loaded.created ? ', created empty' : ''})`,
  )
}
