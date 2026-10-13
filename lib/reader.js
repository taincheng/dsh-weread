/**
 * The Web reader: the only part of this plugin that talks to `weread.qq.com`
 * rather than the official Agent Gateway.
 *
 * The official gateway deliberately exposes no chapter body, so reading text
 * inside DSH uses the same authenticated Web flow the browser reader uses:
 * fetch the reader page for `psvts`/`token`, then request the chapter's
 * content shards with a signed body and decode them.
 *
 * This is the user's own logged-in session reading the user's own entitled
 * content, and it is used only to render text in the panel.
 *
 * @module dsh-weread/lib/reader
 */

import {
  decodeContentShards,
  makeContentParams,
  makeReadParams,
  readerUrlFor,
  sortedQuery,
  wereadSign,
} from './crypto.js'

/** The UA the reference implementation validated; `appId` is derived from it. */
export const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/135.0.0.0 Safari/537.36 Edg/135.0.0.0'

/** A reader-flow failure carrying a code the panel can act on. */
export class WereadReaderError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'WereadReaderError'
    this.code = code
    this.details = details ?? {}
  }
}

/** Combine a caller signal with a request deadline. */
function withDeadline(signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs)
  return signal === undefined ? deadline : AbortSignal.any([signal, deadline])
}

/** Decode the small set of entities WeRead's XHTML actually uses. */
function decodeEntities(text) {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => String.fromCodePoint(Number.parseInt(dec, 10)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&amp;/gi, '&')
}

/**
 * Flatten chapter XHTML into readable paragraphs.
 *
 * The panel renders text, not markup: stripping tags here means no sanitizer
 * is needed in the browser and no remote resource is ever fetched by the
 * panel.
 * @param html - decoded chapter XHTML.
 * @returns one string per non-empty paragraph.
 */
export function htmlToParagraphs(html) {
  const text = html
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|h[1-6]|li|blockquote|section|article|tr|td)>/gi, '\n')
    .replace(/<[^>]*>/g, '')
  return decodeEntities(text)
    .split('\n')
    .map((line) => line.replace(/[\s\u3000]+$/u, '').trim())
    .filter((line) => line.length > 0)
}

/** Split decoded plain text (the TXT book format) into paragraphs. */
export function textToParagraphs(text) {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/^[\s\u3000]+/u, '').replace(/[\s\u3000]+$/u, ''))
    .filter((line) => line.length > 0)
}

export class WereadWebReader {
  /**
   * @param options - session wiring.
   * @param options.getCookie - current `Cookie:` header value.
   * @param options.getTimeoutMs - per-request deadline.
   * @param options.onCookieRefresh - receives refreshed `Set-Cookie` values.
   * @param options.logger - host logger.
   */
  constructor({ getCookie, getTimeoutMs, onCookieRefresh, logger }) {
    this.getCookie = getCookie
    // Accept either a reader or a plain value, so a caller cannot silently
    // hand over a number where a function is expected.
    this.timeoutMs = typeof getTimeoutMs === 'function' ? getTimeoutMs : () => getTimeoutMs ?? 20000
    this.onCookieRefresh = onCookieRefresh
    this.logger = logger
    /** Per-book format memory, so only the first chapter pays the probe. */
    this.formats = new Map()
  }

  /** True when a usable Web session is configured. */
  hasSession() {
    const cookie = this.getCookie()
    return typeof cookie === 'string' && cookie.includes('wr_vid=') && cookie.includes('wr_skey=')
  }

