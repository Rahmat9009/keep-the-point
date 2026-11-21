import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as setupPOST, minCards, setupProblems, setupPrompt } from '../api/setup';
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
    { start: 1, end: 1, title: 'Greeting', points: [] },
    { start: 2, end: 2, title: 'Main claim', points: ['Claim'] },
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
    expect(prompt).toContain('3. (6 words) Teens need 8.5 hours of sleep.');
    expect(prompt).toContain('Make at least 1 cards');
    expect(prompt).toContain('Tag a card with a point ONLY if that card itself states the point');
    expect(prompt).toContain('greetings and introductions, hooks, personal stories');
    expect(fetchMock).toHaveBeenCalledTimes(1); // a good answer needs no retry
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


/* ---------- Checking the answer and retrying once ---------- */

/** 13 sentences of 20 words: 260 words, so at least 5 cards. */
const longSentences = Array.from({ length: 13 }, (_, i) => `Sentence ${i + 1} ` + Array.from({ length: 18 }, () => 'word').join(' ') + '.');
const longInput = { sentences: longSentences, rubric: 'Must include: claim, evidence, counterargument, conclusion' };
const grouping = (ranges: [number, number][], tagged: boolean[]) => ({
  cards: ranges.map(([start, end], i) => ({ start, end, title: `Card ${i + 1}`, points: tagged[i] ? ['Claim'] : [] })),
  points: ['Claim', 'Evidence', 'Counterargument', 'Conclusion'],
});
const twoCards = grouping([[1, 6], [7, 13]], [true, false]);
const fiveCards = grouping([[1, 2], [3, 5], [6, 8], [9, 11], [12, 13]], [false, true, true, true, true]);
const fiveAllTagged = grouping([[1, 2], [3, 5], [6, 8], [9, 11], [12, 13]], [true, true, true, true, true]);
const promptOf = (i: number) => JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).contents[0].parts[0].text as string;

describe('setup answer checks', () => {
  it('works out the minimum number of cards: words ÷ 60, rounded up, 1 to 12', () => {
    expect(minCards(longSentences)).toBe(5); // 260 words
    expect(minCards(['Hi there.'])).toBe(1);
    expect(minCards(Array.from({ length: 40 }, () => Array.from({ length: 30 }, () => 'w').join(' ')))).toBe(12); // 1,200 words
    expect(minCards(['one two three four five six seven', Array.from({ length: 200 }, () => 'w').join(' ')])).toBe(2); // capped at the sentence count
  });

  it('spots too few cards, every card tagged, and broken ranges', () => {
    expect(setupProblems(fiveCards, longInput)).toEqual([]);
    expect(setupProblems(twoCards, longInput).join(' ')).toContain('make at least 5');
    expect(setupProblems(fiveAllTagged, longInput)[0]).toContain('Every card is tagged');
    expect(setupProblems(grouping([[1, 2], [4, 13]], [false, true]), longInput)[0]).toContain('no gaps');
    expect(setupProblems(fiveAllTagged, { ...longInput, rubric: '' })).toEqual([]); // no rubric: tags don't matter
    // 5 cards, but card 2 holds sentences 3-7 (100 words): too big
    expect(setupProblems(grouping([[1, 2], [3, 7], [8, 9], [10, 11], [12, 13]], [false, true, true, true, true]), longInput)[0]).toContain('Card 2 has 100 words');
    // one long sentence on its own is fine
    expect(setupProblems(grouping([[1, 1]], [false]), { sentences: [Array.from({ length: 95 }, () => 'w').join(' ')], rubric: '' })).toEqual([]);
    // 60 words over 3 sentences is within the limit; 80 words over 4 is not
    expect(setupProblems(grouping([[1, 3], [4, 4], [5, 5], [6, 6], [7, 13]], [false, true, true, true, false]), longInput).join(' ')).toContain('Card 5 has 140 words');
    expect(setupProblems(grouping([[1, 3], [4, 6], [7, 9], [10, 11], [12, 13]], [false, true, true, true, true]), longInput)).toEqual([]);
  });
});

describe('POST /api/setup retries once', () => {
  it('retries with a correction when there are too few cards, and uses the corrected answer', async () => {
    fetchMock.mockResolvedValueOnce(geminiJson(twoCards)).mockResolvedValueOnce(geminiJson(fiveCards));
    const { status, body, trace } = await call(req(longInput));
    expect(status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(body).toEqual({ ...fiveCards, retried: true });
    expect(promptOf(1)).toContain('Your previous answer needs fixing');
    expect(promptOf(1)).toContain('You made 2 cards; make at least 5');
    expect(trace).toMatch(/^gemini-3\.5-flash-lite 200 \d+ms, retry gemini-3\.5-flash-lite 200 \d+ms$/);
  });

  it('retries when a card is far over the size limit', async () => {
    const tooBig = grouping([[1, 2], [3, 7], [8, 9], [10, 11], [12, 13]], [false, true, true, true, true]);
    fetchMock.mockResolvedValueOnce(geminiJson(tooBig)).mockResolvedValueOnce(geminiJson(fiveCards));
    const { body } = await call(req(longInput));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toContain('Card 2 has 100 words');
    expect(body).toEqual({ ...fiveCards, retried: true });
  });

  it('retries when every card is tagged', async () => {
    fetchMock.mockResolvedValueOnce(geminiJson(fiveAllTagged)).mockResolvedValueOnce(geminiJson(fiveCards));
    const { body } = await call(req(longInput));
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(promptOf(1)).toContain('Every card is tagged');
    expect(body).toEqual({ ...fiveCards, retried: true });
  });

  it('uses the AI answer anyway when the retry is still wrong (only one retry)', async () => {
    fetchMock.mockResolvedValue(geminiJson(twoCards));
    const { status, body } = await call(req(longInput));
    expect(status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((body.cards as unknown[]).length).toBe(2);
  });

  it('keeps the first answer when the retry is worse', async () => {
    const worse = grouping([[1, 6], [7, 13]], [true, true]); // too few cards AND every card tagged
    fetchMock.mockResolvedValueOnce(geminiJson(fiveAllTagged)).mockResolvedValueOnce(geminiJson(worse));
    const { body } = await call(req(longInput));
    expect(body).toEqual(fiveAllTagged);
  });

  it('keeps the first answer when the retry fails', async () => {
    fetchMock
      .mockResolvedValueOnce(geminiJson(twoCards))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}', { status: 503 }));
    const { status, body, trace } = await call(req(longInput));
    expect(status).toBe(200);
    expect(body).toEqual(twoCards);
    expect(trace).toContain('retry gemini-3.5-flash-lite 503');
  });

  it('does not retry a malformed answer (the browser falls back to paragraphs)', async () => {
    fetchMock.mockResolvedValue(geminiJson({ cards: [], points: [] }));
    const { status } = await call(req(longInput));
    expect(status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the low temperature on both tries', async () => {
    fetchMock.mockResolvedValueOnce(geminiJson(twoCards)).mockResolvedValueOnce(geminiJson(fiveCards));
    await call(req(longInput));
    for (const i of [0, 1]) expect(JSON.parse((fetchMock.mock.calls[i][1] as RequestInit).body as string).generationConfig.temperature).toBe(0.2);
  });
});
