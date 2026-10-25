// Skanoteka Fetcher — UI. Vanilla JS, bez zależności, bez CDN.

const MB = 1024 * 1024;
const BYTES_PER_FILE = 1.3 * MB;

const state = {
  status: null,
  results: [],
  selection: new Map(), // key -> { zespol, jednostka }
  buildTimer: null,
  jobTimer: null
};

function key(zespolId, sy, seriaSuffix) {
  return `${zespolId}:${sy}:${seriaSuffix || ''}`;
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  if (!res.ok) {
    const msg = (data && data.error) || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

function fmtMB(bytes) {
  if (bytes >= 1024 * MB) return `${(bytes / MB / 1024).toFixed(1)} GB`;
  return `${Math.round(bytes / MB)} MB`;
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  if (m < 60) return `${m} min ${rem} s`;
  const h = Math.floor(m / 60);
  return `${h} godz. ${m % 60} min`;
}

// ---------------------------------------------------------------- status --

async function loadStatus() {
  const el = document.getElementById('status-text');
  const actions = document.getElementById('status-actions');
  try {
    state.status = await api('/api/status');
  } catch (err) {
    el.textContent = `Błąd wczytywania stanu: ${err.message}`;
    return;
  }
  renderStatus();
}

function renderStatus() {
  const el = document.getElementById('status-text');
  const actions = document.getElementById('status-actions');
  const st = state.status;
  actions.innerHTML = '';

  const cartDir = document.getElementById('cart-dir');
  if (cartDir && !cartDir.value && st.config) cartDir.value = st.config.pobieranieDir;

  if (st.zadanieWToku) {
    el.textContent = `Budowanie indeksu w toku (${st.zadanieWToku.postep.processed}/${st.zadanieWToku.postep.total})…`;
    watchBuildJob(st.zadanieWToku.id);
    return;
  }

  if (!st.istnieje) {
    el.innerHTML = `Indeks (ar=9) nie jest jeszcze zbudowany. Budowa: ok. 521 zapytań, ~9 minut przy domyślnym tempie.`;
    const btn = document.createElement('button');
    btn.className = 'primary';
    btn.textContent = 'Zbuduj indeks';
    btn.onclick = () => startCacheJob('build');
    actions.appendChild(btn);
    return;
  }

  el.innerHTML =
    `Indeks: <strong>${st.zespolow}</strong> zespołów, <strong>${st.jednostek}</strong> jednostek, ` +
    `<strong>${st.plikow.toLocaleString('pl-PL')}</strong> plików · zbudowany ${st.wiekDni < 1 ? 'dzisiaj' : `${Math.round(st.wiekDni)} dni temu`}`;

  const btn = document.createElement('button');
  btn.textContent = 'Odśwież indeks';
  btn.onclick = () => startCacheJob('refresh');
  actions.appendChild(btn);
}

async function startCacheJob(kind) {
  const path = kind === 'build' ? '/api/cache/build' : '/api/cache/refresh';
  const body = {};
  try {
    const { jobId } = await api(path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    watchBuildJob(jobId);
  } catch (err) {
    alert(`Nie udało się uruchomić: ${err.message}`);
  }
}

function watchBuildJob(jobId) {
  const box = document.getElementById('build-progress');
  const bar = document.getElementById('build-bar');
  const text = document.getElementById('build-text');
  box.classList.remove('hidden');

  if (state.buildTimer) clearInterval(state.buildTimer);
  state.buildTimer = setInterval(async () => {
    let job;
    try {
      job = await api(`/api/job/${jobId}`);
    } catch {
      return;
    }
    const pct = job.postep.total ? Math.round((job.postep.processed / job.postep.total) * 100) : 0;
    bar.style.width = `${pct}%`;
    const last = job.log[job.log.length - 1];
    text.textContent = `[${job.postep.processed}/${job.postep.total}] ${last ? last.message : ''}`;

    if (job.stan === 'zrobione' || job.stan === 'blad' || job.stan === 'anulowane') {
      clearInterval(state.buildTimer);
      state.buildTimer = null;
      box.classList.add('hidden');
      if (job.stan === 'blad') alert(`Błąd budowy indeksu: ${job.error}`);
      await loadStatus();
      if (document.getElementById('q').value || hasActiveFilters()) doSearch();
    }
  }, 1000);
}

// ---------------------------------------------------------------- search --

function hasActiveFilters() {
  return (
    document.getElementById('lata').value.trim() !== '' ||
    [...document.querySelectorAll('#typy input:checked')].length > 0
  );
}

let searchDebounce = null;
function scheduleSearch() {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(doSearch, 200);
}

async function doSearch() {
  const q = document.getElementById('q').value.trim();
  const lata = document.getElementById('lata').value.trim();
  const typy = [...document.querySelectorAll('#typy input:checked')].map((c) => c.value);

  if (!q && !lata && typy.length === 0) {
    state.results = [];
    renderResults();
    return;
  }

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (lata) params.set('lata', lata);
  if (typy.length) params.set('typy', typy.join(','));

  const summary = document.getElementById('results-summary');
  summary.textContent = 'Szukam…';
  try {
    const data = await api(`/api/search?${params.toString()}`);
    state.results = data.results;
  } catch (err) {
    summary.textContent = `Błąd wyszukiwania: ${err.message}`;
    return;
  }
  renderResults();
}

function groupResults(results) {
  const groups = new Map();
  for (const r of results) {
    if (!groups.has(r.zespolId)) groups.set(r.zespolId, { zespol: r.zespol, items: [] });
    groups.get(r.zespolId).items.push(r);
  }
  return [...groups.values()];
}

const RENDER_LIMIT = 400;

function renderResults() {
  const container = document.getElementById('results');
  const summary = document.getElementById('results-summary');
  container.innerHTML = '';

  if (!state.results.length) {
    summary.textContent = document.getElementById('q').value.trim() || hasActiveFilters()
      ? 'Brak wyników.'
      : '';
    return;
  }

  const groups = groupResults(state.results.slice(0, RENDER_LIMIT));
  const totalJednostek = state.results.length;
  summary.textContent =
    totalJednostek > RENDER_LIMIT
      ? `Znaleziono ${totalJednostek} jednostek w ${groupResults(state.results).length} zespołach — pokazano pierwsze ${RENDER_LIMIT}. Zwęź zapytanie, żeby zobaczyć resztę.`
      : `Znaleziono ${totalJednostek} jednostek w ${groups.length} zespołach.`;

  for (const group of groups) {
    container.appendChild(renderGroup(group));
  }
}

function renderGroup(group) {
  const { zespol, items } = group;
  const el = document.createElement('div');
  el.className = 'group';

  const header = document.createElement('div');
  header.className = 'group-header';
  header.innerHTML =
    `<span class="caret">▶</span>` +
    `<span class="name">${escapeHtml(zespol.parafia)}</span>` +
    `<span class="meta">zespół ${escapeHtml(zespol.nrZespolu)}${zespol.wojewodztwo ? ` · ${escapeHtml(zespol.wojewodztwo)}${zespol.powiat ? '/' + escapeHtml(zespol.powiat) : ''}` : ''} · ${items.length} jedn.</span>`;
  header.onclick = () => el.classList.toggle('open');
  el.appendChild(header);

  const body = document.createElement('div');
  body.className = 'group-body';

  for (const r of items) {
    body.appendChild(renderUnitRow(zespol, r));
  }
  el.appendChild(body);

  // grupy z trafieniem w miejscowości domyślnie rozwinięte (najczęstszy przypadek użycia)
  if (items.some((r) => r.trafienieW === 'miejscowosc')) el.classList.add('open');

  return el;
}

function renderUnitRow(zespol, r) {
  const j = r.jednostka;
  const row = document.createElement('label');
  row.className = 'unit-row';

  const cb = document.createElement('input');
  cb.type = 'checkbox';
  cb.checked = state.selection.has(key(zespol.id, j.sy, j.seriaSuffix));
  cb.onchange = () => toggleUnit(zespol, j, cb.checked);

  const miejsce = j.miejscowosc || `(${zespol.parafia})`;
  const lataTxt = j.lata ? `${j.lata[0]}–${j.lata[1]}` : 'bez dat';
  const mb = fmtMB((j.plikow || 0) * BYTES_PER_FILE);

  row.appendChild(cb);
  const typ = document.createElement('span');
  typ.className = 'typ';
  typ.textContent = j.typNazwa || j.typ;
  row.appendChild(typ);

  const place = document.createElement('span');
  place.className = 'place';
  place.textContent = miejsce;
  if (r.trafienieW === 'miejscowosc') {
    const b = document.createElement('span');
    b.className = 'badge';
    b.textContent = 'trafienie';
    b.style.marginLeft = '8px';
    place.appendChild(b);
  }
  row.appendChild(place);

  const lata = document.createElement('span');
  lata.className = 'lata';
  lata.textContent = lataTxt;
  if (!j.lata) {
    lata.classList.add('badge', 'warn');
    lata.style.textAlign = 'center';
  }
  row.appendChild(lata);

  const count = document.createElement('span');
  count.className = 'count';
  count.textContent = `${j.plikow} plików, ${mb}`;
  row.appendChild(count);

  return row;
}

function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ------------------------------------------------------------------ cart --

function toggleUnit(zespol, jednostka, checked) {
  const k = key(zespol.id, jednostka.sy, jednostka.seriaSuffix);
  if (checked) state.selection.set(k, { zespol, jednostka });
  else state.selection.delete(k);
  updateCart();
}

function updateCart() {
  const cart = document.getElementById('cart');
  const summary = document.getElementById('cart-summary');
  const n = state.selection.size;

  if (n === 0) {
    cart.classList.add('hidden');
    return;
  }
  cart.classList.remove('hidden');

  let plikow = 0;
  for (const { jednostka } of state.selection.values()) plikow += jednostka.plikow || 0;
  const bajty = plikow * BYTES_PER_FILE;
  summary.textContent = `Wybrano ${n} jednostek · ${plikow} plików · ~${fmtMB(bajty)}`;
}

document.getElementById('cart-clear').onclick = () => {
  state.selection.clear();
  updateCart();
  renderResults();
};

document.getElementById('cart-download').onclick = async () => {
  const dir = document.getElementById('cart-dir').value.trim();
  const items = [...state.selection.values()].map(({ zespol, jednostka }) => ({
    zespolId: zespol.id,
    sy: jednostka.sy,
    seriaSuffix: jednostka.seriaSuffix || ''
  }));
  if (!items.length) return;

  let resp;
  try {
    resp = await api('/api/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items, dir: dir || undefined })
    });
  } catch (err) {
    alert(`Nie udało się uruchomić pobierania: ${err.message}`);
    return;
  }
  openProgress(resp.jobId, resp.estimate, resp.baseDir);
};

// -------------------------------------------------------------- progress --

function openProgress(jobId, estimate, baseDir) {
  const overlay = document.getElementById('progress-overlay');
  overlay.classList.remove('hidden');
  document.getElementById('progress-title').textContent = 'Pobieranie…';
  document.getElementById('progress-done').classList.add('hidden');
  document.getElementById('progress-cancel').classList.remove('hidden');
  document.getElementById('progress-panel').textContent = `Folder docelowy: ${baseDir}\n`;
  document.getElementById('progress-stats').textContent =
    `Szacowane: ${estimate.plikow} plików, ~${fmtMB(estimate.bajtySzac)}, ${fmtDuration(estimate.czasSzacMs)}`;
  document.getElementById('progress-bar').style.width = '0%';

  document.getElementById('progress-cancel').onclick = async () => {
    try {
      await api(`/api/job/${jobId}/cancel`, { method: 'POST' });
    } catch {
      // zignoruj — odpytywanie i tak pokaże finalny stan
    }
  };

  if (state.jobTimer) clearInterval(state.jobTimer);
  state.jobTimer = setInterval(async () => {
    let job;
    try {
      job = await api(`/api/job/${jobId}`);
    } catch {
      return;
    }
    const done = job.postep.pobrane + job.postep.pominiete;
    const pct = job.postep.total ? Math.min(100, Math.round((done / job.postep.total) * 100)) : 0;
    document.getElementById('progress-bar').style.width = `${pct}%`;
    document.getElementById('progress-stats').textContent =
      `Pobrano ${job.postep.pobrane}, pominięto ${job.postep.pominiete}, błędów ${job.postep.bledy.length} z ok. ${job.postep.total} plików`;
    document.getElementById('progress-panel').textContent =
      `Folder docelowy: ${baseDir}\n` + job.log.map((l) => l.message).join('\n');
    document.getElementById('progress-panel').scrollTop = document.getElementById('progress-panel').scrollHeight;

    if (job.stan === 'zrobione' || job.stan === 'blad' || job.stan === 'anulowane') {
      clearInterval(state.jobTimer);
      state.jobTimer = null;
      document.getElementById('progress-cancel').classList.add('hidden');
      document.getElementById('progress-done').classList.remove('hidden');
      document.getElementById('progress-title').textContent =
        job.stan === 'zrobione' ? 'Gotowe' : job.stan === 'anulowane' ? 'Anulowano' : 'Błąd';

      if (job.stan === 'zrobione' && job.result) {
        const paths = [...new Set(job.result.map((r) => r.dir).filter(Boolean))];
        document.getElementById('progress-panel').textContent += `\n\nZapisano do:\n${paths.join('\n')}`;
      }
      if (job.error) {
        document.getElementById('progress-panel').textContent += `\n\nBłąd: ${job.error}`;
      }

      state.selection.clear();
      updateCart();
      loadStatus();
    }
  }, 1000);
}

document.getElementById('progress-close').onclick = () => {
  document.getElementById('progress-overlay').classList.add('hidden');
  renderResults();
};

// -------------------------------------------------------------------- init --

document.getElementById('q').addEventListener('input', scheduleSearch);
document.getElementById('lata').addEventListener('input', scheduleSearch);
document.querySelectorAll('#typy input').forEach((cb) => cb.addEventListener('change', doSearch));

loadStatus();
