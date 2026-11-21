import { elapsedMs, msToCardSeconds, replayTaps, type Tap, type TapType } from './rehearsal';
import { cardTitle } from './outline';
import { cardTimeLabel, summarize, timeLabel } from './summary';
import { formatTime } from './time';
import type { Card, Talk } from './types';
import { rehearsalSteps, speakerTimes } from './group';
import { speakerTimesHtml } from './groupView';

export interface RehearsalOptions {
  /** Shown in the top bar, e.g. "Full talk". */
  label: string;
  /** The cards to rehearse, in order. */
  cards: Card[];
  /** The whole talk, used to work out the new selection with the measured times. */
  talk: Talk;
  /** Ids of cards rehearsed as their short version: measured times belong to the short version. */
  shortIds?: string[];
  limitSeconds: number;
  /** Called with measured seconds per card id when the student saves. */
  onSave(seconds: Map<string, number>): void;
  /** Called once when the run finishes, with speaking times and the separate handoff total. */
  onComplete?(seconds: Map<string, number>, handoffSeconds: number): void;
  /** Called after the view closes (saved or not). */
  onClose(): void;
}

/** Open the full-screen rehearsal view. Returns a function that closes it without saving. */
export function openRehearsal(opts: RehearsalOptions): () => void {
  const { cards, limitSeconds, talk } = opts;
  const steps = rehearsalSteps(cards, talk.groupMode === true);
  const limitMs = limitSeconds * 1000;
  const taps: Tap[] = [];
  let frame = 0;
  let closed = false;

  const app = document.querySelector<HTMLElement>('#app');
  const root = document.createElement('div');
  root.className = 'rh';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', `Rehearsal: ${opts.label}`);
  root.tabIndex = -1;
  root.innerHTML = `
    <div class="rh__bar">
      <div class="rh__where"><span class="rh__mode">${esc(opts.label)}</span> · <span data-ref="progress"></span></div>
      <div class="rh__clock" aria-label="Total time"><span data-ref="clock">0:00</span><span class="rh__limit"> / ${formatTime(limitSeconds)}</span></div>
      <div class="rh__buttons">
        <button type="button" data-ref="back" aria-keyshortcuts="ArrowLeft">← Back</button>
        <button type="button" data-ref="cancel" aria-keyshortcuts="Escape">Cancel</button>
      </div>
    </div>
    <div class="rh__stage" data-ref="stage">
      <p class="rh__hint" data-ref="hint"></p>
      <p class="rh__speaker" data-ref="speaker" hidden></p>
      <p class="rh__current" data-ref="current" aria-live="polite"></p>
      <p class="rh__next" data-ref="next"></p>
    </div>
    <p class="rh__keys" data-ref="keys">
      <span class="keys--kbd"><kbd>Space</kbd> next card · <kbd>←</kbd> re-time previous · <kbd>Esc</kbd> cancel</span>
      <span class="keys--touch">Tap anywhere for the next card</span>
    </p>
  `;
  const ref = <T extends HTMLElement = HTMLElement>(name: string) => root.querySelector<T>(`[data-ref="${name}"]`)!;
  const clockEl = ref('clock');
  const clockWrap = root.querySelector<HTMLElement>('.rh__clock')!;
  const progressEl = ref('progress');
  const stage = ref('stage');
  const backBtn = ref<HTMLButtonElement>('back');

  /* ----- Lifecycle ----- */

  const previousOverflow = document.body.style.overflow;
  document.body.style.overflow = 'hidden';
  if (app) app.inert = true;
  document.body.append(root);
  root.focus();

  document.addEventListener('keydown', onKeyDown, true);
  document.addEventListener('keyup', onKeyUp, true);
  root.addEventListener('pointerdown', onPointerDown);
  backBtn.addEventListener('click', () => tapNow('back'));
  ref('cancel').addEventListener('click', close);

  renderRunning();

  function close() {
    if (closed) return;
    closed = true;
    cancelAnimationFrame(frame);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener('keyup', onKeyUp, true);
    root.remove();
    if (app) app.inert = false;
    document.body.style.overflow = previousOverflow;
    opts.onClose();
  }

  /* ----- Input ----- */

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === ' ' || e.code === 'Space') {
      if (isSummary()) return; // on the summary, Space works normally (e.g. presses Save)
      e.preventDefault(); // never scroll, never "click" a focused button
      if (!e.repeat) tapNow(state().started ? 'next' : 'start');
    } else if (e.key === 'ArrowLeft') {
      if (!isSummary()) {
        e.preventDefault();
        tapNow('back');
      }
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
    e.preventDefault(); // no text selection / focus shift on tap
    tapNow(state().started ? 'next' : 'start');
  }

  function tapNow(type: TapType) {
    taps.push({ type, at: performance.now() });
    const s = state();
    if (s.done) showSummary();
    else renderRunning();
  }

  /* ----- Running view ----- */

  function state() {
    return replayTaps(steps.length, taps);
  }

  function isSummary() {
    return root.classList.contains('rh--summary');
  }

  function renderRunning() {
    const s = state();
    const step = steps[s.index];
    const next = steps[s.index + 1];
    const cardNumber = steps.slice(0, s.index + 1).filter((item) => item.kind === 'card').length;
    const label = (card: Card) => cardTitle(card) || '(empty card)';
    const handoff = step.kind === 'handoff';
    progressEl.textContent = handoff ? 'Speaker handoff' : `Card ${cardNumber} of ${cards.length}`;
    const hint = handoff ? 'Press Space or tap when the next speaker is ready' : 'Press Space or tap anywhere to start';
    ref('hint').textContent = hint;
    ref('hint').hidden = s.started && !handoff;
    const speaker = talk.groupMode && step.kind === 'card' ? step.card.speaker : undefined;
    ref('speaker').textContent = speaker ?? '';
    ref('speaker').hidden = !speaker;
    ref('current').textContent = step.kind === 'card' ? label(step.card) : `Hand off to ${step.to.speaker}`;
    ref('next').textContent = next?.kind === 'handoff'
      ? `Next speaker: ${next.to.speaker}`
      : next ? `Next: ${label(next.card)}` : 'Last card';
    backBtn.disabled = !s.started;
    root.classList.toggle('rh--ready', !s.started);
    tick();
  }

  function tick() {
    cancelAnimationFrame(frame);
    const s = state();
    const ms = elapsedMs(s, performance.now());
    clockEl.textContent = formatTime(Math.floor(ms / 1000));
    clockWrap.classList.toggle('rh__clock--over', ms > limitMs);
    if (s.started && !s.done && !closed) frame = requestAnimationFrame(tick);
  }

  /* ----- Summary ----- */

  function showSummary() {
    cancelAnimationFrame(frame);
    const s = state();
    const measured = new Map<string, number>();
    const handoffs: { from: Card; to: Card; ms: number }[] = [];
    steps.forEach((step, i) => {
      const ms = s.durationsMs[i] ?? 0;
      if (step.kind === 'card') measured.set(step.card.id, msToCardSeconds(ms));
      else handoffs.push({ from: step.from, to: step.to, ms });
    });
    const handoffSeconds = Math.round(handoffs.reduce((total, handoff) => total + handoff.ms, 0) / 1000);
    opts.onComplete?.(measured, handoffSeconds);
    const oldTotal = cards.reduce((t, c) => t + c.seconds, 0);
    const newTotal = [...measured.values()].reduce((t, n) => t + n, handoffSeconds);
    const speakers = talk.groupMode
      ? speakerTimesHtml(speakerTimes(cards, (card) => card.seconds), speakerTimes(cards, (card) => measured.get(card.id) ?? 0))
      : '';
    const handoffList = handoffs.length ? `
      <details class="outline group-handoffs">
        <summary>Handoffs took ${formatTime(handoffSeconds)}</summary>
        <ul>${handoffs.map(({ from, to, ms }) =>
          `<li>${esc(from.speaker ?? '')} to ${esc(to.speaker ?? '')}: ${formatTime(Math.round(ms / 1000))}</li>`,
        ).join('')}</ul>
      </details>` : '';
    const updatedTalkCards = opts.talk.cards.map((c) => {
      if (!measured.has(c.id)) return c;
      const seconds = measured.get(c.id)!;
      return c.short && opts.shortIds?.includes(c.id)
        ? { ...c, short: { ...c.short, seconds, estimated: false } }
        : { ...c, seconds, estimated: false };
    });
    const reviewLimit = Math.max(0, limitSeconds - handoffSeconds);
    const summary = summarize(updatedTalkCards, opts.talk.requiredPoints, reviewLimit);
    const cut = summary.result?.fits ? summary.result.cut.map((c) => cardTitle(c.card) || '(empty card)') : [];

    root.classList.add('rh--summary');
    root.classList.remove('rh--ready');
    progressEl.textContent = 'Finished';
    clockEl.textContent = formatTime(newTotal);
    clockWrap.classList.toggle('rh__clock--over', newTotal > limitSeconds);
    backBtn.hidden = true;
    ref('cancel').hidden = true; // "Discard" below does the same thing
    ref('keys').hidden = true;

    const rows = cards
      .map((c) => {
        const now = measured.get(c.id)!;
        const diff = now - c.seconds;
        const diffText = diff === 0 ? '' : `<span class="rh__diff ${diff > 0 ? 'rh__diff--up' : ''}">${diff > 0 ? '+' : '−'}${Math.abs(diff)}s</span>`;
        return `<tr>
          <td class="rh__card">${esc(cardTitle(c)) || '<em>(empty card)</em>'}</td>
          <td class="num rh__old">${cardTimeLabel(c)}</td>
          <td class="num rh__new">${now}s ${diffText}</td>
        </tr>`;
      })
      .join('');

    stage.innerHTML = `
      <div class="rh__summary">
        <h2>How it went</h2>
        ${speakers}
        ${handoffList}
        <table class="rh__table">
          <thead><tr><th scope="col">Card</th><th scope="col" class="num">Before</th><th scope="col" class="num">This run</th></tr></thead>
          <tbody>${rows}</tbody>
          <tfoot><tr>
            <th scope="row">${handoffs.length ? 'Total including handoffs' : 'Total'}</th>
            <td class="num rh__old">${timeLabel(oldTotal, cards.some((c) => c.estimated))}</td>
            <td class="num rh__new">${formatTime(newTotal)}</td>
          </tr></tfoot>
        </table>
        <p class="rh__label">${handoffSeconds ? `With ${formatTime(handoffSeconds)} reserved for handoffs, your cards have ${formatTime(reviewLimit)}:` : `With these times, for a ${formatTime(limitSeconds)} limit:`}</p>
        <p class="summary ${summary.tone === 'bad' ? 'summary--bad' : summary.tone === 'quiet' ? 'summary--quiet' : ''}">${esc(summary.text)}</p>
        ${cut.length ? `<p class="hint">Would cut: ${esc(cut.join(', '))}</p>` : ''}
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
