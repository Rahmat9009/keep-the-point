/**
 * Shared helpers for the AI endpoints (api/shorten.ts, api/bridge.ts).
 * Files starting with "_" are not deployed as routes by Vercel.
 *
 * The Gemini API key is read from process.env.GEMINI_API_KEY on the server only.
 * It is never logged, echoed back, or sent anywhere except Google's API.
 */

/**
 * Models, chosen by timing real calls with our prompts (Nov 2026):
 * gemini-3.5-flash-lite answered in about 1s with good results; gemini-3.6-flash took 20-30s;
 * gemini-3.8-flash was mostly overloaded (503). Override the first with GEMINI_MODEL.
 */
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Tried with the time left if the first model times out or returns 429/500/503. */
export const BACKUP_MODEL = 'gemini-3.6-flash';

/**
 * Lowest thinking level each model accepts (Gemini docs: thinking can't be fully turned off on
 * Gemini 3 Flash models; "minimal" is near-off, and gemini-3.8-flash only goes down to "low").
 */
const THINKING_LEVEL: Record<string, string> = {
  'gemini-3.5-flash-lite': 'minimal',
  'gemini-3.6-flash': 'minimal',
  'gemini-3.8-flash': 'low',
};
export const thinkingLevelFor = (model: string) => THINKING_LEVEL[model] ?? 'low';

/** Time the first model gets before we try the backup. */
export const FIRST_TIMEOUT_MS = 6_000;
/** The whole server call (both attempts) finishes within this. */
export const TOTAL_TIMEOUT_MS = 12_000;
export const MAX_TEXT = 1000;
const MAX_BODY_BYTES = 20_000;
const PLACEHOLDER_KEY = 'paste-your-key-here';

export const UNAVAILABLE = 'AI unavailable. Write your own short version.';

export interface ApiResult {
  status: number;
  body: { text: string } | { error: string };
}

export class InputError extends Error {}

export function json(result: ApiResult): Response {
  return new Response(JSON.stringify(result.body), {
    status: result.status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

/** Read and parse a JSON request body, with a size limit. */
export async function readJson(req: Request): Promise<unknown> {
  if (req.method !== 'POST') throw new InputError('Use POST.');
  const raw = await req.text();
  if (raw.length > MAX_BODY_BYTES) throw new InputError('Request is too large.');
  try {
    return JSON.parse(raw);
  } catch {
    throw new InputError('Request must be JSON.');
  }
}

/* ---------- Input validation ---------- */

export function asObject(v: unknown, allowedKeys: string[]): Record<string, unknown> {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new InputError('Request must be a JSON object.');
  const extra = Object.keys(v).filter((k) => !allowedKeys.includes(k));
  if (extra.length) throw new InputError(`Unexpected field: ${extra[0].slice(0, 40)}.`);
  return v as Record<string, unknown>;
}

/** A card's text: a non-blank string of at most 1,000 characters. */
export function cardText(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new InputError(`${name} must be some text.`);
  if (v.length > MAX_TEXT) throw new InputError(`${name} is too long (max ${MAX_TEXT} characters).`);
  return v.trim();
}

export function shortString(v: unknown, name: string, max: number, required = false): string {
  if (v === undefined && !required) return '';
  if (typeof v !== 'string') throw new InputError(`${name} must be text.`);
  if (v.length > max) throw new InputError(`${name} is too long (max ${max} characters).`);
  return v.trim();
}

export function stringList(v: unknown, name: string, maxItems: number, maxLen: number): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > maxItems) throw new InputError(`${name} must be a list of at most ${maxItems} items.`);
  return v.map((item) => shortString(item, name, maxLen, true));
}

/* ---------- Gemini call ---------- */

export interface GeminiOptions {
  /** Time the first model gets (default 6s). */
  firstTimeoutMs?: number;
  /** Time for the whole call, both attempts (default 12s). */
  totalTimeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function apiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key !== PLACEHOLDER_KEY ? key : null;
}

type Attempt =
  | { kind: 'response'; status: number; data: unknown }
  | { kind: 'timeout' }
  | { kind: 'network' };

/** One generateContent call that gives up after `budgetMs`. */
async function attempt(model: string, prompt: string, key: string, budgetMs: number, doFetch: typeof fetch): Promise<Attempt> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    const res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: {
            type: 'object',
            properties: { text: { type: 'string' } },
            required: ['text'],
          },
          temperature: 0.4,
          thinkingConfig: { thinkingLevel: thinkingLevelFor(model) },
        },
      }),
      signal: controller.signal,
    });
    const data: unknown = res.ok ? await res.json().catch(() => null) : null;
    if (controller.signal.aborted) return { kind: 'timeout' };
    return { kind: 'response', status: res.status, data };
  } catch {
    // Never log: errors could include request details.
    return controller.signal.aborted ? { kind: 'timeout' } : { kind: 'network' };
  } finally {
    clearTimeout(timer);
  }
}

