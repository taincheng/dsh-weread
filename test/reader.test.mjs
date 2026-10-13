/**
 * Web reader test.
 *
 * Exercises the whole chapter path against a stubbed `fetch`: reader-page
 * state parsing, EPUB vs TXT format detection, shard verification, decoding,
 * paragraph extraction, session gating and cookie refresh.
 *
 * The fixtures are built with a small encoder that is the exact inverse of the
 * decoder (the swap step is an involution), so a passing round trip proves the
 * decoder against real-shaped shards rather than hand-written samples.
 *
 * Run: node test/reader.test.mjs
 */

import { md5Hex, decodeContentShards, reverseSwaps, swapPositions } from '../lib/crypto.js'
import { WereadWebReader, htmlToParagraphs, textToParagraphs, USER_AGENT } from '../lib/reader.js'

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

/**
 * Encode plaintext into a shard the decoder accepts: the inverse of
 * `decodeEncodedPayload`, wrapped in the MD5 prefix `checkedBody` verifies.
 *
 * `reverseSwaps` is a composition of transpositions applied in one order, so
 * its inverse applies the same transpositions in the opposite order — which is
 * what `forwardSwaps` does here.
 */
function forwardSwaps(encoded, positions) {
  const chars = encoded.split('')
  for (let i = 1; i < positions.length; i += 2) {
    for (const k of [0, 1]) {
      const left = positions[i] + k
      const right = positions[i - 1] + k
      if (left < 0 || right < 0 || left >= chars.length || right >= chars.length) continue
      const held = chars[left]
      chars[left] = chars[right]
      chars[right] = held
    }
  }
  return chars.join('')
}

/**
 * Encode plaintext into the shard set the decoder accepts.
 *
 * The decoder concatenates the shard bodies first and only then drops the
 * leading character and undoes the swaps, so the encoding must be done on the
 * whole content and only afterwards split into per-shard MD5-wrapped pieces.
 */
function encodeShards(plaintext, parts) {
  const binary = Buffer.from(plaintext, 'utf8').toString('latin1')
  const base64 = Buffer.from(binary, 'latin1').toString('base64').replace(/=+$/, '')
  const core = forwardSwaps(base64, swapPositions(base64))
  const payload = `X${core}`
  const size = Math.ceil(payload.length / parts)
  const shards = []
  for (let index = 0; index < payload.length; index += size) {
    const body = payload.slice(index, index + size)
    shards.push(md5Hex(body).toUpperCase() + body)
  }
  return shards
}

/** One shard, for the single-shard cases. */
function encodeShard(plaintext) {
  return encodeShards(plaintext, 1)[0]
}

console.log('\nencoder round trip')
check('a synthetic shard decodes back to its text', decodeContentShards(encodeShard('第一段和第二段')) === '第一段和第二段')
check(
  'forwardSwaps inverts reverseSwaps',
  reverseSwaps(forwardSwaps('abcdefghijk', swapPositions('abcdefghijk')), swapPositions('abcdefghijk')) === 'abcdefghijk',
)

console.log('\nparagraph extraction')
const xhtml = '<html><head><style>p{}</style></head><body><p>第一段</p><p>Second &amp; third</p><br/><div>　</div><p>  </p></body></html>'
check('XHTML becomes clean paragraphs', JSON.stringify(htmlToParagraphs(xhtml)) === JSON.stringify(['第一段', 'Second & third']), JSON.stringify(htmlToParagraphs(xhtml)))
check('script and style bodies never leak', htmlToParagraphs('<p>a</p><script>evil()</script><style>p{}</style>').join('|') === 'a')
check('entities are decoded', htmlToParagraphs('<p>&lt;tag&gt; &nbsp;&#39;q&#39; &#x4e2d;</p>').join('') === '<tag>  \'q\' 中')
check('TXT indentation is stripped', JSON.stringify(textToParagraphs('　　第一行\r\n第二行\n\n第三行')) === JSON.stringify(['第一行', '第二行', '第三行']))

/** Build a reader page whose embedded state the parser accepts. */
function readerPage(state) {
  return `<html><body><script>window.__INITIAL_STATE__ = ${JSON.stringify(state)}; (function(){})()</script></body></html>`
}

const STATE = { reader: { bookInfo: { bookId: '123', title: '测试书', author: '作者' }, psvts: 'psvts-value', pclts: 'pclts-value', token: 'token-value' } }

/** Install a stub fetch and return the recorded calls. */
function stubFetch(handler) {
  const calls = []
  const original = globalThis.fetch
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), method: init.method ?? 'GET', headers: init.headers ?? {}, body: init.body })
    return handler(String(url), init)
  }
  return { calls, restore: () => { globalThis.fetch = original } }
}

/** A JSON response helper. */
function jsonResponse(value) {
  return new Response(JSON.stringify(value), { status: 200, headers: { 'content-type': 'application/json' } })
}

/** A text response helper. */
function textResponse(value, headers = {}) {
  return new Response(value, { status: 200, headers: { 'content-type': 'text/plain', ...headers } })
}

console.log('\nsession gating')
{
  const reader = new WereadWebReader({ getCookie: () => '', getTimeoutMs: 5000 })
  check('no cookie means no session', reader.hasSession() === false)
  let code
  try {
    await reader.fetchChapter({ bookId: '123', chapterUid: 1 })
  } catch (error) {
    code = error.code
  }
  check('reading without a session fails as weread/needs-cookie', code === 'weread/needs-cookie', code)
}

