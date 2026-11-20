/**
 * Shared helpers for the AI endpoints (api/shorten.ts, api/bridge.ts).
 * Files starting with "_" are not deployed as routes by Vercel.
 *
 * The Gemini API key is read from process.env.GEMINI_API_KEY on the server only.
 * It is never logged, echoed back, or sent anywhere except Google's API.
 */

/** Current stable Flash model on the free tier. Override with GEMINI_MODEL if Google retires it. */
export const DEFAULT_MODEL = 'gemini-3.8-flash';
/** Faster, lighter free-tier model tried once when the main model is overloaded. */
export const FALLBACK_MODEL = 'gemini-3.5-flash-lite';
export const TIMEOUT_MS = 10_000;
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
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

function apiKey(): string | null {
  const key = process.env.GEMINI_API_KEY?.trim();
  return key && key !== PLACEHOLDER_KEY ? key : null;
}

/**
 * Ask Gemini for JSON shaped like { text: string }. Returns a friendly ApiResult either way.
 */
export async function askGemini(prompt: string, opts: GeminiOptions = {}): Promise<ApiResult> {
  const key = apiKey();
  if (!key) return { status: 503, body: { error: UNAVAILABLE } };

  const model = process.env.GEMINI_MODEL?.trim() || DEFAULT_MODEL;
  // If the main model is overloaded (500/503), try the lighter one once, within the same time limit.
  const models = model === FALLBACK_MODEL ? [model] : [model, FALLBACK_MODEL];
  const doFetch = opts.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TIMEOUT_MS);

  try {
    let res!: Response;
    for (const m of models) {
      res = await doFetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(m)}:generateContent`, {
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
            thinkingConfig: { thinkingLevel: m === FALLBACK_MODEL ? 'minimal' : 'low' },
          },
        }),
        signal: controller.signal,
      });
      if (res.status !== 500 && res.status !== 503) break;
    }

    if (res.status === 429) return { status: 429, body: { error: 'The AI is busy right now (free-tier limit). Try again in a minute.' } };
    if (res.status === 400 || res.status === 401 || res.status === 403) {
      return { status: 502, body: { error: 'The AI service rejected the request. Check the API key.' } };
    }
    if (!res.ok) return { status: 502, body: { error: 'The AI service had a problem. Try again later.' } };

    const text = extractText(await res.json());
    if (text === null) return { status: 502, body: { error: 'The AI sent back something unexpected. Try again.' } };
    return { status: 200, body: { text } };
  } catch (err) {
    if (controller.signal.aborted) return { status: 504, body: { error: 'The AI took too long to answer (over 10s).' } };
    void err; // never log: errors could include request details
    return { status: 502, body: { error: "Couldn't reach the AI service." } };
  } finally {
    clearTimeout(timer);
  }
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
