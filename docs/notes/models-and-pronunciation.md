---
summary: Small local LLM comparison for JSON English correction on 8 GB M1 (default qwen3:4b, fallback qwen3:1.7b) plus pronunciation future-work options and a pipeline next step.
---
# Models and pronunciation (research, 2026-10-16)

## TL;DR
- Default: `qwen3:4b` (Apache 2.0, 2.5 GB file). Call `/api/chat` with `think:false` and a JSON schema in `format`.
- Fallback: `qwen3:1.7b` (Apache 2.0, 1.4 GB). Weaker, but fast and safe on 8 GB.
- Newer models exist (Qwen3.5, Gemma 4). Gemma 4 is Apache 2.0 now. But Gemma 4 E4B (6.6 GB+) is too big for 8 GB, and Qwen3.5 has a `format` bug when thinking is off.
- Pronunciation, future work: OpenPronounce (MIT) is the closest ready-made thing. Copy its idea: wav2vec2 phoneme CTC + espeak G2P + edit-distance alignment.
- Always validate JSON in code and retry once. Do not trust `format` alone.

## Part A. Small LLMs (sizes = Ollama default Q4 file; add ~1-1.5 GB for KV cache and runtime)

| Model | Ollama tag | Size | License | Thinking | Notes |
|---|---|---|---|---|---|
| Qwen3 1.7B | `qwen3:1.7b` | 1.4 GB | Apache 2.0 | hybrid, `think:false` | 40K ctx. Fallback pick. |
| Qwen3 4B | `qwen3:4b` | 2.5 GB | Apache 2.0 | hybrid, `think:false` | Default pick. Page shows 256K ctx, so the tag may point to a 2507 update. Test that `think:false` works on the tag you pull. |
| Qwen3 8B | `qwen3:8b` | 5.2 GB | Apache 2.0 | hybrid | Tight on 8 GB with macOS + STT. Skip. |
| Qwen3.5 (newer) | `qwen3.5:2b` / `:4b` / `:9b` | 2.7-3.1 / 3.3-4.0 / 6.6-7.6 GB | Apache 2.0 (4B card) | ON by default; off via `enable_thinking:false` | Feb 2026. Multimodal. Bug: `format` ignored with think off (fixed in Ollama 0.31.2, see below). |
| Qwen3.6 | `qwen3.6:27b`, `:35b` | 18-24 GB | Apache 2.0 (per search, unverified) | yes | Only big models in the visible list. Too large. |
| Qwen2.5-3B | `qwen2.5:3b` | ~1.9 GB | Qwen Research License (NOT Apache; non-commercial) | no | Avoid. Note: Qwen2.5-3B differs from other Qwen2.5 sizes. |
| Gemma 3 1B | `gemma3:1b` | 0.8 GB | Gemma Terms of Use | no | 32K ctx, text only. Weak JSON. |
| Gemma 3 4B | `gemma3:4b` | 3.4 GB | Gemma Terms of Use | no | Good English. Terms have use restrictions. |
| Gemma 4 E2B | `gemma4:e2b` | 4.6-7.5 GB | Apache 2.0 | configurable | Apr 2026. Large file due to per-layer embeddings. Needs Ollama 0.20+. |
| Gemma 4 E4B | `gemma4:e4b` | 6.6-9.5 GB | Apache 2.0 | configurable | Too big for 8 GB. |
| Phi-4-mini 3.8B | `phi4-mini` | 2.5 GB | MIT (from memory, not on Ollama page) | no | Alternative. English-strong, weaker on grammar nuance. |

### Structured output in Ollama
- `format` accepts a JSON schema (or `"json"`). Works with `/api/chat` and OpenAI-compatible `response_format`. Not on Ollama cloud.
- Docs advise: also put the schema in the prompt, use temperature 0 to 0.2, validate in code.
- Thinking models: Ollama waits for `</think>` before applying the schema. With `think:false` the template closes the tag early, so the constraint may never start. Issue #14645: reported on Qwen3.5/3.6, Gemma 4 (fixed 0.21.1), and old Qwen3 on 0.30.0+. Closed 2026-07-07 by PR #15901, reported fixed in Ollama 0.31.2.
- Rules: use Ollama 0.31.2 or newer. Use `/api/chat` with `think:false`. Test once with a bad-input sample. Keep validate + 1 retry.
- Qwen3 `think:false` (API) maps to `enable_thinking=False` (template). `/no_think` soft switch does nothing in hard-off mode. Qwen3.5 has no soft switch at all.
- Non-thinking sampling for Qwen3: temp 0.7, top_p 0.8, top_k 20. For JSON use temp 0-0.2.

