/**
 * The Web reader's encoding primitives, ported from the validated reference
 * implementation (weread.koplugin `scripts/fetch_weread_epub.py`).
 *
 * Three pieces matter, and all three are exact ports rather than
 * reinterpretations:
 *
 *  1. `wereadE` — the `_e()` book/chapter/timestamp hash used in reader URLs,
 *     request fields and progress reports.
 *  2. `wereadSign` — the request signature. It uses shifts up to 29 bits on
 *     values up to 16 bits, so JavaScript's 32-bit `<<` would silently
 *     truncate; every step here multiplies and reduces modulo 2^31 instead.
 *  3. `decodeEncodedPayload` — the shard decoder: drop the first character,
 *     undo WeRead's character swaps, base64url-decode, then repair the UTF-8
 *     sequences that the byte-level round trip split.
 *
 * Pure functions only: no network, no state, so the whole chain is testable
 * against the Python reference.
 *
 * @module dsh-weread/lib/crypto
 */

import { createHash } from 'node:crypto'

/** 2^31, the modulus the reference applies after every step. */
const MOD = 2147483648

/** MD5 hex digest of a UTF-8 string. */
export function md5Hex(value) {
  return createHash('md5').update(value, 'utf8').digest('hex')
}

/** Interpret a binary digit string as a base-4 number, as `int(bin(n)[2:], 4)` does. */
function binaryDigitsAsBase4(binary) {
  let value = 0
  for (let index = 0; index < binary.length; index += 1) {
    value = value * 4 + (binary.charCodeAt(index) - 48)
  }
  return value
}

/**
 * The `_e()` hash.
 * @param value - bookId, chapterUid or a Unix-second timestamp.
 * @returns the opaque hash WeRead expects.
 */
export function wereadE(value) {
  const text = String(value)
  const digest = md5Hex(text)
  let result = digest.slice(0, 3)

  let chunks
  let typeFlag
  if (/^\d+$/.test(text)) {
    chunks = []
    for (let index = 0; index < text.length; index += 9) {
      chunks.push(Number.parseInt(text.slice(index, index + 9), 10).toString(16))
    }
    typeFlag = '3'
  } else {
    let codes = ''
    for (let index = 0; index < text.length; index += 1) {
      codes += text.charCodeAt(index).toString(16)
    }
    chunks = [codes]
    typeFlag = '4'
  }

  result += typeFlag
  result += `2${digest.slice(-2)}`

  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index]
    result += chunk.length.toString(16).padStart(2, '0') + chunk
    if (index < chunks.length - 1) result += 'g'
  }

  if (result.length < 20) result += digest.slice(0, 20 - result.length)

  return result + md5Hex(result).slice(0, 3)
}

/**
 * The request signature.
 * @param query - the sorted, percent-encoded query string.
 * @returns the lowercase hex signature.
 */
export function wereadSign(query) {
  let a = 0x15051505
  let b = a
  const length = query.length
  for (let i = length - 1; i > 0; i -= 2) {
    // Multiply instead of `<<`: shifts reach 29 bits and the operand 16 bits.
    const left = (query.charCodeAt(i) * 2 ** ((length - i) % 30)) % MOD
    const right = (query.charCodeAt(i - 1) * 2 ** (i % 30)) % MOD
    a = (a ^ left) % MOD
    b = (b ^ right) % MOD
  }
  return (a + b).toString(16).toLowerCase()
}

