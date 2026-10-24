import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  parseArchiveList,
  parseFonds,
  parseUnitDescription,
  parseUnit,
  buildPgUrl,
  extractImageTokens,
  extractParafia,
  collapse
} from '../lib/parse.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const fx = (name) => readFile(path.join(__dirname, 'fixtures', name), 'utf8');

test('collapse zbija białe znaki i usuwa tagi', () => {
  assert.equal(collapse('  <b>a</b>\n\t  b  '), 'a b');
});

test('parseArchiveList: 521 zespołów w ar9', async () => {
  const html = await fx('opza-ar9.html');
  const list = parseArchiveList(html);
  assert.equal(list.length, 521);

  const barcice = list.find((z) => z.id === 5016);
  assert.ok(barcice);
  assert.equal(barcice.nrZespolu, '80');
  assert.match(barcice.nazwa, /Barcice/);
  assert.deepEqual(barcice.lata, [1762, 1901]);
  assert.equal(barcice.plikow, 994);

  // numer zespołu bywa alfanumeryczny — musi zostać stringiem
  const ostatni = list[list.length - 1];
  assert.equal(typeof ostatni.nrZespolu, 'string');

  // zespół bez podanego zakresu lat -> null, nie wywala parsera
  const bezLat = list.find((z) => z.nrZespolu === '99900');
  assert.ok(bezLat);
  assert.equal(bezLat.lata, null);
});

test('parseFonds: id4742 (Filipowice) ma 8 jednostek i powiat tarnowski', async () => {
  const html = await fx('id4742.html');
  const fonds = parseFonds(html);
  assert.equal(fonds.wojewodztwo, 'małopolskie');
  assert.equal(fonds.powiat, 'tarnowski');
  assert.equal(fonds.nrZespolu, '1809');
  assert.match(fonds.nazwa, /Filipowice/);
  assert.deepEqual(fonds.autorzyZdjec, ['FamilySearch']);
  assert.equal(fonds.jednostki.length, 8);

  const sy3500 = fonds.jednostki.find((j) => j.sy === 3500);
  assert.equal(sy3500.opis, 'U-1854-1900-Filipowice');
  assert.equal(sy3500.typ, 'U');
  assert.equal(sy3500.miejscowosc, 'Filipowice');
  assert.deepEqual(sy3500.lata, [1854, 1900]);
  assert.equal(sy3500.plikow, 116);

  const sy3505 = fonds.jednostki.find((j) => j.sy === 3505);
  assert.equal(sy3505.miejscowosc, 'Ruda Kameralna');
});

test('parseFonds: id5669 (Biecz-Fara) ma 62 jednostki i wielu autorów', async () => {
  const html = await fx('id5669.html');
  const fonds = parseFonds(html);
  assert.equal(fonds.powiat, 'gorlicki');
  assert.equal(fonds.jednostki.length, 62);
  assert.deepEqual(fonds.autorzyZdjec, ['Szymon Nowak', 'Mateusz Reczek']);

  // Strzeszyn występuje w katalogach U (6), M (4) i Z (4) = 14 jednostek
  const strzeszyn = fonds.jednostki.filter((j) => j.miejscowosc === 'Strzeszyn');
  assert.equal(strzeszyn.length, 14);

  const zapowiedzi = fonds.jednostki.find((j) => j.sy === 7000);
  assert.equal(zapowiedzi.typ, 'Zapowiedzi');
  assert.deepEqual(zapowiedzi.lata, [1826, 1850]);
  assert.equal(zapowiedzi.miejscowosc, null);

  const umz = fonds.jednostki.find((j) => j.sy === 6500);
  assert.equal(umz.typ, 'UMZ');
  assert.deepEqual(umz.lata, [1882, 1886]);
});

// Odkryte podczas realnego crawlu ar9: 5 z 521 zespołów używa innego
// układu HTML (akordeon "Serie" albo płaska tabela bez class="sygnatury-right").
// Bez tej obsługi te zespoły wychodziły z 0 jednostek — całe wsie/parafie
// wewnątrz nich były niewidoczne w wyszukiwaniu.

test('parseFonds: id4685 (zbiorczy, archidiecezja krakowska) — akordeon z seriami', async () => {
  const html = await fx('id4685.html');
  const fonds = parseFonds(html);
  assert.equal(fonds.nrZespolu, '99900');
  assert.equal(fonds.wojewodztwo, 'małopolskie');
  assert.equal(fonds.powiat, 'grodzki Kraków');
  assert.equal(fonds.jednostki.length, 33);
  const suma = fonds.jednostki.reduce((a, j) => a + j.plikow, 0);
  assert.equal(suma, 3631); // musi się zgadzać z "Ilość plików" z listy archiwum

  const gaj = fonds.jednostki.find((j) => j.sy === 1 && j.seriaSuffix === '-se63');
  assert.ok(gaj);
  assert.equal(gaj.miejscowosc, 'Gaj, Parafia Narodzenia NMP');
  assert.deepEqual(gaj.lata, [1909, 1924]); // z kolumny "Lata", nie z opisu
  assert.match(gaj.info, /zanonimizowane/);
});

test('parseFonds: id5858 (jedna parafia, nowy układ bez akordeonu)', async () => {
  const html = await fx('id5858.html');
  const fonds = parseFonds(html);
  assert.equal(fonds.jednostki.length, 2);
  const suma = fonds.jednostki.reduce((a, j) => a + j.plikow, 0);
  assert.equal(suma, 235);
  assert.equal(fonds.jednostki[0].seriaSuffix, '-se');
  assert.equal(fonds.jednostki[0].miejscowosc, null); // brak serii -> cała parafia
});

