# skanoteka-fetcher — plan implementacji

Lokalna appka: wyszukiwanie metryk w Skanotece (archiwum „Parafia", `ar=9`) po nazwie
miejscowości — zarówno parafii, jak i wsi *wewnątrz* parafii — oraz masowe pobieranie
skanów `.jpg` do spójnie opisanych folderów.

Plan powstał po rozpoznaniu serwisu na żywo (2026-10-24). Wszystkie wzorce URL i struktury
HTML poniżej są **zweryfikowane empirycznie**, nie założone.

---

## 1. Rozpoznanie serwisu — fakty potwierdzone

### 1.1 Lista zespołów w archiwum

```
GET https://skanoteka.genealodzy.pl/opza-ar9
```

Zwraca pełną listę (bez paginacji) — **521 zespołów, razem ~790 435 plików**.
Treść siedzi w `<div id="boczek">`, wiersze w formie:

```html
<tr onmouseover="this.bgColor='#D0E0C0'" onmouseout="this.bgColor=''">
  <td>1</td>
  <td class="right"><a href=id5016>80</a></td>
  <td><a href=id5016>Księgi metrykalne parafii rzymskokatolickiej Barcice</a></td>
  <td>1762-1901</td>
  <td class="right">994</td>
</tr>
```

Kolumny: `L.p. | Zespół(nr) | Opis zespołu | Zakres lat | Ilość plików`.
Uwaga: `href` **bez cudzysłowów** (`href=id5016`) — parser musi to obsłużyć.

### 1.2 Strona zespołu

```
GET https://skanoteka.genealodzy.pl/id4742
```

Daje:
- `Województwo:` / `Powiat:` w `<span class="grey">` (np. małopolskie / tarnowski)
- `Zespół:` nr w `<span class="brown">` (np. `1809`) + nazwa w `<span class="bold">`
- link `opozespole-id4742` („O zespole")
- „Autorzy zdjęć wybranego zespołu" (np. `FamilySearch`)
- **płaską** tabelę `class="sygnatury-right"` z jednostkami:

```
L.p. | Jednostka | Opis | Info | Plików
1    | 3500      | U-1854-1900-Filipowice      |  | 116
2    | 3505      | U-1849-1885-Ruda Kameralna   |  | 52
4    | 4500      | M-1862-1911-Filipowice       |  | 42
6    | 5500      | Z-1850-1923-Filipowice       |  | 85
```

Linki: `<a href=id4742-sy3500>3500</a>`. Mimo nagłówka „Jednostki i katalogi zespołu"
struktura jest płaska — brak zagnieżdżeń (sprawdzone na `id4742` i `id5669`).

**To jest kluczowe źródło danych**: opisy jednostek zawierają nazwy miejscowości
wewnątrz parafii (Filipowice → Ruda Kameralna; Biecz-Fara → Klęczany, Korczyna,
Przedmieście, Strzeszyn, Załawie). Jeden request na zespół = komplet metadanych.

Kolumna `Info` może mieć atrybut `title="..."` z uwagami — zachować, gdy niepusta.

### 1.3 Format opisu jednostki

Dominujący wzorzec: `TYP-ROK1-ROK2-Miejscowość`, gdzie miejscowość jest **opcjonalna**:

| Przykład | Typ | Lata | Miejscowość |
|---|---|---|---|
| `U-1854-1900-Filipowice` | U | 1854–1900 | Filipowice |
| `U-1777-1785` | U | 1777–1785 | *(brak → parafia)* |
| `Z-1899-1944-Ruda Kameralna` | Z | 1899–1944 | Ruda Kameralna |
| `UMZ-1882-1886` | UMZ | 1882–1886 | *(brak)* |
| `M-1890-1945-Biecz Przedmieście` | M | 1890–1945 | Biecz Przedmieście |
| `Zapowiedzi 1826-1850` | Zapowiedzi | 1826–1850 | *(brak)* |

Parser **dwustopniowy**:
1. `^([A-ZĄĆĘŁŃÓŚŹŻ]{1,4})-(\d{4})-(\d{4})(?:-(.+))?$` → typ, lata, miejscowość
2. fallback: wyłuskaj dowolne dwa 4-cyfrowe lata (`\b(1[5-9]\d{2}|20\d{2})\b`),
   resztę tekstu zapisz jako `opisSurowy`, typ = `INNE`
3. gdy ani jeden rok nie wyjdzie → `lata: null`, jednostka zawsze przechodzi filtr lat
   (lepiej pokazać za dużo niż zgubić)

Mapowanie typów na nazwy folderów:
`U → Urodzenia`, `M → Malzenstwa`, `Z → Zgony`, `UMZ → UMZ`,
`Zapowiedzi → Zapowiedzi`, `INNE → Inne`. **Bez polskich znaków w nazwach katalogów
typu** (stąd `Malzenstwa`) — reszta nazw (miejscowości) zachowuje diakrytyki.

Sygnatury kodują typ redundantnie (3xxx=U, 4xxx=M, 5xxx=Z, 6xxx=UMZ, 7xxx=Zapowiedzi) —
użyć jako kontrolę spójności, nie jako główne źródło.

### 1.4 Strona jednostki

```
GET https://skanoteka.genealodzy.pl/id4742-sy3500
```

Daje: `Zespół: 1809 / <nazwa>`, `Jednostka: 3500 / U-1854-1900-Filipowice`,
`Katalog: Urodzenia`, `Lata: 1854-1900`, oraz **kompletną listę plików**:

```html
<a class="plik" target="doc" href=index.php?op=pg&amp;id=4742&amp;sy=3500&amp;kt=1&amp;plik=001.jpg>001</a>
```

Zweryfikowane: 116 linków = 116 unikalnych plików = liczba z kolumny „Plików".
Nazwy są `001.jpg`…`116.jpg` (3 cyfry), ale **nie zakładaj tego** — bierz listę ze strony.
`kt` to numer katalogu (tu `1` = Urodzenia); czytaj z linków, nie wyliczaj.

### 1.5 Pobieranie JPEG — mechanizm

Strona podglądu:
```
GET https://skanoteka.genealodzy.pl/index.php?op=pg&id=4742&sy=3500&kt=1&plik=001.jpg
```

zawiera dwa URL-e do pliku (ten sam bajt w bajt obraz):
```
https://metbox3.genealodzy.pl/9/metryka_get.php?op=download&dir=<DIR>&znak=<ZNAK>&plik=001.jpg   # attachment
https://metbox3.genealodzy.pl/metryka_get.php?dir=<DIR>&znak=<ZNAK>&plik=001.jpg                 # podglad
```

Zweryfikowane własności:
- **`dir` jest stałe dla całej jednostki** i deterministyczne (dwa requesty tego samego
  pliku → identyczny token; inna jednostka → inny token)
- **`znak` jest stałe globalnie** (to samo dla `sy3500` i `sy3505`)
- **brak autoryzacji**: żadnych cookies, wystarczy zwykły `User-Agent`
- `op=download` zwraca `Content-Disposition: attachment; filename="001.jpg"`
- rozmiar: ~1,3 MB/skan, 3986×3279, JPEG grayscale
- tokeny używają `,` jako zamiennika `=` (padding base64url) — **nie enkoduj ponownie**,
  przekaż string dosłownie

**Wniosek dla implementacji:** jeden request `op=pg` na jednostkę wystarcza, żeby zdobyć
`dir` + `znak`; potem N pobrań z podmianą tylko `plik=`. Czyli jednostka o 116 plikach =
1 request HTML + 116 requestów binarnych.

Fallback: gdy pobranie zwróci nie-JPEG albo 403, odśwież `dir`/`znak` (ponowny `op=pg`)
i spróbuj raz jeszcze — zanim uznasz plik za błędny.

### 1.6 Dlaczego lokalny cache jest konieczny

Wbudowana wyszukiwarka:
```
GET /index.php?op=sz&ar=9&nazwa=Barcice                      # tylko nazwy zespołów
GET /index.php?op=sz&nazwa=<q>&search_jednostki=true          # globalna, „również w jednostkach"
```

Przetestowane: `search_jednostki=true` **nie znajduje** `Strzeszyn` ani `Kameralna`,
mimo że oba występują w opisach jednostek (`U-1784-1810-Strzeszyn`,
`Z-1848-1893-Ruda Kameralna`). Jest więc niewiarygodna dla przypadku „wieś wewnątrz
parafii" — czyli dla głównego scenariusza użycia.

Lokalny cache rozwiązuje to w 521 requestach (same strony zespołów; stron jednostek
**nie ruszamy** przy budowie cache'u) i daje przy okazji wyszukiwanie odporne na
diakrytyki i podciągi.

### 1.7 Tempo / robots.txt

```
User-agent: *
Disallow:
Crawl-delay: 60
Disallow: /cgi-bin/
```

Serwis prosi o 60 s między requestami. **Decyzja użytkownika: tempo umiarkowane —
1 s między requestami metadanych, 2 równoległe pobrania** (wolniej niż człowiek klikający
w przeglądarce w kółko, znacznie szybciej niż robots.txt). Wartości muszą być
konfigurowalne, a README i UI mają jawnie informować o rozbieżności z robots.txt oraz
udostępniać tryb `--polite` (60 s).

Przy 1 s: budowa cache'u ar9 ≈ 9 min. Pobieranie: ~2 skany/s ≈ 2,6 MB/s.

---

## 2. Decyzje projektowe

| Decyzja | Wybór | Uzasadnienie |
|---|---|---|
| Runtime | **Node.js, zero zależności** | lokalnie jest v26.5.0; wbudowany `fetch`, `node:http`, `node:sqlite`. Python to tylko systemowy 3.9 bez `uv`/venv — gorzej. Brak `npm install` = appka działa od razu i za rok też. |
| Parsowanie HTML | regexy + mały helper na tabele | HTML jest brzydki ale stabilny i przewidywalny (generowany przez PHP); doklejanie cheerio łamie zasadę zero-deps. Parsery muszą być w jednym pliku, pokryte testami na zapisanych fixture'ach. |
| Magazyn cache'u | `cache/ar9.json` | ~521 zespołów × ~60 jednostek ≈ 30 tys. rekordów ≈ 5–8 MB JSON. Wczytanie do RAM i filtrowanie w pamięci jest natychmiastowe. SQLite to nadmiar. |
| Interfejs | lokalny serwer HTTP + strona w `public/` | użytkownik chce „wpisuję miejscowość i mi szuka" + wybór wielu zakresów lat + podgląd postępu. CLI dostaje te same operacje jako podkomendy (przydatne do skryptowania i do testów). |
| Zakres | `ar=9` teraz, parametr archiwum w API | zgodnie z decyzją: dodanie AP Przemyśl itd. = dopisanie wpisu do listy archiwów, bez refaktoru. |

---

## 3. Struktura projektu

```
skanoteka-fetcher/
├── PLAN.md                  # ten plik
├── README.md                # instrukcja + jawna nota o robots.txt
├── package.json             # { "type": "module", "bin", "scripts" } — bez dependencies
├── config.json              # tworzony przy pierwszym uruchomieniu z domyślnych
├── bin/
│   └── skanoteka.mjs        # CLI: serve | cache | search | download
├── lib/
│   ├── config.mjs           # wczytanie/scalenie config.json z domyślnymi
│   ├── http.mjs             # fetchText/fetchBinary: UA, retry z backoffem, rate-limiter
│   ├── parse.mjs            # parseArchiveList / parseFonds / parseUnit / extractImageTokens
│   ├── cache.mjs            # build / load / refresh / stan i wiek cache'u
│   ├── search.mjs           # normalizacja diakrytyk, dopasowanie, filtr lat i typów
│   ├── naming.mjs           # ścieżki folderów, sanityzacja, _opis.txt / _metadane.json
│   ├── download.mjs         # kolejka, współbieżność, resume, weryfikacja JPEG
│   └── jobs.mjs             # rejestr zadań w pamięci + strumień postępu dla UI
├── public/
│   ├── index.html
│   ├── app.js
│   └── style.css
├── test/
│   ├── fixtures/            # zapisane HTML-e: opza-ar9, id4742, id5669, sy3500, pg001
│   └── *.test.mjs           # node:test — parsery, naming, filtr lat
└── cache/
    └── ar9.json             # generowany
```

**Fixture'y są już pobrane** w scratchpadzie sesji:
`/private/tmp/claude-501/-Users-lajtovo-Documents-Obsidian-Vault-1-PROJECTS-GENEALOGIA-skanoteka-fetcher/87b88ebe-7a39-4fbf-946f-895e1d5e0504/scratchpad/`
(`opza.html`, `id4742.html`, `id5669.html`, `sy3500.html`, `pg001.html`, `home.html`).
Skopiować do `test/fixtures/` **zamiast pobierać je ponownie** — testy parserów muszą
działać offline.

---

## 4. Model danych (`cache/ar9.json`)

```jsonc
{
  "schemaVersion": 1,
  "archiwum": { "ar": 9, "nazwa": "Parafia" },
  "zbudowano": "2026-10-24T09:12:00.000Z",
  "zespoly": [
    {
      "id": 4742,                    // z URL /id4742
      "nrZespolu": "1809",           // wyświetlany numer (STRING — bywa "0150ad", "524s69at")
      "nazwa": "Księgi metrykalne parafii rzymskokatolickiej Filipowice",
      "parafia": "Filipowice",       // wyłuskane z nazwy, patrz 5.1
      "wojewodztwo": "małopolskie",
      "powiat": "tarnowski",
      "lata": [1762, 1901],          // z listy archiwum; null gdy brak
      "plikow": 994,
      "autorzyZdjec": ["FamilySearch"],
      "pobrano": "2026-10-24T09:05:11.000Z",
      "jednostki": [
        {
          "sy": 3500,
          "opis": "U-1854-1900-Filipowice",
          "typ": "U",
          "typNazwa": "Urodzenia",
          "lata": [1854, 1900],
          "miejscowosc": "Filipowice",
          "plikow": 116,
          "info": null
        }
      ]
    }
  ]
}
```

`nrZespolu` **musi być stringiem** — na stronie głównej widać numery `0150ad`, `2385d`,
`524s69at`. Parsowanie go do liczby zgubi dane.

Zapis atomowy: do `cache/ar9.json.tmp`, potem `rename`.

Dodatkowo `cache/ar9.progress.json` podczas budowy (lista `id` już pobranych) — żeby
przerwany crawl dał się wznowić bez powtarzania 500 requestów.

---

## 5. Moduły — szczegóły

### 5.1 `lib/parse.mjs`

Czyste funkcje `(html) → dane`, bez sieci. Każda z testem na fixture.

- `parseArchiveList(html)` → `[{ id, nrZespolu, nazwa, lata, plikow }]`
  Szukaj po `Znalezione zespoły`, potem wiersze `<tr onmouseover…>`.
  Obsłuż `href=id5016` **bez cudzysłowów**. Rozkoduj entity (`&amp;`, `&oacute;` itd.).
- `parseFonds(html)` → `{ nrZespolu, nazwa, wojewodztwo, powiat, autorzyZdjec, jednostki[] }`
  Jednostki z tabeli `class="sygnatury-right"`, pomiń wiersz nagłówka.
- `parseUnitDescription(opis)` → `{ typ, typNazwa, lata, miejscowosc }` — logika z §1.3.
- `parseUnit(html)` → `{ nrZespolu, nazwaZespolu, sy, opis, katalog, lata, pliki: [{nazwa, kt}] }`
- `extractImageTokens(html)` → `{ dir, znak }` z `pg001`-podobnej strony.
  Regex na `metryka_get\.php\?(?:op=download&amp;)?dir=([^"&]+)&amp;znak=([^"&]+)`,
  po czym `decodeHtmlEntities` — **ale nie** `encodeURIComponent` na samych tokenach.

`parafia` wyłuskaj z nazwy zespołu: odetnij znane prefiksy
(`Księgi metrykalne parafii rzymskokatolickiej `, `Akta stanu cywilnego Parafii
Rzymskokatolickiej `, `Urząd Stanu Cywilnego `, `w `…), reszta = nazwa parafii.
Gdy nic nie pasuje — `parafia = nazwa` (cała). Nie kombinuj za bardzo; to tylko etykieta
dla folderu, a pełna nazwa zostaje w metadanych.

Normalizacja białych znaków: strony mają ogromne bloki tabulatorów/newline'ów wewnątrz
`<td>` — każdą wartość przepuść przez `collapse(s) = s.replace(/\s+/g,' ').trim()`.

### 5.2 `lib/http.mjs`

- jeden współdzielony rate-limiter (token bucket albo prosty „minimalny odstęp"),
  osobne limity dla HTML (`delayMs`) i obrazów (`imageDelayMs` + `concurrency`)
- `User-Agent`: `skanoteka-fetcher/1.0 (lokalne narzędzie genealogiczne)` + `Referer`
  ustawiany na stronę źródłową (serwis go nie wymaga, ale to uczciwe)
- retry: 3 próby, backoff 1s/4s/10s, tylko dla 5xx / timeout / błędu sieci.
  **Nie ponawiaj 404** (jednostka mogła zniknąć) — zgłoś i idź dalej.
- timeout per request: 30 s HTML, 120 s obraz (`AbortSignal.timeout`)

### 5.3 `lib/cache.mjs`

- `build({ ar, onProgress })`:
  1. `GET /opza-ar<ar>` → lista zespołów
  2. dla każdego zespołu `GET /id<id>` (z rate-limiterem), scal metadane
  3. zapisuj `*.progress.json` co 10 zespołów → wznawialne
  4. zapis atomowy pełnego JSON-a
- `refresh({ ar })` — **inkrementalnie**: pobierz samą listę archiwum (1 request),
  porównaj `plikow` i `lata` z cache'em, odśwież **tylko** zespoły, które się zmieniły,
  plus zespoły nowe. Typowe odświeżenie = kilka requestów, nie 521.
- `status()` → `{ istnieje, zbudowano, wiekDni, zespolow, jednostek, plikow }`

### 5.4 `lib/search.mjs`

- `norm(s)` — `toLowerCase()` + `normalize('NFD')` + usunięcie znaków diakrytycznych
  + `ł→l` (NFD nie rozkłada `ł`!). Przetestuj na: `Łęki`→`leki`, `Źródła`→`zrodla`,
  `Biecz-Fara`, `Ruda Kameralna`.
- `search(cache, { q, lata, typy })` → lista **jednostek** z kontekstem zespołu.
  Dopasowanie `q` (podciąg po normalizacji) do: `jednostka.miejscowosc`,
  `jednostka.opis`, `zespol.parafia`, `zespol.nazwa`.
  Pole `trafienieW: 'miejscowosc' | 'parafia' | 'opis'` — UI pokazuje skąd trafienie,
  i sortuje: miejscowość > parafia > opis.
- filtr lat: `lata` to **tablica zakresów** `[[1850,1870],[1890,1890]]`.
  Jednostka przechodzi, gdy jej `[od,do]` **nachodzi** na którykolwiek zakres
  (`od <= r[1] && do >= r[0]`). Jednostki z `lata: null` przechodzą zawsze, oznaczone
  flagą `bezDat: true` — UI je wyróżnia, żeby nie pobrać przypadkiem 3000 skanów.
- parser zakresów z inputu: `"1850-1870, 1890, 1900-1910"` → tablica par;
  pojedynczy rok → `[r, r]`.

### 5.5 `lib/naming.mjs` — układ folderów

Wybrany układ (decyzja użytkownika): **parafia / typ / miejscowość+lata**.

```
<pobieranieDir>/
└── Filipowice/
    ├── Urodzenia/
    │   ├── Filipowice_1854-1900_z1809-sy3500/
    │   │   ├── 001.jpg … 116.jpg
    │   │   ├── _opis.txt
    │   │   └── _metadane.json
    │   └── Ruda Kameralna_1849-1885_z1809-sy3505/
    ├── Malzenstwa/
    │   └── Ruda Kameralna_1861-1922_z1809-sy4505/
    └── Zgony/
        └── Ruda Kameralna_1848-1893_z1809-sy5505/
```

Szablon (konfigurowalny w `config.json`):
```
{parafia}/{typNazwa}/{miejscowosc}_{lataOd}-{lataDo}_z{nrZespolu}-sy{sy}
```

Reguły:
- `miejscowosc` puste → użyj `{parafia}` (jednostka dotyczy samej parafii)
- `lataOd`/`lataDo` nieznane → segment `_bez-dat` zamiast `_od-do`
- sanityzacja: usuń `/ \ : * ? " < > |` i znaki kontrolne, zbij wielokrotne spacje,
  obetnij kropki/spacje z końca (macOS i tak zniesie, ale pliki mają być przenośne),
  limit 120 znaków na segment. **Diakrytyki zachowaj** — macOS radzi sobie z nimi,
  a `Łęki Górne` czyta się lepiej niż `Leki Gorne`. (Pliki zapisuj w NFC.)
- `_opis.txt` — czytelny dla człowieka, żeby folder był samoopisowy po przeniesieniu:

```
Parafia:        Filipowice
Zespół:         1809 — Księgi metrykalne parafii rzymskokatolickiej Filipowice
Jednostka:      3500 — U-1854-1900-Filipowice
Rodzaj:         Urodzenia
Lata:           1854–1900
Miejscowość:    Filipowice
Lokalizacja:    małopolskie / powiat tarnowski
Archiwum:       Skanoteka — archiwum „Parafia" (ar=9)
Autorzy zdjęć:  FamilySearch
Plików:         116
Źródło:         https://skanoteka.genealodzy.pl/id4742-sy3500
Pobrano:        2026-10-24 11:42
```

- `_metadane.json` — to samo maszynowo (pełny rekord jednostki + zespołu + `pobrano`,
  `zrodloUrl`, `pliki: [{nazwa, bajty, sha256?}]`). Bez `sha256` w v1 (koszt CPU),
  ale zostaw pole w schemacie.

### 5.6 `lib/download.mjs`

`downloadUnit({ zespolId, sy, kt, meta, dir, onProgress })`:

1. `GET /id<id>-sy<sy>` → lista plików + `kt`
2. `GET /index.php?op=pg&id&sy&kt&plik=<pierwszy>` → `{ dir, znak }`
3. utwórz folder, zapisz `_opis.txt` + `_metadane.json` **od razu** (żeby częściowe
   pobranie też było opisane)
4. pobierz pliki z współbieżnością `concurrency` i odstępem `imageDelayMs`:
   - **resume**: plik istnieje i `size > 0` i zaczyna się od `FF D8 FF` → pomiń
   - zapis do `NNN.jpg.part`, weryfikacja (`FF D8 FF` na starcie, `FF D9` na końcu,
     `Content-Type: image/jpeg`), potem `rename` → brak uszkodzonych plików po Ctrl-C
   - po niepowodzeniu: odśwież `dir`/`znak` i jedna dodatkowa próba
5. raport: `{ pobrane, pominiete, bledy: [{plik, powod}] }`

`downloadSelection(items)` — pętla po jednostkach, zadania sekwencyjnie
(współbieżność **wewnątrz** jednostki, nie między nimi — żeby postęp był czytelny
i żeby nie zwielokrotnić obciążenia serwera).

Przed startem: policz sumę plików i **oszacuj rozmiar** (`plikow × 1,3 MB`) oraz czas
(`plikow / (concurrency/imageDelayMs)`), pokaż do potwierdzenia. Przy 790 tys. plików
całego ar9 to ~1 TB — UI musi przed tym ostrzegać, nie milczeć.

### 5.7 `lib/jobs.mjs`

Rejestr zadań w pamięci: `{ id, stan: 'kolejka'|'trwa'|'zrobione'|'blad'|'anulowane',
pozycje[], postep: { plikow, pobrane, pominiete, bledy, bajty }, log[] }`.
UI odpytuje `GET /api/job/:id` co 1 s (prosty polling — SSE nie jest tu wart
komplikacji). `POST /api/job/:id/cancel` ustawia flagę, pętla ją sprawdza między plikami.

---

## 6. API lokalnego serwera

`bin/skanoteka.mjs serve` → `http://127.0.0.1:7777` (port konfigurowalny).
**Nasłuch tylko na `127.0.0.1`.** Statyki z `public/`, JSON pod `/api/*`.

| Metoda | Ścieżka | Opis |
|---|---|---|
| GET | `/api/status` | stan cache'u, wiek, config, czy trwa budowa |
| POST | `/api/cache/build` | pełna budowa (zwraca `jobId`) |
| POST | `/api/cache/refresh` | odświeżenie inkrementalne (zwraca `jobId`) |
| GET | `/api/search?q=&lata=&typy=` | wyniki wyszukiwania |
| GET | `/api/zespol/:id` | pełny rekord zespołu z cache'u |
| POST | `/api/download` | `{ items: [{zespolId, sy}], dir? }` → `jobId` |
| GET | `/api/job/:id` | postęp zadania |
| POST | `/api/job/:id/cancel` | anulowanie |
| GET | `/api/config` / POST | odczyt/zapis `config.json` |

CLI (to samo bez UI, do skryptowania i testów):
```
skanoteka serve [--port 7777]
skanoteka cache build [--ar 9] [--polite]
skanoteka cache refresh
skanoteka search "Ruda Kameralna" [--lata 1850-1900,1920] [--typy U,M]
skanoteka download --zespol 4742 --sy 3505,4505 [--dir ...]
skanoteka download --query "Ruda Kameralna" --lata 1840-1900 --yes
```

---

## 7. UI (`public/`)

Jedna strona, bez frameworka, bez buildu — vanilla JS + `fetch`.

**Układ:**
1. **Pasek stanu** — „Cache: 521 zespołów, 30 142 jednostki · zbudowany 2 dni temu"
   + przycisk `Odśwież`. Gdy cache nie istnieje: duży przycisk `Zbuduj indeks (~9 min)`
   z notą o robots.txt.
2. **Szukaj** — pole tekstowe (debounce 200 ms, filtrowanie lokalne — cache jest w RAM
   serwera, więc odpowiedź jest natychmiastowa). Pod spodem: pole „Lata"
   (`1850-1870, 1890`) i checkboxy typów `U / M / Z / Zapowiedzi / inne`.
3. **Wyniki** — pogrupowane po parafii (zespole), każda grupa zwinięta/rozwijana:

```
▸ Filipowice  (zespół 1809 · małopolska/tarnowski)                  [ ] cała parafia
    ☐  Urodzenia   1849-1885   Ruda Kameralna    52 pliki   ~68 MB   ← trafienie
    ☐  Małżeństwa  1861-1922   Ruda Kameralna    52 pliki   ~68 MB   ← trafienie
    ☐  Zgony       1848-1893   Ruda Kameralna    53 pliki   ~69 MB   ← trafienie
    ☐  Urodzenia   1854-1900   Filipowice       116 plików ~151 MB
```

Trafienia wyróżnione; checkbox na jednostce i na całej parafii.
4. **Koszyk / podsumowanie** — przyklejony pasek na dole: „wybrano 12 jednostek ·
   640 plików · ~830 MB · ~5 min", pole folderu docelowego, przycisk `Pobierz`.
5. **Postęp** — lista jednostek z paskami, licznik plików, błędy rozwijalnie,
   `Anuluj`. Po zakończeniu: podsumowanie + ścieżka (z przyciskiem kopiowania;
   opcjonalnie `open -R` przez endpoint `/api/reveal` — tylko macOS, tylko localhost).

Oszacowanie rozmiaru: `plikow × 1,3 MB` z jawnym „~" i notą, że to przybliżenie.

Styl: czysty, czytelny, polskie etykiety, `prefers-color-scheme` obsłużone.
Żadnych CDN-ów — appka ma działać offline (poza samym pobieraniem).

---

## 8. Kolejność prac (dla wykonawcy)

| Etap | Zakres | Sprawdzenie |
|---|---|---|
| **1** | `package.json`, `lib/config.mjs`, `lib/http.mjs`, skopiowanie fixture'ów do `test/fixtures/` | `node --test` przechodzi (na razie trywialnie) |
| **2** | `lib/parse.mjs` + testy na fixture'ach | `parseArchiveList(opza)` → 521 zespołów; `parseFonds(id4742)` → 8 jednostek, powiat `tarnowski`; `parseFonds(id5669)` → 62 jednostki; `parseUnit(sy3500)` → 116 plików, `kt=1`; `extractImageTokens(pg001)` → `dir` kończy się na `,,`; `parseUnitDescription('U-1777-1785')` → miejscowość `null`; `parseUnitDescription('Zapowiedzi 1826-1850')` → typ `Zapowiedzi` |
| **3** | `lib/cache.mjs` + `skanoteka cache build` | realna budowa ar9: 521 zespołów, plik ~5–8 MB, wznawialna po Ctrl-C; `cache refresh` robi ≤ kilka requestów |
| **4** | `lib/search.mjs` + `skanoteka search` + testy | `search("Ruda Kameralna")` znajduje `id4742 sy3505/4505/5505`; `search("strzeszyn")` znajduje jednostki w `id5669`; `search("łęki")` działa bez diakrytyk; filtr `--lata 1860-1870` odcina `U-1777-1785` |
| **5** | `lib/naming.mjs` + testy | ścieżki jak w §5.5; sanityzacja `Biecz-Fara`, `Łęki Górne`, opis bez daty → `_bez-dat` |
| **6** | `lib/download.mjs` + CLI download | **test na żywo**: `download --zespol 4742 --sy 3505` → 52 pliki w `Filipowice/Urodzenia/Ruda Kameralna_1849-1885_z1809-sy3505/`, każdy to poprawny JPEG; powtórne uruchomienie pomija wszystkie 52; usunięcie 3 plików → dociąga tylko 3 |
| **7** | `lib/jobs.mjs` + serwer HTTP + API | `curl` po każdym endpoincie zwraca sensowny JSON |
| **8** | UI | ręczny przebieg: szukaj „Ruda Kameralna" → zaznacz 3 jednostki → pobierz → postęp → folder na dysku |
| **9** | `README.md` | instalacja (`node bin/skanoteka.mjs serve`), nota o robots.txt i trybie `--polite`, nota o rozmiarach (1 parafia ≈ 1–5 GB, całe ar9 ≈ 1 TB), nota o prawach do skanów (PTG / FamilySearch — do użytku własnego, nie do redystrybucji) |

Etapy 1–6 dają działające narzędzie z CLI. 7–8 to warstwa UI. Gdyby trzeba było coś
uciąć, UI jest jedyną rzeczą do ucięcia — nie resume, nie weryfikacja JPEG, nie metadane.

---

## 9. Pułapki — nie przegap

1. `href=id5016` **bez cudzysłowów** w HTML — naiwny regex `href="([^"]+)"` nic nie złapie.
2. `nrZespolu` to **string** (`0150ad`, `524s69at`), nie liczba.
3Tokeny `dir`/`znak` kończą się na `,,` (to zakodowane `==`) — przekazywać dosłownie,
   bez ponownego URL-enkodowania, inaczej 403/pusty obraz.
4. `ł` **nie rozkłada się** przez `normalize('NFD')` — trzeba osobnej podmiany, inaczej
   `Łęki` nie znajdzie się po wpisaniu `leki`.
5. Nazwy plików to **nie zawsze** `001.jpg…NNN.jpg` — czytaj listę ze strony jednostki.
6. Strony mają ogromne bloki białych znaków w `<td>` — zawsze `collapse()`.
7. Jednostki bez dat (`UMZ-…`, `Zapowiedzi …`, opisy nietypowe) nie mogą wypadać
   z wyników przez filtr lat — przechodzą z flagą `bezDat`.
8. Nie crawluj stron jednostek przy budowie cache'u — to byłoby ~30 tys. requestów
   zamiast 521. Strona jednostki jest potrzebna dopiero przy pobieraniu.
9. Zapis plików: `.part` → `rename`, inaczej Ctrl-C zostawia obcięte JPEG-i, które
   resume uzna za gotowe.
10. `_opis.txt` i `_metadane.json` zapisuj **przed** plikami, nie po — częściowe
    pobranie ma być rozpoznawalne.

---

## 10. Konfiguracja domyślna (`config.json`)

```json
{
  "archiwum": 9,
  "pobieranieDir": "~/Documents/Obsidian Vault/1 PROJECTS/GENEALOGIA/skany",
  "szablonFolderu": "{parafia}/{typNazwa}/{miejscowosc}_{lataOd}-{lataDo}_z{nrZespolu}-sy{sy}",
  "delayMs": 1000,
  "imageDelayMs": 500,
  "concurrency": 2,
  "port": 7777,
  "userAgent": "skanoteka-fetcher/1.0 (lokalne narzędzie genealogiczne)",
  "cacheMaxWiekDni": 30
}
```

`--polite` nadpisuje: `delayMs: 60000`, `imageDelayMs: 60000`, `concurrency: 1`.

Ścieżkę `pobieranieDir` potwierdzić z użytkownikiem przy pierwszym uruchomieniu
(domyślna jest zgadnięta z lokalizacji projektu) — nie zapisywać na oślep.
