/**
 * Encoding parity test.
 *
 * The Web reader's `_e()` hash, request signature and shard decoder are
 * undocumented and easy to get subtly wrong, so this asserts the JavaScript
 * port against `test/fixtures/crypto-golden.json`: vectors produced by running
 * the validated Python reference (weread.koplugin
 * `scripts/fetch_weread_epub.py`) over 130+ inputs, including the three `_e()`
 * values the API reference documents and the six inputs the reference itself
 * rejects.
 *
 * Run: node test/crypto.test.mjs
 */

import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  decodeEncodedPayload,
  makeContentParams,
  makeReadParams,
  reverseSwaps,
  sortedQuery,
  swapPositions,
  webAppId,
  wereadE,
  wereadSign,
} from '../lib/crypto.js'

/** The User-Agent whose derived app id the reference validated. */
const USER_AGENT_FOR_TEST =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0'

const here = dirname(fileURLToPath(import.meta.url))
const golden = JSON.parse(readFileSync(join(here, 'fixtures', 'crypto-golden.json'), 'utf8'))

let failures = 0
let checks = 0

/** Compare one call against the reference's recorded outcome. */
function expect(label, expected, produce) {
  checks += 1
  let actual
  let threw
  try {
    actual = produce()
  } catch {
    threw = true
  }
  if (expected.error !== undefined) {
    if (threw) return
    failures += 1
    console.log(`  FAIL ${label} — reference raised ${expected.error}, ours returned ${JSON.stringify(actual)}`)
    return
  }
  if (threw) {
    failures += 1
    console.log(`  FAIL ${label} — ours threw, reference returned ${JSON.stringify(expected.ok)}`)
    return
  }
  if (JSON.stringify(actual) === JSON.stringify(expected.ok)) return
  failures += 1
  console.log(`  FAIL ${label}\n       expected ${JSON.stringify(expected.ok)}\n       actual   ${JSON.stringify(actual)}`)
}

for (const [input, expected] of Object.entries(golden.wereadE)) {
  expect(`wereadE(${JSON.stringify(input)})`, expected, () => wereadE(input))
}
for (const [query, expected] of Object.entries(golden.wereadSign)) {
  expect(`wereadSign(${JSON.stringify(query)})`, expected, () => wereadSign(query))
}
for (const [ua, expected] of Object.entries(golden.webAppId)) {
  expect(`webAppId(${JSON.stringify(ua)})`, expected, () => webAppId(ua))
}
for (const [input, expected] of Object.entries(golden.swapPositions)) {
  expect(`swapPositions(${JSON.stringify(input)})`, expected, () => swapPositions(input))
}
for (const [input, expected] of Object.entries(golden.reverseSwaps)) {
  expect(`reverseSwaps(${JSON.stringify(input)})`, expected, () => reverseSwaps(input, swapPositions(input)))
}
for (const [input, expected] of Object.entries(golden.decodeEncodedPayload)) {
  expect(`decodeEncodedPayload(${JSON.stringify(input)})`, expected, () => decodeEncodedPayload(input))
}

// The three values the API reference documents, asserted independently of the
// fixture so a regenerated fixture cannot silently move the target.
checks += 3
for (const [input, expected] of [
  ['43208843', 'c9c321c07293508bc9c79df'],
  ['2', 'c81322c012c81e728d9d180'],
  ['119', '07e323f027707e1cd7dc674'],
]) {
  if (wereadE(input) !== expected) {
    failures += 1
    console.log(`  FAIL documented wereadE(${input}) — expected ${expected}, got ${wereadE(input)}`)
  }
}

// The canonical query the signature covers: sorted keys, JavaScript value
// spelling, and strict percent-encoding.
checks += 1
const query = sortedQuery({ st: 0, sc: 1, prevChapter: false, c: 'abc', b: 'xyz' })
if (query !== 'b=xyz&c=abc&prevChapter=false&sc=1&st=0') {
  failures += 1
  console.log(`  FAIL sortedQuery — got ${JSON.stringify(query)}`)
}

