---
summary: Cloud speed fix (thinking off/low, added gpt-oss-120b ~1–2 s, now selected), floating feedback panel replaces notifications, "Test Handy path" button, longer example sentences. Eval not re-run.
---
# Cloud speed, floating panel, Handy test button

## What we decided
- **Slow cloud calls = hidden thinking.** Qwen 3.8 Flash wrote 130–400 reasoning tokens per call (4–15 s). `REASONING` map in `src/analyze.ts` adds per-model gateway params: Qwen `reasoning:{enabled:false}, enable_thinking:false` (→ ~2–3 s); gpt-oss `reasoning_effort:"low"`.
- **Added `openai/gpt-oss-120b`** (hosts: groq, cerebras, …): ~1.1–1.8 s through the app. Now the selected model (kv). Default for a fresh install stays local `qwen3:4b`.
- gpt-oss writes non-breaking hyphens in `pattern` ("subject‑verb"). `pat()` maps U+2010–2015 to "-".
- **Floating panel instead of macOS notification.** A notification showed only issue 1 ("+1" for the rest). `hud/Hud.swift`: one process per feedback, non-activating NSPanel top right, all Spaces, no focus steal. Shows every issue (original → suggestion, type · explanation) + natural version. Click → opens coach page. Auto-close 8 s + 4 s/issue, paused while mouse is over it. Newest kills the old one. Server compiles it at start into `data/hud/coach-hud` if missing/stale (~8 s); compile fails → osascript notification.
- **"▶ Test Handy path" button** (in the Replay box). `POST /api/handy/test` inserts a fake row (`file_name='coach-test.wav'`) in Handy's `history.db`; the normal poll picks it up; deleted after 5 s. Only write to Handy's db; delete matches only `coach-test.wav`. Tested: works end to end.
- **Example buttons:** 5 longer natural sentences, 1–2 real errors each, plus informal words ("gonna", "honestly") that must not be flagged. gpt-oss: 8/8 found, 0 false.

## Tried and abandoned
- `swiftc -O`: 54 s compile. Plain `swiftc`: ~8 s. Not worth it for a tiny UI.
- Panel options not picked: better notification text, click-to-open notification (terminal-notifier / browser API), menu bar app, feedback inside Handy's own overlay (needs Handy changes — maybe later for the product).

## Open questions
- **Eval not re-run.** Need numbers for qwen3.8-flash (thinking off) and gpt-oss-120b. README table still has old Qwen numbers (flagged under the table).
- Unknown which of the two Qwen params turns thinking off (both sent).
- Not yet tested with a real spoken Handy dictation (only fake rows).
- gpt-oss fix "explained to me the new plan" sometimes sounds unnatural (vs "explained the new plan to me"). Watch in eval.

## Pointers
- Gotcha: `/api/analyze` only queues. To time calls, wait for `status: idle` in `/api/state`, read `data/server.log`.
- Server running on :4317 (`nohup bun src/server.ts`, log `data/server.log`).
- Docs updated: `README.md` (models, panel, eval note), `docs/architecture.md` (panel, test endpoint). Index unchanged.
