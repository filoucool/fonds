const varCache = new WeakMap();

(function () {
  const motion = document.documentElement.dataset.motion === 'ok' ? 'ok' : 'reduce';

  bindLinks();
  buildTiles();
  setupFolder();
  setupRefs();
  setupCatalog();
  const tip = setupGraph();
  const titleDraw = prepareTitleDraw();
  const titleScene = document.getElementById('fonds');
  const lossScene = document.getElementById('loss');
  const hostingScene = document.getElementById('hosting');
  const depsScene = document.getElementById('dependencies');
  const lossBeat = document.getElementById('loss-beat');
  const lossHits = lossScene ? [...lossScene.querySelectorAll('.hit')] : [];
  document.querySelectorAll('.word').forEach((word, index) => {
    word.style.setProperty('--i', String(0.06 + index * 0.14));
  });

  const toneScenes = [...document.querySelectorAll('main .scene')].map((el) => ({
    el,
    tone: toneFor(el.id),
  }));
  if (motion !== 'ok') {
    toneScenes.forEach((scene) => paintTone(scene.el, scene.tone));
    return;
  }

  const shown = { title: 0, loss: 0, hosting: 0, deps: 0 };
  const toneShown = toneScenes.map((scene) => hexRgb(scene.tone));
  let lossPhase = -1;
  let lastTime = 0;
  let running = false;

  function paint(now) {
    const dt = Math.min(0.032, lastTime ? (now - lastTime) / 1000 : 0.016);
    lastTime = now;
    const title = progressOf(titleScene);
    const loss = progressOf(lossScene);
    const hosting = progressOf(hostingScene);
    const deps = progressOf(depsScene);
    const glide = Math.min(0.18, 1 - Math.exp(-dt / 0.07));
    const tonesSettled = updateTones(glide);
    const titleP = easeToward(shown, 'title', title, glide);
    const lossP = easeToward(shown, 'loss', loss, glide);
    const hostP = easeToward(shown, 'hosting', hosting, glide);
    const depsP = easeToward(shown, 'deps', deps, glide);
    updateTitle(titleP);
    updateLoss(lossP);
    updateHosting(hostP);
    updateDeps(depsP);
    if (tip && !tip.hidden) tip.hidden = true;
    const settled = tonesSettled && titleP === title && lossP === loss && hostP === hosting && depsP === deps;
    if (settled) {
      running = false;
      lastTime = 0;
      return;
    }
    window.requestAnimationFrame(paint);
  }

  function requestUpdate() {
    if (running) return;
    running = true;
    window.requestAnimationFrame(paint);
  }

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', () => {
    buildTiles();
    requestUpdate();
  });
  window.addEventListener('pageshow', requestUpdate);
  requestUpdate();

  function updateTitle(p) {
    if (!titleScene) return;
    setVar(titleScene, '--title-p', p);
    setDraw(titleDraw, 0.2 + p * 0.8);
  }

  function updateLoss(p) {
    if (!lossScene) return;
    const force = ramp(p, 0.05, 0.32);
    const drop = ramp(p, 0.36, 0.62);
    const gone = ramp(p, 0.66, 0.9);
    setVar(lossScene, '--force', force);
    setVar(lossScene, '--drop', drop);
    setVar(lossScene, '--gone', gone);
    const forced = force > 0.4;
    const deleted = drop > 0.4;
    lossScene.classList.toggle('is-forced', forced);
    lossScene.classList.toggle('is-deleted', deleted);
    const phase = gone > 0.55 ? 3 : deleted ? 2 : forced ? 1 : 0;
    if (phase === lossPhase) return;
    lossPhase = phase;
    if (!lossBeat) return;
    const lines = [
      'The same commits, in two places.',
      'Force-push. The old main stays at refs/archive/keep/.',
      'Branch deleted. The feature tip stays under refs/archive/history/.',
      'Repository removed. The host is a 404. The directory is still on disk.',
    ];
    const text = lines[phase] || lines[0];
    if (lossBeat.textContent !== text) lossBeat.textContent = text;
    lossHits.forEach((hit) => {
      const kind = hit.getAttribute('data-kind');
      const keep = hit.getAttribute('data-keep');
      const revealed = (kind === 'main' && forced) || (kind === 'feature' && deleted);
      const label = revealed && keep ? keep : kind === 'feature' ? 'Commit on feature' : 'Commit on main';
      if (hit.getAttribute('aria-label') !== label) hit.setAttribute('aria-label', label);
    });
  }

  function updateHosting(p) {
    if (!hostingScene) return;
    setVar(hostingScene, '--p', p);
  }

  function updateDeps(p) {
    if (!depsScene) return;
    setVar(depsScene, '--drop', ramp(p, 0.16, 0.42));
    setVar(depsScene, '--hollow', ramp(p, 0.4, 0.7));
    setVar(depsScene, '--line', ramp(p, 0.55, 0.8));
  }

  function isHold(el) {
    return el.classList.contains('span-hold');
  }

  function holdProgress(el, vh) {
    const scrollable = el.offsetHeight - vh;
    if (scrollable <= 0) return 0;
    return clamp(-el.getBoundingClientRect().top / scrollable, 0, 1);
  }

  function targetTone(index, vh) {
    const scene = toneScenes[index];
    const next = toneScenes[index + 1];
    const prev = toneScenes[index - 1];
    const own = hexRgb(scene.tone);
    const top = scene.el.getBoundingClientRect().top;

    if (isHold(scene.el) && next && top <= 0) {
      return mixRgb(own, hexRgb(next.tone), holdProgress(scene.el, vh));
    }
    if (next && !isHold(scene.el)) {
      const handoff = clamp(1 - next.el.getBoundingClientRect().top / vh, 0, 1);
      if (handoff > 0) return mixRgb(own, hexRgb(next.tone), handoff);
    }
    if (prev && isHold(prev.el) && prev.el.getBoundingClientRect().top <= 0) {
      return mixRgb(hexRgb(prev.tone), own, holdProgress(prev.el, vh));
    }
    if (prev) {
      const handoff = clamp(1 - top / vh, 0, 1);
      if (handoff < 1) return mixRgb(hexRgb(prev.tone), own, handoff);
    }
    return own;
  }

  function updateTones(glide) {
    const vh = window.innerHeight;
    const mid = vh * 0.5;
    let body = '#0e100c';
    let settled = true;
    for (let index = 0; index < toneScenes.length; index += 1) {
      const scene = toneScenes[index];
      const want = targetTone(index, vh);
      const shownTone = toneShown[index];
      for (let channel = 0; channel < 3; channel += 1) {
        const next = shownTone[channel] + (want[channel] - shownTone[channel]) * glide;
        if (Math.abs(want[channel] - next) < 0.4) shownTone[channel] = want[channel];
        else {
          shownTone[channel] = next;
          settled = false;
        }
      }
      const color = rgbText(shownTone);
      paintTone(scene.el, color);
      const rect = scene.el.getBoundingClientRect();
      if (rect.top <= mid && rect.bottom >= mid) body = color;
    }
    if (document.body.style.backgroundColor !== body) document.body.style.backgroundColor = body;
    return settled;
  }
})();

