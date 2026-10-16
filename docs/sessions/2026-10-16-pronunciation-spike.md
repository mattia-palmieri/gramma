---
summary: Ran OpenPronounce on 5 Handy WAVs; it works locally, own flags mostly noise, a few repeating Italian-accent candidates wait for Matt's ear check.
---
# Pronunciation spike

## What we decided
- Test before build: run OpenPronounce as-is (half-day spike from `docs/pronunciation-plan.md`).
- Use the STT transcript as the target sentence (no target text exists in real dictation).

## What we tried
- OpenPronounce CLI on 5 WAVs copied to `data/pron-spike/wavs/`. Works on CPU, ~25 s / file, ~2.5 GB RAM. First run is slow (model download + cold start).
- Its flags: 7 words in 5 files, mostly fast function words (you, your, or, would) = noise. Do not use its flags directly.
- Added `data/pron-spike/soft.py` (all phone diffs per word). More signal, more noise. Alignment is flat over the sentence, so long files misplace errors.

## Open questions
- Matt must listen and confirm: short i → ee (living, research), th → d (this, that's), ch → sh (research), final d dropped. If 2+ are real → build (evidence store + confirm step). If not → stop.
- STT transcript errors ("base camp research", "mode") create false flags. Need a guard (skip low-confidence words?).
- Handy `history_limit` still 5. Matt must raise it for more data.
- gTTS (network) is used for the acoustic score part. Not local-first; drop it if we reuse the tool.

## Pointers
- `data/pron-spike/results.md` — full results + re-run command.
