import { describe, expect, it } from 'vitest';
import { sampleTalk } from './sample';
import { selectCards, shortenedLabel, spokenCard, type FitResult, type NoFitResult } from './select';
import { formatTime, parseTime } from './time';
import type { Card } from './types';

const { requiredPoints } = sampleTalk;
/** The sample without its demo short version (the original two-way behaviour). */
const cards: Card[] = sampleTalk.cards.map(({ short: _short, ...c }) => c);
const ids = (list: Card[]) => list.map((c) => c.id);

describe('sample talk', () => {
  it('is 8 cards and 2:38 long', () => {
    expect(cards).toHaveLength(8);
    expect(formatTime(cards.reduce((t, c) => t + c.seconds, 0))).toBe('2:38');
  });
});

describe('selectCards', () => {
  it('budget 2:00 cuts only the bakery story: 1:52, 8s spare', () => {
    const result = selectCards(cards, requiredPoints, 120) as FitResult;
    expect(result.fits).toBe(true);
    expect(result.cut.map((c) => c.card.id)).toEqual(['3']);
    expect(result.cut[0].reason).toBe('Optional, priority 1 — saves 46s');
    expect(ids(result.kept)).toEqual(['1', '2', '4', '5', '6', '7', '8']);
    expect(formatTime(result.totalSeconds)).toBe('1:52');
    expect(result.spareSeconds).toBe(8);
  });

  it('budget 1:00 cannot fit; shortest valid talk is 1:08 (cards 2, 4, 6, 8)', () => {
    const result = selectCards(cards, requiredPoints, 60) as NoFitResult;
    expect(result.fits).toBe(false);
    expect(result.shortest).not.toBeNull();
    expect(formatTime(result.shortest!.totalSeconds)).toBe('1:08');
    expect(ids(result.shortest!.cards)).toEqual(['2', '4', '6', '8']);
    expect(result.shortest!.overBySeconds).toBe(8);
  });

  it('bakery story locked, budget 2:00 keeps 2, 3, 4, 6, 8 (1:54)', () => {
    const lockedBakery = cards.map((c) => (c.id === '3' ? { ...c, locked: true } : c));
    const result = selectCards(lockedBakery, requiredPoints, 120) as FitResult;
    expect(result.fits).toBe(true);
    expect(ids(result.kept)).toEqual(['2', '3', '4', '6', '8']);
    expect(formatTime(result.totalSeconds)).toBe('1:54');
    expect(result.cut.map((c) => c.card.title)).toEqual(['Hook', 'Setup details', 'Graph explanation']);
  });

  it('reports which kept card covers each required point', () => {
    const result = selectCards(cards, requiredPoints, 120) as FitResult;
    expect(result.coverage.Question.map((c) => c.title)).toEqual(['Research question']);
    expect(result.coverage.Evidence.map((c) => c.title)).toEqual(['Results']);
  });

  it('keeps the full talk when the budget allows it', () => {
    const result = selectCards(cards, requiredPoints, 158) as FitResult;
    expect(result.cut).toHaveLength(0);
    expect(result.spareSeconds).toBe(0);
  });

  it('returns no shortest talk when a required point has no card at all', () => {
    const result = selectCards(cards, [...requiredPoints, 'Ethics'], 600) as NoFitResult;
    expect(result.fits).toBe(false);
    expect(result.shortest).toBeNull();
    expect(result.uncoverablePoints).toEqual(['Ethics']);
  });

  it('rejects more than 12 cards', () => {
    const many = Array.from({ length: 13 }, (_, i) => ({ ...cards[0], id: String(i) }));
    expect(() => selectCards(many, [], 600)).toThrow(/at most 12/);
  });
});