function bindLinks() {
  const cfg = window.TRYFONDS;
  if (!cfg) return;
  const github = document.getElementById('btn-github');
  const footer = document.getElementById('footer-github');
  const demo = document.getElementById('btn-demo');
  const githubMeta = document.getElementById('github-meta');
  const demoMeta = document.getElementById('demo-meta');
  if (typeof cfg.githubUrl === 'string') {
    if (github) github.setAttribute('href', cfg.githubUrl);
    if (footer) footer.setAttribute('href', cfg.githubUrl);
  }
  if (typeof cfg.repoName === 'string') {
    if (footer) footer.textContent = cfg.repoName;
    if (githubMeta) githubMeta.textContent = cfg.repoName;
  }
  if (typeof cfg.demoUrl === 'string' && demo) {
    demo.setAttribute('href', cfg.demoUrl);
    if (demoMeta) {
      try {
        demoMeta.textContent = new URL(cfg.demoUrl).host;
      } catch {
        demoMeta.textContent = cfg.demoUrl;
      }
    }
  }
}

function buildTiles() {
  const field = document.getElementById('tile-field');
  if (!field) return [];
  const narrow = window.innerWidth < 700;
  const cols = narrow ? 8 : 14;
  const rows = narrow ? 8 : 7;
  const count = cols * rows;
  const kept = new Set(narrow ? [3, 14, 22, 36, 45, 53] : [5, 18, 27, 40, 55, 66, 80, 90]);
  const frozen = document.documentElement.dataset.motion !== 'ok';
  field.replaceChildren();
  field.style.setProperty('--cols', String(cols));
  const tiles = [];
  for (let index = 0; index < count; index += 1) {
    const tile = document.createElement('span');
    tile.className = 'tile';
    const col = index % cols;
    const row = Math.floor(index / cols);
    const wave = (col + row * 0.75) / (cols + rows * 0.75);
    tile.dataset.wave = String(wave);
    tile.style.setProperty('--wave', String(0.08 + wave * 0.78));
    if (kept.has(index)) tile.dataset.kept = 'true';
    else if (frozen) tile.classList.add('is-dark');
    field.append(tile);
    tiles.push(tile);
  }
  return tiles;
}

