# Keep the Point

A web app for students whose presentation runs too long. You give it your talk as cards, the points you must cover, and your time limit, and it tells you what to cut.

Step 1 (this version): the selection logic, tests, and one screen showing a sample science-fair talk.

## Running it

```
npm install
npm run dev     # opens the app at http://localhost:5173
npm test        # runs the tests
```

## How the selection works

Each card has a spoken length in seconds. Some cards cover a **required point** (like "Evidence"). Some are **optional** and have a priority from 1 (nice to have) to 5 (really want it). Any card can be **locked**, meaning "never cut this".

To fit your time limit, the app:

1. **Keeps every locked card.**
2. **Tries every possible mix of the other cards.** With 12 cards at most, that's at most 4,096 mixes, so it can check all of them rather than guessing.
3. **Throws out any mix that runs over time** or that drops a required point (no card left that covers it).
4. **Picks the mix with the most total priority.** If two mixes tie, it takes the one that uses more of your time.
5. **Shows the result in your original order.** Cut cards say why they went, e.g. "Optional, priority 1 — saves 46s".

If nothing fits, it says so and shows the **shortest talk that still covers every required point** (plus your locked cards), so you know how much time you'd need or what else to trim.
