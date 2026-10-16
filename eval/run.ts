// Eval: bun eval/run.ts  → prints metrics, writes data/eval/<timestamp>.json
import { analyze, getModel } from "../src/analyze";
const MODEL = getModel();
import { mkdirSync, writeFileSync } from "node:fs";

type Case = { category: string; expect: "none" | "grammar" | "fluency" | "any"; must?: string[]; text: string };
const cases: Case[] = await Bun.file(new URL("./cases.json", import.meta.url)).json();

// Word-level similarity (1 - edit distance / length): proxy for "meaning preserved".
function similarity(a: string, b: string) {
  const x = a.toLowerCase().match(/[\w']+/g) ?? [], y = b.toLowerCase().match(/[\w']+/g) ?? [];
  const d = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j++) d[0][j] = j;
  for (let i = 1; i <= x.length; i++) for (let j = 1; j <= y.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
  return 1 - d[x.length][y.length] / Math.max(x.length, y.length, 1);
}

await analyze({ text: "This is a warm up sentence for the model." }); // load model, not timed

const results = [];
for (const c of cases) {
  const { feedback, ms } = await analyze({ text: c.text, language: "en" });
  const f = feedback.issues;
  const found = f.length > 0;
  const fixText = f.map((i) => i.suggestion).join(" ").toLowerCase() + " " + (feedback.natural_version ?? "").toLowerCase();
  const useful = !c.must || c.must.some((m) => fixText.includes(m.toLowerCase()));
  let verdict: string;
  if (c.expect === "none") verdict = found ? "FALSE CORRECTION" : "ok";
  else if (c.expect === "any") verdict = "ok";
  else if (!found) verdict = "missed";
  else if (c.expect === "fluency" && f.every((i) => i.type === "grammar")) verdict = useful ? "ok (labelled grammar)" : "not useful";
  else verdict = useful ? "ok" : "not useful";
  const sim = feedback.natural_version ? similarity(c.text, feedback.natural_version) : null;
  results.push({ ...c, verdict, ms, similarity: sim, issues: f, natural_version: feedback.natural_version });
  console.log(`${verdict.padEnd(18)} ${String(ms).padStart(5)}ms  [${c.category}] ${c.text}`);
  for (const i of f) console.log(`${"".padEnd(26)}${i.type}: "${i.original}" → "${i.suggestion}"`);
}

const neg = results.filter((r) => r.expect === "none");
const pos = results.filter((r) => r.expect === "grammar" || r.expect === "fluency");
const ms = results.map((r) => r.ms).sort((a, b) => a - b);
const sims = results.map((r) => r.similarity).filter((s): s is number => s !== null);
const summary = {
  model: MODEL,
  cases: results.length,
  false_correction_rate: `${neg.filter((r) => r.verdict !== "ok").length}/${neg.length}`,
  useful_feedback_rate: `${pos.filter((r) => r.verdict.startsWith("ok")).length}/${pos.length}`,
  missed: pos.filter((r) => r.verdict === "missed").length,
  meaning_preserved_avg_similarity: sims.length ? +(sims.reduce((a, b) => a + b, 0) / sims.length).toFixed(2) : null,
  latency_ms: { median: ms[Math.floor(ms.length / 2)], p95: ms[Math.floor(ms.length * 0.95)], max: ms.at(-1) },
};
console.log("\n", summary);
mkdirSync("data/eval", { recursive: true });
writeFileSync(`data/eval/${new Date().toISOString().replace(/[:.]/g, "-")}-${MODEL.replace(/[:/]/g, "_")}.json`, JSON.stringify({ summary, results }, null, 2));