function setupFolder() {
  const folder = document.getElementById('archive-folder');
  if (!folder) return;
  if (document.documentElement.dataset.motion === 'ok') folder.open = false;
}

function setupRefs() {
  const card = document.getElementById('ref-card');
  const button = document.getElementById('copy-tips');
  const status = document.getElementById('ref-status');
  if (!card || !button || !status) return;
  const reduce = document.documentElement.dataset.motion !== 'ok';
  if (reduce) {
    button.textContent = 'Show before the fetch';
    button.addEventListener('click', () => {
      const before = card.classList.toggle('is-before');
      card.classList.remove('is-copying');
      status.textContent = before
        ? 'Before publish, only the branch tips are current.'
        : 'After publish, main has moved. The archive refs still name the old tips.';
      button.textContent = before ? 'Show after publish' : 'Show before the fetch';
    });
    return;
  }
  card.classList.add('is-before');
  let playing = false;
  button.addEventListener('click', () => {
    if (playing) return;
    playing = true;
    button.disabled = true;
    card.classList.add('is-before');
    card.classList.remove('is-copying');
    status.textContent = '';
    window.setTimeout(() => {
      card.classList.remove('is-before');
      card.classList.add('is-copying');
      status.textContent = 'Current tips are stored under refs/archive/ before publish.';
    }, 280);
    window.setTimeout(() => {
      card.classList.remove('is-copying');
      status.textContent = 'main moved. The keep and history refs still name the old tips.';
      button.textContent = 'Replay';
      button.disabled = false;
      playing = false;
    }, 1100);
  });
}

function setupCatalog() {
  const button = document.getElementById('lose-db');
  const status = document.getElementById('catalog-status');
  const index = document.getElementById('catalog-index');
  const pool = document.getElementById('catalog-pool');
  if (!button || !status || !index || !pool) return;
  const indexItems = [...index.querySelectorAll('li')];
  const poolItems = [...pool.querySelectorAll('li')];
  let running = false;
  button.addEventListener('click', async () => {
    if (running) return;
    running = true;
    button.disabled = true;
    const reduce = document.documentElement.dataset.motion !== 'ok';
    const step = reduce ? 0 : 140;
    try {
      indexItems.forEach((item) => item.classList.add('is-gone'));
      status.textContent = 'Database lost. Scanning pools…';
      for (let i = 0; i < poolItems.length; i += 1) {
        poolItems.forEach((item) => item.classList.remove('is-hot'));
        const current = poolItems[i];
        if (current) current.classList.add('is-hot');
        if (step) await wait(step);
      }
      poolItems.forEach((item) => item.classList.remove('is-hot'));
      if (!step) await wait(0);
      for (let i = 0; i < indexItems.length; i += 1) {
        const current = indexItems[i];
        if (current) current.classList.remove('is-gone');
        if (step) await wait(step);
      }
      status.textContent = 'Catalog rebuilt from the directories on disk.';
      button.textContent = 'Lose it again';
    } finally {
      poolItems.forEach((item) => item.classList.remove('is-hot'));
      button.disabled = false;
      running = false;
    }
  });
}

