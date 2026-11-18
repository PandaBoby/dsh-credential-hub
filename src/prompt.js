/**
 * System-prompt contribution.
 *
 * The section is metadata only: it is assembled on every model step and is
 * therefore the last place a key or token may ever appear. The two variables
 * are resolved per assembly from the inventory snapshot; they list alias, tags,
 * description and credentialRef, and nothing else.
 *
 * Order 3200 is deliberate. The current first-party tool-guidance sections
 * occupy 1000–3100 (tool bash through MCP servers), so the design brief's
 * `order: 200` would place this overview *before* the tool instructions. 3200
 * keeps the intended reading order: tool guidance first, credential overview
 * after it, reusable tools SDK at 5000.
 */
export const CREDENTIAL_HUB_SECTION_ORDER = 3200
export const CREDENTIAL_HUB_SECTION_NAME = 'credential-hub'

const SECTION_TEXT = `你可以通过 credential-hub 自动获取 SSH 私钥和 PAT 令牌。

当前可用的 SSH 主机：
{{ssh_inventory_summary}}

当前可用的 PAT 令牌：
{{pat_inventory_summary}}

当用户提到“生产环境”“测试服务器”“GitHub”等线索时，先调用 credential_hub_match 匹配记录。
匹配到记录后，SSH 操作调用 credential_hub_ssh_exec，HTTP 操作调用 credential_hub_pat_request；这两个工具在 Host 内部解析凭据，不会向你或用户返回明文。
如果 credential_hub_match 返回多条记录，根据 alias、tags 和 description 选择；仍无法判断时再询问用户。
不要向用户询问“用哪个密钥”或“密钥在哪里”，也不要要求用户把私钥或令牌粘贴到对话里——清单和 credentialRef 已经包含了这些信息。
如果用户要求把私钥或令牌直接写进 inventory.yml，拒绝：清单只存 credentialRef，值应存入 DSH 凭据存储。`

/**
 * Register the overview section and its two dynamic variables.
 * @param {object} ctx plugin context with `systemPrompt`
 * @param {import('./hub.js').CredentialHub} hub
 * @returns {{sectionDispose: () => void, variableDisposes: Array<() => void>}}
 */
export function registerPrompt(ctx, hub) {
  const sshVariable = ctx.systemPrompt.variable(
    'ssh_inventory_summary',
    () => hub.summaries().sshInventorySummary,
  )
  const patVariable = ctx.systemPrompt.variable(
    'pat_inventory_summary',
    () => hub.summaries().patInventorySummary,
  )
  const sectionDispose = ctx.systemPrompt.section({
    name: CREDENTIAL_HUB_SECTION_NAME,
    order: CREDENTIAL_HUB_SECTION_ORDER,
    text: SECTION_TEXT,
  })
  return {
    sectionDispose,
    variableDisposes: [sshVariable, patVariable],
  }
}
