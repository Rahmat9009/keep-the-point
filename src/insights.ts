/**
 * Practice history and the insights drawn from it. Pure functions only.
 *
 * Every completed run (full rehearsal, shortened rehearsal, live presentation, single-card
 * practice) is kept with each card's planned and measured seconds. Only the last 5 runs are kept.
 */
import { formatTime } from './time';
import type { Card, Talk } from './types';

/**
 * Replace the talk's cards and start a new practice history: new cards reuse ids like "1", "2",
 * so old measurements would be matched to the wrong cards.
 */
export function replaceTalk<S extends { talk: Talk; history?: PracticeRun[] }>(state: S, talk: Talk): S {
  return { ...state, talk, history: [] };
}

export type RunKind = 'full' | 'short' | 'live' | 'card';

export interface RunCard {
  id: string;
  /** Seconds the plan gave the card at the time of the run (its short version's time if said short). */
  planned: number;
  /** Measured seconds. */
  actual: number;
  /** Said as its short version. */
  short?: boolean;
}

export interface PracticeRun {
  kind: RunKind;
  /** When the run finished (ms since epoch). */
  at: number;
  cards: RunCard[];
  totalSeconds: number;
  /** One of the built-in sample runs. */
  sample?: boolean;
}

export const HISTORY_LIMIT = 5;
/** A card "runs long" when it is over its plan by at least this share… */
export const LONG_SHARE = 0.2;
/** …and by at least this many seconds… */
export const LONG_MIN_SECONDS = 3;
/** …in this many of its last LONG_WINDOW runs. */
export const LONG_RUNS_NEEDED = 2;
export const LONG_WINDOW = 3;
/** The whole-talk line calls a difference smaller than this "about right". */
export const TENDENCY_MIN_SECONDS = 3;

export function makeRun(kind: RunKind, cards: RunCard[], at: number, handoffSeconds = 0): PracticeRun {
  return { kind, at, cards, totalSeconds: cards.reduce((t, c) => t + c.actual, handoffSeconds) };
}

/** Add a run, keeping the last 5. A real run replaces any sample runs. */
export function addRun(history: PracticeRun[], run: PracticeRun): PracticeRun[] {
  const kept = run.sample ? history : history.filter((r) => !r.sample);
  return [...kept, run].slice(-HISTORY_LIMIT);
}

export function average(values: number[]): number {
  return values.length ? values.reduce((t, v) => t + v, 0) / values.length : 0;
}

export function isLong(entry: RunCard): boolean {
  const over = entry.actual - entry.planned;
  return over >= LONG_MIN_SECONDS && over >= entry.planned * LONG_SHARE;
}

export interface LongCard {
  card: Card;
  /** Planned seconds in the most recent run that included the card. */
  planned: number;
  /** Average measured seconds over those recent runs (same version as the latest). */
  average: number;
  /** The latest run said it as its short version. */
  short: boolean;
}

/**
 * Cards that keep running long: over plan by 20% and 3s or more in at least 2 of the last
 * 3 runs that included the card. Matched by id; cards no longer in the talk are ignored.
 */
export function cardsRunningLong(history: PracticeRun[], cards: Card[]): LongCard[] {
  const result: LongCard[] = [];
  for (const card of cards) {
    const entries = history
      .map((r) => r.cards.find((c) => c.id === card.id))
      .filter((e): e is RunCard => !!e)
      .slice(-LONG_WINDOW);
    if (entries.filter(isLong).length < LONG_RUNS_NEEDED) continue;
    const latest = entries[entries.length - 1];
    const sameVersion = entries.filter((e) => !!e.short === !!latest.short);
    result.push({ card, planned: latest.planned, average: average(sameVersion.map((e) => e.actual)), short: !!latest.short });
  }
  return result;
}

/** Runs of the whole talk (full, shortened or live), oldest first. Single-card practice is left out. */
export function talkRuns(history: PracticeRun[]): PracticeRun[] {
  return history.filter((r) => r.kind !== 'card');
}

/** "1:58 → 1:51 → 1:46", or null when there are no whole-talk runs. */
export function progressLine(history: PracticeRun[]): string | null {
  const runs = talkRuns(history);
  return runs.length ? runs.map((r) => formatTime(r.totalSeconds)).join(' → ') : null;
}

/** One line on the whole talk, comparing each run's total with what it planned. */
export function tendencyLine(history: PracticeRun[]): string | null {
  const runs = talkRuns(history);
  if (!runs.length) return null;
  const diff = Math.round(average(runs.map((r) => r.totalSeconds - r.cards.reduce((t, c) => t + c.planned, 0))));
  const gap = (s: number) => (s < 60 ? `${s}s` : formatTime(s));
  if (diff >= TENDENCY_MIN_SECONDS) {
    return `You usually run about ${gap(diff)} long. Consider aiming ${gap(diff)} under your limit.`;
  }
  if (diff <= -TENDENCY_MIN_SECONDS) {
    return `You usually finish about ${gap(-diff)} early. There may be room for a card the plan cut.`;
  }
  return 'Your timing usually matches the plan, within a few seconds.';
}
