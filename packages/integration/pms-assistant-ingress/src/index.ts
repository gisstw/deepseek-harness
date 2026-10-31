import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'

export const name = 'pms-assistant-ingress'
export const inject = ['webServer', 'sessionController']

export interface Config { secret: string; preset: string; cwd: string; maxBodyBytes?: number; nonceTtlSeconds?: number }
export const Config: z<Config> = z.object({
  secret: z.string().required(), preset: z.string().default('pms-staff-assistant'),
  cwd: z.string().required(), maxBodyBytes: z.natural().default(65536), nonceTtlSeconds: z.natural().default(60),
})

type Turn = { requestId: string; cursor: number; events: Array<{ id: number; type: string; data: unknown }>; done: boolean }
const sessions = new Map<string, Map<string, Turn>>()
const nonces = new Map<string, number>()

function reply(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body); res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(text)
}
function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a); const bb = Buffer.from(b); return aa.length === bb.length && timingSafeEqual(aa, bb)
}
export function signingPath(rawUrl: string): string {
  const url = new URL(rawUrl, 'http://localhost')
  return url.pathname.slice('/v1/integrations/pms'.length) + url.search
}
/** DeepSeek Flash ids a PMS client may pin: the current id and the legacy id DeepSeek still serves. */
const PINNED_MODELS: readonly string[] = ['deepseek-flash', 'deepseek-v4-flash']
/** Check a conversation-create request against the provider, model, and preset fence.
 * @param data Parsed request fields.
 * @param preset Preset this ingress serves.
 * @returns The requested model id when every field matches the fence, otherwise `undefined`.
 */
