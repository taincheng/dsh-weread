/**
 * Agent-facing tools.
 *
 * Each tool is a thin adapter over one `WereadService` operation — the same
 * method the sidebar panel calls — so a reading action performed by the model
 * and one performed by the user can never disagree.
 *
 * Tool results are plain text plus a JSON mirror. The model reads the text,
 * which keeps every result readable in the transcript; the JSON mirror keeps
 * the value losslessly inspectable by other tooling.
 */

/** Shared result schema: `text` for the model, `json` for structure. */
const OUTPUT = {
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['text', 'json'],
    properties: {
      text: { type: 'string' },
      json: { type: 'string' },
    },
  },
  render(_args, value) {
    return [{ type: 'text', text: value.text }]
  },
}

/** Build `{ text, json }` from a text body and its structured source. */
function result(text, data) {
  return { text, json: JSON.stringify(data ?? null) }
}

/** `X小时Y分钟`, or `Y分钟` under an hour. */
function humanDuration(seconds) {
  const total = Math.max(Math.round(Number(seconds) || 0), 0)
  const hours = Math.floor(total / 3600)
  const minutes = Math.round((total % 3600) / 60)
  return hours > 0 ? `${hours} 小时 ${minutes} 分钟` : `${minutes} 分钟`
}

/** Truncate long book text so one tool result stays readable. */
function clip(text, limit = 120) {
  const value = String(text ?? '').replace(/\s+/g, ' ').trim()
  return value.length > limit ? `${value.slice(0, limit)}…` : value
}

/**
 * Render a WeRead recommendation score.
 *
 * The service reports `newRating` on a 0–1000 scale and its own UI shows the
 * same number as a 0–100% recommendation, so an unlabelled "评分 930" would
 * read as a bug to anyone seeing it.
 */
function formatRating(rating) {
  const value = Number(rating)
  if (!Number.isFinite(value)) return undefined
  return value > 100 ? `推荐值 ${(value / 10).toFixed(1)}%` : `推荐值 ${value}%`
}

