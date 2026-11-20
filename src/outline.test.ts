import { describe, expect, it } from 'vitest';
import { cardsFromOutline, countWords, estimateSeconds, parseOutline } from './outline';

const words = (n: number) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

describe('parseOutline', () => {
  it('makes one entry per line', () => {
    expect(parseOutline('Hook\nQuestion\nMethod')).toEqual(['Hook', 'Question', 'Method']);
  });

  it('skips blank and whitespace-only lines', () => {
    expect(parseOutline('\nHook\n\n   \n\t\nMethod\n\n')).toEqual(['Hook', 'Method']);
  });

  it('trims whitespace around each line', () => {
    expect(parseOutline('   Hook  \n\tMethod\t')).toEqual(['Hook', 'Method']);
  });

  it('handles Windows line endings', () => {
    expect(parseOutline('Hook\r\nMethod\r\n')).toEqual(['Hook', 'Method']);
  });

  it('returns nothing for an empty outline', () => {
    expect(parseOutline('')).toEqual([]);
    expect(parseOutline('  \n \n')).toEqual([]);
  });
});

describe('estimateSeconds (150 wpm = 2.5 words/s, rounded, min 3s)', () => {
  it('counts words separated by any whitespace', () => {
    expect(countWords('  one   two\tthree ')).toBe(3);
    expect(countWords('')).toBe(0);
  });

  it('divides words by 2.5', () => {
    expect(estimateSeconds(words(30))).toBe(12);
    expect(estimateSeconds(words(25))).toBe(10);
    expect(estimateSeconds(words(150))).toBe(60);
  });

  it('rounds to the nearest second', () => {
    expect(estimateSeconds(words(31))).toBe(12); // 12.4
    expect(estimateSeconds(words(32))).toBe(13); // 12.8
  });

  it('never goes below 3 seconds', () => {
    expect(estimateSeconds('')).toBe(3);
    expect(estimateSeconds('Hook')).toBe(3);
    expect(estimateSeconds(words(7))).toBe(3); // 2.8 rounds to 3
    expect(estimateSeconds(words(9))).toBe(4); // 3.6
  });
});

describe('cardsFromOutline', () => {
  it('makes estimated, unlocked cards with unique ids', () => {
    let n = 0;
    const cards = cardsFromOutline(`Hook\n\n  ${words(30)}  `, () => `id${++n}`);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ id: 'id1', text: 'Hook', seconds: 3, estimated: true, locked: false, tags: [] });
    expect(cards[1]).toMatchObject({ id: 'id2', seconds: 12, estimated: true });
  });
});
