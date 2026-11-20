# Keep the Point

A web app for students whose presentation runs too long. You give it your talk as cards, the points you must cover, and your time limit, and it tells you what to cut.

What it does so far:

- **Your own talk.** Paste an outline (one card per line) and click **Make cards**, or start from the sample science-fair talk.
- **Edit cards.** Change the text and seconds, tag the required points each card covers, lock cards you must keep, set priority 1-5, reorder, add and delete. Up to 12 cards.
- **Estimated times.** New cards get a guess from their word count (150 words a minute, at least 3 seconds), shown as `~12s` until you type a real time.
- **Live results.** The result updates as you type.
- **Saved automatically** in your browser. **Clear** starts fresh.
- **Rehearse.** Time yourself on the full talk or just the cards that fit. Press Space (or tap) to move to the next card, ← to re-time the previous card, Esc to cancel. At the end, compare old and new times and choose whether to save them.
- **Cue cards.** See (and print, about 4 per A4 page) just the cards you're keeping, with a "✂ Cut here" marker wherever something was cut, so you know where to add a smooth bridge. Changed your mind? Click a marker and choose "Keep this card".

## Running it

```
npm install
npm run dev     # opens the app at http://localhost:5173
npm test        # runs the tests
```

## AI suggestions (optional)

The app works fully without AI. With a Google Gemini API key, two extra buttons can suggest wording:

- **✨ Shorten** on each card asks for a short version (about half the time) that keeps your voice and every fact. You can accept, edit or discard it, or write your own.
- **✨ Suggest bridge** on each ✂ cut marker in the cue cards asks for one linking sentence (max 15 words).

The key stays on the server (`api/shorten.ts`, `api/bridge.ts`, Vercel functions). For local use, put it in `.env.local` (gitignored):

```
GEMINI_API_KEY=your-key
```

On Vercel, add `GEMINI_API_KEY` under Project → Settings → Environment Variables. `npm run build` checks that no key ended up in `dist/`. AI suggestions are sent to Google Gemini, so don't include private information.

## How the selection works

Each card has a spoken length in seconds. Some cards cover a **required point** (like "Evidence"). Some are **optional** and have a priority from 1 (nice to have) to 5 (really want it). Any card can be **locked**, meaning "never cut this".

To fit your time limit, the app:

1. **Keeps every locked card, in full.**
2. **Tries every possible mix of the other cards.** Each card can be said in full, said as its **short version** (if it has one), or cut. With 12 cards at most, that's at most 3^12 = 531,441 mixes, so it can check all of them rather than guessing. A short version counts for 60% of the card's priority, and keeps the card's required-point tags.
3. **Throws out any mix that runs over time** or that drops a required point (no card left that covers it).
4. **Picks the mix with the most total priority.** If two mixes tie, it takes the one that uses more of your time.
5. **Shows the result in your original order.** Cut cards say why they went, e.g. "Optional, priority 1 — saves 46s".

If nothing fits, it says so and shows the **shortest talk that still covers every required point** (plus your locked cards), so you know how much time you'd need or what else to trim.
