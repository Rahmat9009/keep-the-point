import './style.css';
import { sampleTalk } from './sample';
import { selectCards, type SelectionResult } from './select';
import { formatTime, parseTime } from './time';
import type { Talk } from './types';

const talk: Talk = sampleTalk;
const fullSeconds = talk.cards.reduce((t, c) => t + c.seconds, 0);
const DEFAULT_LIMIT = '2:00';

const app = document.querySelector<HTMLElement>('#app')!;
app.innerHTML = `
  <header>
    <p class="eyebrow">Keep the Point</p>
    <h1>${escapeHtml(talk.title)}</h1>
    <label class="limit">
      Time limit
      <input id="limit" type="text" inputmode="numeric" value="${DEFAULT_LIMIT}" placeholder="mm:ss" aria-describedby="limit-error" />
    </label>
    <p id="limit-error" class="error" role="alert"></p>
    <p id="summary" class="summary" aria-live="polite"></p>
  </header>
  <section aria-labelledby="cards-h">
    <h2 id="cards-h">Cards</h2>
    <ol id="cards" class="cards"></ol>
  </section>
  <section aria-labelledby="points-h">
    <h2 id="points-h">Required points</h2>
    <ul id="points" class="points"></ul>
  </section>
`;

const input = app.querySelector<HTMLInputElement>('#limit')!;
const errorEl = app.querySelector<HTMLElement>('#limit-error')!;
const summaryEl = app.querySelector<HTMLElement>('#summary')!;
const cardsEl = app.querySelector<HTMLElement>('#cards')!;
const pointsEl = app.querySelector<HTMLElement>('#points')!;

input.addEventListener('input', update);
update();

function update() {
  const budget = parseTime(input.value);
  if (budget === null) {
    errorEl.textContent = 'Enter a time like 2:00';
    input.setAttribute('aria-invalid', 'true');
    return; // keep showing the last valid result
  }
  errorEl.textContent = '';
  input.removeAttribute('aria-invalid');
  render(selectCards(talk.cards, talk.requiredPoints, budget));
}

function render(result: SelectionResult) {
  const full = formatTime(fullSeconds);

  if (result.fits) {
    summaryEl.className = 'summary';
    summaryEl.textContent = `${full} → ${formatTime(result.totalSeconds)} · ${result.spareSeconds}s spare`;
  } else {
    summaryEl.className = 'summary summary--bad';
    summaryEl.textContent = result.shortest
      ? `${full} → can't fit ${formatTime(result.budgetSeconds)} · shortest valid talk is ${formatTime(result.shortest.totalSeconds)} (${result.shortest.overBySeconds}s over)`
      : `Can't build a valid talk: no card covers ${result.uncoverablePoints.join(', ')}`;
  }

  // In the no-fit case, show the shortest valid talk as the "kept" set.
  const keptIds = new Set(
    result.fits ? result.kept.map((c) => c.id) : (result.shortest?.cards ?? []).map((c) => c.id),
  );
  const reasons = new Map(result.fits ? result.cut.map((c) => [c.card.id, c.reason]) : []);

  cardsEl.innerHTML = talk.cards
    .map((card) => {
      const kept = keptIds.has(card.id);
      const meta = [
        card.locked ? 'Locked' : null,
        card.tags.length ? card.tags.join(', ') : null,
        card.priority !== undefined ? `Priority ${card.priority}` : null,
      ]
        .filter(Boolean)
        .join(' · ');
      const reason = kept ? '' : (reasons.get(card.id) ?? (result.fits ? '' : 'Not in the shortest valid talk'));
      return `
        <li class="card ${kept ? '' : 'card--cut'}">
          <div class="card__main">
            <span class="card__text">${escapeHtml(card.text)}</span>
            <span class="card__time">${card.seconds}s</span>
          </div>
          ${meta ? `<div class="card__meta">${escapeHtml(meta)}</div>` : ''}
          ${reason ? `<div class="card__reason">${escapeHtml(reason)}</div>` : ''}
        </li>`;
    })
    .join('');

  const keptCards = talk.cards.filter((c) => keptIds.has(c.id));
  pointsEl.innerHTML = talk.requiredPoints
    .map((point) => {
      const by = keptCards.filter((c) => c.tags.includes(point)).map((c) => c.text);
      return `
        <li class="${by.length ? '' : 'missing'}">
          <span class="point">${escapeHtml(point)}</span>
          <span class="by">${by.length ? escapeHtml(by.join(', ')) : 'Not covered'}</span>
        </li>`;
    })
    .join('');
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
