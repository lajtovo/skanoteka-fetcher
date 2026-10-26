import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fetchText, fetchBinary, createRateLimiter, sleep } from './http.mjs';
import { parseUnit, extractImageTokens, buildPgUrl } from './parse.mjs';
import { resolveUnitFolderPath, buildOpisTxt, buildMetadataJson, buildBledyTxt } from './naming.mjs';
import { BASE_URL } from './cache.mjs';

const MB = 1024 * 1024;
const BYTES_PER_FILE_ESTIMATE = 1.3 * MB;

// Plik, który się nie uda, nie ma od razu lądować w błędach — serwer bywa
// chwilowo niedostępny. Ponawiamy w kilku "falach" z rosnącym odstępem,
// odświeżając tokeny dir/znak przed każdą falą, zanim uznamy plik za martwy.
const SWEEP_DELAYS_MS = [0, 2000, 8000, 20000];

function unitUrl(zespolId, sy, seriaSuffix) {
  return `${BASE_URL}/id${zespolId}-sy${sy}${seriaSuffix || ''}`;
}

function isValidJpeg(buffer) {
  if (!buffer || buffer.length < 4) return false;
  const startsOk = buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;
  const endsOk =
    buffer[buffer.length - 2] === 0xff && buffer[buffer.length - 1] === 0xd9;
  return startsOk && endsOk;
}

/** Szacunek rozmiaru/czasu pobierania wybranych jednostek (przed startem). */
export function estimateDownload(items, config) {
  const plikow = items.reduce((acc, i) => acc + (i.jednostka.plikow || 0), 0);
  const bajtySzac = plikow * BYTES_PER_FILE_ESTIMATE;
  const concurrency = config?.concurrency || 1;
  const imageDelayMs = config?.imageDelayMs ?? 500;
  const perFileMs = imageDelayMs / concurrency;
  const czasSzacMs = plikow * perFileMs;
  return { plikow, bajtySzac, czasSzacMs };
}

/**
 * Pobiera wszystkie pliki jednej jednostki do odpowiedniego folderu.
 * `htmlLimiter`/`imageLimiter` są współdzielone między jednostkami w jednym
 * zadaniu, żeby tempo było globalne, nie resetowane per-jednostka.
 */
