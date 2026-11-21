import {
  describeChanges,
  gapLabel,
  diffPlans,
  finishLabel,
  planSeconds,
  plannedSeconds,
  projectedFinish,
  replan,
  type LivePlan,
  type SpokenEntry,
} from './live';
import { msToCardSeconds } from './rehearsal';
import { cardTitle } from './outline';
import { selectCards } from './select';
import { formatTime } from './time';
import type { Card, Talk } from './types';

export interface LiveOptions {
  talk: Talk;
  limitSeconds: number;
  /** Called with measured seconds per card id (and whether the short version was said) when the speaker saves. */
  onSave(measured: Map<string, { seconds: number; short: boolean }>): void;
  onClose(): void;
}

interface Said extends SpokenEntry {
  ms: number;
}

/** How long the change banner stays up. */
const BANNER_MS = 7000;

/** The plan the talk starts with: the current selection, or its shortest valid talk when nothing fits. */
export function initialPlan(talk: Talk, limitSeconds: number): { plan: LivePlan; wrapUp: boolean } {
  const result = selectCards(talk.cards, talk.requiredPoints, limitSeconds);
  if (result.fits) return { plan: { ids: result.kept.map((c) => c.id), shortIds: result.shortIds }, wrapUp: false };
  if (result.shortest) return { plan: { ids: result.shortest.cards.map((c) => c.id), shortIds: result.shortest.shortIds }, wrapUp: true };
  return { plan: { ids: talk.cards.map((c) => c.id), shortIds: [] }, wrapUp: true };
}