/** Worth trying the backup model: the first one was slow, unreachable, rate-limited or overloaded. */
const shouldRetry = (a: Attempt) =>
  a.kind !== 'response' || a.status === 429 || a.status === 500 || a.status === 503;

/**
 * Ask Gemini for JSON shaped like { text: string }. Returns a friendly ApiResult either way.
 *
 * The first model gets about 6s. If it times out or returns 429/500/503, the backup model
 * gets whatever is left of the 12s total.
 */
export async function askGemini(prompt: string, opts: GeminiOptions = {}): Promise<ApiResult> {
  const key = apiKey();
  if (!key) return { status: 503, body: { error: UNAVAILABLE } };

  const first = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  const doFetch = opts.fetchImpl ?? fetch;
  const totalMs = opts.totalTimeoutMs ?? TOTAL_TIMEOUT_MS;
  const firstMs = Math.min(opts.firstTimeoutMs ?? FIRST_TIMEOUT_MS, totalMs);
  const started = Date.now();

  let result = await attempt(first, prompt, key, firstMs, doFetch);
  const leftMs = totalMs - (Date.now() - started);
  if (shouldRetry(result) && BACKUP_MODEL !== first && leftMs >= 500) {
    result = await attempt(BACKUP_MODEL, prompt, key, leftMs, doFetch);
  }
  return toApiResult(result);
}

function toApiResult(a: Attempt): ApiResult {
  if (a.kind === 'timeout') return { status: 504, body: { error: 'The AI took too long to answer. Try again in a moment.' } };
  if (a.kind === 'network') return { status: 502, body: { error: "Couldn't reach the AI service." } };
  if (a.status === 429) return { status: 429, body: { error: 'The AI is busy right now (free-tier limit). Try again in a minute.' } };
  if (a.status === 400 || a.status === 401 || a.status === 403) {
    return { status: 502, body: { error: 'The AI service rejected the request. Check the API key.' } };
  }
  if (a.status < 200 || a.status >= 300) return { status: 502, body: { error: 'The AI service had a problem. Try again later.' } };
  const text = extractText(a.data);
  if (text === null) return { status: 502, body: { error: 'The AI sent back something unexpected. Try again.' } };
  return { status: 200, body: { text } };
}

/** Pull `text` out of a generateContent response whose part is JSON like {"text": "..."}. */
export function extractText(data: unknown): string | null {
  try {
    const parts = (data as { candidates?: { content?: { parts?: { text?: unknown; thought?: unknown }[] } }[] })
      ?.candidates?.[0]?.content?.parts;
    if (!Array.isArray(parts)) return null;
    const raw = parts
      .filter((p) => typeof p.text === 'string' && !p.thought)
      .map((p) => p.text as string)
      .join('')
      .trim()
      .replace(/^```(?:json)?\s*|\s*```$/g, '');
    const parsed: unknown = JSON.parse(raw);
    const text = (parsed as { text?: unknown })?.text;
    if (typeof text !== 'string') return null;
    const clean = text.replace(/\s+/g, ' ').trim();
    return clean && clean.length <= MAX_TEXT ? clean : null;
  } catch {
    return null;
  }
}

/** Run a handler, turning InputErrors into 400s. */
export async function handle(req: Request, run: (body: unknown) => Promise<ApiResult>): Promise<Response> {
  try {
    if (req.method !== 'POST') return json({ status: 405, body: { error: 'Use POST.' } });
    return json(await run(await readJson(req)));
  } catch (err) {
    if (err instanceof InputError) return json({ status: 400, body: { error: err.message } });
    return json({ status: 500, body: { error: 'Something went wrong on the server.' } });
  }
}

export const countWords = (s: string) => (s.trim() ? s.trim().split(/\s+/).length : 0);
