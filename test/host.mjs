/**
 * Host-half self-check.
 *
 * Exercises the pluginnable surface without the GUI: the credential store,
 * the result envelope the panel depends on, and the gateway's error mapping.
 * Uses a temporary data directory, so it never touches the real profile
 * state.
 *
 * Run: node test/host.mjs
 */

import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { estimateProgress, WereadService } from '../lib/service.js'
import { normalizePositions } from '../lib/store.js'
import { registerTools } from '../lib/tools.js'

let failures = 0
let checks = 0

/** Assert one condition and report it. */
function check(label, condition, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return
  }
  failures += 1
  console.log(`  FAIL ${label}${detail === undefined ? '' : ` — ${detail}`}`)
}

const dataDir = await mkdtemp(join(tmpdir(), 'dsh-weread-test-'))
const service = new WereadService({
  ctx: { logger: { info() {}, warn() {}, debug() {} } },
  config: { dataDir, skillVersion: '1.0.5', requestTimeoutMs: 15000 },
})

try {
  console.log('\nstatus before configuration')
  const initial = await service.handleRpc('status', {})
  check('envelope carries ok:true', initial.ok === true, JSON.stringify(initial))
  check('no API key yet', initial.value?.apiKeyConfigured === false)
  check('data dir is the temporary one', initial.value?.dataDir === dataDir)

  console.log('\nfailure envelope')
  const missing = await service.handleRpc('shelf', {})
  check('a missing key is a value, not a throw', missing.ok === false, JSON.stringify(missing))
  check('code is weread/needs-config', missing.error?.code === 'weread/needs-config', missing.error?.code)
  check('details is an object (the client transport requires it)', typeof missing.error?.details === 'object')

  console.log('\nreader credential routing (no credentials configured yet)')
  const noCookie = await service.handleRpc('chapter', { bookId: '123', chapterUid: 1 })
  check(
    'reading without any credential asks for the Cookie, not the API key',
    noCookie.ok === false && noCookie.error?.code === 'weread/needs-cookie',
    JSON.stringify(noCookie),
  )
  const readerStatus = await service.handleRpc('readerStatus', {})
  check('reader status reports no session', readerStatus.ok === true && readerStatus.value?.cookieConfigured === false)
  const syncOff = await service.handleRpc('reportProgress', { bookId: '123', chapterUid: 1 })
  check(
    'progress sync is refused while disabled',
    syncOff.ok === false && syncOff.error?.code === 'weread/sync-disabled',
    JSON.stringify(syncOff),
  )
  const badChapter = await service.handleRpc('chapter', { bookId: '', chapterUid: 1 })
  check('a missing bookId is a bad request', badChapter.error?.code === 'weread/bad-request', badChapter.error?.code)

  console.log('\ncredential validation')
  const badKey = await service.handleRpc('configure', { apiKey: 'not-a-key' })
  check('a malformed key is rejected', badKey.ok === false && badKey.error?.code === 'weread/bad-key', JSON.stringify(badKey))
  const badCookie = await service.handleRpc('configure', { cookie: 'foo=bar' })
  check(
    'a cookie without wr_vid/wr_skey is rejected',
    badCookie.ok === false && badCookie.error?.code === 'weread/bad-cookie',
    JSON.stringify(badCookie),
  )
  const saved = await service.handleRpc('configure', { apiKey: 'wrk-test-0000000000' })
  check('a well-formed key is stored', saved.ok === true && saved.value?.apiKeyConfigured === true, JSON.stringify(saved))
  check('the stored key is masked in status', saved.value?.apiKeyHint?.includes('…') === true, saved.value?.apiKeyHint)

  console.log('\nprogress-sync preference (runtime, not the row config)')
  {
    const before = await service.handleRpc('status', {})
    check('the row default starts off', before.value?.syncProgress === false && before.value?.syncProgressDefault === false)
    const blocked = await service.handleRpc('reportProgress', { bookId: '1', chapterUid: 1 })
    check('reporting is refused while off', blocked.error?.code === 'weread/sync-disabled', blocked.error?.code)

    const enabled = await service.handleRpc('configure', { syncProgress: true })
    check('the panel can turn it on without a restart', enabled.ok === true && enabled.value?.syncProgress === true, JSON.stringify(enabled))
    const stillDefault = await service.handleRpc('status', {})
    check('the stored choice is reported apart from the default', stillDefault.value?.syncProgressDefault === false)

    const nowAllowed = await service.handleRpc('reportProgress', { bookId: '1', chapterUid: 1 })
    check(
      'the gate opens once enabled',
      nowAllowed.ok === false && nowAllowed.error?.code !== 'weread/sync-disabled',
      JSON.stringify(nowAllowed.error),
    )

    const disabled = await service.handleRpc('configure', { syncProgress: false })
    check('the panel can turn it back off', disabled.value?.syncProgress === false)
    const blockedAgain = await service.handleRpc('reportProgress', { bookId: '1', chapterUid: 1 })
    check('reporting is refused again', blockedAgain.error?.code === 'weread/sync-disabled')
  }

  console.log('\nprogress estimate (fitted against 44 real books)')
  {
    const even = [{ wordCount: 100 }, { wordCount: 100 }, { wordCount: 100 }, { wordCount: 100 }]
    check('an even catalog behaves like the position', estimateProgress(even, 0, 0) === 0)
    check('one chapter in is a quarter of the book', estimateProgress(even, 1, 0) === 25)
    check('a position inside the chapter counts', estimateProgress(even, 1, 50) === 38, String(estimateProgress(even, 1, 50)))
    check('the last chapter at its end is 100%', estimateProgress(even, 3, 100) === 100)
    check('an offset past the chapter end is clamped', estimateProgress(even, 3, 9999) === 100)
    check('an unknown chapter is 0', estimateProgress(even, -1, 10) === 0)
    check('an empty catalog is 0', estimateProgress([], 0, 0) === 0)

    // Front matter is why chapter ordinal over-reports: 封面/版权 carry almost
    // no text, so a word-weighted position is far lower.
    const frontMatter = [
      { wordCount: 1 },
      { wordCount: 90 },
      { wordCount: 12 },
      { wordCount: 3 },
      { wordCount: 300 },
      { wordCount: 1 },
      { wordCount: 5000 },
      { wordCount: 5000 },
    ]
    const ordinal = Math.round(((2 + 1) / frontMatter.length) * 100)
    const weighted = estimateProgress(frontMatter, 2, 0)
    check('front matter no longer inflates the percentage', weighted < ordinal, `ordinal=${ordinal} weighted=${weighted}`)
    check('the weighted value is the share of text read', weighted === 1, String(weighted))

    const noWords = [{ wordCount: 0 }, { wordCount: 0 }, { wordCount: 0 }, { wordCount: 0 }]
    check('a catalog without word counts falls back to ordinal', estimateProgress(noWords, 1, 0) === 50, String(estimateProgress(noWords, 1, 0)))
  }

  console.log('\nremembered reading positions')
  {
    const raw = {
      '5': { chapterUid: 14, updatedAt: 20 },
      '6': { chapterUid: '31', updatedAt: 10 },
      '7': { chapterUid: 0, updatedAt: 30 },
      '8': { chapterUid: 'nonsense', updatedAt: 40 },
      '9': null,
    }
    const normalized = normalizePositions(raw)
    check('a valid position is kept', normalized['5']?.chapterUid === 14)
    check('a numeric string is accepted', normalized['6']?.chapterUid === 31)
    check('a zero chapter is dropped', normalized['7'] === undefined)
    check('a non-numeric chapter is dropped', normalized['8'] === undefined)
    check('a null entry is dropped', normalized['9'] === undefined)
    check('junk input becomes an empty map', Object.keys(normalizePositions('nope')).length === 0)

    const many = {}
    for (let i = 1; i <= 205; i += 1) many[String(i)] = { chapterUid: i, updatedAt: i }
    const capped = normalizePositions(many)
    check('the map is bounded', Object.keys(capped).length === 200, String(Object.keys(capped).length))
    check('the oldest entries fall off first', capped['5'] === undefined && capped['6']?.chapterUid === 6)
    check('the newest entry survives', capped['205']?.chapterUid === 205)

    const remembered = await service.handleRpc('rememberPosition', { bookId: '837932', chapterUid: 96 })
    check('a position can be remembered', remembered.value?.chapterUid === 96, JSON.stringify(remembered.value))

    const status = await service.handleRpc('status', {})
    check('status carries the positions', status.value?.positions?.['837932']?.chapterUid === 96, JSON.stringify(status.value?.positions))

    // A book opened here must survive a restart, which means the file, not memory.
    const reopened = new WereadService({
      ctx: { logger: { info() {}, warn() {}, debug() {} } },
      config: { dataDir, skillVersion: '1.0.5', requestTimeoutMs: 15000 },
    })
    const after = await reopened.status()
    check('the position survives a fresh service', after.positions?.['837932']?.chapterUid === 96, JSON.stringify(after.positions))

    const bad = await service.handleRpc('rememberPosition', { bookId: '837932', chapterUid: 0 })
    check('a zero chapter is refused', bad.ok === false && bad.error?.code === 'weread/bad-request', JSON.stringify(bad.error))
    const missing = await service.handleRpc('rememberPosition', { chapterUid: 5 })
    check('a missing book is refused', missing.ok === false && missing.error?.code === 'weread/bad-request', JSON.stringify(missing.error))
  }

  console.log('\nreading appearance (stored, normalized, partial)')
  {
    const initial = await service.handleRpc('status', {})
    check(
      'appearance starts at the documented defaults',
      JSON.stringify(initial.value?.reader) === JSON.stringify({ theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' }),
      JSON.stringify(initial.value?.reader),
    )

    const clamped = await service.handleRpc('configure', {
      reader: { theme: 'dark', fontSize: 99, lineHeight: 9, fontFamily: 'serif' },
    })
    check('an out-of-range size is clamped', clamped.value?.reader?.fontSize === 30, String(clamped.value?.reader?.fontSize))
    check('an out-of-range line height is clamped', clamped.value?.reader?.lineHeight === 2.6, String(clamped.value?.reader?.lineHeight))
    check('accepted values are kept', clamped.value?.reader?.theme === 'dark' && clamped.value?.reader?.fontFamily === 'serif')

    const partial = await service.handleRpc('configure', { reader: { fontSize: 20 } })
    check('a partial change preserves the rest', partial.value?.reader?.fontSize === 20 && partial.value?.reader?.theme === 'dark', JSON.stringify(partial.value?.reader))

    const rejected = await service.handleRpc('configure', { reader: { theme: 'neon', fontFamily: 'comic' } })
    check(
      'unknown option values are ignored rather than stored',
      rejected.value?.reader?.theme === 'dark' && rejected.value?.reader?.fontFamily === 'serif',
      JSON.stringify(rejected.value?.reader),
    )

    const reread = await service.handleRpc('status', {})
    check('the appearance survives a fresh read', reread.value?.reader?.fontSize === 20 && reread.value?.reader?.theme === 'dark')

    // A hand-edited file must not be able to put the reader in a bad state.
    await service.store.saveSettings({ reader: { theme: 'nonsense', fontSize: 'huge', lineHeight: null, fontFamily: 7 } })
    const normalized = await service.handleRpc('status', {})
    check(
      'a corrupt stored value normalizes back to valid defaults',
      normalized.value?.reader?.theme === 'follow' && normalized.value?.reader?.fontSize === 17,
      JSON.stringify(normalized.value?.reader),
    )
  }

  console.log('\ngateway error mapping (live network)')
  const rejected = await service.handleRpc('shelf', {})
  check('an invalid key surfaces as weread/bad-api-key', rejected.error?.code === 'weread/bad-api-key', JSON.stringify(rejected))
  check(
    'the message names the failure in Chinese',
    typeof rejected.error?.message === 'string' && rejected.error.message.includes('鉴权失败'),
    rejected.error?.message,
  )

  console.log('\npanel transport (/api/weread)')
  const { createRpcRoute, RPC_PATH } = await import('../lib/rpc.js')
  const route = createRpcRoute(service)
  check('route claims the shared /api bridge', RPC_PATH === '/api/weread' && route.path === RPC_PATH)
  check('route accepts POST only', route.methods.length === 1 && route.methods[0] === 'POST')

  const statusResponse = await route.fetch(
    new Request(`http://127.0.0.1${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'status', payload: {} }),
    }),
  )
  check('a well-formed call answers 200', statusResponse.status === 200)
  const statusBody = await statusResponse.json()
  check('the envelope round-trips', statusBody.ok === true && statusBody.value?.skillVersion === '1.0.5')

  const failureResponse = await route.fetch(
    new Request(`http://127.0.0.1${RPC_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'shelf', payload: {} }),
    }),
  )
  const failureBody = await failureResponse.json()
  check(
    'a business failure still answers 200 with ok:false',
    failureResponse.status === 200 && failureBody.ok === false && failureBody.error?.code === 'weread/bad-api-key',
    JSON.stringify(failureBody),
  )

  const garbageResponse = await route.fetch(
    new Request(`http://127.0.0.1${RPC_PATH}`, { method: 'POST', body: 'not json' }),
  )
  const garbageBody = await garbageResponse.json()
  check('a non-JSON body is rejected as a value', garbageBody.ok === false && garbageBody.error?.code === 'weread/bad-request')

  console.log('\nevery documented operation is reachable')
  {
    // A method the service owns but `dispatch` never routes is invisible to
    // the panel, so each operation the client can ask for is named here.
    const operations = [
      ['status', {}],
      ['readerStatus', {}],
      ['progress', { bookId: '1' }],
      ['current', {}],
      ['book', { bookId: '1' }],
      ['notes', { bookId: '1' }],
      ['notebooks', {}],
      ['stats', { mode: 'monthly' }],
      ['search', { keyword: 'x' }],
      ['chapter', { bookId: '1', chapterUid: 1 }],
      ['reportProgress', { bookId: '1', chapterUid: 1 }],
    ]
    for (const [endpoint, payload] of operations) {
      const result = await service.handleRpc(endpoint, payload)
      check(
        `${endpoint} is routed`,
        result.error?.code !== 'weread/unknown-endpoint',
        JSON.stringify(result.error),
      )
    }
  }

  console.log('\nunknown endpoint')
  const unknown = await service.handleRpc('nope', {})
  check('unknown operations fail cleanly', unknown.ok === false && unknown.error?.code === 'weread/unknown-endpoint')

  console.log('\ntool output formatting')
  {
    // The tools are driven directly with canned service results, so the text
    // they hand the model is asserted without touching the network.
    const tools = new Map()
    const ctx = {
      tools: { register: (definition) => { tools.set(definition.name, definition); return () => {} } },
      effect: (callback) => { callback(); return () => {} },
    }
    registerTools(ctx, {
      current: async () => ({
        book: { bookId: '1', title: '某书', author: '某人', readUpdateDate: '2026-10-13', finishReading: false },
        progress: { progress: 3 },
      }),
      notes: async () => ({ highlightCount: 0, thoughtCount: 0, chapters: [] }),
      shelf: async () => ({ totalCount: 59, books: [{ bookId: '1', title: '某书', author: '某人', readUpdateTime: 1, readUpdateDate: '2026-10-13' }], albums: [], hasMp: true }),
      stats: async () => ({
        totalReadTime: 38220,
        readDays: 10,
        dayAverageReadTime: 2940,
        compare: -0.0389,
        preferCategory: [
          { categoryTitle: '心理', parentCategoryTitle: '心理', readingTime: 31970 },
          { parentCategoryTitle: '经济理财', readingTime: 9960 },
        ],
      }),
      search: async () => ({ keyword: '示例关键词', count: 1, results: [{ bookId: '2000002', title: '示例书目', author: '示例作者乙', rating: 930, intro: '' }] }),
    })

    const run = async (name, args) => (await tools.get(name).execute(args, { signal: undefined })).text

    const current = await run('weread_current', { includeNotes: true })
    check('a book with no notes says so instead of going silent', current.includes('还没有划线或想法'), current.split('\n').slice(-1)[0])

    const shelf = await run('weread_shelf', {})
    check('the shelf header states every kind and adds up', shelf.includes('电子书 1 · 有声书 0 · 公众号 1'), shelf.split('\n')[0])

    const stats = await run('weread_stats', { mode: 'monthly' })
    check('the comparison is a signed percentage', stats.includes('较上期 -3.9%'), stats)
    check('no raw float survives', !stats.includes('0.0389'))
    check('preferred categories are named', stats.includes('心理') && stats.includes('经济理财'), stats)
    check('category reading time is rendered', stats.includes('8 小时 53 分钟'), stats)
    check('the daily average is labelled as a calendar-day figure', stats.includes('日均（按自然日）'))

    const search = await run('weread_search', { keyword: '示例关键词' })
    check('the score is an unambiguous recommendation', search.includes('推荐值 93.0%'), search)
  }

  console.log('\ntool surface')
  const registered = []
  const fakeTools = { register: (definition) => { registered.push(definition); return () => {} } }
  registerTools({ tools: fakeTools, effect: (callback) => { callback(); return () => {} } }, service)
  check('five tools register', registered.length === 5, `got ${registered.length}`)
  check(
    'every tool declares a renderable output schema',
    registered.every((tool) => typeof tool.output?.render === 'function' && tool.output.schema.type === 'object'),
  )
  check(
    'every tool name is weread_-prefixed',
    registered.every((tool) => tool.name.startsWith('weread_')),
  )
} finally {
  await rm(dataDir, { recursive: true, force: true })
}

console.log(`\n${checks - failures}/${checks} checks passed`)
process.exit(failures === 0 ? 0 : 1)
