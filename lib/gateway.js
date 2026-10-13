/**
 * Client for the official 微信读书 Agent Gateway.
 *
 * One endpoint carries every documented capability, selected by the request
 * body's `api_name`; business parameters sit at the top level beside
 * `skill_version`. The key is user-bound, so no request names a user id.
 *
 * Reference: https://github.com/Tencent/WeChatReading (skills/*.md).
 */

const GATEWAY_URL = 'https://i.weread.qq.com/api/agent/gateway'

/** A gateway or transport failure carrying a stable code for the UI. */
export class WereadGatewayError extends Error {
  /** @param code - stable machine-readable code. @param message - human text. */
  constructor(code, message, details) {
    super(message)
    this.name = 'WereadGatewayError'
    this.code = code
    this.details = details ?? {}
  }
}

/** True when the value looks like the `wrk-…` key the gateway issues. */
export function looksLikeApiKey(value) {
  return typeof value === 'string' && /^wrk-[\w-]{4,}$/.test(value.trim())
}

/** Render a key for display without disclosing it. */
export function maskSecret(value) {
  if (typeof value !== 'string' || value.length === 0) return undefined
  if (value.length <= 8) return `${value.slice(0, 2)}${'*'.repeat(Math.max(value.length - 2, 0))}`
  return `${value.slice(0, 4)}…${value.slice(-4)}`
}

/** Combine an optional caller signal with a request deadline. */
function withDeadline(signal, timeoutMs) {
  const deadline = AbortSignal.timeout(timeoutMs)
  if (signal === undefined) return deadline
  return AbortSignal.any([signal, deadline])
}

export class WereadGateway {
  /**
   * @param options - resolved per-call configuration readers.
   * @param options.getApiKey - current key, read per request so a saved key applies at once.
   * @param options.getSkillVersion - `skill_version` sent with every call.
   * @param options.getTimeoutMs - per-request deadline in milliseconds.
   * @param options.logger - host logger for upgrade notices.
   */
  constructor({ getApiKey, getSkillVersion, getTimeoutMs, logger }) {
    this.getApiKey = getApiKey
    this.getSkillVersion = getSkillVersion
    this.getTimeoutMs = getTimeoutMs
    this.logger = logger
    /** Latest `upgrade_info` the gateway returned, surfaced by the panel. */
    this.upgradeInfo = undefined
  }

  /**
   * Call one gateway endpoint.
   * @param apiName - endpoint such as `/shelf/sync`.
   * @param params - business parameters, spread at the body's top level.
   * @param signal - caller cancellation.
   * @returns the decoded gateway payload.
   */
  async call(apiName, params = {}, signal) {
    const apiKey = this.getApiKey()
    if (typeof apiKey !== 'string' || apiKey.length === 0) {
      throw new WereadGatewayError(
        'weread/no-api-key',
        '尚未配置微信读书 API Key。请在右侧边栏的「微信读书 → 设置」中填入。',
      )
    }
    const body = { api_name: apiName, skill_version: this.getSkillVersion(), ...params }
    let response
    try {
      response = await fetch(GATEWAY_URL, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify(body),
        signal: withDeadline(signal, this.getTimeoutMs()),
      })
    } catch (error) {
      if (error?.name === 'TimeoutError') {
        throw new WereadGatewayError('weread/timeout', `微信读书网关请求超时（${apiName}）。`)
      }
      if (signal?.aborted === true) throw error
      throw new WereadGatewayError(
        'weread/network',
        `无法连接微信读书网关：${error?.message ?? String(error)}`,
      )
    }
    if (!response.ok) {
      // The gateway reports its own failures as JSON beside a non-2xx status;
      // `errmsg` is the only part worth showing the user.
      const text = await response.text().catch(() => '')
      let reported
      try {
        reported = JSON.parse(text)
      } catch {
        reported = undefined
      }
      const errmsg = reported?.errmsg ?? reported?.errMsg
      if (response.status === 401 || reported?.errcode === -2013) {
        throw new WereadGatewayError(
          'weread/bad-api-key',
          `微信读书鉴权失败（${errmsg ?? 'API Key 无效'}）。请在「设置」里重新领取并填入 API Key。`,
          { status: response.status, errcode: reported?.errcode, errlog: reported?.errlog },
        )
      }
      throw new WereadGatewayError(
        `weread/http-${response.status}`,
        `微信读书网关返回 HTTP ${response.status}${errmsg !== undefined ? `：${errmsg}` : text.length > 0 ? `：${text.slice(0, 200)}` : ''}`,
        { status: response.status, errcode: reported?.errcode, errlog: reported?.errlog },
      )
    }
    let payload
    try {
      payload = await response.json()
    } catch {
      throw new WereadGatewayError('weread/bad-json', '微信读书网关返回了无法解析的响应。')
    }
    if (payload !== null && typeof payload === 'object' && payload.upgrade_info !== undefined) {
      this.upgradeInfo = payload.upgrade_info
      this.logger?.warn(
        '[weread] 官方 skill 需要升级：%s',
        payload.upgrade_info?.message ?? JSON.stringify(payload.upgrade_info),
      )
    }
    const errcode = payload?.errcode ?? payload?.errCode
    if (typeof errcode === 'number' && errcode !== 0) {
      throw new WereadGatewayError(
        `weread/errcode-${errcode}`,
        payload?.errmsg ?? payload?.errMsg ?? `微信读书返回错误码 ${errcode}`,
        { errcode },
      )
    }
    return payload
  }

  // --- documented endpoints -------------------------------------------------

  /** 书架：电子书 + 有声书/专辑 + 公众号收藏。 */
  shelf(signal) {
    return this.call('/shelf/sync', {}, signal)
  }

  /** 单本书的书籍详情。 */
  bookInfo(bookId, signal) {
    return this.call('/book/info', { bookId }, signal)
  }

  /** 单本书的阅读进度。 */
  progress(bookId, signal) {
    return this.call('/book/getprogress', { bookId }, signal)
  }

  /** 官方章节目录（元数据，不含正文）。 */
  chapterInfo(bookId, signal) {
    return this.call('/book/chapterinfo', { bookId }, signal)
  }

  /** 笔记概览，游标分页（`count` + `lastSort`）。 */
  notebooks(count = 20, lastSort, signal) {
    return this.call('/user/notebooks', { count, ...(lastSort === undefined ? {} : { lastSort }) }, signal)
  }

  /** 单本书的划线内容。 */
  bookmarks(bookId, signal) {
    return this.call('/book/bookmarklist', { bookId }, signal)
  }

  /** 单本书的个人想法/点评（注意参数名是小写 `bookid`）。 */
  myReviews(bookid, count = 100, synckey, signal) {
    return this.call('/review/list/mine', { bookid, count, ...(synckey === undefined ? {} : { synckey }) }, signal)
  }

  /** 阅读统计：weekly / monthly / annually / overall。 */
  readData(mode = 'monthly', baseTime, signal) {
    return this.call('/readdata/detail', { mode, baseTime: baseTime ?? 0 }, signal)
  }

  /** 书城搜索。 */
  search(keyword, scope = 10, count = 20, signal) {
    return this.call('/store/search', { keyword, scope, count }, signal)
  }

  /** 服务端声明的全部可用接口，用于排查能力变化。 */
  listEndpoints(signal) {
    return this.call('/_list', {}, signal)
  }
}
