import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const ROOT_DIR = path.resolve(__dirname, '..');
export const CONFIG_PATH = path.join(ROOT_DIR, 'config.json');
export const CACHE_DIR = path.join(ROOT_DIR, 'cache');

export const DEFAULT_CONFIG = {
  archiwum: 9,
  pobieranieDir: path.join(ROOT_DIR, 'skany'),
  szablonFolderu: '{parafia}/{typNazwa}/{miejscowosc} ({lataLabel})',
  delayMs: 1000,
  imageDelayMs: 500,
  concurrency: 2,
  port: 7777,
  userAgent: 'skanoteka-fetcher/1.0 (lokalne narzedzie genealogiczne; non-commercial)',
  cacheMaxWiekDni: 30
};

export function expandHome(p) {
  if (!p) return p;
  if (p.startsWith('~')) {
    return path.join(homedir(), p.slice(1));
  }
  return p;
}

export async function loadConfig() {
  let fileConfig = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      const raw = await readFile(CONFIG_PATH, 'utf8');
      fileConfig = JSON.parse(raw);
    } catch (err) {
      throw new Error(`Nie udało się wczytać config.json: ${err.message}`);
    }
  }
  const merged = { ...DEFAULT_CONFIG, ...fileConfig };
  merged.pobieranieDir = expandHome(merged.pobieranieDir);
  return merged;
}

export async function saveConfig(config) {
  const toSave = { ...config };
  await writeFile(CONFIG_PATH, JSON.stringify(toSave, null, 2) + '\n', 'utf8');
  return toSave;
}

export function applyPoliteMode(config) {
  return {
    ...config,
    delayMs: 60000,
    imageDelayMs: 60000,
    concurrency: 1
  };
}

export function archivePath(ar) {
  return path.join(CACHE_DIR, `ar${ar}.json`);
}

export function archiveProgressPath(ar) {
  return path.join(CACHE_DIR, `ar${ar}.progress.json`);
}
