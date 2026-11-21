import { describe, expect, it } from 'vitest';
import { describeChanges, diffPlans, paceLabel, paceSeconds, replan } from './live';
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
    // Planned 50s of 52s; the 10s intro took 20s → 32s left for 40s of cards.
    const r = replan({ cards, requiredPoints: points, limitSeconds: 52, spoken: [{ id: 'intro', short: false }], elapsedSeconds: 20 });
    expect(r.wrapUp).toBe(false);
    expect(r.budgetSeconds).toBe(32);
    expect(r.plan).toEqual({ ids: ['graph', 'end'], shortIds: [] });

    const before = { ids: ['seattle', 'graph', 'end'], shortIds: [] };
    const changes = diffPlans(before, r.plan, cards);
    expect(changes).toEqual([{ kind: 'skip', id: 'seattle', savesSeconds: 20 }]);
    expect(describeChanges(changes, cards, paceSeconds(20_000, 10, 0, 10), false)).toBe(
      "10s behind → skip 'Seattle study' (saves 20s)",
    );
  });

  it('behind: prefers a short version when that is the better value', () => {
    const talk = [
      card('a', 10),
      card('story', 30, { title: "Grandma's bakery story", priority: 5, short: { text: 'Short', seconds: 12 } }),
      card('extra', 12, { priority: 1 }),
      card('end', 10, { tags: ['Conclusion'] }),
    ];
    // 36s left for 52s: short story + extra + end (34s, score 40) beats skipping the story (22s, score 10).
    const r = replan({ cards: talk, requiredPoints: points, limitSeconds: 56, spoken: [{ id: 'a', short: false }], elapsedSeconds: 20 });
    expect(r.plan).toEqual({ ids: ['story', 'extra', 'end'], shortIds: ['story'] });
    const changes = diffPlans({ ids: ['story', 'extra', 'end'], shortIds: [] }, r.plan, talk);
    expect(changes).toEqual([{ kind: 'short', id: 'story', savesSeconds: 18 }]);
    expect(describeChanges(changes, talk, 0, false)).toBe("→ short version of 'Grandma's bakery story' (saves 18s)");
  });

  it('ahead: adds back a cut card that fits', () => {
    // At 42s the plan cut Seattle (intro, graph, end = 30s). The intro took only 2s → 40s left.
    const r = replan({ cards, requiredPoints: points, limitSeconds: 42, spoken: [{ id: 'intro', short: false }], elapsedSeconds: 2 });
    expect(r.plan.ids).toEqual(['seattle', 'graph', 'end']);
    const changes = diffPlans({ ids: ['graph', 'end'], shortIds: [] }, r.plan, cards);
    expect(changes).toEqual([{ kind: 'add', id: 'seattle', addsSeconds: 20 }]);
    expect(describeChanges(changes, cards, paceSeconds(2_000, 10, 0, 10), false)).toBe(
      "8s ahead → added back 'Seattle study' (+20s)",
    );
  });

  it('does not require points already covered by spoken cards', () => {
    const talk = [
      card('q1', 10, { tags: ['Question'] }),
      card('fun', 10, { priority: 2 }),
      card('q2', 15, { tags: ['Question'] }),
      card('end', 10, { tags: ['Conclusion'] }),
    ];
    // Without the spoken q1, "Question" would force q2 (15s) over the 10s optional card.
    const r = replan({
      cards: talk,
      requiredPoints: ['Question', 'Conclusion'],
      limitSeconds: 40,
      spoken: [{ id: 'q1', short: false }],
      elapsedSeconds: 15,
    });
    expect(r.wrapUp).toBe(false);
    expect(r.plan.ids).toEqual(['fun', 'end']);
  });

  it('keeps locked cards even when that means skipping more', () => {
    const talk = [card('a', 10), card('lockedStory', 20, { locked: true }), card('graph', 10, { priority: 5 }), card('end', 10, { tags: ['Conclusion'] })];
    const r = replan({ cards: talk, requiredPoints: points, limitSeconds: 45, spoken: [{ id: 'a', short: false }], elapsedSeconds: 15 });
    expect(r.plan.ids).toEqual(['lockedStory', 'end']);
  });

  it('never changes or repeats spoken cards', () => {
    const spoken = [
      { id: 'intro', short: false },
      { id: 'seattle', short: false },
    ];
    const snapshot = structuredClone(spoken);
    const r = replan({ cards, requiredPoints: points, limitSeconds: 100, spoken, elapsedSeconds: 30 });
    expect(spoken).toEqual(snapshot);
    expect(r.plan.ids).toEqual(['graph', 'end']);
    expect(r.plan.ids).not.toContain('intro');
    expect(r.plan.ids).not.toContain('seattle');
  });

  it('only looks forward: a card cut before the current position is not brought back', () => {
    // Seattle was skipped earlier and Graph has been said; lots of time left.
    const r = replan({
      cards,
      requiredPoints: points,
      limitSeconds: 200,
      spoken: [
        { id: 'intro', short: false },
        { id: 'graph', short: false },
      ],
      elapsedSeconds: 20,
    });
    expect(r.plan.ids).toEqual(['end']);
  });

  it("can't fit: falls back to the shortest valid plan and says wrap up", () => {
    const r = replan({ cards, requiredPoints: points, limitSeconds: 30, spoken: [{ id: 'intro', short: false }], elapsedSeconds: 28 });
    expect(r.wrapUp).toBe(true);
    expect(r.budgetSeconds).toBe(2);
    expect(r.plan).toEqual({ ids: ['end'], shortIds: [] });
    expect(describeChanges([], cards, 18, true)).toBe('Wrap up: required points only');
  });

  it('nothing left to say: empty plan', () => {
    const spoken = cards.map((c) => ({ id: c.id, short: false }));
    expect(replan({ cards, requiredPoints: points, limitSeconds: 60, spoken, elapsedSeconds: 50 }).plan.ids).toEqual([]);
  });
});

describe('pace', () => {
  it('compares actual time with planned time, counting overrun on the current card', () => {
    expect(paceSeconds(26_000, 20, 0, 10)).toBe(6);
    expect(paceSeconds(12_000, 20, 0, 10)).toBe(-8);
    expect(paceSeconds(20_000, 20, 14_000, 10)).toBe(4); // 4s over on the card being said
    expect(paceSeconds(20_000, 20, 5_000, 10)).toBe(0); // still within the current card's time
  });

  it('labels', () => {
    expect(paceLabel(2.4)).toEqual({ text: 'On track', tone: 'ok' });
    expect(paceLabel(6.2)).toEqual({ text: '6s behind', tone: 'behind' });
    expect(paceLabel(-8)).toEqual({ text: '8s ahead', tone: 'ahead' });
    expect(paceLabel(101)).toEqual({ text: '1:41 behind', tone: 'behind' });
  });
});
