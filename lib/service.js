/**
 * The WeRead service: one owner of credentials, gateway calls, caching, and
 * the client-callable operations.
 *
 * Every operation is implemented exactly once here. The agent tools and the
 * sidebar panel both call these methods, so the two surfaces can never drift.
 * Errors carry a stable `code` so the panel can tell "not configured" from
 * "the gateway is unhappy".
 */

import { WereadGateway, WereadGatewayError, looksLikeApiKey, maskSecret } from './gateway.js'
import { WereadReaderError, WereadWebReader } from './reader.js'
import { cached, parseCookieHeader, resolveDataDir, WereadStore } from './store.js'

/** Shelf responses change slowly; progress is polled more often. */
const SHELF_TTL_MS = 5 * 60 * 1000
const NOTEBOOK_TTL_MS = 5 * 60 * 1000
const PROGRESS_TTL_MS = 30 * 1000
/** A decoded chapter never changes; keep it for a month. */
const CHAPTER_TTL_MS = 30 * 24 * 60 * 60 * 1000

/**
 * Reading-appearance defaults.
 *
 * `follow` inherits the Harness theme; the other three are the reader's own
 * palettes, which is the one place a literal colour is right: the reading
 * surface is content, not chrome.
 */
export const READER_DEFAULTS = {
  theme: 'follow',
  fontSize: 17,
  lineHeight: 1.9,
  fontFamily: 'system',
}

const READER_THEMES = ['follow', 'light', 'dark', 'sepia']
const READER_FAMILIES = ['system', 'serif', 'sans']

/**
 * Estimate a book's percentage from a reading position.
 *
 * Fitted against 44 real books: the chapter-ordinal model this replaces had a
 * mean absolute error of 12.2 points against WeRead's own number and landed
 * within 2 points only 20% of the time; weighting chapters by their word count
 * and adding the position inside the current chapter drops that to 4.6 points
 * and 75% respectively.
 *
 * It is still an estimate: WeRead's own model is not reproducible from
 * outside, and its percentage is partly recomputed server-side. The ordinal
 * model remains the fallback when a catalog carries no word counts.
 *
 * @param chapters - the catalog, in reading order.
 * @param index - the position of the current chapter, or -1 when unknown.
 * @param chapterOffset - position inside the chapter, in the catalog's units.
 */
export function estimateProgress(chapters, index, chapterOffset = 0) {
  if (!Array.isArray(chapters) || chapters.length === 0 || index < 0) return 0
  const total = chapters.reduce((sum, chapter) => sum + (chapter.wordCount || 0), 0)
  if (total <= 0) return Math.round(((index + 1) / chapters.length) * 100)
  let before = 0
  for (let i = 0; i < index; i += 1) before += chapters[i].wordCount || 0
  const here = chapters[index].wordCount || 0
  const share = here > 0 && chapterOffset > 0 ? Math.min(1, chapterOffset / here) : 0
  return Math.round(((before + here * share) / total) * 100)
}

/**
 * Coerce a stored or incoming appearance patch onto the accepted values.
 *
 * Normalizing on read as well as on write means a hand-edited or older
 * settings file can never put the reader into a state it cannot render.
 */
export function normalizeReaderSettings(patch, current = READER_DEFAULTS) {
  const next = { ...current }
  if (READER_THEMES.includes(patch?.theme)) next.theme = patch.theme
  if (READER_FAMILIES.includes(patch?.fontFamily)) next.fontFamily = patch.fontFamily
  const size = Number(patch?.fontSize)
  if (Number.isFinite(size)) next.fontSize = Math.min(30, Math.max(12, Math.round(size)))
  const line = Number(patch?.lineHeight)
  if (Number.isFinite(line)) next.lineHeight = Math.min(2.6, Math.max(1.4, Math.round(line * 10) / 10))
  return next
}

