---
summary: Plan (not built; spike done) for pronunciation feedback — phoneme recognition vs expected phonemes, evidence across occurrences, confirm with follow-up recordings.
---
# Pronunciation plan (not built yet)

**What is true now:** not built into the coach. A spike ran OpenPronounce (MIT) on 5 of Matt's Handy WAVs: it works on the M1 (CPU, ~25 s and ~2.5 GB RAM per file, needs `PHONEMIZER_ESPEAK_LIBRARY=/opt/homebrew/lib/libespeak-ng.dylib`). Its own flags are few and mostly noise (fast function words). The full phone-diff list shows repeating Italian-typical candidates: short i → ee, th → d, ch → sh, final d dropped. Decision (reuse vs rebuild vs stop) waits on Matt checking the candidates by ear. Spike files and re-run command: `data/pron-spike/results.md`.

The engine input (`Utterance` in `src/analyze.ts`) has `audioPath`, `timestamps`, `language`. The Handy reader fills `audioPath` (16 kHz mono 16-bit WAV). The coach never copies or keeps audio.

**Core rule:** a correct Whisper/Parakeet transcript does NOT mean correct pronunciation (STT models are trained to forgive accents). Compare the *sounds* heard against the *phonemes* expected.

## Pipeline
1. Expected phonemes: espeak-ng G2P on the transcript (same label set as step 2).
2. Actual phonemes: `facebook/wav2vec2-lv-60-espeak-cv-ft` (Apache 2.0) CTC, keep posteriors.
3. Align (edit distance) → per phoneme: correct / substituted-by-X / deleted, plus confidence.
4. Evidence store per phoneme (e.g. /θ/ → /t/): counts across all dictations. No feedback from one occurrence.
5. Threshold (e.g. ≥ 5 occurrences, stable error rate, good confidence) → "candidate".
6. Confirm: ask for a short targeted recording ("say: *think, three, both*"). Only confirmed errors become a micro-lesson.

## First step (half a day)
Run OpenPronounce (MIT; same approach as above) on 10 of Matt's Handy WAVs. Check if its flags match what a human hears. Then choose: reuse it as a local Python sidecar, or rebuild steps 1-3 (~150 lines Python).

## Needs from the user
- Opt-in to keep audio (Handy's default `history_limit` = 5 deletes WAVs fast). The coach would copy only the WAVs it analyzes, and delete them after phoneme extraction.

Candidates and details: `notes/models-and-pronunciation.md` (OpenPronounce, IF-MDD, Kaldi GOP, MFA).
