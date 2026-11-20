import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as bridgePOST } from './bridge';
import { POST as shortenPOST } from './shorten';
import { extractText, UNAVAILABLE } from './_gemini';

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

    fetchMock.mockResolvedValueOnce(new Response('quota', { status: 429 }));
    const busy = await call(shortenPOST, req(goodShorten));
    expect(busy.status).toBe(429);
    expect(busy.body.error).toMatch(/busy/);

    fetchMock.mockResolvedValueOnce(new Response('oops', { status: 500 }));
    expect((await call(shortenPOST, req(goodShorten))).status).toBe(502);

    fetchMock.mockRejectedValueOnce(new TypeError('network down'));
    const offline = await call(shortenPOST, req(goodShorten));
    expect(offline.status).toBe(502);
    expect(offline.body.error).toMatch(/reach/);

    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ candidates: [] }), { status: 200 }));
    expect((await call(shortenPOST, req(goodShorten))).status).toBe(502);
  });

  it('gives up after 10 seconds', async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
        }),
    );
    const pending = call(shortenPOST, req(goodShorten));
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const { status, body } = await pending;
    expect(status).toBe(504);
    expect(body.error).toMatch(/too long/);
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