export async function downloadUnit({
  zespol,
  jednostka,
  baseDir,
  template,
  config,
  htmlLimiter,
  imageLimiter,
  onProgress,
  signal
}) {
  const unitPageUrl = unitUrl(zespol.id, jednostka.sy, jednostka.seriaSuffix);
  const html = await fetchText(unitPageUrl, {
    userAgent: config.userAgent,
    limiter: htmlLimiter,
    referer: BASE_URL
  });
  const unit = parseUnit(html);

  if (!unit.pliki.length) {
    return {
      dir: null,
      pobrane: 0,
      pominiete: 0,
      bledy: [{ plik: null, powod: 'Brak plików na stronie jednostki' }]
    };
  }

  const dir = resolveUnitFolderPath(baseDir, zespol, jednostka, template);
  await mkdir(dir, { recursive: true });

  const sourceUrl = unitPageUrl;
  const pobranoDate = new Date();

  // _opis.txt i _metadane.json zapisujemy PRZED plikami (patrz PLAN.md §9 pkt 10) —
  // częściowe pobranie (np. po Ctrl-C) ma być rozpoznawalne.
  await writeFile(
    path.join(dir, '_opis.txt'),
    buildOpisTxt({ zespol, jednostka, sourceUrl, pobrano: pobranoDate }),
    'utf8'
  );
  const metaPath = path.join(dir, '_metadane.json');
  await writeFile(
    metaPath,
    JSON.stringify(
      buildMetadataJson({ zespol, jednostka, sourceUrl, pobrano: pobranoDate, pliki: unit.pliki }),
      null,
      2
    ),
    'utf8'
  );

  let tokens = null;
  async function refreshTokens() {
    const pgUrl = `${BASE_URL}/${buildPgUrl(unit.pgParamsTemplate, unit.pliki[0].nazwa)}`;
    const pgHtml = await fetchText(pgUrl, {
      userAgent: config.userAgent,
      limiter: htmlLimiter,
      referer: unitPageUrl
    });
    const t = extractImageTokens(pgHtml);
    if (!t) throw new Error('Nie znaleziono tokenów dir/znak na stronie podglądu');
    tokens = t;
  }
  await refreshTokens();

  let pobrane = 0;
  let pominiete = 0;
  const plikiZMetadanymi = [];
  const lastErrors = new Map(); // nazwa -> komunikat ostatniego błędu
  const workerCount = Math.max(1, config.concurrency || 1);

  async function pobierzJeden(plik) {
    const destPath = path.join(dir, plik.nazwa);
    const partPath = `${destPath}.part`;

    if (existsSync(destPath)) {
      try {
        const existing = await readFile(destPath);
        if (isValidJpeg(existing)) {
          pominiete++;
          plikiZMetadanymi.push({ nazwa: plik.nazwa, bajty: existing.length });
          onProgress?.({ type: 'file', status: 'skipped', plik: plik.nazwa });
          return true;
        }
      } catch {
        // nie udało się odczytać — spróbuj pobrać ponownie
      }
    }

    try {
      await imageLimiter.acquire();
      const downloadUrl =
        `https://metbox3.genealodzy.pl/metryka_get.php?` +
        `dir=${tokens.dir}&znak=${tokens.znak}&plik=${encodeURIComponent(plik.nazwa)}`;
      const res = await fetchBinary(downloadUrl, {
        userAgent: config.userAgent,
        referer: unitPageUrl,
        maxAttempts: 1
      });
      if (!isValidJpeg(res.buffer) || !res.contentType.includes('image')) {
        throw new Error(
          `nieprawidłowa odpowiedź (${res.contentType || 'brak content-type'}, ${res.buffer.length} B)`
        );
      }
      await writeFile(partPath, res.buffer);
      await rename(partPath, destPath);
      pobrane++;
      plikiZMetadanymi.push({ nazwa: plik.nazwa, bajty: res.buffer.length });
      onProgress?.({ type: 'file', status: 'downloaded', plik: plik.nazwa });
      return true;
    } catch (err) {
      lastErrors.set(plik.nazwa, err.message);
      return false;
    }
  }

  let pending = unit.pliki;
  for (let sweep = 0; sweep < SWEEP_DELAYS_MS.length && pending.length && !signal?.aborted; sweep++) {
    if (sweep > 0) {
      onProgress?.({ type: 'retry-sweep', sweep, count: pending.length });
      await sleep(SWEEP_DELAYS_MS[sweep]);
      try {
        await refreshTokens();
      } catch {
        // jeśli odświeżenie się nie uda, kolejna fala i tak szybko zawiedzie
      }
    }

    const queue = [...pending];
    const failedThisSweep = [];
    async function worker() {
      while (queue.length) {
        if (signal?.aborted) return;
        const plik = queue.shift();
        if (!plik) continue;
        const ok = await pobierzJeden(plik);
        if (!ok) failedThisSweep.push(plik);
      }
    }
    await Promise.all(Array.from({ length: workerCount }, () => worker()));
    pending = failedThisSweep;
  }

  const bledy = pending.map((p) => ({ plik: p.nazwa, powod: lastErrors.get(p.nazwa) || 'nieznany błąd' }));
  for (const b of bledy) onProgress?.({ type: 'file', status: 'error', plik: b.plik, error: b.powod });

  const bledyPath = path.join(dir, '_bledy.txt');
  if (bledy.length) {
    await writeFile(bledyPath, buildBledyTxt({ bledy, sourceUrl, sprawdzono: new Date() }), 'utf8');
  } else if (existsSync(bledyPath)) {
    // poprzedni przebieg miał błędy, ten je naprawił (dociągnięte przy wznowieniu)
    await rm(bledyPath, { force: true });
  }

  // finalny zapis metadanych z realnymi rozmiarami plików
  await writeFile(
    metaPath,
    JSON.stringify(
      buildMetadataJson({
        zespol,
        jednostka,
        sourceUrl,
        pobrano: pobranoDate,
        pliki: plikiZMetadanymi
      }),
      null,
      2
    ),
    'utf8'
  );

  return { dir, pobrane, pominiete, bledy };
}

/**
 * Pobiera listę jednostek sekwencyjnie (jedna po drugiej), ze współbieżnością
 * tylko wewnątrz każdej jednostki — postęp jest czytelny, a obciążenie
 * serwera nie rośnie wraz z liczbą wybranych jednostek.
 */
export async function downloadSelection(items, { baseDir, template, config, onProgress, signal }) {
  const htmlLimiter = createRateLimiter(config.delayMs);
  const imageLimiter = createRateLimiter(config.imageDelayMs);
  const results = [];

  for (const item of items) {
    if (signal?.aborted) break;
    const { zespol, jednostka } = item;
    onProgress?.({ type: 'unit-start', zespolId: zespol.id, sy: jednostka.sy, jednostka });
    let result;
    try {
      result = await downloadUnit({
        zespol,
        jednostka,
        baseDir,
        template,
        config,
        htmlLimiter,
        imageLimiter,
        onProgress,
        signal
      });
    } catch (err) {
      result = { dir: null, pobrane: 0, pominiete: 0, bledy: [{ plik: null, powod: err.message }] };
    }
    results.push({ zespolId: zespol.id, sy: jednostka.sy, ...result });
    onProgress?.({ type: 'unit-done', zespolId: zespol.id, sy: jednostka.sy, ...result });
  }

  return results;
}
