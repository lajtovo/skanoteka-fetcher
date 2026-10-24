import { mkdir, readFile, writeFile, rename, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fetchText, createRateLimiter } from './http.mjs';
import { parseArchiveList, parseFonds, extractParafia } from './parse.mjs';
import { archivePath, archiveProgressPath, CACHE_DIR } from './config.mjs';

export const BASE_URL = 'https://skanoteka.genealodzy.pl';

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.tmp`;
  await writeFile(tmpPath, JSON.stringify(data), 'utf8');
  await rename(tmpPath, filePath);
}

function toZespolRecord(entry, fonds, pobrano) {
  const nazwa = fonds?.nazwa ?? entry.nazwa;
  return {
    id: entry.id,
    nrZespolu: fonds?.nrZespolu ?? entry.nrZespolu,
    nazwa,
    parafia: extractParafia(nazwa),
    wojewodztwo: fonds?.wojewodztwo ?? null,
    powiat: fonds?.powiat ?? null,
    lata: entry.lata,
    plikow: entry.plikow,
    autorzyZdjec: fonds?.autorzyZdjec ?? [],
    pobrano,
    jednostki: fonds?.jednostki ?? []
  };
}

/**
 * Budowa pełnego cache'u dla archiwum `ar`. Wznawialna: zapisuje progress
 * co 10 zespołów, kolejne wywołanie pomija już pobrane.
 */
export async function build({ ar, config, onProgress, signal }) {
  await mkdir(CACHE_DIR, { recursive: true });
  const limiter = createRateLimiter(config.delayMs);
  const listUrl = `${BASE_URL}/opza-ar${ar}`;

  onProgress?.({ type: 'start', message: 'Pobieranie listy zespołów…' });
  const listHtml = await fetchText(listUrl, {
    userAgent: config.userAgent,
    limiter,
    referer: BASE_URL
  });
  const list = parseArchiveList(listHtml);

  const progressPath = archiveProgressPath(ar);
  let zespoly = [];
  if (existsSync(progressPath)) {
    try {
      const raw = JSON.parse(await readFile(progressPath, 'utf8'));
      zespoly = raw.zespoly || [];
    } catch {
      zespoly = [];
    }
  }
  const doneIds = new Set(zespoly.map((z) => z.id));

  let processed = doneIds.size;
  const errors = [];
  for (const entry of list) {
    if (signal?.aborted) break;
    if (doneIds.has(entry.id)) continue;

    const url = `${BASE_URL}/id${entry.id}`;
    try {
      const html = await fetchText(url, {
        userAgent: config.userAgent,
        limiter,
        referer: listUrl
      });
      const fonds = parseFonds(html);
      zespoly.push(toZespolRecord(entry, fonds, new Date().toISOString()));
    } catch (err) {
      errors.push({ id: entry.id, nazwa: entry.nazwa, error: err.message });
      // zapisz wpis bez jednostek, żeby nie próbować w kółko tej samej strony
      zespoly.push(toZespolRecord(entry, null, new Date().toISOString()));
    }
    doneIds.add(entry.id);
    processed++;
    onProgress?.({
      type: 'progress',
      processed,
      total: list.length,
      id: entry.id,
      nazwa: entry.nazwa
    });

    if (processed % 10 === 0) {
      await writeJsonAtomic(progressPath, { zespoly });
    }
  }

  const result = {
    schemaVersion: 1,
    archiwum: { ar, nazwa: 'Parafia' },
    zbudowano: new Date().toISOString(),
    zespoly
  };
  await writeJsonAtomic(archivePath(ar), result);
  if (existsSync(progressPath)) await rm(progressPath);

  onProgress?.({ type: 'done', zespolow: zespoly.length, bledy: errors.length });
  return { data: result, errors, aborted: !!signal?.aborted };
}

/**
 * Odświeżenie inkrementalne: 1 request na listę + requesty tylko dla
 * zespołów nowych albo takich, którym zmieniła się liczba plików/lata.
 */
export async function refresh({ ar, config, onProgress, signal }) {
  const existing = await load(ar);
  if (!existing) {
    return build({ ar, config, onProgress, signal });
  }

  const limiter = createRateLimiter(config.delayMs);
  const listUrl = `${BASE_URL}/opza-ar${ar}`;
  onProgress?.({ type: 'start', message: 'Sprawdzanie zmian…' });
  const listHtml = await fetchText(listUrl, {
    userAgent: config.userAgent,
    limiter,
    referer: BASE_URL
  });
  const list = parseArchiveList(listHtml);

  const byId = new Map(existing.zespoly.map((z) => [z.id, z]));
  const zespoly = [];
  const errors = [];
  let checked = 0;
  let refreshed = 0;

  for (const entry of list) {
    if (signal?.aborted) {
      zespoly.push(byId.get(entry.id) ?? toZespolRecord(entry, null, new Date().toISOString()));
      continue;
    }
    const prev = byId.get(entry.id);
    const changed =
      !prev ||
      prev.plikow !== entry.plikow ||
      JSON.stringify(prev.lata) !== JSON.stringify(entry.lata);

    checked++;
    if (!changed) {
      zespoly.push(prev);
      continue;
    }

    const url = `${BASE_URL}/id${entry.id}`;
    try {
      const html = await fetchText(url, {
        userAgent: config.userAgent,
        limiter,
        referer: listUrl
      });
      const fonds = parseFonds(html);
      zespoly.push(toZespolRecord(entry, fonds, new Date().toISOString()));
      refreshed++;
    } catch (err) {
      errors.push({ id: entry.id, nazwa: entry.nazwa, error: err.message });
      zespoly.push(prev ?? toZespolRecord(entry, null, new Date().toISOString()));
    }
    onProgress?.({ type: 'progress', processed: checked, total: list.length, id: entry.id, nazwa: entry.nazwa });
  }

  const result = {
    schemaVersion: 1,
    archiwum: { ar, nazwa: 'Parafia' },
    zbudowano: new Date().toISOString(),
    zespoly
  };
  await mkdir(CACHE_DIR, { recursive: true });
  await writeJsonAtomic(archivePath(ar), result);

  onProgress?.({ type: 'done', zespolow: zespoly.length, odswiezonych: refreshed, bledy: errors.length });
  return { data: result, errors, refreshed, aborted: !!signal?.aborted };
}

export async function load(ar) {
  const p = archivePath(ar);
  if (!existsSync(p)) return null;
  try {
    const raw = await readFile(p, 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export async function status(ar) {
  const p = archivePath(ar);
  if (!existsSync(p)) {
    return { istnieje: false, ar };
  }
  const data = await load(ar);
  if (!data) return { istnieje: false, ar };

  const st = await stat(p);
  const zbudowano = data.zbudowano ? new Date(data.zbudowano) : st.mtime;
  const wiekDni = (Date.now() - zbudowano.getTime()) / (1000 * 60 * 60 * 24);

  let jednostek = 0;
  let plikow = 0;
  for (const z of data.zespoly) {
    jednostek += z.jednostki.length;
    for (const j of z.jednostki) plikow += j.plikow || 0;
  }

  return {
    istnieje: true,
    ar,
    zbudowano: zbudowano.toISOString(),
    wiekDni: Math.round(wiekDni * 10) / 10,
    zespolow: data.zespoly.length,
    jednostek,
    plikow
  };
}