describe('selectCards with short versions (full / short / cut)', () => {
  const card = (id: string, seconds: number, extra: Partial<Card> = {}): Card => ({ id, text: `Card ${id}`, seconds, tags: [], locked: false, ...extra });
  const short = (seconds: number) => ({ text: 'short', seconds });

  it('sample at 2:00: the bakery short version changes the result from cut to shortened', () => {
    const before = selectCards(cards, requiredPoints, 120) as FitResult;
    expect(before.cut.map((c) => c.card.id)).toEqual(['3']);
    expect(before.shortIds).toEqual([]);
    expect(before.totalSeconds).toBe(112);
    expect(before.spareSeconds).toBe(8);

    const after = selectCards(sampleTalk.cards, requiredPoints, 120) as FitResult;
    expect(after.cut).toEqual([]);
    expect(after.shortIds).toEqual(['3']);
    expect(ids(after.kept)).toEqual(['1', '2', '3', '4', '5', '6', '7', '8']);
    expect(formatTime(after.totalSeconds)).toBe('2:00');
    expect(after.spareSeconds).toBe(0);
    const bakery = sampleTalk.cards[2];
    expect(shortenedLabel(bakery)).toBe('Shortened: 46s → 8s');
    expect(spokenCard(bakery, after.shortIds).seconds).toBe(8);
    expect(spokenCard(bakery, after.shortIds).text).toBe(bakery.short!.text);
  });

  it('prefers FULL over SHORT when the full card fits', () => {
    const r = selectCards([card('a', 30, { priority: 3, short: short(10) })], [], 60) as FitResult;
    expect(r.shortIds).toEqual([]);
    expect(r.totalSeconds).toBe(30);
  });

  it('uses SHORT when FULL does not fit', () => {
    const r = selectCards([card('a', 30, { priority: 3, short: short(10) })], [], 20) as FitResult;
    expect(ids(r.kept)).toEqual(['a']);
    expect(r.shortIds).toEqual(['a']);
    expect(r.totalSeconds).toBe(10);
  });

  it('a short version is worth 60% of the priority', () => {
    // A short (0.6 × 5 = 3) beats a full priority-2 card, but loses to a full priority-4 card.
    const a = card('a', 40, { priority: 5, short: short(10) });
    const r1 = selectCards([a, card('b', 10, { priority: 2 })], [], 10) as FitResult;
    expect(ids(r1.kept)).toEqual(['a']);
    expect(r1.shortIds).toEqual(['a']);
    const r2 = selectCards([a, card('b', 10, { priority: 4 })], [], 10) as FitResult;
    expect(ids(r2.kept)).toEqual(['b']);
    expect(r2.cut.map((c) => c.card.id)).toEqual(['a']);
  });

  it('a tagged card can be SHORT (keeping its tags) but not CUT when nothing else covers its point', () => {
    const r = selectCards([card('m', 30, { tags: ['Method'], short: short(8) }), card('x', 10, { priority: 5 })], ['Method'], 10) as FitResult;
    expect(r.shortIds).toEqual(['m']);
    expect(r.coverage.Method.map((c) => c.id)).toEqual(['m']);
    expect(r.cut.map((c) => c.card.id)).toEqual(['x']);
  });

  it('a tagged card can be cut when another kept card covers its point', () => {
    const r = selectCards(
      [card('m1', 30, { tags: ['Method'], short: short(20) }), card('m2', 10, { tags: ['Method'] })],
      ['Method'],
      15,
    ) as FitResult;
    expect(ids(r.kept)).toEqual(['m2']);
    expect(r.cut[0].reason).toBe('"Method" is still covered by Card m2 — saves 30s');
  });

  it('locked cards are always FULL, even with a short version', () => {
    const r = selectCards([card('a', 30, { locked: true, priority: 1, short: short(5) })], [], 40) as FitResult;
    expect(r.shortIds).toEqual([]);
    const tight = selectCards([card('a', 30, { locked: true, short: short(5) })], [], 20) as NoFitResult;
    expect(tight.fits).toBe(false);
    expect(tight.shortest!.totalSeconds).toBe(30);
  });

  it('the shortest valid talk can use short versions', () => {
    const r = selectCards([card('q', 30, { tags: ['Q'], short: short(12) })], ['Q'], 10) as NoFitResult;
    expect(r.fits).toBe(false);
    expect(r.shortest!.shortIds).toEqual(['q']);
    expect(r.shortest!.totalSeconds).toBe(12);
  });

  it('handles 12 cards that all have short versions (3^12 combinations)', () => {
    const many = Array.from({ length: 12 }, (_, i) => card(String(i), 20, { priority: (i % 5) + 1, short: short(8) }));
    const r = selectCards(many, [], 150) as FitResult;
    expect(r.fits).toBe(true);
    expect(r.totalSeconds).toBeLessThanOrEqual(150);
    // Compare with a plain recursive brute force over full / short / cut.
    const scoreOf = (kept: Card[], shortIds: string[]) =>
      kept.reduce((t, c) => t + (c.priority ?? 0) * (shortIds.includes(c.id) ? 0.6 : 1), 0);
    const brute = (i: number, secs: number): number => {
      if (secs > 150) return -Infinity;
      if (i === many.length) return 0;
      const c = many[i];
      return Math.max(brute(i + 1, secs), (c.priority ?? 0) + brute(i + 1, secs + 20), (c.priority ?? 0) * 0.6 + brute(i + 1, secs + 8));
    };
    expect(scoreOf(r.kept, r.shortIds)).toBeCloseTo(brute(0, 0));
    expect(r.shortIds.length).toBeGreaterThan(0);
  });
});

describe('parseTime', () => {
  it('reads mm:ss and plain seconds', () => {
    expect(parseTime('2:00')).toBe(120);
    expect(parseTime(' 1:08 ')).toBe(68);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
