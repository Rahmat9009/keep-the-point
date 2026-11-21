/* Helpers shared by the three design-study screens. Plain script, no build step. */
(function () {
  const params = new URLSearchParams(location.search);
  const fmt = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const esc = (t) => String(t).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
  const snap = (sec) => Math.min(160, Math.max(30, Math.round(sec / 5) * 5));
  const step = (sec) => window.KTP.steps[snap(sec)];
  /** 'kept' | 'short' | 'cut' for a card at a given step. */
  const cardState = (card, st) => (st.shortIds.includes(card.id) ? 'short' : st.keptIds.includes(card.id) ? 'kept' : 'cut');
  const spoken = (card, state) => (state === 'short' ? card.short : { text: card.text, seconds: card.seconds });
  const initialLimit = () => (params.get('state') === 'nofit' ? 65 : 105);
  const view = () => params.get('view') || 'main';
  /** Cut reason at this step, or the app's "Not in the shortest valid talk" when nothing fits. */
  const reason = (card, st) => (st.fits ? st.reasons[card.id] || '' : 'Not in the shortest valid talk');
  /** Run-of-show start time of each kept card. */
  const starts = (st) => {
    let t = 0;
    const out = {};
    for (const c of window.KTP.cards) {
      const s = cardState(c, st);
      if (s === 'cut') continue;
      out[c.id] = t;
      t += spoken(c, s).seconds;
    }
    return out;
  };
  /** Cue items for the 1:45 talk: kept cards, cut markers and the bridge line. */
  const cueItems = (st) => {
    const items = [];
    let pending = [];
    let n = 0;
    for (const c of window.KTP.cards) {
      const s = cardState(c, st);
      if (s === 'cut') { pending.push(c); continue; }
      if (pending.length) { items.push({ kind: 'cut', cards: pending }); pending = []; }
      n += 1;
      items.push({ kind: 'card', card: c, state: s, n, bridge: window.KTP.bridge.beforeId === c.id ? window.KTP.bridge.text : null });
    }
    if (pending.length) items.push({ kind: 'cut', cards: pending });
    return items;
  };
  window.KTPU = { params, fmt, esc, snap, step, cardState, spoken, initialLimit, view, reason, starts, cueItems };
})();
