import { describe, expect, it } from 'vitest';
import { cardTitle, cardsFromOutline, countWords, estimateSeconds, parseOutline } from './outline';
import { sampleTalk, upgradeOldSample } from './sample';

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

describe('cardTitle', () => {
  it('uses the title when there is one', () => {
    expect(cardTitle({ title: '  Hook ', text: 'Have you ever wondered why bakers keep dough warm?' })).toBe('Hook');
  });
  it('falls back to the first five words of the spoken text', () => {
    expect(cardTitle({ text: 'Have you ever wondered why bakers keep dough warm?' })).toBe('Have you ever wondered why…');
    expect(cardTitle({ title: '   ', text: '  Hook  ' })).toBe('Hook');
    expect(cardTitle({ text: "Grandma's bakery story" })).toBe("Grandma's bakery story");
  });
  it('is empty for an empty card', () => {
    expect(cardTitle({ text: '   ' })).toBe('');
  });
});

describe('sample talk', () => {
  it('every card has spoken text whose word count matches its seconds at 2.5 words per second', () => {
    for (const card of sampleTalk.cards) {
      expect(card.title, card.id).toBeTruthy();
      expect(estimateSeconds(card.text), card.title).toBe(card.seconds);
      expect(countWords(card.text), card.title).toBeGreaterThanOrEqual(15); // long enough to send to ✨ Shorten
    }
  });
  it('replaces a saved copy of the old label-only sample, but leaves edited talks alone', () => {
    const old = {
      limit: '1:45',
      talk: { ...sampleTalk, cards: sampleTalk.cards.map(({ title, short: _s, ...c }) => ({ ...c, text: title! })) },
    };
    expect(upgradeOldSample(old)).toEqual({ limit: '1:45', talk: sampleTalk });
    const edited = { ...old, talk: { ...old.talk, cards: old.talk.cards.map((c, i) => (i === 0 ? { ...c, text: 'My own hook' } : c)) } };
    expect(upgradeOldSample(edited)).toBe(edited);
    expect(upgradeOldSample({ limit: '2:00', talk: sampleTalk })?.talk).toBe(sampleTalk);
    expect(upgradeOldSample(null)).toBeNull();
  });
});
