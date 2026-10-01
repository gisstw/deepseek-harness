# Agent Note: PMS change-request intake

Status: proposed

English | [中文](2026-09-10-pms-change-intake.zh.md)

## Problem

Laravel accepts owned change-request drafts, but the staff tool schema omits that capability. A successful Laravel test cannot demonstrate that a model can choose an absent tool operation.

## Proposal

Expose `change.request.propose` in the staff tool enum and describe the stable retry identifier and required intake fields. Keep the operation record-only: no commands, editing, build, or deployment authority. Laravel owns validation and actor authorization. The working-tree implementation is not delivery to the running service.

## Alternatives considered

**Prompt-only guidance:** rejected because the enum still excludes the operation. **Generic execution tools:** rejected because collecting a request does not authorize code execution.

## Acceptance criteria

The focused suites pass five checks: four source-contract checks and a real Cordis ToolRuntime composition test with the materialized model-visible schema snapshot. The snapshot includes all four capabilities and excludes execution tools. These checks do not prove loading by the running service or actual model selection.

## Risks

The extra description increases model context; no cost or KV Cache improvement is claimed. Existing-case editing and isolated construction remain separate PMS workflows. Reloading DSH requires its own authorized delivery and must not enable PMS construction without the separate launch-role and budget decision.
