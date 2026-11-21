import { describe, expect, it } from 'vitest';
import {
  ADD_BACK_SPARE_SECONDS,
  describeChanges,
  diffPlans,
  finishLabel,
  planSeconds,
  projectedFinish,
  replan,
  type LivePlan,
  type PlanChange,
  type SpokenEntry,
} from './live';
import { sampleTalk } from './sample';
import { selectCards, type FitResult } from './select';
import type { Card } from './types';

const card = (id: string, seconds: number, extra: Partial<Card> = {}): Card => ({
  id,
  title: `Card ${id}`,
  text: `Card ${id}`,
  seconds,
  tags: [],
  locked: false,
  ...extra,
});

const plan = (ids: string[], shortIds: string[] = []): LivePlan => ({ ids, shortIds });
const spokenIntro: SpokenEntry[] = [{ id: 'intro', short: false }];

describe('replan', () => {
  // Intro 10s, Seattle study p1 20s, Graph p5 10s, Conclusion (required) 10s = 50s.
  const cards = [
    card('intro', 10, { priority: 3 }),
    card('seattle', 20, { title: 'Seattle study', priority: 1 }),
    card('graph', 10, { priority: 5 }),
    card('end', 10, { tags: ['Conclusion'] }),
  ];
  const points = ['Conclusion'];

  it('behind: skips the lowest-priority optional card', () => {
    // The 10s intro took 20s → 32s left for 40s of planned cards.
    const current = plan(['seattle', 'graph', 'end']);
    const r = replan({ cards, requiredPoints: points, limitSeconds: 52, spoken: spokenIntro, elapsedSeconds: 20, current });
    expect(r.mode).toBe('behind');
    expect(r.wrapUp).toBe(false);
    expect(r.budgetSeconds).toBe(32);
    expect(r.overSeconds).toBe(8);
    expect(r.plan).toEqual(plan(['graph', 'end']));

    const changes = diffPlans(current, r.plan, cards);
    expect(changes).toEqual([{ kind: 'skip', id: 'seattle', savesSeconds: 20 }]);
    expect(describeChanges(changes, cards, r.overSeconds, false)).toBe("8s over → skip 'Seattle study' (saves 20s)");
  });

  it('behind: prefers a short version when that is the better value', () => {
    const talk = [
      card('intro', 10),
      card('story', 30, { title: "Grandma's bakery story", priority: 5, short: { text: 'Short', seconds: 12 } }),
      card('extra', 12, { priority: 1 }),
      card('end', 10, { tags: ['Conclusion'] }),
    ];
    // 36s left for 52s: short story + extra + end (34s, score 40) beats skipping the story (22s, score 10).
    const current = plan(['story', 'extra', 'end']);
    const r = replan({ cards: talk, requiredPoints: points, limitSeconds: 56, spoken: spokenIntro, elapsedSeconds: 20, current });
    expect(r.plan).toEqual(plan(['story', 'extra', 'end'], ['story']));
    const changes = diffPlans(current, r.plan, talk);
    expect(changes).toEqual([{ kind: 'short', id: 'story', savesSeconds: 18 }]);
    expect(describeChanges(changes, talk, r.overSeconds, false)).toBe(
      "16s over → short version of 'Grandma's bakery story' (saves 18s)",
    );
  });

  it('ahead: adds back a cut card that fits', () => {
    // The plan cut Seattle (graph + end = 20s still to say). 40s left → 20s spare.
    const current = plan(['graph', 'end']);
    const r = replan({ cards, requiredPoints: points, limitSeconds: 42, spoken: spokenIntro, elapsedSeconds: 2, current });
    expect(r.mode).toBe('ahead');
    expect(r.plan.ids).toEqual(['seattle', 'graph', 'end']);
    const changes = diffPlans(current, r.plan, cards);
    expect(changes).toEqual([{ kind: 'add', id: 'seattle', addsSeconds: 20 }]);
    expect(describeChanges(changes, cards, r.overSeconds, false)).toBe("20s spare → added back 'Seattle study' (+20s)");
  });

  it('ahead: restores a full version', () => {
    const talk = [card('intro', 10), card('story', 30, { priority: 5, short: { text: 'Short', seconds: 12 } }), card('end', 10)];
    const current = plan(['story', 'end'], ['story']); // 22s planned
    const r = replan({ cards: talk, requiredPoints: [], limitSeconds: 50, spoken: spokenIntro, elapsedSeconds: 10, current });
    expect(r.plan).toEqual(plan(['story', 'end']));
    expect(diffPlans(current, r.plan, talk)).toEqual([{ kind: 'full', id: 'story', addsSeconds: 18 }]);
  });

  it('does not require points already covered by spoken cards', () => {
    const talk = [
      card('q1', 10, { tags: ['Question'] }),
      card('fun', 10, { priority: 2 }),
      card('q2', 15, { tags: ['Question'] }),
      card('end', 10, { tags: ['Conclusion'] }),
    ];
    // 20s left for q2 + end (25s). Without the spoken q1, "Question" would make q2 required and nothing would fit.
    const r = replan({
      cards: talk,
      requiredPoints: ['Question', 'Conclusion'],
      limitSeconds: 35,
      spoken: [{ id: 'q1', short: false }],
      elapsedSeconds: 15,
      current: plan(['q2', 'end']),
    });
    expect(r.wrapUp).toBe(false);
    expect(r.plan.ids).toEqual(['end']);
  });

  it('keeps locked cards even when that means skipping more', () => {
    const talk = [card('intro', 10), card('lockedStory', 20, { locked: true }), card('graph', 10, { priority: 5 }), card('end', 10, { tags: ['Conclusion'] })];
    const r = replan({
      cards: talk,
      requiredPoints: points,
      limitSeconds: 45,
      spoken: spokenIntro,
      elapsedSeconds: 15,
      current: plan(['lockedStory', 'graph', 'end']),
    });
    expect(r.plan.ids).toEqual(['lockedStory', 'end']);
  });

  it('never changes or repeats spoken cards', () => {
    const spoken = [
      { id: 'intro', short: false },
      { id: 'seattle', short: false },
    ];
    const snapshot = structuredClone(spoken);
    const r = replan({ cards, requiredPoints: points, limitSeconds: 100, spoken, elapsedSeconds: 30, current: plan(['graph', 'end']) });
    expect(spoken).toEqual(snapshot);
    expect(r.plan.ids).toEqual(['graph', 'end']);
  });

  it('only looks forward: a card cut before the current position is not brought back', () => {
    const r = replan({
      cards,
      requiredPoints: points,
      limitSeconds: 200,
      spoken: [
        { id: 'intro', short: false },
        { id: 'graph', short: false },
      ],
      elapsedSeconds: 20,
      current: plan(['end']),
    });
    expect(r.plan.ids).toEqual(['end']);
  });

  it("can't fit: falls back to the shortest valid plan and says wrap up", () => {
    const r = replan({
      cards,
      requiredPoints: points,
      limitSeconds: 30,
      spoken: spokenIntro,
      elapsedSeconds: 28,
      current: plan(['seattle', 'graph', 'end']),
    });
    expect(r.wrapUp).toBe(true);
    expect(r.budgetSeconds).toBe(2);
    expect(r.plan).toEqual(plan(['end']));
    expect(describeChanges([], cards, r.overSeconds, true)).toBe('Wrap up: required points only');
  });

  it('nothing left to say: empty plan', () => {
    const spoken = cards.map((c) => ({ id: c.id, short: false }));
    expect(replan({ cards, requiredPoints: points, limitSeconds: 60, spoken, elapsedSeconds: 50, current: plan([]) }).plan.ids).toEqual([]);
  });
});

