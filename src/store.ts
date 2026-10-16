// Local storage for the coach. Stores ONLY utterances that got feedback, plus a few settings.
// No audio is copied. Clean transcripts are not stored at all.
import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import type { Feedback } from "./analyze";

mkdirSync("data", { recursive: true });
const db = new Database(process.env.COACH_DB ?? "data/coach.db", { create: true });
db.exec(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    created_at INTEGER NOT NULL,
    source TEXT,
    original TEXT NOT NULL,
    natural_version TEXT,
    issues TEXT NOT NULL,          -- JSON Issue[]
    ms INTEGER,
    dismissed INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT NOT NULL);
`);
try { db.exec("ALTER TABLE feedback ADD COLUMN model TEXT"); } catch {} // added later; old rows stay NULL

export type FeedbackRow = { id: number; created_at: number; source: string | null; original: string; natural_version: string | null; issues: Feedback["issues"]; ms: number; dismissed: number; model: string | null };

const parse = (r: any): FeedbackRow => ({ ...r, issues: JSON.parse(r.issues) });

export function addFeedback(source: string | undefined, original: string, f: Feedback, ms: number, model: string): FeedbackRow {
  const r = db.query("INSERT INTO feedback (created_at, source, original, natural_version, issues, ms, model) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *")
    .get(Date.now(), source ?? null, original, f.natural_version, JSON.stringify(f.issues), ms, model);
  return parse(r);
}

export const listFeedback = (limit = 50) => db.query("SELECT * FROM feedback ORDER BY id DESC LIMIT ?").all(limit).map(parse);
export const dismiss = (id: number) => db.query("UPDATE feedback SET dismissed = 1 WHERE id = ?").run(id);
export const deleteFeedback = (id: number) => db.query("DELETE FROM feedback WHERE id = ?").run(id);
export const clearAll = () => db.exec("DELETE FROM feedback");

// Recurring patterns: count issues per (type, pattern), with the latest example.
export function patterns() {
  const counts = new Map<string, { type: string; pattern: string; count: number; example: string; suggestion: string }>();
  for (const row of db.query("SELECT issues FROM feedback ORDER BY id").all() as { issues: string }[]) {
    for (const i of JSON.parse(row.issues)) {
      const key = `${i.type}|${i.pattern}`;
      const c = counts.get(key) ?? { type: i.type, pattern: i.pattern, count: 0, example: "", suggestion: "" };
      c.count++; c.example = i.original; c.suggestion = i.suggestion;
      counts.set(key, c);
    }
  }
  return [...counts.values()].filter((c) => c.count >= 2).sort((a, b) => b.count - a.count);
}

export function getKv(k: string, fallback: string) {
  return (db.query("SELECT v FROM kv WHERE k = ?").get(k) as { v: string } | null)?.v ?? fallback;
}
export const setKv = (k: string, v: string) => db.query("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v").run(k, v);
