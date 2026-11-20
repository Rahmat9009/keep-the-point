import type { Talk } from './types';

/** Science fair sample talk: 8 cards, 2:38 in total. The bakery story has a short version (8s). */
export const sampleTalk: Talk = {
  title: 'Science fair: does sourdough rise faster when it is warm?',
  requiredPoints: ['Question', 'Method', 'Evidence', 'Conclusion'],
  cards: [
    { id: '1', text: 'Hook', seconds: 12, tags: [], locked: false, priority: 4 },
    { id: '2', text: 'Research question', seconds: 14, tags: ['Question'], locked: false },
    {
      id: '3',
      text: "Grandma's bakery story",
      seconds: 46,
      tags: [],
      locked: false,
      priority: 1,
      // Demo short version: with it the whole talk fits 2:00 (the story is shortened instead of cut).
      short: { text: 'Grandma always let her dough rise by the warm oven. That gave me my question.', seconds: 8 },
    },
    { id: '4', text: 'Method', seconds: 22, tags: ['Method'], locked: false },
    { id: '5', text: 'Setup details', seconds: 18, tags: [], locked: false, priority: 3 },
    { id: '6', text: 'Results', seconds: 20, tags: ['Evidence'], locked: false },
    { id: '7', text: 'Graph explanation', seconds: 14, tags: [], locked: false, priority: 4 },
    { id: '8', text: 'Conclusion', seconds: 12, tags: ['Conclusion'], locked: false },
  ],
};
