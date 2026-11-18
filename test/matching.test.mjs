import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchRecords, tokenize } from '../src/matching.js'
import { parseInventory } from '../src/inventory.js'
import { SAMPLE_INVENTORY } from './helpers.mjs'

const inventory = parseInventory(SAMPLE_INVENTORY)

const aliases = (query, kind) => matchRecords(inventory, query, kind).map((record) => record.alias)

test('scenario A query routes to the production web host only', () => {
  assert.deepEqual(aliases('去生产环境看下 web 日志'), ['prod-web-01'])
})

test('scenario B query routes to the production GitHub token only', () => {
  assert.deepEqual(aliases('用生产令牌查一下 GitHub 仓库状态'), ['github-prod-token'])
})

test('Chinese environment synonyms hit English tags', () => {
  assert.ok(aliases('线上').includes('prod-web-01'))
  assert.ok(aliases('测试环境').includes('staging-db'))
  assert.ok(aliases('预发').includes('staging-db'))
})

test('a weak shared fragment cannot drag in an unrelated host', () => {
  const result = aliases('测试服务器')
  assert.equal(result[0], 'staging-db')
  assert.equal(result.includes('prod-web-01'), false)
})

test('kind-only queries list every record of that kind', () => {
  assert.deepEqual(aliases('令牌').sort(), ['github-prod-token', 'github-staging-token'])
  assert.deepEqual(aliases('服务器').sort(), ['prod-web-01', 'staging-db'])
  assert.deepEqual(aliases('ssh').sort(), ['prod-web-01', 'staging-db'])
})

test('kind filter narrows the search before scoring', () => {
  assert.deepEqual(aliases('web', 'pat'), [])
  assert.deepEqual(aliases('生产环境', 'ssh'), ['prod-web-01'])
})

test('alias and tag fragments are matchable', () => {
  assert.equal(aliases('prod-web-01')[0], 'prod-web-01')
  assert.deepEqual(aliases('service:db'), ['staging-db'])
  assert.deepEqual(aliases('platform:github').length, 2)
})

test('no match returns an empty array, not everything', () => {
  assert.deepEqual(aliases('kubernetes cluster dashboard'), [])
  assert.deepEqual(aliases('zzzz-unrelated'), [])
})

test('match results carry metadata and never a value', () => {
  const [record] = matchRecords(inventory, '生产环境 web', undefined)
  assert.equal(record.alias, 'prod-web-01')
  assert.equal(record.kind, 'ssh')
  assert.equal(record.credentialRef, 'SSH_PROD_WEB_KEY')
  assert.deepEqual(record.tags, ['env:production', 'service:web'])
  assert.equal(record.host, '127.0.0.1')
  assert.equal(typeof record.score, 'number')
  assert.equal(JSON.stringify(record).includes('PRIVATE KEY'), false)
})

test('tokenizer keeps ASCII parts and CJK n-grams', () => {
  const tokens = tokenize('生产环境 web env:production')
  for (const token of ['生产环境', '生产', '环境', 'web', 'env', 'production', 'env:production']) {
    assert.ok(tokens.includes(token), `missing ${token}`)
  }
})

test('scores are ordered best first', () => {
  const result = matchRecords(inventory, 'GitHub 生产令牌', undefined)
  assert.equal(result[0].alias, 'github-prod-token')
  for (let index = 1; index < result.length; index += 1) {
    assert.ok(result[index - 1].score >= result[index].score)
  }
})
