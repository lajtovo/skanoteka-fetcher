// Wyszukiwanie w cache'u ar9.json. Działa w pamięci (wczytany JSON),
// odporne na diakrytyki — zob. PLAN.md §9 pkt 4: normalize('NFD') NIE
// rozkłada polskiego "ł", trzeba je podmienić ręcznie przed normalizacją.

export function norm(s) {
  if (!s) return '';
  return s
    .toLowerCase()
    .replace(/ł/g, 'l')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/** "1850-1870, 1890, 1900-1910" -> [[1850,1870],[1890,1890],[1900,1910]] */
export function parseLataRanges(input) {
  if (!input) return [];
  const ranges = [];
  for (const raw of String(input).split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const pair = token.match(/^(\d{3,4})\s*-\s*(\d{3,4})$/);
    if (pair) {
      const a = Number(pair[1]);
      const b = Number(pair[2]);
      ranges.push(a <= b ? [a, b] : [b, a]);
      continue;
    }
    const single = token.match(/^(\d{3,4})$/);
    if (single) {
      const y = Number(single[1]);
      ranges.push([y, y]);
    }
  }
  return ranges;
}

function overlaps(lata, ranges) {
  if (!lata) return true; // jednostki bez dat przechodzą zawsze (flaga bezDat)
  if (!ranges || ranges.length === 0) return true;
  const [od, doR] = lata;
  return ranges.some(([rOd, rDo]) => od <= rDo && doR >= rOd);
}

const TRAFIENIE_PRIORITY = { miejscowosc: 0, parafia: 1, opis: 2, null: 3 };

/**
 * search(cache, { q, lata, typy })
 *  - q: tekst (dopasowanie podciągowe, bez diakrytyk)
 *  - lata: tablica zakresów [[od,do], ...] (patrz parseLataRanges)
 *  - typy: tablica kodów typu, np. ['U','M']
 * Zwraca listę jednostek z kontekstem zespołu, posortowaną: trafienia
 * w miejscowości > parafii/nazwie zespołu > opisie > (brak zapytania).
 */
export function search(cache, { q, lata, typy } = {}) {
  const normQ = norm(q);
  const typySet = typy && typy.length ? new Set(typy) : null;
  const results = [];

  for (const zespol of cache.zespoly) {
    for (const jednostka of zespol.jednostki) {
      if (typySet && !typySet.has(jednostka.typ)) continue;
      if (!overlaps(jednostka.lata, lata)) continue;

      let trafienieW = null;
      if (normQ) {
        if (norm(jednostka.miejscowosc).includes(normQ)) trafienieW = 'miejscowosc';
        else if (
          norm(zespol.parafia).includes(normQ) ||
          norm(zespol.nazwa).includes(normQ)
        )
          trafienieW = 'parafia';
        else if (norm(jednostka.opis).includes(normQ)) trafienieW = 'opis';
        else continue; // zapytanie podane, ale nic nie trafiło
      }

      results.push({
        zespolId: zespol.id,
        zespol: {
          id: zespol.id,
          nrZespolu: zespol.nrZespolu,
          nazwa: zespol.nazwa,
          parafia: zespol.parafia,
          wojewodztwo: zespol.wojewodztwo,
          powiat: zespol.powiat,
          autorzyZdjec: zespol.autorzyZdjec
        },
        jednostka,
        trafienieW,
        bezDat: !jednostka.lata
      });
    }
  }

  results.sort((a, b) => {
    const pa = TRAFIENIE_PRIORITY[a.trafienieW ?? 'null'];
    const pb = TRAFIENIE_PRIORITY[b.trafienieW ?? 'null'];
    if (pa !== pb) return pa - pb;
    if (a.zespol.parafia !== b.zespol.parafia) {
      return a.zespol.parafia < b.zespol.parafia ? -1 : 1;
    }
    return a.jednostka.sy - b.jednostka.sy;
  });

  return results;
}
