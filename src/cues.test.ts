import { describe, expect, it } from 'vitest';
import { buildCueItems, cutLabel, cutMarkers } from './cues';
import { sampleTalk } from './sample';
import { selectCards, type FitResult } from './select';

const { cards, requiredPoints } = sampleTalk;
const keptAt = (cardList = cards, budget = 120) =>
  (selectCards(cardList, requiredPoints, budget) as FitResult).kept.map((c) => c.id);

describe('cutMarkers', () => {
  it('sample at 2:00: one marker between card 2 and card 4, naming card 3', () => {
    const markers = cutMarkers(cards, keptAt());
    expect(markers).toHaveLength(1);
    expect(markers[0].after?.id).toBe('2');
    expect(markers[0].before?.id).toBe('4');
    expect(markers[0].cards.map((c) => c.id)).toEqual(['3']);
    expect(markers[0].seconds).toBe(46);
    expect(cutLabel(markers[0])).toBe("Grandma's bakery story (46s)");
  });

  it('bakery locked at 2:00: markers at the start and between 4/6 and 6/8', () => {
    const locked = cards.map((c) => (c.id === '3' ? { ...c, locked: true } : c));
    const markers = cutMarkers(locked, keptAt(locked));
    expect(markers.map((m) => [m.after?.id ?? null, m.cards.map((c) => c.id), m.before?.id ?? null])).toEqual([
      [null, ['1'], '2'],
      ['4', ['5'], '6'],
      ['6', ['7'], '8'],
    ]);
  });

  it('groups cards cut in a row into one marker', () => {
    const markers = cutMarkers(cards, ['1', '4', '8']);
    expect(markers.map((m) => m.cards.map((c) => c.id))).toEqual([['2', '3'], ['5', '6', '7']]);
    expect(markers[0].seconds).toBe(60);
    expect(cutLabel(markers[0])).toBe("Research question (14s), Grandma's bakery story (46s)");
  });

  it('marks a cut at the end', () => {
    const [marker] = cutMarkers(cards, ['1', '2', '3', '4', '5', '6', '7']);
    expect(marker.after?.id).toBe('7');
    expect(marker.before).toBeNull();
  });

  it('has no markers when nothing is cut', () => {
    expect(cutMarkers(cards, cards.map((c) => c.id))).toEqual([]);
  });

  it('shows ~ for estimated cards in the label', () => {
    const est = cards.map((c) => (c.id === '3' ? { ...c, estimated: true } : c));
    expect(cutLabel(cutMarkers(est, keptAt(est))[0])).toBe("Grandma's bakery story (~46s)");
  });
});

describe('buildCueItems', () => {
  it('numbers kept cards 1..n in original order, with markers in between', () => {
    const items = buildCueItems(cards, keptAt());
    expect(items.map((i) => (i.kind === 'card' ? `${i.number}:${i.card.id}` : 'cut'))).toEqual([
      '1:1', '2:2', 'cut', '3:4', '4:5', '5:6', '6:7', '7:8',
    ]);
  });
});
