// Analysis engine. Knows nothing about Handy or the UI.
// Input: an Utterance. Output: validated Feedback (or null = nothing worth saying).

export type Utterance = {
  text: string;            // raw transcript (before any AI cleanup)
  language?: string;       // e.g. "en"; undefined = unknown
  audioPath?: string;      // for future pronunciation analysis (not used yet)
  timestamps?: { word: string; start: number; end: number }[]; // future
  source?: string;         // e.g. "handy:42"
};

export const ISSUE_TYPES = ["grammar", "fluency", "repetition"] as const;
export const PATTERNS = [
  "verb tense", "subject-verb agreement", "articles", "prepositions",
  "plurals", "word order", "verb pattern (-ing / to)", "word choice",
  "collocation", "pronouns", "questions", "redundancy", "other",
] as const;

export type Issue = {
  type: (typeof ISSUE_TYPES)[number];
  original: string;     // exact words from the transcript
  suggestion: string;
  explanation: string;
  pattern: (typeof PATTERNS)[number];
};
export type Feedback = { issues: Issue[]; natural_version: string | null };

const SCHEMA = {
  type: "object",
  properties: {
    issues: {
      type: "array",
      items: {
        type: "object",
        properties: {
          type: { type: "string", enum: ISSUE_TYPES },
          original: { type: "string" },
          suggestion: { type: "string" },
          explanation: { type: "string" },
          pattern: { type: "string", enum: PATTERNS },
          confidence: { type: "string", enum: ["high", "medium", "low"] },
        },
        required: ["type", "original", "suggestion", "explanation", "pattern", "confidence"],
      },
    },
    natural_version: { type: ["string", "null"] },
  },
  required: ["issues", "natural_version"],
};

const SYSTEM = `You are a careful English speaking coach. The input is a raw speech-to-text transcript of someone talking naturally (often dictating to an AI assistant or writing a message). Your job: find only the feedback that would genuinely help them speak better English.

Report an issue ONLY in these cases:
- "grammar": a real grammatical error that a fluent speaker would not make, even in casual speech (wrong tense, agreement, wrong verb pattern, missing/wrong article where it clearly matters, wrong preposition).
- "fluency": the sentence is understandable but a fluent speaker would almost never say it that way (non-native calque, unnatural collocation). Not for things that are merely informal.
- "repetition": the speaker repeats words or phrases in a way that makes the speech harder to follow, AND removing them clearly helps.

NEVER report:
- Valid informal speech: "gonna", "wanna", "kinda", "yeah", "so basically", "like", contractions, starting with "And"/"So", sentence fragments, run-on spoken sentences.
- Normal fillers ("um", "uh", "you know", "I mean") or self-corrections ("I went to — I drove to"). These are natural speech.
- Punctuation, capitalization, spelling, or anything that could be a speech-to-text error (a wrong but similar-sounding word, a misheard name). If a word looks like a transcription mistake, ignore it.
- Proper nouns, product names, technical terms, code words.
- Style preferences, formality, or "this could be shorter". If a fluent speaker could naturally say it, it is fine.
- Regional or accent-related variation that is valid English.

Rules:
- "original" must copy the exact words from the transcript (a short span, not the whole sentence).
- "suggestion" replaces only that span. Keep the speaker's meaning, words, and personality.
- "explanation": one short sentence that teaches the rule. No generic advice.
- "confidence": "high" only if you are sure a fluent speaker would agree.
- "natural_version": the full transcript with ONLY your suggested changes applied, or null if there are no issues.
- Most transcripts from fluent speakers have NO issues. Returning {"issues": [], "natural_version": null} is the correct answer most of the time.

Examples:
Transcript: "Yesterday I go to the gym and I meet a friend."
{"issues":[{"type":"grammar","original":"I go","suggestion":"I went","explanation":"Use the past tense for completed actions in the past.","pattern":"verb tense","confidence":"high"},{"type":"grammar","original":"I meet","suggestion":"I met","explanation":"Use the past tense for completed actions in the past.","pattern":"verb tense","confidence":"high"}],"natural_version":"Yesterday I went to the gym and I met a friend."}

Transcript: "I'm thinking to create an application."
{"issues":[{"type":"fluency","original":"thinking to create","suggestion":"thinking of creating","explanation":"'Think of' is followed by the -ing form when you talk about a plan.","pattern":"verb pattern (-ing / to)","confidence":"high"}],"natural_version":"I'm thinking of creating an application."}

Transcript: "So yeah, um, I'm gonna push the fix to GitHub later, like after lunch."
{"issues":[],"natural_version":null}`;

