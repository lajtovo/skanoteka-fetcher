import path from 'node:path';

const MAX_SEGMENT_LENGTH = 120;
const INVALID_CHARS = /[/\\:*?"<>|]/g;
const CONTROL_CHARS = /[\x00-\x1F\x7F]/g;

/** Sanityzacja pojedynczego segmentu nazwy pliku/folderu. Zachowuje diakrytyki. */
export function sanitizeSegment(segment) {
  let s = (segment ?? '').normalize('NFC');
  s = s.replace(INVALID_CHARS, '').replace(CONTROL_CHARS, '');
  s = s.replace(/\s+/g, ' ').trim();
  s = s.replace(/[. ]+$/g, '');
  if (s.length > MAX_SEGMENT_LENGTH) s = s.slice(0, MAX_SEGMENT_LENGTH).trim();
  return s || '_';
}

/**
 * Budowa ścieżki folderu docelowego dla jednostki, wg szablonu
 * "{parafia}/{typNazwa}/{miejscowosc}_{lataOd}-{lataDo}_z{nrZespolu}-sy{sy}".
 * `zespol` i `jednostka` to rekordy z cache'u (patrz PLAN.md §4).
 */
export function unitFolderPath(baseDir, zespol, jednostka, template) {
  const miejscowosc = jednostka.miejscowosc || zespol.parafia || zespol.nazwa;
  const vars = {
    parafia: sanitizeSegment(zespol.parafia || zespol.nazwa),
    typNazwa: sanitizeSegment(jednostka.typNazwa || jednostka.typ || 'Inne'),
    miejscowosc: sanitizeSegment(miejscowosc),
    lataOd: jednostka.lata ? String(jednostka.lata[0]) : null,
    lataDo: jednostka.lata ? String(jednostka.lata[1]) : null,
    nrZespolu: sanitizeSegment(String(zespol.nrZespolu)),
    sy: String(jednostka.sy)
  };

  let lastSegmentName;
  if (jednostka.lata) {
    lastSegmentName = `${vars.miejscowosc}_${vars.lataOd}-${vars.lataDo}_z${vars.nrZespolu}-sy${vars.sy}`;
  } else {
    lastSegmentName = `${vars.miejscowosc}_bez-dat_z${vars.nrZespolu}-sy${vars.sy}`;
  }

  const segments = template
    .split('/')
    .map((part) =>
      part
        .replace('{parafia}', vars.parafia)
        .replace('{typNazwa}', vars.typNazwa)
        .replace(
          '{miejscowosc}_{lataOd}-{lataDo}_z{nrZespolu}-sy{sy}',
          lastSegmentName
        )
    )
    .map((part) => sanitizeSegment(part));

  return path.join(baseDir, ...segments);
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatTimestamp(date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
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
