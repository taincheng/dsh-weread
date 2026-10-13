/**
 * The panel's transport: one exact Fetch route on the app's shared `/api`
 * bridge.
 *
 * `/api` is registered by the Connection plugin, which performs the browser
 * trust and authentication checks before bridging a request, so this route
 * inherits that admission and needs no service of its own beyond
 * `connection.fetch`. The path sits under `/api` because that is the only
 * shared channel the shipped composition routes to exact Fetch routes.
 *
 * Wire shape: `POST /api/weread` with `{ endpoint, payload }`; the reply is
 * the service's own result envelope, so a business failure travels as a value.
 *
 * @module dsh-weread/lib/rpc
 */

/** The one path this plugin claims. */
export const RPC_PATH = '/api/weread'

/**
 * Build the Fetch route the host registers.
 * @param service - the shared WeRead service.
 * @returns the route descriptor `connection.fetch.register` accepts.
 */
export function createRpcRoute(service) {
  return {
    path: RPC_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    /**
     * @param request - the bridged request, already admitted by `/api`.
     * @returns the service result envelope as JSON.
     */
    async fetch(request) {
      let body
      try {
        body = await request.json()
      } catch {
        return Response.json({
          ok: false,
          error: { code: 'weread/bad-request', message: '请求体不是 JSON。', details: {} },
        })
      }
      const endpoint = typeof body?.endpoint === 'string' ? body.endpoint : ''
      const payload = body?.payload !== null && typeof body?.payload === 'object' ? body.payload : {}
      const result = await service.handleRpc(endpoint, payload, request.signal)
      return Response.json(result)
    },
  }
}
