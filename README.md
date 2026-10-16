# Gramma 👵

**Talk normally. Gramma is listening.**

Gramma is a small, local-first English speaking coach. It reads what you dictate and gives you short, specific feedback on grammar and fluency. You do not need lessons or an extra app. Your normal dictation becomes practice.

- **Local.** A local LLM (Ollama) runs on your Mac. No cloud, no account, no audio kept.
- **Quiet.** Casual speech that is correct gets no feedback. A false correction is worse than a missed error.
- **Hands-off.** Your pasted text is never changed. Feedback is only for you.

## Works with

| Dictation app | Status |
|---|---|
| [Handy](https://github.com/cjpais/Handy) (open-source speech-to-text) | ✅ Supported |
| Other dictation tools | 🔜 Planned |

Today Gramma reads Handy's local transcription history. All Handy-specific code is in one file (`src/handy.ts`), so we can add more sources later.

## Install (macOS, Apple Silicon, 8 GB RAM is enough)

```sh
brew install bun ollama
ollama serve &              # or: brew services start ollama
ollama pull qwen3:4b        # 2.5 GB, Apache 2.0
```

You must also have Handy installed and in use.

## Run

```sh
bun src/server.ts
open http://127.0.0.1:4317
```

Dictate with Handy as usual. A few seconds later, feedback shows on the page and in a small floating panel. Grammar errors show in orange and fluency tips in blue.

Optional cloud models (for testing only, because the transcript leaves your machine): put `AI_GATEWAY_API_KEY=...` in `.env`, then pick "Cloud" on the page. Never commit `.env`.

## How it works

```
Handy ─▶ history.db ─(read-only)─▶ handy.ts ─▶ analyze.ts ─(LLM, JSON)─▶ checks ─▶ web page + floating panel
```

- `src/handy.ts`: reads new dictations (the only Handy-specific code).
- `src/analyze.ts`: the prompt, plus code checks that drop doubtful corrections.
- `src/store.ts`: local history in `data/coach.db`.
- `src/server.ts`, `ui/index.html`, `hud/Hud.swift`: local web page and floating panel.
- `eval/run.ts`: accuracy test (`bun eval/run.ts`).
- `site/index.html`: landing page.

More detail: `docs/architecture.md`.

## Limitations

- English only. macOS only for now.
- A small local model is slow (about 10 s per sentence on an 8 GB M1) and sometimes wrong.
- Transcription errors can look like grammar errors.

## Roadmap

- Support for more dictation apps.
- Pronunciation feedback (see `docs/pronunciation-plan.md`).
