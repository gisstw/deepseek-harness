# Agent Note: Auth-failure login redirect for proxy-served web apps

Status: implemented

English | [中文](2026-08-24-auth-failure-login-redirect.zh.md)

## Problem

The served web app is frequently deployed behind an authentication proxy (Apache mod_auth_openidc in front of Google OAuth, for example). Browser navigations are redirected to the proxy's login page, but API/XHR calls get HTTP 401 once the session expires. The browser carrier threw a raw `transport failure for /api/...: HTTP 401` and the reconnect loop retried forever, so an expired proxy session left the GUI stuck on reconnect banners and per-session load errors instead of bouncing back to the login page.

## Decision

The browser carrier treats an HTTP 401 from any `/api` request as proof that the fronting proxy's session expired and schedules one guarded full-page reload per auth-failure episode. A reload is a fresh browser navigation, so the proxy answers it with its login redirect. `WebApiClient.reloadForAuthFailure` owns the guard: concurrent 401s and the reconnect give-up path share a single navigation. A tab that is hidden when the failure lands defers the navigation to the `visibilitychange` event instead of starting it in the background — Chrome can abort a background navigation and leave a white page when the user returns.

The reconnect loop gains a terminal bound. `ConnectionConfig.maxRetries` (unset = retry forever, the historical default) and `ConnectionSinks.onGiveUp` expose the bound and its terminal signal to direct `ConnectionController` consumers. The client plugin applies a served-app default of 12 consecutive failed attempts — followed by the same reload — only when the page is reached through a non-loopback authority (the proxy-served case); loopback and fixture/transport shells keep the infinite retry, because for them a long outage is a plain dead server where a reload cannot reach any login page.

## Alternatives considered

**Give up on reconnect and reload unconditionally after N attempts.** This changes the loopback/local behavior (a long server outage would reload into a browser connection error instead of auto-recovering), so the give-up default is scoped to non-loopback served apps.

**Detect auth failure only from the WebSocket close event.** The browser WebSocket API exposes no handshake status, and an expired proxy session already 401s the unary `host.describe` handshake call, so the 401-on-any-API signal is both sufficient and earlier; the WS give-up path remains as a fallback for proxies that fail upgrades without failing unary calls.

## Consequences

An expired proxy session now ends in a single page reload that the proxy turns into its login redirect, instead of an unbounded reconnect banner plus per-session `HTTP 401` load errors. A 401 can only originate from a fronting layer — the harness server itself never returns it — so the redirect branch never fires in a plain loopback deployment. Non-loopback served apps additionally reload after 12 consecutive failed reconnect attempts, which also covers proxy configurations that reject WebSocket upgrades without 401-ing unary calls; a plain dead server or tunnel on a non-loopback authority reloads into the browser's connection error instead of retrying forever, which is the intended give-up signal there.
