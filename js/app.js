(() => {
  'use strict';

  const MAP = window.WORLD_MAP;
  const REGIONS = window.REGIONS;
  const REGION_FULL = { EU: 'Europe', AS: 'Asia', AF: 'Africa', NA: 'North America', SA: 'South America', OC: 'Oceania' };
  const SVGNS = 'http://www.w3.org/2000/svg';
  const STORE_BEST = 'worldCapitals.best.v1';
  const STORE_SETTINGS = 'worldCapitals.settings.v1';
  const LABEL_FONT = '650 11.5px system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

  function el(tag, attrs = {}, ns = SVGNS) {
    const node = ns ? document.createElementNS(ns, tag) : document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // ------------------------------------------------------------------
  // Data
  // ------------------------------------------------------------------
  const entries = window.CAPITALS.map((r, i) => ({
    i, country: r[0], capital: r[1], alts: r[2], lat: r[3], lon: r[4], region: r[5], id: r[6],
    state: 'open', prio: 0,
  }));
  const TOTAL = entries.length;
  const regionTotals = {};
  for (const e of entries) regionTotals[e.region] = (regionTotals[e.region] || 0) + 1;

  /** Lower-case, strip accents and punctuation: "St. John's" -> "saintjohns". */
  function norm(s) {
    return s
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
      .replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/œ/g, 'oe').replace(/ß/g, 'ss')
      .replace(/ł/g, 'l').replace(/đ/g, 'd').replace(/ı/g, 'i').replace(/þ/g, 'th')
      .replace(/&/g, 'and')
      .replace(/\bst\b\.?/g, 'saint')
      .replace(/^the\s+/, '')
      .replace(/[^a-z0-9]/g, '');
  }

  const answerIndex = new Map(); // normalised answer -> [entry index]
  for (const e of entries) {
    for (const a of [e.capital, ...e.alts]) {
      const k = norm(a);
      if (!answerIndex.has(k)) answerIndex.set(k, []);
      if (!answerIndex.get(k).includes(e.i)) answerIndex.get(k).push(e.i);
    }
  }
  const countryIndex = new Map(); // normalised country name -> [entry index]
  for (const e of entries) {
    for (const a of [e.country, ...((window.COUNTRY_ALTS || {})[e.country] || [])]) {
      const k = norm(a);
      if (!countryIndex.has(k)) countryIndex.set(k, []);
      if (!countryIndex.get(k).includes(e.i)) countryIndex.get(k).push(e.i);
    }
  }

  const prefixOfAnother = (keys) => new Set(keys.filter((k) => keys.some((o) => o !== k && o.startsWith(k))));
  // Capitals that are the start of a longer answer ("washington" / "washingtondc") wait a
  // moment before counting, so typing the long form doesn't get cut off half-way.
  const ambiguous = prefixOfAnother([...answerIndex.keys()]);
  // Same for countries ("niger" / "nigeria"): don't jump to the capital box straight away.
  const countryPrefix = prefixOfAnother([...countryIndex.keys()]);

  // ------------------------------------------------------------------
  // Projection (must match tools/build_map.py)
  // ------------------------------------------------------------------
  const K = MAP.width / (2 * Math.PI);
  const millerY = (lat) => 1.25 * Math.log(Math.tan(Math.PI / 4 + 0.4 * lat * Math.PI / 180));
  const Y_TOP = millerY(MAP.latMax);

  function project(lon, lat) {
    let l = lon - MAP.lon0;
    if (l < -180) l += 360;
    else if (l > 180) l -= 360;
    return [(l + 180) / 360 * MAP.width, (Y_TOP - millerY(lat)) * K];
  }

  // ------------------------------------------------------------------
  // DOM refs
  // ------------------------------------------------------------------
  const mapEl = $('map');
  const svg = $('svg');
  const viewportG = $('viewport');
  const landG = $('land');
  const pinsG = $('pins');
  const labelsG = $('labels');
  const countryIn = $('country');
  const capitalIn = $('capital');
  const countryField = $('country-field');
  const inputs = [countryIn, capitalIn];
  const isTyping = () => inputs.includes(document.activeElement);
  const toastEl = $('toast');
  const tooltipEl = $('tooltip');
  const timerEl = $('timer');

  // ------------------------------------------------------------------
  // Build the map
  // ------------------------------------------------------------------
  const pathsById = new Map();
  {
    const frag = document.createDocumentFragment();
    for (const c of MAP.countries) {
      const p = el('path', { d: c.d, 'fill-rule': 'evenodd' });
      if (c.id) {
        if (!pathsById.has(c.id)) pathsById.set(c.id, []);
        pathsById.get(c.id).push(p);
      }
      frag.appendChild(p);
    }
    landG.appendChild(frag);
  }

  const measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = LABEL_FONT;
  {
    const pinFrag = document.createDocumentFragment();
    const labelFrag = document.createDocumentFragment();
    for (const e of entries) {
      [e.x, e.y] = project(e.lon, e.lat);
      const g = el('g', { class: 'pin open' });
      g.dataset.i = e.i;
      e.ring = el('circle', { class: 'ring', r: 3 });
      const hit = el('circle', { class: 'hit', r: 11 });
      e.dot = el('circle', { class: 'dot', r: 3 });
      g.append(e.ring, hit, e.dot);
      e.g = g;
      pinFrag.appendChild(g);

      const t = el('text');
      t.textContent = e.capital;
      t.style.display = 'none';
      e.label = t;
      e.labelW = measureCtx.measureText(e.capital).width + 2;
      labelFrag.appendChild(t);
    }
    pinsG.appendChild(pinFrag);
    labelsG.appendChild(labelFrag);
  }

  // ------------------------------------------------------------------
  // View: pan & zoom
  // ------------------------------------------------------------------
  const view = { k: 1, tx: 0, ty: 0, w: 0, h: 0, minK: 1, maxK: 40 };
  const settings = loadSettings();

  function clampView() {
    view.k = clamp(view.k, view.minK, view.maxK);
    const mw = MAP.width * view.k;
    const mh = MAP.height * view.k;
    view.tx = mw <= view.w ? (view.w - mw) / 2 : clamp(view.tx, view.w - mw, 0);
    view.ty = mh <= view.h ? (view.h - mh) / 2 : clamp(view.ty, view.h - mh, 0);
  }

  function resize() {
    const r = mapEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const first = !view.w;
    const wasFit = first || view.k <= view.minK * 1.001;
    const cx = (view.w / 2 - view.tx) / view.k;
    const cy = (view.h / 2 - view.ty) / view.k;
    view.w = r.width;
    view.h = r.height;
    view.minK = Math.min(view.w / MAP.width, view.h / MAP.height);
    if (wasFit) {
      view.k = view.minK;
    } else {
      view.k = Math.max(view.k, view.minK);
      view.tx = view.w / 2 - cx * view.k;
      view.ty = view.h / 2 - cy * view.k;
    }
    clampView();
    render();
  }

  let rafId = 0;
  function scheduleRender() {
    if (!rafId) rafId = requestAnimationFrame(render);
  }

  let lastR = 0;
  let tooltipEntry = null;
  function render() {
    if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
    viewportG.setAttribute('transform', `translate(${view.tx},${view.ty}) scale(${view.k})`);

    const zoom = view.k / view.minK;
    const r = Math.round(Math.min(6.5, 2.8 + 1.1 * Math.log2(zoom)) * 10) / 10;
    if (r !== lastR) {
      for (const e of entries) {
        e.dot.setAttribute('r', r);
        e.ring.setAttribute('r', r);
      }
      lastR = r;
    }
    for (const e of entries) {
      e.sx = e.x * view.k + view.tx;
      e.sy = e.y * view.k + view.ty;
      e.g.setAttribute('transform', `translate(${e.sx.toFixed(1)},${e.sy.toFixed(1)})`);
    }
    layoutLabels(r);
    if (tooltipEntry) placeTooltip(tooltipEntry);
  }

  /** Greedy label placement: newest answers first, skip labels that would overlap. */
  function layoutLabels(r) {
    const H = 13;
    const pad = 1.5;
    const placed = [];
    const cands = [];
    for (const e of entries) {
      const visible = settings.labels && e.state !== 'open' &&
        e.sx > -150 && e.sx < view.w + 150 && e.sy > -30 && e.sy < view.h + 30;
      if (visible) cands.push(e);
      else if (e.labelShown) { e.label.style.display = 'none'; e.labelShown = false; }
    }
    if (!cands.length) return;
    cands.sort((a, b) => b.prio - a.prio);

    // Visible dots are soft obstacles: a label avoids covering them when it can.
    const dots = [];
    for (const e of entries) {
      if (e.sx < -20 || e.sx > view.w + 20 || e.sy < -20 || e.sy > view.h + 20) continue;
      if (e.state === 'open' && !settings.dots) continue;
      dots.push({ x: e.sx - r, y: e.sy - r, w: r * 2, h: r * 2 });
    }
    const overlaps = (box, list) => {
      for (const b of list) {
        if (box.x < b.x + b.w && box.x + box.w > b.x && box.y < b.y + b.h && box.y + box.h > b.y) return true;
      }
      return false;
    };

    const off = r + 3;
    for (const e of cands) {
      const w = e.labelW;
      const options = [
        [e.sx + off, e.sy - H / 2, 'start', e.sx + off, e.sy + 4],
        [e.sx - off - w, e.sy - H / 2, 'end', e.sx - off, e.sy + 4],
        [e.sx - w / 2, e.sy - off - H, 'middle', e.sx, e.sy - off - 3],
        [e.sx - w / 2, e.sy + off, 'middle', e.sx, e.sy + off + 10],
      ].map((o) => ({ o, box: { x: o[0] - pad, y: o[1] - pad, w: w + pad * 2, h: H + pad * 2 } }));
      const free = options.filter((c) => !overlaps(c.box, placed));
      const best = free.find((c) => !overlaps(c.box, dots)) || free[0];
      let chosen = null;
      if (best) { chosen = best.o; placed.push(best.box); }
      if (chosen) {
        const t = e.label;
        t.setAttribute('x', chosen[3].toFixed(1));
        t.setAttribute('y', chosen[4].toFixed(1));
        if (e.anchor !== chosen[2]) { t.setAttribute('text-anchor', chosen[2]); e.anchor = chosen[2]; }
        if (!e.labelShown) { t.style.display = ''; e.labelShown = true; }
      } else if (e.labelShown) {
        e.label.style.display = 'none';
        e.labelShown = false;
      }
    }
  }

  function zoomAt(k, cx, cy) {
    const wx = (cx - view.tx) / view.k;
    const wy = (cy - view.ty) / view.k;
    view.k = clamp(k, view.minK, view.maxK);
    view.tx = cx - wx * view.k;
    view.ty = cy - wy * view.k;
    clampView();
    scheduleRender();
  }

  let animId = 0;
  function stopAnim() {
    if (animId) cancelAnimationFrame(animId);
    animId = 0;
  }

  /** Smoothly move so that world point (wx, wy) is centred at zoom k1. */
  function animateTo(k1, wx1, wy1, dur = 450) {
    stopAnim();
    k1 = clamp(k1, view.minK, view.maxK);
    const k0 = view.k;
    const wx0 = (view.w / 2 - view.tx) / k0;
    const wy0 = (view.h / 2 - view.ty) / k0;
    const t0 = performance.now();
    const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
    const step = (now) => {
      const t = Math.min(1, (now - t0) / dur);
      const s = ease(t);
      view.k = k0 * Math.pow(k1 / k0, s);
      const wx = wx0 + (wx1 - wx0) * s;
      const wy = wy0 + (wy1 - wy0) * s;
      view.tx = view.w / 2 - wx * view.k;
      view.ty = view.h / 2 - wy * view.k;
      clampView();
      render();
      animId = t < 1 ? requestAnimationFrame(step) : 0;
    };
    animId = requestAnimationFrame(step);
  }

  function zoomBy(factor) {
    animateTo(view.k * factor, (view.w / 2 - view.tx) / view.k, (view.h / 2 - view.ty) / view.k, 250);
  }

  function zoomToWorld() {
    animateTo(view.minK, MAP.width / 2, MAP.height / 2);
  }

  function zoomToRegion(reg) {
    const [w, s, e, n] = reg.bounds;
    const [x0, y0] = project(w, n);
    const [x1, y1] = project(e, s);
    const k = Math.min(view.w / (x1 - x0), view.h / (y1 - y0)) * 0.96;
    animateTo(k, (x0 + x1) / 2, (y0 + y1) / 2);
  }

  // ----- pointer gestures (drag, pinch, wheel, double-tap) -----
  const pointers = new Map();
  let gesture = null;
  let tapInfo = null;
  let lastTap = null;
  let mapRect = null;

  function centroid() {
    let x = 0, y = 0;
    for (const p of pointers.values()) { x += p.x; y += p.y; }
    return { x: x / pointers.size - mapRect.left, y: y / pointers.size - mapRect.top };
  }
  function spread() {
    const [a, b] = [...pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }
  function beginGesture() {
    mapRect = mapEl.getBoundingClientRect();
    const c = centroid();
    gesture = {
      k: view.k, tx: view.tx, ty: view.ty, cx: c.x, cy: c.y,
      d: pointers.size > 1 ? spread() : 0,
    };
  }
  function isUiTarget(t) {
    return t.closest && t.closest('.map-controls, .overlay');
  }

  let lastPointerType = 'mouse';
  mapEl.addEventListener('pointerdown', (ev) => {
    lastPointerType = ev.pointerType;
    if (isUiTarget(ev.target) || (ev.pointerType === 'mouse' && ev.button !== 0)) return;
    stopAnim();
    hideTooltip();
    try { mapEl.setPointerCapture(ev.pointerId); } catch (_) { /* ignore */ }
    pointers.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pointers.size === 1) {
      tapInfo = { x: ev.clientX, y: ev.clientY, target: ev.target, moved: false, type: ev.pointerType };
      mapEl.classList.add('dragging');
    } else if (tapInfo) {
      tapInfo.moved = true;
    }
    beginGesture();
  });

  mapEl.addEventListener('pointermove', (ev) => {
    const p = pointers.get(ev.pointerId);
    if (!p) {
      if (ev.pointerType === 'mouse') hoverTooltip(ev.target);
      return;
    }
    p.x = ev.clientX;
    p.y = ev.clientY;
    if (tapInfo && !tapInfo.moved && Math.hypot(ev.clientX - tapInfo.x, ev.clientY - tapInfo.y) > 6) tapInfo.moved = true;
    if (!gesture) return;
    const c = centroid();
    let k = gesture.k;
    if (pointers.size > 1 && gesture.d > 0) k = gesture.k * spread() / gesture.d;
    k = clamp(k, view.minK, view.maxK);
    const wx = (gesture.cx - gesture.tx) / gesture.k;
    const wy = (gesture.cy - gesture.ty) / gesture.k;
    view.k = k;
    view.tx = c.x - wx * k;
    view.ty = c.y - wy * k;
    clampView();
    scheduleRender();
  });

  function endPointer(ev) {
    if (!pointers.has(ev.pointerId)) return;
    pointers.delete(ev.pointerId);
    if (pointers.size > 0) { beginGesture(); return; }
    mapEl.classList.remove('dragging');
    gesture = null;
    if (tapInfo && !tapInfo.moved && ev.type === 'pointerup') handleTap(tapInfo, ev);
    tapInfo = null;
  }
  mapEl.addEventListener('pointerup', endPointer);
  mapEl.addEventListener('pointercancel', endPointer);
  mapEl.addEventListener('pointerleave', (ev) => { if (ev.pointerType === 'mouse' && !pointers.size) hideTooltip(); });

  function handleTap(info, ev) {
    const rect = mapEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    const now = performance.now();
    if (info.type !== 'mouse' && lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) {
      lastTap = null;
      const wx = (x - view.tx) / view.k;
      const wy = (y - view.ty) / view.k;
      animateTo(view.k * 2.2, wx, wy, 280);
      return;
    }
    lastTap = { t: now, x, y };
    const pin = info.target.closest && info.target.closest('.pin');
    if (pin) {
      const e = entries[+pin.dataset.i];
      if (e.state !== 'open') showTooltip(e);
    }
  }

  mapEl.addEventListener('dblclick', (ev) => {
    // Touch double-taps are handled in handleTap; only zoom here for real mouse double-clicks.
    if (isUiTarget(ev.target) || lastPointerType !== 'mouse') return;
    const rect = mapEl.getBoundingClientRect();
    const x = ev.clientX - rect.left;
    const y = ev.clientY - rect.top;
    animateTo(view.k * (ev.shiftKey ? 0.5 : 2.2), (x - view.tx) / view.k, (y - view.ty) / view.k, 280);
  });

  mapEl.addEventListener('wheel', (ev) => {
    if (isUiTarget(ev.target)) return;
    ev.preventDefault();
    stopAnim();
    hideTooltip();
    const rect = mapEl.getBoundingClientRect();
    const unit = ev.deltaMode === 1 ? 0.05 : ev.deltaMode === 2 ? 1 : (ev.ctrlKey ? 0.01 : 0.0022);
    zoomAt(view.k * Math.exp(-ev.deltaY * unit), ev.clientX - rect.left, ev.clientY - rect.top);
  }, { passive: false });

  // ----- tooltip for answered dots -----
  function showTooltip(e) {
    tooltipEntry = e;
    tooltipEl.replaceChildren();
    const b = document.createElement('b');
    b.textContent = e.capital;
    tooltipEl.append(b, ` · ${e.country}`);
    tooltipEl.hidden = false;
    placeTooltip(e);
  }
  function placeTooltip(e) {
    tooltipEl.style.left = `${e.sx}px`;
    tooltipEl.style.top = `${e.sy - lastR}px`;
  }
  function hideTooltip() {
    tooltipEntry = null;
    tooltipEl.hidden = true;
  }
  function hoverTooltip(target) {
    const pin = target.closest && target.closest('.pin');
    const e = pin ? entries[+pin.dataset.i] : null;
    if (e && e.state !== 'open') { if (tooltipEntry !== e) showTooltip(e); }
    else if (tooltipEntry) hideTooltip();
  }

  // ------------------------------------------------------------------
  // Region chips
  // ------------------------------------------------------------------
  const regionsNav = $('regions');
  const chips = {};
  {
    const world = el('button', { type: 'button', class: 'chip' }, null);
    world.textContent = 'World';
    world.addEventListener('click', zoomToWorld);
    regionsNav.appendChild(world);
    for (const reg of REGIONS) {
      const b = el('button', { type: 'button', class: 'chip', title: `Zoom to ${REGION_FULL[reg.key]}` }, null);
      const name = document.createElement('span');
      name.textContent = reg.name;
      const count = document.createElement('span');
      count.className = 'count';
      const bar = document.createElement('span');
      bar.className = 'bar';
      b.append(name, count, bar);
      b.addEventListener('click', () => zoomToRegion(reg));
      regionsNav.appendChild(b);
      chips[reg.key] = { b, count };
    }
  }

  // ------------------------------------------------------------------
  // Game state
  // ------------------------------------------------------------------
  const game = { status: 'ready', minutes: settings.minutes, startedAt: 0, endsAt: 0, endedAt: 0, found: 0, seq: 0, timerId: 0 };
  let lastJust = null;

  function regionCounts() {
    const found = {};
    for (const e of entries) if (e.state === 'found') found[e.region] = (found[e.region] || 0) + 1;
    return found;
  }

  function updateHud() {
    $('score').textContent = game.found;
    $('total').textContent = TOTAL;
    $('left-count').textContent = TOTAL - game.found;
    const found = regionCounts();
    for (const reg of REGIONS) {
      const f = found[reg.key] || 0;
      const t = regionTotals[reg.key];
      chips[reg.key].count.textContent = `${f}/${t}`;
      chips[reg.key].b.style.setProperty('--p', `${(f / t) * 100}%`);
      chips[reg.key].b.classList.toggle('done', f === t);
    }
  }

  function fmtTime(ms) {
    const s = Math.max(0, Math.ceil(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }
  function fmtElapsed(ms) {
    const s = Math.max(0, Math.floor(ms / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  function tick() {
    const now = Date.now();
    if (game.minutes > 0) {
      const left = game.endsAt - now;
      timerEl.textContent = fmtTime(left);
      timerEl.classList.toggle('low', left < 60000);
      if (left <= 0) endGame('time');
    } else {
      timerEl.textContent = fmtElapsed(now - game.startedAt);
    }
  }

  function showIdleTimer() {
    timerEl.classList.remove('low');
    timerEl.textContent = game.minutes > 0 ? `${game.minutes}:00` : '0:00';
  }

  function resetBoard() {
    for (const e of entries) {
      e.state = 'open';
      e.prio = 0;
      e.g.setAttribute('class', 'pin open');
      e.label.setAttribute('class', '');
    }
    for (const list of pathsById.values()) for (const p of list) p.removeAttribute('class');
    game.found = 0;
    game.seq = 0;
    lastJust = null;
    hideTooltip();
  }

  function startGame() {
    resetBoard();
    game.status = 'playing';
    game.startedAt = Date.now();
    game.endsAt = game.startedAt + game.minutes * 60000;
    clearInterval(game.timerId);
    game.timerId = setInterval(tick, 250);
    tick();
    $('start-overlay').hidden = true;
    $('results').hidden = true;
    $('give-up').hidden = false;
    $('play-again').hidden = true;
    setInputs(false, 'Country', 'Capital');
    countryIn.focus();
    updateHud();
    renderList();
    render();
  }

  function markFound(e) {
    e.state = 'found';
    e.prio = ++game.seq;
    game.found++;
    if (lastJust) {
      lastJust.g.classList.remove('just');
      lastJust.label.classList.remove('just');
    }
    e.g.setAttribute('class', 'pin found');
    requestAnimationFrame(() => e.g.classList.add('just')); // next frame, so the pulse restarts
    e.label.setAttribute('class', 'just');
    lastJust = e;
    for (const p of pathsById.get(e.id) || []) p.setAttribute('class', 'found');
  }

  // ----- answering: a country and its capital, in two boxes -----
  let pairTimer = 0;
  let advanceTimer = 0;

  function setInputs(disabled, countryPh, capitalPh) {
    clearTimeout(pairTimer);
    clearTimeout(advanceTimer);
    countryIn.disabled = capitalIn.disabled = disabled;
    countryIn.value = capitalIn.value = '';
    countryIn.placeholder = countryPh;
    capitalIn.placeholder = capitalPh;
    countryField.classList.remove('ok');
  }

  function flash(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth; // restart the animation
    el.classList.add(cls);
  }

  /** Entries the country box currently names (several for "Congo"), or null. */
  function countryMatches() {
    const k = norm(countryIn.value);
    return (k && countryIndex.get(k)) || null;
  }

  /** Score the pair if the two boxes name a country and its capital. */
  function tryPair(force) {
    clearTimeout(pairTimer);
    if (game.status !== 'playing') return false;
    const cands = countryMatches();
    const capKey = norm(capitalIn.value);
    const caps = capKey && answerIndex.get(capKey);
    if (!cands || !caps) return false;
    const hits = caps.filter((i) => cands.includes(i) && entries[i].state === 'open').map((i) => entries[i]);
    if (!hits.length) return false;
    if (!force && ambiguous.has(capKey)) {
      pairTimer = setTimeout(() => tryPair(true), 650);
      return false;
    }
    hits.forEach(markFound);
    clearTimeout(advanceTimer);
    countryIn.value = capitalIn.value = '';
    countryField.classList.remove('ok');
    flash(countryIn, 'hit');
    flash(capitalIn, 'hit');
    setTimeout(() => inputs.forEach((el) => el.classList.remove('hit')), 350);
    countryIn.focus();
    const e = hits[hits.length - 1];
    toast(`${e.country} · ${e.capital}`, 'good');
    updateHud();
    renderList();
    render();
    if (game.found === TOTAL) endGame('complete');
    return true;
  }

  countryIn.addEventListener('input', () => {
    clearTimeout(advanceTimer);
    if (game.status !== 'playing') return;
    const key = norm(countryIn.value);
    const cands = countryMatches();
    countryField.classList.toggle('ok', !!cands);
    if (!cands) return;
    if (cands.every((i) => entries[i].state !== 'open')) {
      if (!countryPrefix.has(key)) {
        const e = entries[cands[0]];
        toast(`Already done: ${e.country} · ${e.capital}`);
        countryIn.value = '';
        countryField.classList.remove('ok');
      }
      return;
    }
    if (tryPair(false) || capitalIn.value) return;
    // Jump to the capital box once the country is unambiguous. If it could still be the
    // start of a longer name ("Niger" -> "Nigeria"), wait for a pause in typing first.
    const advance = () => { if (countryMatches()) capitalIn.focus(); };
    if (cands.length > 1) return; // "Congo": the capital decides, so let the player move on
    if (countryPrefix.has(key)) advanceTimer = setTimeout(advance, 700);
    else advance();
  });

  capitalIn.addEventListener('input', () => tryPair(false));

  countryIn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { clearBoth(); return; }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    const key = norm(countryIn.value);
    if (!key) return;
    if (countryMatches()) {
      if (!tryPair(true)) capitalIn.focus();
      return;
    }
    if (answerIndex.has(key)) toast('That’s a capital — type the country first');
    flash(countryIn, 'shake');
  });

  capitalIn.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { clearBoth(); return; }
    if (ev.key === 'Backspace' && !capitalIn.value) {
      ev.preventDefault();
      countryIn.focus();
      return;
    }
    if (ev.key !== 'Enter') return;
    ev.preventDefault();
    if (!capitalIn.value.trim()) { countryIn.focus(); return; }
    if (tryPair(true)) return;
    const cands = countryMatches();
    if (!cands) {
      toast('Type the country in the first box');
      flash(countryIn, 'shake');
      return;
    }
    if (answerIndex.has(norm(capitalIn.value))) {
      toast(cands.length === 1 ? `Not the capital of ${entries[cands[0]].country}` : 'Not a match');
    }
    flash(capitalIn, 'shake');
  });

  function clearBoth() {
    clearTimeout(pairTimer);
    clearTimeout(advanceTimer);
    countryIn.value = capitalIn.value = '';
    countryField.classList.remove('ok');
    countryIn.focus();
  }

  inputs.forEach((el) => el.addEventListener('animationend', () => el.classList.remove('shake')));

  function endGame(reason) {
    if (game.status !== 'playing') return;
    clearInterval(game.timerId);
    game.status = 'over';
    game.endedAt = Date.now();
    const elapsed = game.endedAt - game.startedAt;
    if (game.minutes > 0 && reason === 'time') timerEl.textContent = '0:00';

    let missedSeq = 100000;
    for (const e of entries) {
      if (e.state !== 'open') continue;
      e.state = 'missed';
      e.prio = missedSeq--;  // missed labels take priority when reviewing
      e.g.setAttribute('class', 'pin missed');
      e.label.setAttribute('class', 'missed');
      for (const p of pathsById.get(e.id) || []) p.setAttribute('class', 'missed');
    }
    if (lastJust) { lastJust.g.classList.remove('just'); lastJust.label.classList.remove('just'); }

    setInputs(true, 'Game over', '');
    $('give-up').hidden = true;
    $('play-again').hidden = false;

    const record = saveBest(game.found, elapsed);
    showResults(reason, elapsed, record);
    updateHud();
    renderList();
    render();
  }

  function showResults(reason, elapsed, record) {
    const pct = Math.round((game.found / TOTAL) * 100);
    $('results-title').textContent =
      reason === 'complete' ? 'Perfect — all 197 pairs!' :
      reason === 'time' ? "Time's up!" : 'Game over';
    $('r-score').textContent = game.found;
    const sub = $('r-sub');
    sub.replaceChildren(`${pct}% in ${fmtElapsed(elapsed)}`);
    if (record) {
      const span = document.createElement('span');
      span.className = 'record';
      span.textContent = ' · New best!';
      sub.append(span);
    }
    const box = $('r-regions');
    box.replaceChildren();
    const found = regionCounts();
    for (const reg of REGIONS) {
      const d = document.createElement('div');
      d.className = 'r-region';
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = REGION_FULL[reg.key];
      const v = document.createElement('div');
      v.className = 'v';
      v.textContent = `${found[reg.key] || 0}/${regionTotals[reg.key]}`;
      d.append(n, v);
      box.append(d);
    }
    $('results').hidden = false;
    $('r-again').focus();
  }

  // ------------------------------------------------------------------
  // List under the map
  // ------------------------------------------------------------------
  function renderList() {
    const over = game.status === 'over';
    $('list-title').textContent = over ? 'All capitals' : 'Found so far';
    $('list-hint').textContent = over
      ? 'The ones you missed are in red.'
      : 'Capitals appear here as you name them.';
    const grid = $('list-grid');
    grid.replaceChildren();
    const found = regionCounts();
    for (const reg of REGIONS) {
      const col = document.createElement('div');
      col.className = 'list-col';
      const h = document.createElement('h3');
      h.textContent = REGION_FULL[reg.key];
      const cnt = document.createElement('span');
      cnt.textContent = `${found[reg.key] || 0}/${regionTotals[reg.key]}`;
      h.append(cnt);
      col.append(h);
      const items = entries
        .filter((e) => e.region === reg.key && (over || e.state === 'found'))
        .sort((a, b) => a.country.localeCompare(b.country));
      if (!items.length) {
        const empty = document.createElement('div');
        empty.className = 'empty';
        empty.textContent = 'None yet';
        col.append(empty);
      } else {
        const ul = document.createElement('ul');
        for (const e of items) {
          const li = document.createElement('li');
          li.className = e.state;
          const c = document.createElement('span');
          c.className = 'c';
          c.textContent = e.country;
          const k = document.createElement('span');
          k.className = 'k';
          k.textContent = e.capital;
          li.append(c, k);
          ul.append(li);
        }
        col.append(ul);
      }
      grid.append(col);
    }
  }

  // ------------------------------------------------------------------
  // Toast
  // ------------------------------------------------------------------
  let toastTimer = 0;
  function toast(text, kind = '') {
    toastEl.textContent = text;
    toastEl.className = `toast show ${kind}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { toastEl.className = `toast ${kind}`; }, 1600);
  }

  // ------------------------------------------------------------------
  // Settings & best scores
  // ------------------------------------------------------------------
  function loadSettings() {
    const defaults = { minutes: 20, labels: true, dots: true };
    try {
      return { ...defaults, ...JSON.parse(localStorage.getItem(STORE_SETTINGS) || '{}') };
    } catch (_) {
      return defaults;
    }
  }
  function saveSettings() {
    try { localStorage.setItem(STORE_SETTINGS, JSON.stringify(settings)); } catch (_) { /* private mode */ }
  }
  function loadBest() {
    try { return JSON.parse(localStorage.getItem(STORE_BEST) || '{}'); } catch (_) { return {}; }
  }
  function saveBest(score, ms) {
    const all = loadBest();
    const key = String(game.minutes);
    const prev = all[key];
    const better = score > 0 && (!prev || score > prev.score || (score === prev.score && ms < prev.ms));
    if (better) {
      all[key] = { score, ms, date: new Date().toISOString().slice(0, 10) };
      try { localStorage.setItem(STORE_BEST, JSON.stringify(all)); } catch (_) { /* ignore */ }
    }
    showBest();
    return better;
  }
  function showBest() {
    const b = loadBest()[String(game.minutes)];
    $('best').textContent = b ? `Your best${game.minutes ? ` (${game.minutes} min)` : ' (no limit)'}: ${b.score}/${TOTAL} in ${fmtElapsed(b.ms)}` : '';
  }

  // ------------------------------------------------------------------
  // Controls wiring
  // ------------------------------------------------------------------
  $('zoom-in').addEventListener('click', () => zoomBy(2));
  $('zoom-out').addEventListener('click', () => zoomBy(0.5));
  $('zoom-reset').addEventListener('click', zoomToWorld);

  const labelsBtn = $('toggle-labels');
  const dotsBtn = $('toggle-dots');
  function applyToggles() {
    labelsBtn.setAttribute('aria-pressed', String(settings.labels));
    labelsBtn.title = settings.labels ? 'Hide answer labels' : 'Show answer labels';
    dotsBtn.setAttribute('aria-pressed', String(settings.dots));
    dotsBtn.title = settings.dots ? 'Hide unanswered locations (harder)' : 'Show unanswered locations';
    svg.classList.toggle('hide-open', !settings.dots);
  }
  labelsBtn.addEventListener('click', () => { settings.labels = !settings.labels; saveSettings(); applyToggles(); render(); });
  dotsBtn.addEventListener('click', () => { settings.dots = !settings.dots; saveSettings(); applyToggles(); });

  const timePick = $('time-pick');
  function applyTimePick() {
    for (const b of timePick.querySelectorAll('button')) {
      const on = Number(b.dataset.min) === game.minutes;
      b.classList.toggle('selected', on);
      b.setAttribute('aria-checked', String(on));
      b.setAttribute('role', 'radio');
    }
    showIdleTimer();
    showBest();
  }
  timePick.addEventListener('click', (ev) => {
    const b = ev.target.closest('button');
    if (!b) return;
    game.minutes = Number(b.dataset.min);
    settings.minutes = game.minutes;
    saveSettings();
    applyTimePick();
  });

  $('start').addEventListener('click', startGame);
  $('give-up').addEventListener('click', () => endGame('giveup'));
  $('play-again').addEventListener('click', backToStart);
  $('r-again').addEventListener('click', backToStart);
  $('r-review').addEventListener('click', () => { $('results').hidden = true; });
  $('results').addEventListener('click', (ev) => { if (ev.target === $('results')) $('results').hidden = true; });
  document.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') $('results').hidden = true; });

  function backToStart() {
    resetBoard();
    game.status = 'ready';
    $('results').hidden = true;
    $('play-again').hidden = true;
    $('give-up').hidden = true;
    $('start-overlay').hidden = false;
    setInputs(true, 'Press Start', '');
    applyTimePick();
    updateHud();
    renderList();
    render();
    $('start').focus();
  }

  // Keep the phone keyboard open when tapping map controls, region chips or the map itself
  // while typing: swallow the tap's focus change and trigger the button ourselves.
  function keepKeyboard(container) {
    let sx = 0, sy = 0;
    container.addEventListener('mousedown', (ev) => {
      if (isTyping() && !isUiOverlay(ev.target)) ev.preventDefault();
    });
    container.addEventListener('touchstart', (ev) => {
      sx = ev.touches[0].clientX;
      sy = ev.touches[0].clientY;
    }, { passive: true });
    container.addEventListener('touchend', (ev) => {
      if (!isTyping() || ev.touches.length || isUiOverlay(ev.target)) return;
      const t = ev.changedTouches[0];
      if (Math.hypot(t.clientX - sx, t.clientY - sy) > 10) return;
      ev.preventDefault();
      const btn = ev.target.closest && ev.target.closest('button');
      if (btn) btn.click();
    });
  }
  const isUiOverlay = (t) => t.closest && t.closest('.overlay');
  keepKeyboard(mapEl);
  keepKeyboard(regionsNav);

  // Size the app to the visible viewport (shrinks when the on-screen keyboard opens).
  function setAppHeight() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-h', `${Math.round(h)}px`);
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      setAppHeight();
      if (isTyping() && window.scrollY < 80) window.scrollTo(0, 0);
    });
  }
  window.addEventListener('resize', setAppHeight);
  setAppHeight();

  // ------------------------------------------------------------------
  // Init
  // ------------------------------------------------------------------
  new ResizeObserver(resize).observe(mapEl);
  applyToggles();
  applyTimePick();
  updateHud();
  renderList();
  resize();
})();
