import type { Talk } from './types';

/**
 * Science fair sample talk: 8 cards, 2:38 in total. The bakery story has a short version (8s).
 * Each card's spoken text runs at 2.5 words per second, so its word count matches its seconds.
 */
export const sampleTalk: Talk = {
  title: 'Science fair: does bread dough rise faster in warmer places?',
  requiredPoints: ['Question', 'Method', 'Evidence', 'Conclusion'],
  cards: [
    {
      id: '1',
      title: 'Hook',
      text: 'Have you ever wondered why bakers keep their dough somewhere warm? I did, so I spent three weekends watching bread dough rise in jars on my kitchen counter at home.',
      seconds: 12,
      tags: [],
      locked: false,
      priority: 4,
    },
    {
      id: '2',
      title: 'Research question',
      text: 'My research question was simple: does bread dough rise faster in warmer places? I predicted that warmer dough would rise faster, because yeast is alive and living things are more active when they are warm.',
      seconds: 14,
      tags: ['Question'],
      locked: false,
    },
    {
      id: '3',
      title: "Grandma's bakery story",
      text: "When I was little, I spent every Saturday at my grandma's bakery. She got up before sunrise to mix the dough, and she always set the bowls on a shelf right next to the big warm oven. One winter morning the heating broke, the whole bakery was cold, and the bread came out flat and heavy. Grandma just laughed and said the dough was too cold to wake up. I never forgot that day. So when our teacher asked us to pick a question we could test at home, I remembered her shelf by the oven. I wanted to know if she was right, and if she was, exactly how much the warmth really mattered.",
      seconds: 46,
      tags: [],
      locked: false,
      priority: 1,
      // Demo short version: with it the whole talk fits 2:00 (the story is shortened instead of cut).
      short: { text: 'Grandma always let her dough rise by the warm oven. That gave me my question.', seconds: 8 },
    },
    {
      id: '4',
      title: 'Method',
      text: 'To test it, I made three batches of dough from the same recipe: flour, water, salt and the same amount of yeast. I put each batch in a clear jar and marked the starting height with a rubber band. I kept one jar at 18 degrees, one at 24 degrees and one at 30 degrees.',
      seconds: 22,
      tags: ['Method'],
      locked: false,
    },
    {
      id: '5',
      title: 'Setup details',
      text: 'The 18 degree jar sat in our cool hallway, the 24 degree jar stayed on the kitchen counter, and the 30 degree jar went in the oven with the light on. I checked each spot with a thermometer and measured every jar every fifteen minutes.',
      seconds: 18,
      tags: [],
      locked: false,
      priority: 3,
    },
    {
      id: '6',
      title: 'Results',
      text: 'The warmer the dough, the faster it rose. The 30 degree jar doubled in height in about 50 minutes. The 24 degree jar took about 80 minutes. The 18 degree jar never doubled in two hours. I repeated the whole test three times and got the same order every time.',
      seconds: 20,
      tags: ['Evidence'],
      locked: false,
    },
    {
      id: '7',
      title: 'Graph explanation',
      text: 'On my graph, each line is one jar. Time goes along the bottom and height goes up the side. The red 30 degree line climbs the steepest, and the blue 18 degree line stays flattest.',
      seconds: 14,
      tags: [],
      locked: false,
      priority: 4,
    },
    {
      id: '8',
      title: 'Conclusion',
      text: "So my prediction was right: warmer dough rises faster, at least up to 30 degrees. Grandma was right. Next I'll test how hot dough can get before the yeast dies.",
      seconds: 12,
      tags: ['Conclusion'],
      locked: false,
    },
  ],
};

/** Card labels of the earlier sample, which had no spoken text. */
const OLD_SAMPLE_LABELS = ['Hook', 'Research question', "Grandma's bakery story", 'Method', 'Setup details', 'Results', 'Graph explanation', 'Conclusion'];

/**
 * A saved talk that is still the earlier label-only sample (cards unchanged) is replaced by
 * the current sample, keeping the time limit. Anything the student wrote is left alone.
 */
export function upgradeOldSample<T extends { talk: Talk } | null>(saved: T): T {
  if (!saved) return saved;
  const cards = saved.talk.cards;
  const isOld = cards.length === OLD_SAMPLE_LABELS.length && cards.every((c, i) => !c.title && c.text === OLD_SAMPLE_LABELS[i]);
  return isOld ? { ...saved, talk: structuredClone(sampleTalk) } : saved;
}