  /** One request against weread.qq.com with the stored session. */
  async request(url, { method = 'GET', body, referer = 'https://weread.qq.com/', accept, signal } = {}) {
    if (!this.hasSession()) {
      throw new WereadReaderError(
        'weread/needs-cookie',
        '尚未配置阅读器 Cookie。要在这个侧边栏里直接读正文，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    const headers = {
      accept: accept ?? 'application/json, text/plain, */*',
      origin: 'https://weread.qq.com',
      referer,
      'user-agent': USER_AGENT,
      cookie: this.getCookie(),
    }
    if (body !== undefined) headers['content-type'] = 'application/json;charset=UTF-8'

    let response
    try {
      response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        redirect: 'follow',
        signal: withDeadline(signal, this.timeoutMs()),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new WereadReaderError('weread/timeout', '请求微信读书网页阅读器超时。')
      }
      if (signal?.aborted === true) throw error
      throw new WereadReaderError('weread/network', `无法连接微信读书：${error?.message ?? String(error)}`)
    }

    const refreshed = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : []
    if (refreshed.length > 0 && typeof this.onCookieRefresh === 'function') {
      this.onCookieRefresh(refreshed)
    }
    if (!response.ok) {
      throw new WereadReaderError(
        `weread/web-http-${response.status}`,
        `微信读书返回 HTTP ${response.status}。`,
      )
    }
    return response
  }

  /**
   * Refresh the Web session before a content request, as the reader does.
   * @returns true when the server reported success.
   */
  async renew(signal) {
    const response = await this.request('https://weread.qq.com/web/login/renewal', {
      method: 'POST',
      body: { rq: '%2Fweb%2Fbook%2Fread', ql: false },
      signal,
    })
    const payload = await response.json().catch(() => ({}))
    return payload?.succ === 1 || payload?.succ === true
  }

