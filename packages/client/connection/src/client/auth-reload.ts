/** Full-page reload when a fronting authentication proxy's session expires. */

/**
 * Build the guarded auth-failure navigation for one page.
 *
 * The served app may sit behind an authentication proxy: browser navigations
 * then redirect to its login page, while API/XHR calls get HTTP 401 once the
 * session expires. A reload is a fresh browser navigation, so the proxy
 * answers it with that login redirect. The returned trigger is guarded —
 * concurrent 401s and the reconnect give-up path schedule one navigation. A
 * hidden tab defers the navigation until it becomes visible again: starting it
 * in the background lets Chrome abort the load and leave a white page when the
 * user returns.
 * @returns one-shot trigger scheduling the reload.
 */
export function createAuthFailureReload(): () => void {
  let scheduled = false
  return () => {
    if (scheduled) return
    scheduled = true
    const reload = (): void => {
      (globalThis as { location?: { reload?: () => void } }).location?.reload?.()
    }
    const doc = (globalThis as { document?: Document }).document
    if (doc !== undefined && doc.visibilityState === 'hidden') {
      doc.addEventListener('visibilitychange', reload, { once: true })
      return
    }
    // Defer past the current task so the failing response pipeline settles
    // first; the navigation replaces the document regardless.
    queueMicrotask(reload)
  }
}
