import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  sanitizeSegment,
  unitFolderPath,
  buildOpisTxt,
  buildMetadataJson
} from '../lib/naming.mjs';

const TEMPLATE = '{parafia}/{typNazwa}/{miejscowosc}_{lataOd}-{lataDo}_z{nrZespolu}-sy{sy}';

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

test('unitFolderPath: układ parafia/typ/miejscowość+lata z przykładu z planu', () => {
  const jednostka = {
    sy: 3505,
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1849, 1885],
    miejscowosc: 'Ruda Kameralna',
    plikow: 52
  };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(
    p,
    path.join('/baza', 'Filipowice', 'Urodzenia', 'Ruda Kameralna_1849-1885_z1809-sy3505')
  );
});

test('unitFolderPath: jednostka bez lat -> segment "_bez-dat_"', () => {
  const jednostka = {
    sy: 6500,
    typ: 'UMZ',
    typNazwa: 'UMZ',
    lata: null,
    miejscowosc: null,
    plikow: 10
  };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(path.basename(p), 'Filipowice_bez-dat_z1809-sy6500');
});

test('unitFolderPath: brak miejscowości -> fallback na parafię', () => {
  const jednostka = {
    sy: 3500,
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1854, 1900],
    miejscowosc: null,
    plikow: 116
  };
  const p = unitFolderPath('/baza', zespol, jednostka, TEMPLATE);
  assert.equal(path.basename(p), 'Filipowice_1854-1900_z1809-sy3500');
});

test('unitFolderPath: sanityzuje niedozwolone znaki w segmentach (np. "Biecz-Fara" jako parafia)', () => {
  const z2 = { ...zespol, parafia: 'Biecz-Fara' };
  const jednostka = { sy: 1, typ: 'U', typNazwa: 'Urodzenia', lata: [1800, 1850], miejscowosc: 'Łęki Górne', plikow: 5 };
  const p = unitFolderPath('/baza', z2, jednostka, TEMPLATE);
  const parts = p.split(path.sep);
  assert.ok(parts.includes('Biecz-Fara'));
  assert.ok(parts.some((s) => s.startsWith('Łęki Górne_')));
});

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

test('buildMetadataJson: ma pełną, serializowalną strukturę', () => {
  const jednostka = {
    sy: 3500,
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
  assert.equal(roundtrip.pliki.length, 2);
  assert.equal(roundtrip.pliki[0].bajty, 1234);
  assert.equal(roundtrip.pliki[1].sha256, null);
});