/** A failure the panel and tools both understand. */
class WereadServiceError extends Error {
  constructor(code, message, details) {
    super(message)
    this.name = 'WereadServiceError'
    this.code = code
    this.details = details ?? {}
  }
}

/** Coerce a gateway number field, tolerating strings. */
function numberOr(value, fallback = 0) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(String(value ?? ''), 10)
  return Number.isFinite(parsed) ? parsed : fallback
}

/** Unix seconds → ISO date text, or undefined when absent. */
function toDate(unixSeconds) {
  const seconds = numberOr(unixSeconds, 0)
  if (seconds <= 0) return undefined
  return new Date(seconds * 1000).toISOString().slice(0, 10)
}

/** One book entry, normalized across shelf books and albums. */
function normalizeShelfBook(raw) {
  return {
    bookId: String(raw?.bookId ?? ''),
    title: String(raw?.title ?? '未命名'),
    author: String(raw?.author ?? ''),
    cover: String(raw?.cover ?? ''),
    category: String(raw?.category ?? ''),
    readUpdateTime: numberOr(raw?.readUpdateTime, 0),
    readUpdateDate: toDate(raw?.readUpdateTime),
    finishReading: numberOr(raw?.finishReading, 0) === 1,
    secret: numberOr(raw?.secret, 0) === 1,
    kind: 'book',
  }
}

/** One audiobook/album entry from the shelf. */
function normalizeAlbum(raw) {
  const info = raw?.albumInfo ?? {}
  return {
    bookId: String(info.albumId ?? ''),
    title: String(info.name ?? '未命名专辑'),
    author: String(info.authorName ?? ''),
    cover: String(info.cover ?? ''),
    category: '',
    trackCount: numberOr(info.trackCount, 0),
    readUpdateTime: 0,
    finishReading: false,
    secret: numberOr(raw?.albumInfoExtra?.secret, 0) === 1,
    kind: 'album',
  }
}

/** Normalize the whole shelf payload. */
function normalizeShelf(payload) {
  const books = Array.isArray(payload?.books) ? payload.books.map(normalizeShelfBook) : []
  const albums = Array.isArray(payload?.albums) ? payload.albums.map(normalizeAlbum) : []
  const hasMp = payload?.mp !== undefined && payload.mp !== null
  return {
    books,
    albums,
    hasMp,
    bookCount: numberOr(payload?.bookCount, books.length),
    // The documented counting rule: albums and a non-empty mp entry are shelf
    // entries too, so a plain books.length under-reports the shelf.
    totalCount: books.length + albums.length + (hasMp ? 1 : 0),
    fetchedAt: Date.now(),
  }
}

/** Normalize one reading-progress payload. */
function normalizeProgress(payload) {
  const book = payload?.book ?? payload ?? {}
  return {
    bookId: String(payload?.bookId ?? book?.bookId ?? ''),
    chapterUid: numberOr(book?.chapterUid, 0),
    chapterOffset: numberOr(book?.chapterOffset, 0),
    progress: numberOr(book?.progress, 0),
    updateTime: numberOr(book?.updateTime, 0),
    updateDate: toDate(book?.updateTime),
    recordReadingTime: numberOr(book?.recordReadingTime, 0),
    finishTime: numberOr(book?.finishTime, 0),
    isStartReading: numberOr(book?.isStartReading, 0) === 1,
  }
}

/** Build a chapterUid → title lookup from a bookmark or catalog payload. */
function chapterTitles(chapters) {
  const titles = new Map()
  if (!Array.isArray(chapters)) return titles
  for (const chapter of chapters) {
    const uid = numberOr(chapter?.chapterUid, 0)
    if (uid > 0) titles.set(uid, String(chapter?.title ?? ''))
  }
  return titles
}

