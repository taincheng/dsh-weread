/**
 * Client half test.
 *
 * The browser bundle cannot be imported by Node directly — it registers itself
 * on `window.__ModuleLoader__` and takes React from the page's module table —
 * so this loads it with a stub loader and a minimal hook shim. That is enough
 * to catch the failure mode the DSH guidance warns about ("a throwing
 * component blanks your slot entry"): the factory, the registrations and the
 * first render of every view all run here.
 *
 * Run: node test/client.test.mjs
 */

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

// --- the page environment the bundle expects --------------------------------

let definition
globalThis.window = {
  __ModuleLoader__: {
    load: (value) => {
      definition = value
    },
  },
}

const styleTags = []
const documentListeners = []
globalThis.document = {
  // The reader's accounting effect registers interaction listeners and reads
  // visibility, so the stub has to carry that much of the DOM surface.
  visibilityState: 'visible',
  addEventListener: (type, handler) => {
    documentListeners.push({ type, handler })
  },
  removeEventListener: (type) => {
    for (let i = documentListeners.length - 1; i >= 0; i -= 1) {
      if (documentListeners[i].type === type) documentListeners.splice(i, 1)
    }
  },
  querySelector: () => null,
  createElement: () => {
    const tag = { dataset: {}, textContent: '' }
    styleTags.push(tag)
    return tag
  },
  head: { appendChild: () => {} },
}

// --- a minimal React shim: enough to render once, synchronously -------------

let hooks = []
let hookIndex = 0
let pendingEffects = []
/** Every function component the render produced, so views can be driven directly. */
const components = new Map()

function createElement(type, props, ...children) {
  if (typeof type === 'function' && typeof type.name === 'string' && type.name.length > 0) {
    components.set(type.name, type)
  }
  const element = { type, props: { ...(props ?? {}) }, children: children.filter((child) => child !== undefined && child !== null) }
  return element
}

