/**
 * Fuzzy, local, deterministic matching for the credential inventory.
 *
 * The input is natural language ("去生产环境看下 web 日志"), while records are
 * tagged in a small controlled vocabulary ("env:production", "service:web").
 * Matching therefore combines:
 *
 * - ASCII token and CJK n-gram tokenization, so a Chinese query can hit Chinese
 *   descriptions;
 * - a fixed bilingual synonym table, so "生产" can hit "env:production" even
 *   when the description does not repeat it;
 * - an anchor rule, so a weak shared token ("环境") cannot drag unrelated hosts
 *   into the result set;
 * - an explicit kind-only query path ("令牌", "服务器"), where returning every
 *   record of that kind is exactly what the user asked for.
 *
 * There is no model call and no value access here: matching works on metadata
 * only, and the match tool never touches ctx.credentials.
 */

/** Terms that describe the same concept; `canonical` is the tag-friendly form. */
const TERM_GROUPS = [
  { canonical: 'production', terms: ['production', 'prod', '生产', '线上', '正式', '生产环境'] },
  { canonical: 'staging', terms: ['staging', 'stage', '测试', '预发', '预生产', '测试环境'] },
  { canonical: 'development', terms: ['development', 'dev', '开发', '本地'] },
  { canonical: 'web', terms: ['web', 'www', '网站', '网页', '前端'] },
  { canonical: 'db', terms: ['db', 'database', '数据库', 'mysql', 'postgres', 'postgresql', 'redis'] },
  { canonical: 'github', terms: ['github', 'git', '仓库', 'repo', 'repository'] },
  { canonical: 'gitlab', terms: ['gitlab'] },
  { canonical: 'ssh', terms: ['ssh', '服务器', '主机', '机器', '远程'] },
  { canonical: 'pat', terms: ['pat', 'token', '令牌', '访问令牌', '个人访问令牌'] },
  { canonical: 'log', terms: ['log', 'logs', '日志'] },
  { canonical: 'api', terms: ['api', '接口', '服务'] },
]

/** Words that carry no discriminating signal in a routing query. */
const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'this', 'that', 'use', 'using', 'please',
  'at', 'in', 'on', 'to', 'of', 'a', 'an', 'is', 'are', 'my', 'me',
  '用', '去', '看', '下', '一下', '看下', '看看', '的', '了', '在', '里',
  '帮', '帮我', '请', '查', '查询', '状态', '一下下',
])

const KIND_TERMS = new Set(['ssh', 'pat'])
/** A tag key such as `service` is not an anchor; its value (`db`, `web`) is. */
const GENERIC_TAG_PARTS = new Set(['env', 'service', 'platform', 'type', 'kind', 'tag', 'tags'])

/** Words that imply one kind even when the user did not pass `kind`. */
const SSH_QUERY_HINTS = new Set(['ssh', 'log', 'logs'])
const ENV_TERMS = new Set(['production', 'staging', 'development'])
const PAT_QUERY_HINTS = new Set(['pat', 'github', 'gitlab'])

/** @type {Map<string, {canonical: string, terms: readonly string[]}>} */
const TERM_LOOKUP = new Map()
/** Fragments of kind terms ("服务" inside "服务器") must not turn a kind-only query into a content query. */
const KIND_TERM_FRAGMENTS = new Set()
for (const group of TERM_GROUPS) {
  for (const term of group.terms) TERM_LOOKUP.set(term, group)
  TERM_LOOKUP.set(group.canonical, group)
  if (KIND_TERMS.has(group.canonical)) {
    for (const term of [group.canonical, ...group.terms]) {
      const chars = Array.from(term)
      for (let length = 2; length <= chars.length; length += 1) {
        for (let start = 0; start + length <= chars.length; start += 1) {
          KIND_TERM_FRAGMENTS.add(chars.slice(start, start + length).join(''))
        }
      }
    }
  }
}

/**
 * @param {string} value
 * @returns {number} Unicode code-point length.
 */
function codePointLength(value) {
  return Array.from(value).length
}

/**
 * Split text into lowercase ASCII tokens and CJK n-grams (2–4 code points).
 * Both the full dotted/colon form and its parts are kept so `env:production`
 * matches `env`, `production`, and the whole tag.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenize(text) {
  const normalized = String(text ?? '').normalize('NFKC').toLowerCase()
    .replace(/[，。！？、；：“”‘’（）【】《》]/g, ' ')
  const tokens = new Set()
  for (const raw of normalized.match(/[a-z0-9][a-z0-9._:@/-]*/g) ?? []) {
    const cleaned = raw.replace(/^[._:@/-]+|[._:@/-]+$/g, '')
    if (cleaned.length >= 2) tokens.add(cleaned)
    for (const part of cleaned.split(/[._:@/-]+/)) {
      if (part.length >= 2) tokens.add(part)
    }
  }
  for (const run of normalized.match(/[\u3400-\u9fff]+/g) ?? []) {
    const chars = Array.from(run)
    if (chars.length < 2) continue
    for (let length = 2; length <= Math.min(4, chars.length); length += 1) {
      for (let start = 0; start + length <= chars.length; start += 1) {
        tokens.add(chars.slice(start, start + length).join(''))
      }
    }
    if (chars.length <= 12) tokens.add(run)
  }
  return [...tokens].filter((token) => token !== '' && !STOPWORDS.has(token))
}