export class WereadService {
  /**
   * @param options - host wiring.
   * @param options.ctx - host plugin context, used for logging.
   * @param options.config - the row's config values.
   */
  constructor({ ctx, config = {} }) {
    this.ctx = ctx
    this.config = {
      skillVersion: typeof config.skillVersion === 'string' ? config.skillVersion : '1.0.5',
      syncProgress: config.syncProgress === true,
      requestTimeoutMs: Number.isFinite(config.requestTimeoutMs) ? config.requestTimeoutMs : 20000,
      dataDir: resolveDataDir(config),
    }
    this.store = new WereadStore(this.config.dataDir)
    this.gateway = new WereadGateway({
      getApiKey: () => this.store.credentials?.apiKey ?? '',
      getSkillVersion: () => this.config.skillVersion,
      getTimeoutMs: () => this.config.requestTimeoutMs,
      logger: ctx.logger,
    })
    /** In-flight credential load, so the first call sees the saved key. */
    this.ready = this.store.load()
    /** The Web reader, used only for chapter text and progress reports. */
    this.reader = new WereadWebReader({
      getCookie: () => this.store.credentials?.cookie ?? '',
      getTimeoutMs: () => this.config.requestTimeoutMs,
      onCookieRefresh: (setCookies) => {
        this.store.mergeSetCookies(setCookies).catch((error) => {
          ctx.logger?.warn('[weread] 刷新 Cookie 失败：%s', error?.message ?? String(error))
        })
      },
      logger: ctx.logger,
    })
  }

  /**
   * Whether reading progress may be written back to WeRead.
   *
   * The row's config is only the initial default; a choice made in the panel
   * is stored and wins, so the switch never requires editing a file.
   */
  async syncProgressEnabled() {
    const settings = await this.store.loadSettings()
    return typeof settings.syncProgress === 'boolean' ? settings.syncProgress : this.config.syncProgress === true
  }

  /** The reading appearance in force, always fully populated and valid. */
  async readerSettings() {
    const settings = await this.store.loadSettings()
    return normalizeReaderSettings(settings.reader ?? {}, READER_DEFAULTS)
  }

  /** Wrap an unknown failure into the service's own code space. */
  static toServiceError(error) {
    if (error instanceof WereadServiceError) return error
    if (error instanceof WereadReaderError) return new WereadServiceError(error.code, error.message, error.details)
    if (error instanceof WereadGatewayError) {
      const code = error.code === 'weread/no-api-key' ? 'weread/needs-config' : error.code
      return new WereadServiceError(code, error.message, error.details)
    }
    return new WereadServiceError('weread/internal', error?.message ?? String(error))
  }

  // --- operations (shared by the panel and the agent tools) -----------------

  /** Credential and capability state, never echoing a secret. */
  async status() {
    await this.ready
    // Read the live record: a save made after the initial load replaces it.
    const credentials = this.store.credentials
    return {
      apiKeyConfigured: credentials.apiKey.length > 0,
      apiKeyHint: maskSecret(credentials.apiKey),
      apiKeyLooksValid: looksLikeApiKey(credentials.apiKey),
      cookieConfigured: credentials.cookie.length > 0,
      cookieNames: Object.keys(parseCookieHeader(credentials.cookie)),
      cookieUpdatedAt: credentials.updatedAt > 0 ? new Date(credentials.updatedAt).toISOString() : undefined,
      skillVersion: this.config.skillVersion,
      syncProgress: await this.syncProgressEnabled(),
      syncProgressDefault: this.config.syncProgress === true,
      reader: await this.readerSettings(),
      dataDir: this.config.dataDir,
      upgradeInfo: this.gateway.upgradeInfo,
    }
  }