// Real request shapes, including a Chinese `sm`, compared against the
// reference's own `sorted_query` and the signatures it derives from them.
const CONTENT_PARAMS = {
  b: 'c9c321c07293508bc9c79df',
  c: 'c81322c012c81e728d9d180',
  r: '1234567',
  ct: '1759999999',
  ps: 'psvts-value',
  pc: '07e323f027707e1cd7dc674',
  sc: 1,
  prevChapter: false,
  st: 0,
}
const READ_PARAMS = {
  appId: 'wb115321887466h529830856',
  b: 'c9c321c07293508bc9c79df',
  c: 'c81322c012c81e728d9d180',
  ci: 2,
  co: 1543,
  sm: '第一段正文的开头二十个字',
  pr: 37,
  rt: 30,
  ts: 1759999999123,
  rn: 123,
  sg: 'a'.repeat(64),
  ct: 1759999999,
  ps: 'psvts-value',
  pc: '07e323f027707e1cd7dc674',
}

for (const [name, params] of [
  ['content', CONTENT_PARAMS],
  ['read', READ_PARAMS],
  ['style', { ...CONTENT_PARAMS, st: 1 }],
]) {
  checks += 2
  const produced = sortedQuery(params)
  if (produced !== golden.sortedQuery[name]) {
    failures += 1
    console.log(`  FAIL sortedQuery(${name})\n       expected ${golden.sortedQuery[name]}\n       actual   ${produced}`)
  }
  const signed = wereadSign(produced)
  const expectedSignature = golden.sortedQuery[`${name}Signed`]
  if (signed !== expectedSignature) {
    failures += 1
    console.log(`  FAIL wereadSign(${name}) — expected ${expectedSignature}, got ${signed}`)
  }
}

// A request body must be signed over its own canonical form, and must carry
// the shard flags the endpoint expects.
checks += 6
for (const style of [false, true]) {
  const params = makeContentParams({
    bookId: '43208843',
    chapterUid: 119,
    psvts: 'psvts-value',
    style,
    now: 1759999999000,
  })
  const { s, ...rest } = params
  if (s !== wereadSign(sortedQuery(rest))) {
    failures += 1
    console.log(`  FAIL makeContentParams(style=${String(style)}) is not signed over its own query`)
  }
  if (params.st !== (style ? 1 : 0) || params.sc !== 1 || params.prevChapter !== false) {
    failures += 1
    console.log(`  FAIL makeContentParams(style=${String(style)}) carries the wrong shard flags`)
  }
}
{
  // The documented guard: a `ct` whose hash equals `psvts` must be bumped.
  checks += 1
  const psvts = wereadE('1759999999')
  const params = makeContentParams({ bookId: '1', chapterUid: 2, psvts, now: 1759999999000 })
  if (params.ct !== '1760000000') {
    failures += 1
    console.log(`  FAIL makeContentParams did not bump a colliding ct — got ${params.ct}`)
  }
}

// The progress report's own derived fields.
checks += 3
{
  const params = makeReadParams({
    bookId: '43208843',
    chapterUid: 119,
    chapterIdx: 2,
    chapterOffset: 1543,
    progress: 37,
    summary: '第一段正文的开头二十个字',
    psvts: 'psvts-value',
    pclts: 'pclts-value',
    token: 'token-value',
    elapsedSeconds: 30,
    userAgent: USER_AGENT_FOR_TEST,
    now: 1759999999123,
  })
  const { s, ...rest } = params
  if (s !== wereadSign(sortedQuery(rest))) {
    failures += 1
    console.log('  FAIL makeReadParams is not signed over its own query')
  }
  const expectedSg = createHash('sha256').update(`${params.ts}${params.rn}token-value`, 'utf8').digest('hex')
  if (params.sg !== expectedSg) {
    failures += 1
    console.log(`  FAIL makeReadParams sg — expected ${expectedSg}, got ${params.sg}`)
  }
  if (params.appId !== webAppId(USER_AGENT_FOR_TEST)) {
    failures += 1
    console.log(`  FAIL makeReadParams appId — got ${params.appId}`)
  }
}

console.log(`${checks - failures}/${checks} parity checks passed`)
process.exit(failures === 0 ? 0 : 1)
