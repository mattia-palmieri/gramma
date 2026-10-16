// Thin Handy integration: read-only polling of Handy's history.db.
// This is the ONLY file that knows about Handy. Handy itself is not modified.
import { Database } from "bun:sqlite";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Utterance } from "./analyze";

export const HANDY_DIR = process.env.HANDY_DIR ?? join(homedir(), "Library/Application Support/com.pais.handy");
const DB_PATH = join(HANDY_DIR, "history.db");

export type HandyEntry = Utterance & { id: number; pasted: string };

function handyLanguage(): string | undefined {
  try {
    const s = JSON.parse(readFileSync(join(HANDY_DIR, "settings_store.json"), "utf8"));
    const lang = (s.settings ?? s).selected_language;
    return lang && lang !== "auto" ? lang : undefined; // "auto" → we check English ourselves
  } catch { return undefined; }
}

function query<T>(sql: string, ...args: any[]): T[] {
  if (!existsSync(DB_PATH)) return [];
  const db = new Database(DB_PATH, { readonly: true });
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    return db.query(sql).all(...args) as T[];
  } finally { db.close(); }
}

export const latestId = () => query<{ m: number | null }>("SELECT MAX(id) AS m FROM transcription_history")[0]?.m ?? 0;

const COLS = "SELECT id, file_name, transcription_text, post_processed_text FROM transcription_history";

export const entriesAfter = (id: number) => toEntries(query<any>(`${COLS} WHERE id > ? AND transcription_text != '' ORDER BY id`, id));

// Last n dictations, newest first. Used by the "Replay" list (demo without speaking).
export const recentEntries = (n: number) => toEntries(query<any>(`${COLS} WHERE transcription_text != '' ORDER BY id DESC LIMIT ?`, n));

function toEntries(rows: any[]): HandyEntry[] {
  const lang = handyLanguage();
  return rows.map((r) => ({
    id: r.id,
    text: r.transcription_text,                       // pre-LLM transcript (Handy already removed fillers / applied custom words)
    pasted: r.post_processed_text ?? r.transcription_text,
    language: lang,
    audioPath: join(HANDY_DIR, "recordings", r.file_name), // reference only; Handy owns retention
    source: `handy:${r.id}`,
  }));
}

// TEST ONLY: the one place we write to Handy's db. Adds a fake dictation so the
// full live path (poll → analyze → notification) can be tested without speaking.
// The caller must delete it after the poll picked it up.
export function insertTestEntry(text: string): number {
  const db = new Database(DB_PATH);
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    const r = db.query("INSERT INTO transcription_history (file_name, timestamp, title, transcription_text) VALUES ('coach-test.wav', ?, 'Speaking coach test', ?) RETURNING id")
      .get(Math.floor(Date.now() / 1000), text) as { id: number };
    return r.id;
  } finally { db.close(); }
}
export function deleteTestEntry(id: number) {
  const db = new Database(DB_PATH);
  try {
    db.exec("PRAGMA busy_timeout = 2000");
    db.query("DELETE FROM transcription_history WHERE id = ? AND file_name = 'coach-test.wav'").run(id);
  } finally { db.close(); }
}

// Calls onEntry for every new dictation. Never blocks Handy: we only read.
export function watchHandy(startAfter: number, onEntry: (e: HandyEntry) => void, everyMs = 1000) {
  let last = startAfter;
  setInterval(() => {
    try {
      for (const e of entriesAfter(last)) { last = e.id; onEntry(e); }
    } catch (err) { console.warn("[handy] read failed, will retry:", (err as Error).message); }
  }, everyMs);
  return () => last;
}
