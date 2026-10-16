---
summary: Added cloud models (Gemma 4 31B, Qwen 3.8 Flash via Vercel AI Gateway) and a model selector in the web UI; both beat local qwen3:4b on the eval.
---
# Cloud models + model selector

## What we decided
- Model selector in the UI footer (`POST /api/model`, saved in kv `model`; `COACH_MODEL` env overrides at start). List: `MODELS` in `src/analyze.ts`.
- Routing rule: id with `/` → Vercel AI Gateway (`chatCloud()`), id with `:` → Ollama. Default stays local `qwen3:4b` (local-first product).
- Plain `fetch` to the gateway's OpenAI-compatible endpoint (`/v1/chat/completions`, `response_format: json_schema`). No AI SDK package: keeps zero npm deps.
- Key: `AI_GATEWAY_API_KEY` copied from `~/Documents/disclosureduo/.env` into `.env` (gitignored). Bills that same gateway account.

## Results (eval, 34 cases, 2026-10-16)
| | false corr. | useful | similarity | median / p95 |
|---|---|---|---|---|
| qwen3:4b local | 3/18 | 12/15 | 0.87 | 10.5 s / 21 s |
| gemma-4-31b-it | 0/18 | 14/15 | 0.83 | 4.5 s / 66 s |
| qwen3.8-flash | 0/18 | 15/15 | 0.84 | 5.9 s / 23 s |

## Why Gemma has 60 s spikes (investigated)
- Not the model, not thinking: a 10-token reply with 0 reasoning tokens still took 1–33 s.
- Gemma is not served by Google on the gateway. It goes to small third-party hosts (friendli, gmicloud, novita, parasail; 26B also vertex). The delay is queueing there.
- Baselines on the same probe: gemini-2.5-flash-lite steady ~0.7 s; qwen3.8-flash steady ~2.3 s; gemma-4-26b-a4b also spiky (one call 111 s).

## Open questions
- Option: pin Gemma to one fast host (gateway `providerOptions.gateway.order`, e.g. vertex for 26B) — not tried.
- Qwen 3.8 Flash thinks (~90 output tokens for a one-line answer). Turning reasoning off may cut latency — not tried.
- Check the Gemma 4 license before any Gemma becomes the shipped default.

## State at end of session
- Server restarted on :4317 with the selector (`nohup bun src/server.ts`, log in `data/server.log`). Selected model: `qwen3:4b`.
- Canonical docs updated: `README.md` (selector, results table), `docs/architecture.md` (data flow, privacy). Index unchanged.

## Pointers
- Latency probe script (scratch, not in repo): send 6 tiny prompts to one gateway model and print the time of each.
- Gateway provider list per model: `GET https://ai-gateway.vercel.sh/v1/models/<id>/endpoints`.
- Eval outputs: `data/eval/*gemma-4-31b-it.json`, `data/eval/*qwen3.8-flash.json`.