const ReactShim = {
  createElement,
  // State and refs capture the store they were created in: a setter is called
  // from a promise callback, long after the render pass that made it, so
  // reading the module-level `hooks` there would write into another
  // component's state.
  useState: (initial) => {
    const store = hooks
    const index = hookIndex++
    if (store[index] === undefined) store[index] = typeof initial === 'function' ? initial() : initial
    return [store[index], (next) => {
      store[index] = typeof next === 'function' ? next(store[index]) : next
    }]
  },
  // Dep-aware, like React: an effect is queued when its dependencies change,
  // so a state change made between passes re-runs what depends on it.
  useEffect: (callback, deps) => {
    const store = hooks
    const index = hookIndex++
    const previous = store[index]
    const same =
      previous !== undefined &&
      deps !== undefined &&
      previous.deps.length === deps.length &&
      deps.every((value, at) => Object.is(value, previous.deps[at]))
    if (same) return
    store[index] = { deps: deps === undefined ? [] : deps }
    pendingEffects.push(callback)
  },
  useRef: (initial) => {
    const store = hooks
    const index = hookIndex++
    if (store[index] === undefined) store[index] = { current: initial }
    return store[index]
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
}

await import('../client.js')

console.log('\nmodule registration')
check('the bundle registers under its package name', definition?.id === 'dsh-weread', definition?.id)
check('the factory is callable', typeof definition?.factory === 'function')

const plugin = definition.factory((specifier) => {
  if (specifier === 'react') return ReactShim
  throw new Error(`unexpected require(${specifier})`)
})
check('the plugin injects the slot service', Array.isArray(plugin.inject) && plugin.inject.includes('slots'), JSON.stringify(plugin.inject))
check('the plugin exposes apply', typeof plugin.apply === 'function')

// --- apply: what the sidebar actually receives ------------------------------

const registrations = []
const injectedDeps = []
const effects = []

function makeScope(deps) {
  return {
    effect: (callback) => {
      effects.push(callback())
      return () => {}
    },
    sidebarRight: {
      openTab: (kind, options) => {
        scopeCalls.push({ kind, options })
      },
    },
    sidebarRightTabs: {
      register: (value) => {
        tabType = value
        return () => {}
      },
    },
    deps,
  }
}

let tabType
const scopeCalls = []

const ctx = {
  effect: (callback) => {
    effects.push(callback())
    return () => {}
  },
  inject: (deps, callback) => {
    injectedDeps.push(deps)
    callback(makeScope(deps))
    return () => {}
  },
  slots: {
    inject: (key, callback) => {
      // The entry exists before the callback runs, because the callback is
      // what performs the registration.
      const entry = { key }
      registrations.push(entry)
      entry.disposer = callback()
      return () => {}
    },
    register: (options, component) => {
      const entry = registrations[registrations.length - 1]
      entry.options = options
      entry.component = component
      return () => {}
    },
  },
}

plugin.apply(ctx)

console.log('\nregistrations')
check('styles were injected', styleTags.length === 1 && styleTags[0].textContent.includes('.wr-root'), String(styleTags.length))
check('the sidebar services were injected', JSON.stringify(injectedDeps) === JSON.stringify([['sidebarRightTabs', 'sidebarRight']]), JSON.stringify(injectedDeps))
check('a tab type was registered', tabType !== undefined)
check('the tab kind is weread', tabType?.kind === 'weread', tabType?.kind)
check('the tab type keeps its body mounted', tabType?.keepMounted === true)
check('the guide offers one entry', Array.isArray(tabType?.guide) && tabType.guide.length === 1)
check('the guide entry has artwork', typeof tabType?.guide?.[0]?.icon === 'function')
check('the title is Chinese', tabType?.title?.() === '微信读书', tabType?.title?.())

const body = registrations.find((entry) => entry.key === 'sidebar.right.pane.tab')
check('the body registered into the sidebar tab slot', body !== undefined)
check('the body key matches the type id', body?.options?.key === 'dsh-weread', body?.options?.key)
const face = body?.options?.inject?.()
check('the body receives the host call helper', typeof face?.wrCall === 'function')
check('the body receives the reader opener', typeof face?.wrOpenReader === 'function')

console.log('\nfirst render of every view')
hookIndex = 0
hooks.length = 0
let tree
let renderError
try {
  tree = body.component({ wrCall: async () => ({}), wrOpenReader: () => {} })
} catch (error) {
  renderError = error
}
check('the panel renders its loading state without throwing', renderError === undefined, renderError?.message)
check('the panel renders an element', tree !== null && typeof tree === 'object')

/** Collect every string in a rendered tree, flattening nested arrays. */
function texts(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) texts(child, out)
  else if (node !== null && typeof node === 'object' && Array.isArray(node.children)) {
    for (const child of node.children) texts(child, out)
  }
  return out
}

const rendered = texts(tree)
check('the tab strip is present', rendered.includes('在读') && rendered.includes('书架') && rendered.includes('笔记') && rendered.includes('设置'), JSON.stringify(rendered.slice(0, 12)))
// --- the data-rendering paths ----------------------------------------------
//
// The shim never invokes a child component, and every view sits behind a slot
// body, a `Loaded` wrapper or a loader callback. So the plugin exposes its own
// components for testing (`__views`), and this harness expands exactly those:
// unknown element types are left as data. Hook state is kept per component, as
// React does, so expanding a tree cannot cross the components' states.

const views = plugin.__views
const hookStores = new Map()

/** Render `fn` with the hook store belonging to one component. */
function within(component, fn) {
  const saved = hooks
  const savedIndex = hookIndex
  if (!hookStores.has(component)) hookStores.set(component, [])
  hooks = hookStores.get(component)
  hookIndex = 0
  try {
    return fn()
  } finally {
    hooks = saved
    hookIndex = savedIndex
  }
}

/**
 * Expand our own components in a rendered tree.
 * Anything not in `__views` (host primitives, DOM elements) is left alone.
 */
function expand(node) {
  if (Array.isArray(node)) return node.map(expand)
  if (node === null || typeof node !== 'object') return node
  if (typeof node.type === 'function') {
    const component = node.type
    if (Object.values(views).includes(component)) {
      return expand(within(component, () => component({ ...node.props, children: node.children })))
    }
    return node
  }
  return { type: node.type, props: node.props, children: node.children.map(expand) }
}

/** Let every loader's promise chain settle between passes. */
async function settle() {
  await new Promise((resolve) => setTimeout(resolve, 0))
  await new Promise((resolve) => setTimeout(resolve, 0))
}

