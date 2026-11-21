import { describe, expect, it } from 'vitest';
import { cueSheetHtml, printSheetHtml } from './cueView';
import { rehearsalSteps, speakerName, speakerTimes } from './group';
import { makeRun, progressLine } from './insights';
import { describeChanges, diffPlans, replan } from './live';
import { initialPlan } from './liveView';
import { parseSavedState } from './storage';
import type { Card, Talk } from './types';

function card(id: string, seconds: number, speaker?: string, tags: string[] = []): Card {
  return { id, title: id, text: id, seconds, speaker, tags, locked: false, priority: 2 };
}

describe('group presentations', () => {
  const intro = card('Introduction', 30, 'Amina', ['claim']);
  const detail = card('Optional detail', 15, 'Omar');
  const proof = card('Evidence', 20, 'Omar', ['evidence']);
  const close = card('Conclusion', 10, 'Amina');

  it('uses consistent speaker names and accepts old saved talks', () => {
    expect(speakerName('  oMAR  ', [detail])).toBe('Omar');
    expect(speakerName('  Amina   Khan  ')).toBe('Amina Khan');
    expect(speakerName('   ')).toBeUndefined();
    expect(speakerName('a'.repeat(70))).toHaveLength(60);

    const saved = parseSavedState({
      talk: { title: 'Group', requiredPoints: [], groupMode: true, cards: [intro, { ...proof, speaker: '  amina ' }] },
      limit: '1:00',
    });
    expect(saved?.talk.groupMode).toBe(true);
    expect(saved?.talk.cards.map((entry) => entry.speaker)).toEqual(['Amina', 'Amina']);
    const solo = parseSavedState({ talk: { title: 'Solo', requiredPoints: [], cards: [card('solo', 5)] }, limit: '1:00' });
    expect(solo?.talk.groupMode).toBeUndefined();
    expect(solo?.talk.cards[0].speaker).toBeUndefined();
  });

  it('times actual speaker changes and leaves the solo tap sequence intact', () => {
    const cards = [intro, detail, proof, close];
    expect(rehearsalSteps(cards, true).map((step) => step.kind === 'card' ? step.card.id : step.to.speaker))
      .toEqual(['Introduction', 'Omar', 'Optional detail', 'Evidence', 'Amina', 'Conclusion']);
    expect(rehearsalSteps(cards, false).map((step) => step.kind)).toEqual(['card', 'card', 'card', 'card']);
    expect(rehearsalSteps([intro, card('unassigned', 10), proof], true).every((step) => step.kind === 'card')).toBe(true);
  });

  it('sums repeated speaking turns and includes handoffs in practice progress', () => {
    expect([...speakerTimes([intro, detail, proof, close], (entry) => entry.seconds)])
      .toEqual([['Amina', 40], ['Omar', 35]]);
    const run = makeRun('full', [{ id: intro.id, planned: 30, actual: 31 }], 0, 5);
    expect(run.cards[0].actual).toBe(31);
    expect(progressLine([run])).toBe('0:36');
  });

  it('shows handoffs through a cut on screen and in print and escapes speaker names', () => {
    const talk: Talk = {
      title: 'Group talk',
      groupMode: true,
      requiredPoints: ['claim', 'evidence'],
      cards: [intro, detail, { ...proof, speaker: '<Omar>' }],
    };
    const sheet = cueSheetHtml(talk, 50, true);
    expect(sheet).toContain('Speaker: Amina');
    expect(sheet).toContain('Hand off to &#60;Omar&#62;');
    expect(sheet).not.toContain('<Omar>');
    expect(printSheetHtml(talk, 50)).toContain('Hand off to &#60;Omar&#62;');
    expect(cueSheetHtml({ ...talk, groupMode: false }, 50, true)).not.toContain('Hand off');
  });

  it('points to the next speaker’s optional cut after an overrun and keeps required coverage', () => {
    const talk: Talk = { title: 'Group', groupMode: true, requiredPoints: ['claim', 'evidence'], cards: [intro, detail, proof] };
    const { plan } = initialPlan(talk, 65);
    expect(plan.ids).toEqual([intro.id, detail.id, proof.id]);
    const current = { ids: plan.ids.slice(1), shortIds: [] };
    const result = replan({
      cards: talk.cards,
      requiredPoints: talk.requiredPoints,
      limitSeconds: 65,
      spoken: [{ id: intro.id, short: false }],
      elapsedSeconds: 45,
      current,
    });
    expect(result.plan.ids).toEqual([proof.id]);
    expect(result.wrapUp).toBe(false);
    expect(describeChanges(diffPlans(current, result.plan, talk.cards), talk.cards, result.overSeconds, false, true))
      .toContain("skip 'Optional detail' (Omar)");
  });
});
