/** DeepSeek account balance line shown above the provider rows. */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ModelsWire } from './store.ts'
import { messageOf } from './store.ts'
import type { en } from './locales.ts'
import css from './ModelsSection.module.css'

/**
 * The Host's balance answer, read off the wire face rather than imported from
 * the Host package: this plugin has no dependency on the controller, and the
 * generated Remote contract already carries the type.
 */
type BalanceAnswer = Extract<
  Awaited<ReturnType<ModelsWire['settings']['deepseekBalance']>>,
  { ok: true }
>['value']

/** What the line knows while it is being read, and afterwards. */
type BalanceState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'value'; readonly value: BalanceAnswer }
  | { readonly kind: 'failed'; readonly message: string }

/** Dependencies of {@link DeepSeekBalance}. */
export interface DeepSeekBalanceProps {
  /** The page's wire faces; the balance read rides the settings namespace. */
  api: Pick<ModelsWire, 'settings'>
  /** Section copy. */
  t: (key: keyof typeof en) => string
}

/**
 * Render one currency line as `CNY 99.64`. The currency stays a plain prefix
 * rather than a locale-formatted amount: the Host passes DeepSeek's own
 * decimal string through untouched, and reformatting it could round the very
 * number the operator is checking.
 * @param value - the balance answer carrying zero or more currency lines.
 * @returns the joined amounts, or undefined when the answer carries none.
 */
function amounts(value: BalanceAnswer): string | undefined {
  const lines = (value.balances ?? []).map(line => `${line.currency} ${line.total}`)
  return lines.length === 0 ? undefined : lines.join(' · ')
}

/**
 * Read the DeepSeek account balance once per mount and show it, with a retry
 * for the states a retry can fix.
 *
 * A failed read never renders as a zero balance: "we could not ask" and "the
 * account is empty" are different facts, and only one of them means the
 * operator has to top up.
 * @param props - the balance Remote face and the section's copy.
 * @returns the balance line.
 */
export function DeepSeekBalance({ api, t }: DeepSeekBalanceProps): ReactNode {
  const [state, setState] = useState<BalanceState>({ kind: 'loading' })
  // Latest read wins, the way ModelsSettingsStore settles its own reloads: two
  // Retry clicks leave two requests in flight, and without this the slower
  // one's answer would land last and replace the newer one.
  const generation = useRef(0)
  const inFlight = useRef<AbortController | undefined>(undefined)

  const read = useCallback(() => {
    const mine = ++generation.current
    inFlight.current?.abort()
    const attempt = new AbortController()
    inFlight.current = attempt
    setState({ kind: 'loading' })
    void api.settings.deepseekBalance(attempt.signal).then(
      (result) => {
        if (mine !== generation.current) return
        setState(result.ok
          ? { kind: 'value', value: result.value }
          : { kind: 'failed', message: result.error.message })
      },
      (error: unknown) => {
        if (mine !== generation.current) return
        setState({ kind: 'failed', message: messageOf(error) })
      },
    )
  }, [api])

  useEffect(() => {
    read()
    // Abandoning the generation is what silences a late answer after unmount;
    // the abort is for the request itself.
    return () => {
      generation.current++
      inFlight.current?.abort()
    }
  }, [read])

  const body = ((): { text: string; retry: boolean } => {
    if (state.kind === 'loading') return { text: t('balanceLoading'), retry: false }
    if (state.kind === 'failed') return { text: t('balanceUnavailable'), retry: true }
    const { value } = state
    if (value.state === 'unconfigured') return { text: t('balanceUnconfigured'), retry: false }
    const shown = value.state === 'ok' ? amounts(value) : undefined
    return shown === undefined
      ? { text: t('balanceUnavailable'), retry: true }
      : { text: shown, retry: true }
  })()

  return (
    <p className={css['balance']} aria-live="polite">
      <span className={css['balanceLabel']}>{t('balanceLabel')}</span>
      <span className={css['balanceValue']}>{body.text}</span>
      {body.retry
        ? <Button variant="ghost" size="sm" onClick={() => { read() }}>{t('balanceRetry')}</Button>
        : null}
      <span className={css['balanceNote']}>{t('balanceMinimax')}</span>
    </p>
  )
}