const OLLAMA = process.env.OLLAMA_URL ?? "http://127.0.0.1:11434";
// Model ids with "/" go to Vercel AI Gateway (cloud, for testing: transcripts leave the machine).
// Ids with ":" go to local Ollama (default).
export const MODELS = ["qwen3:4b", "google/gemma-4-31b-it", "alibaba/qwen3.8-flash", "openai/gpt-oss-120b"];
// Hidden "thinking" is the main cause of cloud latency. Keep it off or low.
const REASONING: Record<string, object> = {
  "alibaba/qwen3.8-flash": { reasoning: { enabled: false }, enable_thinking: false },
  "openai/gpt-oss-120b": { reasoning_effort: "low" },
};
let model = process.env.COACH_MODEL ?? "qwen3:4b";
export const getModel = () => model;
export const setModel = (m: string) => { model = m; };
const isCloud = (m: string) => m.includes("/");

// Very cheap English check: share of common English function words.
const EN_WORDS = new Set("the a an and or but to of in on at for with is are was were be been i you he she it we they this that what my your me do does did have has had not can will would so if just".split(" "));
export function looksEnglish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-z']+/g) ?? [];
  if (words.length < 3) return false;
  const hits = words.filter((w) => EN_WORDS.has(w)).length;
  return hits / words.length >= 0.2;
}

const norm = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}' ]+/gu, " ").replace(/\s+/g, " ").trim();

// Words that sound the same. In speech, picking the wrong one is the transcriber's fault, not the speaker's.
const HOMOPHONES = [
  ["their", "they're", "there"], ["your", "you're"], ["its", "it's"], ["to", "too", "two"],
  ["then", "than"], ["were", "where", "we're"], ["whose", "who's"], ["affect", "effect"],
];
const soundsSame = (a: string, b: string) => {
  const aw = a.split(" "), bw = b.split(" ");
  if (aw.length !== bw.length) return false;
  return aw.every((w, k) => w === bw[k] || HOMOPHONES.some((g) => g.includes(w) && g.includes(bw[k])));
};
const INFORMAL = /\b(kinda|gonna|wanna|gotta|sorta|yeah|basically|lemme|dunno)\b/;
// True if the suggestion only removes words from the original (same words, same order, fewer).
const isDeletionOnly = (o: string, s: string) => {
  const ow = o.split(" "), sw = s.split(" ");
  let k = 0;
  for (const w of ow) if (w === sw[k]) k++;
  return sw.length < ow.length && k === sw.length;
};
// Count spots where a word is said twice or more in a row ("the the", "is is is").
const repeatSpots = (t: string) => (t.match(/\b(\w+)( \1\b)+/g) ?? []).length;

// Some models write special dashes (U+2010–2015) in labels. Make them normal "-".
const pat = (p: unknown) => String(p ?? "").replace(/[\u2010-\u2015]/g, "-");

