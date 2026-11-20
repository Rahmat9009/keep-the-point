import { describe, expect, it } from 'vitest';
import { elapsedMs, msToCardSeconds, replayTaps, secondsPerCard, type Tap } from './rehearsal';

const tap = (type: Tap['type'], at: number): Tap => ({ type, at });

describe('secondsPerCard', () => {
  it('times each card from tap to tap', () => {
    const taps = [tap('start', 1000), tap('next', 13000), tap('next', 27000), tap('next', 49000)];
    expect(secondsPerCard(3, taps)).toEqual([12, 14, 22]);
    expect(replayTaps(3, taps).done).toBe(true);
  });

  it('rounds to the nearest second', () => {
    const taps = [tap('start', 0), tap('next', 2499), tap('next', 2499 + 2500), tap('next', 4999 + 10_400)];
    expect(secondsPerCard(3, taps)).toEqual([2, 3, 10]); // 2.499 → 2, 2.5 → 3, 10.4 → 10
  });

  it('never saves less than 1 second', () => {
    const taps = [tap('start', 0), tap('next', 120), tap('next', 120)];
    expect(secondsPerCard(2, taps)).toEqual([1, 1]);
  });

  it('leaves unfinished cards as null', () => {
    expect(secondsPerCard(3, [tap('start', 0), tap('next', 5000)])).toEqual([5, null, null]);
    expect(secondsPerCard(2, [])).toEqual([null, null]);
  });
});

describe('Back', () => {
  it('re-times the previous card from the moment Back is pressed', () => {
    const taps = [
      tap('start', 0),
      tap('next', 5000), // card 1: 5s
      tap('next', 9000), // card 2: 4s (oops, tapped too early)
      tap('back', 9500), // back to card 2, timing restarts at 9.5s
      tap('next', 12500), // card 2: 3s
      tap('next', 15000), // card 3: 2.5s → 3
    ];
    expect(secondsPerCard(3, taps)).toEqual([5, 3, 3]);
  });

  it('on the first card it restarts that card', () => {
    const taps = [tap('start', 0), tap('back', 2000), tap('next', 6000)];
    expect(secondsPerCard(1, taps)).toEqual([4]);
  });

  it('can step back more than once', () => {
    const taps = [tap('start', 0), tap('next', 3000), tap('next', 6000), tap('back', 7000), tap('back', 8000), tap('next', 10000), tap('next', 14000)];
    expect(secondsPerCard(2, taps)).toEqual([2, 4]);
  });

  it('after the last card it re-times the last card', () => {
    const taps = [tap('start', 0), tap('next', 3000), tap('next', 6000), tap('back', 7000)];
    const s = replayTaps(2, taps);
    expect(s.done).toBe(false);
    expect(s.index).toBe(1);
    expect(s.durationsMs).toEqual([3000, null]);
  });
});

describe('ignored taps', () => {
  it('ignores next/back before start, a second start, and next after the end', () => {
    const taps = [tap('next', 100), tap('back', 200), tap('start', 1000), tap('start', 1500), tap('next', 4000), tap('next', 9000)];
    expect(secondsPerCard(1, taps)).toEqual([3]);
  });

  it('handles an empty talk', () => {
    expect(replayTaps(0, [tap('start', 0)]).started).toBe(false);
  });
});

describe('elapsedMs', () => {
  it('adds finished cards and the card in progress', () => {
    const s = replayTaps(3, [tap('start', 0), tap('next', 5000)]);
    expect(elapsedMs(s, 7000)).toBe(7000);
  });

  it('drops time thrown away by Back', () => {
    const s = replayTaps(2, [tap('start', 0), tap('next', 5000), tap('back', 8000)]);
    expect(elapsedMs(s, 9000)).toBe(1000);
  });

  it('is 0 before starting', () => {
    expect(elapsedMs(replayTaps(2, []), 5000)).toBe(0);
  });
});

describe('msToCardSeconds', () => {
  it('rounds with a 1s minimum', () => {
    expect(msToCardSeconds(0)).toBe(1);
    expect(msToCardSeconds(1499)).toBe(1);
    expect(msToCardSeconds(1500)).toBe(2);
    expect(msToCardSeconds(46_200)).toBe(46);
  });
});
