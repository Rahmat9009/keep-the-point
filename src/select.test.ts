import { describe, expect, it } from 'vitest';
import { sampleTalk } from './sample';
import { selectCards, type FitResult, type NoFitResult } from './select';
import { formatTime, parseTime } from './time';
import type { Card } from './types';

const { cards, requiredPoints } = sampleTalk;
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
    expect(result.cut.map((c) => c.card.text)).toEqual(['Hook', 'Setup details', 'Graph explanation']);
  });

  it('reports which kept card covers each required point', () => {
    const result = selectCards(cards, requiredPoints, 120) as FitResult;
    expect(result.coverage.Question.map((c) => c.text)).toEqual(['Research question']);
    expect(result.coverage.Evidence.map((c) => c.text)).toEqual(['Results']);
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

describe('parseTime', () => {
  it('reads mm:ss and plain seconds', () => {
    expect(parseTime('2:00')).toBe(120);
    expect(parseTime(' 1:08 ')).toBe(68);
    expect(parseTime('90')).toBe(90);
    expect(parseTime('1:75')).toBeNull();
    expect(parseTime('abc')).toBeNull();
  });
});
