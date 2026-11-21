/**
 * Live pacing: re-plan the rest of the talk while it is being given. Pure functions only.
 *
 * After each card the plan for the rest is checked against the time left on the clock and
 * changed only when needed, in one direction at a time. Cards already spoken never change.
 */
import { cardTitle } from './outline';
import { SHORT_PRIORITY_SHARE, selectCards, spokenCard } from './select';
import { formatTime } from './time';
import type { Card } from './types';

/** The cards still to be said, in order, and which of them use their short version. */
export interface LivePlan {
  ids: string[];
  shortIds: string[];
}

/** A card that has been said, in the version it was said in. */
export interface SpokenEntry {
  id: string;
  short: boolean;
}

export interface ReplanInput {
  /** Every card in the talk, in talk order. */
  cards: Card[];
  requiredPoints: string[];
  limitSeconds: number;
  /** Cards said so far, in the order they were said. */
  spoken: SpokenEntry[];
  /** Time on the clock so far. */
  elapsedSeconds: number;
  /** The plan for the cards still to come, as it stands before this re-plan. */
  current: LivePlan;
}

export type ReplanMode = 'keep' | 'behind' | 'ahead';

export interface ReplanResult {
  plan: LivePlan;
  /** keep = no change needed; behind = only cutting/shortening was allowed; ahead = only adding/restoring. */
  mode: ReplanMode;
  /** True when nothing fits the time left, so the plan is the shortest one that still covers the required points. */
  wrapUp: boolean;
  /** Seconds left on the clock (limit − elapsed); may be negative. */
  budgetSeconds: number;
  /** Planned seconds of the current plan minus the time left: positive = projected over, negative = spare. */
  overSeconds: number;
}

/** Re-plan to add cards back only when the current plan leaves at least this much spare. */
export const ADD_BACK_SPARE_SECONDS = 8;

/** Seconds the plan expects a card to take in the version it uses. */
export function plannedSeconds(card: Card, short: boolean): number {
  return short && card.short ? card.short.seconds : card.seconds;
}

const UPGRADE = '::full';
const scaled = (p: number | undefined, share: number) => (p === undefined ? undefined : p * share);

/**
 * Decide the plan for the cards still to come. Calm by design:
 *
 * - If the current plan fits the time left with less than 8s spare, it is kept exactly.
 * - BEHIND (it doesn't fit): the selection runs over the current plan's cards only and may only
 *   cut cards or switch them to their short version. Nothing is added or restored.
 * - AHEAD (8s+ spare): every card in the current plan stays, in at least its current version;
 *   the selection may only add back cut cards still ahead or restore a full version.
 *
 * Only cards after the last spoken card are candidates (a speaker can't go back). Required points
 * covered by spoken cards count as covered. Locked cards always stay. If nothing fits even when
 * behind, the shortest valid plan is used and `wrapUp` is true.
 */
export function replan(input: ReplanInput): ReplanResult {
  const { cards, requiredPoints, limitSeconds, spoken, elapsedSeconds, current } = input;
  const spokenIds = new Set(spoken.map((s) => s.id));
  const lastIndex = spoken.reduce((m, s) => Math.max(m, cards.findIndex((c) => c.id === s.id)), -1);
  const remaining = cards.slice(lastIndex + 1).filter((c) => !spokenIds.has(c.id));
  const spokenCards = cards.filter((c) => spokenIds.has(c.id));
  const budgetSeconds = Math.floor(limitSeconds - elapsedSeconds);

  // The current plan, limited to cards that can still be said.
  const planIds = remaining.filter((c) => current.ids.includes(c.id)).map((c) => c.id);
  const plan: LivePlan = { ids: planIds, shortIds: planIds.filter((id) => current.shortIds.includes(id)) };
  const overSeconds = planSeconds(plan, cards) - budgetSeconds;
  const keep = (mode: ReplanMode = 'keep', wrapUp = false): ReplanResult => ({ plan, mode, wrapUp, budgetSeconds, overSeconds });

  if (remaining.length === 0) return keep();
  const needed = (pool: Card[]) =>
    requiredPoints.filter((p) => !spokenCards.some((c) => c.tags.includes(p)) && pool.some((c) => c.tags.includes(p)));

  if (overSeconds > 0) {
    // Behind: only the planned cards; a short card may stay short or be cut, never go back to full.
    const pool = remaining
      .filter((c) => plan.ids.includes(c.id))
      .map((c) =>
        plan.shortIds.includes(c.id) && c.short
          ? { ...c, seconds: c.short.seconds, priority: scaled(c.priority, SHORT_PRIORITY_SHARE), short: undefined }
          : c,
      );
    const result = selectCards(pool, needed(pool), budgetSeconds);
    const pick = result.fits ? { cards: result.kept, shortIds: result.shortIds } : result.shortest;
    if (!pick) return keep('behind', true);
    const ids = pick.cards.map((c) => c.id);
    return {
      plan: { ids, shortIds: ids.filter((id) => plan.shortIds.includes(id) || pick.shortIds.includes(id)) },
      mode: 'behind',
      wrapUp: !result.fits,
      budgetSeconds,
      overSeconds,
    };
  }

  if (-overSeconds < ADD_BACK_SPARE_SECONDS) return keep();

  // Ahead: planned cards are locked in their current version. A short card gets an optional
  // "upgrade" worth the rest of its priority; cut cards ahead are offered in full or short.
  const pool: Card[] = [];
  for (const c of remaining) {
    if (!plan.ids.includes(c.id)) {
      pool.push(c);
    } else if (plan.shortIds.includes(c.id) && c.short) {
      pool.push({ ...c, seconds: c.short.seconds, short: undefined, locked: true });
      pool.push({
        id: c.id + UPGRADE,
        text: '',
        seconds: c.seconds - c.short.seconds,
        tags: [],
        locked: false,
        priority: scaled(c.priority ?? 0, 1 - SHORT_PRIORITY_SHARE),
      });
    } else {
      pool.push({ ...c, locked: true });
    }
  }
  const result = selectCards(pool, needed(pool), budgetSeconds);
  if (!result.fits) return keep(); // can't happen: the current plan itself fits
  const keptIds = new Set(result.kept.map((c) => c.id));
  const ids = remaining.filter((c) => keptIds.has(c.id)).map((c) => c.id);
  const shortIds = ids.filter((id) => (plan.shortIds.includes(id) ? !keptIds.has(id + UPGRADE) : result.shortIds.includes(id)));
  return { plan: { ids, shortIds }, mode: 'ahead', wrapUp: false, budgetSeconds, overSeconds };
}

