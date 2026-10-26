import path from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

const MAX_SEGMENT_LENGTH = 120;
const INVALID_CHARS = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;
const PLACEHOLDER_RE = /\{(\w+)\}/g;

/** Sanityzacja pojedynczego segmentu nazwy pliku/folderu. Zachowuje diakrytyki. */
export function sanitizeSegment(segment) {
  let s = (segment ?? '').normalize('NFC');
  s = s.replace(INVALID_CHARS, '').replace(CONTROL_CHARS, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/g, '');
  if (s.length > MAX_SEGMENT_LENGTH) s = s.slice(0, MAX_SEGMENT_LENGTH).trim();
  return s || '_';
}

function unitVars(zespol, jednostka) {
  const miejscowosc = jednostka.miejscowosc || zespol.parafia || zespol.nazwa;
  return {
    parafia: sanitizeSegment(zespol.parafia || zespol.nazwa),
    typNazwa: sanitizeSegment(jednostka.typNazwa || jednostka.typ || 'Inne'),
    miejscowosc: sanitizeSegment(miejscowosc),
    lataLabel: jednostka.lata ? `${jednostka.lata[0]}-${jednostka.lata[1]}` : 'bez dat',
    nrZespolu: sanitizeSegment(String(zespol.nrZespolu)),
    sy: String(jednostka.sy)
  };
}

/**
 * Budowa ścieżki folderu docelowego dla jednostki, wg szablonu
 * "{parafia}/{typNazwa}/{miejscowosc} ({lataLabel})". Czysta funkcja —
 * nie sprawdza kolizji na dysku (do tego służy resolveUnitFolderPath).
 */
export function unitFolderPath(baseDir, zespol, jednostka, template) {
  const vars = unitVars(zespol, jednostka);
  const segments = template
    .split('/')
    .map((part) => part.replace(PLACEHOLDER_RE, (m, name) => (name in vars ? vars[name] : m)))
    .map((part) => sanitizeSegment(part));
  return path.join(baseDir, ...segments);
}

function readUnitIdentity(folderPath) {
  const metaPath = path.join(folderPath, '_metadane.json');
  if (!existsSync(metaPath)) return null;
  try {
    const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
    return { zespolId: meta.zespol?.id, sy: meta.jednostka?.sy, seriaSuffix: meta.jednostka?.seriaSuffix || '' };
  } catch {
    return null;
  }
}

function isSameUnit(identity, zespol, jednostka) {
  if (!identity) return false;
  return (
    identity.zespolId === zespol.id &&
    identity.sy === jednostka.sy &&
    identity.seriaSuffix === (jednostka.seriaSuffix || '')
  );
}

/**
 * Jak unitFolderPath, ale sprawdza dysk: jeśli "czysta" nazwa jest już
 * zajęta przez INNĄ jednostkę (inny zespół/sy/seria), dokleja rozróżnik
 * "- sy<N>", żeby nie wymieszać dwóch różnych zbiorów pod jedną nazwą.
 * Gdy folder istnieje i należy do TEJ SAMEJ jednostki (wznowienie
 * pobierania), zwraca tę samą ścieżkę bez zmian.
 */
