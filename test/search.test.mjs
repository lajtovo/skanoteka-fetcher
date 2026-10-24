import { test } from 'node:test';
import assert from 'node:assert/strict';
import { norm, parseLataRanges, search } from '../lib/search.mjs';

test('norm: usuwa diakrytyki, obsługuje "ł" (NFD go nie rozkłada)', () => {
  assert.equal(norm('Łęki'), 'leki');
  assert.equal(norm('Źródła'), 'zrodla');
  assert.equal(norm('Biecz-Fara'), 'biecz-fara');
  assert.equal(norm('Ruda Kameralna'), 'ruda kameralna');
  assert.equal(norm(''), '');
  assert.equal(norm(null), '');
});

test('parseLataRanges: parsuje listę zakresów i pojedynczych lat', () => {
  assert.deepEqual(parseLataRanges('1850-1870, 1890, 1900-1910'), [
    [1850, 1870],
    [1890, 1890],
    [1900, 1910]
  ]);
  assert.deepEqual(parseLataRanges(''), []);
  assert.deepEqual(parseLataRanges(null), []);
  // odwrócony zakres -> naprawiony
  assert.deepEqual(parseLataRanges('1900-1850'), [[1850, 1900]]);
});

function makeCache() {
  return {
    zespoly: [
      {
        id: 1,
        nrZespolu: '100',
        nazwa: 'Księgi metrykalne parafii rzymskokatolickiej Filipowice',
        parafia: 'Filipowice',
        wojewodztwo: 'małopolskie',
        powiat: 'tarnowski',
        autorzyZdjec: [],
        jednostki: [
          {
            sy: 1,
            seriaSuffix: '',
            opis: 'U-1854-1900-Filipowice',
            typ: 'U',
            typNazwa: 'Urodzenia',
            lata: [1854, 1900],
            miejscowosc: 'Filipowice',
            plikow: 10,
            info: null
          },
          {
            sy: 2,
            seriaSuffix: '',
            opis: 'U-1849-1885-Ruda Kameralna',
            typ: 'U',
            typNazwa: 'Urodzenia',
            lata: [1849, 1885],
            miejscowosc: 'Ruda Kameralna',
            plikow: 5,
            info: null
          },
          {
            sy: 3,
            seriaSuffix: '',
            opis: 'UMZ-1700-1710',
            typ: 'UMZ',
            typNazwa: 'UMZ',
            lata: null,
            miejscowosc: null,
            plikow: 3,
            info: null
          }
        ]
      }
    ]
  };
}

test('search: trafienie po miejscowości wewnątrz parafii (bez diakrytyk)', () => {
  const cache = makeCache();
  const r = search(cache, { q: 'ruda kameralna' });
  assert.equal(r.length, 1);
  assert.equal(r[0].jednostka.sy, 2);
  assert.equal(r[0].trafienieW, 'miejscowosc');
});

test('search: trafienie po nazwie parafii, niżej w priorytecie niż miejscowość', () => {
  const cache = makeCache();
  const r = search(cache, { q: 'filipowice' });
  // "Filipowice" to i miejscowość jednostki #1, i parafia (więc trafia też #2, #3 jako "parafia")
  const bySy = Object.fromEntries(r.map((x) => [x.jednostka.sy, x.trafienieW]));
  assert.equal(bySy[1], 'miejscowosc');
  assert.equal(bySy[2], 'parafia');
  assert.equal(bySy[3], 'parafia');
  // sortowanie: miejscowosc przed parafia
  assert.equal(r[0].jednostka.sy, 1);
});

test('search: filtr lat odcina jednostki poza zakresem, ale nie te bez dat', () => {
  const cache = makeCache();
  const r = search(cache, { lata: [[1890, 1895]] });
  const sys = r.map((x) => x.jednostka.sy).sort();
  // sy1 (1854-1900) nachodzi, sy2 (1849-1885) nie, sy3 (bez dat) przechodzi zawsze
  assert.deepEqual(sys, [1, 3]);
  const sy3 = r.find((x) => x.jednostka.sy === 3);
  assert.equal(sy3.bezDat, true);
});

test('search: filtr typów', () => {
  const cache = makeCache();
  const r = search(cache, { typy: ['UMZ'] });
  assert.equal(r.length, 1);
  assert.equal(r[0].jednostka.sy, 3);
});

test('search: bez zapytania i bez filtrów zwraca wszystko', () => {
  const cache = makeCache();
  const r = search(cache, {});
  assert.equal(r.length, 3);
});