test('parseFonds: id5731/id5617/id5836 — suma plików zgodna z listą archiwum', async () => {
  const cases = [
    ['id5731.html', 206],
    ['id5617.html', 4504],
    ['id5836.html', 42]
  ];
  for (const [file, expected] of cases) {
    const html = await fx(file);
    const fonds = parseFonds(html);
    const suma = fonds.jednostki.reduce((a, j) => a + j.plikow, 0);
    assert.equal(suma, expected, `${file}: suma plików`);
  }
});

test('parseUnitDescription: pokrywa wszystkie znane formaty', () => {
  assert.deepEqual(parseUnitDescription('U-1854-1900-Filipowice'), {
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1854, 1900],
    miejscowosc: 'Filipowice'
  });
  assert.deepEqual(parseUnitDescription('U-1777-1785'), {
    typ: 'U',
    typNazwa: 'Urodzenia',
    lata: [1777, 1785],
    miejscowosc: null
  });
  assert.deepEqual(parseUnitDescription('Z-1899-1944-Ruda Kameralna'), {
    typ: 'Z',
    typNazwa: 'Zgony',
    lata: [1899, 1944],
    miejscowosc: 'Ruda Kameralna'
  });
  assert.deepEqual(parseUnitDescription('UMZ-1882-1886'), {
    typ: 'UMZ',
    typNazwa: 'UMZ',
    lata: [1882, 1886],
    miejscowosc: null
  });
  assert.deepEqual(parseUnitDescription('M-1890-1945-Biecz Przedmieście'), {
    typ: 'M',
    typNazwa: 'Malzenstwa',
    lata: [1890, 1945],
    miejscowosc: 'Biecz Przedmieście'
  });
  assert.deepEqual(parseUnitDescription('Zapowiedzi 1826-1850'), {
    typ: 'Zapowiedzi',
    typNazwa: 'Zapowiedzi',
    lata: [1826, 1850],
    miejscowosc: null
  });
  // opis bez żadnych lat -> lata: null, nie wysypuje parsera
  const nieznany = parseUnitDescription('coś dziwnego');
  assert.equal(nieznany.lata, null);
});

test('extractParafia: odcina znane prefiksy nazw zespołów', () => {
  assert.equal(
    extractParafia('Księgi metrykalne parafii rzymskokatolickiej Filipowice'),
    'Filipowice'
  );
  assert.equal(
    extractParafia('Akta stanu cywilnego Parafii Rzymskokatolickiej Dobra'),
    'Dobra'
  );
  assert.equal(extractParafia('Nazwa bez znanego prefiksu'), 'Nazwa bez znanego prefiksu');
});

test('parseUnit: sy3500 ma 116 plików, pgParamsTemplate z kt=1', async () => {
  const html = await fx('id4742-sy3500.html');
  const unit = parseUnit(html);
  assert.equal(unit.sy, 3500);
  assert.equal(unit.opis, 'U-1854-1900-Filipowice');
  assert.equal(unit.katalog, 'Urodzenia');
  assert.deepEqual(unit.lata, [1854, 1900]);
  assert.equal(unit.nrZespolu, '1809');
  assert.match(unit.nazwaZespolu, /Filipowice/);
  assert.equal(unit.pliki.length, 116);
  assert.deepEqual(unit.pgParamsTemplate, [
    ['op', 'pg'],
    ['id', '4742'],
    ['sy', '3500'],
    ['kt', '1']
  ]);
  // układ tabeli jest kolumnowy, nie sekwencyjny — sprawdzamy obecność, nie kolejność
  const nazwy = unit.pliki.map((p) => p.nazwa);
  assert.ok(nazwy.includes('001.jpg'));
  assert.ok(nazwy.includes('116.jpg'));
  // bez duplikatów
  assert.equal(new Set(nazwy).size, 116);
  assert.equal(
    buildPgUrl(unit.pgParamsTemplate, '001.jpg'),
    'index.php?op=pg&id=4742&sy=3500&kt=1&plik=001.jpg'
  );
});

test('parseUnit: nowy układ (id5858-sy1-se) — kt puste, dodatkowy "se"', async () => {
  const html = await fx('id5858-sy1-se.html');
  const unit = parseUnit(html);
  assert.equal(unit.sy, 1);
  assert.match(unit.opis, /Towarzystwo trzeźwości/);
  assert.equal(unit.katalog, null); // ten układ nie ma linii "Katalog:"
  assert.deepEqual(unit.lata, [1845, 1890]);
  assert.ok(unit.pliki.length > 0);
  assert.deepEqual(unit.pgParamsTemplate, [
    ['op', 'pg'],
    ['id', '5858'],
    ['se', ''],
    ['sy', '1'],
    ['kt', '']
  ]);
  assert.equal(
    buildPgUrl(unit.pgParamsTemplate, '001.jpg'),
    'index.php?op=pg&id=5858&se=&sy=1&kt=&plik=001.jpg'
  );
});

test('extractImageTokens: dir/znak kończą się na ",," (zakodowane "==")', async () => {
  const html = await fx('pg-id4742-sy3500-001.html');
  const tokens = extractImageTokens(html);
  assert.ok(tokens);
  assert.ok(tokens.dir.endsWith(',,'));
  assert.ok(tokens.znak.endsWith(',,'));
  assert.ok(!tokens.dir.includes('&'));
  assert.ok(!tokens.znak.includes('&'));
});

test('extractImageTokens: działa też dla nowego układu (op=pg z id5858)', async () => {
  const html = await fx('pg-id5858-sy1-001.html');
  const tokens = extractImageTokens(html);
  assert.ok(tokens);
  assert.ok(tokens.dir.length > 10);
  assert.ok(tokens.znak.endsWith(',,'));
});
