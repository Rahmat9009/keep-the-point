import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as bridgePOST } from '../api/bridge';
import { POST as shortenPOST } from '../api/shorten';
import { extractText, UNAVAILABLE } from '../api/_gemini';

const FAKE_KEY = 'test-key-not-real-123';

const req = (body: unknown, method = 'POST') =>
  new Request('http://localhost/api/x', {
    method,
    headers: { 'content-type': 'application/json' },
    body: method === 'POST' ? (typeof body === 'string' ? body : JSON.stringify(body)) : undefined,
  });

const geminiReply = (text: string) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ text }) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const goodShorten = { text: 'My grandma ran a bakery for 30 years.', targetSeconds: 8, title: 'Sourdough', requiredPoints: ['Method'] };
const goodBridge = { before: 'Research question', cut: ["Grandma's bakery story"], after: 'Method', title: 'Sourdough' };

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.stubEnv('GEMINI_API_KEY', FAKE_KEY);
  vi.stubEnv('GEMINI_MODEL', '');
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

async function call(handler: (r: Request) => Promise<Response>, request: Request) {
  const res = await handler(request);
  return { status: res.status, body: (await res.json()) as { text?: string; error?: string } };
}

describe('POST /api/shorten', () => {
  it('returns the short version and sends the key only in a header', async () => {
    fetchMock.mockResolvedValue(geminiReply('Grandma baked for 30 years.'));
    const { status, body } = await call(shortenPOST, req(goodShorten));
    expect(status).toBe(200);
    expect(body).toEqual({ text: 'Grandma baked for 30 years.' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain(':generateContent');
    expect(url).not.toContain(FAKE_KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    const sent = JSON.parse(init.body as string);
    expect(sent.generationConfig.responseMimeType).toBe('application/json');
    const prompt: string = sent.contents[0].parts[0].text;
    expect(prompt).toContain('about 8 seconds');
    expect(prompt).toContain('Keep every fact, name and number');
    expect(prompt).toContain('Do not add any new facts');
  });

  it.each([
    ['missing text', { ...goodShorten, text: undefined }],
    ['blank text', { ...goodShorten, text: '   ' }],
    ['text over 1,000 characters', { ...goodShorten, text: 'a'.repeat(1001) }],
    ['non-integer target', { ...goodShorten, targetSeconds: 2.5 }],
    ['zero target', { ...goodShorten, targetSeconds: 0 }],
    ['points not a list', { ...goodShorten, requiredPoints: 'Method' }],
    ['unknown field', { ...goodShorten, apiKey: 'x' }],
    ['an array', [goodShorten]],
  ])('rejects %s with 400 and does not call Gemini', async (_name, body) => {
    const { status, body: res } = await call(shortenPOST, req(body));
    expect(status).toBe(400);
    expect(typeof res.error).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts exactly 1,000 characters', async () => {
    fetchMock.mockResolvedValue(geminiReply('Short.'));
    const { status } = await call(shortenPOST, req({ ...goodShorten, text: 'a'.repeat(1000) }));
    expect(status).toBe(200);
  });

  it('rejects invalid JSON and non-POST methods', async () => {
    expect((await call(shortenPOST, req('{not json'))).status).toBe(400);
    expect((await call(shortenPOST, req(null, 'GET'))).status).toBe(405);
  });

  it('says "AI unavailable" when there is no key (or only the placeholder)', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    expect(await call(shortenPOST, req(goodShorten))).toEqual({ status: 503, body: { error: UNAVAILABLE } });
    vi.stubEnv('GEMINI_API_KEY', 'paste-your-key-here');
    expect(await call(shortenPOST, req(goodShorten))).toEqual({ status: 503, body: { error: UNAVAILABLE } });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('turns Gemini errors into friendly messages without leaking details', async () => {
    fetchMock.mockResolvedValueOnce(new Response(`bad key ${FAKE_KEY}`, { status: 403 }));
    const forbidden = await call(shortenPOST, req(goodShorten));
    expect(forbidden.status).toBe(502);
    expect(JSON.stringify(forbidden.body)).not.toContain(FAKE_KEY);
    expect(fetchMock).toHaveBeenCalledTimes(1); // a rejected request is not retried

    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 429 })).mockResolvedValueOnce(new Response('quota', { status: 429 }));
    const busy = await call(shortenPOST, req(goodShorten));
    expect(busy.status).toBe(429);
    expect(busy.body.error).toMatch(/busy/);

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 })).mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect((await call(shortenPOST, req(goodShorten))).status).toBe(502);

    fetchMock.mockRejectedValueOnce(new TypeError('network down')).mockRejectedValueOnce(new TypeError('network down'));
    const offline = await call(shortenPOST, req(goodShorten));
    expect(offline.status).toBe(502);
    expect(offline.body.error).toMatch(/reach/);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    expect((await call(shortenPOST, req(goodShorten))).status).toBe(502);
  });
});

