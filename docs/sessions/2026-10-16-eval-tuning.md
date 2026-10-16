---
summary: First real-model runs. Tuned precision with code guards (tried + removed a second verify call for speed). Added demo inputs (example buttons, Handy replay). Eval now 3/18 false, 12/15 useful, ~10 s.
---
# 2026-10-16 — Eval, precision tuning, demo inputs

## What we decided (and why)
- **Code guards in `validate()`** (sound-alikes, slang, single stutter, fluency that only deletes or only appends words). Why: `qwen3:4b` ignores the prompt's "NEVER" rules.
- **No second model call.** A per-issue "is this really wrong?" check gave 1/18 false corrections but cost catches (9/15) and time. Matt: "this must be faster". Removed.
- **Demo inputs on the page**: 5 example buttons with clear errors + "Replay a Handy dictation" (last 10 Handy rows, same path as live). Why: Matt cannot dictate much with people in the room. No audio upload (audio is not used yet).
- UI: dot is red when disconnected; "Check" says "server not running" if the request fails.
- Matt: eval must be "decent for a quick simple demo", not perfect. Do not over-tune.

## Eval history (34 cases)
| Version | False corr. | Useful | Median |
|---|---|---|---|
| Prompt only | 8/18 | 12/15 | 11 s |
| + guards + verify call | 1/18 | 9/15 | 12 s |
| + guards, no verify (current) | 3/18 | 12/15 | 10.5 s |
The self-correction guard ("I went to the —") was added after the last run; not re-evalled.

## Tried and abandoned
- Second verify model call — see above.

## Open questions / next
1. Live test with real Handy dictation not done (only replay). Should work: replay uses the same code path.
2. Left false corrections: "action" → "actions" (style), "get hub" → "get the hub" (STT error).
3. "I have 30 years" is always missed; "pattern" category is sometimes wrong ("verb tense" for agreement).
4. Faster: shorter output (e.g. drop `explanation` length) or `qwen3:1.7b` — not tried.
5. Pronunciation still only a plan (`docs/pronunciation-plan.md`). Handy `history_limit`=5 must go up for it.

## Pointers
- Server runs with `bun src/server.ts` (stops when the session ends).
- Demo-input routes: `/api/handy/recent`, `/api/handy/replay` in `src/server.ts`; `recentEntries()` in `src/handy.ts`.
