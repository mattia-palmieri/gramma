// Wires the three layers: Handy (input) → analyze (engine) → store + UI (presentation).
import { analyze, getModel, setModel, MODELS, type Utterance, type Feedback } from "./analyze";
import { latestId, watchHandy, recentEntries, insertTestEntry, deleteTestEntry, HANDY_DIR } from "./handy";
import * as store from "./store";

const PORT = Number(process.env.PORT ?? 4317);
const NOTIFY = process.env.COACH_NOTIFY !== "0";
const BACKFILL = Number(process.env.COACH_BACKFILL ?? 0); // analyze the last N Handy entries at start (demo)

let paused = store.getKv("paused", "0") === "1";
if (!process.env.COACH_MODEL) setModel(store.getKv("model", getModel()));
let status = "idle";
const clients = new Set<ReadableStreamDefaultController>();
const push = (event: string, data: unknown) => {
  const msg = new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  for (const c of clients) { try { c.enqueue(msg); } catch { clients.delete(c); } }
};
const setStatus = (s: string) => { status = s; push("status", { status, paused }); };

// Floating panel (hud/Hud.swift), compiled at start into data/hud/. Fallback: plain macOS notification.
const HUD_SRC = new URL("../hud/Hud.swift", import.meta.url).pathname;
const HUD_BIN = new URL("../data/hud/coach-hud", import.meta.url).pathname;
let hudReady = false;
let hudProc: ReturnType<typeof Bun.spawn> | null = null;
if (NOTIFY) (async () => {
  const bin = Bun.file(HUD_BIN);
  if (await bin.exists() && bin.lastModified >= Bun.file(HUD_SRC).lastModified) { hudReady = true; return; }
  const p = Bun.spawn(["swiftc", HUD_SRC, "-o", HUD_BIN], { stderr: "pipe" });
  if ((await p.exited) === 0) hudReady = true;
  else console.warn("[hud] compile failed, using notifications:", await new Response(p.stderr).text());
})();

function notify(f: Feedback) {
  if (!NOTIFY) return;
  if (hudReady) {
    hudProc?.kill(); // one panel at a time: the newest wins
    const payload = { issues: f.issues, natural: f.natural_version, url: `http://127.0.0.1:${PORT}` };
    hudProc = Bun.spawn([HUD_BIN, JSON.stringify(payload)]);
    return;
  }
  const first = f.issues[0];
  const text = `“${first.original}” → “${first.suggestion}”${f.issues.length > 1 ? ` (+${f.issues.length - 1})` : ""}`;
  // Text goes in as argv, never inside the script, so no quoting problems.
  Bun.spawn(["osascript", "-e", "on run argv", "-e", 'display notification (item 1 of argv) with title "Gramma"', "-e", "end run", text]);
}

// One analysis at a time, in order. Handy is never blocked: it has already pasted.
const queue: Utterance[] = [];
let busy = false;
async function enqueue(u: Utterance) {
  if (paused) return;
  queue.push(u);
  if (busy) return;
  busy = true;
  while (queue.length) {
    const next = queue.shift()!;
    setStatus("analyzing");
    const usedModel = getModel();
    try {
      const { feedback, ms, skipped } = await analyze(next);
      console.log(`[coach] ${next.source ?? "manual"} ${skipped ?? `${feedback.issues.length} issue(s)`} ${ms}ms`);
      setStatus("idle");
      if (feedback.issues.length) {
        const row = store.addFeedback(next.source, next.text, feedback, ms, usedModel);
        push("feedback", row);
        push("patterns", store.patterns());
        notify(feedback);
      } else push("clean", { source: next.source, ms, skipped, model: usedModel });
    } catch (err) {
      console.error("[coach] analysis failed:", (err as Error).message);
      setStatus(getModel().includes("/") ? "error: cloud call failed (see server log)" : "error: is Ollama running?");
    }
  }
  busy = false;
}

const start = Math.max(0, latestId() - BACKFILL);
watchHandy(start, (e) => enqueue(e));

const json = (d: unknown, status = 200) => Response.json(d, { status });

Bun.serve({
  port: PORT,
  hostname: "127.0.0.1", // local only
  idleTimeout: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (p === "/") return new Response(Bun.file(new URL("../ui/index.html", import.meta.url)));
    if (p === "/events") {
      let ctrl: ReadableStreamDefaultController;
      return new Response(new ReadableStream({
        start(c) { ctrl = c; clients.add(c); },
        cancel() { clients.delete(ctrl); },
      }), { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" } });
    }
    if (p === "/api/state") return json({ paused, status, model: getModel(), models: MODELS, feedback: store.listFeedback(), patterns: store.patterns() });
    if (p === "/api/pause" && req.method === "POST") {
      paused = Boolean((await req.json()).paused);
      store.setKv("paused", paused ? "1" : "0");
      if (paused) queue.length = 0;
      setStatus(status);
      return json({ paused });
    }
    if (p === "/api/model" && req.method === "POST") {
      const { model } = await req.json();
      if (!MODELS.includes(model)) return json({ error: "unknown model" }, 400);
      setModel(model);
      store.setKv("model", model);
      return json({ model });
    }
    if (p === "/api/analyze" && req.method === "POST") {
      const { text } = await req.json();
      if (typeof text !== "string" || !text.trim()) return json({ error: "text required" }, 400);
      enqueue({ text: text.trim(), source: "manual" });
      return json({ queued: true });
    }
    if (p === "/api/handy/recent") return json(recentEntries(10).map((e) => ({ id: e.id, text: e.text })));
    if (p === "/api/handy/replay" && req.method === "POST") {
      const { id } = await req.json();
      const e = recentEntries(50).find((x) => x.id === id);
      if (!e) return json({ error: "not found" }, 404);
      enqueue(e); // same path as a live dictation
      return json({ queued: true });
    }
    if (p === "/api/handy/test" && req.method === "POST") {
      // Fake dictation in Handy's db; the normal poll picks it up. Removed after 5 s (poll is every 1 s).
      const id = insertTestEntry("Yesterday I go to the office and my manager explain me the new plan.");
      setTimeout(() => { try { deleteTestEntry(id); } catch {} }, 5000);
      return json({ id });
    }
    const m = p.match(/^\/api\/feedback\/(\d+)(\/dismiss)?$/);
    if (m && req.method === "POST" && m[2]) { store.dismiss(+m[1]); return json({ ok: true }); }
    if (m && req.method === "DELETE") { store.deleteFeedback(+m[1]); push("patterns", store.patterns()); return json({ ok: true }); }
    if (p === "/api/feedback" && req.method === "DELETE") { store.clearAll(); push("patterns", []); return json({ ok: true }); }
    return new Response("Not found", { status: 404 });
  },
});

console.log(`Gramma on http://127.0.0.1:${PORT}  model=${getModel()}  handy=${HANDY_DIR}  paused=${paused}`);
