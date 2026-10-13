/**
 * dsh-weread — host half.
 *
 * Owns the WeRead service, the five agent tools, and the one Fetch route the
 * sidebar panel calls. The panel and the tools share one service instance, so
 * both surfaces read and write the same state.
 *
 * The route is registered only when a Connection service exists, which keeps
 * the plugin's tools usable in profiles that have no Web GUI.
 *
 * @module dsh-weread
 */

import { createRpcRoute } from './lib/rpc.js'
import { WereadService } from './lib/service.js'
import { registerTools } from './lib/tools.js'

export const name = 'weread'

// `tools` is the one hard dependency: without it the plugin has no reason to
// run. `connection` is optional and injected below.
export const inject = ['tools']

/**
 * Mount the plugin.
 * @param ctx - host plugin context.
 * @param config - the bundle row's config values.
 */
export function apply(ctx, config = {}) {
  const service = new WereadService({ ctx, config })
  registerTools(ctx, service)

  ctx.inject(['connection'], (scope) => {
    // `fetch.register` owns its registration as an effect of the reading
    // context, and needs no service beyond `connection` itself; `/api`
    // performs the browser trust and authentication checks before bridging.
    //
    // The registration is guarded so that a transport problem degrades to
    // "the panel cannot reach the host" instead of taking the agent tools
    // down with it.
    try {
      scope.connection.fetch.register(createRpcRoute(service))
    } catch (error) {
      ctx.logger?.warn('[weread] 面板通道注册失败，Agent 工具仍可用：%s', error?.message ?? String(error))
    }
  })

  ctx.logger?.info(
    '[weread] ready (skill_version=%s, data=%s)',
    service.config.skillVersion,
    service.config.dataDir,
  )
}
