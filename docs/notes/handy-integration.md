---
summary: How Handy (cjpais/Handy) records, transcribes, stores history.db + WAVs, and what a companion app can safely read or hook into.
---

# Handy integration notes (shallow clone, no build; paths relative to `src-tauri/src/`)

## What matters for a companion app
1. `history.db` row is written AFTER transcription and post-processing, BEFORE paste. Never UPDATEd except on user "retry" in the UI.
2. `transcription_text` is NOT raw model output. Custom-word correction, filler removal and normalisation are already applied.
3. Default retention keeps only the last 5 unsaved rows + WAVs (`history_limit=5`). A companion must copy data fast or tell the user to change retention.
4. No external hook, no webhook, no IPC. Events (`HistoryUpdatePayload`) go to Handy's own webviews only. `external_script_path` is a PASTE replacement, not a hook.
5. DB is plain rollback-journal mode (no WAL). Read-only reader works but can hit `SQLITE_BUSY`. Use `busy_timeout`, poll `MAX(id)`.

## 1. Pipeline (all in `actions.rs`, `TranscribeAction::stop`, ~l.640-800)
1. Record: `managers/audio.rs` (`AudioRecordingManager`), started by `TranscribeAction::start`. Samples are f32, 16 kHz mono.
2. Stop: `rm.stop_recording` returns samples. WAV save is spawned concurrently: `audio_toolkit::save_wav_file` (`audio_toolkit/audio/utils.rs`), then `verify_wav_file`.
3. Transcribe: `TranscriptionManager::transcribe_recording` (`managers/transcription.rs`). Text cleanup is at the end of the same file (~l.1470-1522, see section 2).
4. Post-process (only if the "transcribe_with_post_process" binding was used): `process_transcription_output` -> `post_process_transcription` (`actions.rs` ~l.150-360). LLM failure falls back to the original text (`post_processed_text` stays NULL).
5. History: `HistoryManager::save_entry` (only if the WAV saved OK).
6. Paste: `utils::paste` -> `clipboard.rs` (`PasteMethod`: clipboard / direct typing / ExternalScript). Runs on the main thread. Pasted text = `final_text` (post-processed if available, else transcription).
7. Failure path: on transcription error, `save_entry` with empty `transcription_text` (so the user can retry) and emit `transcription-error`.

## 2. What is in `transcription_history` (`managers/history.rs`)
Schema = `MIGRATIONS` (4 migrations; `user_version` = 4). Columns: `id` autoinc, `file_name`, `timestamp` (unix secs, UTC, `Utc::now().timestamp()`), `saved` (0 on insert; user toggles), `title` (formatted local-time string from `format_timestamp_title`), `transcription_text`, `post_processed_text` (nullable), `post_process_prompt` (nullable), `post_process_requested` (bool).

- `transcription_text` = output of the text pipeline in `managers/transcription.rs` ~l.1470-1522, in this order:
  1. (Chinese only) script conversion.
  2. `apply_custom_words(raw, settings.custom_words, settings.word_correction_threshold)` (`audio_toolkit/text.rs` l.151). Skipped if the engine already got the words as a prompt (`custom_words_already_prompted`).
  3. `remove_filler_words(..., settings.filler_word_removal_enabled, custom_filler_words)`. Language-gated.
  4. `normalize_transcription_output`.
  
  So filler removal and custom-word fixes ARE baked in. The truly raw model text is not stored anywhere. Filler removal is skipped only when the setting is off. No flag in the row says what was applied.
- `post_processed_text` is written in the same INSERT as the row (not a later UPDATE). It is the LLM output, or NULL if post-process was not requested or failed. `post_process_prompt` = the prompt text of the selected prompt (not its id), set only on success. `post_process_requested` = true even when the LLM failed (check `post_processed_text IS NULL`).
- UPDATE happens only in `update_transcription` (called by command `retry_history_entry_transcription`, `commands/history.rs` l.62). It re-transcribes the saved WAV with current settings and overwrites all three text columns, then emits `HistoryUpdatePayload::Updated`.
- Order: transcribe -> post-process -> INSERT -> paste. If the app dies between INSERT and paste, the row exists but nothing was pasted. Cancel before the INSERT means no row. If the WAV save fails, no row at all.
- Final pasted text is not stored separately. Derive: `COALESCE(post_processed_text, transcription_text)`.
- Stale-risk: the `title` is just a date string, not content.