describe('replan stays calm', () => {
  const talk = [card('intro', 10), card('tiny', 5, { priority: 5 }), card('end', 10, { tags: ['Conclusion'] })];
  const current = plan(['end']); // tiny was cut

  it(`makes no change while the plan fits with less than ${ADD_BACK_SPARE_SECONDS}s spare`, () => {
    // Up to 17s left for 10s planned (7s spare): "tiny" would fit, but it's not worth a change.
    for (const left of [10, 13, 17]) {
      const r = replan({ cards: talk, requiredPoints: ['Conclusion'], limitSeconds: 10 + left, spoken: spokenIntro, elapsedSeconds: 10, current });
      expect(r.mode).toBe('keep');
      expect(r.plan).toEqual(current);
    }
    // At exactly 8s spare it adds the card back.
    const r = replan({ cards: talk, requiredPoints: ['Conclusion'], limitSeconds: 28, spoken: spokenIntro, elapsedSeconds: 10, current });
    expect(r.mode).toBe('ahead');
    expect(r.plan.ids).toEqual(['tiny', 'end']);
  });

  it('behind only removes or shortens, never swaps in a better cut card', () => {
    // Plan: low-value A (p1, 20s) + end. B (p5, 10s) was cut. 25s left for 30s.
    // A free re-selection would swap A for B; behind may only cut.
    const cards = [card('intro', 10), card('a', 20, { priority: 1 }), card('b', 10, { priority: 5 }), card('end', 10, { tags: ['Conclusion'] })];
    const cur = plan(['a', 'end']);
    const r = replan({ cards, requiredPoints: ['Conclusion'], limitSeconds: 35, spoken: spokenIntro, elapsedSeconds: 10, current: cur });
    expect(r.mode).toBe('behind');
    expect(r.plan.ids).toEqual(['end']);
    const kinds = diffPlans(cur, r.plan, cards).map((c) => c.kind);
    expect(kinds.every((k) => k === 'skip' || k === 'short')).toBe(true);
  });

  it('behind never restores a full version', () => {
    const cards = [
      card('intro', 10),
      card('story', 20, { priority: 5, short: { text: 'Short', seconds: 8 } }),
      card('filler', 10, { priority: 1 }),
      card('end', 10, { tags: ['C'] }),
    ];
    const cur = plan(['story', 'filler', 'end'], ['story']); // 28s planned, 22s left
    const r = replan({ cards, requiredPoints: ['C'], limitSeconds: 32, spoken: spokenIntro, elapsedSeconds: 10, current: cur });
    expect(r.mode).toBe('behind');
    expect(r.plan).toEqual(plan(['story', 'end'], ['story']));
    expect(diffPlans(cur, r.plan, cards).map((c) => c.kind)).toEqual(['skip']);
  });

  it('ahead only adds or restores, never removes a planned card to make room', () => {
    // Plan: low-value A (p1, 20s), S short (6s), end = 36s; 50s left (14s spare). Cut B (p5, 25s) doesn't fit
    // alongside A. A free re-selection would drop A for B; ahead may only add or restore.
    const cards = [
      card('intro', 10),
      card('a', 20, { priority: 1 }),
      card('b', 25, { priority: 5 }),
      card('s', 20, { priority: 3, short: { text: 'Short', seconds: 6 } }),
      card('end', 10),
    ];
    const cur = plan(['a', 's', 'end'], ['s']);
    const r = replan({ cards, requiredPoints: [], limitSeconds: 60, spoken: spokenIntro, elapsedSeconds: 10, current: cur });
    expect(r.mode).toBe('ahead');
    expect(r.plan.ids).toEqual(expect.arrayContaining(['a', 's', 'end']));
    expect(r.plan.ids).not.toContain('b');
    const kinds = diffPlans(cur, r.plan, cards).map((c) => c.kind);
    expect(kinds).toEqual(['full']); // S goes back to full (+14s), nothing removed
  });

  it('fast taps through the sample talk never cause a remove-then-add flip', () => {
    const { cards, requiredPoints } = sampleTalk;
    const limit = 105;
    const first = selectCards(cards, requiredPoints, limit) as FitResult;
    for (const secondsPerCard of [1, 2, 4, 6]) {
      let current = plan(
        first.kept.map((c) => c.id),
        first.shortIds,
      );
      const spoken: SpokenEntry[] = [];
      const history: PlanChange[] = [];
      let elapsed = 0;
      while (current.ids.length > 0) {
        const [id, ...rest] = current.ids;
        spoken.push({ id, short: current.shortIds.includes(id) });
        elapsed += secondsPerCard;
        const before = plan(rest, current.shortIds.filter((s) => s !== id));
        const r = replan({ cards, requiredPoints, limitSeconds: limit, spoken, elapsedSeconds: elapsed, current: before });
        history.push(...diffPlans(before, r.plan, cards));
        current = r.plan;
      }
      // Racing ahead only ever adds or restores; nothing is removed, so nothing can flip back.
      expect(history.length).toBeGreaterThan(0);
      expect(history.every((c) => c.kind === 'add' || c.kind === 'full')).toBe(true);
      const ids = history.map((c) => c.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });
});

describe('projected finish', () => {
  it('is elapsed + what is left of the current card + the remaining plan', () => {
    expect(projectedFinish(30, 4, 12, 60)).toBe(98); // 8s left on this card
    expect(projectedFinish(30, 20, 12, 60)).toBe(90); // card already over: no more time for it
  });

  it('labels spare, over and late', () => {
    expect(finishLabel(103, 105, 40)).toEqual({ text: 'Finishing at 1:43 · 2s spare', tone: 'spare' });
    expect(finishLabel(105, 105, 40)).toEqual({ text: 'Finishing at 1:45 · 0s spare', tone: 'spare' });
    expect(finishLabel(112, 105, 40)).toEqual({ text: 'Finishing at 1:52 · 7s over', tone: 'over' });
    expect(finishLabel(118, 105, 110)).toEqual({ text: 'Finishing at 1:58 · 13s over', tone: 'late' });
    expect(finishLabel(206, 105, 0).text).toBe('Finishing at 3:26 · 1:41 over');
  });

  it('drops right after a skip', () => {
    const cards = [card('intro', 10), card('s', 20, { priority: 1 }), card('end', 10, { tags: ['C'] })];
    const before = plan(['s', 'end']);
    const r = replan({ cards, requiredPoints: ['C'], limitSeconds: 40, spoken: spokenIntro, elapsedSeconds: 20, current: before });
    const rest = (p: LivePlan) => planSeconds({ ids: p.ids.slice(1), shortIds: p.shortIds }, cards);
    const first = (p: LivePlan) => cards.find((c) => c.id === p.ids[0])!.seconds;
    expect(projectedFinish(20, 0, first(before), rest(before))).toBe(50);
    expect(projectedFinish(20, 0, first(r.plan), rest(r.plan))).toBe(30);
  });
});