/**
 * Render one exposed component to its final tree: expand with effects live,
 * let the loaders settle, then expand again with the published state.
 */
/** Run whatever effects the last render queued, then let promises settle. */
async function flushEffects() {
  const queued = pendingEffects.splice(0, pendingEffects.length)
  for (const effect of queued) effect()
  if (queued.length > 0) await settle()
}

async function renderView(name, props, preset) {
  const component = views[name]
  if (typeof component !== 'function') throw new Error(`view ${name} is not exposed`)
  hookStores.delete(component)
  pendingEffects = []
  expand(within(component, () => component(props)))
  await flushEffects()
  // A preset rewrites this component's own hook slots between passes, which is
  // how a state-gated row, or a state the reader would reach by paging, is set
  // without a click.
  if (preset !== undefined) preset(hookStores.get(component))
  let tree = expand(within(component, () => component(props)))
  await flushEffects()
  tree = expand(within(component, () => component(props)))
  return tree
}

/** Collect every string in a rendered tree, flattening nested arrays. */
function collect(node, out = []) {
  if (typeof node === 'string') out.push(node)
  else if (Array.isArray(node)) for (const child of node) collect(child, out)
  else if (node !== null && typeof node === 'object' && Array.isArray(node.children)) {
    for (const child of node.children) collect(child, out)
  }
  return out
}

/** Find the first button whose label matches, so a test can click it. */
function findButton(node, label) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findButton(child, label)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (node.type === 'button' && collect(node).includes(label)) return node
  for (const child of node.children) {
    const found = findButton(child, label)
    if (found !== undefined) return found
  }
  return undefined
}

/** Find the first element carrying a given data attribute value. */
function findByAttribute(node, attribute, value) {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByAttribute(child, attribute, value)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (node === null || typeof node !== 'object') return undefined
  if (node.props?.[attribute] === value) return node
  for (const child of node.children) {
    const found = findByAttribute(child, attribute, value)
    if (found !== undefined) return found
  }
  return undefined
}

// Mirrors the live catalog: the first entry is 封面 with no words, which must
// never be what "在 DSH 里读" opens.
const CATALOG = [
  { chapterUid: 11, chapterIdx: 1, title: '封面', wordCount: 0 },
  { chapterUid: 12, chapterIdx: 2, title: '版权信息', wordCount: 300 },
  { chapterUid: 13, chapterIdx: 3, title: '引子', wordCount: 800 },
]
const BOOK = { bookId: '1000001', title: '示例长篇小说（全集）', author: '示例作者', cover: '', readUpdateDate: '2024-03-28' }
const DETAIL = {
  bookId: '1000001',
  title: BOOK.title,
  author: BOOK.author,
  cover: '',
  intro: '一部好看的历史。',
  wordCount: 0,
  chapters: CATALOG,
  progress: { chapterUid: 0, progress: 0, recordReadingTime: 0 },
  readerLink: 'https://weread.qq.com/web/reader/x',
}
const CHAPTER = {
  bookId: '1000001',
  chapterUid: 13,
  chapterIdx: 2,
  chapterCount: 175,
  title: '引子',
  format: 'epub',
  paragraphs: ['引子', '我很喜欢历史。'],
  chapters: CATALOG,
  previous: { chapterUid: 12, title: '版权信息' },
  next: { chapterUid: 14, title: '示例第二节' },
}
const STATUS = {
  apiKeyConfigured: true,
  apiKeyHint: 'wrk-…TEST',
  apiKeyLooksValid: true,
  cookieConfigured: true,
  cookieNames: ['wr_vid', 'wr_skey'],
  skillVersion: '1.0.5',
  syncProgress: true,
  dataDir: '/Users/x/.dsh/storages/weread',
}
const NOTES = {
  highlightCount: 1,
  thoughtCount: 1,
  chapters: [
    {
      chapterUid: 5,
      chapterTitle: '第一章',
      highlights: [{ text: '你是谁？' }],
      thoughts: [{ content: '很妙的一问', abstract: '你是谁？' }],
    },
  ],
}

console.log('\nexposed views')
for (const name of ['WereadTab', 'Loaded', 'Progress', 'Cover', 'NowView', 'NowCard', 'ShelfView', 'ShelfList', 'BookDetail', 'NotesView', 'NotesDetail', 'ReaderView', 'CatalogList', 'SettingsView']) {
  check(`${name} is exposed`, typeof views[name] === 'function')
}