export function pinnedModel(data: Record<string, unknown>, preset: string): string | undefined {
  if (data.provider !== 'deepseek-official' || data.preset !== preset || typeof data.model !== 'string') return undefined
  return PINNED_MODELS.includes(data.model) ? data.model : undefined
}
async function body(req: IncomingMessage, max: number): Promise<string> {
  const parts: Buffer[] = []; let size = 0
  for await (const chunk of req) { const b = Buffer.from(chunk); size += b.length; if (size > max) throw new Error('body too large'); parts.push(b) }
  return Buffer.concat(parts).toString('utf8')
}
function authenticate(req: IncomingMessage, raw: string, config: Required<Config>): boolean {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) return false
  const timestamp = req.headers['x-pms-timestamp']; const nonce = req.headers['x-pms-nonce']
  const bodyHash = req.headers['x-pms-body-hash']; const signature = req.headers['x-pms-signature']
  if (typeof timestamp !== 'string' || typeof nonce !== 'string' || typeof bodyHash !== 'string' || typeof signature !== 'string') return false
  const now = Math.floor(Date.now() / 1000); const ts = Number(timestamp)
  if (!Number.isSafeInteger(ts) || Math.abs(now - ts) > config.nonceTtlSeconds) return false
  for (const [key, expires] of nonces) if (expires <= now) nonces.delete(key)
  if (nonces.has(nonce)) return false
  const actualHash = createHash('sha256').update(raw).digest('hex'); if (!safeEqual(bodyHash, actualHash)) return false
  const path = signingPath(req.url ?? '/')
  const expected = createHmac('sha256', config.secret).update([req.method, path, timestamp, nonce, bodyHash].join('\n')).digest('hex')
  if (!safeEqual(signature, expected)) return false
  nonces.set(nonce, now + config.nonceTtlSeconds); return true
}
function textOf(event: SessionEvent): string {
  if (event.type !== 'assistant/message') return ''
  return event.data.message.content.filter(p => p.type === 'text').map(p => p.text).join('')
}
function sse(res: ServerResponse, events: Turn['events']): void {
  const text = events.length === 0 ? ': heartbeat\n\n' : events.map(event =>
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`,
  ).join('')
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store' }); res.end(text)
}
function proposalOf(event: SessionEvent): Record<string, unknown> | undefined {
  if (event.type !== 'tool/result') return undefined
  const blocks = event.data.message.content
  for (const block of blocks) {
    if (block.type !== 'text') continue
    try {
      const value = JSON.parse(block.text) as Record<string, unknown>
      if (value.mode === 'confirm_write' && typeof value.proposal_id === 'string') return value
    } catch { /* ordinary tool text is not a proposal */ }
  }
  return undefined
}

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  ctx.on('session/event', (session, event) => {
    const turns = sessions.get(session.id); if (!turns) return
    const turn = [...turns.values()].find(item => !item.done); if (!turn) return
    const text = textOf(event)
    if (text !== '') turn.events.push({ id: ++turn.cursor, type: 'delta', data: { text } })
    const proposal = proposalOf(event)
    if (proposal) turn.events.push({ id: ++turn.cursor, type: 'proposal', data: proposal })
    if (event.type === 'turn/end') { turn.done = true; turn.events.push({ id: ++turn.cursor, type: 'done', data: { reason: event.data.reason.kind } }) }
  })
  ctx.webServer.register({ kind: 'prefix', path: '/v1/integrations/pms', handler: async (req, res) => {
    try {
      const raw = await body(req, config.maxBodyBytes)
      if (!authenticate(req, raw, config)) return reply(res, 401, { code: 'UNAUTHORIZED' })
      const data = raw === '' ? {} : JSON.parse(raw) as Record<string, unknown>
      const path = new URL(req.url ?? '/', 'http://localhost').pathname
      const create = path === '/v1/integrations/pms/conversations' && req.method === 'POST'
      if (create) {
        const model = pinnedModel(data, config.preset)
        if (model === undefined) return reply(res, 422, { code: 'PIN_MISMATCH' })
        const made = await ctx.sessionController.create({ cwd: config.cwd, agentPreset: config.preset })
        await ctx.sessionController.selectModel({ sessionId: made.sessionId, provider: 'deepseek-official', model })
        sessions.set(made.sessionId, new Map()); return reply(res, 201, { session_id: made.sessionId })
      }
      const match = path.match(/^\/v1\/integrations\/pms\/conversations\/([^/]+)(?:\/turns(?:\/([^/]+)(?:\/(events|cancel))?)?)?$/)
      if (!match) return reply(res, 404, { code: 'NOT_FOUND' })
      const rawSessionId = match[1]
      if (rawSessionId === undefined) return reply(res, 404, { code: 'NOT_FOUND' })
      const sessionId = SessionId(decodeURIComponent(rawSessionId)); const turns = sessions.get(sessionId); if (!turns) return reply(res, 404, { code: 'NOT_FOUND' })
      const isTurnsCollection = path.endsWith('/turns')
      if (!isTurnsCollection && !match[2] && req.method === 'DELETE') { ctx.sessionController.cancel({ sessionId }); sessions.delete(sessionId); return reply(res, 200, { closed: true }) }
      const requestId = isTurnsCollection ? String(data.request_id ?? '') : decodeURIComponent(match[2] ?? '')
      if (isTurnsCollection && req.method === 'POST') {
        if (requestId === '') return reply(res, 422, { code: 'INVALID_REQUEST_ID' })
        if (turns.has(requestId)) return reply(res, 202, { accepted: true })
        const turn: Turn = { requestId, cursor: 0, events: [], done: false }; turns.set(requestId, turn)
        await ctx.sessionController.prompt({ sessionId, requestId: requestId as SessionRequestId, mode: 'queue', content: [{ type: 'text', text: String(data.message ?? '') }], clientTimeZone: 'Asia/Taipei' }, AbortSignal.timeout(5000))
        return reply(res, 202, { accepted: true })
      }
      const turn = turns.get(requestId); if (!turn) return reply(res, 404, { code: 'NOT_FOUND' })
      if (match[3] === 'events' && req.method === 'GET') {
        const after = Number(new URL(req.url ?? '/', 'http://localhost').searchParams.get('after') ?? 0)
        sse(res, turn.events.filter(e => e.id > after)); return
      }
      if (match[3] === 'cancel' && req.method === 'POST') { ctx.sessionController.cancel({ sessionId }); turn.done = true; return reply(res, 200, { status: 'canceled' }) }
      return reply(res, 405, { code: 'METHOD_NOT_ALLOWED' })
    } catch (error) { ctx.logger.warn(`pms-assistant ingress failed: ${error instanceof Error ? error.message : String(error)}`); reply(res, 500, { code: 'INTERNAL' }) }
  } })
}