/**
 * @param {string} token
 * @returns {{canonical: string, terms: readonly string[]} | undefined}
 */
function groupFor(token) {
  return TERM_LOOKUP.get(token)
}

/**
 * @param {string} token
 * @returns {boolean}
 */
function isKindToken(token) {
  if (KIND_TERMS.has(token)) return true
  const group = groupFor(token)
  return group !== undefined && KIND_TERMS.has(group.canonical)
}

/**
 * Decide whether a query asks for one kind without an explicit `kind` filter.
 * A query that mentions a log/command/server or a token/API/repository concept
 * is narrowed to that kind; a query that mentions both or neither stays broad.
 * @param {string[]} tokens
 * @returns {'ssh'|'pat'|undefined}
 */
export function inferKind(tokens) {
  let ssh = false
  let pat = false
  for (const token of tokens) {
    // `服务` is an n-gram inside `服务器`; it must not make a server query look
    // like an API/token query. A kind term itself still counts normally.
    if (KIND_TERM_FRAGMENTS.has(token) && !isKindToken(token)) continue
    const group = groupFor(token)
    if (group?.canonical === 'ssh' || group?.canonical === 'log' || SSH_QUERY_HINTS.has(token)) ssh = true
    if (group?.canonical === 'pat' || group?.canonical === 'github' || group?.canonical === 'gitlab'
      || group?.canonical === 'api' || PAT_QUERY_HINTS.has(token)) pat = true
  }
  if (ssh && !pat) return 'ssh'
  if (pat && !ssh) return 'pat'
  return undefined
}

/**
 * Weight longer phrases above short shared fragments. A 3+ code-point token is
 * a meaningful phrase in both Chinese and English.
 * @param {string} token
 * @returns {number}
 */
function tokenWeight(token) {
  const length = codePointLength(token)
  if (length >= 4) return 2
  if (length === 3) return 1.5
  return 1
}

/**
 * Precompute the metadata view used by scoring. Nothing here can contain a
 * secret: the inventory schema has no secret fields.
 * @param {object} record
 * @returns {{
 *   aliasLower: string,
 *   descriptionLower: string,
 *   hostLower: string,
 *   usernameLower: string,
 *   platformLower: string,
 *   tagsLower: Set<string>,
 *   tagParts: Set<string>,
 *   canonicalTerms: Set<string>,
 *   envTerms: Set<string>,
 *   haystack: string,
 * }}
 */
function prepareRecord(record) {
  const aliasLower = String(record.alias ?? '').toLowerCase()
  const descriptionLower = String(record.description ?? '').toLowerCase()
  const hostLower = String(record.host ?? '').toLowerCase()
  const usernameLower = String(record.username ?? '').toLowerCase()
  const platformLower = String(record.platform ?? '').toLowerCase()
  const tagsLower = new Set()
  const tagParts = new Set()
  const canonicalTerms = new Set()
  const envTerms = new Set()
  const haystackParts = [
    aliasLower, descriptionLower, hostLower, usernameLower, platformLower,
    String(record.kind ?? '').toLowerCase(),
    Array.isArray(record.tags) ? record.tags.join(' ').toLowerCase() : '',
  ]

  for (const tag of Array.isArray(record.tags) ? record.tags : []) {
    const lower = String(tag).toLowerCase()
    tagsLower.add(lower)
    for (const part of lower.split(/[._:@/-]+/)) {
      if (part !== '') tagParts.add(part)
    }
    for (const token of tokenize(lower)) {
      const group = groupFor(token)
      if (group !== undefined) {
        canonicalTerms.add(group.canonical)
        if (ENV_TERMS.has(group.canonical)) envTerms.add(group.canonical)
      }
    }
  }
  for (const part of [aliasLower, descriptionLower, hostLower, usernameLower, platformLower]) {
    for (const token of tokenize(part)) {
      const group = groupFor(token)
      if (group !== undefined) canonicalTerms.add(group.canonical)
    }
  }
  if (record.kind === 'ssh') canonicalTerms.add('ssh')
  if (record.kind === 'pat') canonicalTerms.add('pat')

  return {
    aliasLower,
    descriptionLower,
    hostLower,
    usernameLower,
    platformLower,
    tagsLower,
    tagParts,
    canonicalTerms,
    envTerms,
    haystack: [...haystackParts, ...canonicalTerms].join(' '),
  }
}

/**
 * Score one prepared record against query tokens and decide whether it is
 * anchored by a real signal (not merely a kind hint from a more specific query).
 * @param {object} record
 * @param {ReturnType<typeof prepareRecord>} prepared
 * @param {string[]} tokens
 * @param {boolean} kindOnlyQuery
 * @returns {{score: number, anchored: boolean, matched: number}}
 */