/** Python `urllib.parse.quote(value, safe='')`, which also escapes `!*'()`. */
function quoteStrict(value) {
  return encodeURIComponent(value).replace(
    /[!*'()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  )
}

/** JavaScript spelling of a value, then percent-encoded, as the reference builds it. */
function jsString(value) {
  if (value === true) return 'true'
  if (value === false) return 'false'
  if (value === null || value === undefined) return 'null'
  return String(value)
}

/**
 * Build the canonical query string the signature covers.
 * @param params - the request fields, excluding `s`.
 * @returns `key=value` pairs sorted by key and joined with `&`.
 */
export function sortedQuery(params) {
  return Object.keys(params)
    .sort()
    .map((key) => `${key}=${quoteStrict(jsString(params[key]))}`)
    .join('&')
}

/**
 * Derive the deterministic browser app id from a User-Agent.
 * @param userAgent - the exact UA sent with content requests.
 */
export function webAppId(userAgent) {
  const prefix = userAgent
    .split(' ')
    .slice(0, 12)
    .map((part) => String(part.length % 10))
    .join('')
  let value = 0
  for (let index = 0; index < userAgent.length; index += 1) {
    value = (131 * value + userAgent.charCodeAt(index)) % MOD
  }
  return `wb${prefix}h${value}`
}

/**
 * Positions WeRead swapped while encoding, recovered from the tail characters.
 * @param encoded - the payload without its leading character.
 */
export function swapPositions(encoded) {
  const length = encoded.length
  if (length < 4) return []
  if (length < 11) return [0, 2]

  const n = Math.min(4, Math.floor((length + 9) / 10))
  let tmp = ''
  for (let i = length - 1; i > length - n - 1; i -= 1) {
    tmp += String(binaryDigitsAsBase4(encoded.charCodeAt(i).toString(2)))
  }

  const result = []
  const m = length - n - 2
  if (m <= 0) return []
  const step = String(m).length
  let i = 0
  while (result.length < 10 && i + step < tmp.length) {
    result.push(Number.parseInt(tmp.slice(i, i + step), 10) % m)
    result.push(Number.parseInt(tmp.slice(i + 1, i + 1 + step), 10) % m)
    i += step
  }
  return result
}

/**
 * Undo the swaps, in the reference's own order.
 * @param encoded - the payload without its leading character.
 * @param positions - the pairs `swapPositions` recovered.
 */
export function reverseSwaps(encoded, positions) {
  const chars = encoded.split('')
  for (let i = positions.length - 1; i > 0; i -= 2) {
    for (const k of [1, 0]) {
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
 * Rebuild UTF-8 sequences from the byte-per-character string base64 produced.
 * @param binaryText - a latin-1 view of the decoded bytes.
 */
export function repairUtf8(binaryText) {
  const out = []
  let i = 0
  while (i < binaryText.length) {
    const b0 = binaryText.charCodeAt(i)
    if (b0 >= 0xc0 && b0 <= 0xdf && i + 1 < binaryText.length) {
      const b1 = binaryText.charCodeAt(i + 1)
      if (b1 >= 0x80 && b1 <= 0xbf) {
        out.push(String.fromCharCode(((b0 & 0x1f) << 6) | (b1 & 0x3f)))
        i += 2
        continue
      }
    }
    if (b0 >= 0xe0 && b0 <= 0xef && i + 2 < binaryText.length) {
      const b1 = binaryText.charCodeAt(i + 1)
      const b2 = binaryText.charCodeAt(i + 2)
      if (b1 >= 0x80 && b1 <= 0xbf && b2 >= 0x80 && b2 <= 0xbf) {
        out.push(String.fromCharCode(((b0 & 0x0f) << 12) | ((b1 & 0x3f) << 6) | (b2 & 0x3f)))
        i += 3
        continue
      }
    }
    if (b0 >= 0xf0 && b0 <= 0xf7 && i + 3 < binaryText.length) {
      const b1 = binaryText.charCodeAt(i + 1)
      const b2 = binaryText.charCodeAt(i + 2)
      const b3 = binaryText.charCodeAt(i + 3)
      if (b1 >= 0x80 && b1 <= 0xbf && b2 >= 0x80 && b2 <= 0xbf && b3 >= 0x80 && b3 <= 0xbf) {
        const codepoint = ((b0 & 0x07) << 18) | ((b1 & 0x3f) << 12) | ((b2 & 0x3f) << 6) | (b3 & 0x3f)
        out.push(String.fromCodePoint(codepoint))
        i += 4
        continue
      }
    }
    out.push(binaryText[i])
    i += 1
  }
  return out.join('')
}

/**
 * Decode one payload: drop the leading character, undo the swaps, base64url
 * decode and repair UTF-8.
 * @param encodedPayload - the concatenated shard bodies.
 */
export function decodeEncodedPayload(encodedPayload) {
  if (encodedPayload.length === 0) return ''
  const encoded = encodedPayload.slice(1)
  const reordered = reverseSwaps(encoded, swapPositions(encoded))
  const base64 = reordered
    .replace(/-/g, '+')
    .replace(/_/g, '/')
    .replace(/[^A-Za-z0-9+/]/g, '')
  // Match the reference's strictness: a length of 4n+1 is not decodable, and
  // silently returning garbage would hide a corrupt shard.
  if (base64.length % 4 === 1) {
    throw new Error('微信读书分片不是合法的 base64 负载。')
  }
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const binary = Buffer.from(base64 + padding, 'base64').toString('latin1')
  return repairUtf8(binary)
}

/**
 * Verify and strip a shard's MD5 prefix.
 * @param responseText - the raw shard response.
 * @returns the payload, or an empty string for an empty/short shard.
 */
export function checkedBody(responseText) {
  if (responseText.length <= 32) return ''
  const expected = responseText.slice(0, 32)
  const body = responseText.slice(32)
  const actual = md5Hex(body).toUpperCase()
  if (actual !== expected) {
    throw new Error(`微信读书分片校验失败：期望 ${expected}，实际 ${actual}`)
  }
  return body
}

/**
 * Decode a chapter's content shards. EPUB uses e_0/e_1/e_3; TXT uses
 * t_0/t_1 with an empty third shard.
 * @param shards - the raw shard responses, in order.
 */
export function decodeContentShards(...shards) {
  return decodeEncodedPayload(shards.map(checkedBody).join(''))
}

/**
 * Build the signed content-request body for one shard endpoint.
 * @param options - book, chapter, reader state and the shard's own flags.
 */
export function makeContentParams({ bookId, chapterUid, psvts, style = false, sc = 1, now = Date.now() }) {
  let ctValue = Math.floor(now / 1000)
  let ct = String(ctValue)
  if (wereadE(ct) === psvts) {
    ctValue += 1
    ct = String(ctValue)
  }
  const params = {
    b: wereadE(bookId),
    c: wereadE(chapterUid),
    r: String(Math.floor(Math.random() * 10000) ** 2),
    ct,
    ps: psvts,
    pc: wereadE(ct),
    sc,
    prevChapter: false,
    st: style ? 1 : 0,
  }
  params.s = wereadSign(sortedQuery(params))
  return params
}

/**
 * Build the signed reading-progress report body.
 * @param options - current position, reader state and elapsed reading time.
 */
export function makeReadParams({
  bookId,
  chapterUid,
  chapterIdx,
  chapterOffset,
  progress,
  summary,
  psvts,
  pclts,
  token,
  elapsedSeconds = 0,
  userAgent,
  now = Date.now(),
}) {
  const ts = now
  const rn = Math.floor(Math.random() * 1000)
  const ct = Math.floor(ts / 1000)
  let pc = pclts
  if (pc === undefined || pc === null || String(pc) === '' || String(pc) === '0') pc = wereadE(ct)
  const params = {
    appId: webAppId(userAgent),
    b: wereadE(bookId),
    c: wereadE(chapterUid || 0),
    ci: Math.trunc(chapterIdx || 0),
    co: Math.trunc(chapterOffset || 0),
    sm: String(summary || '').slice(0, 20),
    pr: progress,
    rt: Math.max(0, Math.trunc(elapsedSeconds || 0)),
    ts,
    rn,
    sg: createHash('sha256').update(`${ts}${rn}${token}`, 'utf8').digest('hex'),
    ct,
    ps: psvts,
    pc,
  }
  params.s = wereadSign(sortedQuery(params))
  return params
}

/** The reader URL for a book, optionally positioned at one chapter. */
export function readerUrlFor(bookId, chapterUid) {
  const base = `https://weread.qq.com/web/reader/${wereadE(bookId)}`
  return chapterUid === undefined || chapterUid === null ? base : `${base}k${wereadE(chapterUid)}`
}