### Recommendation (8 GB M1)
| Role | Pick | Why |
|---|---|---|
| Default | `qwen3:4b`, `think:false` | Apache 2.0, 2.5 GB leaves room for STT and OS, mature in Ollama, well tested with schemas. |
| Fallback | `qwen3:1.7b` | Apache 2.0, 1.4 GB. Use if memory is tight or latency is bad. Expect more missed errors. |
| Try if time | `qwen3.5:4b` | Newer and likely better. Only with Ollama 0.31.2+. Check `format` works. |

Unverified: exact Q4 RAM at runtime (file sizes above are from Ollama pages), the Qwen3.6 license, the Phi-4-mini license. Benchmark on real transcripts before locking in.

## Part B. Pronunciation (future work, no code)

| Project | What it does | Approach | License | Runtime | Maturity |
|---|---|---|---|---|---|
| OpenPronounce | Audio + target sentence -> 0-100 score, wrong words with heard IPA, pitch/energy | wav2vec2 phone CTC (espeak labels) + espeak-ng G2P + edit-distance alignment + CTC confidence. Not GOP. Score = fixed formula (Spearman 0.65 on speechocean762). | MIT | Python 3.10+, ffmpeg, espeak-ng, PyTorch CPU ok, two ~1.2 GB checkpoints. MPS ok. | Young: 129 stars, 51 commits, no releases. Author says phone flagging is a heuristic. English only. |
| IF-MDD | Mispronunciation detection and diagnosis (research code, Interspeech/ICASSP 2026) | SSL phoneme model with "indirect fusion", CROTTC, optional Llama-3.2-1B track. L2-ARCTIC F1 57.5, PER 14.3. | Apache 2.0 code; checkpoints and datasets have own licenses | Python 3.10, conda, train.py + YAML. Pretrained CTC on Hugging Face. No stated RAM. | Research release: 13 stars, 31 commits. Not a product. Good for ideas and checkpoints. |

Other options (short):
- `facebook/wav2vec2-lv-60-espeak-cv-ft`: Apache 2.0, multilingual phoneme CTC, 16 kHz input, outputs IPA-like labels. The base used by OpenPronounce-style tools. Paper arXiv 2109.11680.
- Kaldi GOP (Goodness of Pronunciation): classic per-phone score from an ASR acoustic model. Most accurate for scoring, heaviest to set up. Not good for a hackathon.
- Montreal Forced Aligner (MFA): Kaldi-based forced alignment, gives phone and word timestamps from audio + transcript. Also has G2P. Use if you need timing. License not checked.

### Recommended next step (pipeline)
1. Input: WAV (16 kHz mono) + transcript (from STT or the target text).
2. Expected phonemes: espeak-ng G2P per word (same label set as the recognizer).
3. Actual phonemes: wav2vec2 espeak CTC model, greedy decode, keep per-frame posteriors.
4. Align: edit distance between expected and actual phone sequences. Mark substitution, deletion, insertion per phone. Use CTC posterior as confidence.
5. Evidence store: per phoneme (e.g. /θ/), count `expected`, `correct`, `substituted_by`, plus mean confidence. Accumulate across all occurrences and sessions.
6. Report only phonemes with enough occurrences (e.g. 5+) and a stable error rate. One miss is noise.
7. First experiment: run OpenPronounce as-is on 10 recordings. Check if flagged phones match what a human hears. Then decide: reuse or rebuild steps 2-4.

## Sources
- Ollama Qwen3: https://ollama.com/library/qwen3 | Qwen3.5: https://ollama.com/library/qwen3.5 | Qwen3.6: https://ollama.com/library/qwen3.6
- Ollama Gemma 3: https://ollama.com/library/gemma3 | Gemma 4: https://ollama.com/library/gemma4 | Phi-4-mini: https://ollama.com/library/phi4-mini
- Ollama structured outputs: https://docs.ollama.com/capabilities/structured-outputs
- Ollama format + think bug: https://github.com/ollama/ollama/issues/14645
- Qwen3-4B card: https://huggingface.co/Qwen/Qwen3-4B | Qwen3.5-4B: https://huggingface.co/Qwen/Qwen3.5-4B | Qwen2.5-3B: https://huggingface.co/Qwen/Qwen2.5-3B-Instruct
- Gemma 4 E4B card: https://huggingface.co/google/gemma-4-E4B-it | Gemma terms (Gemma 3): https://ai.google.dev/gemma/terms
- OpenPronounce: https://github.com/Halleck45/OpenPronounce | IF-MDD: https://github.com/Secondtonumb/IF-MDD
- wav2vec2 espeak: https://huggingface.co/facebook/wav2vec2-lv-60-espeak-cv-ft | MFA: https://montreal-forced-aligner.readthedocs.io/en/latest/