## 3. WAV recordings
- Dir: `<app_data_dir>/recordings/`, DB: `<app_data_dir>/history.db` (`HistoryManager::new`). `app_data_dir` = `portable::app_data_dir`, else Tauri's (identifier `com.pais.handy`, `tauri.conf.json`). On macOS: `~/Library/Application Support/com.pais.handy/`. Portable mode overrides this (`portable.rs`). Settings live in `settings_store.json` in the same dir.
- Name: `handy-<unix_seconds>.wav` (`actions.rs` ~l.642). Same-second collision is possible in theory.
- Format: 16000 Hz, mono, 16-bit PCM int (`save_wav_file`). Samples are post-VAD/processed samples, not the raw device stream.
- Retention (`HistoryManager::cleanup_old_entries`), runs after EVERY `save_entry`, and when the user changes the setting (`commands/history.rs`):
  - `recording_retention_period` enum (`settings.rs` l.219): `never` | `preserve_limit` | `days3` | `weeks2` | `months3`. Default `preserve_limit`.
  - `never` = NO cleanup at all (keep forever). Do not read it as "do not keep".
  - `preserve_limit`: keep the newest `history_limit` (default 5) rows with `saved=0`; delete older rows AND their WAVs (`delete_entries_and_files`).
  - `days3/weeks2/months3`: delete `saved=0` rows older than the cutoff, plus WAVs.
  - Rows with `saved=1` (starred) are never auto-deleted. Manual `delete_entry` removes row + WAV.
- Cleanup deletes the row first, then the file. A reader must tolerate a row whose WAV is already gone.

## 4. Events / hooks / external script
- `external_script_path` (`settings.rs` l.502) is used ONLY when paste method = `ExternalScript` (`clipboard.rs` l.682 `paste_via_external_script`, l.841). The script is run as `script <final_text>`: one argv argument, the final text (post-processed if any). No stdin, stdout/stderr discarded, no env vars, no metadata, no entry id, no WAV path. Non-zero exit -> paste error. It replaces pasting, so using it means Handy no longer pastes; the script must paste itself.
- Frontend events (Tauri, in-process only): `HistoryUpdatePayload` (`added`/`updated`/`deleted`/`toggled`, carries the full `HistoryEntry`), `StreamTextEvent`, `StreamPhaseEvent` (`managers/transcription.rs`), `paste-error`, `transcription-error`, overlay events, `handy-keys-event`. A second process cannot subscribe to these.
- No HTTP server, no CLI query of history (`cli.rs` is for flags like toggle/cancel; check it before relying on it). No plugin API.
- Practical hook for a companion: watch `history.db` (poll `MAX(id)` or watch the file mtime) and read new rows; copy the WAV from `recordings/` by `file_name`.

## 5. LLM post-processing providers (`settings.rs` ~l.680-775, `actions.rs`, `llm_client.rs`)
- Providers: openai, zai, openrouter, anthropic, groq, cerebras, bedrock_mantle, `custom`, plus `apple_intelligence` (`APPLE_INTELLIGENCE_PROVIDER_ID`, macOS aarch64 only, `apple_intelligence.rs`).
- `custom`: default base URL `http://localhost:11434/v1` (Ollama), editable (`allow_base_url_edit: true`), OpenAI-compatible chat completions (Anthropic format also supported per provider `api_format`), no structured output by default. Fits local LLMs (Ollama, LM Studio, llama.cpp).
- Settings keys (in `settings_store.json`): `post_process_providers`, `post_process_api_keys` (a SecretMap), `post_process_prompts`, `post_process_selected_prompt_id`, plus per-provider model. Prompt uses `${output}` placeholder (legacy) or JSON-schema mode.
- Reuse: a companion can NOT call Handy's pipeline (no IPC). It can read the same config (base URL, model, prompt) from `settings_store.json` and call the same endpoint itself. API keys may be stored in that file; check `SecretMap` handling before reading them. Apple Intelligence is in-process only; not reusable.

## 6. SQLite mode / second reader
- No `journal_mode` / WAL pragma anywhere in `src-tauri/src` (grep: none). So default DELETE journal mode.
- `HistoryManager::get_connection` opens a NEW `Connection::open(&db_path)` per call. No pooling, no busy_timeout set. Writes are short single statements.
- A read-only second process is safe for data integrity. Risks: (a) `SQLITE_BUSY` during Handy's write (retry, set `busy_timeout`); (b) a reader holding a read lock briefly blocks Handy's write, and Handy has no busy_timeout, so its `save_entry` could fail with "database is locked" (it only logs the error, the paste still happens, but the history row is lost). Keep reads short, open per poll, close fast. (c) Do NOT set WAL from the companion: it changes the file mode persistently and Handy would then need `-wal`/`-shm` files next to the DB.
- Open with `?mode=ro` (URI) or `PRAGMA query_only=1`. Do not run migrations. Respect `user_version` (4); new Handy versions may add columns, so `SELECT` by column name.