/** Render the period-over-period ratio as a signed percentage. */
function formatCompare(compare) {
  const value = Number(compare)
  if (!Number.isFinite(value)) return undefined
  const percent = value * 100
  return `较上期 ${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

/**
 * Register every WeRead tool on the host context.
 *
 * Each registration is owned by one plugin effect, so unloading the plugin
 * withdraws all five tools together.
 * @param ctx - host plugin context whose `tools` service is available.
 * @param service - the shared WeRead service.
 */
export function registerTools(ctx, service) {
  ctx.effect(() => {
    const disposers = []
    defineTools(ctx, service, (definition) => disposers.push(ctx.tools.register(definition)))
    return () => {
      for (const dispose of disposers) dispose()
    }
  }, 'weread: tools')
}

/**
 * Build every tool definition against the shared service.
 * @param ctx - host plugin context.
 * @param service - the shared WeRead service.
 * @param keep - receives each finished definition.
 */
function defineTools(ctx, service, keep) {
  // --- 在读 -----------------------------------------------------------------
  keep({
    name: 'weread_current',
    description:
      '读取用户当前正在读的微信读书书籍：书名、作者、阅读进度和最近的划线与想法。当用户提到「我在读的书」「我的进度」「接着读」，或需要结合其阅读上下文回答时使用。返回空表示用户近期没有在读的书。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        includeNotes: {
          type: 'boolean',
          description: '是否附带最近的划线与想法（默认 true）。',
        },
      },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const { book, progress } = await service.current({ signal: exec.signal })
      if (book === undefined) {
        return result('微信读书书架为空，或没有找到在读的书。', { book: null })
      }
      const lines = [
        `《${book.title}》${book.author.length > 0 ? ` — ${book.author}` : ''}`,
        `阅读进度：${progress?.progress ?? 0}%`,
        book.readUpdateDate !== undefined ? `上次阅读：${book.readUpdateDate}` : undefined,
        book.finishReading ? '状态：已读完' : undefined,
      ].filter((line) => line !== undefined)
      let notes
      if (args?.includeNotes !== false) {
        try {
          notes = await service.notes(book.bookId, { signal: exec.signal })
          const highlights = notes.chapters.flatMap((chapter) => chapter.highlights).slice(0, 5)
          if (highlights.length > 0) {
            lines.push('', '最近的划线：')
            for (const highlight of highlights) {
              lines.push(`- ${clip(highlight.text)}`)
            }
          }
          const thoughts = notes.chapters.flatMap((chapter) => chapter.thoughts).slice(0, 3)
          if (thoughts.length > 0) {
            lines.push('', '最近的想法：')
            for (const thought of thoughts) {
              lines.push(`- ${clip(thought.content)}`)
            }
          }
        } catch {
          // Notes are a bonus; a shelf-level answer still stands without them.
        }
        if (notes !== undefined && notes.highlightCount === 0 && notes.thoughtCount === 0) {
          lines.push('', '这本书里还没有划线或想法。')
        }
      }
      return result(lines.join('\n'), { book, progress, notes })
    },
  })

  // --- 书架 -----------------------------------------------------------------
  keep({
    name: 'weread_shelf',
    description:
      '列出用户的微信读书书架（电子书 + 有声书/专辑），按最近阅读时间排序。当用户问「我的书架」「我买了哪些书」「我最近读什么」时使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        limit: { type: 'integer', description: '最多返回多少条，默认 30。' },
        includeAlbums: { type: 'boolean', description: '是否包含有声书/专辑，默认 true。' },
        refresh: { type: 'boolean', description: '跳过缓存强制刷新，默认 false。' },
      },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const shelf = await service.shelf({ refresh: args?.refresh === true, signal: exec.signal })
      const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(200, args.limit)) : 30
      const items = [
        ...shelf.books.map((book) => ({ ...book, kind: 'book' })),
        ...(args?.includeAlbums === false ? [] : shelf.albums),
      ]
        .sort((left, right) => right.readUpdateTime - left.readUpdateTime)
        .slice(0, limit)
      const header = `书架共 ${shelf.totalCount} 项（电子书 ${shelf.books.length} · 有声书 ${shelf.albums.length} · 公众号 ${shelf.hasMp ? 1 : 0}），按最近阅读排序展示 ${items.length} 项：`
      const lines = items.map((item, index) => {
        const parts = [`${index + 1}. 《${item.title}》`]
        if (item.author.length > 0) parts.push(`— ${item.author}`)
        if (item.kind === 'album') parts.push('[有声书]')
        if (item.finishReading) parts.push('[已读完]')
        if (item.readUpdateDate !== undefined) parts.push(`(最近 ${item.readUpdateDate})`)
        return parts.join(' ')
      })
      return result([header, ...lines].join('\n'), {
        totalCount: shelf.totalCount,
        bookCount: shelf.books.length,
        albumCount: shelf.albums.length,
        items,
      })
    },
  })

  // --- 笔记 / 划线 -----------------------------------------------------------
  keep({
    name: 'weread_notes',
    description:
      '导出用户在某本微信读书书籍里的划线与想法，按章节分组。可以传书名或 bookId。当用户问「我在某本书里的划线/笔记/想法」时使用；写书评、总结、复盘时也很有用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['book'],
      properties: {
        book: { type: 'string', description: '书名（会自动在书城搜索解析）或微信读书 bookId。' },
        limit: { type: 'integer', description: '每条章最多返回多少条划线/想法，默认 20。' },
      },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const bookId = await service.resolveBookId(args?.book, { signal: exec.signal })
      const notes = await service.notes(bookId, { signal: exec.signal })
      const limit = Number.isFinite(args?.limit) ? Math.max(1, Math.min(200, args.limit)) : 20
      const title = notes.book?.title ?? bookId
      const lines = [
        `《${title}》共 ${notes.highlightCount} 条划线、${notes.thoughtCount} 条想法。`,
      ]
      for (const chapter of notes.chapters) {
        const heading = chapter.chapterTitle.length > 0 ? chapter.chapterTitle : '未归类'
        lines.push('', `## ${heading}`)
        for (const highlight of chapter.highlights.slice(0, limit)) {
          lines.push(`> ${clip(highlight.text, 200)}`)
        }
        for (const thought of chapter.thoughts.slice(0, limit)) {
          lines.push(`- 想法：${clip(thought.content, 200)}`)
          if (thought.abstract.length > 0) lines.push(`  （原文：${clip(thought.abstract, 120)}）`)
        }
      }
      if (notes.chapters.length === 0) lines.push('', '这本书里没有找到划线或想法。')
      return result(lines.join('\n'), { bookId, title, ...notes })
    },
  })

  // --- 阅读统计 -------------------------------------------------------------
  keep({
    name: 'weread_stats',
    description:
      '读取用户的微信读书阅读统计：阅读时长、阅读天数、日均时长、偏好分类与作者。当用户问「我读了多久」「今年的阅读情况」时使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: {
        mode: {
          type: 'string',
          enum: ['weekly', 'monthly', 'annually', 'overall'],
          description: '统计周期，默认 monthly。',
        },
        baseTime: { type: 'integer', description: '定位到某个周期内的 Unix 秒时间戳，默认当前。' },
      },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const mode = typeof args?.mode === 'string' ? args.mode : 'monthly'
      const stats = await service.stats(mode, {
        baseTime: Number.isFinite(args?.baseTime) ? args.baseTime : undefined,
        signal: exec.signal,
      })
      const label = { weekly: '本周', monthly: '本月', annually: '本年', overall: '总计' }[mode] ?? mode
      const lines = [
        `${label}阅读：${humanDuration(stats?.totalReadTime ?? stats?.readTimes ?? 0)}`,
        `阅读天数：${stats?.readDays ?? 0} 天`,
        stats?.dayAverageReadTime !== undefined
          ? `日均（按自然日）：${humanDuration(stats.dayAverageReadTime)}`
          : undefined,
        formatCompare(stats?.compare) !== undefined ? formatCompare(stats?.compare) : undefined,
      ].filter((line) => line !== undefined)
      const longest = Array.isArray(stats?.readLongest) ? stats.readLongest.slice(0, 5) : []
      if (longest.length > 0) {
        lines.push('', '读得最多的书：')
        for (const entry of longest) {
          lines.push(`- 《${entry?.book?.title ?? entry?.title ?? '未知'}》${humanDuration(entry?.readTime ?? 0)}`)
        }
      }
      const prefer = Array.isArray(stats?.preferCategory) ? stats.preferCategory.slice(0, 5) : []
      const named = prefer.filter((entry) => typeof (entry?.categoryTitle ?? entry?.parentCategoryTitle) === 'string')
      if (named.length > 0) {
        lines.push('', '偏好分类：')
        for (const entry of named) {
          const title = entry.categoryTitle ?? entry.parentCategoryTitle
          const time = Number(entry?.readingTime)
          lines.push(`- ${title}${Number.isFinite(time) && time > 0 ? `（${humanDuration(time)}）` : ''}`)
        }
      }
      return result(lines.join('\n'), stats ?? {})
    },
  })

  // --- 搜索 -----------------------------------------------------------------
  keep({
    name: 'weread_search',
    description:
      '在微信读书书城搜索书籍，返回书名、作者、评分与简介。当用户想找一本书、或需要把书名解析成 bookId 以便进一步查询时使用。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['keyword'],
      properties: {
        keyword: { type: 'string', description: '搜索关键词（书名、作者、主题）。' },
        count: { type: 'integer', description: '返回数量，默认 10。' },
      },
    },
    output: OUTPUT,
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const found = await service.search(args?.keyword, {
        count: Number.isFinite(args?.count) ? Math.max(1, Math.min(50, args.count)) : 10,
        signal: exec.signal,
      })
      const lines = [`「${found.keyword}」找到 ${found.count} 个结果：`]
      for (const [index, item] of found.results.entries()) {
        const parts = [`${index + 1}. 《${item.title}》`]
        if (item.author.length > 0) parts.push(`— ${item.author}`)
        const rating = formatRating(item.rating)
        if (rating !== undefined) parts.push(rating)
        parts.push(`bookId=${item.bookId}`)
        lines.push(parts.join(' '))
        if (item.intro.length > 0) lines.push(`   简介：${clip(item.intro, 120)}`)
      }
      return result(lines.join('\n'), found)
    },
  })
}
