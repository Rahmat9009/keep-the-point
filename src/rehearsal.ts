/**
 * Rehearsal timing math. Pure: tap timestamps in, seconds per card out.
 *
 * - "start" begins the first card.
 * - "next" ends the current card and begins the following one (the last "next" finishes the talk).
 * - "back" throws away the previous card's time and starts timing it again from this moment.
 *   On the first card it simply restarts that card.
 */

export type TapType = 'start' | 'next' | 'back';

export interface Tap {
  type: TapType;
  /** Timestamp in milliseconds, e.g. from performance.now(). */
  at: number;
}

export interface RehearsalState {
  cardCount: number;
  started: boolean;
  done: boolean;
  /** Index of the card being spoken now (equals cardCount when done). */
  index: number;
  /** Measured milliseconds per card; null for cards not finished yet. */
  durationsMs: (number | null)[];
  /** When the current card started; null before start and after the end. */
  cardStartedAt: number | null;
}

export function replayTaps(cardCount: number, taps: Tap[]): RehearsalState {
  const s: RehearsalState = {
    cardCount,
    started: false,
    done: false,
    index: 0,
    durationsMs: Array.from({ length: cardCount }, () => null),
    cardStartedAt: null,
  };
  if (cardCount === 0) return s;

  for (const tap of taps) {
    if (tap.type === 'start') {
      if (s.started) continue;
      s.started = true;
      s.cardStartedAt = tap.at;
    } else if (!s.started) {
      continue; // next/back before starting do nothing
    } else if (tap.type === 'next') {
      if (s.done || s.cardStartedAt === null) continue;
      s.durationsMs[s.index] = Math.max(0, tap.at - s.cardStartedAt);
      s.index += 1;
      if (s.index >= cardCount) {
        s.done = true;
        s.cardStartedAt = null;
      } else {
        s.cardStartedAt = tap.at;
      }
    } else if (tap.type === 'back') {
      // Re-time the previous card (or the first card again if we're on it).
      if (s.index > 0) {
        s.index -= 1;
        s.durationsMs[s.index] = null;
      }
      s.done = false;
      s.cardStartedAt = tap.at;
    }
  }
  return s;
}

/** Total talk time so far: finished cards plus the card in progress. */
export function elapsedMs(state: RehearsalState, now: number): number {
  const finished = state.durationsMs.reduce<number>((t, d) => t + (d ?? 0), 0);
  const current = state.cardStartedAt === null ? 0 : Math.max(0, now - state.cardStartedAt);
  return finished + current;
}

/** Milliseconds to whole seconds for saving: rounded, at least 1s. */
export function msToCardSeconds(ms: number): number {
  return Math.max(1, Math.round(ms / 1000));
}

/** Seconds per card for a finished rehearsal (rounded, min 1s). Null entries mean the card wasn't finished. */
export function secondsPerCard(cardCount: number, taps: Tap[]): (number | null)[] {
  return replayTaps(cardCount, taps).durationsMs.map((ms) => (ms === null ? null : msToCardSeconds(ms)));
}
