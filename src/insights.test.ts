import { describe, expect, it } from 'vitest';
import {
  HISTORY_LIMIT,
  addRun,
  average,
  cardsRunningLong,
  isLong,
  makeRun,
  progressLine,
  replaceTalk,
  tendencyLine,
  type PracticeRun,
  type RunCard,
} from './insights';
import { sampleRuns, sampleTalk } from './sample';
import { parseSavedState } from './storage';
import type { Card } from './types';

const card = (id: string, seconds: number, title = `Card ${id}`): Card => ({ id, title, text: title, seconds, tags: [], locked: false });
const entry = (id: string, planned: number, actual: number, short = false): RunCard => ({ id, planned, actual, ...(short ? { short: true } : {}) });
const run = (cards: RunCard[], at = 0, kind: PracticeRun['kind'] = 'full'): PracticeRun => makeRun(kind, cards, at);

describe('average', () => {
  it('averages, and is 0 for nothing', () => {
    expect(average([27, 29, 30])).toBeCloseTo(28.667, 3);
    expect(average([])).toBe(0);
  });
});

describe('keeps running long', () => {
  it('needs 20% or more AND at least 3s over', () => {
    expect(isLong(entry('a', 22, 27))).toBe(true); // +5s, 23%
    expect(isLong(entry('a', 22, 26))).toBe(false); // +4s, 18%
    expect(isLong(entry('a', 8, 10))).toBe(false); // +2s is 25%, but under the 3s minimum
    expect(isLong(entry('a', 10, 13))).toBe(true); // +3s, 30%
    expect(isLong(entry('a', 15, 18))).toBe(true); // +3s, exactly 20%
  });

  it('flags a card that ran long in 2 of its last 3 runs, with planned vs average', () => {
    const cards = [card('m', 22, 'Method'), card('h', 12, 'Hook')];
    const history = [
      run([entry('m', 22, 30), entry('h', 12, 12)]),
      run([entry('m', 22, 23), entry('h', 12, 16)]),
      run([entry('m', 22, 28), entry('h', 12, 12)]),
    ];
    const long = cardsRunningLong(history, cards);
    expect(long.map((l) => l.card.id)).toEqual(['m']); // Hook only once
    expect(long[0].planned).toBe(22);
    expect(Math.round(long[0].average)).toBe(27); // (30 + 23 + 28) / 3
  });

  it('only looks at the last 3 runs that included the card', () => {
    const cards = [card('m', 22)];
    const history = [run([entry('m', 22, 30)]), run([entry('m', 22, 30)]), run([entry('m', 22, 22)]), run([entry('m', 22, 22)]), run([entry('m', 22, 30)])];
    expect(cardsRunningLong(history, cards)).toEqual([]); // last 3: 22, 22, 30
  });

  it('does not flag a card over by 25% when that is under 3s', () => {
    const cards = [card('s', 8)];
    const history = [run([entry('s', 8, 10)]), run([entry('s', 8, 10)]), run([entry('s', 8, 10)])];
    expect(cardsRunningLong(history, cards)).toEqual([]);
  });

  it('ignores cards no longer in the talk (matched by id)', () => {
    const history = [run([entry('gone', 10, 20)]), run([entry('gone', 10, 20)])];
    expect(cardsRunningLong(history, [card('other', 10)])).toEqual([]);
  });
});

describe('progress and the whole-talk line', () => {
  it('lists whole-talk totals oldest first, leaving out single-card practice', () => {
    const history = [run([entry('a', 100, 118)]), run([entry('a', 100, 111)]), run([entry('a', 22, 25)], 0, 'card'), run([entry('a', 100, 106)])];
    expect(progressLine(history)).toBe('1:58 → 1:51 → 1:46');
    expect(progressLine([run([entry('a', 22, 25)], 0, 'card')])).toBeNull();
  });

  it('says how far over the plan you usually run', () => {
    const history = [run([entry('a', 100, 108)]), run([entry('a', 100, 104)]), run([entry('a', 100, 106)])];
    expect(tendencyLine(history)).toBe('You usually run about 6s long. Consider aiming 6s under your limit.');
    expect(tendencyLine([run([entry('a', 100, 92)])])).toBe('You usually finish about 8s early. There may be room for a card the plan cut.');
    expect(tendencyLine([run([entry('a', 100, 101)])])).toBe('Your timing usually matches the plan, within a few seconds.');
    expect(tendencyLine([run([entry('a', 120, 9)])])).toBe('You usually finish about 1:51 early. There may be room for a card the plan cut.');
    expect(tendencyLine([])).toBeNull();
  });
});

describe('history', () => {
  it(`keeps only the last ${HISTORY_LIMIT} runs`, () => {
    let history: PracticeRun[] = [];
    for (let i = 1; i <= 7; i++) history = addRun(history, run([entry('a', 10, i)], i));
    expect(history).toHaveLength(HISTORY_LIMIT);
    expect(history.map((r) => r.at)).toEqual([3, 4, 5, 6, 7]);
  });

  it('replaces the sample runs with your first real run', () => {
    const samples = sampleRuns();
    expect(samples.every((r) => r.sample)).toBe(true);
    const history = addRun(samples, run([entry('4', 22, 25)], 99, 'card'));
    expect(history).toHaveLength(1);
    expect(history[0].at).toBe(99);
    expect(history[0].sample).toBeUndefined();
  });

  it('is cleared when the cards are replaced', () => {
    const state = { talk: structuredClone(sampleTalk), limit: '1:45', history: sampleRuns() };
    const next = replaceTalk(state, { ...state.talk, cards: [card('1', 10)] });
    expect(next.history).toEqual([]);
    expect(next.talk.cards.map((c) => c.id)).toEqual(['1']);
    expect(next.limit).toBe('1:45');
  });

  it('is saved and loaded with the talk, dropping malformed runs', () => {
    const history = [...sampleRuns(), { kind: 'nope', cards: [], totalSeconds: 3 }, { kind: 'full', cards: [{ id: 'x' }], totalSeconds: 3 }];
    const loaded = parseSavedState(JSON.parse(JSON.stringify({ talk: sampleTalk, limit: '1:45', history })));
    expect(loaded?.history).toEqual(sampleRuns());
  });
});

describe('sample practice runs', () => {
  it('give the insights described in the panel', () => {
    const runs = sampleRuns();
    expect(runs).toHaveLength(3);
    expect(progressLine(runs)).toBe('1:58 → 1:51 → 1:46');
    const long = cardsRunningLong(runs, sampleTalk.cards);
    expect(long.map((l) => [l.card.title, l.planned, Math.round(l.average)])).toEqual([['Method', 22, 29]]);
    expect(tendencyLine(runs)).toBe('You usually run about 10s long. Consider aiming 10s under your limit.');
  });
});
