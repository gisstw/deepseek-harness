/**
 * The DeepSeek account-balance read a configuration page calls: credential
 * resolution stays on the Host, and every failure keeps its own shape rather
 * than degrading into a zero balance.
 */
import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SettingsController from '../src/index.ts'
import { MemoryCredentials } from '../../../credentials/credentials/tests/memory.ts'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

const LIVE_BALANCE = {
  is_available: true,
  balance_infos: [
    { currency: 'USD', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' },
    { currency: 'CNY', total_balance: '99.64', granted_balance: '0.00', topped_up_balance: '99.64' },
  ],
}

async function boot(
  seed: Record<string, string>,
  fetchBalance?: (input: string, init: RequestInit) => Promise<Response>,
): Promise<SettingsController> {
  const ctx = new Context()
  await ctx.plugin(MemoryCredentials, seed)
  return new SettingsController(ctx, {}, fetchBalance === undefined ? {} : { fetchBalance })
}

/** A store whose resolve fails the way a locked or corrupt backing file would. */
class FailingCredentials extends MemoryCredentials {
  override resolve(): Promise<never> {
    return Promise.reject(new Error('the credential store is unreadable: /home/x/.dsh/.credentials.yaml'))
  }
}

describe('the DeepSeek balance read', () => {
  it('reports a credential-store failure as unreadable, not as a missing key', async () => {
    const ctx = new Context()
    await ctx.plugin(FailingCredentials, { DEEPSEEK_API_KEY: 'sk-live' })
    const controller = new SettingsController(ctx, {}, { fetchBalance: () => { throw new Error('unreachable') } })
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(value.state).toBe('unavailable')
    expect(value.reason).not.toContain('.credentials.yaml')
  })

  it('reports every currency the account carries', async () => {
    const fetchBalance = vi.fn().mockResolvedValue(jsonResponse(LIVE_BALANCE))
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-live' }, fetchBalance)
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(value).toEqual({
      state: 'ok',
      isAvailable: true,
      balances: [
        { currency: 'USD', total: '0.00', toppedUp: '0.00', granted: '0.00' },
        { currency: 'CNY', total: '99.64', toppedUp: '99.64', granted: '0.00' },
      ],
    })
  })

  it('sends the resolved key as a bearer token and never returns it', async () => {
    const fetchBalance = vi.fn().mockResolvedValue(jsonResponse(LIVE_BALANCE))
    const controller = await boot({ DEEPSEEK_API_KEY: 'sk-live' }, fetchBalance)
    const value = await controller.deepseekBalance(new AbortController().signal)
    const [, init] = fetchBalance.mock.calls[0] as [string, RequestInit]
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-live')
    expect(JSON.stringify(value)).not.toContain('sk-live')
  })

  it('says the key is unconfigured instead of reporting an empty balance', async () => {
    const fetchBalance = vi.fn()
    const controller = await boot({}, fetchBalance)
    expect(await controller.deepseekBalance(new AbortController().signal))
      .toEqual({ state: 'unconfigured' })
    expect(fetchBalance).not.toHaveBeenCalled()
  })

  it('keeps an HTTP failure distinguishable from a zero balance', async () => {
    const controller = await boot(
      { DEEPSEEK_API_KEY: 'sk-live' },
      () => Promise.resolve(new Response('nope', { status: 401 })),
    )
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(value.state).toBe('unavailable')
    expect(value.balances).toBeUndefined()
    expect(value.reason).toContain('401')
  })

  it('keeps a transport failure distinguishable from a zero balance', async () => {
    const controller = await boot(
      { DEEPSEEK_API_KEY: 'sk-live' },
      () => Promise.reject(new Error('getaddrinfo ENOTFOUND api.deepseek.com')),
    )
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(value.state).toBe('unavailable')
    expect(value.balances).toBeUndefined()
  })

  it('refuses a response whose shape it does not recognize', async () => {
    const controller = await boot(
      { DEEPSEEK_API_KEY: 'sk-live' },
      () => Promise.resolve(jsonResponse({ balance_infos: 'lots' })),
    )
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(value.state).toBe('unavailable')
    expect(value.balances).toBeUndefined()
  })

  it('never lets the key reach the failure text', async () => {
    const controller = await boot(
      { DEEPSEEK_API_KEY: 'sk-live' },
      () => Promise.reject(new Error('request to https://api.deepseek.com failed, key sk-live')),
    )
    const value = await controller.deepseekBalance(new AbortController().signal)
    expect(JSON.stringify(value)).not.toContain('sk-live')
  })
})