export function resolveUnitFolderPath(baseDir, zespol, jednostka, template) {
  const basePath = unitFolderPath(baseDir, zespol, jednostka, template);
  if (!existsSync(basePath) || isSameUnit(readUnitIdentity(basePath), zespol, jednostka)) {
    return basePath;
  }

  let candidate = `${basePath} - sy${jednostka.sy}`;
  let n = 2;
  while (existsSync(candidate) && !isSameUnit(readUnitIdentity(candidate), zespol, jednostka)) {
    candidate = `${basePath} - sy${jednostka.sy}-${n}`;
    n++;
  }
  return candidate;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTimestamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

/**
 * Lista plików, które się nie udało pobrać po wszystkich falach ponawiania —
 * zapisywana jako _bledy.txt, żeby przetrwała zamknięcie serwera i dała się
 * ogarnąć ręcznie (np. dociągnąć ponownie albo pobrać przez przeglądarkę).
 */
export function buildBledyTxt({ bledy, sourceUrl, sprawdzono }) {
  const lines = [
    `Nie udało się pobrać ${bledy.length} plik(ów) — mimo kilku automatycznych prób:`,
    '',
    ...bledy.map((b) => `  ${b.plik} — ${b.powod}`),
    '',
    'Co zrobić:',
    '  - Ponów pobranie tej samej jednostki (ten sam wybór) — gotowe pliki',
    '    zostaną pominięte, dociągnięte będą tylko te z listy powyżej.',
    '  - Albo otwórz jednostkę w przeglądarce i doczytaj brakujące pliki ręcznie:',
    `    ${sourceUrl}`,
    '',
    `Sprawdzono: ${formatTimestamp(sprawdzono instanceof Date ? sprawdzono : new Date(sprawdzono))}`
  ];
  return lines.join('\n') + '\n';
}

/** Czytelny dla człowieka opis jednostki, zapisywany jako _opis.txt. */
export function buildOpisTxt({ zespol, jednostka, sourceUrl, pobrano }) {
  const lata = jednostka.lata ? `${jednostka.lata[0]}–${jednostka.lata[1]}` : 'nieznane';
  const lokalizacja = [zespol.wojewodztwo, zespol.powiat ? `powiat ${zespol.powiat}` : null]
    .filter(Boolean)
    .join(' / ');

  const lines = [
    ['Parafia:', zespol.parafia || zespol.nazwa],
    ['Zespół:', `${zespol.nrZespolu} — ${zespol.nazwa}`],
    ['Jednostka:', `${jednostka.sy} — ${jednostka.opis}`],
    ['Rodzaj:', jednostka.typNazwa || jednostka.typ],
    ['Lata:', lata],
    ['Miejscowość:', jednostka.miejscowosc || `(cała parafia — ${zespol.parafia || zespol.nazwa})`],
    ['Lokalizacja:', lokalizacja || 'nieznana'],
    ['Archiwum:', 'Skanoteka — archiwum „Parafia" (ar=9)'],
    ['Autorzy zdjęć:', (zespol.autorzyZdjec && zespol.autorzyZdjec.join(', ')) || 'nieznani'],
    ['Plików:', String(jednostka.plikow)],
    ['Źródło:', sourceUrl],
    ['Pobrano:', formatTimestamp(pobrano instanceof Date ? pobrano : new Date(pobrano))]
  ];

  const label = Math.max(...lines.map(([l]) => l.length)) + 1;
  return lines.map(([l, v]) => `${l.padEnd(label)}${v}`).join('\n') + '\n';
}

/** Metadane maszynowe, zapisywane jako _metadane.json. */
export function buildMetadataJson({ zespol, jednostka, sourceUrl, pobrano, pliki }) {
  return {
    zespol: {
      id: zespol.id,
      nrZespolu: zespol.nrZespolu,
      nazwa: zespol.nazwa,
      parafia: zespol.parafia,
      wojewodztwo: zespol.wojewodztwo,
      powiat: zespol.powiat,
      autorzyZdjec: zespol.autorzyZdjec || []
    },
    jednostka: {
      sy: jednostka.sy,
      seriaSuffix: jednostka.seriaSuffix || '',
      opis: jednostka.opis,
      typ: jednostka.typ,
      typNazwa: jednostka.typNazwa,
      lata: jednostka.lata,
      miejscowosc: jednostka.miejscowosc,
      plikow: jednostka.plikow
    },
    zrodloUrl: sourceUrl,
    pobrano: (pobrano instanceof Date ? pobrano : new Date(pobrano)).toISOString(),
    pliki: (pliki || []).map((p) => ({ nazwa: p.nazwa, bajty: p.bajty ?? null, sha256: p.sha256 ?? null }))
  };
}
