import { describe, expect, it } from 'vitest';
import {
  MESSY_RUBRIC,
  MESSY_SCRIPT,
  buildSetup,
  cleanTitle,
  paragraphRanges,
  rangeProblem,
  rubricPoints,
  splitSentences,
  type AiGrouping,
  type Sentence,
} from './setup';
import { countWords, estimateSeconds } from './outline';

const texts = (s: string) => splitSentences(s).map((x) => x.text);
const noSpace = (s: string) => s.replace(/\s+/g, '');
let n = 0;
const ids = () => `t${++n}`;

describe('splitSentences', () => {
  it('splits on . ! and ?', () => {
    expect(texts('Really? Yes! Okay then.')).toEqual(['Really?', 'Yes!', 'Okay then.']);
  });

  it('does not split after titles like Dr. and Mrs.', () => {
    expect(texts('Dr. Smith said hi. Then Mrs. Jones left.')).toEqual(['Dr. Smith said hi.', 'Then Mrs. Jones left.']);
  });

  it('keeps decimals and times whole', () => {
    expect(texts('Teens need 8.5 to 9.5 hours. Grades went up 4.5 percent at 9:00.')).toEqual([
      'Teens need 8.5 to 9.5 hours.',
      'Grades went up 4.5 percent at 9:00.',
    ]);
  });

  it('splits after a closing quote and keeps the quote with its sentence', () => {
    expect(texts('She said, "Stop." Then we left. He asked, “Why?” Nobody knew.')).toEqual([
      'She said, "Stop."',
      'Then we left.',
      'He asked, “Why?”',
      'Nobody knew.',
    ]);
  });

  it('starts a sentence with an opening quote', () => {
    expect(texts('Some people say this. "It just ends later," they argue.')).toEqual(['Some people say this.', '"It just ends later," they argue.']);
  });

  it('does not split before a lowercase word (ellipses, e.g.)', () => {
    expect(texts('Wait... what happened? Pets, e.g. cats, sleep a lot.')).toEqual(['Wait... what happened?', 'Pets, e.g. cats, sleep a lot.']);
  });

  it('keeps initials together', () => {
    expect(texts('J. K. Rowling wrote it. Cool.')).toEqual(['J. K. Rowling wrote it.', 'Cool.']);
  });

  it('joins a sentence wrapped over a line break, but splits at a line break after an abbreviation', () => {
    expect(texts('This line\nwraps here. Next.')).toEqual(['This line wraps here.', 'Next.']);
    expect(texts('Schools should not start before 8:30 a.m.\nWhen a district changed, it helped.')).toEqual([
      'Schools should not start before 8:30 a.m.',
      'When a district changed, it helped.',
    ]);
    expect(texts('We met Dr.\nCarskadon today.')).toEqual(['We met Dr. Carskadon today.']);
  });

  it('treats bullet and numbered lines as separate sentences, without splitting "1." off', () => {
    expect(texts('- First point\n- Second point')).toEqual(['- First point', '- Second point']);
    expect(texts('1. Intro\n2. Body text here.')).toEqual(['1. Intro', '2. Body text here.']);
  });

  it('records paragraphs and handles Windows line endings', () => {
    const s = splitSentences('One. Two.\r\n\r\nThree.\r\n   \r\nFour.');
    expect(s.map((x) => [x.text, x.para])).toEqual([['One.', 0], ['Two.', 0], ['Three.', 1], ['Four.', 2]]);
  });

  it('collapses whitespace but never changes a word', () => {
    const script = '  Hello   there.\n\n\nGeneral   Kenobi!  ';
    expect(texts(script)).toEqual(['Hello there.', 'General Kenobi!']);
    expect(noSpace(texts(script).join(''))).toBe(noSpace(script));
  });

  it('returns nothing for a blank script', () => {
    expect(splitSentences('  \n\n ')).toEqual([]);
  });

  it('splits the messy example script sensibly', () => {
    const s = texts(MESSY_SCRIPT);
    expect(s).toContain('According to Dr. Mary Carskadon, a sleep researcher at Brown University, teens need about 8.5 to 9.5 hours of sleep a night.');
    expect(s).toContain('The American Academy of Pediatrics actually says middle and high schools shouldn\'t start before 8:30 a.m.');
    expect(s).toContain('Thanks for listening!');
    expect(noSpace(s.join(''))).toBe(noSpace(MESSY_SCRIPT));
  });
});