describe('model choice, timeouts and backup', () => {
  /** A fetch that never answers until its signal aborts. */
  const hang = (_url: string, init: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    });
  const sentModel = (i: number) => /models\/([^:]+):/.exec(fetchMock.mock.calls[i][0] as string)![1];
  const sentThinking = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).generationConfig.thinkingConfig;

  /** Resolve `pending` and report whether it had already settled. */
  async function settledYet(pending: Promise<unknown>) {
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    await Promise.resolve();
    return settled;
  }

  it('uses gemini-3.5-flash-lite first, with thinking at its minimum', async () => {
    fetchMock.mockResolvedValue(geminiReply('Short.'));
    await call(shortenPOST, req(goodShorten));
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentModel(0)).toBe('gemini-3.5-flash-lite');
    expect(sentThinking(0)).toEqual({ thinkingLevel: 'minimal' });
  });

  it('GEMINI_MODEL overrides the first model, with that model\'s lowest thinking level', async () => {
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.8-flash');
    fetchMock.mockResolvedValue(geminiReply('Short.'));
    await call(shortenPOST, req(goodShorten));
    expect(sentModel(0)).toBe('gemini-3.8-flash');
    expect(sentThinking(0)).toEqual({ thinkingLevel: 'low' }); // 3.8 does not accept "minimal"
  });

  it('if GEMINI_MODEL is the backup model, the default model becomes the backup', async () => {
    vi.useFakeTimers();
    vi.stubEnv('GEMINI_MODEL', 'gemini-3.6-flash');
    fetchMock
      .mockImplementationOnce((_url: string, init: RequestInit) =>
        new Promise<Response>((_r, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
      )
      .mockResolvedValueOnce(geminiReply('From flash-lite.'));
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(6_000);
    expect((await pending).body.text).toBe('From flash-lite.');
    expect(sentModel(0)).toBe('gemini-3.6-flash');
    expect(sentModel(1)).toBe('gemini-3.5-flash-lite');
  });

  it.each([429, 500, 503])('tries the backup (gemini-3.6-flash, minimal thinking) after a %i', async (code) => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: code })).mockResolvedValueOnce(geminiReply('From the backup.'));
    const { status, body } = await call(shortenPOST, req(goodShorten));
    expect(status).toBe(200);
    expect(body.text).toBe('From the backup.');
    expect(sentModel(1)).toBe('gemini-3.6-flash');
    expect(sentThinking(1)).toEqual({ thinkingLevel: 'minimal' });
  });

  it('tries the backup when the first model is unreachable', async () => {
    fetchMock.mockRejectedValueOnce(new TypeError('network down')).mockResolvedValueOnce(geminiReply('From the backup.'));
    expect((await call(shortenPOST, req(goodShorten))).body.text).toBe('From the backup.');
  });

  it('gives the first model 6s, then switches to the backup', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(hang).mockResolvedValueOnce(geminiReply('From the backup.'));
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(5_999);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    const { status, body } = await pending;
    expect(status).toBe(200);
    expect(body.text).toBe('From the backup.');
    expect(sentModel(1)).toBe('gemini-3.6-flash');
  });

  it('the whole call finishes within 12s when both models hang', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(hang);
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(11_999);
    expect(await settledYet(pending)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { status, body } = await pending;
    expect(status).toBe(504);
    expect(body.error).toMatch(/too long/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('the backup only gets the time that is left of the 12s', async () => {
    vi.useFakeTimers();
    // First model takes 4s to say it is overloaded; the backup then hangs.
    fetchMock
      .mockImplementationOnce(() => new Promise<Response>((resolve) => setTimeout(() => resolve(new Response('{}', { status: 503 })), 4_000)))
      .mockImplementationOnce(hang);
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(11_999);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await settledYet(pending)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect((await pending).status).toBe(504);
  });

  it('does not retry when the first model answers in time', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementationOnce(() => new Promise<Response>((resolve) => setTimeout(() => resolve(geminiReply('Just in time.')), 5_900)));
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(5_900);
    expect((await pending).body.text).toBe('Just in time.');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports which models were tried in an x-ai-trace header (no secrets)', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(geminiReply('Short.'));
    const res = await shortenPOST(req(goodShorten));
    const trace = res.headers.get('x-ai-trace')!;
    expect(trace).toMatch(/^gemini-3\.5-flash-lite 503 \d+ms, gemini-3\.6-flash 200 \d+ms$/);
    expect(trace).not.toContain(FAKE_KEY);
  });

  it('bridge uses the same fallback', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(geminiReply('So here is how I tested it.'));
    const { status, body } = await call(bridgePOST, req(goodBridge));
    expect(status).toBe(200);
    expect(body.text).toBe('So here is how I tested it.');
  });
});

