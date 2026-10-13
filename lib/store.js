/**
 * On-disk state for the WeRead plugin: the user's credentials and a small
 * response cache.
 *
 * Everything lives under `<DSH_HOME>/storages/weread/`, beside the other
 * profile-owned state, and never inside the session workspace. The credential
 * file is written 0600 because it holds an account-scoped API key and, when
 * the native reader is used, a browser session cookie.
 */

import { chmod, mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Resolve the plugin's data directory, honouring an explicit override. */
export function resolveDataDir(config = {}) {
  if (typeof config.dataDir === 'string' && config.dataDir.trim().length > 0) {
    return config.dataDir.trim()
  }
  const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
  return join(home, 'storages', 'weread')
}

/** Split a `Cookie:` header value into a name → value record. */
export function parseCookieHeader(header) {
  const jar = {}
  if (typeof header !== 'string') return jar
  for (const part of header.split(';')) {
    const index = part.indexOf('=')
    if (index <= 0) continue
    const name = part.slice(0, index).trim()
    const value = part.slice(index + 1).trim()
    if (name.length > 0) jar[name] = value
  }
  return jar
}

/** Serialize a cookie record back into a `Cookie:` header value. */
export function serializeCookieJar(jar) {
  return Object.entries(jar)
    .filter(([, value]) => typeof value === 'string' && value.length > 0)
    .map(([name, value]) => `${name}=${value}`)
    .join('; ')
}

export class WereadStore {
  /** @param dataDir - absolute directory the plugin owns. */
  constructor(dataDir) {
    this.dataDir = dataDir
    this.credentials = undefined
    this.settings = undefined
    this.pending = Promise.resolve()
  }

  get settingsPath() {
    return join(this.dataDir, 'settings.json')
  }

  get credentialsPath() {
    return join(this.dataDir, 'credentials.json')
  }

  get cacheDir() {
    return join(this.dataDir, 'cache')
  }

  /** Read credentials once and cache them for the process. */
  async load() {
    if (this.credentials !== undefined) return this.credentials
    await mkdir(this.dataDir, { recursive: true })
    let parsed
    try {
      parsed = JSON.parse(await readFile(this.credentialsPath, 'utf8'))
    } catch {
      parsed = {}
    }
    this.credentials = {
      apiKey: typeof parsed?.apiKey === 'string' ? parsed.apiKey : '',
      cookie: typeof parsed?.cookie === 'string' ? parsed.cookie : '',
      updatedAt: typeof parsed?.updatedAt === 'number' ? parsed.updatedAt : 0,
    }
    return this.credentials
  }

  /** Merge a patch into the stored credentials and persist atomically. */
  async save(patch) {
    const mutate = async () => {
      const current = await this.load()
      const next = { ...current }
      if (typeof patch.apiKey === 'string') next.apiKey = patch.apiKey.trim()
      if (typeof patch.cookie === 'string') next.cookie = patch.cookie.trim()
      next.updatedAt = Date.now()
      const temporary = `${this.credentialsPath}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.credentialsPath)
      await chmod(this.credentialsPath, 0o600).catch(() => {})
      this.credentials = next
      return next
    }
    // Serialize writers so two panel saves cannot interleave.
    const result = this.pending.then(mutate, mutate)
    this.pending = result.then(
      () => undefined,
      () => undefined,
    )
    return result
  }

  /** Read one cached JSON value, or undefined when absent or unreadable. */
  async readCache(key) {
    try {
      const raw = await readFile(join(this.cacheDir, this.cacheFileName(key)), 'utf8')
      const entry = JSON.parse(raw)
      if (entry === null || typeof entry !== 'object') return undefined
      return entry
    } catch {
      return undefined
    }
  }

  /** Write one cached JSON value; failures never break the calling read. */
  async writeCache(key, value) {
    try {
      await mkdir(this.cacheDir, { recursive: true })
      const target = join(this.cacheDir, this.cacheFileName(key))
      const temporary = `${target}.${process.pid}.tmp`
      await writeFile(temporary, JSON.stringify({ at: Date.now(), value }), 'utf8')
      await rename(temporary, target)
    } catch {
      // A cache miss simply costs one more request.
    }
  }

  /** Map an arbitrary cache key onto one filesystem-safe file name. */
  cacheFileName(key) {
    const readable = String(key).replace(/[^\w.-]+/g, '_').slice(0, 48)
    const digest = createHash('sha1').update(String(key)).digest('hex').slice(0, 10)
    return `${readable}.${digest}.json`
  }

  /**
   * Read the plugin's own preferences.
   *
   * Preferences live beside the credentials but in their own file: they are
   * not secrets, and keeping them apart means clearing a credential never
   * silently resets a choice the user made.
   * @returns `{ syncProgress }`, with undefined for anything never chosen.
   */
  async loadSettings() {
    if (this.settings !== undefined) return this.settings
    await mkdir(this.dataDir, { recursive: true })
    let parsed
    try {
      parsed = JSON.parse(await readFile(this.settingsPath, 'utf8'))
    } catch {
      parsed = {}
    }
    this.settings = {
      syncProgress: typeof parsed?.syncProgress === 'boolean' ? parsed.syncProgress : undefined,
      // Reading appearance is stored raw here and normalized by the service,
      // so an older or hand-edited file can never break the reader.
      reader: parsed?.reader !== null && typeof parsed?.reader === 'object' ? parsed.reader : undefined,
    }
    return this.settings
  }

  /** Merge a preference patch into the settings file. */
  async saveSettings(patch) {
    const current = await this.loadSettings()
    const next = { ...current }
    if (typeof patch.syncProgress === 'boolean') next.syncProgress = patch.syncProgress
    if (patch.reader !== null && typeof patch.reader === 'object') next.reader = patch.reader
    await mkdir(this.dataDir, { recursive: true })
    const temporary = `${this.settingsPath}.${process.pid}.tmp`
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
    await rename(temporary, this.settingsPath)
    this.settings = next
    return next
  }

  /**
   * Merge refreshed `Set-Cookie` values into the stored session.
   *
   * The Web reader rotates `wr_skey`/`wr_rt` as it works; keeping the newest
   * values is what stops the session from expiring mid-read.
   * @param setCookies - raw `Set-Cookie` header values.
   * @returns the persisted credentials record.
   */
  async mergeSetCookies(setCookies) {
    const current = await this.load()
    const jar = parseCookieHeader(current.cookie)
    for (const raw of setCookies) {
      const first = String(raw).split(';', 1)[0]
      const index = first.indexOf('=')
      if (index <= 0) continue
      const name = first.slice(0, index).trim()
      const value = first.slice(index + 1).trim()
      if (name.length > 0 && value.length > 0) jar[name] = value
    }
    return this.save({ cookie: serializeCookieJar(jar) })
  }
}

/**
 * Serve a cached value, refreshing it when older than `ttlMs`.
 * @param store - owning store.
 * @param key - cache key.
 * @param ttlMs - freshness window; `0` forces a refresh.
 * @param produce - async producer used on a miss.
 * @returns the fresh or cached value.
 */
export async function cached(store, key, ttlMs, produce) {
  const entry = await store.readCache(key)
  if (entry !== undefined && Date.now() - entry.at < ttlMs) return entry.value
  try {
    const value = await produce()
    await store.writeCache(key, value)
    return value
  } catch (error) {
    // A stale value still beats an empty panel while the gateway is down.
    if (entry !== undefined) return entry.value
    throw error
  }
}
