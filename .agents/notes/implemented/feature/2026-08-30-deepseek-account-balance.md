# Agent Note: DeepSeek account balance on the Models settings page

Status: implemented

English | [中文](2026-08-30-deepseek-account-balance.zh.md)

## Problem

Every dispatch spends DeepSeek API credit, but the balance was visible only in the provider's own console. The web GUI showed per-session token usage and context pressure, which say nothing about how much credit remains, so an operator learned the account was empty from a failing request.

## Decision

`SettingsController` gains `@Remote deepseekBalance(signal)`. The Host resolves the `DEEPSEEK_API_KEY` credential and spends it against `https://api.deepseek.com/user/balance`; the browser receives only currency lines. The key is a write-only credential, so resolution cannot move to the client, and the balance URL and credential reference are `Config` fields rather than constants, for a deployment that fronts the provider with its own gateway.

The answer carries three states — `ok`, `unconfigured`, `unavailable` — instead of an optional balance. A page that collapsed an unreadable account into a zero balance would tell the operator to top up when the truth is that nobody could ask. The upstream error text is dropped rather than reported, because a transport error can quote the request and the request carries the key; the caller gets a fixed sentence naming the failure class.

The client renders one line above the provider rows (`DeepSeekBalance.tsx`), read once per mount with an explicit retry. It does not poll: the balance is not live data, and this page's existing design converges on pushed invalidations.

## Alternatives considered

**A new `balance-controller` package.** The workspace constraints, tsconfig faces, and Typert export pairs cost far more than one method on the controller that already owns credential-adjacent configuration surfaces.

**Show MiniMax beside it.** MiniMax publishes no balance endpoint; the line links to its console instead of pretending to read a number.

## Consequences

The Models settings page answers "how much credit is left" without leaving the GUI. A failed read stays visibly a failed read. Because the read is per mount, a balance shown in a long-open settings dialog can be stale by the amount spent since it opened; the retry is the refresh.