describe('POST /api/bridge', () => {
  it('returns one linking sentence', async () => {
    fetchMock.mockResolvedValue(geminiReply('So here is how I tested it.'));
    const { status, body } = await call(bridgePOST, req(goodBridge));
    expect(status).toBe(200);
    expect(body.text).toBe('So here is how I tested it.');
    const prompt: string = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string).contents[0].parts[0].text;
    expect(prompt).toContain('at most 15 words');
    expect(prompt).toContain('"Method"');
  });

  it('allows no card before the gap (start of the talk)', async () => {
    fetchMock.mockResolvedValue(geminiReply('Let me start with my question.'));
    expect((await call(bridgePOST, req({ ...goodBridge, before: null }))).status).toBe(200);
  });

  it('rejects suggestions over 15 words', async () => {
    fetchMock.mockResolvedValue(geminiReply('one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen'));
    const { status, body } = await call(bridgePOST, req(goodBridge));
    expect(status).toBe(502);
    expect(body.error).toMatch(/too long/);
  });

  it.each([
    ['no cut cards', { ...goodBridge, cut: [] }],
    ['cut not a list', { ...goodBridge, cut: 'Story' }],
    ['a cut card over 1,000 characters', { ...goodBridge, cut: ['x'.repeat(1001)] }],
    ['missing card after', { ...goodBridge, after: undefined }],
    ['card before over 1,000 characters', { ...goodBridge, before: 'x'.repeat(1001) }],
    ['unknown field', { ...goodBridge, extra: true }],
  ])('rejects %s with 400', async (_name, body) => {
    expect((await call(bridgePOST, req(body))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('extractText', () => {
  it('reads JSON text parts, skipping thoughts and code fences', () => {
    const data = { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: '```json\n{"text": "Hi  there"}\n```' }] } }] };
    expect(extractText(data)).toBe('Hi there');
    expect(extractText({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })).toBeNull();
    expect(extractText({ candidates: [{ content: { parts: [{ text: '{"text": ""}' }] } }] })).toBeNull();
  });
});