console.log('\nnow view with live data')
{
  const opened = []
  const now = await renderView('NowView', {
    wrCall: async (endpoint) =>
      endpoint === 'current'
        ? { book: BOOK, progress: { progress: 45, chapterUid: 415, recordReadingTime: 3600 } }
        : DETAIL,
    wrOpenReader: () => {},
    wrGoNotes: () => {},
    onRead: (request) => opened.push(request),
    readerReady: true,
    wrGoShelf: () => {},
  })
  const shown = collect(now)
  check('the current book renders', shown.some((text) => text.includes('示例长篇小说')), JSON.stringify(shown.slice(0, 6)))
  check('the author renders', shown.includes('示例作者'))
  check('the progress bar renders', shown.some((text) => text.includes('阅读进度 45%')))
  check('the last-read date renders', shown.some((text) => text.includes('上次阅读 2024-03-28')))
  check('the reading time renders', shown.some((text) => text.includes('累计阅读 60 分钟')))
  const button = findButton(now, '在 DSH 里读')
  check('the in-panel reader is offered', button !== undefined)
  button?.props.onClick()
  check('it opens the position the reader is actually at', opened[0]?.chapterUid === 415, JSON.stringify(opened[0]))
}

console.log('\nnow view resuming a book read in the panel')
{
  const opened = []
  const now = await renderView('NowView', {
    wrCall: async (endpoint) =>
      endpoint === 'current'
        ? { book: BOOK, progress: { progress: 45, chapterUid: 415, recordReadingTime: 3600 } }
        : DETAIL,
    wrOpenReader: () => {},
    wrGoNotes: () => {},
    onRead: (request) => opened.push(request),
    readerReady: true,
    wrGoShelf: () => {},
    // Read to chapter 14 here, while WeRead's own position still says 415.
    positions: { '1000001': { chapterUid: 14, updatedAt: 1 } },
  })
  findButton(now, '在 DSH 里读')?.props.onClick()
  check('a book read here resumes where it was left', opened[0]?.chapterUid === 14, JSON.stringify(opened[0]))
}

console.log('\nresume decision (pure)')
{
  const resume = views.resumeChapterUid
  check('the resume helper is exposed for testing', typeof resume === 'function')
  check('a remembered chapter wins', resume({ '5': { chapterUid: 14 } }, '5', 415, 3) === 14)
  check('without a memory, WeRead progress is used', resume({}, '5', 415, 3) === 415)
  check('without either, the first readable chapter is used', resume({}, '5', 0, 3) === 3)
  check('with nothing at all it is 0', resume({}, '5', 0, 0) === 0)
  check('another book does not leak in', resume({ '6': { chapterUid: 99 } }, '5', 415, 3) === 415)
  check('a corrupt memory is ignored', resume({ '5': { chapterUid: 'x' } }, '5', 415, 3) === 415)
  check('a missing positions map is tolerated', resume(undefined, '5', 415, 3) === 415)
}

console.log('\nnow view with an empty shelf')
{
  const empty = await renderView('NowView', {
    wrCall: async () => ({ book: undefined, progress: undefined }),
    wrOpenReader: () => {},
    wrGoNotes: () => {},
    onRead: () => {},
    readerReady: false,
    wrGoShelf: () => {},
  })
  check('an empty shelf says so', collect(empty).some((text) => text.includes('还没有在读的书')))
}

console.log('\nshelf list')
{
  const list = await renderView('ShelfList', {
    shelf: {
      totalCount: 3,
      books: [BOOK, { ...BOOK, bookId: '1', title: '示例哲学小说', author: '示例译者' }],
      albums: [{ bookId: 'a1', title: '某专辑', author: '某人', trackCount: 12, cover: '' }],
      hasMp: true,
    },
    onSelect: () => {},
    reload: () => {},
  })
  const shown = collect(list)
  check('both shelf books render', shown.includes('《示例长篇小说（全集）》') && shown.includes('《示例哲学小说》'))
  check('the shelf summary counts every kind', shown.some((text) => text.includes('共 3 项') && text.includes('有声书 1') && text.includes('含公众号')), JSON.stringify(shown.filter((t) => t.includes('共'))))
  check('an album renders separately', shown.includes('《某专辑》'))
}