/** One difference between two plans, for the banner. */
export type PlanChange =
  | { kind: 'skip'; id: string; savesSeconds: number }
  | { kind: 'short'; id: string; savesSeconds: number }
  | { kind: 'full'; id: string; addsSeconds: number }
  | { kind: 'add'; id: string; addsSeconds: number };

/** What changed between the old upcoming plan and the new one. */
export function diffPlans(before: LivePlan, after: LivePlan, cards: Card[]): PlanChange[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const changes: PlanChange[] = [];
  const all = cards.filter((c) => before.ids.includes(c.id) || after.ids.includes(c.id));
  for (const card of all) {
    const wasIn = before.ids.includes(card.id);
    const isIn = after.ids.includes(card.id);
    const wasShort = before.shortIds.includes(card.id);
    const isShort = after.shortIds.includes(card.id);
    const c = byId.get(card.id)!;
    if (wasIn && !isIn) changes.push({ kind: 'skip', id: c.id, savesSeconds: plannedSeconds(c, wasShort) });
    else if (!wasIn && isIn) changes.push({ kind: 'add', id: c.id, addsSeconds: plannedSeconds(c, isShort) });
    else if (wasIn && isIn && wasShort !== isShort) {
      const delta = plannedSeconds(c, wasShort) - plannedSeconds(c, isShort);
      changes.push(isShort ? { kind: 'short', id: c.id, savesSeconds: delta } : { kind: 'full', id: c.id, addsSeconds: -delta });
    }
  }
  return changes;
}

/** 6 -> "6s", 101 -> "1:41". */
export function gapLabel(seconds: number): string {
  const s = Math.round(Math.abs(seconds));
  return s < 60 ? `${s}s` : formatTime(s);
}

/**
 * When the talk will end if the rest goes to plan: time so far, plus what's left of the planned
 * time for the card being said (nothing if it has already run over), plus the remaining plan.
 */
export function projectedFinish(
  elapsedSeconds: number,
  currentCardElapsed: number,
  currentCardPlanned: number,
  restPlanned: number,
): number {
  return elapsedSeconds + Math.max(0, currentCardPlanned - currentCardElapsed) + restPlanned;
}

/** spare = green; over = projected over (amber); late = the clock itself is past the limit (red). */
export type FinishTone = 'spare' | 'over' | 'late';

/** "Finishing at 1:43 · 2s spare" or "Finishing at 1:52 · 7s over". */
export function finishLabel(
  finishSeconds: number,
  limitSeconds: number,
  elapsedSeconds: number,
): { text: string; tone: FinishTone } {
  const finish = Math.round(finishSeconds);
  const diff = finish - limitSeconds;
  const at = `Finishing at ${formatTime(finish)}`;
  if (diff <= 0) return { text: `${at} · ${gapLabel(diff)} spare`, tone: 'spare' };
  return { text: `${at} · ${gapLabel(diff)} over`, tone: elapsedSeconds > limitSeconds ? 'late' : 'over' };
}

/** e.g. "7s over → skip 'Seattle study' (saves 18s)" or "12s spare → added back 'Setup details' (+18s)". */
export function describeChanges(changes: PlanChange[], cards: Card[], overSeconds: number, wrapUp: boolean): string {
  if (wrapUp) return 'Wrap up: required points only';
  const byId = new Map(cards.map((c) => [c.id, c]));
  const name = (id: string) => `'${cardTitle(byId.get(id)!) || '(empty card)'}'`;
  const parts = changes.map((ch) => {
    switch (ch.kind) {
      case 'skip':
        return `skip ${name(ch.id)} (saves ${ch.savesSeconds}s)`;
      case 'short':
        return `short version of ${name(ch.id)} (saves ${ch.savesSeconds}s)`;
      case 'full':
        return `full version of ${name(ch.id)} (+${ch.addsSeconds}s)`;
      case 'add':
        return `added back ${name(ch.id)} (+${ch.addsSeconds}s)`;
    }
  });
  const why = overSeconds > 0 ? `${gapLabel(overSeconds)} over` : `${gapLabel(overSeconds)} spare`;
  return `${why} → ${parts.join(', ')}`;
}

/** Total planned seconds of an upcoming plan. */
export function planSeconds(plan: LivePlan, cards: Card[]): number {
  const byId = new Map(cards.map((c) => [c.id, c]));
  return plan.ids.reduce((t, id) => t + spokenCard(byId.get(id)!, plan.shortIds).seconds, 0);
}