describe('rangeProblem', () => {
  it('accepts contiguous, complete, ordered ranges', () => {
    expect(rangeProblem([{ start: 1, end: 2 }, { start: 3, end: 3 }, { start: 4, end: 6 }], 6)).toBeNull();
    expect(rangeProblem([{ start: 1, end: 1 }], 1)).toBeNull();
  });

  it.each([
    ['a gap', [{ start: 1, end: 2 }, { start: 4, end: 6 }], 6, 'sentence 3 is missing'],
    ['an overlap', [{ start: 1, end: 3 }, { start: 3, end: 6 }], 6, 'overlap'],
    ['ranges out of order', [{ start: 4, end: 6 }, { start: 1, end: 3 }], 6, 'missing'],
    ['a range running backwards', [{ start: 1, end: 3 }, { start: 6, end: 4 }], 6, 'backwards'],
    ['missing sentences at the end', [{ start: 1, end: 4 }], 6, 'sentence 5 is missing'],
    ['a range past the end', [{ start: 1, end: 7 }], 6, 'past the last sentence'],
    ['not starting at 1', [{ start: 0, end: 6 }], 6, 'before sentence 1'],
    ['non-integers', [{ start: 1, end: 2.5 }], 6, 'whole numbers'],
    ['no cards', [], 6, 'no cards'],
  ])('rejects %s', (_name, ranges, count, message) => {
    expect(rangeProblem(ranges as { start: number; end: number }[], count)).toContain(message);
  });

  it('rejects more than 12 cards', () => {
    const ranges = Array.from({ length: 13 }, (_, i) => ({ start: i + 1, end: i + 1 }));
    expect(rangeProblem(ranges, 13)).toContain('more than 12');
    expect(rangeProblem(ranges.slice(0, 12), 12)).toBeNull();
  });
});

describe('paragraph fallback', () => {
  const sentences = (paras: number[][]): Sentence[] =>
    paras.flatMap((words, p) => words.map((w) => ({ text: Array.from({ length: w }, () => 'word').join(' ') + '.', para: p })));

  it('makes one card per paragraph', () => {
    expect(paragraphRanges(sentences([[5, 5], [3], [4, 4, 4]]))).toEqual([
      { start: 1, end: 2 },
      { start: 3, end: 3 },
      { start: 4, end: 6 },
    ]);
  });

  it('merges the smallest neighbours until there are 12', () => {
    // 14 paragraphs; paragraph 4 (2 words) and paragraph 9 (1 word) are the smallest.
    const sizes = [10, 10, 10, 2, 10, 10, 10, 10, 1, 10, 10, 10, 10, 10];
    const ranges = paragraphRanges(sentences(sizes.map((w) => [w])));
    expect(ranges).toHaveLength(12);
    expect(rangeProblem(ranges, 14)).toBeNull();
    expect(ranges).toContainEqual({ start: 3, end: 4 }); // 2-word paragraph joined its 10-word neighbour
    expect(ranges).toContainEqual({ start: 8, end: 9 });
  });

  it('splits one long paragraph into sentence groups', () => {
    const one = sentences([[20, 20, 20, 20, 20]]);
    const ranges = paragraphRanges(one);
    expect(ranges.length).toBeGreaterThan(1);
    expect(rangeProblem(ranges, 5)).toBeNull();
  });

  it('keeps a short single paragraph as one card', () => {
    expect(paragraphRanges(sentences([[5, 5]]))).toEqual([{ start: 1, end: 2 }]);
  });

  it('returns nothing for no sentences', () => {
    expect(paragraphRanges([])).toEqual([]);
  });
});