console.log('\nbook detail')
{
  const opened = []
  const detail = await renderView('BookDetail', {
    book: BOOK,
    wrCall: async (endpoint) => (endpoint === 'book' ? DETAIL : {}),
    wrOpenReader: () => {},
    onOpenNotes: () => {},
    onRead: (request) => opened.push(request),
    readerReady: true,
    onBack: () => {},
  })
  const shown = collect(detail)
  check('the intro renders', shown.some((text) => text.includes('一部好看的历史')))
  check('the catalog size renders', shown.some((text) => text.includes('目录共 3 章')))
  const button = findButton(detail, '在 DSH 里读')
  check('the in-panel reader is offered', button !== undefined)
  button?.props.onClick()
  // The book has no reading position, so the tab falls back to the first
  // readable chapter — 版权信息 (12), never the wordless 封面 (11).
  check('a never-opened book skips 封面 in its fallback', opened[0]?.firstChapterUid === 12, JSON.stringify(opened[0]))
  check('the fallback is not the cover entry', opened[0]?.firstChapterUid !== 1)
}

console.log('\nnotes detail')
{
  const detail = await renderView('NotesDetail', {
    book: { bookId: '1', title: '示例哲学小说' },
    wrCall: async () => NOTES,
    onBack: () => {},
  })
  const shown = collect(detail)
  check('a highlight renders', shown.includes('你是谁？'))
  check('a thought renders', shown.includes('很妙的一问'))
  check('the chapter heading renders', shown.includes('第一章'))
  check('the note counts render', shown.some((text) => text.includes('1 条划线') && text.includes('1 条想法')))
}

console.log('\nreader view')
{
  const requested = []
  const reader = await renderView('ReaderView', {
    wrCall: async (endpoint, payload) => {
      requested.push({ endpoint, payload })
      return CHAPTER
    },
    bookId: '1000001',
    bookTitle: BOOK.title,
    chapterUid: 13,
    syncEnabled: true,
    onBack: () => {},
  })
  const shown = collect(reader)
  check('the chapter was requested by book and chapter', requested[0]?.endpoint === 'chapter' && requested[0]?.payload?.chapterUid === 13, JSON.stringify(requested[0]))
  check('the chapter text renders', shown.includes('我很喜欢历史。'))
  check('the chapter title renders', shown.includes('引子'))
  check('the position renders', shown.some((text) => text.includes('（3/175）')), JSON.stringify(shown.filter((text) => text.includes('175'))))
  for (const label of ['上一章', '下一章', '目录', 'A-', 'A+', '同步进度']) {
    check(`the ${label} control is present`, findButton(reader, label) !== undefined)
  }
  check('next is enabled mid-book', findButton(reader, '下一章')?.props.disabled === false)
  check('an appearance control is offered', findButton(reader, '外观') !== undefined)
  check(
    'the reader listens for interaction so idle time is excluded',
    ['pointerdown', 'keydown', 'wheel', 'scroll'].every((type) => documentListeners.some((l) => l.type === type)),
    JSON.stringify([...new Set(documentListeners.map((l) => l.type))]),
  )
  const body = findByAttribute(reader, 'className', 'wr-readerBody wr-theme-follow')
  check('the reading surface defaults to following DSH', body !== undefined)
  check('the default type size is applied', body?.props.style?.fontSize === '17px', JSON.stringify(body?.props.style))
  check('the default line height is applied', body?.props.style?.lineHeight === 1.9)

  const readOnly = await renderView('ReaderView', {
    wrCall: async () => CHAPTER,
    bookId: '1000001',
    bookTitle: BOOK.title,
    chapterUid: 13,
    syncEnabled: false,
    onBack: () => {},
  })
  check('progress sync is hidden when disabled', findButton(readOnly, '同步进度') === undefined)

  const failing = await renderView('ReaderView', {
    wrCall: async () => {
      const error = new Error('尚未配置阅读器 Cookie。')
      error.code = 'weread/needs-cookie'
      throw error
    },
    bookId: '1000001',
    bookTitle: BOOK.title,
    chapterUid: 13,
    syncEnabled: false,
    onBack: () => {},
  })
  check('a missing Cookie surfaces as guidance, not a crash', collect(failing).some((text) => text.includes('尚未配置阅读器 Cookie')), JSON.stringify(collect(failing).slice(0, 6)))
}

