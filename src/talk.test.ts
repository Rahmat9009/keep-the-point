import { describe, expect, it } from 'vitest';
import { sampleTalk } from './sample';
import { STORAGE_KEY, loadState, parseSavedState, saveState, type KeyValueStore } from './storage';
import { addPoint, moveCard, removePoint } from './talk';

const ids = (cards: { id: string }[]) => cards.map((c) => c.id).join('');

describe('moveCard', () => {
  const cards = sampleTalk.cards.slice(0, 3); // ids 1, 2, 3
  it('moves a card up and down', () => {
    expect(ids(moveCard(cards, 1, -1))).toBe('213');
    expect(ids(moveCard(cards, 1, 1))).toBe('132');
  });
  it('does nothing at the ends', () => {
    expect(moveCard(cards, 0, -1)).toBe(cards);
    expect(moveCard(cards, 2, 1)).toBe(cards);
  });
});

describe('required points', () => {
  it('adds a trimmed point', () => {
    expect(addPoint(sampleTalk, '  Ethics ').talk?.requiredPoints.at(-1)).toBe('Ethics');
  });
  it('rejects blanks and duplicates (any case)', () => {
    expect(addPoint(sampleTalk, '   ').error).toBeTruthy();
    expect(addPoint(sampleTalk, 'evidence').error).toMatch(/already/);
  });
  it('removing a point untags every card', () => {
    const talk = removePoint(sampleTalk, 'Evidence');
    expect(talk.requiredPoints).toEqual(['Question', 'Method', 'Conclusion']);
    expect(talk.cards.find((c) => c.id === '6')!.tags).toEqual([]);
  });
});

describe('storage', () => {
  const memory = (): KeyValueStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return {
      data,
      getItem: (k) => data.get(k) ?? null,
      setItem: (k, v) => void data.set(k, v),
      removeItem: (k) => void data.delete(k),
    };
  };

  it('round-trips a talk', () => {
    const store = memory();
    saveState({ talk: sampleTalk, limit: '1:30' }, store);
    expect(loadState(store)).toEqual({ talk: sampleTalk, limit: '1:30' });
  });

  it('survives broken or blocked storage', () => {
    const store = memory();
    store.data.set(STORAGE_KEY, '{not json');
    expect(loadState(store)).toBeNull();
    const throwing: KeyValueStore = {
      getItem: () => { throw new Error('blocked'); },
      setItem: () => { throw new Error('full'); },
      removeItem: () => { throw new Error('blocked'); },
    };
    expect(loadState(throwing)).toBeNull();
    expect(saveState({ talk: sampleTalk, limit: '2:00' }, throwing)).toBe(false);
    expect(loadState(null)).toBeNull();
  });

  it('drops malformed cards and tags for points that no longer exist', () => {
    const state = parseSavedState({
      limit: '2:00',
      talk: {
        title: 'T',
        requiredPoints: ['A'],
        cards: [
          { id: 'x', text: 'ok', seconds: 10, tags: ['A', 'Gone'], locked: true, priority: 9 },
          { id: 'y', text: 'bad seconds', seconds: -1, tags: [] },
          'nonsense',
        ],
      },
    });
    expect(state!.talk.cards).toEqual([{ id: 'x', text: 'ok', seconds: 10, tags: ['A'], locked: true }]);
  });
});
