# Agent Note：代理伺服 Web 應用在認證失效時跳回登入頁

Status: implemented

[English](2026-08-24-auth-failure-login-redirect.md) | 中文

## Problem

Web 應用經常部署在認證代理之後（例如 Apache mod_auth_openidc 搭配 Google OAuth）。瀏覽器導航會被代理重定向到登入頁，但 API/XHR 呼叫在會話過期後只會收到 HTTP 401。原本的瀏覽器載體會直接丟出原始的 `transport failure for /api/...: HTTP 401`，重連迴圈則無限重試，因此代理會話過期時 GUI 會卡在重連橫幅與各 session 的載入錯誤上，而不是跳回登入頁。

## Decision

瀏覽器載體把任何 RPC 請求的 HTTP 401 視為前置代理的會話已過期，並在每次認證失效場景安排一次帶守衛的整頁重新載入。重新載入是一次全新的瀏覽器導航，代理會用它的登入重定向回應。`createAuthFailureReload`（client/auth-reload.ts）負責守衛：並發的 401 與重連放棄路徑共用同一次導航。若失效發生時分頁處於背景（hidden），導航會延後到 `visibilitychange` 事件再執行，而不是在背景中啟動——Chrome 可能中止背景導航，讓使用者切回時看到白畫面。

重連迴圈新增了終止上限。`ConnectionConfig.maxRetries`（不設置即無限重試，維持歷史預設）與 `ConnectionSinks.onGiveUp` 向直接使用 `ConnectionController` 的消費方暴露上限與終止訊號。client 插件只在頁面經由非 loopback 權威地址訪問（即代理伺服的情境）時套用「連續 12 次失敗後同樣重新載入」的 Web 應用預設；loopback 以及 fixture/transport 殼保留無限重試，因為對它們而言長時間斷線只是伺服器真的掛了，重新載入也到不了任何登入頁。

## Alternatives considered

**重連失敗 N 次後無條件放棄並重新載入。** 這會改變 loopback/本機行為（伺服器長時間故障時會重新載入成瀏覽器的連線錯誤頁，而不是自動恢復），所以放棄的預設只限定於非 loopback 的代理伺服 Web 應用。

**只從 WebSocket close 事件偵測認證失效。** 瀏覽器 WebSocket API 不暴露 handshake 狀態碼，而代理會話過期時 unary 的 `host.describe` handshake 呼叫本來就會收到 401，因此「任何 API 收到 401」這個訊號既足夠又更早；WS 放棄路徑仍保留作為「代理只擋 upgrade 卻不擋 unary 呼叫」情境的備援。

## Consequences

代理會話過期現在會以一次整頁重新載入收尾，代理再把它轉成登入重定向，取代原本無限重連的橫幅加上各 session 的 `HTTP 401` 載入錯誤。自 0.1.2-alpha.1 起 401 有第二個來源：Harness 自己的 BrowserAuth，其 cookie 與任何代理無關地獨立過期。重新載入救不了那一種——index 對未認證請求回的是 401 純文字——操作者必須重新開啟啟動時印出的網址。非 loopback 的 Web 應用還會在連續 12 次重連失敗後重新載入，這也涵蓋「代理只拒絕 WebSocket upgrade 卻不對 unary 呼叫回 401」的設定；非 loopback 權威地址上單純的伺服器或 tunnel 斷線會重新載入成瀏覽器的連線錯誤頁，而不是無限重試——這正是該情境想要的放棄訊號。