  /**
   * Persist credentials supplied from the panel.
   * @param patch - `{ apiKey?, cookie? }`; an empty string clears the value.
   */
  async configure(patch = {}) {
    const next = {}
    if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim()
    if (typeof patch.cookie === 'string') next.cookie = patch.cookie.trim()
    const wantsSync = typeof patch.syncProgress === 'boolean'
    const wantsReader = patch.reader !== null && typeof patch.reader === 'object'
    if (Object.keys(next).length === 0 && !wantsSync && !wantsReader) {
      throw new WereadServiceError('weread/nothing-to-save', '没有需要保存的内容。')
    }
    if (wantsSync) await this.store.saveSettings({ syncProgress: patch.syncProgress })
    if (wantsReader) {
      // Merged onto the current values, so a one-field change from the panel
      // never resets the rest of the appearance.
      const merged = normalizeReaderSettings(patch.reader, await this.readerSettings())
      await this.store.saveSettings({ reader: merged })
    }
    if (Object.keys(next).length === 0) return this.status()
    if (typeof next.apiKey === 'string' && next.apiKey.length > 0 && !looksLikeApiKey(next.apiKey)) {
      throw new WereadServiceError(
        'weread/bad-key',
        'API Key 格式看起来不对：应以 `wrk-` 开头。请到 https://weread.qq.com/r/weread-skills 领取。',
      )
    }
    if (typeof next.cookie === 'string' && next.cookie.length > 0) {
      const jar = parseCookieHeader(next.cookie)
      if (jar.wr_vid === undefined || jar.wr_skey === undefined) {
        throw new WereadServiceError(
          'weread/bad-cookie',
          'Cookie 需要同时包含 `wr_vid` 与 `wr_skey`（从已登录 weread.qq.com 的浏览器里复制完整 Cookie 头）。',
        )
      }
    }
    await this.ready
    await this.store.save(next)
    return this.status()
  }

  /** Verify the key by exercising the cheapest identity-bound endpoint. */
  async verify(signal) {
    await this.ready
    const payload = await this.gateway.shelf(signal)
    const shelf = normalizeShelf(payload)
    return { ok: true, shelfCount: shelf.totalCount, bookCount: shelf.books.length }
  }

  /** The whole shelf, cached briefly. */
  async shelf({ refresh = false, signal } = {}) {
    await this.ready
    return cached(this.store, 'shelf', refresh ? 0 : SHELF_TTL_MS, async () =>
      normalizeShelf(await this.gateway.shelf(signal)),
    )
  }

  /** Reading progress for one book. */
  async progress(bookId, { signal } = {}) {
    await this.ready
    const key = `progress/${bookId}`
    return cached(this.store, key, PROGRESS_TTL_MS, async () =>
      normalizeProgress(await this.gateway.progress(bookId, signal)),
    )
  }

  /** The book the user most recently read, with its progress. */
  async current({ signal } = {}) {
    const shelf = await this.shelf({ signal })
    const candidates = shelf.books.filter((book) => book.readUpdateTime > 0 && !book.finishReading)
    const pool = candidates.length > 0 ? candidates : shelf.books
    if (pool.length === 0) return { book: undefined, progress: undefined }
    const book = pool.reduce((best, item) => (item.readUpdateTime > best.readUpdateTime ? item : best))
    const progress = await this.progress(book.bookId, { signal })
    return { book, progress }
  }

