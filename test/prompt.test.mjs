import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { test } from 'node:test'
import { registerPrompt, CREDENTIAL_HUB_SECTION_ORDER, CREDENTIAL_HUB_SECTION_NAME } from '../src/prompt.js'
import { fixture, interpolate, SSH_SECRET, PAT } from './helpers.mjs'

/**
 * Minimal `ctx.systemPrompt` double that captures the contribution and can
 * render it like the real assembly.
 * @param {object} hub
 * @returns {{ctx: object, render: () => string, section: object, variables: Map<string, Function>}}
 */
function promptHarness(hub) {
  const variables = new Map()
  const sections = []
  const ctx = {
    systemPrompt: {
      variable(name, provider) {
        variables.set(name, provider)
        return () => {}
      },
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
  }
  registerPrompt(ctx, hub)
  return {
    ctx,
    section: sections[0],
    variables,
    render() {
      const values = {}
      for (const [name, provider] of variables) values[name] = provider({})
      return interpolate(sections[0].text, values)
    },
  }
}

test('registers the overview after first-party tool guidance and before the tools SDK', (t) => {
  const f = fixture()
  t.after(f.dispose)
  const harness = promptHarness(f.hub)
  assert.equal(harness.section.name, CREDENTIAL_HUB_SECTION_NAME)
  assert.equal(harness.section.order, CREDENTIAL_HUB_SECTION_ORDER)
  assert.ok(harness.section.order > 3100, 'must follow the MCP/tool guidance sections')
  assert.ok(harness.section.order < 5000, 'must precede the reusable tools SDK')
  assert.deepEqual([...harness.variables.keys()].sort(), ['pat_inventory_summary', 'ssh_inventory_summary'])
})

test('renders aliases, tags, descriptions, and refs but never values or connection details', (t) => {
  const f = fixture()
  t.after(f.dispose)
  const text = promptHarness(f.hub).render()
  assert.match(text, /prod-web-01/)
  assert.match(text, /env:production, service:web/)
  assert.match(text, /生产环境 Web 应用主机/)
  assert.match(text, /SSH_PROD_WEB_KEY/)
  assert.match(text, /github-prod-token/)
  assert.match(text, /PAT_GITHUB_PROD/)
  assert.match(text, /credential_hub_match/)
  assert.match(text, /credential_hub_ssh_exec/)
  assert.match(text, /credential_hub_pat_request/)
  assert.match(text, /不要向用户询问/)
  assert.match(text, /拒绝：清单只存 credentialRef/)
  assert.equal(text.includes(SSH_SECRET), false)
  assert.equal(text.includes(PAT), false)
  assert.equal(text.includes('127.0.0.1'), false)
  assert.equal(text.includes('deploy'), false)
  assert.equal(text.includes('http://'), false)
})

test('empty inventories render explicit empty summaries', (t) => {
  const f = fixture('version: 1\nssh: []\npat: []\n')
  t.after(f.dispose)
  const text = promptHarness(f.hub).render()
  assert.match(text, /未配置 SSH 主机/)
  assert.match(text, /未配置 PAT 令牌/)
})

test('the prompt provider keeps working during a broken edit', (t) => {
  const f = fixture()
  t.after(f.dispose)
  const harness = promptHarness(f.hub)
  const before = harness.render()
  writeFileSync(f.path, 'version: 1\nssh: nope\n')
  const after = harness.render()
  assert.match(before, /prod-web-01/)
  assert.match(after, /prod-web-01/)
  assert.match(after, /最近一次修改无法解析/)
})