console.log('\nEPUB chapter')
{
  const content = '<html><body><p>第一章第一段</p><p>第一章第二段</p></body></html>'
  const [e0, e1, e3] = encodeShards(content, 3)
  const shards = { '/web/book/chapter/e_0': e0, '/web/book/chapter/e_1': e1, '/web/book/chapter/e_3': e3 }
  const stub = stubFetch((url) => {
    if (url.includes('/web/reader/')) return textResponse(readerPage(STATE))
    const key = Object.keys(shards).find((path) => url.endsWith(path))
    if (key !== undefined) return textResponse(shards[key])
    return new Response('not found', { status: 404 })
  })
  try {
    const reader = new WereadWebReader({ getCookie: () => 'wr_vid=1; wr_skey=abc', getTimeoutMs: 5000 })
    const chapter = await reader.fetchChapter({ bookId: '123', chapterUid: 7, title: '第一章' })
    check('format detected as epub', chapter.format === 'epub', chapter.format)
    check('title is the catalog title', chapter.title === '第一章', chapter.title)
    check('paragraphs survive the round trip', chapter.paragraphs.join('|') === '第一章第一段|第一章第二段', chapter.paragraphs.join('|'))
    check('reader state carries psvts/token', chapter.readerState.psvts === 'psvts-value' && chapter.readerState.token === 'token-value')
    const post = stub.calls.find((call) => call.url.endsWith('/e_0'))
    check('content requests are POST with the session cookie', post.method === 'POST' && post.headers.cookie === 'wr_vid=1; wr_skey=abc')
    check('content requests carry the validated User-Agent', post.headers['user-agent'] === USER_AGENT)
    check('the signed body covers the reader timestamp', typeof JSON.parse(post.body).s === 'string' && JSON.parse(post.body).sc === 1)
  } finally {
    stub.restore()
  }
}

console.log('\nTXT chapter (EPUB endpoints answer with metadata)')
{
  const plain = '　　网文第一段\r\n网文第二段'
  const [t0, t1] = encodeShards(plain, 2)
  const stub = stubFetch((url) => {
    if (url.includes('/web/reader/')) return textResponse(readerPage(STATE))
    if (url.endsWith('/e_0')) return textResponse(JSON.stringify({ bookId: '123', format: 'txt' }))
    if (url.endsWith('/t_0')) return textResponse(t0)
    if (url.endsWith('/t_1')) return textResponse(t1)
    return new Response('not found', { status: 404 })
  })
  try {
    const reader = new WereadWebReader({ getCookie: () => 'wr_vid=1; wr_skey=abc', getTimeoutMs: 5000 })
    const chapter = await reader.fetchChapter({ bookId: '123', chapterUid: 7 })
    check('format detected as txt', chapter.format === 'txt', chapter.format)
    check('plain text became paragraphs', chapter.paragraphs.join('|') === '网文第一段|网文第二段', chapter.paragraphs.join('|'))
    check('the format is remembered for the next chapter', reader.formats.get('123') === 'txt')
    check('the EPUB probe happened exactly once', stub.calls.filter((call) => call.url.endsWith('/e_0')).length === 1)
  } finally {
    stub.restore()
  }
}

console.log('\nfailures')
{
  const emptyShard = stubFetch((url) => {
    if (url.includes('/web/reader/')) return textResponse(readerPage(STATE))
    return textResponse('{}')
  })
  try {
    const reader = new WereadWebReader({ getCookie: () => 'wr_vid=1; wr_skey=abc', getTimeoutMs: 5000 })
    let code
    try {
      await reader.fetchChapter({ bookId: '123', chapterUid: 7 })
    } catch (error) {
      code = error.code
    }
    check('an empty shard reports weread/empty-shard', code === 'weread/empty-shard', code)
  } finally {
    emptyShard.restore()
  }

  const noState = stubFetch(() => textResponse('<html>logged out</html>'))
  try {
    const reader = new WereadWebReader({ getCookie: () => 'wr_vid=1; wr_skey=abc', getTimeoutMs: 5000 })
    let code
    try {
      await reader.fetchChapter({ bookId: '123', chapterUid: 7 })
    } catch (error) {
      code = error.code
    }
    check('a logged-out reader page reports weread/no-reader-state', code === 'weread/no-reader-state', code)
  } finally {
    noState.restore()
  }

  const corrupt = stubFetch((url) => {
    if (url.includes('/web/reader/')) return textResponse(readerPage(STATE))
    return textResponse(`${'0'.repeat(32)}tampered`)
  })
  try {
    const reader = new WereadWebReader({ getCookie: () => 'wr_vid=1; wr_skey=abc', getTimeoutMs: 5000 })
    let message
    try {
      await reader.fetchChapter({ bookId: '123', chapterUid: 7 })
    } catch (error) {
      message = error.message
    }
    check('a tampered shard fails its MD5 check', typeof message === 'string' && message.includes('分片校验失败'), message)
  } finally {
    corrupt.restore()
  }
}

console.log('\ncookie refresh')
{
  let refreshed
  const stub = stubFetch((url) => {
    if (url.includes('/web/reader/')) {
      return textResponse(readerPage(STATE), { 'set-cookie': 'wr_skey=new-value; Path=/; HttpOnly' })
    }
    return textResponse(encodeShard('<p>a</p>'))
  })
  try {
    const reader = new WereadWebReader({
      getCookie: () => 'wr_vid=1; wr_skey=abc',
      getTimeoutMs: 5000,
      onCookieRefresh: (values) => {
        refreshed = values
      },
    })
    await reader.readerState('123', 7)
    check('rotated cookies are handed back to the store', Array.isArray(refreshed) && refreshed[0].startsWith('wr_skey=new-value'), JSON.stringify(refreshed))
  } finally {
    stub.restore()
  }
}

console.log(`\n${checks - failures}/${checks} reader checks passed`)
process.exit(failures === 0 ? 0 : 1)