  /**
   * Read the reader page's embedded state for one book/chapter.
   * @returns `psvts`, `pclts`, `token` and the reader's own position model.
   */
  async readerState(bookId, chapterUid, signal) {
    const url = readerUrlFor(bookId, chapterUid)
    const response = await this.request(url, {
      referer: url,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      signal,
    })
    const html = await response.text()
    const match = /window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*;\s*\(function/s.exec(html)
    if (match === null) {
      throw new WereadReaderError(
        'weread/no-reader-state',
        '没有从微信读书阅读页里解析到初始状态，Cookie 可能已失效，请重新登录后更新 Cookie。',
      )
    }
    let state
    try {
      state = JSON.parse(match[1])
    } catch {
      throw new WereadReaderError('weread/bad-reader-state', '微信读书阅读页的状态数据无法解析。')
    }
    const reader = state?.reader ?? {}
    const bookInfo = reader?.bookInfo ?? {}
    if (!reader.psvts) {
      throw new WereadReaderError(
        'weread/no-psvts',
        '阅读页没有返回 psvts，通常意味着登录已过期或该书不在你的权限范围内。',
      )
    }
    return {
      bookId: String(bookInfo.bookId ?? bookId),
      bookTitle: String(bookInfo.title ?? ''),
      author: String(bookInfo.author ?? ''),
      psvts: String(reader.psvts),
      pclts: reader.pclts === undefined ? '' : String(reader.pclts),
      token: String(reader.token ?? ''),
      currentChapter: reader.currentChapter ?? {},
      progress: reader.progress ?? {},
    }
  }

  /**
   * Fetch and decode one chapter.
   * @param options - the book, chapter metadata and the caller's signal.
   * @returns title, format and readable paragraphs.
   */
  async fetchChapter({ bookId, chapterUid, title, signal }) {
    const state = await this.readerState(bookId, chapterUid, signal)
    const referer = readerUrlFor(bookId, chapterUid)

    const post = async (endpoint, { style = false } = {}) => {
      const body = makeContentParams({ bookId, chapterUid, psvts: state.psvts, style, sc: 1 })
      const response = await this.request(`https://weread.qq.com${endpoint}`, {
        method: 'POST',
        body,
        referer,
        signal,
      })
      const text = await response.text()
      if (text === '{}') {
        throw new WereadReaderError(
          'weread/empty-shard',
          `微信读书返回了空分片（${endpoint}）。常见原因是 Cookie 过期、该书不在你的权限内，或章节需要付费。`,
        )
      }
      return text
    }

    // TXT-format books answer the EPUB endpoints with chapter metadata JSON
    // instead of an encoded payload, which is how the format is detected.
    let format = this.formats.get(bookId)
    if (format !== 'txt') {
      const first = await post('/web/book/chapter/e_0')
      if (first.startsWith('{') && first.includes('"bookId"')) {
        format = 'txt'
      } else {
        format = 'epub'
        const [e1, e3] = [await post('/web/book/chapter/e_1'), await post('/web/book/chapter/e_3')]
        const html = decodeContentShards(first, e1, e3)
        this.formats.set(bookId, format)
        return {
          bookId,
          chapterUid,
          title: title ?? state.bookTitle,
          format,
          paragraphs: htmlToParagraphs(html),
          readerState: state,
        }
      }
    }

    this.formats.set(bookId, 'txt')
    const t0 = await post('/web/book/chapter/t_0')
    let t1 = ''
    try {
      t1 = await post('/web/book/chapter/t_1')
    } catch {
      // Short chapters have no second shard.
    }
    const plain = decodeContentShards(t0, t1, '')
    return {
      bookId,
      chapterUid,
      title: title ?? state.bookTitle,
      format: 'txt',
      paragraphs: textToParagraphs(plain),
      readerState: state,
    }
  }

  /**
   * Report reading progress back to WeRead.
   *
   * This is an account mutation and is only ever called when the row's
   * `syncProgress` is enabled and the user asks for it.
   * @param options - the exact position being reported.
   */
  async reportRead({
    bookId,
    chapterUid,
    chapterIdx,
    chapterOffset,
    progress,
    summary,
    elapsedSeconds,
    psvts,
    pclts,
    token,
    signal,
  }) {
    if (!psvts) {
      throw new WereadReaderError('weread/no-reader-state', '缺少阅读页状态，无法上报进度。')
    }
    const body = makeReadParams({
      bookId,
      chapterUid,
      chapterIdx,
      chapterOffset,
      progress,
      summary,
      psvts,
      pclts,
      token,
      elapsedSeconds,
      userAgent: USER_AGENT,
    })
    const response = await this.request('https://weread.qq.com/web/book/read', {
      method: 'POST',
      body,
      referer: readerUrlFor(bookId, chapterUid),
      signal,
    })
    return response.json().catch(() => ({}))
  }

  /**
   * Fetch the Web catalog, which needs only the browser session (no API key).
   * @param bookId - the book whose catalog is requested.
   * @returns normalized chapters, in reading order.
   */
  async webCatalog(bookId, signal) {
    const response = await this.request('https://weread.qq.com/web/book/chapterInfos', {
      method: 'POST',
      body: this.catalogBody(bookId),
      signal,
    })
    const payload = await response.json().catch(() => undefined)
    const candidates = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.data)
        ? payload.data
        : Array.isArray(payload?.books)
          ? payload.books
          : [payload]
    for (const item of candidates) {
      if (item === null || typeof item !== 'object') continue
      const id = String(item.bookId ?? item.book?.bookId ?? '')
      if (id !== bookId) continue
      const chapters = item.updated ?? item.chapterInfos ?? item.chapters ?? []
      return chapters
        .filter((chapter) => chapter !== null && typeof chapter === 'object' && chapter.chapterUid)
        .map((chapter) => ({
          chapterUid: Number(chapter.chapterUid),
          chapterIdx: Number(chapter.chapterIdx ?? 0),
          title: String(chapter.title ?? ''),
          level: Number(chapter.level ?? 0),
          wordCount: Number(chapter.wordCount ?? 0),
        }))
    }
    throw new WereadReaderError('weread/no-catalog', '没有从微信读书网页接口拿到这本书的目录。')
  }

  /**
   * Build the catalog request body for the Web catalog endpoint.
   * @param bookId - the book whose catalog is requested.
   */
  catalogBody(bookId) {
    return { bookIds: [bookId] }
  }

  /** Expose the signature helper so callers can sign custom bodies consistently. */
  static sign(params) {
    return wereadSign(sortedQuery(params))
  }
}