/** Open the full-screen live presenter view. Returns a function that closes it without saving. */
export function openLive(opts: LiveOptions): () => void {
  const { talk, limitSeconds } = opts;
  const cards = talk.cards;
  const byId = new Map(cards.map((c) => [c.id, c]));
  const limitMs = limitSeconds * 1000;

  const start = initialPlan(talk, limitSeconds);
  const firstPlan = structuredClone(start.plan);
  /** Upcoming cards; ids[0] is the card being said once started. */
  let plan: LivePlan = structuredClone(start.plan);
  let wrapUp = start.wrapUp;
  const said: Said[] = [];
  let startedAt: number | null = null;
  let cardStartedAt = 0;
  let endedAt: number | null = null;
  /** The plan before the last automatic change, for U. */
  let undo: { plan: LivePlan; wrapUp: boolean } | null = null;
  let frame = 0;
  let bannerTimer = 0;
  let closed = false;

  const app = document.querySelector<HTMLElement>('#app');
  const root = document.createElement('div');
  root.className = 'rh lv';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Present live');
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="rh__bar">
      <div class="rh__where"><span class="rh__mode">Present live</span> · <span data-ref="progress"></span></div>
      <div class="lv__time">
        <div class="lv__left" aria-label="Time on the clock"><span data-ref="left">${formatTime(limitSeconds)}</span><span class="lv__unit"> left</span></div>
        <div class="lv__pace" data-ref="pace"></div>
      </div>
      <div class="rh__buttons">
        <button type="button" data-ref="undo" aria-keyshortcuts="U" disabled>Undo change</button>
        <button type="button" data-ref="exit" aria-keyshortcuts="Escape">Exit</button>
      </div>
    </div>
    <p class="lv__banner" data-ref="banner" role="status" aria-live="polite" hidden></p>
    <div class="rh__stage" data-ref="stage">
      <p class="rh__hint" data-ref="hint"></p>
      <p class="rh__current" data-ref="current"></p>
      <p class="lv__text" data-ref="text"></p>
      <p class="rh__next" data-ref="next"></p>
    </div>
    <p class="rh__keys" data-ref="keys">
      <span class="keys--kbd"><kbd>Space</kbd> next card · <kbd>U</kbd> undo change · <kbd>Esc</kbd> exit</span>
      <span class="keys--touch">Tap anywhere for the next card</span>
    </p>
  `;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const leftEl = ref('left');
  const unitEl = root.querySelector<HTMLElement>('.lv__unit')!;
  const paceEl = ref('pace');
  const bannerEl = ref('banner');
  const undoBtn = ref<HTMLButtonElement>('undo');

  /* ----- Lifecycle ----- */

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  if (app) app.inert = true;
  document.body.append(root);
  root.focus();

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  root.addEventListener('pointerdown', onPointerDown);
  undoBtn.addEventListener('click', undoChange);
  ref('exit').addEventListener('click', close);

  render();
  if (wrapUp) showBanner('Wrap up: required points only');

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    clearTimeout(bannerTimer);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    root.remove();
    if (app) app.inert = false;
    document.body.style.overflow = previousOverflow;
    opts.onClose();
  }

  /* ----- Input ----- */

  function isSummary() {
    return endedAt !== null;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ' || e.code === 'Space') {
      if (isSummary()) return;
      e.preventDefault();
      if (!e.repeat) advance();
    } else if ((e.key === 'u' || e.key === 'U') && !e.ctrlKey && !e.metaKey && !e.altKey) {
      if (isSummary()) return;
      e.preventDefault();
      undoChange();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  }

  function onKeyUp(e: KeyboardEvent) {
    if ((e.key === ' ' || e.code === 'Space') && !isSummary()) e.preventDefault();
  }

  function onPointerDown(e: PointerEvent) {
    if (isSummary() || e.button !== 0) return;
    if ((e.target as HTMLElement).closest('button, a, input, select, textarea')) return;
    e.preventDefault();
    advance();
  }

  /* ----- Talk ----- */

  function isShort(id: string) {
    return plan.shortIds.includes(id);
  }

  function elapsedMs(now: number) {
    return startedAt === null ? 0 : (endedAt ?? now) - startedAt;
  }

  /** Projected finish in seconds: elapsed + what's left of the current card's planned time + the rest of the plan. */
  function finishAt(now: number) {
    const [currentId, ...rest] = plan.ids;
    if (!currentId) return elapsedMs(now) / 1000;
    const currentPlanned = plannedSeconds(byId.get(currentId)!, isShort(currentId));
    const restPlanned = planSeconds({ ids: rest, shortIds: plan.shortIds }, cards);
    const onCard = startedAt === null ? 0 : (now - cardStartedAt) / 1000;
    return projectedFinish(elapsedMs(now) / 1000, onCard, currentPlanned, restPlanned);
  }

  function advance() {
    const now = performance.now();
    if (plan.ids.length === 0) return;
    if (startedAt === null) {
      startedAt = now;
      cardStartedAt = now;
      render();
      return;
    }
    const id = plan.ids[0];
    said.push({ id, short: isShort(id), ms: now - cardStartedAt });
    cardStartedAt = now;
    const before: LivePlan = { ids: plan.ids.slice(1), shortIds: plan.shortIds.filter((s) => s !== id) };

    if (before.ids.length === 0) {
      plan = before;
      finish(now);
      return;
    }

    const next = replan({
      cards,
      requiredPoints: talk.requiredPoints,
      limitSeconds,
      spoken: said,
      elapsedSeconds: elapsedMs(now) / 1000,
      current: before,
    });
    const changes = diffPlans(before, next.plan, cards);
    const becameWrapUp = next.wrapUp && !wrapUp;
    if (changes.length > 0 || becameWrapUp) {
      undo = { plan: before, wrapUp };
      plan = next.plan;
      wrapUp = next.wrapUp;
      const text = changes.length ? describeChanges(changes, cards, next.overSeconds, false) : '';
      const wrap = next.wrapUp ? describeChanges([], cards, 0, true) : '';
      showBanner([text, wrap].filter(Boolean).join(' · '));
    } else {
      undo = null;
      plan = before;
      wrapUp = next.wrapUp;
    }
    if (plan.ids.length === 0) {
      finish(now);
      return;
    }
    render();
  }

  function undoChange() {
    if (!undo || isSummary()) return;
    // Back to exactly the plan before the change; the clock for the card on screen keeps running.
    plan = undo.plan;
    wrapUp = undo.wrapUp;
    undo = null;
    showBanner('Undone: back to the previous plan');
    render();
  }

  function showBanner(text: string) {
    bannerEl.textContent = text;
    bannerEl.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = window.setTimeout(() => (bannerEl.hidden = true), BANNER_MS);
  }

  /* ----- Running view ----- */

  function render() {
    const started = startedAt !== null;
    const id = plan.ids[0];
    const card = byId.get(id)!;
    const nextId = plan.ids[1];
    const next = nextId ? byId.get(nextId) : undefined;
    const total = said.length + plan.ids.length;
    ref('progress').textContent = `Card ${said.length + 1} of ${total}`;
    ref('hint').textContent = started ? '' : 'Press Space or tap anywhere to start the clock';
    ref('hint').hidden = started;
    ref('current').textContent = cardTitle(card) || '(empty card)';
    const short = isShort(id) && card.short;
    ref('text').innerHTML = `${short ? '<span class="lv__badge">Short version</span> ' : ''}${esc(short ? card.short!.text : card.text)}`;
    ref('next').textContent = next
      ? `Next: ${cardTitle(next) || '(empty card)'}${isShort(next.id) ? ' (short)' : ''}`
      : 'Last card';
    undoBtn.disabled = !undo;
    root.classList.toggle('rh--ready', !started);
    tick();
  }

  function tick() {
    cancelAnimationFrame(frame);
    const now = performance.now();
    const leftMs = limitMs - elapsedMs(now);
    const over = leftMs < 0;
    leftEl.textContent = formatTime(over ? Math.floor(-leftMs / 1000) : Math.ceil(leftMs / 1000));
    unitEl.textContent = over ? ' over' : ' left';
    root.classList.toggle('lv--over', over);
    const label = finishLabel(finishAt(now), limitSeconds, elapsedMs(now) / 1000);
    paceEl.textContent = label.text;
    paceEl.dataset.tone = label.tone;
    if (startedAt !== null && endedAt === null && !closed) frame = requestAnimationFrame(tick);
  }

  /* ----- Summary ----- */

  function finish(now: number) {
    endedAt = now;
    cancelAnimationFrame(frame);
    clearTimeout(bannerTimer);
    bannerEl.hidden = true;
    const totalS = msToCardSeconds(elapsedMs(now));
    const diff = totalS - limitSeconds;
    const measured = new Map(said.map((s) => [s.id, { seconds: msToCardSeconds(s.ms), short: s.short }]));
    const saidIds = new Set(said.map((s) => s.id));
    const name = (c: Card) => cardTitle(c) || '(empty card)';
    const skipped = cards.filter((c) => firstPlan.ids.includes(c.id) && !saidIds.has(c.id)).map(name);
    const added = cards.filter((c) => !firstPlan.ids.includes(c.id) && saidIds.has(c.id)).map(name);
    const shortened = said.filter((s) => s.short && firstPlan.ids.includes(s.id) && !firstPlan.shortIds.includes(s.id)).map((s) => name(byId.get(s.id)!));

    root.classList.add('rh--summary');
    root.classList.remove('rh--ready');
    root.classList.toggle('lv--over', diff > 0);
    ref('progress').textContent = 'Finished';
    leftEl.textContent = formatTime(totalS);
    unitEl.textContent = ` / ${formatTime(limitSeconds)}`;
    paceEl.textContent = diff > 0 ? `${gapLabel(diff)} over` : diff < 0 ? `${gapLabel(diff)} under` : 'Right on time';
    paceEl.dataset.tone = diff > 0 ? 'late' : 'spare';
    undoBtn.hidden = true;
    ref('exit').hidden = true;
    ref('keys').hidden = true;

    const rows = said
      .map((s) => {
        const c = byId.get(s.id)!;
        const planned = plannedSeconds(c, s.short);
        const now = msToCardSeconds(s.ms);
        const d = now - planned;
        const diffText = d === 0 ? '' : `<span class="rh__diff ${d > 0 ? 'rh__diff--up' : ''}">${d > 0 ? '+' : '−'}${Math.abs(d)}s</span>`;
        return `<tr>
          <td class="rh__card">${esc(name(c))}${s.short ? ' <span class="hint">(short)</span>' : ''}</td>
          <td class="num rh__old">${planned}s</td>
          <td class="num rh__new">${now}s ${diffText}</td>
        </tr>`;
      })
      .join('');
    const list = (label: string, items: string[]) =>
      items.length ? `<p class="lv__changes"><b>${label}:</b> ${esc(items.join(', '))}</p>` : '';

    ref('stage').innerHTML = `
      <div class="rh__summary">
        <h2>Finished in ${formatTime(totalS)} <span class="lv__vs">${diff > 0 ? `· ${gapLabel(diff)} over` : diff < 0 ? `· ${gapLabel(diff)} under` : '· right on'} the ${formatTime(limitSeconds)} limit</span></h2>
        ${list('Skipped live', skipped)}${list('Added back live', added)}${list('Shortened live', shortened)}
        ${!skipped.length && !added.length && !shortened.length ? '<p class="lv__changes">No changes to the plan were needed.</p>' : ''}
        <table class="rh__table">
          <thead><tr><th scope="col">Card</th><th scope="col" class="num">Planned</th><th scope="col" class="num">This run</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
        <div class="buttons">
          <button type="button" class="primary" data-ref="save">Save these times</button>
          <button type="button" data-ref="discard">Discard</button>
        </div>
      </div>
    `;
    ref('save').addEventListener('click', () => {
      opts.onSave(measured);
      close();
    });
    ref('discard').addEventListener('click', close);
    ref<HTMLButtonElement>('save').focus();
  }

  return close;
}

function esc(text: string): string {
  return text.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
}
