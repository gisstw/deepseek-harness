# Agent Note：Models 設定頁顯示 DeepSeek 帳戶餘額

Status: implemented

[English](2026-08-30-deepseek-account-balance.md) | 中文

## 問題

每次派工都在花 DeepSeek 的 API 額度，但餘額只在供應商自己的後台看得到。Web GUI 只有每個對話的 token 用量與 context 壓力，那些數字說不出還剩多少額度，結果操作者要等到請求失敗才知道帳戶沒錢了。

## 決策

`SettingsController` 新增 `@Remote deepseekBalance(signal)`。Host 解析 `DEEPSEEK_API_KEY` 憑證並用它去打 `https://api.deepseek.com/user/balance`，瀏覽器只收到各幣別的金額。金鑰是只寫憑證，因此解析不能搬到 client；餘額網址與憑證名稱做成 `Config` 欄位而非常數，供以自有 gateway 前置供應商的部署改寫。

回傳值帶三種狀態——`ok`、`unconfigured`、`unavailable`——而不是一個可有可無的餘額。若把「讀不到」摺疊成餘額 0，畫面等於在帳戶其實無法查詢時要操作者去儲值。上游的錯誤文字不往外帶，因為傳輸錯誤可能引用整個請求，而請求裡有金鑰；呼叫方拿到的是一句固定的、指出失敗類別的說明。

Client 在供應商列表上方渲染一行（`DeepSeekBalance.tsx`），每次掛載讀一次並提供明確的重試。不做輪詢：餘額不是即時資料，而這一頁既有的設計本來就靠推播失效收斂。

## 考慮過的其他做法

**新開 `balance-controller` 套件。** workspace 約束、tsconfig 編譯面與 Typert 匯出對的成本，遠高於在既有那個已經擁有憑證相關設定介面的 controller 上加一個方法。

**同時顯示 MiniMax。** MiniMax 沒有公開的餘額端點；那一行改成連到它的後台，而不是假裝讀得到數字。

## 後果

Models 設定頁不必離開 GUI 就能回答「還剩多少額度」。讀取失敗會明確顯示成讀取失敗。由於是每次掛載才讀，長時間開著的設定視窗裡的餘額會落後於這段期間花掉的量；重試按鈕就是重新整理的手段。
