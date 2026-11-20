import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestShorten, SHORTEN_UNAVAILABLE, shortenTarget } from './ai';
import { cueSheetHtml } from './cueView';
import { sampleTalk } from './sample';
import { parseSavedState } from './storage';

describe('shortenTarget', () => {
  it('asks for about half the time, at least 3s', () => {
    expect(shortenTarget(46)).toBe(23);
    expect(shortenTarget(4)).toBe(3);
  });
});

describe('saved short versions and bridges', () => {
  it('keeps valid short versions and bridge lines, drops bad ones', () => {
    const saved = parseSavedState({
      limit: '2:00',
      talk: {
        title: 'T',
        requiredPoints: [],
        cards: [
          { id: 'a', text: 'A', seconds: 30, tags: [], locked: false, short: { text: 'a', seconds: 9.6, estimated: true } },
          { id: 'b', text: 'B', seconds: 30, tags: [], locked: false, short: { text: '  ', seconds: 5 } },
          { id: 'c', text: 'C', seconds: 30, tags: [], locked: false, short: { text: 'c', seconds: 0 } },
        ],
        bridges: { 'a>b>c': 'So, next.', bad: 42 },
      },
    })!;
    expect(saved.talk.cards[0].short).toEqual({ text: 'a', seconds: 10, estimated: true });
    expect(saved.talk.cards[1].short).toBeUndefined();
    expect(saved.talk.cards[2].short).toBeUndefined();
    expect(saved.talk.bridges).toEqual({ 'a>b>c': 'So, next.' });
  });
});

describe('cue sheet with short versions and bridges', () => {
  it('shows the bakery story shortened at 2:00', () => {
    const html = cueSheetHtml(sampleTalk, 120, false);
    expect(html).toContain('Shortened: 46s → 8s');
    expect(html).toContain('Grandma always let her dough rise by the warm oven.');
    expect(html).not.toContain('Cut here');
  });

  it('prints a bridge line in italics at the top of the next card, with its seconds', () => {
    const noShort = { ...sampleTalk, cards: sampleTalk.cards.map(({ short: _s, ...c }) => c), bridges: { '2>3>4': 'Here is how I tested it.' } };
    const html = cueSheetHtml(noShort, 120, false);
    const bridgeAt = html.indexOf('<em data-ref="bridge-text">Here is how I tested it.</em>');
    expect(bridgeAt).toBeGreaterThan(html.indexOf('Cut here'));
    expect(bridgeAt).toBeLessThan(html.indexOf('>Method<'));
    expect(html).toContain('~3s');
    expect(html).toContain('bridge lines add ~3s');
  });

  it('offers the AI bridge button and privacy note on screen only', () => {
    const noShort = { ...sampleTalk, cards: sampleTalk.cards.map(({ short: _s, ...c }) => c) };
    expect(cueSheetHtml(noShort, 120, true)).toContain('✨ Suggest bridge');
    expect(cueSheetHtml(noShort, 120, true)).toContain('sent to Google Gemini');
    expect(cueSheetHtml(noShort, 120, false)).not.toContain('Suggest bridge');
  });
});

describe('browser wait for the AI', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });
  const req = { text: 'Hook', targetSeconds: 6, title: 'T', requiredPoints: [] };

  it('waits up to 15s, then shows "AI unavailable"', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))),
    );
    let done: unknown = null;
    void requestShorten(req).then((r) => (done = r));
    await vi.advanceTimersByTimeAsync(14_999);
    expect(done).toBeNull();
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toEqual({ ok: false, message: SHORTEN_UNAVAILABLE });
  });

  it('shows the server reason after "AI unavailable" (e.g. a server timeout)', async () => {
    vi.stubGlobal('fetch', async () => new Response(JSON.stringify({ error: 'The AI took too long to answer. Try again in a moment.' }), { status: 504 }));
    expect(await requestShorten(req)).toEqual({ ok: false, message: `${SHORTEN_UNAVAILABLE} (The AI took too long to answer. Try again in a moment.)` });
  });
});
