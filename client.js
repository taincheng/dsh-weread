/**
 * dsh-weread — client half.
 *
 * A right-sidebar tab type ("微信读书") with its guide entry, rendering four
 * views: 在读 / 书架 / 笔记 / 设置. Every value comes from the host half over
 * the plugin's own `/weread` channel, so the panel and the agent tools read
 * the same state.
 *
 * The browser artifact is the hand-written loader format DSH expects: a
 * factory registered under the package name, with `react` taken from the
 * page's module table.
 */

window.__ModuleLoader__.load({
  id: 'dsh-weread',
  factory(require) {
    const React = require('react')
    const h = React.createElement

    /** Identity of this tab type; also the key its body registers under. */
    const TAB_ID = 'dsh-weread'
    /** The kind a caller names to open this page. */
    const TAB_KIND = 'weread'
    /** The sidebar tab kind the shipped Browser plugin registers. */
    const BROWSER_KIND = 'browser'
    /** Where a user collects an agent API key. */
    const API_KEY_URL = 'https://weread.qq.com/r/weread-skills'

    const CSS = [
      '.wr-root{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);font-size:13px;line-height:20px}',
      '.wr-tabs{display:flex;align-items:center;gap:2px;padding:6px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.wr-tab{border:0;background:transparent;color:var(--dsw-alias-label-secondary);padding:3px 9px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;font:inherit;font-size:12px}',
      '.wr-tab:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}',
      '.wr-spacer{flex:auto}',
      '.wr-icon{width:22px;height:22px;padding:0;display:inline-flex;align-items:center;justify-content:center;border:0;background:transparent;color:var(--dsw-alias-label-secondary);border-radius:var(--dsw-radius-sm,6px);cursor:pointer}',
      '.wr-icon:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-body{flex:auto;min-height:0;overflow:auto;padding:10px}',
      '.wr-muted{color:var(--dsw-alias-label-secondary)}',
      '.wr-faint{color:var(--dsw-alias-label-secondary);font-size:11px}',
      '.wr-card{border:.5px solid var(--dsw-alias-border-l1);border-radius:var(--dsw-radius-md,8px);padding:10px 12px;margin-bottom:8px;background:var(--dsw-alias-bg-layer-2)}',
      '.wr-title{margin:0 0 2px;font-weight:600;font-size:14px;line-height:20px}',
      '.wr-row{display:flex;gap:10px;align-items:flex-start}',
      '.wr-cover{width:46px;height:62px;object-fit:cover;border-radius:var(--dsw-radius-xs,4px);flex:none;background:var(--dsw-alias-bg-layer-1)}',
      '.wr-coverFlat{width:46px;height:62px;border-radius:var(--dsw-radius-xs,4px);flex:none;background:var(--dsw-alias-bg-layer-1)}',
      '.wr-progress{height:4px;border-radius:2px;background:var(--dsw-alias-bg-layer-1);overflow:hidden;margin:7px 0 4px}',
      '.wr-progressFill{height:100%;background:var(--dsw-alias-brand-primary)}',
      '.wr-actions{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}',
      '.wr-btn{border:.5px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);border-radius:var(--dsw-radius-sm,6px);padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}',
      '.wr-btn:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-btnPrimary{border-color:transparent;background:var(--dsw-alias-brand-primary);color:#fff}',
      '.wr-btnPrimary:hover{opacity:.9;background:var(--dsw-alias-brand-primary)}',
      '.wr-input{width:100%;box-sizing:border-box;background:var(--dsw-alias-bg-layer-1);border:.5px solid var(--dsw-alias-border-l2);border-radius:var(--dsw-radius-sm,6px);color:var(--dsw-alias-label-primary);padding:5px 8px;font:inherit;font-size:12px}',
      '.wr-input:focus{outline:1px solid var(--dsw-alias-brand-primary);outline-offset:-1px}',
      '.wr-field{margin-bottom:8px}',
      '.wr-label{display:block;margin-bottom:4px;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-error{color:var(--dsw-alias-state-error-primary);font-size:12px;margin:6px 0 0;white-space:pre-wrap;word-break:break-word}',
      '.wr-ok{color:var(--dsw-alias-state-success-primary);font-size:12px;margin:6px 0 0}',
      '.wr-warn{color:var(--dsw-alias-state-warn-primary);font-size:12px;margin:6px 0 0}',
      '.wr-list{list-style:none;margin:0;padding:0}',
      '.wr-item{padding:8px 10px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;border:.5px solid transparent}',
      '.wr-item:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-quote{margin:6px 0;padding-left:9px;border-left:2px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}',
      '.wr-thought{margin:6px 0;padding:6px 9px;border-radius:var(--dsw-radius-sm,6px);background:var(--dsw-alias-bg-layer-2)}',
      '.wr-chapter{margin:14px 0 6px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-secondary)}',
      '.wr-empty{padding:26px 14px;text-align:center;color:var(--dsw-alias-label-secondary)}',
      '.wr-steps{margin:6px 0 0;padding-left:18px;color:var(--dsw-alias-label-secondary);font-size:12px}',
      '.wr-steps li{margin:3px 0}',
      '.wr-sep{height:.5px;background:var(--dsw-alias-border-l1);margin:10px 0}',
      '.wr-tag{display:inline-block;padding:0 5px;border-radius:var(--dsw-radius-xs,4px);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-secondary);font-size:11px;margin-left:5px}',
      '.wr-preview{white-space:pre-wrap;word-break:break-word;max-height:84px;overflow:hidden}',
      '.wr-toggle{display:flex;align-items:center;gap:7px;margin-top:8px;font-size:12px;cursor:pointer;color:var(--dsw-alias-label-primary)}',
      '.wr-toggle input{accent-color:var(--dsw-alias-brand-primary);cursor:pointer}',
      '.wr-reader{display:flex;flex-direction:column;height:100%;min-height:0}',
      '.wr-readerBar{display:flex;align-items:center;gap:4px;padding:6px 8px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;flex-wrap:wrap}',
      '.wr-readerMeta{font-size:11px;color:var(--dsw-alias-label-secondary);flex:auto;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
      '.wr-readerBody{flex:auto;min-height:0;overflow:auto;padding:16px 18px 48px}',
      '.wr-readerText{white-space:pre-wrap;word-break:break-word;color:inherit}',
      '.wr-theme-follow{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}',
      '.wr-theme-light{background:#ffffff;color:#1c1c1e}',
      '.wr-theme-dark{background:#15171a;color:#c9ced3}',
      '.wr-theme-sepia{background:#f7f1e3;color:#3b3226}',
      '.wr-appearance{display:flex;flex-wrap:wrap;align-items:center;gap:5px;padding:6px 10px;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none}',
      '.wr-appearanceLabel{font-size:11px;color:var(--dsw-alias-label-secondary);margin-left:2px}',
      '.wr-chip{border:.5px solid var(--dsw-alias-border-l2);background:transparent;color:var(--dsw-alias-label-secondary);border-radius:999px;padding:1px 8px;font-size:11px;font-family:inherit;cursor:pointer}',
      '.wr-chip:hover{background:var(--dsw-alias-interactive-bg-hover)}',
      '.wr-chip[data-on="true"]{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}',
      '.wr-readerText p{margin:0 0 .95em}',
      '.wr-catalog{max-height:46%;overflow:auto;border-bottom:.5px solid var(--dsw-alias-border-l1);flex:none;padding:6px}',
      '.wr-catalogItem{padding:4px 8px;border-radius:var(--dsw-radius-sm,6px);cursor:pointer;font-size:12px;color:var(--dsw-alias-label-secondary)}',
      '.wr-catalogItem:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}',
      '.wr-catalogItem[data-active="true"]{color:var(--dsw-alias-brand-primary)}',
    ].join('')

    // --- shared helpers ------------------------------------------------------

    /** One human-readable line for any thrown value. */
    function errorText(error) {
      if (error === null || error === undefined) return '未知错误'
      if (typeof error.message === 'string' && error.message.length > 0) return error.message
      return String(error)
    }

    /**
     * Call one host operation over the plugin's own `/api/weread` route.
     * The route carries a result envelope, so a business failure arrives as a
     * value and a carrier failure as a throw; both become one Error here.
     */
    async function callRemote(ctx, endpoint, payload, signal) {
      let response
      try {
        response = await fetch('/api/weread', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ endpoint, payload: payload || {} }),
          signal,
        })
      } catch (error) {
        throw new Error(`与宿主插件通信失败：${errorText(error)}`)
      }
      if (!response.ok) {
        throw new Error(
          response.status === 401 || response.status === 403
            ? '宿主插件拒绝了这次请求（浏览器会话未通过鉴权），请重新加载页面。'
            : `宿主插件返回 HTTP ${response.status}。`,
        )
      }
      let result
      try {
        result = await response.json()
      } catch {
        throw new Error('宿主插件返回了无法解析的响应。')
      }
      if (result !== null && result !== undefined && result.ok === true) return result.value
      const info = (result && result.error) || {}
      const failure = new Error(info.message || '宿主插件没有返回结果。')
      failure.code = info.code || 'weread/transport'
      throw failure
    }

    /** Run an async loader with loading/ready/error state and a manual reload. */
    function useLoader(loader, deps) {
      const [state, setState] = React.useState({ status: 'loading' })
      const [nonce, setNonce] = React.useState(0)
      const latest = React.useRef(loader)
      latest.current = loader
      const keys = deps === undefined ? [nonce] : [...deps, nonce]
      React.useEffect(() => {
        let cancelled = false
        setState((previous) => (previous.status === 'ready' ? previous : { status: 'loading' }))
        Promise.resolve()
          .then(() => latest.current())
          .then(
            (value) => {
              if (!cancelled) setState({ status: 'ready', value })
            },
            (error) => {
              if (!cancelled) setState({ status: 'error', error })
            },
          )
        return () => {
          cancelled = true
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
      }, keys)
      const reload = React.useCallback(() => setNonce((value) => value + 1), [])
      return [state, reload]
    }

    /**
     * Reading appearance, mirrored from the host.
     *
     * These live in the plugin's own settings file rather than page storage,
     * so they survive an app restart and follow the profile.
     */
    const APPEARANCE_FALLBACK = { theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' }
    const THEME_LABELS = [
      ['follow', '跟随 DSH'],
      ['light', '浅色'],
      ['dark', '深色'],
      ['sepia', '羊皮纸'],
    ]
    const LINE_LABELS = [
      [1.5, '紧'],
      [1.9, '标准'],
      [2.3, '松'],
    ]
    const FAMILY_LABELS = [
      ['system', '默认'],
      ['serif', '宋体'],
      ['sans', '黑体'],
    ]
    const FAMILY_STACKS = {
      system: 'inherit',
      serif: "'Songti SC', 'SimSun', Georgia, serif",
      sans: "'PingFang SC', 'Microsoft YaHei', 'Helvetica Neue', sans-serif",
    }

    /** Progress bar with a numeric label. */
    function Progress(props) {
      const value = Math.max(0, Math.min(100, Number(props.value) || 0))
      return h(
        'div',
        null,
        h('div', { className: 'wr-progress' }, h('div', { className: 'wr-progressFill', style: { width: `${value}%` } })),
        h('div', { className: 'wr-faint' }, `阅读进度 ${value}%${props.hint ? ` · ${props.hint}` : ''}`),
      )
    }

    /** A cover that degrades to a flat block when the image cannot load. */
    function Cover(props) {
      const [failed, setFailed] = React.useState(false)
      if (typeof props.src !== 'string' || props.src.length === 0 || failed) {
        return h('div', { className: 'wr-coverFlat' })
      }
      return h('img', {
        className: 'wr-cover',
        src: props.src,
        alt: '',
        loading: 'lazy',
        referrerPolicy: 'no-referrer',
        onError: () => setFailed(true),
      })
    }

    /**
     * Render a WeRead recommendation score: the service reports 0–1000 and
     * its own UI shows the same number as a 0–100% recommendation.
     */
    function formatRating(rating) {
      const value = Number(rating)
      if (!Number.isFinite(value)) return undefined
      return value > 100 ? `推荐值 ${(value / 10).toFixed(1)}%` : `推荐值 ${value}%`
    }

    /**
     * Turn the paragraph layout into a fraction of the chapter's text.
     *
     * The server derives the stored percentage from the reported position
     * rather than from the percentage we send, so the position is the part
     * worth getting right: a linear scroll fraction is badly wrong whenever
     * paragraphs differ in length, which in a Chinese book they always do.
     *
     * @param scrollTop - how far the reading surface is scrolled.
     * @param boxes - `{ top, height, start, length }` per paragraph, in order.
     */
    function measurePosition(scrollTop, boxes) {
      if (!Array.isArray(boxes) || boxes.length === 0) return 0
      let total = 0
      for (const box of boxes) total += box.length || 0
      if (total <= 0) return 0
      let chars = 0
      for (const box of boxes) {
        const height = box.height || 0
        const length = box.length || 0
        if (height > 0 && scrollTop < box.top + height) {
          const inside = scrollTop <= box.top ? 0 : (scrollTop - box.top) / height
          chars = box.start + length * Math.min(1, inside)
          break
        }
        chars = box.start + length
      }
      return Math.min(1, Math.max(0, chars / total))
    }

    /**
     * A reader that has not touched the page for this long is not reading.
     */
    const READING_IDLE_MS = 60_000
    /** Report accumulated reading time once this much has built up. */
    const READING_FLUSH_SECONDS = 120
    /** Below this, an automatic flush is not worth an account write. */
    const READING_MIN_SECONDS = 30
    /** How often the visible counter refreshes. */
    const READING_DISPLAY_MS = 15_000

    /**
     * Credit reading time for one tick.
     *
     * Wall-clock time is not reading time: the panel stays mounted while you
     * work elsewhere, and an open tab is not attention. WeRead's own reader
     * reports the same `rt` field, so a tick counts only when the page is
     * visible and the reader interacted inside the idle window.
     *
     * Pure, so the accounting is testable without timers or a DOM.
     *
     * @param state - `{ activeSeconds, lastCountedAt, lastInteractionAt }`.
     * @param now - the current clock.
     * @param visible - whether the page is visible.
     */
    function creditReadingTime(state, now, visible) {
      const elapsed = (now - state.lastCountedAt) / 1000
      const attentive = now - state.lastInteractionAt <= READING_IDLE_MS
      const credited = visible && attentive && elapsed > 0 ? elapsed : 0
      return { ...state, activeSeconds: state.activeSeconds + credited, lastCountedAt: now }
    }

    /**
     * Whether the reader is actually on screen.
     *
     * A mounted view is not a viewed one: DSH keeps this tab mounted while you
     * work elsewhere, so `document.visibilityState` stays "visible" and the
     * page keeps reporting interaction. Without this check the book accrues
     * reading time for as long as the tab is open.
     *
     * @param element - the reading surface.
     * @param viewport - the current viewport height.
     */
    function isOnScreen(element, viewport) {
      if (element === null || element === undefined) return false
      // A `display: none` ancestor leaves the element with no client rects.
      if (typeof element.getClientRects === 'function' && element.getClientRects().length === 0) return false
      if (typeof element.getBoundingClientRect !== 'function') return false
      const rect = element.getBoundingClientRect()
      if (!rect || rect.width <= 0 || rect.height <= 0) return false
      if (!(viewport > 0)) return false
      return rect.bottom > 0 && rect.top < viewport
    }

    /** The first chapter with real text: catalogs open with 封面/版权 entries. */
    function firstReadableChapterUid(chapters) {
      if (!Array.isArray(chapters) || chapters.length === 0) return 0
      const readable = chapters.find((chapter) => Number(chapter.wordCount) > 0)
      return (readable ?? chapters[0]).chapterUid
    }

    /** Standard loading / error / empty frame for one view. */
    function Loaded(props) {
      if (props.state.status === 'loading') {
        return h('div', { className: 'wr-empty' }, '正在读取微信读书数据…')
      }
      if (props.state.status === 'error') {
        const error = props.state.error
        const code = error && error.code
        const needsConfig = code === 'weread/needs-config' || code === 'weread/bad-api-key'
        return h(
          'div',
          { className: 'wr-card' },
          h('div', { className: 'wr-title' }, needsConfig ? '还没有配置微信读书' : '读取失败'),
          h('p', { className: 'wr-error' }, errorText(error)),
          needsConfig
            ? h(
                'ol',
                { className: 'wr-steps' },
                h('li', null, '到微信读书官网领取 API Key'),
                h('li', null, '在下面的「设置」里粘贴并保存'),
                h('li', null, '回到「在读」即可看到书架与进度'),
              )
            : null,
          h('div', { className: 'wr-actions' }, h('button', { className: 'wr-btn', onClick: props.reload }, '重试')),
        )
      }
      return props.render(props.state.value)
    }

    /** Setup instructions shown whenever credentials are missing. */
    function SetupHint(props) {
      return h(
        'div',
        { className: 'wr-card' },
        h('div', { className: 'wr-title' }, '让 DSH 连上你的微信读书'),
        h(
          'ol',
          { className: 'wr-steps' },
          h('li', null, '打开 微信读书 → 获取 API Key 页面（需要登录）'),
          h('li', null, '复制形如 `wrk-…` 的 Key，粘贴到「设置」并保存'),
          h('li', null, '保存后会自动校验；成功即可看到书架、进度与笔记'),
        ),
        h(
          'div',
          { className: 'wr-actions' },
          h(
            'button',
            { className: 'wr-btn wr-btnPrimary', onClick: () => props.wrOpenReader(API_KEY_URL) },
            '打开获取页面',
          ),
          h('button', { className: 'wr-btn', onClick: props.onGoSettings }, '去设置'),
        ),
        h('p', { className: 'wr-faint' }, 'API Key 绑定你的账号身份，只保存在本机。'),
      )
    }

    // --- 在读 -----------------------------------------------------------------

    function NowView(props) {
      const [state, reload] = useLoader(async () => {
        const current = await props.wrCall('current')
        if (current === null || current === undefined || current.book === undefined) {
          return { current: null }
        }
        let detail = null
        try {
          detail = await props.wrCall('book', { bookId: current.book.bookId })
        } catch {
          // The shelf entry is enough to render; book detail only adds links.
        }
        return { current, detail }
      })
      return h(
        'div',
        { className: 'wr-body' },
        h(
          Loaded,
          {
            state,
            reload,
            render: (value) =>
              value.current === null
                ? h(
                    'div',
                    { className: 'wr-empty' },
                    '书架上还没有在读的书。',
                    h(
                      'div',
                      { className: 'wr-actions', style: { justifyContent: 'center' } },
                      h('button', { className: 'wr-btn', onClick: () => props.wrGoShelf() }, '打开书架'),
                    ),
                  )
                : h(NowCard, {
                    data: value,
                    wrOpenReader: props.wrOpenReader,
                    wrGoNotes: props.wrGoNotes,
                    onRead: props.onRead,
                    readerReady: props.readerReady,
                    reload,
                  }),
          },
        ),
      )
    }

    function NowCard(props) {
      const { current, detail } = props.data
      const book = current.book
      const progress = current.progress
      const readerLink = detail === null || detail === undefined ? undefined : detail.readerLink
      const deepLink = detail === null || detail === undefined ? undefined : detail.deepLink
      const reading = progress !== undefined && progress !== null ? progress : undefined
      const chapters = detail !== null && detail !== undefined ? detail.chapters : []
      const chapterUid = reading !== undefined ? reading.chapterUid : 0
      const firstChapterUid = firstReadableChapterUid(chapters)
      const canReadInPanel = props.readerReady === true && (chapterUid > 0 || firstChapterUid > 0)
      return h(
        'div',
        { className: 'wr-card' },
        h(
          'div',
          { className: 'wr-row' },
          h(Cover, { src: detail !== null && detail !== undefined && detail.cover ? detail.cover : book.cover }),
          h(
            'div',
            { style: { minWidth: 0, flex: 'auto' } },
            h('h3', { className: 'wr-title' }, `《${book.title}》`),
            book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
            h(Progress, {
              value: reading !== undefined ? reading.progress : 0,
              hint: book.readUpdateDate !== undefined ? `上次阅读 ${book.readUpdateDate}` : undefined,
            }),
          ),
        ),
        reading !== undefined && reading.recordReadingTime > 0
          ? h('div', { className: 'wr-faint' }, `累计阅读 ${Math.round(reading.recordReadingTime / 60)} 分钟`)
          : null,
        h(
          'div',
          { className: 'wr-actions' },
          canReadInPanel
            ? h(
                'button',
                {
                  className: 'wr-btn wr-btnPrimary',
                  onClick: () => props.onRead({ bookId: book.bookId, chapterUid, firstChapterUid, title: book.title }),
                },
                '在 DSH 里读',
              )
            : null,
          readerLink !== undefined
            ? h(
                'button',
                { className: canReadInPanel ? 'wr-btn' : 'wr-btn wr-btnPrimary', onClick: () => props.wrOpenReader(readerLink) },
                '官方阅读器',
              )
            : h(
                'button',
                { className: 'wr-btn', onClick: () => props.wrOpenReader('https://weread.qq.com/') },
                '打开微信读书',
              ),
          deepLink !== undefined
            ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(deepLink) }, '书籍详情')
            : null,
          h('button', { className: 'wr-btn', onClick: () => props.wrGoNotes(book) }, '看划线'),
          h('button', { className: 'wr-btn', onClick: props.reload }, '刷新'),
        ),
        h(
          'p',
          { className: 'wr-faint' },
          canReadInPanel
            ? '「在 DSH 里读」直接在侧边栏渲染正文；「官方阅读器」在 DSH 内置浏览器里打开微信读书官方页面。'
            : '官方网关不返回章节正文；配置阅读器 Cookie 后即可在侧边栏里直接读正文。',
        ),
      )
    }

    // --- 书架 -----------------------------------------------------------------

    function ShelfView(props) {
      const [selected, setSelected] = React.useState(null)
      const [state, reload] = useLoader(() => props.wrCall('shelf', { refresh: props.refresh === true }))
      if (selected !== null) {
        return h(BookDetail, {
          book: selected,
          wrCall: props.wrCall,
          wrOpenReader: props.wrOpenReader,
          onOpenNotes: props.onOpenNotes,
          onRead: props.onRead,
          readerReady: props.readerReady,
          onBack: () => setSelected(null),
        })
      }
      return h(
        'div',
        { className: 'wr-body' },
        h(Loaded, {
          state,
          reload,
          render: (shelf) => h(ShelfList, { shelf, onSelect: setSelected, reload }),
        }),
      )
    }

    function ShelfList(props) {
      const shelf = props.shelf
      if (shelf === null || shelf === undefined) return h('div', { className: 'wr-empty' }, '书架为空。')
      const books = shelf.books.slice().sort((left, right) => right.readUpdateTime - left.readUpdateTime)
      const albums = shelf.albums
      return h(
        'div',
        null,
        h(
          'div',
          { className: 'wr-row', style: { margin: '0 0 8px' } },
          h(
            'div',
            { className: 'wr-faint' },
            `共 ${shelf.totalCount} 项 · 电子书 ${books.length} · 有声书 ${albums.length}${shelf.hasMp ? ' · 含公众号' : ''}`,
          ),
          h('div', { className: 'wr-spacer' }),
          h('button', { className: 'wr-btn', onClick: props.reload }, '刷新'),
        ),
        h(
          'ul',
          { className: 'wr-list' },
          books.map((book) =>
            h(
              'li',
              { key: book.bookId, className: 'wr-item', onClick: () => props.onSelect(book) },
              h(
                'div',
                { className: 'wr-row' },
                h(Cover, { src: book.cover }),
                h(
                  'div',
                  { style: { minWidth: 0, flex: 'auto' } },
                  h('div', { style: { fontWeight: 600 } }, `《${book.title}》`, book.finishReading ? h('span', { className: 'wr-tag' }, '已读完') : null),
                  book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
                  book.readUpdateDate !== undefined ? h('div', { className: 'wr-faint' }, `最近阅读 ${book.readUpdateDate}`) : null,
                ),
              ),
            ),
          ),
        ),
        albums.length > 0
          ? h(
              'div',
              null,
              h('div', { className: 'wr-sep' }),
              h('div', { className: 'wr-faint' }, '有声书 / 专辑'),
              h(
                'ul',
                { className: 'wr-list' },
                albums.map((album) =>
                  h(
                    'li',
                    { key: album.bookId, className: 'wr-item' },
                    h('div', { style: { fontWeight: 600 } }, `《${album.title}》`),
                    h('div', { className: 'wr-faint' }, `${album.author}${album.trackCount > 0 ? ` · ${album.trackCount} 集` : ''}`),
                  ),
                ),
              ),
            )
          : null,
      )
    }

    function BookDetail(props) {
      const [state, reload] = useLoader(() => props.wrCall('book', { bookId: props.book.bookId }))
      return h(
        'div',
        { className: 'wr-body' },
        h('button', { className: 'wr-btn', onClick: props.onBack }, '← 返回书架'),
        h('div', { style: { height: 8 } }),
        h(Loaded, {
          state,
          reload,
          render: (detail) =>
            h(
              'div',
              { className: 'wr-card' },
              h(
                'div',
                { className: 'wr-row' },
                h(Cover, { src: detail.cover || props.book.cover }),
                h(
                  'div',
                  { style: { minWidth: 0, flex: 'auto' } },
                  h('h3', { className: 'wr-title' }, `《${detail.title || props.book.title}》`),
                  h('div', { className: 'wr-faint' }, detail.author || props.book.author),
                  formatRating(detail.rating) !== undefined
                    ? h('div', { className: 'wr-faint' }, formatRating(detail.rating))
                    : null,
                  detail.wordCount > 0
                    ? h('div', { className: 'wr-faint' }, `约 ${Math.round(detail.wordCount / 10000)} 万字`)
                    : null,
                  detail.progress !== undefined && detail.progress !== null
                    ? h(Progress, { value: detail.progress.progress })
                    : null,
                ),
              ),
              h(
                'div',
                { className: 'wr-actions' },
                (() => {
                  const chapterUid = detail.progress !== undefined && detail.progress !== null ? detail.progress.chapterUid : 0
                  const firstChapterUid = firstReadableChapterUid(detail.chapters)
                  if (props.readerReady !== true || (chapterUid <= 0 && firstChapterUid <= 0)) return null
                  return h(
                    'button',
                    {
                      className: 'wr-btn wr-btnPrimary',
                      onClick: () =>
                        props.onRead({
                          bookId: props.book.bookId,
                          chapterUid,
                          firstChapterUid,
                          title: detail.title || props.book.title,
                        }),
                    },
                    '在 DSH 里读',
                  )
                })(),
                detail.readerLink !== undefined
                  ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(detail.readerLink) }, '官方阅读器')
                  : null,
                detail.deepLink !== undefined
                  ? h('button', { className: 'wr-btn', onClick: () => props.wrOpenReader(detail.deepLink) }, '书籍详情')
                  : null,
                h(
                  'button',
                  {
                    className: 'wr-btn',
                    onClick: () => props.onOpenNotes({ bookId: props.book.bookId, title: detail.title || props.book.title }),
                  },
                  '看划线',
                ),
              ),
              detail.intro.length > 0 ? h('div', { className: 'wr-sep' }) : null,
              detail.intro.length > 0 ? h('div', { className: 'wr-preview wr-muted' }, detail.intro) : null,
              detail.chapters.length > 0
                ? h('div', { className: 'wr-faint', style: { marginTop: 8 } }, `目录共 ${detail.chapters.length} 章`)
                : null,
            ),
        }),
      )
    }

    // --- 笔记 -----------------------------------------------------------------

    function NotesView(props) {
      const initial = props.initialBook === undefined ? null : props.initialBook
      const [selected, setSelected] = React.useState(initial)
      const [state, reload] = useLoader(() => props.wrCall('notebooks'))
      if (selected !== null) {
        return h(NotesDetail, { book: selected, wrCall: props.wrCall, onBack: () => setSelected(null) })
      }
      return h(
        'div',
        { className: 'wr-body' },
        h(Loaded, {
          state,
          reload,
          render: (value) =>
            value.books.length === 0
              ? h('div', { className: 'wr-empty' }, '还没有任何划线或笔记。')
              : h(
                  'div',
                  null,
                  h(
                    'div',
                    { className: 'wr-faint', style: { marginBottom: 8 } },
                    `${value.totalBookCount} 本书 · ${value.totalNoteCount} 条笔记（划线 + 想法 + 书签）`,
                  ),
                  h(
                    'ul',
                    { className: 'wr-list' },
                    value.books.map((book) =>
                      h(
                        'li',
                        { key: book.bookId, className: 'wr-item', onClick: () => setSelected(book) },
                        h(
                          'div',
                          { className: 'wr-row' },
                          h(Cover, { src: book.cover }),
                          h(
                            'div',
                            { style: { minWidth: 0, flex: 'auto' } },
                            h('div', { style: { fontWeight: 600 } }, `《${book.title}》`),
                            book.author.length > 0 ? h('div', { className: 'wr-faint' }, book.author) : null,
                            h(
                              'div',
                              { className: 'wr-faint' },
                              `划线 ${book.noteCount} · 想法 ${book.reviewCount} · 书签 ${book.bookmarkCount} · 进度 ${book.readingProgress}%`,
                            ),
                          ),
                        ),
                      ),
                    ),
                  ),
                ),
        }),
      )
    }

    function NotesDetail(props) {
      const [state, reload] = useLoader(() => props.wrCall('notes', { bookId: props.book.bookId }))
      return h(
        'div',
        { className: 'wr-body' },
        h('button', { className: 'wr-btn', onClick: props.onBack }, '← 返回笔记列表'),
        h('div', { style: { height: 8 } }),
        h(Loaded, {
          state,
          reload,
          render: (value) =>
            value.chapters.length === 0
              ? h('div', { className: 'wr-empty' }, '这本书里没有找到划线或想法。')
              : h(
                  'div',
                  null,
                  h('div', { className: 'wr-faint' }, `${value.highlightCount} 条划线 · ${value.thoughtCount} 条想法`),
                  value.chapters.map((chapter) =>
                    h(
                      'div',
                      { key: chapter.chapterUid || chapter.chapterTitle },
                      h('div', { className: 'wr-chapter' }, chapter.chapterTitle || '未归类'),
                      chapter.highlights.map((highlight, index) =>
                        h('div', { key: `h${index}`, className: 'wr-quote' }, highlight.text),
                      ),
                      chapter.thoughts.map((thought, index) =>
                        h(
                          'div',
                          { key: `t${index}`, className: 'wr-thought' },
                          h('div', null, thought.content),
                          thought.abstract.length > 0
                            ? h('div', { className: 'wr-faint' }, `原文：${thought.abstract}`)
                            : null,
                        ),
                      ),
                    ),
                  ),
                ),
        }),
      )
    }

    // --- 阅读器 ---------------------------------------------------------------

    function ReaderView(props) {
      const { wrCall, bookId, bookTitle, syncEnabled, onBack, onAppearance } = props
      const [chapterUid, setChapterUid] = React.useState(props.chapterUid)
      const [appearance, setAppearance] = React.useState(() => ({
        ...APPEARANCE_FALLBACK,
        ...(props.readerSettings ?? {}),
      }))
      const [showCatalog, setShowCatalog] = React.useState(false)
      const [showAppearance, setShowAppearance] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const [busy, setBusy] = React.useState(false)
      // How far through the chapter the reader has scrolled. The host turns
      // this into the book's own position units, because it owns the catalog.
      // A ref, not state: scrolling must not re-render the whole chapter.
      const positionRef = React.useRef({ chapterUid: props.chapterUid, ratio: 0 })
      const bodyRef = React.useRef(null)
      const paragraphRefs = React.useRef([])
      const layoutRef = React.useRef({ at: 0, boxes: [] })
      // Reading-time accounting: only attentive, visible time counts.
      const readingRef = React.useRef({
        activeSeconds: 0,
        lastCountedAt: Date.now(),
        lastInteractionAt: Date.now(),
      })
      const [activeSeconds, setActiveSeconds] = React.useState(0)
      const summaryRef = React.useRef('')
      const flushRef = React.useRef(null)
      const lastChapterRef = React.useRef(props.chapterUid)
      const [state, reload] = useLoader(() => wrCall('chapter', { bookId, chapterUid }), [bookId, chapterUid])

      React.useEffect(() => {
        // Leaving a chapter reports what was read in it, at its own position,
        // before the position ref moves on.
        if (lastChapterRef.current !== chapterUid) {
          void flushRef.current?.(false)
          lastChapterRef.current = chapterUid
          positionRef.current = { chapterUid, ratio: 0 }
          readingRef.current = { ...readingRef.current, lastCountedAt: Date.now() }
          if (bodyRef.current !== null) bodyRef.current.scrollTop = 0
        }
        setMessage(null)
        layoutRef.current = { at: 0, boxes: [] }
        paragraphRefs.current = []
      }, [chapterUid, appearance.fontSize, appearance.lineHeight, appearance.fontFamily])

      // The chapter text is only needed as a short "where you are" summary.
      React.useEffect(() => {
        summaryRef.current =
          state.status === 'ready' && state.value.paragraphs.length > 0
            ? state.value.paragraphs[0].slice(0, 20)
            : ''
      }, [state])

      /**
       * Report the position, carrying whatever reading time has built up.
       *
       * The manual button forces a report; the timer, a chapter change and
       * leaving the reader only send once the time is worth an account write.
       */
      const report = async (force) => {
        const seconds = Math.floor(readingRef.current.activeSeconds)
        if (!force && seconds < READING_MIN_SECONDS) return undefined
        const { chapterUid: uid, ratio } = positionRef.current
        readingRef.current = { ...readingRef.current, activeSeconds: 0, lastCountedAt: Date.now() }
        try {
          return await wrCall('reportProgress', {
            bookId,
            chapterUid: uid,
            positionRatio: ratio,
            summary: summaryRef.current,
            elapsedSeconds: seconds,
          })
        } catch (error) {
          // Hand the time back so a later report can retry it.
          readingRef.current = { ...readingRef.current, activeSeconds: readingRef.current.activeSeconds + seconds }
          throw error
        }
      }
      flushRef.current = report

      // The accounting ticker, plus the interaction and visibility it needs.
      React.useEffect(() => {
        if (syncEnabled !== true) return undefined
        const interact = () => {
          readingRef.current = { ...readingRef.current, lastInteractionAt: Date.now() }
        }
        const tick = () => {
          const now = Date.now()
          // Reading time belongs to the book you are looking at, not to the
          // app being open: the tab stays mounted while you work elsewhere.
          const watching = isOnScreen(bodyRef.current, window.innerHeight || 0)
          const next = creditReadingTime(readingRef.current, now, watching && document.visibilityState === 'visible')
          readingRef.current = next
          if (next.activeSeconds >= READING_FLUSH_SECONDS) void flushRef.current?.(false).catch(() => {})
        }
        const events = ['pointerdown', 'keydown', 'wheel', 'touchstart', 'scroll']
        for (const type of events) document.addEventListener(type, interact, { capture: true, passive: true })
        const ticks = setInterval(tick, 1000)
        const display = setInterval(() => setActiveSeconds(Math.floor(readingRef.current.activeSeconds)), READING_DISPLAY_MS)
        return () => {
          clearInterval(ticks)
          clearInterval(display)
          for (const type of events) document.removeEventListener(type, interact, { capture: true })
          // Leaving the reader keeps what was read rather than dropping it.
          void flushRef.current?.(false).catch(() => {})
        }
      }, [syncEnabled])

      /** Measure each paragraph's box, in the reading surface's coordinates. */
      const measureLayout = () => {
        const element = bodyRef.current
        if (element === null) return []
        const containerTop = element.getBoundingClientRect().top
        const boxes = []
        for (const node of paragraphRefs.current) {
          if (node === null || node === undefined) continue
          const rect = node.getBoundingClientRect()
          boxes.push({
            top: rect.top - containerTop + element.scrollTop,
            height: rect.height,
            start: Number(node.dataset.start),
            length: Number(node.dataset.length),
          })
        }
        return boxes
      }

      /** Report how far through the chapter's text the reader actually is. */
      const trackPosition = () => {
        const element = bodyRef.current
        if (element === null) return
        readingRef.current = { ...readingRef.current, lastInteractionAt: Date.now() }
        const stamp = Date.now()
        if (layoutRef.current.boxes.length === 0 || stamp - layoutRef.current.at > 250) {
          layoutRef.current = { at: stamp, boxes: measureLayout() }
        }
        positionRef.current = {
          chapterUid,
          ratio: measurePosition(element.scrollTop, layoutRef.current.boxes),
        }
      }

      // The host is the source of truth; this only mirrors it back in, so a
      // saved appearance applies as soon as the status read lands.
      React.useEffect(() => {
        if (props.readerSettings !== undefined) {
          setAppearance({ ...APPEARANCE_FALLBACK, ...props.readerSettings })
        }
      }, [props.readerSettings])

      /** Apply one appearance change locally at once, then persist it. */
      const updateAppearance = (patch) => {
        const next = { ...appearance, ...patch }
        setAppearance(next)
        if (typeof onAppearance === 'function') onAppearance(next)
      }

      const changeFont = (delta) => {
        updateAppearance({ fontSize: Math.max(12, Math.min(30, appearance.fontSize + delta)) })
      }

      const sync = async () => {
        setBusy(true)
        setMessage(null)
        const seconds = Math.floor(readingRef.current.activeSeconds)
        try {
          const value = await report(true)
          setMessage({
            kind: 'ok',
            text: `已上报：进度按本地估算 ${value.progress}%，阅读时长 ${Math.max(1, Math.round(seconds / 60))} 分钟（面板显示的进度是官方数值；最终以微信读书为准）。`,
          })
          setActiveSeconds(0)
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      const value = state.status === 'ready' ? state.value : undefined
      const readLabel =
        syncEnabled === true && activeSeconds >= 60 ? ` · 本次已读 ${Math.round(activeSeconds / 60)} 分钟` : ''
      const meta =
        value === undefined
          ? `《${bookTitle}》`
          : `《${bookTitle || value.bookId}》 · ${value.title}${value.chapterIdx >= 0 ? `（${value.chapterIdx + 1}/${value.chapterCount}）` : ''}${readLabel}`
      return h(
        'div',
        { className: 'wr-reader' },
        h(
          'div',
          { className: 'wr-readerBar' },
          h('button', { className: 'wr-btn', onClick: onBack }, '←'),
          h(
            'button',
            {
              className: 'wr-btn',
              disabled: value === undefined || value.previous === undefined,
              onClick: () => value !== undefined && value.previous !== undefined && setChapterUid(value.previous.chapterUid),
            },
            '上一章',
          ),
          h(
            'button',
            {
              className: 'wr-btn',
              disabled: value === undefined || value.next === undefined,
              onClick: () => value !== undefined && value.next !== undefined && setChapterUid(value.next.chapterUid),
            },
            '下一章',
          ),
          h('button', { className: 'wr-btn', onClick: () => setShowCatalog((shown) => !shown) }, '目录'),
          h('button', { className: 'wr-btn', onClick: () => setShowAppearance((shown) => !shown) }, '外观'),
          h('div', { className: 'wr-spacer' }),
          h('button', { className: 'wr-btn', title: '减小字号', onClick: () => changeFont(-1) }, 'A-'),
          h('button', { className: 'wr-btn', title: '增大字号', onClick: () => changeFont(1) }, 'A+'),
          syncEnabled ? h('button', { className: 'wr-btn', disabled: busy, onClick: sync }, busy ? '同步中…' : '同步进度') : null,
        ),
        h('div', { className: 'wr-readerMeta', style: { padding: '4px 10px' } }, meta),
        showCatalog && value !== undefined
          ? h(CatalogList, {
              chapters: value.chapters,
              activeUid: chapterUid,
              onPick: (uid) => {
                setChapterUid(uid)
                setShowCatalog(false)
              },
            })
          : null,
        showAppearance
          ? h(
              'div',
              { className: 'wr-appearance' },
              h('span', { className: 'wr-appearanceLabel' }, '主题'),
              THEME_LABELS.map(([id, label]) =>
                h(
                  'button',
                  { key: id, className: 'wr-chip', 'data-on': String(appearance.theme === id), onClick: () => updateAppearance({ theme: id }) },
                  label,
                ),
              ),
              h('span', { className: 'wr-appearanceLabel' }, '行距'),
              LINE_LABELS.map(([value_, label]) =>
                h(
                  'button',
                  { key: label, className: 'wr-chip', 'data-on': String(appearance.lineHeight === value_), onClick: () => updateAppearance({ lineHeight: value_ }) },
                  label,
                ),
              ),
              h('span', { className: 'wr-appearanceLabel' }, '字体'),
              FAMILY_LABELS.map(([id, label]) =>
                h(
                  'button',
                  { key: id, className: 'wr-chip', 'data-on': String(appearance.fontFamily === id), onClick: () => updateAppearance({ fontFamily: id }) },
                  label,
                ),
              ),
            )
          : null,
        h(
          'div',
          {
            ref: bodyRef,
            onScroll: trackPosition,
            className: `wr-readerBody wr-theme-${appearance.theme}`,
            style: {
              fontSize: `${appearance.fontSize}px`,
              lineHeight: appearance.lineHeight,
              fontFamily: FAMILY_STACKS[appearance.fontFamily] ?? 'inherit',
            },
          },
          h(Loaded, {
            state,
            reload,
            render: (chapter) => {
              if (chapter.paragraphs.length === 0) {
                return h('div', { className: 'wr-empty' }, '这一章没有可显示的正文。')
              }
              let cursor = 0
              const offsets = chapter.paragraphs.map((paragraph) => {
                const start = cursor
                cursor += paragraph.length
                return start
              })
              return h(
                'div',
                { className: 'wr-readerText' },
                chapter.paragraphs.map((paragraph, index) =>
                  h(
                    'p',
                    {
                      key: index,
                      ref: (node) => {
                        paragraphRefs.current[index] = node
                      },
                      'data-start': offsets[index],
                      'data-length': paragraph.length,
                    },
                    paragraph,
                  ),
                ),
              )
            },
          }),
        ),
        message !== null
          ? h('p', { className: message.kind === 'ok' ? 'wr-ok' : 'wr-error', style: { padding: '0 10px 8px' } }, message.text)
          : null,
      )
    }

    /** The chapter list the reader jumps through. */
    function CatalogList(props) {
      return h(
        'div',
        { className: 'wr-catalog' },
        props.chapters.map((chapter) =>
          h(
            'div',
            {
              key: chapter.chapterUid,
              className: 'wr-catalogItem',
              'data-active': String(chapter.chapterUid === props.activeUid),
              onClick: () => props.onPick(chapter.chapterUid),
            },
            chapter.title || `第 ${chapter.chapterIdx + 1} 章`,
          ),
        ),
      )
    }

    // --- 设置 -----------------------------------------------------------------

    function SettingsView(props) {
      const [state, reload] = useLoader(() => props.wrCall('status'))
      const [apiKey, setApiKey] = React.useState('')
      const [cookie, setCookie] = React.useState('')
      const [busy, setBusy] = React.useState(false)
      const [message, setMessage] = React.useState(null)
      const status = state.status === 'ready' ? state.value : undefined

      const run = async (operation) => {
        setBusy(true)
        setMessage(null)
        try {
          setMessage({ kind: 'ok', text: await operation() })
        } catch (error) {
          setMessage({ kind: 'error', text: errorText(error) })
        } finally {
          setBusy(false)
        }
      }

      const save = () => {
        const patch = {}
        if (apiKey.trim().length > 0) patch.apiKey = apiKey.trim()
        if (cookie.trim().length > 0) patch.cookie = cookie.trim()
        if (Object.keys(patch).length === 0) {
          setMessage({ kind: 'error', text: '请先填入 API Key 或 Cookie。' })
          return
        }
        return run(async () => {
          await props.wrCall('configure', patch)
          setApiKey('')
          setCookie('')
          reload()
          return '已保存。'
        })
      }

      const toggleSync = (value) =>
        run(async () => {
          await props.wrCall('configure', { syncProgress: value })
          reload()
          return value ? '已开启进度回写。' : '已关闭进度回写。'
        })

      const verify = () => run(async () => {
        const value = await props.wrCall('verify')
        reload()
        return `连接成功：书架共 ${value.shelfCount} 项（电子书 ${value.bookCount} 本）。`
      })

      return h(
        'div',
        { className: 'wr-body' },
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '连接状态'),
          state.status === 'loading'
            ? h('div', { className: 'wr-faint' }, '读取中…')
            : state.status === 'error'
              ? h('p', { className: 'wr-error' }, errorText(state.error))
              : h(
                  'ul',
                  { className: 'wr-list' },
                  h('li', { className: 'wr-faint' }, `API Key：${status.apiKeyConfigured ? `已配置 ${status.apiKeyHint}` : '未配置'}`),
                  h('li', { className: 'wr-faint' }, `阅读器 Cookie：${status.cookieConfigured ? `已配置（${status.cookieNames.join(', ')}）` : '未配置（用于后续原生阅读正文）'}`),
                  h('li', { className: 'wr-faint' }, `skill_version：${status.skillVersion}`),
                  h('li', { className: 'wr-faint' }, `数据目录：${status.dataDir}`),
                ),
          status !== undefined && status.upgradeInfo !== undefined
            ? h('p', { className: 'wr-warn' }, `官方 skill 提示升级：${JSON.stringify(status.upgradeInfo)}`)
            : null,
          status !== undefined && status.apiKeyConfigured && status.apiKeyLooksValid === false
            ? h('p', { className: 'wr-warn' }, '当前 API Key 不像 `wrk-` 开头的格式。')
            : null,
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn', disabled: busy, onClick: () => reload() }, '刷新状态'),
            h('button', { className: 'wr-btn', disabled: busy, onClick: verify }, '测试连接'),
          ),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, 'API Key'),
          h('p', { className: 'wr-faint' }, '用于书架、进度、划线、统计与搜索。绑定你的账号身份。'),
          h(
            'div',
            { className: 'wr-field' },
            h('input', {
              className: 'wr-input',
              type: 'password',
              value: apiKey,
              placeholder: 'wrk-…',
              autoComplete: 'off',
              spellCheck: false,
              onChange: (event) => setApiKey(event.target.value),
            }),
          ),
          h(
            'div',
            { className: 'wr-actions' },
            h('button', { className: 'wr-btn', disabled: busy, onClick: () => props.wrOpenReader(API_KEY_URL) }, '获取 API Key'),
          ),
          h('p', { className: 'wr-faint', style: { marginTop: 6 } }, API_KEY_URL),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '进度回写'),
          h(
            'p',
            { className: 'wr-faint' },
            '打开后，阅读器里的「同步进度」会把当前章节与阅读时长写回微信读书。这是账号写操作，百分比按章节在目录中的位置估算。',
          ),
          h(
            'label',
            { className: 'wr-toggle' },
            h('input', {
              type: 'checkbox',
              checked: status !== undefined && status.syncProgress === true,
              disabled: busy,
              onChange: (event) => toggleSync(event.target.checked),
            }),
            h('span', null, status !== undefined && status.syncProgress === true ? '已开启' : '已关闭'),
          ),
        ),
        h(
          'div',
          { className: 'wr-card' },
          h('h3', { className: 'wr-title' }, '阅读器 Cookie（可选）'),
          h(
            'p',
            { className: 'wr-faint' },
            '官方接口不返回章节正文。若要在这个侧边栏里直接读正文，需要从已登录的 weread.qq.com 复制完整 Cookie 头（须含 wr_vid 与 wr_skey）。',
          ),
          h(
            'div',
            { className: 'wr-field' },
            h('textarea', {
              className: 'wr-input',
              rows: 3,
              value: cookie,
              placeholder: 'wr_vid=…; wr_skey=…; wr_rt=…',
              spellCheck: false,
              onChange: (event) => setCookie(event.target.value),
            }),
          ),
        ),
        h(
          'div',
          { className: 'wr-actions' },
          h('button', { className: 'wr-btn wr-btnPrimary', disabled: busy, onClick: save }, busy ? '保存中…' : '保存'),
        ),
        message !== null ? h('p', { className: message.kind === 'ok' ? 'wr-ok' : 'wr-error' }, message.text) : null,
        h('p', { className: 'wr-faint', style: { marginTop: 10 } }, '凭据以 0600 权限保存在本机数据目录，不会发送给除微信读书官方接口以外的任何服务。'),
      )
    }

    // --- 面板 -----------------------------------------------------------------

    function WereadTab(props) {
      const wrCall = props.wrCall
      const wrOpenReader = props.wrOpenReader
      const [view, setView] = React.useState('now')
      const [notesBook, setNotesBook] = React.useState(undefined)
      const [nonce, setNonce] = React.useState(0)
      const [reader, setReader] = React.useState(null)
      // One local status read decides whether the in-panel reader is offered
      // at all, so the views never show a button that can only fail.
      const [statusState, reloadStatus] = useLoader(() =>
        typeof wrCall === 'function'
          ? wrCall('status')
          : Promise.resolve({ cookieConfigured: false, syncProgress: false }),
      )
      const status = statusState.status === 'ready' ? statusState.value : undefined
      const readerReady = status !== undefined && status.cookieConfigured === true
      const syncEnabled = status !== undefined && status.syncProgress === true

      const openNotes = (book) => {
        setNotesBook(book)
        setView('notes')
      }

      /** Persist one reading-appearance change, then re-read the status. */
      const saveAppearance = (next) => {
        if (typeof wrCall !== 'function') return
        Promise.resolve(wrCall('configure', { reader: next }))
          .then(() => reloadStatus())
          .catch(() => {
            // The reader keeps the value it already applied; a failed write
            // only means it will not survive the next open.
          })
      }

      /** Open the in-panel reader at a chapter, or at the book's first one. */
      const openReader = (request) => {
        if (request === null || request === undefined) return
        const chapterUid = Number(request.chapterUid) > 0 ? Number(request.chapterUid) : Number(request.firstChapterUid)
        if (!Number.isFinite(chapterUid) || chapterUid <= 0) return
        setReader({ bookId: request.bookId, chapterUid, title: request.title ?? '' })
      }

      const tabs = [
        ['now', '在读'],
        ['shelf', '书架'],
        ['notes', '笔记'],
        ['settings', '设置'],
      ]

      if (reader !== null) {
        return h(
          'div',
          { className: 'wr-root' },
          h(ReaderView, {
            wrCall,
            bookId: reader.bookId,
            bookTitle: reader.title,
            chapterUid: reader.chapterUid,
            syncEnabled,
            readerSettings: status === undefined ? undefined : status.reader,
            onAppearance: saveAppearance,
            onBack: () => setReader(null),
          }),
        )
      }

      let body
      if (typeof wrCall !== 'function') {
        body = h('div', { className: 'wr-body' }, h('p', { className: 'wr-error' }, '客户端没有拿到宿主通道，请重新加载页面。'))
      } else if (view === 'shelf') {
        body = h(ShelfView, {
          key: `shelf${nonce}`,
          wrCall,
          wrOpenReader,
          onOpenNotes: openNotes,
          onRead: openReader,
          readerReady,
          refresh: false,
        })
      } else if (view === 'notes') {
        body = h(NotesView, { key: `notes${nonce}`, wrCall, initialBook: notesBook })
      } else if (view === 'settings') {
        body = h(SettingsView, { key: `settings${nonce}`, wrCall, wrOpenReader })
      } else {
        body = h(NowView, {
          key: `now${nonce}`,
          wrCall,
          wrOpenReader,
          onRead: openReader,
          readerReady,
          wrGoNotes: openNotes,
          wrGoShelf: () => setView('shelf'),
        })
      }

      return h(
        'div',
        { className: 'wr-root' },
        h(
          'div',
          { className: 'wr-tabs' },
          tabs.map(([id, label]) =>
            h('button', { key: id, className: 'wr-tab', 'data-active': String(view === id), onClick: () => setView(id) }, label),
          ),
          h('div', { className: 'wr-spacer' }),
          h(
            'button',
            { className: 'wr-icon', title: '重新加载', onClick: () => setNonce((value) => value + 1) },
            h(
              'svg',
              { width: 14, height: 14, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.5, 'aria-hidden': true },
              h('path', { d: 'M13 8a5 5 0 1 1-1.5-3.5' }),
              h('path', { d: 'M13 2.5V6H9.5' }),
            ),
          ),
        ),
        body,
      )
    }

    /** Guide card artwork: an open book. */
    function WereadGuideIcon() {
      return h(
        'svg',
        { width: 26, height: 26, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.4, 'aria-hidden': true },
        h('path', { d: 'M12 6.5C10.4 5.2 8.4 4.6 5.5 4.6v12.9c2.9 0 4.9.6 6.5 1.9 1.6-1.3 3.6-1.9 6.5-1.9V4.6c-2.9 0-4.9.6-6.5 1.9Z' }),
        h('path', { d: 'M12 6.5v12.9' }),
      )
    }

    return {
      inject: ['slots'],
      // The views are exposed for the offline test harness only: the loader
      // reads `inject` and `apply`, and nothing in the page touches this.
      // Without it the views are unreachable — every one of them sits behind a
      // slot body or a loader callback that no test can invoke.
      __views: {
        WereadTab,
        // Pure helpers are exposed here too, so the layout maths is testable
        // without a browser layout engine.
        measurePosition,
        creditReadingTime,
        isOnScreen,
        Loaded,
        Progress,
        Cover,
        NowView,
        NowCard,
        ShelfView,
        ShelfList,
        BookDetail,
        NotesView,
        NotesDetail,
        ReaderView,
        CatalogList,
        SettingsView,
      },
      apply(ctx) {
        // The right-Sidebar face is only readable inside a scope that injected
        // it, so it is captured there rather than read off the plugin context.
        let sidebarRight
        const face = {
          wrCall: (endpoint, payload) => callRemote(ctx, endpoint, payload),
          wrOpenReader: (url) => openInApp(sidebarRight, url),
        }

        // Styles live in one idempotent tag and are removed with the plugin.
        ctx.effect(() => {
          const tagId = 'dsh-weread/panel.css'
          const existing = document.querySelector(`style[data-plugin-css="${tagId}"]`)
          if (existing !== null) {
            existing.textContent = CSS
            return () => {}
          }
          const tag = document.createElement('style')
          tag.dataset.plugin = 'dsh-weread'
          tag.dataset.pluginCss = tagId
          tag.textContent = CSS
          document.head.appendChild(tag)
          return () => {
            tag.remove()
          }
        }, 'dsh-weread: styles')

        // The tab type and its body both wait for the sidebar registry, so
        // activation order never breaks the registration.
        ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scope) => {
          scope.effect(() => {
            sidebarRight = scope.sidebarRight
            return () => {
              sidebarRight = undefined
            }
          }, 'dsh-weread: sidebar face')
          scope.effect(
            () =>
              scope.sidebarRightTabs.register({
                id: TAB_ID,
                kind: TAB_KIND,
                priority: 'extension',
                title: () => '微信读书',
                keepMounted: true,
                guide: [
                  {
                    id: 'open',
                    order: 40,
                    title: () => '微信读书',
                    description: () => '碎片时间读你的书架',
                    icon: WereadGuideIcon,
                  },
                ],
              }),
            'dsh-weread: tab type',
          )
        })

        ctx.slots.inject('sidebar.right.pane.tab', () =>
          ctx.slots.register(
            {
              name: 'sidebar.right.pane.tab',
              key: TAB_ID,
              inject: () => face,
            },
            WereadTab,
          ),
        )
      },
    }

    /**
     * Open a URL in the right sidebar's Browser tab, falling back to a new
     * browser tab when that plugin is not mounted (Web profiles ship it off).
     */
    function openInApp(sidebarRight, url) {
      if (typeof url !== 'string' || url.length === 0) return
      try {
        if (sidebarRight !== undefined && typeof sidebarRight.openTab === 'function') {
          sidebarRight.openTab(BROWSER_KIND, { params: { url } })
          return
        }
      } catch {
        // Fall through to the browser's own window.
      }
      try {
        window.open(url, '_blank', 'noopener,noreferrer')
      } catch {
        // Nothing else to try.
      }
    }
  },
})