// Drop anything that is not trustworthy. False positives cost more than misses.
export function validate(raw: unknown, transcript: string): Feedback {
  const t = norm(transcript);
  const out: Issue[] = [];
  const r = raw as { issues?: any[]; natural_version?: unknown };
  for (const i of Array.isArray(r?.issues) ? r.issues : []) {
    if (!i || !ISSUE_TYPES.includes(i.type) || typeof i.original !== "string" || typeof i.suggestion !== "string") continue;
    if (i.confidence === "low") continue;
    if (i.type !== "grammar" && i.confidence !== "high") continue; // optional advice must be confident
    const o = norm(i.original), s = norm(i.suggestion);
    if (!o || o === s) continue;                    // empty, or only punctuation/case changed
    if (!t.includes(o)) continue;                   // model invented words not in the transcript
    if (o.split(" ").length > 12) continue;         // rewrites whole sentences — not a targeted correction
    if (/^(um+|uh+|erm|like|you know|i mean)$/.test(o)) continue; // fillers are natural speech
    if (soundsSame(o, s)) continue;                 // their/they're etc. — speech-to-text error
    if (INFORMAL.test(o)) continue;                 // valid informal speech
    if (i.type === "fluency" && s.startsWith(o + " ")) continue; // only adds words at the end: completes a self-correction ("I went to the —")
    if (i.type === "fluency" && isDeletionOnly(o, s)) continue; // "So basically"→"Basically", "what do they do"→"what they do": style, not error
    if (i.type === "repetition" && repeatSpots(t) < 2 && !/\b(\w+) \1 \1\b/.test(t)) continue; // one small stutter is normal
    out.push({
      type: i.type,
      original: i.original.trim(),
      suggestion: i.suggestion.trim(),
      explanation: String(i.explanation ?? "").trim(),
      pattern: PATTERNS.includes(pat(i.pattern)) ? pat(i.pattern) : "other",
    });
  }
  const nv = out.length && typeof r?.natural_version === "string" ? r.natural_version.trim() : null;
  return { issues: out, natural_version: nv };
}

export async function analyze(u: Utterance): Promise<{ feedback: Feedback; ms: number; skipped?: string }> {
  const start = performance.now();
  if (u.language && !u.language.startsWith("en")) return { feedback: { issues: [], natural_version: null }, ms: 0, skipped: "not English" };
  if (!looksEnglish(u.text)) return { feedback: { issues: [], natural_version: null }, ms: 0, skipped: "not English or too short" };

  // Retry once if the model returns invalid JSON. Still invalid → no feedback (never guess).
  for (let attempt = 0; attempt < 2; attempt++) {
    const parsed = await callModel(u.text);
    if (parsed !== undefined) return { feedback: validate(parsed, u.text), ms: Math.round(performance.now() - start) };
  }
  return { feedback: { issues: [], natural_version: null }, ms: Math.round(performance.now() - start), skipped: "invalid model output" };
}

async function callModel(text: string): Promise<unknown | undefined> {
  const content = await chat(SYSTEM, `Transcript: ${JSON.stringify(text)}`, SCHEMA);
  try { return JSON.parse(content); } catch { return undefined; }
}

async function chat(system: string, user: string, format: object): Promise<string> {
  if (isCloud(model)) return chatCloud(system, user, format);
  const res = await fetch(`${OLLAMA}/api/chat`, {
    method: "POST",
    body: JSON.stringify({
      model,
      stream: false,
      think: false,
      keep_alive: "30m",
      format,
      options: { temperature: 0 },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { message?: { content?: string } };
  return body.message?.content ?? "";
}

// Vercel AI Gateway, OpenAI-compatible endpoint. Needs AI_GATEWAY_API_KEY in .env (Bun loads it).
async function chatCloud(system: string, user: string, schema: object): Promise<string> {
  const res = await fetch("https://ai-gateway.vercel.sh/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.AI_GATEWAY_API_KEY}` },
    body: JSON.stringify({
      model,
      temperature: 0,
      ...REASONING[model],
      response_format: { type: "json_schema", json_schema: { name: "feedback", schema } },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (!res.ok) throw new Error(`Gateway ${res.status}: ${await res.text()}`);
  const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  return body.choices?.[0]?.message?.content ?? "";
}
