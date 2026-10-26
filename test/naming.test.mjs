import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import {
  sanitizeSegment,
  unitFolderPath,
  resolveUnitFolderPath,
  buildOpisTxt,
  buildMetadataJson,
  buildBledyTxt
} from '../lib/naming.mjs';

const TEMPLATE = '{parafia}/{typNazwa}/{miejscowosc} ({lataLabel})';

test('sanitizeSegment: zachowuje diakrytyki i myślniki', () => {
  assert.equal(sanitizeSegment('Biecz-Fara'), 'Biecz-Fara');
  assert.equal(sanitizeSegment('Łęki Górne'), 'Łęki Górne');
  assert.equal(sanitizeSegment('Ruda Kameralna'), 'Ruda Kameralna');
});

test('sanitizeSegment: usuwa znaki niedozwolone w nazwach plików', () => {
  assert.equal(sanitizeSegment('a/b\\c:d*e?f"g<h>i|j'), 'abcdefghij');
});

test('sanitizeSegment: zbija białe znaki i obcina kropki/spacje z końca', () => {
  assert.equal(sanitizeSegment('  foo   bar...  '), 'foo bar');
});

test('sanitizeSegment: pusty segment -> "_"', () => {
  assert.equal(sanitizeSegment(''), '_');
  assert.equal(sanitizeSegment(null), '_');
  assert.equal(sanitizeSegment('***'), '_');
});

test('sanitizeSegment: limit długości segmentu', () => {
  const long = 'a'.repeat(200);
  assert.equal(sanitizeSegment(long).length, 120);
});

const zespol = {
  id: 4742,
  nrZespolu: '1809',
  nazwa: 'Księgi metrykalne parafii rzymskokatolickiej Filipowice',
  parafia: 'Filipowice',
  wojewodztwo: 'małopolskie',
  powiat: 'tarnowski',
  autorzyZdjec: ['FamilySearch']
};

test('unitFolderPath: czysta nazwa "Miejscowość (lata)", bez kodów zespołu/sygnatury', () => {
  const jednostka = {
    sy: 3505,
    seriaSuffix: '',
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1849, 1885],
    miejscowosc: 'Ruda Kameralna',
    plikow: 52
  };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(p, path.join('/baza', 'Filipowice', 'Urodzenia', 'Ruda Kameralna (1849-1885)'));
});

test('unitFolderPath: jednostka bez lat -> "(bez dat)"', () => {
  const jednostka = { sy: 6500, typ: 'UMZ', typNazwa: 'UMZ', lata: null, miejscowosc: null, plikow: 10 };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(path.basename(p), 'Filipowice (bez dat)');
});

test('unitFolderPath: brak miejscowości -> fallback na parafię', () => {
  const jednostka = { sy: 3500, typ: 'U', typNazwa: 'Urodzenia', lata: [1854, 1900], miejscowosc: null, plikow: 116 };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(path.basename(p), 'Filipowice (1854-1900)');
});

test('unitFolderPath: sanityzuje niedozwolone znaki w segmentach (np. "Biecz-Fara" jako parafia)', () => {
  const z2 = { ...zespol, parafia: 'Biecz-Fara' };
  const jednostka = { sy: 1, typ: 'U', typNazwa: 'Urodzenia', lata: [1800, 1850], miejscowosc: 'Łęki Górne', plikow: 5 };
  const p = unitFolderPath('/baza', z2, jednostka, TEMPLATE);
  const parts = p.split(path.sep);
  assert.ok(parts.includes('Biecz-Fara'));
  assert.ok(parts.includes('Łęki Górne (1800-1850)'));
});

// --- resolveUnitFolderPath: wykrywanie kolizji nazw na dysku ---------------

async function tmpBaseDir() {
  return mkdtemp(path.join(tmpdir(), 'skanoteka-naming-'));
}

async function writeFakeMetadane(folder, zespolId, sy, seriaSuffix = '') {
  await mkdir(folder, { recursive: true });
  await writeFile(
    path.join(folder, '_metadane.json'),
    JSON.stringify({ zespol: { id: zespolId }, jednostka: { sy, seriaSuffix } }),
    'utf8'
  );
}

