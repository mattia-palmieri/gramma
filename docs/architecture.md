---
summary: How the coach works now — three layers (Handy reader, analysis engine, store+UI), data flow, privacy rules, and why this shape.
---
# Architecture

**What is true now:** Bun + TypeScript, zero npm dependencies. A local server polls Handy's `history.db` (read-only), sends each new transcript to Ollama (`qwen3:4b`) with a JSON schema (or, if the user picks a cloud model in the UI, to Vercel AI Gateway, for testing), validates the result in code, stores only the useful feedback, and pushes it to a local web page (plus a floating panel: `hud/Hud.swift`, compiled at start to `data/hud/coach-hud` with `swiftc`; if that fails, a plain macOS notification). Handy is not modified.

```
Handy (unchanged) ──writes──▶ history.db + recordings/*.wav
                                   │ read-only poll, 1 s
src/handy.ts   ── Utterance {text, language?, audioPath?, timestamps?} ──▶
src/analyze.ts ── Ollama /api/chat, format=JSON schema, temp 0, think off ──▶ validate() ──▶ Feedback
src/server.ts  ── queue (one at a time) ──▶ src/store.ts (data/coach.db) ──SSE──▶ ui/index.html + floating panel (hud/)
```

## Layers (each file has one job)
| Layer | File | Knows about |
|---|---|---|
| Transcription input | `src/handy.ts` | Handy's DB only. The only Handy-specific file. |
| Analysis | `src/analyze.ts` | `Utterance` in, `Feedback` out. No Handy, no UI. |
| Storage | `src/store.ts` | `data/coach.db`: feedback rows + kv (paused). |
| Presentation | `src/server.ts`, `ui/index.html` | HTTP on 127.0.0.1:4317, SSE, notification. Top: local/cloud model switch, then the "Test tools" chevron, then new feedback cards, patterns, history (dismissed cards; each shows model + time, stored in `feedback.model`). Demo inputs, all under "Test tools": typed text (`/api/analyze`), 5 example buttons, replay of a recent Handy entry (`/api/handy/replay`), and "Test Handy path" (`/api/handy/test`: inserts a fake row in Handy's db — the only write to it — and deletes it after 5 s). |

## Why this shape (decision, 2026-10-16)
- **Inside Handy** — rejected: needs Rust toolchain + a fork; couples us to Handy releases.
- **Standalone app with its own mic/STT** — rejected: duplicates what Handy already does well.
- **Independent engine + thin Handy reader** — chosen. Handy writes the transcript row *before* it pastes, so we see it within ~1 s. Handy has no external hook/IPC, so polling the DB is the only clean option. Another STT source = one new file like `handy.ts`.

## Accuracy guards (false positives matter most)
One model call per transcript (~10 s median when an issue is found, ~2 s when clean). Eval: 3/18 false corrections, 12/15 useful catches (see README).
- Prompt: strict rules + 3 examples (incl. "correct informal speech → no issues"). The 4B model often ignores the "NEVER" rules, so the code guards below do most of the precision work.
- `validate()` drops:
  - low confidence; non-grammar issues below high confidence;
  - spans not found in the transcript; punctuation/case-only changes; spans > 12 words; filler-only spans;
  - sound-alike swaps (their/they're, your/you're, its/it's…) — a speech-to-text error, not the speaker's;
  - spans with slang ("kinda", "gonna", "basically"…);
  - a single small stutter ("the, the"); repetition is kept only with 2+ repeat spots or a word said 3 times;
  - fluency issues that only delete words ("what do they do" → "what they do") or only add words at the end (completing a self-correction).
- A second "is this really wrong?" model call per issue was tried: 1/18 false corrections but 9/15 catches and slower. Removed — speed matters more for the demo.
- Invalid JSON → retry once → else no feedback.
- English check: Handy language setting if set, else a cheap stop-word ratio.

## Privacy
- Default: everything local (`127.0.0.1` only). No network calls except to local Ollama.
- Exception: a cloud model (id with `/`, picked in the model switch at the top of the UI) sends each transcript to Vercel AI Gateway. Opt-in, for testing only. The UI shows "Cloud: your text is sent to the model provider."
- Stored: only transcripts that got feedback, with the issues. Clean transcripts are not stored.
- Audio: never copied. Only the Handy file path is passed in memory (for future pronunciation). Handy owns its WAV retention.
- Delete: per item (history ✕) or all ("Clear history").

## Input from Handy — limits (details: `notes/handy-integration.md`)
- `transcription_text` is pre-LLM, but Handy has already removed fillers (if enabled) and applied custom-word fixes. Truly raw model output is not stored by Handy.
- Default `history_limit` = 5 deletes older rows + WAVs. Fine for text (we read in 1 s); matters for future audio work.
