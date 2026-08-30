// @vitest-environment jsdom
/**
 * The account-balance line: what each Host answer renders as, and that a
 * second Retry cannot be overtaken by the answer to the first.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekBalance } from '../src/client/DeepSeekBalance.tsx'
import { en } from '../src/client/locales.ts'

afterEach(cleanup)

const t = (key: keyof typeof en): string => en[key]

/** One CNY balance answer, the shape the Host returns for a funded account. */
const line = (total: string) => ({
  state: 'ok',
  isAvailable: true,
  balances: [{ currency: 'CNY', total, toppedUp: total, granted: '0.00' }],
})

function apiReturning(...answers: unknown[]) {
  const deepseekBalance = vi.fn()
  for (const answer of answers) {
    deepseekBalance.mockImplementationOnce(() => Promise.resolve({ ok: true, value: answer }))
  }
  return { api: { settings: { deepseekBalance } } as never, deepseekBalance }
}

describe('the DeepSeek balance line', () => {
  it('joins every currency the Host reported', async () => {
    const { api } = apiReturning({
      state: 'ok',
      isAvailable: true,
      balances: [
        { currency: 'CNY', total: '99.64', toppedUp: '99.64', granted: '0.00' },
        { currency: 'USD', total: '0.00', toppedUp: '0.00', granted: '0.00' },
      ],
    })
    render(<DeepSeekBalance api={api} t={t} />)
    await waitFor(() => { expect(screen.getByText('CNY 99.64 · USD 0.00')).toBeTruthy() })
  })

  it('asks for a key instead of showing a balance when none is stored', async () => {
    const { api } = apiReturning({ state: 'unconfigured' })
    render(<DeepSeekBalance api={api} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnconfigured)).toBeTruthy() })
    expect(screen.queryByText(en.balanceRetry)).toBeNull()
  })

  it('shows an ok answer carrying no currency as unreadable, not as zero', async () => {
    const { api } = apiReturning({ state: 'ok', isAvailable: true, balances: [] })
    render(<DeepSeekBalance api={api} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnavailable)).toBeTruthy() })
    expect(screen.queryByText(/0/)).toBeNull()
  })

  it('shows a failed read as failed, with a retry', async () => {
    const { api } = apiReturning({ state: 'unavailable', reason: 'the balance service could not be reached' })
    render(<DeepSeekBalance api={api} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnavailable)).toBeTruthy() })
    expect(screen.getByText(en.balanceRetry)).toBeTruthy()
  })

  it('reports a rejected call rather than staying on the loading text', async () => {
    const deepseekBalance = vi.fn(() => Promise.reject(new Error('transport is down')))
    render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnavailable)).toBeTruthy() })
  })

  it('reports a business rejection from the Host', async () => {
    const deepseekBalance = vi.fn(() => Promise.resolve(
      { ok: false, error: { code: 'settings-rejected', message: 'no provider', details: {} } },
    ))
    render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnavailable)).toBeTruthy() })
  })

  it('offers no Retry while a read is in flight, so two answers never race', async () => {
    const deepseekBalance = vi.fn(() => new Promise(() => undefined))
    render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceLoading)).toBeTruthy() })
    expect(screen.queryByText(en.balanceRetry)).toBeNull()
    expect(deepseekBalance).toHaveBeenCalledTimes(1)
  })

  it('abandons the first answer when Retry starts a second read', async () => {
    let releaseSecond!: (value: unknown) => void
    const deepseekBalance = vi.fn()
      .mockImplementationOnce(() => Promise.resolve({ ok: true, value: line('99.64') }))
      // Held open: the first answer is already on screen and must not come back.
      .mockImplementationOnce(() => new Promise((resolve) => { releaseSecond = resolve }))
    render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(screen.getByText('CNY 99.64')).toBeTruthy() })
    fireEvent.click(screen.getByText(en.balanceRetry))
    await waitFor(() => { expect(screen.getByText(en.balanceLoading)).toBeTruthy() })
    releaseSecond({ ok: true, value: line('50.00') })
    await waitFor(() => { expect(screen.getByText('CNY 50.00')).toBeTruthy() })
  })

  it('aborts the earlier read when Retry supersedes it', async () => {
    const signals: AbortSignal[] = []
    const deepseekBalance = vi.fn()
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal)
        return Promise.resolve({ ok: false, error: { code: 'x', message: 'down', details: {} } })
      })
      .mockImplementationOnce((signal: AbortSignal) => {
        signals.push(signal)
        return new Promise(() => undefined)
      })
    render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceRetry)).toBeTruthy() })
    fireEvent.click(screen.getByText(en.balanceRetry))
    await waitFor(() => { expect(signals).toHaveLength(2) })
    expect(signals[0]?.aborted).toBe(true)
    expect(signals[1]?.aborted).toBe(false)
  })

  it('shows an answer with no currency field at all as unreadable', async () => {
    const { api } = apiReturning({ state: 'ok', isAvailable: true })
    render(<DeepSeekBalance api={api} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnavailable)).toBeTruthy() })
  })

  it('drops a superseded answer that arrives after the newer read settled', async () => {
    let releaseFirst!: (value: unknown) => void
    const first = { settings: { deepseekBalance: () => new Promise((resolve) => { releaseFirst = resolve }) } }
    const second = { settings: { deepseekBalance: () => Promise.resolve({ ok: true, value: line('50.00') }) } }
    const view = render(<DeepSeekBalance api={first as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceLoading)).toBeTruthy() })
    // A new wire face starts a new generation, the way a reconnect would.
    view.rerender(<DeepSeekBalance api={second as never} t={t} />)
    await waitFor(() => { expect(screen.getByText('CNY 50.00')).toBeTruthy() })
    releaseFirst({ ok: true, value: line('99.64') })
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.getByText('CNY 50.00')).toBeTruthy()
  })

  it('drops a superseded rejection that arrives after the newer read settled', async () => {
    let rejectFirst!: (error: unknown) => void
    const first = { settings: { deepseekBalance: () => new Promise((_r, reject) => { rejectFirst = reject }) } }
    const second = {
      settings: {
        deepseekBalance: () => Promise.resolve({
          ok: true,
          value: { state: 'unconfigured' },
        }),
      },
    }
    const view = render(<DeepSeekBalance api={first as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceLoading)).toBeTruthy() })
    view.rerender(<DeepSeekBalance api={second as never} t={t} />)
    await waitFor(() => { expect(screen.getByText(en.balanceUnconfigured)).toBeTruthy() })
    rejectFirst(new Error('the abandoned read failed'))
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(screen.getByText(en.balanceUnconfigured)).toBeTruthy()
  })

  it('aborts the in-flight read when it unmounts', async () => {
    const signals: AbortSignal[] = []
    const deepseekBalance = vi.fn((signal: AbortSignal) => {
      signals.push(signal)
      return new Promise(() => undefined)
    })
    const view = render(<DeepSeekBalance api={{ settings: { deepseekBalance } } as never} t={t} />)
    await waitFor(() => { expect(signals).toHaveLength(1) })
    view.unmount()
    expect(signals[0]?.aborted).toBe(true)
  })
})
