/* Study C · Dial. Static mock driven by the real sample data (KTP). The ring is the slider. */
(function () {
  const { fmt, esc, snap, step, cardState, spoken, initialLimit, view, reason, starts, cueItems } = window.KTPU;
  const D = window.KTP;
  const FULL_TURN = 160; // one turn of the dial = 2:40
  const C = 200;
  const app = document.getElementById('app');
  let limit = initialLimit();

  const pt = (sec, r) => {
    const a = (sec / FULL_TURN) * Math.PI * 2;
    return [C + r * Math.sin(a), C - r * Math.cos(a)];
  };
  const arc = (s0, s1, r) => {
    const gap = 0.6;
    const a = pt(s0 + gap, r);
    const b = pt(Math.max(s0 + gap, s1 - gap), r);
    const large = s1 - s0 > FULL_TURN / 2 ? 1 : 0;
    return `M${a[0].toFixed(1)} ${a[1].toFixed(1)} A${r} ${r} 0 ${large} 1 ${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
  };

  function dialSvg(st, lim, interactive) {
    let outer = '';
    let t = 0;
    for (const c of D.cards) {
      const s = cardState(c, st);
      outer += `<path class="seg" d="${arc(t, t + c.seconds, 182)}" stroke="${s === 'cut' ? '#ff9b9b' : '#4a5594'}" stroke-width="8" fill="none" ${s === 'cut' ? 'stroke-dasharray="3 4"' : ''} />`;
      t += c.seconds;
    }
    let inner = '';
    t = 0;
    for (const c of D.cards) {
      const s = cardState(c, st);
      if (s === 'cut') continue;
      const sec = spoken(c, s).seconds;
      const col = !st.fits ? '#ff9b9b' : s === 'short' ? '#bdb6ff' : '#ffb38a';
      inner += `<path class="seg" d="${arc(t, t + sec, 150)}" stroke="${col}" stroke-width="30" fill="none" />`;
      t += sec;
    }
    let ticks = '';
    for (let s = 0; s < FULL_TURN; s += 10) {
      const major = s % 30 === 0;
      const [x1, y1] = pt(s, major ? 116 : 124);
      const [x2, y2] = pt(s, 130);
      ticks += `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${major ? '#b1b7da' : '#4a5594'}" stroke-width="${major ? 2 : 1.2}" />`;
    }
    const [hx, hy] = pt(lim, 150);
    const [lx1, ly1] = pt(lim, 112);
    const [lx2, ly2] = pt(lim, 194);
    return `<svg class="dial" viewBox="0 0 400 400" aria-hidden="true">
      <circle class="ring-focus" cx="200" cy="200" r="198" fill="none" stroke="#ffe08a" stroke-width="3" />
      <circle cx="200" cy="200" r="150" fill="none" stroke="#232a52" stroke-width="30" />
      ${ticks}${outer}${inner}
      <line x1="${lx1.toFixed(1)}" y1="${ly1.toFixed(1)}" x2="${lx2.toFixed(1)}" y2="${ly2.toFixed(1)}" stroke="#eef0fa" stroke-width="2.5" stroke-linecap="round" />
      ${interactive ? `<circle class="handle" cx="${hx.toFixed(1)}" cy="${hy.toFixed(1)}" r="19" fill="#eef0fa" stroke="#141938" stroke-width="4" />` : ''}
    </svg>`;
  }

  const left = (inner) => `
    <aside class="left">
      <div class="brand"><h1>Keep the Point</h1><p class="talk-title">${esc(D.title)}</p></div>
      <ol class="how" aria-label="How it works"><li><b aria-hidden="true">1</b>Paste your talk</li><li><b aria-hidden="true">2</b>Set your time</li><li><b aria-hidden="true">3</b>Get cue cards that fit</li></ol>
      ${inner}
      <p class="foot">${D.capybara}<span>Timed by a very patient capybara.</span></p>
    </aside>`;

  function mainScreen() {
    app.innerHTML = `
      <div class="shell">
        ${left(`
          <div class="dial-wrap" id="dial">
            <div id="svg"></div>
            <div class="center" id="center" aria-live="polite"></div>
            <input class="range" id="range" type="range" min="30" max="160" step="5" value="${limit}" aria-label="Time limit" />
          </div>
          <ul class="chips" id="chips"></ul>
          <p class="nofit-note" id="nofit" hidden></p>
          <div class="limit-row"><label for="limit-box">Limit</label><input id="limit-box" class="num" type="text" inputmode="numeric" value="${fmt(limit)}" /></div>
          <p class="hint">Try it: turn the dial to cut the talk</p>`)}
        <main class="right">
          <h2>Run of show</h2>
          <p class="sub">When each card starts in the trimmed talk.</p>
          <div class="actions"><button class="btn btn--go" type="button" id="open-cues">Open cue cards</button><button class="btn" type="button">Rehearse</button></div>
          <ol class="ros" id="ros"></ol>
          <ul class="points" id="points" aria-label="Required points"></ul>
          <section class="editor" aria-labelledby="ed-h"><h2 id="ed-h">Cards</h2><p class="sub">Open a card to change what you say.</p><ol class="ed" id="ed"></ol></section>
        </main>
      </div>
      <div class="dock" aria-label="Time limit">
        <span class="t num" id="dock-t"></span>
        <input id="dock-range" type="range" min="30" max="160" step="5" value="${limit}" aria-label="Time limit" />
      </div>`;
    const range = document.getElementById('range');
    const dockRange = document.getElementById('dock-range');
    const box = document.getElementById('limit-box');
    const set = (v) => { limit = snap(v); range.value = dockRange.value = String(limit); box.value = fmt(limit); update(); };
    range.addEventListener('input', () => set(Number(range.value)));
    dockRange.addEventListener('input', () => set(Number(dockRange.value)));
    box.addEventListener('input', () => {
      const m = /^(\d+):(\d{2})$/.exec(box.value.trim());
      if (m) set(Number(m[1]) * 60 + Number(m[2]));
    });
    const dial = document.getElementById('dial');
    const fromPointer = (e) => {
      const r = dial.getBoundingClientRect();
      const x = e.clientX - r.left - r.width / 2;
      const y = e.clientY - r.top - r.height / 2;
      let a = Math.atan2(x, -y);
      if (a < 0) a += Math.PI * 2;
      set((a / (Math.PI * 2)) * FULL_TURN);
    };
    dial.addEventListener('pointerdown', (e) => { dial.setPointerCapture(e.pointerId); fromPointer(e); range.focus({ preventScroll: true }); });
    dial.addEventListener('pointermove', (e) => { if (dial.hasPointerCapture(e.pointerId)) fromPointer(e); });
    document.getElementById('open-cues').addEventListener('click', () => { location.search = '?view=cues'; });
    update();
  }

  function update() {
    const st = step(limit);
    document.getElementById('svg').innerHTML = dialSvg(st, limit, true);
    const center = document.getElementById('center');
    const nofit = document.getElementById('nofit');
    if (st.fits) {
      center.className = 'center';
      center.innerHTML = `<span class="from num"><s>${fmt(D.fullSeconds)}</s> →</span><span class="now num">${fmt(st.total)}</span><span class="of num">of ${fmt(limit)}</span>`;
      nofit.hidden = true;
    } else {
      center.className = 'center center--bad';
      center.innerHTML = `<span class="now">Can't fit</span><span class="of num">${fmt(limit)} limit</span>`;
      nofit.hidden = false;
      nofit.textContent = `Every required point needs ${fmt(st.total)}, ${st.over}s more than ${fmt(limit)}.`;
    }
    const chipCls = (c) => (c.includes('shortened') ? 'c-short' : c.includes('cut') ? 'c-cut' : '');
    document.getElementById('chips').innerHTML = st.fits ? st.chips.map((c) => `<li class="${chipCls(c)}">${esc(c)}</li>`).join('') : '';
    document.getElementById('range').setAttribute('aria-valuetext', `${fmt(limit)}: ${st.fits ? `talk runs ${fmt(st.total)}` : "can't fit"}`);
    document.getElementById('dock-t').innerHTML = st.fits ? `${fmt(st.total)} <small>/ ${fmt(limit)}</small>` : `Can't fit <small>${fmt(limit)}</small>`;

    const at = starts(st);
    document.getElementById('ros').innerHTML = D.cards.map((c) => {
      const s = cardState(c, st);
      const sec = spoken(c, s).seconds;
      const meta = s === 'cut' ? `<span class="pill pill--cut">Cut</span>${esc(reason(c, st))}`
        : s === 'short' ? `<span class="pill pill--short">Short version</span>${c.seconds}s → ${sec}s` : esc(c.tags.join(', ') || `Optional · priority ${c.priority}`);
      return `<li class="is-${s}">
        <span class="at num">${s === 'cut' ? '—' : fmt(at[c.id])}</span><span class="dot" aria-hidden="true"></span>
        <div class="body"><div class="t">${esc(c.title)}</div><div class="m">${meta}</div>${s === 'short' ? `<p class="short">“${esc(c.short.text)}”</p>` : ''}</div>
        <span class="s num">${sec}s</span>
      </li>`;
    }).join('');
    document.getElementById('points').innerHTML = D.requiredPoints.map((p) => {
      const by = D.cards.filter((c) => c.tags.includes(p) && cardState(c, st) !== 'cut').map((c) => c.title);
      return `<li><b>${by.length ? '✓' : '✗'}</b>${esc(p)}</li>`;
    }).join('');
    document.getElementById('ed').innerHTML = D.cards.map((c) => {
      const open = c.id === '4';
      return `<li ${open ? 'id="thinking"' : ''}>
        <div class="row"><span class="n num">${c.id}</span><span class="tt">${esc(c.title)}</span><span class="sec num">${c.seconds}s</span>
          <button class="chev" type="button" aria-expanded="${open}" aria-label="${open ? 'Close' : 'Open'} card ${c.id}">${open ? '▴' : '▾'}</button></div>
        ${open ? `<div class="open">
          <label>Title<input type="text" value="${esc(c.title)}" /></label>
          <label style="margin-top:10px">What you'll say<textarea rows="4">${esc(c.text)}</textarea></label>
          <div class="opts">${D.requiredPoints.map((p) => `<label><input type="checkbox" ${c.tags.includes(p) ? 'checked' : ''} /> ${esc(p)}</label>`).join('')}<label><input type="checkbox" /> Always keep</label></div>
          <button class="ai" type="button" aria-busy="true" disabled><span class="orbit" aria-hidden="true"></span>Thinking…</button>
        </div>` : ''}
      </li>`;
    }).join('');
  }

  function cueScreen() {
    const st = step(105);
    const at = starts(st);
    const items = cueItems(st);
    const body = items.map((it) => {
      if (it.kind === 'cut') {
        const secs = it.cards.reduce((t, c) => t + c.seconds, 0);
        return `<li class="cutline"><i></i><span>✂ Cut here: ${it.cards.map((c) => esc(c.title)).join(', ')} <span class="num">(${secs}s)</span></span></li>`;
      }
      const sp = spoken(it.card, it.state);
      return `<li class="cc ${it.state === 'short' ? 'is-short' : ''}">
        <span class="at num">${fmt(at[it.card.id])}</span>
        <div class="card">
          ${it.bridge ? `<p class="bridge">${esc(it.bridge)} <span class="num">~${D.bridge.seconds}s</span></p>` : ''}
          <div class="head"><span class="n num" aria-label="Card ${it.n}">${it.n}</span><h3>${esc(it.card.title)}</h3><span class="secs num">${sp.seconds}s</span></div>
          <p class="say">${esc(sp.text)}</p>
          ${it.state === 'short' || it.card.tags.length ? `<div class="meta">${it.state === 'short' ? `<span class="pill pill--short">Short version</span>${it.card.seconds}s → ${sp.seconds}s ` : ''}${it.card.tags.length ? `Covers ${esc(it.card.tags.join(', '))}` : ''}</div>` : ''}
        </div>
      </li>`;
    }).join('');
    app.innerHTML = `
      <div class="shell shell--cues">
        ${left(`<div class="mini">${dialSvg(st, 105, false)}</div>
          <ul class="chips"><li class="num">${fmt(st.total)} of ${fmt(105)}</li>${st.chips.map((c) => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="actions" style="justify-content:center;margin-top:20px"><button class="btn btn--go" type="button">Print cue cards</button><button class="btn" type="button" id="back">Back</button></div>`)}
        <main class="cue-right">
          <h2>Cue cards</h2><p class="sub">Read down the page. Times show when each card starts.</p>
          <ol class="cue">${body}</ol>
          <p class="cue-total num"><b>Total ${fmt(st.total)}</b>${st.chips[0]} · limit ${fmt(105)} · bridge line adds ~${D.bridge.seconds}s</p>
        </main>
      </div>`;
    document.getElementById('back').addEventListener('click', () => { location.search = ''; });
  }

  (view() === 'cues' ? cueScreen : mainScreen)();
  if (location.hash) document.querySelector(location.hash)?.scrollIntoView({ block: 'center' });
})();