describe('rubricPoints and cleanTitle', () => {
  it('reads point names from a rubric', () => {
    expect(rubricPoints(MESSY_RUBRIC)).toEqual(['Claim', 'Evidence', 'Counterargument', 'Conclusion']);
    expect(rubricPoints('- hook\n- evidence\n- call to action')).toEqual(['Hook', 'Evidence', 'Call to action']);
    expect(rubricPoints('')).toEqual([]);
  });

  it('keeps at most 6 points', () => {
    expect(rubricPoints('a, b, c, d, e, f, g, h')).toHaveLength(6);
  });

  it('cuts titles to 5 words', () => {
    expect(cleanTitle('  The research on teen sleep and grades ')).toBe('The research on teen sleep');
    expect(cleanTitle('Hook.')).toBe('Hook');
    expect(cleanTitle('  ')).toBeUndefined();
    expect(cleanTitle(42)).toBeUndefined();
  });
});

describe('buildSetup', () => {
  const sentences = splitSentences(MESSY_SCRIPT);
  const count = sentences.length;
  const ai: AiGrouping = {
    cards: [
      { start: 1, end: 3, title: 'Hook', points: [] },
      { start: 4, end: 6, title: 'My claim about school times', points: ['claim'] },
      { start: 7, end: 10, title: 'Sleep research', points: ['Evidence', 'Made up point'] },
      { start: 11, end: 14, title: 'Counterargument', points: ['Counterargument'] },
      { start: 15, end: count, title: 'Conclusion', points: ['Conclusion'] },
    ],
    points: ['Claim', 'Evidence', 'Counterargument', 'Conclusion'],
  };

  it('uses a valid AI grouping and rebuilds every card from the original sentences', () => {
    const r = buildSetup(sentences, MESSY_RUBRIC, ai, undefined, ids);
    expect(r.source).toBe('ai');
    expect(r.cards).toHaveLength(5);
    expect(noSpace(r.cards.map((c) => c.text).join(''))).toBe(noSpace(MESSY_SCRIPT));
    expect(r.requiredPoints).toEqual(['Claim', 'Evidence', 'Counterargument', 'Conclusion']);
    expect(r.cards[1].tags).toEqual(['Claim']); // matched ignoring case
    expect(r.cards[2].tags).toEqual(['Evidence']); // unknown point dropped
    expect(r.cards[1].title).toBe('My claim about school times');
  });

  it('estimates seconds from word count and leaves priority at 3', () => {
    const r = buildSetup(sentences, MESSY_RUBRIC, ai, undefined, ids);
    for (const c of r.cards) {
      expect(c.seconds).toBe(estimateSeconds(c.text));
      expect(c.estimated).toBe(true);
      expect(c.priority).toBe(3);
      expect(c.locked).toBe(false);
    }
  });

  it('ignores AI points when there is no rubric', () => {
    const r = buildSetup(sentences, '  ', ai, undefined, ids);
    expect(r.requiredPoints).toEqual([]);
    expect(r.cards.every((c) => c.tags.length === 0)).toBe(true);
  });

  it('falls back to paragraphs when the AI grouping is invalid, and says why', () => {
    const bad = { ...ai, cards: ai.cards.map((c, i) => (i === 2 ? { ...c, start: c.start + 1 } : c)) };
    const r = buildSetup(sentences, MESSY_RUBRIC, bad, undefined, ids);
    expect(r.source).toBe('paragraphs');
    expect(r.note).toContain('missing');
    expect(r.cards).toHaveLength(5); // the example has 5 paragraphs
    expect(noSpace(r.cards.map((c) => c.text).join(''))).toBe(noSpace(MESSY_SCRIPT));
    expect(r.requiredPoints).toEqual(['Claim', 'Evidence', 'Counterargument', 'Conclusion']);
  });

  it('falls back to paragraphs when the AI is unavailable', () => {
    const r = buildSetup(sentences, '', null, 'AI unavailable.', ids);
    expect(r.source).toBe('paragraphs');
    expect(r.note).toContain('AI unavailable.');
    expect(r.requiredPoints).toEqual([]);
    expect(noSpace(r.cards.map((c) => c.text).join(''))).toBe(noSpace(MESSY_SCRIPT));
  });

  it('the example script is a realistic length', () => {
    expect(countWords(MESSY_SCRIPT)).toBeGreaterThanOrEqual(220);
    expect(countWords(MESSY_SCRIPT)).toBeLessThanOrEqual(290);
  });
});
