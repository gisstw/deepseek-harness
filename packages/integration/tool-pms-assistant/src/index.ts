import { createHash, createHmac, randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { JsonValue } from '@deepseek-ai/dsh-util-values'

export const name = 'tool-pms-assistant'
export const inject = ['tools']
export interface Config { baseUrl: string; secret: string; timeoutMs?: number }
export const Config: z<Config> = z.object({
  baseUrl: z.string().required(),
  secret: z.string().required(),
  timeoutMs: z.natural().default(5000),
})

export function apply(ctx: Context, rawConfig: Config): void {
  const config = rawConfig as Required<Config>
  ctx.tools.register(defineTool({
    name: 'pms_capability',
    description: 'Use an approved PMS capability: guest.checkout_time.read, wish.submit, recipe.create, change.request.propose. change.request.propose records a bug or feature request only; it never builds or deploys. Its payload requires client_request_id (a stable unique id reused on retry), kind (bug or feature), module (general or wish.incomplete-filter), title, current_behavior; expected_behavior is optional. Return the PMS-provided case URL to the employee. recipe.create only creates a proposal until the employee confirms in PMS. Unknown capabilities are denied.',
    parameters: {
      capability: { type: 'string', required: true, enum: ['guest.checkout_time.read', 'wish.submit', 'recipe.create', 'change.request.propose'] },
      payload: { type: 'object', required: true, additionalProperties: true, properties: {} },
    },
    output: {
      schema: { type: 'object', additionalProperties: true, properties: {} },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    execute: async (args, exec) => {
      if (!exec.agent) throw new Error('pms_capability requires an owning session')
      if (config.secret === '') throw new Error('PMS capability is unavailable')
      const path = '/internal/pms-assistant/capabilities'
      const raw = JSON.stringify({ dsh_session_id: exec.agent.session.id, capability: args.capability, payload: args.payload })
      const timestamp = String(Math.floor(Date.now() / 1000)); const nonce = randomUUID(); const bodyHash = createHash('sha256').update(raw).digest('hex')
      const signature = createHmac('sha256', config.secret).update(['POST', path, timestamp, nonce, bodyHash].join('\n')).digest('hex')
      const response = await fetch(new URL(path, config.baseUrl), { method: 'POST', signal: AbortSignal.any([exec.signal, AbortSignal.timeout(config.timeoutMs)]),
        headers: { 'content-type': 'application/json', 'x-pms-timestamp': timestamp, 'x-pms-nonce': nonce, 'x-pms-body-hash': bodyHash, 'x-pms-signature': signature }, body: raw })
      const result = await response.json() as Record<string, JsonValue>
      if (!response.ok) throw new Error(`PMS capability rejected (${response.status})`)
      return result
    },
  }))
}