  /** Book detail: metadata plus progress plus the public chapter catalog. */
  async book(bookId, { signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    await this.ready
    const [info, progress, catalog] = await Promise.all([
      cached(this.store, `info/${bookId}`, 24 * 60 * 60 * 1000, () => this.gateway.bookInfo(bookId, signal)),
      this.progress(bookId, { signal }).catch(() => undefined),
      cached(this.store, `catalog/${bookId}`, 24 * 60 * 60 * 1000, () => this.gateway.chapterInfo(bookId, signal)),
    ])
    const chapters = Array.isArray(catalog?.chapters) ? catalog.chapters : []
    return {
      bookId,
      title: String(info?.title ?? ''),
      author: String(info?.author ?? ''),
      cover: String(info?.cover ?? ''),
      intro: String(info?.intro ?? ''),
      category: String(info?.category ?? ''),
      publisher: String(info?.publisher ?? ''),
      wordCount: numberOr(info?.wordCount, 0),
      rating: info?.newRating,
      readerLink: info?.readerLink,
      deepLink: info?.deepLink,
      progress,
      chapters: chapters.map((chapter) => ({
        chapterUid: numberOr(chapter?.chapterUid, 0),
        chapterIdx: numberOr(chapter?.chapterIdx, 0),
        title: String(chapter?.title ?? ''),
        level: numberOr(chapter?.level, 0),
        wordCount: numberOr(chapter?.wordCount, 0),
        paid: numberOr(chapter?.paid, 0) === 1,
      })),
    }
  }

  /** Notebook overview across every book that has notes. */
  async notebooks({ signal } = {}) {
    await this.ready
    return cached(this.store, 'notebooks', NOTEBOOK_TTL_MS, async () => {
      const books = []
      let lastSort
      // Cursor pagination; the documented cap is small, but guard anyway.
      for (let page = 0; page < 30; page += 1) {
        const payload = await this.gateway.notebooks(100, lastSort, signal)
        const batch = Array.isArray(payload?.books) ? payload.books : []
        for (const entry of batch) {
          books.push({
            bookId: String(entry?.bookId ?? ''),
            title: String(entry?.book?.title ?? ''),
            author: String(entry?.book?.author ?? ''),
            cover: String(entry?.book?.cover ?? ''),
            reviewCount: numberOr(entry?.reviewCount, 0),
            noteCount: numberOr(entry?.noteCount, 0),
            bookmarkCount: numberOr(entry?.bookmarkCount, 0),
            readingProgress: numberOr(entry?.readingProgress, 0),
            markedStatus: numberOr(entry?.markedStatus, 0),
            sort: numberOr(entry?.sort, 0),
            noteTotal:
              numberOr(entry?.reviewCount, 0) + numberOr(entry?.noteCount, 0) + numberOr(entry?.bookmarkCount, 0),
          })
        }
        if (numberOr(payload?.hasMore, 0) !== 1 || batch.length === 0) break
        lastSort = numberOr(batch[batch.length - 1]?.sort, 0)
        if (lastSort === 0) break
      }
      books.sort((left, right) => right.noteTotal - left.noteTotal)
      return {
        books,
        totalBookCount: books.length,
        totalNoteCount: books.reduce((sum, book) => sum + book.noteTotal, 0),
        fetchedAt: Date.now(),
      }
    })
  }

  /** One book's highlights and personal thoughts, grouped by chapter. */
  async notes(bookId, { signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    await this.ready
    const [markPayload, reviewPayload] = await Promise.all([
      this.gateway.bookmarks(bookId, signal),
      this.gateway.myReviews(bookId, 100, undefined, signal).catch(() => ({ reviews: [] })),
    ])
    const titles = chapterTitles(markPayload?.chapters)
    const highlights = (Array.isArray(markPayload?.updated) ? markPayload.updated : []).map((entry) => ({
      range: String(entry?.range ?? ''),
      chapterUid: numberOr(entry?.chapterUid, 0),
      chapterTitle: titles.get(numberOr(entry?.chapterUid, 0)) ?? '',
      text: String(entry?.markText ?? ''),
      createTime: numberOr(entry?.createTime, 0),
      createDate: toDate(entry?.createTime),
    }))
    const thoughts = (Array.isArray(reviewPayload?.reviews) ? reviewPayload.reviews : []).map((entry) => {
      const review = entry?.review ?? entry ?? {}
      return {
        reviewId: String(review?.reviewId ?? ''),
        chapterUid: numberOr(review?.chapterUid, 0),
        chapterTitle: String(review?.chapterName ?? ''),
        abstract: typeof review?.abstract === 'string' ? review.abstract : '',
        content: String(review?.content ?? ''),
        star: numberOr(review?.star, -1),
        createTime: numberOr(review?.createTime, 0),
        createDate: toDate(review?.createTime),
      }
    })
    // Group by chapter so the panel can render one section per chapter.
    const groups = new Map()
    const groupFor = (uid, title) => {
      const key = uid > 0 ? String(uid) : 'unknown'
      if (!groups.has(key)) {
        groups.set(key, { chapterUid: uid, chapterTitle: title || titles.get(uid) || '', highlights: [], thoughts: [] })
      }
      return groups.get(key)
    }
    for (const highlight of highlights) groupFor(highlight.chapterUid, highlight.chapterTitle).highlights.push(highlight)
    for (const thought of thoughts) groupFor(thought.chapterUid, thought.chapterTitle).thoughts.push(thought)
    // The raw `book` record carries cover blurhashes, palettes and sales flags
    // — about half the payload — and neither the panel nor the tool reads any
    // of it, so only the display fields cross the wire.
    const rawBook = markPayload?.book ?? {}
    return {
      bookId,
      book: {
        bookId: String(rawBook.bookId ?? bookId),
        title: String(rawBook.title ?? ''),
        author: String(rawBook.author ?? ''),
        cover: String(rawBook.cover ?? ''),
      },
      highlightCount: highlights.length,
      thoughtCount: thoughts.length,
      chapters: [...groups.values()],
    }
  }

  /** Reading-time statistics for one natural period. */
  async stats(mode = 'monthly', { baseTime, signal } = {}) {
    await this.ready
    if (!['weekly', 'monthly', 'annually', 'overall'].includes(mode)) {
      throw new WereadServiceError('weread/bad-request', `不支持的统计周期：${mode}`)
    }
    const normalized = mode === 'overall' ? 'overall' : mode
    return this.gateway.readData(normalized, mode === 'overall' ? 0 : baseTime, signal)
  }

  /** Store search, used both by the panel and to resolve a title to a bookId. */
  async search(keyword, { scope = 10, count = 20, signal } = {}) {
    if (typeof keyword !== 'string' || keyword.trim().length === 0) {
      throw new WereadServiceError('weread/bad-request', '请提供搜索关键词。')
    }
    await this.ready
    const payload = await this.gateway.search(keyword.trim(), scope, count, signal)
    const results = []
    for (const group of Array.isArray(payload?.results) ? payload.results : []) {
      for (const item of Array.isArray(group?.books) ? group.books : []) {
        const info = item?.bookInfo ?? {}
        results.push({
          bookId: String(info?.bookId ?? ''),
          title: String(info?.title ?? ''),
          author: String(info?.author ?? ''),
          cover: String(info?.cover ?? ''),
          intro: String(info?.intro ?? ''),
          category: String(info?.category ?? ''),
          rating: info?.newRating,
          readingCount: numberOr(info?.readingCount, 0),
          readerLink: info?.readerLink ?? item?.readerLink,
          deepLink: info?.deepLink ?? item?.deepLink,
        })
      }
    }
    return { keyword, count: results.length, results }
  }

  /** Resolve a user-supplied bookId-or-title into a bookId. */
  async resolveBookId(query, { signal } = {}) {
    const text = typeof query === 'string' ? query.trim() : ''
    if (text.length === 0) throw new WereadServiceError('weread/bad-request', '请提供书名或 bookId。')
    // A numeric id or a 公众号 id is already a bookId.
    if (/^\d+$/.test(text) || text.startsWith('MP_WXS_')) return text
    const found = await this.search(text, { count: 5, signal })
    if (found.results.length === 0) {
      throw new WereadServiceError('weread/not-found', `书城搜索「${text}」没有结果。`)
    }
    return found.results[0].bookId
  }

  // --- 原生阅读器（Web 会话） -------------------------------------------------

  /** Whether the native reader can run: it needs a Web session, not the API key. */
  async readerStatus() {
    await this.ready
    return {
      cookieConfigured: this.reader.hasSession(),
      knownFormats: [...this.reader.formats.entries()].map(([bookId, format]) => ({ bookId, format })),
    }
  }

  /**
   * The chapter catalog the reader pages through.
   *
   * Reading needs the Web session, so the Web catalog is the primary source;
   * the gateway catalog is only a fallback for when that endpoint fails but an
   * API key happens to be configured. When neither credential exists, the
   * error names the one reading actually requires — a Cookie — instead of
   * sending the user after an API key this feature does not use.
   */
  async chapterCatalog(bookId, { signal } = {}) {
    if (this.reader.hasSession()) {
      try {
        return await cached(this.store, `webcatalog/${bookId}`, 24 * 60 * 60 * 1000, () =>
          this.reader.webCatalog(bookId, signal),
        )
      } catch (error) {
        this.ctx.logger?.warn('[weread] 网页目录获取失败，尝试官方目录：%s', error?.message ?? String(error))
      }
    }
    const credentials = await this.ready
    if (credentials.apiKey.length === 0) {
      throw new WereadServiceError(
        'weread/needs-cookie',
        '要在这个侧边栏里直接读正文，请在「设置」里粘贴已登录 weread.qq.com 的 Cookie（须含 wr_vid 与 wr_skey）。',
      )
    }
    const detail = await this.book(bookId, { signal })
    return detail.chapters
  }

  /**
   * One chapter's readable text, cached per book and chapter.
   * @param bookId - the book.
   * @param chapterUid - the chapter.
   * @param options - `refresh` bypasses the cache; `signal` cancels.
   */
  async chapter(bookId, chapterUid, { refresh = false, signal } = {}) {
    if (typeof bookId !== 'string' || bookId.length === 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 bookId。')
    }
    const uid = Number(chapterUid)
    if (!Number.isFinite(uid) || uid <= 0) {
      throw new WereadServiceError('weread/bad-request', '缺少 chapterUid。')
    }
    await this.ready
    const catalog = await this.chapterCatalog(bookId, { signal })
    const index = catalog.findIndex((chapter) => chapter.chapterUid === uid)
    const target = index >= 0 ? catalog[index] : undefined
    const decoded = await cached(this.store, `chapter/${bookId}/${uid}`, refresh ? 0 : CHAPTER_TTL_MS, async () => {
      const fetched = await this.reader.fetchChapter({
        bookId,
        chapterUid: uid,
        title: target?.title,
        signal,
      })
      return {
        chapterUid: uid,
        title: fetched.title,
        format: fetched.format,
        paragraphs: fetched.paragraphs,
        fetchedAt: Date.now(),
      }
    })
    return {
      ...decoded,
      bookId,
      chapterIdx: index,
      chapterCount: catalog.length,
      previous: index > 0 ? catalog[index - 1] : undefined,
      next: index >= 0 && index < catalog.length - 1 ? catalog[index + 1] : undefined,
      chapters: catalog,
    }
  }

  /**
   * Report the current position back to WeRead.
   *
   * An account mutation, so it stays behind the row's `syncProgress` flag and
   * is only ever reached from an explicit user action.
   */
  async reportProgress(
    { bookId, chapterUid, chapterOffset = 0, positionRatio, progress, summary, elapsedSeconds = 0 },
    { signal } = {},
  ) {
    if (!(await this.syncProgressEnabled())) {
      throw new WereadServiceError(
        'weread/sync-disabled',
        '进度回写当前是关闭的。请在「微信读书 → 设置 → 进度回写」里打开后再试。',
      )
    }
    await this.ready
    const catalog = await this.chapterCatalog(bookId, { signal })
    const index = catalog.findIndex((chapter) => chapter.chapterUid === Number(chapterUid))
    const state = await this.reader.readerState(bookId, Number(chapterUid), signal)
    // The panel reports how far through the chapter it is; the catalog owns
    // the units, so the conversion happens here.
    const here = index >= 0 ? catalog[index].wordCount || 0 : 0
    const offset =
      Number.isFinite(positionRatio) && here > 0
        ? Math.max(0, Math.min(here, Math.round(positionRatio * here)))
        : chapterOffset
    const derived = estimateProgress(catalog, index, offset)
    const payload = await this.reader.reportRead({
      bookId,
      chapterUid: Number(chapterUid),
      chapterIdx: index >= 0 ? index : 0,
      chapterOffset: offset,
      progress: Number.isFinite(progress) ? progress : derived,
      summary,
      elapsedSeconds,
      psvts: state.psvts,
      pclts: state.pclts,
      token: state.token,
      signal,
    })
    return { reported: true, progress: Number.isFinite(progress) ? progress : derived, response: payload }
  }

  // --- client transport -----------------------------------------------------

  /**
   * Dispatch one panel call. Never throws: the client transport carries a
   * result envelope, and a business failure is part of the result.
   * @param endpoint - operation name.
   * @param payload - operation arguments.
   * @param signal - caller cancellation.
   */
  async handleRpc(endpoint, payload, signal) {
    try {
      return { ok: true, value: await this.dispatch(endpoint, payload ?? {}, signal) }
    } catch (error) {
      const serviceError = WereadService.toServiceError(error)
      this.ctx.logger?.debug('[weread] rpc %s failed: %s', endpoint, serviceError.message)
      return {
        ok: false,
        error: { code: serviceError.code, message: serviceError.message, details: serviceError.details ?? {} },
      }
    }
  }

  /** Route one operation name onto the method above. */
  async dispatch(endpoint, payload, signal) {
    switch (endpoint) {
      case 'status':
        return this.status()
      case 'configure':
        return this.configure({
          ...(typeof payload.apiKey === 'string' ? { apiKey: payload.apiKey } : {}),
          ...(typeof payload.cookie === 'string' ? { cookie: payload.cookie } : {}),
          ...(typeof payload.syncProgress === 'boolean' ? { syncProgress: payload.syncProgress } : {}),
          ...(payload.reader !== null && typeof payload.reader === 'object' ? { reader: payload.reader } : {}),
        })
      case 'verify':
        return this.verify(signal)
      case 'readerStatus':
        return this.readerStatus()
      case 'shelf':
        return this.shelf({ refresh: payload.refresh === true, signal })
      case 'current':
        return this.current({ signal })
      case 'progress':
        return this.progress(String(payload.bookId ?? ''), { signal })
      case 'book':
        return this.book(String(payload.bookId ?? ''), { signal })
      case 'notes':
        return this.notes(await this.resolveBookId(payload.bookId ?? payload.title, { signal }), { signal })
      case 'chapter':
        return this.chapter(String(payload.bookId ?? ''), payload.chapterUid, {
          refresh: payload.refresh === true,
          signal,
        })
      case 'reportProgress':
        return this.reportProgress(
          {
            bookId: String(payload.bookId ?? ''),
            chapterUid: payload.chapterUid,
            chapterOffset: Number.isFinite(payload.chapterOffset) ? payload.chapterOffset : 0,
            positionRatio: Number.isFinite(payload.positionRatio) ? payload.positionRatio : undefined,
            progress: Number.isFinite(payload.progress) ? payload.progress : undefined,
            summary: typeof payload.summary === 'string' ? payload.summary : '',
            elapsedSeconds: Number.isFinite(payload.elapsedSeconds) ? payload.elapsedSeconds : 0,
          },
          { signal },
        )
      case 'notebooks':
        return this.notebooks({ signal })
      case 'stats':
        return this.stats(typeof payload.mode === 'string' ? payload.mode : 'monthly', {
          baseTime: Number.isFinite(payload.baseTime) ? payload.baseTime : undefined,
          signal,
        })
      case 'search':
        return this.search(payload.keyword, {
          scope: Number.isFinite(payload.scope) ? payload.scope : 10,
          count: Number.isFinite(payload.count) ? payload.count : 20,
          signal,
        })
      case 'endpoints':
        return this.gateway.listEndpoints(signal)
      default:
        throw new WereadServiceError('weread/unknown-endpoint', `未知操作：${endpoint}`)
    }
  }
}