function setupGraph() {
  const scene = document.getElementById('loss');
  const tip = document.getElementById('commit-tip');
  const history = document.getElementById('tip-history');
  const keep = document.getElementById('tip-keep');
  if (!scene || !tip || !history || !keep) return null;

  function show(hit, x, y) {
    const kind = hit.getAttribute('data-kind');
    const revealed =
      document.documentElement.dataset.motion !== 'ok' ||
      window.matchMedia('(max-width: 800px)').matches ||
      (kind === 'main' && scene.classList.contains('is-forced')) ||
      (kind === 'feature' && scene.classList.contains('is-deleted'));
    if (!revealed) {
      tip.hidden = true;
      return;
    }
    const keepText = hit.getAttribute('data-keep') || '';
    const historyText = hit.getAttribute('data-history') || '';
    history.textContent = historyText;
    keep.textContent = keepText;
    history.hidden = historyText.length === 0;
    keep.hidden = keepText.length === 0;
    tip.hidden = false;
    placeTip(tip, x, y);
  }

  scene.addEventListener('pointerover', (event) => {
    const hit = closestHit(event.target);
    if (!hit || !scene.contains(hit)) return;
    show(hit, event.clientX, event.clientY);
  });
  scene.addEventListener('pointermove', (event) => {
    if (tip.hidden) return;
    const hit = closestHit(event.target);
    if (!hit) return;
    placeTip(tip, event.clientX, event.clientY);
  });
  scene.addEventListener('pointerout', (event) => {
    const hit = closestHit(event.target);
    if (!hit) return;
    if (closestHit(event.relatedTarget) === hit) return;
    tip.hidden = true;
  });
  scene.addEventListener('focusin', (event) => {
    const hit = closestHit(event.target);
    if (!hit) return;
    const rect = hit.getBoundingClientRect();
    show(hit, rect.left + rect.width / 2, rect.bottom);
  });
  scene.addEventListener('focusout', () => {
    tip.hidden = true;
  });
  return tip;
}

function prepareTitleDraw() {
  if (document.documentElement.dataset.motion !== 'ok') return [];
  const svg = document.getElementById('title-graph');
  if (!svg) return [];
  const items = [];
  svg.querySelectorAll('path').forEach((path) => {
    if (!(path instanceof SVGPathElement)) return;
    const len = path.getTotalLength();
    if (!Number.isFinite(len) || len <= 0) return;
    path.style.strokeDasharray = `${len}`;
    items.push({ path, len });
  });
  return items;
}

function setDraw(items, amount) {
  const shown = clamp(amount, 0, 1);
  items.forEach((item) => {
    const next = Math.round(item.len * (1 - shown) * 10) / 10;
    if (item.drawn === next) return;
    item.drawn = next;
    item.path.style.strokeDashoffset = String(next);
  });
}

function setVar(el, name, value) {
  const next = Math.round(value * 10000) / 10000;
  let bag = varCache.get(el);
  if (!bag) {
    bag = {};
    varCache.set(el, bag);
  }
  if (bag[name] === next) return;
  bag[name] = next;
  el.style.setProperty(name, String(next));
}

function ramp(p, start, end) {
  if (p <= start) return 0;
  if (p >= end) return 1;
  const t = (p - start) / (end - start);
  return t * t * (3 - 2 * t);
}

function placeTip(tip, x, y) {
  const pad = 12;
  const rect = tip.getBoundingClientRect();
  let left = x + 16;
  let top = y + 16;
  if (left + rect.width > window.innerWidth - pad) left = x - rect.width - 16;
  if (top + rect.height > window.innerHeight - pad) top = y - rect.height - 16;
  tip.style.left = `${Math.max(pad, left)}px`;
  tip.style.top = `${Math.max(pad, top)}px`;
}

function closestHit(target) {
  if (!(target instanceof Element)) return null;
  return target.closest('.hit');
}

function progressOf(section) {
  if (!section) return 0;
  const rect = section.getBoundingClientRect();
  const scrollable = section.offsetHeight - window.innerHeight;
  if (scrollable <= 0) return 1;
  return clamp(-rect.top / scrollable, 0, 1);
}

function toneFor(id) {
  const tones = {
    fonds: '#2a160c',
    definition: '#0c0c0c',
    loss: '#2a160c',
    hosting: '#0c0c0c',
    dependencies: '#2a160c',
    remains: '#0c0c0c',
    decades: '#2a160c',
  };
  return tones[id] || '#0e100c';
}

function paintTone(el, color) {
  if (el.style.getPropertyValue('--scene-bg') !== color) el.style.setProperty('--scene-bg', color);
}

function mixRgb(from, to, amount) {
  return from.map((channel, index) => channel + (to[index] - channel) * amount);
}

function rgbText(channels) {
  return `rgb(${Math.round(channels[0])} ${Math.round(channels[1])} ${Math.round(channels[2])})`;
}

function hexRgb(hex) {
  const value = hex.replace('#', '');
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function easeToward(shown, key, target, glide) {
  const next = shown[key] + (target - shown[key]) * glide;
  if (Math.abs(target - next) < 0.0004) {
    shown[key] = target;
    return target;
  }
  shown[key] = next;
  return next;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function wait(ms) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}
