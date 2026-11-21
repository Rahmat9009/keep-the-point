/** Browser side of the AI features. The key never reaches the browser: these call our own /api routes. */

export const AI_NOTICE = "AI suggestions are sent to Google Gemini. Don't include private information.";
export const SHORTEN_UNAVAILABLE = 'AI unavailable. Write your own short version.';
export const BRIDGE_UNAVAILABLE = 'AI unavailable. Write your own bridge line.';

/** How long the browser waits before showing "AI unavailable" (the server gives up after 12s). */
export const CLIENT_TIMEOUT_MS = 15_000;

/** Button content while waiting for the AI: a spinner and "Thinking…". */
export const THINKING_HTML = '<span class="spinner" aria-hidden="true"></span>Thinking…';

export type AiResult = { ok: true; text: string } | { ok: false; message: string };

export interface ShortenRequest {
  text: string;
  targetSeconds: number;
  title: string;
  requiredPoints: string[];
}

export interface BridgeRequest {
  before: string | null;
  cut: string[];
  after: string;
  title: string;
}

/** About half the card's time, at least 3 seconds. */
export function shortenTarget(seconds: number): number {
  return Math.max(3, Math.round(seconds / 2));
}

export const requestShorten = (req: ShortenRequest) => post('/api/shorten', req, SHORTEN_UNAVAILABLE);
export const requestBridge = (req: BridgeRequest) => post('/api/bridge', req, BRIDGE_UNAVAILABLE);

async function post(url: string, body: unknown, unavailable: string, fetchImpl: typeof fetch = fetch): Promise<AiResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as { text?: unknown; error?: unknown } | null;
    if (res.ok && typeof data?.text === 'string' && data.text.trim()) return { ok: true, text: data.text.trim() };
    // The server's own "AI unavailable" (no key) adds nothing; other errors (busy, timeout) are worth showing.
    const detail = typeof data?.error === 'string' && !data.error.startsWith('AI unavailable') ? ` (${data.error})` : '';
    return { ok: false, message: `${unavailable}${detail}` };
  } catch {
    return { ok: false, message: unavailable };
  } finally {
    clearTimeout(timer);
  }
}

/* ---------- Smart setup ---------- */

export const SETUP_UNAVAILABLE = 'AI unavailable.';
/** The setup route may take up to 18s on the server (it groups a whole script and may retry once). */
export const SETUP_CLIENT_TIMEOUT_MS = 22_000;

export interface SetupRequest {
  sentences: string[];
  rubric: string;
}

export interface SetupReply {
  cards: { start: number; end: number; title?: string; points?: string[] }[];
  points: string[];
}

export type SetupResultMsg = { ok: true; data: SetupReply } | { ok: false; message: string };

/** Ask /api/setup how to group the sentences. Never throws. */
export async function requestSetup(req: SetupRequest, fetchImpl: typeof fetch = fetch): Promise<SetupResultMsg> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SETUP_CLIENT_TIMEOUT_MS);
  try {
    const res = await fetchImpl('/api/setup', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(req),
      signal: controller.signal,
    });
    const data = (await res.json().catch(() => null)) as (SetupReply & { error?: unknown }) | null;
    if (res.ok && data && Array.isArray(data.cards) && Array.isArray(data.points)) return { ok: true, data };
    const detail = typeof data?.error === 'string' && !data.error.startsWith('AI unavailable') ? ` (${data.error})` : '';
    return { ok: false, message: `${SETUP_UNAVAILABLE}${detail}` };
  } catch {
    return { ok: false, message: SETUP_UNAVAILABLE };
  } finally {
    clearTimeout(timer);
  }
}
