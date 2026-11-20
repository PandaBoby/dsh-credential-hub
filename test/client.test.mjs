import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import vm from 'node:vm'

const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props, children }),
  useState: () => [undefined, () => {}],
  useEffect: () => {},
  useRef: () => ({ current: true }),
}

test('client module has the bundle id, injects slots/locale, and seats one settings section', () => {
  let loaded
  const sandbox = {
    window: { __ModuleLoader__: { load: (definition) => { loaded = definition } } },
    console,
  }
  vm.runInNewContext(readFileSync('client.js', 'utf8'), sandbox, { filename: 'client.js' })
  assert.equal(loaded.id, 'dsh-credential-hub')

  const module = loaded.factory((name) => {
    if (name === 'react') return React
    throw new Error(`unexpected require ${name}`)
  })
  assert.deepEqual(Array.from(module.inject), ['slots', 'locale'])

  const registers = []
  const dictionaries = []
  const ctx = {
    effect: (callback) => {
      const dispose = callback()
      return dispose
    },
    locale: {
      register(namespace, dicts) {
        dictionaries.push({ namespace, dicts })
        return () => {}
      },
      bind: (namespace) => (key) => `${namespace}:${key}`,
    },
    slots: {
      inject(slot, callback) {
        callback()
      },
      register(options, component) {
        registers.push({ slot: options.name, options, component })
        return () => {}
      },
    },
  }
  module.apply(ctx)

  const section = registers.find((entry) => entry.slot === 'settings.section')
  assert.ok(section)
  assert.equal(section.options.id, 'credential-hub')
  assert.equal(section.options.order, 30)
  assert.equal(section.options.locale, 'credential-hub')
  assert.equal(section.options.label(), 'credential-hub:sectionTitle')
  assert.equal(typeof section.component, 'function')

  const icon = registers.find((entry) => entry.slot === 'settings.section.icon')
  assert.ok(icon)
  assert.equal(icon.options.id, 'credential-hub')

  assert.equal(dictionaries.length, 1)
  assert.equal(dictionaries[0].namespace, 'credential-hub')
  const zh = dictionaries[0].dicts.zh
  const en = dictionaries[0].dicts.en
  assert.ok(Object.keys(zh).length >= 50)
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
  for (const key of ['sectionTitle', 'title', 'tabSsh', 'tabPat', 'tabConfig', 'tabTransfer', 'exportHint', 'fieldSecret', 'fieldSecretHint']) {
    assert.equal(typeof zh[key], 'string')
    assert.equal(typeof en[key], 'string')
  }
})

test('the secret field is a multi-line control so a pasted key keeps its line breaks', () => {
  const source = readFileSync('client.js', 'utf8')
  // A single-line <input> turns a pasted key's line breaks into spaces, and the
  // store then saves that one-line value as a folded YAML scalar.
  assert.match(source, /h\('textarea', \{\s+id: 'credhub-secret'/)
})
