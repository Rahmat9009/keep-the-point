import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as setupPOST, setupPrompt } from '../api/setup';
import { UNAVAILABLE } from '../api/_gemini';

const FAKE_KEY = 'test-key-not-real-123';

const req = (body: unknown) =>
  new Request('http://localhost/api/setup', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });

/** A Gemini reply whose JSON part is `payload`. */
const geminiJson = (payload: unknown) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] }), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

const sentences = ['Hi everyone.', 'School should start later.', 'Teens need 8.5 hours of sleep.', 'Some say it costs money.', 'Thanks!'];
const good = { sentences, rubric: 'Must include: claim, evidence, counterargument, conclusion' };
const reply = {
  cards: [
    { start: 1, end: 2, title: 'Hook and claim', points: ['Claim'] },
    { start: 3, end: 3, title: 'Sleep research', points: ['Evidence'] },
    { start: 4, end: 5, title: 'Counterargument and close', points: ['Counterargument', 'Conclusion'] },
  ],
  points: ['Claim', 'Evidence', 'Counterargument', 'Conclusion'],
};

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
});

async function call(request: Request) {
  const res = await setupPOST(request);
  return { status: res.status, body: (await res.json()) as Record<string, unknown>, trace: res.headers.get('x-ai-trace') };
}

describe('POST /api/setup', () => {
  it('returns the grouping and sends numbered sentences, the rubric and a JSON schema', async () => {
    fetchMock.mockResolvedValue(geminiJson(reply));
    const { status, body, trace } = await call(req(good));
    expect(status).toBe(200);
    expect(body).toEqual(reply);
    expect(trace).toMatch(/^gemini-3\.5-flash-lite 200 \d+ms$/);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).not.toContain(FAKE_KEY);
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    const sent = JSON.parse(init.body as string);
    expect(sent.generationConfig.temperature).toBe(0.2);
    expect(sent.generationConfig.responseJsonSchema.required).toEqual(['cards', 'points']);
    const prompt: string = sent.contents[0].parts[0].text;
    expect(prompt).toContain('3. Teens need 8.5 hours of sleep.');
    expect(prompt).toContain('Must include: claim, evidence, counterargument, conclusion');
    expect(prompt).toContain('Never rewrite');
    expect(prompt).toContain('cover every sentence from 1 to 5');
  });

  it('asks for no points when there is no rubric', () => {
    const prompt = setupPrompt({ sentences, rubric: '' });
    expect(prompt).toContain('There is no rubric');
    expect(prompt).not.toContain('rubric or assignment (between the lines)');
  });

  it.each([
    ['missing sentences', { rubric: '' }],
    ['an empty list', { sentences: [] }],
    ['a blank sentence', { sentences: ['Hi.', '  '] }],
    ['a non-string sentence', { sentences: ['Hi.', 5] }],
    ['a script over 6,000 characters', { sentences: Array.from({ length: 61 }, () => 'a'.repeat(99) + '.') }],
    ['more than 400 sentences', { sentences: Array.from({ length: 401 }, () => 'Hi.') }],
    ['a rubric over 2,000 characters', { sentences, rubric: 'r'.repeat(2001) }],
    ['a non-string rubric', { sentences, rubric: ['claim'] }],
    ['an unknown field', { ...good, apiKey: 'x' }],
    ['an array', [good]],
    ['not JSON', '{oops'],
  ])('rejects %s with 400 and does not call Gemini', async (_name, body) => {
    const { status, body: res } = await call(req(body));
    expect(status).toBe(400);
    expect(typeof res.error).toBe('string');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts a script of exactly 6,000 characters and a 2,000-character rubric', async () => {
    fetchMock.mockResolvedValue(geminiJson({ cards: [{ start: 1, end: 60, title: 'All', points: [] }], points: [] }));
    const long = Array.from({ length: 60 }, () => 'a'.repeat(99)); // 60 × 99 + 59 spaces = 5,999
    const { status } = await call(req({ sentences: [...long.slice(0, 59), 'a'.repeat(100)], rubric: 'r'.repeat(2000) }));
    expect(status).toBe(200);
  });

  it.each([
    ['no cards', { cards: [], points: [] }],
    ['13 cards', { cards: Array.from({ length: 13 }, (_, i) => ({ start: i + 1, end: i + 1, title: 'x', points: [] })), points: [] }],
    ['a non-integer range', { cards: [{ start: 1, end: 'five', title: 'x', points: [] }], points: [] }],
    ['more than 6 points', { cards: reply.cards, points: ['a', 'b', 'c', 'd', 'e', 'f', 'g'] }],
    ['a missing title', { cards: [{ start: 1, end: 5, points: [] }], points: [] }],
    ['not JSON at all', 'cards: 1-5'],
  ])('turns a malformed AI reply (%s) into a 502', async (_name, payload) => {
    fetchMock.mockResolvedValue(
      typeof payload === 'string'
        ? new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: payload }] } }] }), { status: 200 })
        : geminiJson(payload),
    );
    const { status, body } = await call(req(good));
    expect(status).toBe(502);
    expect(body.error).toMatch(/unexpected/);
  });

  it('tries the backup model when the first is overloaded', async () => {
    fetchMock.mockResolvedValueOnce(new Response('{}', { status: 503 })).mockResolvedValueOnce(geminiJson(reply));
    const { status, body, trace } = await call(req(good));
    expect(status).toBe(200);
    expect(body).toEqual(reply);
    expect(trace).toMatch(/gemini-3\.5-flash-lite 503 .*gemini-3\.6-flash 200/);
  });

  it('says the AI is unavailable without a key', async () => {
    vi.stubEnv('GEMINI_API_KEY', '');
    const { status, body } = await call(req(good));
    expect(status).toBe(503);
    expect(body.error).toBe(UNAVAILABLE);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects GET', async () => {
    const res = await setupPOST(new Request('http://localhost/api/setup'));
    expect(res.status).toBe(405);
  });
});
