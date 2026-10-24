// Parsery HTML Skanoteki. Czyste funkcje (html) -> dane, bez sieci.
// Strony są generowane przez stary PHP i mają niespójny HTML (np. href bez
// cudzysłowów, ogromne bloki białych znaków) — patrz PLAN.md §9 "Pułapki".

const ENTITIES = {
  amp: '&',
  nbsp: ' ',
  copy: '©',
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>'
};

export function decodeHtmlEntities(str) {
  if (!str) return str;
  return str
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&([a-zA-Z]+);/g, (m, name) => (name in ENTITIES ? ENTITIES[name] : m));
}

export function collapse(str) {
  if (str == null) return '';
  return decodeHtmlEntities(String(str).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

function tdCells(rowHtml) {
  const cells = [];
  const re = /<td\b[^>]*>([\s\S]*?)<\/td>/g;
  let m;
  while ((m = re.exec(rowHtml))) cells.push(m[1]);
  return cells;
}

// --- 1.1 Lista zespołów w archiwum (/opza-ar9) --------------------------

export function parseArchiveList(html) {
  const start = html.indexOf('Znalezione zespoły');
  const segment = start >= 0 ? html.slice(start) : html;
  const rows = segment.match(/<tr onmouseover[\s\S]*?<\/tr>/g) || [];
  const result = [];
  for (const row of rows) {
    const cells = tdCells(row);
    if (cells.length < 5) continue;
    const idMatch = cells[1].match(/href=["']?id(\d+)["']?/);
    if (!idMatch) continue;
    const id = Number(idMatch[1]);
    const nrZespolu = collapse(cells[1]);
    const nazwa = collapse(cells[2]);
    const lataRaw = collapse(cells[3]);
    const lataMatch = lataRaw.match(/^(\d{4})-(\d{4})$/);
    const lata = lataMatch ? [Number(lataMatch[1]), Number(lataMatch[2])] : null;
    const plikow = Number(collapse(cells[4]).replace(/\s/g, '')) || 0;
    result.push({ id, nrZespolu, nazwa, lata, plikow });
  }
  return result;
}

// --- 1.2 Strona zespołu (/id4742) ---------------------------------------

export function parseFonds(html) {
  // Szerokość lewej/prawej kolumny bywa 65%/35% (stary układ) albo 70%/30%
  // (nowy układ, używany m.in. przez zbiorcze zespoły diecezjalne).
  const leftMatch = html.match(
    /<td width="(?:65|70)%"[^>]*>([\s\S]*?)<\/td>\s*<td width="(?:35|30)%"/
  );
  const leftText = leftMatch ? collapse(leftMatch[1]) : '';

  const wpMatch = leftText.match(/Województwo:\s*(.*?)\s*Powiat:\s*(.*?)\s*Zespół:/);
  const wojewodztwo = wpMatch ? wpMatch[1].replace(/,+$/, '').trim() : null;
  const powiat = wpMatch ? wpMatch[2].replace(/,+$/, '').trim() : null;

  // W nowym układzie między numerem a nazwą zespołu jest dodatkowy "/".
  const nrMatch = leftText.match(/Zespół:\s*(\S+)\s*\/?\s*(.*?)\s*O zespole/);
  const nrZespolu = nrMatch ? nrMatch[1] : null;
  const nazwa = nrMatch ? nrMatch[2].trim() : null;

  const authorsMatch = html.match(
    /Autorzy zdjęć wybranego zespołu:\s*<br>\s*<br>\s*<pre>([\s\S]*?)<\/pre>/
  );
  const autorzyZdjec = authorsMatch
    ? authorsMatch[1]
        .split('\n')
        .map((s) => collapse(s))
        .filter(Boolean)
    : [];

  let jednostki = parseFondsOldLayout(html);
  if (jednostki.length === 0) {
    jednostki = parseFondsNewLayout(html);
  }

  return { nrZespolu, nazwa, wojewodztwo, powiat, autorzyZdjec, jednostki };
}

// Stary, dominujący układ: płaska tabela class="sygnatury-right",
// opisy jednostek w formacie "TYP-ROK1-ROK2-Miejscowość" (patrz §1.3).
function parseFondsOldLayout(html) {
  const tableMatch = html.match(
    /class="sygnatury-right"[^>]*>([\s\S]*?)<\/table>/
  );
  const jednostki = [];
  if (!tableMatch) return jednostki;

  const rows = tableMatch[1].match(/<tr>[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const cells = tdCells(row);
    if (cells.length < 5) continue;
    const syMatch = cells[1].match(/href=["']?id\d+-sy(\d+)["']?/);
    if (!syMatch) continue;
    const sy = Number(syMatch[1]);
    const opis = collapse(cells[2]);
    const titleMatch = cells[3].match(/title="([^"]*)"/);
    const infoText = collapse(cells[3]);
    const info = (titleMatch && titleMatch[1].trim()) || infoText || null;
    const plikow = Number(collapse(cells[4]).replace(/\s/g, '')) || 0;
    const desc = parseUnitDescription(opis);
    jednostki.push({ sy, seriaSuffix: '', opis, ...desc, plikow, info });
  }
  return jednostki;
}

// Nowy układ (mniejszość zespołów, m.in. zbiorcze zespoły diecezjalne):
// tabela z kolumnami Jednostka|Opis|Lata|Info|Pliki|Tagi, adresy jednostek
// w formie id<ZESPOL>-sy<N>-se<SERIA> albo id<ZESPOL>-sy<N>-se (bez serii).
// Lata są w osobnej kolumnie (autorytatywne), opisy bywają opisowe
// ("Status animarum parafii X") i nie pasują do wzorca TYP-ROK-ROK.
// Zbiorcze zespoły grupują jednostki w <div id="accordion"> po "Seriach" —
// każda Seria to jedna miejscowość/parafia wewnątrz zespołu.
function parseFondsNewLayout(html) {
  const jednostki = [];

  function rowsToJednostki(tableHtml, miejscowoscOverride) {
    const rows = tableHtml.match(/<tr onmouseover[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const cells = tdCells(row);
      if (cells.length < 5) continue;
      const m = cells[0].match(/href=["']?id\d+-sy(\d+)(-se\d*)?["']?/);
      if (!m) continue;
      const sy = Number(m[1]);
      const seriaSuffix = m[2] || '';
      const opis = collapse(cells[1]);
      const lataText = collapse(cells[2]);
      const lataMatch = lataText.match(/^(\d{4})-(\d{4})$/);
      const lata = lataMatch ? [Number(lataMatch[1]), Number(lataMatch[2])] : null;
      const titleMatch = cells[3].match(/title="([^"]*)"/);
      const infoText = collapse(cells[3]);
      const info = (titleMatch && titleMatch[1].trim()) || infoText || null;
      const plikow = Number(collapse(cells[4]).replace(/\s/g, '')) || 0;
      const desc = parseUnitDescription(opis);
      jednostki.push({
        sy,
        seriaSuffix,
        opis,
        typ: desc.typ,
        typNazwa: desc.typNazwa,
        lata: lata || desc.lata,
        miejscowosc: miejscowoscOverride !== undefined ? miejscowoscOverride : desc.miejscowosc,
        plikow,
        info
      });
    }
  }

  if (html.includes('<div id="accordion">')) {
    const seriaRe = /<h5 id="seria-\d+">Seria:\s*([\s\S]*?)<\/h5>\s*<div>([\s\S]*?)<\/div>/g;
    let sm;
    while ((sm = seriaRe.exec(html))) {
      rowsToJednostki(sm[2], collapse(sm[1]));
    }
  } else {
    const tableMatch = html.match(
      /Jednostki zespołu[\s\S]*?(<table width="100%" border="0">[\s\S]*?<\/table>)/
    );
    if (tableMatch) rowsToJednostki(tableMatch[1], undefined);
  }

  return jednostki;
}

// --- 1.3 Format opisu jednostki ------------------------------------------

export const TYP_NAZWA = {
  U: 'Urodzenia',
  M: 'Malzenstwa',
  Z: 'Zgony',
  UMZ: 'UMZ',
  Zapowiedzi: 'Zapowiedzi',
  INNE: 'Inne'
};

export function parseUnitDescription(opisRaw) {
  const opis = (opisRaw || '').trim();

  // Wzorzec podstawowy: TYP-ROK1-ROK2(-Miejscowość)?
  const main = opis.match(
    /^([A-ZĄĆĘŁŃÓŚŹŻ]{1,4})-(\d{4})-(\d{4})(?:-(.+))?$/
  );
  if (main) {
    const typ = main[1];
    const lata = [Number(main[2]), Number(main[3])];
    const miejscowosc = main[4] ? main[4].trim() : null;
    return {
      typ,
      typNazwa: TYP_NAZWA[typ] || typ,
      lata,
      miejscowosc
    };
  }

  // Specjalny przypadek: "Zapowiedzi 1826-1850"
  const zap = opis.match(/^Zapowiedzi\s+(\d{4})-(\d{4})$/);
  if (zap) {
    return {
      typ: 'Zapowiedzi',
      typNazwa: TYP_NAZWA.Zapowiedzi,
      lata: [Number(zap[1]), Number(zap[2])],
      miejscowosc: null
    };
  }

  // Fallback: wyłuskaj dwa dowolne 4-cyfrowe lata z tekstu
  const years = opis.match(/\b(1[5-9]\d{2}|20\d{2})\b/g);
  if (years && years.length >= 2) {
    return {
      typ: 'INNE',
      typNazwa: TYP_NAZWA.INNE,
      lata: [Number(years[0]), Number(years[years.length - 1])],
      miejscowosc: null
    };
  }

  return {
    typ: 'INNE',
    typNazwa: TYP_NAZWA.INNE,
    lata: null,
    miejscowosc: null
  };
}

const PARAFIA_PREFIXES = [
  'Księgi metrykalne parafii rzymskokatolickiej ',
  'Księgi metrykalne parafii greckokatolickiej ',
  'Księgi metrykalne parafii ewangelickiej ',
  'Księgi metrykalne parafii prawosławnej ',
  'Księgi parafialne w parafiach ',
  'Akta stanu cywilnego Parafii Rzymskokatolickiej ',
  'Akta stanu cywilnego Parafii Mariawickiej ',
  'Akta stanu cywilnego parafii rzymskokatolickiej ',
  'Akta stanu cywilnego Parafii Prawosławnej w ',
  'Akta stanu cywilnego Parafii ',
  'Akta stanu cywilnego Gminy ',
  'Akta stanu cywilnego Mariawitów w ',
  'Akta stanu cywilnego ',
  'Akta miasta ',
  'Akta gminy ',
  'Urząd Stanu Cywilnego w ',
  'Urząd Stanu Cywilnego '
];

export function extractParafia(nazwaZespolu) {
  if (!nazwaZespolu) return nazwaZespolu;
  for (const prefix of PARAFIA_PREFIXES) {
    if (nazwaZespolu.startsWith(prefix)) {
      const rest = nazwaZespolu.slice(prefix.length).trim();
      return rest || nazwaZespolu;
    }
  }
  return nazwaZespolu;
}

// --- 1.4 Strona jednostki (/id4742-sy3500) --------------------------------

export function parseUnit(html) {
  const zespolMatch = html.match(
    /Zespół:\s*<span class="bold">\s*([\s\S]*?)<\/span>/
  );
  let nrZespolu = null;
  let nazwaZespolu = null;
  if (zespolMatch) {
    const text = collapse(zespolMatch[1]);
    const idx = text.indexOf('/');
    if (idx >= 0) {
      nrZespolu = text.slice(0, idx).trim();
      nazwaZespolu = text.slice(idx + 1).trim();
    } else {
      nazwaZespolu = text;
    }
  }

  const jednostkaMatch = html.match(
    /Jednostka:\s*<span class="bold">\s*([\s\S]*?)<\/span>/
  );
  let sy = null;
  let opis = null;
  if (jednostkaMatch) {
    const text = collapse(jednostkaMatch[1]);
    const idx = text.indexOf('/');
    if (idx >= 0) {
      sy = Number(text.slice(0, idx).trim());
      opis = text.slice(idx + 1).trim();
    }
  }

  const katalogMatch = html.match(
    /Katalog:\s*<span class="bold">\s*([\s\S]*?)<\/span>/
  );
  const katalog = katalogMatch ? collapse(katalogMatch[1]) : null;

  const lataMatch = html.match(/Lata:\s*<span class="bold">([\s\S]*?)<\/span>/);
  const lataText = lataMatch ? collapse(lataMatch[1]) : '';
  const lataParsed = lataText.match(/^(\d{4})-(\d{4})$/);
  const lata = lataParsed ? [Number(lataParsed[1]), Number(lataParsed[2])] : null;

  // Parametry linku do pliku różnią się między układami: stary ma
  // "id&sy&kt&plik", nowy (zbiorcze zespoły, patrz parseFondsNewLayout)
  // ma "id&se&sy&kt&plik" z kt="" (puste). Żeby nie zgadywać kolejności
  // i obecności parametrów, bierzemy cały query-string z linku i przy
  // pobieraniu tylko podmieniamy wartość "plik=".
  const pliki = [];
  let pgParamsTemplate = null;
  const fileRe = /<a class="plik"[^>]*href=(?:["'])?(index\.php\?[^"'>\s]+)(?:["'])?[^>]*>/g;
  let m;
  while ((m = fileRe.exec(html))) {
    const query = decodeHtmlEntities(m[1]).split('?')[1] || '';
    const params = query
      .split('&')
      .filter(Boolean)
      .map((pair) => {
        const idx = pair.indexOf('=');
        return idx >= 0 ? [pair.slice(0, idx), pair.slice(idx + 1)] : [pair, ''];
      });
    const plikParam = params.find(([k]) => k === 'plik');
    if (!plikParam) continue;
    pliki.push({ nazwa: decodeURIComponent(plikParam[1]) });
    if (!pgParamsTemplate) {
      pgParamsTemplate = params.filter(([k]) => k !== 'plik');
    }
  }

  return { nrZespolu, nazwaZespolu, sy, opis, katalog, lata, pliki, pgParamsTemplate };
}

/** Budowa URL-a strony podglądu (op=pg) dla konkretnego pliku jednostki. */
export function buildPgUrl(pgParamsTemplate, plikNazwa) {
  const parts = (pgParamsTemplate || []).map(([k, v]) => `${k}=${v}`);
  parts.push(`plik=${encodeURIComponent(plikNazwa)}`);
  return `index.php?${parts.join('&')}`;
}

// --- 1.5 Tokeny pobierania obrazu (/index.php?op=pg&...) ------------------

export function extractImageTokens(html) {
  const m = html.match(
    /metryka_get\.php\?op=download&amp;dir=([^"&]+)&amp;znak=([^"&]+)&amp;plik=[^"&]+/
  );
  if (!m) return null;
  return {
    dir: decodeHtmlEntities(m[1]),
    znak: decodeHtmlEntities(m[2])
  };
}