console.log('\nreader appearance')
{
  // A stored appearance must reach the reading surface on open.
  const stored = await renderView('ReaderView', {
    wrCall: async () => CHAPTER,
    bookId: '1000001',
    bookTitle: BOOK.title,
    chapterUid: 13,
    syncEnabled: false,
    readerSettings: { theme: 'dark', fontSize: 22, lineHeight: 2.3, fontFamily: 'serif' },
    onAppearance: () => {},
    onBack: () => {},
  })
  const body = findByAttribute(stored, 'className', 'wr-readerBody wr-theme-dark')
  check('a stored theme is applied on open', body !== undefined)
  check('a stored type size is applied', body?.props.style?.fontSize === '22px', JSON.stringify(body?.props.style))
  check('a stored line height is applied', body?.props.style?.lineHeight === 2.3)
  check('a stored font family is applied', String(body?.props.style?.fontFamily).includes('Songti'), String(body?.props.style?.fontFamily))

  // The appearance row is state-gated, so it is opened through the preset.
  const sent = []
  const opened = await renderView(
    'ReaderView',
    {
      wrCall: async () => CHAPTER,
      bookId: '1000001',
      bookTitle: BOOK.title,
      chapterUid: 13,
      syncEnabled: false,
      readerSettings: { theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' },
      onAppearance: (next) => sent.push(next),
      onBack: () => {},
    },
    (state) => {
      state[3] = true
    },
  )
  const shown = collect(opened)
  for (const label of ['跟随 DSH', '浅色', '深色', '羊皮纸', '紧', '标准', '松', '默认', '宋体', '黑体']) {
    check(`the ${label} option is offered`, findButton(opened, label) !== undefined)
  }
  const dark = findButton(opened, '深色')
  check('the active theme is marked', findButton(opened, '跟随 DSH')?.props['data-on'] === 'true')
  dark?.props.onClick()
  check('picking a theme reports the whole appearance', sent.length === 1 && sent[0].theme === 'dark', JSON.stringify(sent))
  check('the other fields are preserved when one changes', sent[0]?.fontSize === 17 && sent[0]?.lineHeight === 1.9)
  findButton(opened, '松')?.props.onClick()
  check('picking a line height reports it', sent[1]?.lineHeight === 2.3, JSON.stringify(sent[1]))
  findButton(opened, '宋体')?.props.onClick()
  check('picking a font reports it', sent[2]?.fontFamily === 'serif', JSON.stringify(sent[2]))
  findButton(opened, 'A+')?.props.onClick()
  check('the type size buttons report a size', sent[3]?.fontSize === 18, JSON.stringify(sent[3]))
}

console.log('\nreading position reporting')
{
  const sent = []
  const reader = await renderView(
    'ReaderView',
    {
      wrCall: async (endpoint, payload) => {
        sent.push({ endpoint, payload })
        return CHAPTER
      },
      bookId: '1000001',
      bookTitle: BOOK.title,
      chapterUid: 13,
      syncEnabled: true,
      readerSettings: { theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' },
      onAppearance: () => {},
      onBack: () => {},
    },
    // Position and reading time live in refs, and a real scroll or a real
    // clock cannot run in this harness, so both are preset between passes.
    // Slots: 6 = positionRef, 10 = readingRef, 11 = the visible counter.
    (state) => {
      state[6] = { current: { chapterUid: 13, ratio: 0.5 } }
      state[10] = { current: { activeSeconds: 125, lastCountedAt: Date.now(), lastInteractionAt: Date.now() } }
      state[11] = 125
    },
  )

  const body = findByAttribute(reader, 'className', 'wr-readerBody wr-theme-follow')
  check('the reading surface tracks scrolling', typeof body?.props.onScroll === 'function')
  check('the accumulated reading time is shown', collect(reader).some((t) => t.includes('本次已读 2 分钟')), JSON.stringify(collect(reader).filter((t) => t.includes('本次'))))

  await findButton(reader, '同步进度')?.props.onClick()
  const report = sent.find((call) => call.endpoint === 'reportProgress')
  check('syncing reports the reading position, not a raw offset', report?.payload?.positionRatio === 0.5, JSON.stringify(report?.payload))
  check('it no longer sends a hard-coded offset', report?.payload?.chapterOffset === undefined, JSON.stringify(report?.payload))
  check('it reports the chapter that was actually being read', report?.payload?.chapterUid === 13, JSON.stringify(report?.payload))
  check('it reports the time actually spent reading', report?.payload?.elapsedSeconds === 125, String(report?.payload?.elapsedSeconds))
}

console.log('\nreader reports chapter changes so a book can be resumed')
{
  const seen = []
  // The harness renders twice rather than reacting to clicks, so the state a
  // click on 下一章 would set is preset here; the reader's own effect then has
  // to notice and report it.
  await renderView(
    'ReaderView',
    {
      wrCall: async () => CHAPTER,
      bookId: '1000001',
      bookTitle: BOOK.title,
      chapterUid: 13,
      syncEnabled: false,
      readerSettings: { theme: 'follow', fontSize: 17, lineHeight: 1.9, fontFamily: 'system' },
      onAppearance: () => {},
      onBack: () => {},
      onChapter: (uid) => seen.push(uid),
    },
    (state) => {
      state[0] = 14
    },
  )
  check('paging forward reports the new chapter', seen[0] === 14, JSON.stringify(seen))
  check('opening a chapter does not report it as a change', seen.length === 1, JSON.stringify(seen))
}

console.log('\nreading-time accounting (idle is not reading)')
{
  const credit = views.creditReadingTime
  check('the pure helper is exposed for testing', typeof credit === 'function')

  // One tick at 11s, last accounted at 10s, last interaction at 10s.
  const attentive = { activeSeconds: 0, lastCountedAt: 10_000, lastInteractionAt: 10_000 }
  check('visible and attentive time is credited', credit(attentive, 11_000, true).activeSeconds === 1)
  check('an invisible page credits nothing', credit(attentive, 11_000, false).activeSeconds === 0)

  // Last interaction 61s before the tick, against a 60s idle window.
  const idle = { activeSeconds: 0, lastCountedAt: 10_000, lastInteractionAt: -50_000 }
  check('idle time is not credited', credit(idle, 11_000, true).activeSeconds === 0, String(credit(idle, 11_000, true).activeSeconds))

  // The clock advances either way, so a skipped tick cannot be credited later.
  const skipped = credit(idle, 11_000, true)
  check('the clock advances even when nothing is credited', skipped.lastCountedAt === 11_000)
  check('a later tick only credits its own delta', credit({ ...skipped, lastInteractionAt: 11_000 }, 11_500, true).activeSeconds === 0.5)

  const carried = credit({ activeSeconds: 5, lastCountedAt: 10_000, lastInteractionAt: 10_000 }, 11_000, true)
  check('accumulated time is carried across ticks', carried.activeSeconds === 6, String(carried.activeSeconds))

  // A mounted-but-hidden tab must not accrue time: DSH keeps this view mounted
  // while the reader works elsewhere, and `document.visibilityState` stays
  // "visible" the whole time.
  const onScreen = views.isOnScreen
  check('the on-screen helper is exposed for testing', typeof onScreen === 'function')
  const box = (top, height) => ({
    getClientRects: () => [{}],
    getBoundingClientRect: () => ({ top, bottom: top + height, width: 600, height }),
  })
  check('a visible reader is on screen', onScreen(box(0, 400), 800) === true)
  check('a reader scrolled past the top is off screen', onScreen(box(-900, 400), 800) === false)
  check('a reader below the fold is off screen', onScreen(box(900, 400), 800) === false)
  check(
    'a display:none ancestor takes the reader off screen',
    onScreen({ getClientRects: () => [], getBoundingClientRect: () => ({ top: 0, bottom: 400, width: 600, height: 400 }) }, 800) === false,
  )
  check('a zero-size reader is off screen', onScreen(box(0, 0), 800) === false)
  check('no element is off screen', onScreen(null, 800) === false)
}

console.log('\nposition measuring (paragraph text, not scroll height)')
{
  const measure = views.measurePosition
  check('the pure helper is exposed for testing', typeof measure === 'function')

  // The failure mode this replaces: 20 one-line paragraphs (each padded by its
  // own margin) followed by one long one. Scrolling past the short ones is 86%
  // of the scroll height but only 17% of the text — and the server derives the
  // stored percentage from the position, so the wrong number would stick.
  const boxes = []
  for (let i = 0; i < 20; i += 1) boxes.push({ top: i * 30, height: 30, start: i * 10, length: 10 })
  boxes.push({ top: 600, height: 100, start: 200, length: 1000 })
  const scrollTop = 600
  const linear = scrollTop / 700
  const measured = measure(scrollTop, boxes)
  check('a linear scroll fraction would overstate this badly', linear > 0.8, String(linear))
  check('the paragraph model reports the share of text instead', Math.abs(measured - 0.1667) < 0.001, String(measured))

  check('above the first paragraph is the start', measure(-10, boxes) === 0)
  check('past everything is the end', measure(100000, boxes) === 1)
  check('no measured paragraphs is the start', measure(120, []) === 0)
  check('a chapter with no text is the start', measure(120, [{ top: 0, height: 10, start: 0, length: 0 }]) === 0)

  // Even boxes must still behave like the plain fraction.
  const even = [{ top: 0, height: 100, start: 0, length: 100 }, { top: 100, height: 100, start: 100, length: 100 }]
  check('even paragraphs still land halfway', measure(100, even) === 0.5, String(measure(100, even)))
}

console.log('\nchapter catalog')
{
  const picked = []
  const catalog = await renderView('CatalogList', { chapters: CATALOG, activeUid: 13, onPick: (uid) => picked.push(uid) })
  const shown = collect(catalog)
  check('every chapter is listed', shown.includes('封面') && shown.includes('引子'))
  const current = findByAttribute(catalog, 'data-active', 'true')
  check('the open chapter is marked', current !== undefined && collect(current).includes('引子'), JSON.stringify(collect(current)))
  const other = findByAttribute(catalog, 'data-active', 'false')
  check('the others are not marked', other !== undefined && !collect(other).includes('引子'))
  other?.props.onClick()
  check('picking a chapter reports its uid', picked[0] === 11, JSON.stringify(picked))
}

console.log('\nsettings view')
{
  const settings = await renderView('SettingsView', { wrCall: async () => STATUS, wrOpenReader: () => {} })
  const shown = collect(settings)
  check('the configured key is reported', shown.some((text) => text.includes('wrk-…TEST')))
  check('the cookie names are reported', shown.some((text) => text.includes('wr_vid, wr_skey')))
  check('the data directory is reported', shown.some((text) => text.includes('/.dsh/storages/weread')))
  check('the skill version is reported', shown.some((text) => text.includes('1.0.5')))
  check('a save control exists', findButton(settings, '保存') !== undefined)
  check('a connection test exists', findButton(settings, '测试连接') !== undefined)
  check('the API key page is linked', shown.some((text) => text.includes('weread.qq.com/r/weread-skills')))

  // The progress-sync switch is a runtime preference, so it must reflect the
  // stored value and report a change back to the host.
  const toggle = findByAttribute(settings, 'type', 'checkbox')
  check('the progress-sync switch renders', toggle !== undefined)
  check('it reflects the stored value', toggle?.props.checked === true)
  check('it is labelled as on', shown.includes('已开启'))
}

console.log('\nsettings view with progress sync off')
{
  const calls = []
  const settings = await renderView('SettingsView', {
    wrCall: async (endpoint, payload) => {
      calls.push({ endpoint, payload })
      return { ...STATUS, syncProgress: false }
    },
    wrOpenReader: () => {},
  })
  const toggle = findByAttribute(settings, 'type', 'checkbox')
  check('the switch is off', toggle?.props.checked === false)
  check('it is labelled as off', collect(settings).includes('已关闭'))
  await toggle?.props.onChange({ target: { checked: true } })
  check(
    'turning it on is sent as a preference',
    calls.some((call) => call.endpoint === 'configure' && call.payload?.syncProgress === true),
    JSON.stringify(calls),
  )
}

console.log(`\n${checks - failures}/${checks} client checks passed`)
process.exit(failures === 0 ? 0 : 1)