test('resolveUnitFolderPath: pusty dysk -> zwraca czystą nazwę bez zmian', async () => {
  const base = await tmpBaseDir();
  try {
    const jednostka = { sy: 3505, seriaSuffix: '', typNazwa: 'Urodzenia', lata: [1849, 1885], miejscowosc: 'Ruda Kameralna', plikow: 52 };
    const p = resolveUnitFolderPath(base, zespol, jednostka, TEMPLATE);
    assert.equal(p, unitFolderPath(base, zespol, jednostka, TEMPLATE));
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveUnitFolderPath: folder istnieje i to TA SAMA jednostka -> ta sama ścieżka (wznowienie)', async () => {
  const base = await tmpBaseDir();
  try {
    const jednostka = { sy: 3505, seriaSuffix: '', typNazwa: 'Urodzenia', lata: [1849, 1885], miejscowosc: 'Ruda Kameralna', plikow: 52 };
    const basePath = unitFolderPath(base, zespol, jednostka, TEMPLATE);
    await writeFakeMetadane(basePath, zespol.id, 3505, '');

    const p = resolveUnitFolderPath(base, zespol, jednostka, TEMPLATE);
    assert.equal(p, basePath);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveUnitFolderPath: folder istnieje i to INNA jednostka -> dokleja rozróżnik "- sy<N>"', async () => {
  const base = await tmpBaseDir();
  try {
    const jednostka = { sy: 3505, seriaSuffix: '', typNazwa: 'Urodzenia', lata: [1849, 1885], miejscowosc: 'Ruda Kameralna', plikow: 52 };
    const basePath = unitFolderPath(base, zespol, jednostka, TEMPLATE);
    // folder o tej samej "czystej" nazwie, ale z zupełnie innej jednostki (inny sy)
    await writeFakeMetadane(basePath, zespol.id, 9999, '');

    const p = resolveUnitFolderPath(base, zespol, jednostka, TEMPLATE);
    assert.equal(p, `${basePath} - sy3505`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveUnitFolderPath: folder bez _metadane.json (np. dane spoza tego narzędzia) -> traktowany jako kolizja', async () => {
  const base = await tmpBaseDir();
  try {
    const jednostka = { sy: 3505, seriaSuffix: '', typNazwa: 'Urodzenia', lata: [1849, 1885], miejscowosc: 'Ruda Kameralna', plikow: 52 };
    const basePath = unitFolderPath(base, zespol, jednostka, TEMPLATE);
    await mkdir(basePath, { recursive: true }); // folder istnieje, ale bez metadanych

    const p = resolveUnitFolderPath(base, zespol, jednostka, TEMPLATE);
    assert.equal(p, `${basePath} - sy3505`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

test('resolveUnitFolderPath: rozróżnia jednostki o tym samym "sy" z różnych serii (seriaSuffix)', async () => {
  const base = await tmpBaseDir();
  try {
    const jA = { sy: 1, seriaSuffix: '-se63', typNazwa: 'Inne', lata: [1909, 1924], miejscowosc: 'Gaj', plikow: 5 };
    const jB = { sy: 1, seriaSuffix: '-se74', typNazwa: 'Inne', lata: [1909, 1924], miejscowosc: 'Gaj', plikow: 5 };
    const basePath = unitFolderPath(base, zespol, jA, TEMPLATE); // obie mają identyczną "czystą" nazwę

    await writeFakeMetadane(basePath, zespol.id, 1, '-se63');
    // jA to ta sama jednostka co zapisana -> bez zmian
    assert.equal(resolveUnitFolderPath(base, zespol, jA, TEMPLATE), basePath);
    // jB to inna seria -> kolizja, dostaje rozróżnik
    assert.equal(resolveUnitFolderPath(base, zespol, jB, TEMPLATE), `${basePath} - sy1`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});

// --- opis / metadane / błędy ------------------------------------------------

test('buildOpisTxt: zawiera kluczowe pola czytelne dla człowieka', () => {
  const jednostka = {
    sy: 3500,
    opis: 'U-1854-1900-Filipowice',
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1854, 1900],
    miejscowosc: 'Filipowice',
    plikow: 116
  };
  const txt = buildOpisTxt({
    zespol,
    jednostka,
    sourceUrl: 'https://skanoteka.genealodzy.pl/id4742-sy3500',
    pobrano: new Date('2026-10-24T11:42:00')
  });
  assert.match(txt, /Parafia:\s+Filipowice/);
  assert.match(txt, /Zespół:\s+1809 — Księgi metrykalne/);
  assert.match(txt, /Jednostka:\s+3500 — U-1854-1900-Filipowice/);
  assert.match(txt, /Rodzaj:\s+Urodzenia/);
  assert.match(txt, /Lata:\s+1854–1900/);
  assert.match(txt, /Lokalizacja:\s+małopolskie \/ powiat tarnowski/);
  assert.match(txt, /Autorzy zdjęć:\s+FamilySearch/);
  assert.match(txt, /Plików:\s+116/);
  assert.match(txt, /id4742-sy3500/);
});

test('buildOpisTxt: jednostka bez miejscowości opisuje że to cała parafia', () => {
  const jednostka = { sy: 1, opis: 'U-1777-1785', typ: 'U', typNazwa: 'Urodzenia', lata: [1777, 1785], miejscowosc: null, plikow: 82 };
  const txt = buildOpisTxt({ zespol, jednostka, sourceUrl: 'x', pobrano: new Date() });
  assert.match(txt, /Miejscowość:\s+\(cała parafia/);
});

test('buildMetadataJson: ma pełną, serializowalną strukturę, w tym seriaSuffix', () => {
  const jednostka = {
    sy: 3500,
    seriaSuffix: '-se63',
    opis: 'U-1854-1900-Filipowice',
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1854, 1900],
    miejscowosc: 'Filipowice',
    plikow: 2
  };
  const meta = buildMetadataJson({
    zespol,
    jednostka,
    sourceUrl: 'https://skanoteka.genealodzy.pl/id4742-sy3500',
    pobrano: new Date('2026-10-24T11:42:00'),
    pliki: [{ nazwa: '001.jpg', bajty: 1234 }, { nazwa: '002.jpg' }]
  });
  const roundtrip = JSON.parse(JSON.stringify(meta));
  assert.equal(roundtrip.zespol.id, 4742);
  assert.equal(roundtrip.jednostka.sy, 3500);
  assert.equal(roundtrip.jednostka.seriaSuffix, '-se63');
  assert.equal(roundtrip.pliki.length, 2);
  assert.equal(roundtrip.pliki[0].bajty, 1234);
  assert.equal(roundtrip.pliki[1].sha256, null);
});

test('buildBledyTxt: wylicza nazwy nieudanych plików i przyczyny', () => {
  const txt = buildBledyTxt({
    bledy: [
      { plik: '005.jpg', powod: 'HTTP 503 dla ...' },
      { plik: '012.jpg', powod: 'timeout' }
    ],
    sourceUrl: 'https://skanoteka.genealodzy.pl/id4742-sy3505',
    sprawdzono: new Date('2026-10-24T11:42:00')
  });
  assert.match(txt, /Nie udało się pobrać 2 plik/);
  assert.match(txt, /005\.jpg — HTTP 503/);
  assert.match(txt, /012\.jpg — timeout/);
  assert.match(txt, /id4742-sy3505/);
});