function scoreRecord(record, prepared, tokens, kindOnlyQuery) {
  let score = 0
  let matched = 0
  let strongAnchor = false
  let kindAnchor = false
  const kindMatches = tokens.some((token) => isKindToken(token)
    && (token === record.kind || groupFor(token)?.canonical === record.kind))

  for (const token of tokens) {
    const weight = tokenWeight(token)
    const group = groupFor(token)
    let hit = false
    if (prepared.tagsLower.has(token)) {
      score += 6 * weight
      hit = true
      strongAnchor = true
    } else if (prepared.tagParts.has(token) && !GENERIC_TAG_PARTS.has(token)) {
      score += 5 * weight
      hit = true
      strongAnchor = true
    } else if (prepared.tagParts.has(token)) {
      // `service` alone is shared by every tagged record; count it as a weak
      // signal so the full `service:db` tag still wins, but do not anchor.
      score += 1.5 * weight
      hit = true
    } else if (prepared.aliasLower.includes(token)) {
      score += 4 * weight
      hit = true
      if (codePointLength(token) >= 3) strongAnchor = true
    } else if (prepared.descriptionLower.includes(token)) {
      score += 3 * weight
      hit = true
      if (codePointLength(token) >= 3) strongAnchor = true
    } else if (prepared.hostLower.includes(token)
      || prepared.usernameLower.includes(token)
      || prepared.platformLower.includes(token)) {
      score += 2.5 * weight
      hit = true
      if (codePointLength(token) >= 3) strongAnchor = true
    } else if (prepared.haystack.includes(token)) {
      score += 1.5 * weight
      hit = true
    }
    if (hit) matched += 1
    if (group !== undefined && prepared.canonicalTerms.has(group.canonical)) {
      score += 2 * weight
      if (!KIND_TERMS.has(group.canonical)) strongAnchor = true
    }
    if (isKindToken(token) && (group?.canonical === record.kind || token === record.kind)) {
      kindAnchor = true
      score += 1
    }
  }

  if (tokens.length > 0) score += (matched / tokens.length) * 2
  if (kindMatches) score += 1
  return {
    score,
    anchored: strongAnchor || (kindOnlyQuery && kindAnchor),
    matched,
  }
}

/**
 * Match inventory records against a natural-language query.
 *
 * @param {{ssh: object[], pat: object[]}} inventory normalized inventory
 * @param {string} query user-visible query
 * @param {'ssh'|'pat'|undefined} kind optional kind filter
 * @returns {object[]} metadata records, best first; empty when nothing is anchored
 */
export function matchRecords(inventory, query, kind) {
  const tokens = tokenize(query)
  if (tokens.length === 0) return []
  // A query made only of kind words ("令牌", "服务器") is a request for every
  // record of that kind. Once any content word appears ("生产令牌"), an
  // unrelated record cannot ride in on the kind hint alone.
  const kindOnlyQuery = tokens.some((token) => isKindToken(token))
    && tokens.every((token) => isKindToken(token) || KIND_TERM_FRAGMENTS.has(token))
  const inferredKind = kind ?? inferKind(tokens)
  const queryEnvs = new Set()
  for (const token of tokens) {
    const group = groupFor(token)
    if (group !== undefined && ENV_TERMS.has(group.canonical)) queryEnvs.add(group.canonical)
  }
  const candidates = []
  for (const record of [...inventory.ssh, ...inventory.pat]) {
    if (inferredKind !== undefined && record.kind !== inferredKind) continue
    candidates.push(record)
  }
  const matches = []
  for (const record of candidates) {
    const prepared = prepareRecord(record)
    // "生产令牌" must not return a staging token merely because both are
    // GitHub tokens. An explicit environment in the query filters records
    // that declare a different environment; records with no env tag remain
    // eligible because their environment is simply unknown.
    if (queryEnvs.size > 0 && prepared.envTerms.size > 0
      && ![...queryEnvs].some((env) => prepared.envTerms.has(env))) continue
    const scored = scoreRecord(record, prepared, tokens, kindOnlyQuery)
    if (!scored.anchored || scored.score <= 0) continue
    matches.push({ record, score: Math.round(scored.score * 100) / 100 })
  }
  matches.sort((left, right) => right.score - left.score
    || left.record.alias.localeCompare(right.record.alias))
  return matches.map(({ record, score }) => ({
    alias: record.alias,
    kind: record.kind,
    tags: [...record.tags],
    description: record.description,
    credentialRef: record.credentialRef,
    ...record.kind === 'ssh' ? {
      host: record.host,
      port: record.port,
      username: record.username,
    } : {},
    ...record.kind === 'pat' && record.platform !== undefined ? { platform: record.platform } : {},
    ...record.kind === 'pat' && record.baseUrl !== undefined ? { baseUrl: record.baseUrl } : {},
    score,
  }))
}
