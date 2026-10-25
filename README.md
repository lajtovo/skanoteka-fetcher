# Skanoteka Fetcher

Lokalne narzędzie do przeszukiwania i pobierania skanów metryk z [Skanoteki](https://skanoteka.genealodzy.pl)
(archiwum „Parafia", `ar=9`) — szuka po nazwie miejscowości (zarówno parafii, jak i wsi
*wewnątrz* parafii) i pobiera wybrane jednostki do spójnie opisanych folderów na dysku.

Pełne rozpoznanie serwisu, decyzje projektowe i uzasadnienia — zob. [PLAN.md](./PLAN.md).

## Wymagania

- Node.js ≥ 20 (testowane na v26). Zero zależności zewnętrznych — nie potrzeba `npm install`.

## Szybki start

```bash
node bin/skanoteka.mjs serve
```

Otwórz `http://127.0.0.1:7777` w przeglądarce. Przy pierwszym uruchomieniu trzeba
zbudować indeks (przycisk „Zbuduj indeks" — ok. 521 zapytań, ~9 minut przy domyślnym
tempie). Potem: wpisz miejscowość, zaznacz jednostki, kliknij „Pobierz".

Alternatywnie — to samo z linii komend:

```bash
node bin/skanoteka.mjs cache build
node bin/skanoteka.mjs search "Ruda Kameralna"
node bin/skanoteka.mjs download --zespol 4742 --sy 3505 --yes
```

## Dlaczego lokalny indeks (cache)

Wyszukiwarka wbudowana w Skanotekę szuka tylko po nazwach zespołów (parafii). Opcja
„wyszukaj również w jednostkach" jest niewiarygodna — w testach nie znajdowała
miejscowości, które faktycznie istnieją w opisach jednostek (np. „Strzeszyn",
„Ruda Kameralna" wewnątrz innych parafii). Stąd lokalny indeks: jeden request na
zespół (521 zespołów w ar=9), budowany raz i odświeżany inkrementalnie.

`cache refresh` sprawdza tylko listę archiwum (1 request) i dociąga ponownie **tylko**
zespoły, które realnie się zmieniły — zwykle to kilka requestów, nie 521.

## Tempo requestów i `robots.txt`

`robots.txt` Skanoteki prosi o `Crawl-delay: 60` (60 sekund między requestami).
Domyślna konfiguracja tego narzędzia jest **szybsza** niż to — 1 s między requestami
metadanych (HTML) i 500 ms / 2 równoległe pobrania obrazów — bo pełne posłuszeństwo
`robots.txt` oznaczałoby ~8,7 h na zbudowanie indeksu i ~2 h na pobranie jednej
niewielkiej jednostki (116 plików). To świadomy kompromis: szybciej niż `robots.txt`
prosi, ale wciąż wolniej niż człowiek klikający w przeglądarce w kółko.

Jeśli wolisz pełną zgodność z `robots.txt`, dodaj `--polite` do `cache build`,
`cache refresh` albo `download` — ustawia odstępy na 60 s i współbieżność na 1.

```bash
node bin/skanoteka.mjs cache build --polite
```

## Rozmiary

- Jeden skan: ~1,3 MB (JPEG, ~4000×3000 px, skala szarości).
- Jedna parafia: zwykle kilkaset–kilka tysięcy plików (~0,5–5 GB).
- Całe archiwum `ar=9`: **790 435 plików, ~1 TB**. Nie pobieraj całości bez wyraźnego
  powodu — UI i CLI pokazują szacowany rozmiar przed startem, ale to na Tobie,
  żeby go przeczytać.

## CLI — pełna lista

```
skanoteka serve [--port 7777]
skanoteka cache build [--ar 9] [--polite]
skanoteka cache refresh [--ar 9] [--polite]
skanoteka cache status [--ar 9]
skanoteka search "<zapytanie>" [--lata 1850-1900,1920] [--typy U,M] [--all]
skanoteka download --zespol <id> [--sy sy1,sy2] [--dir ...] [--yes] [--polite]
skanoteka download --query "<tekst>" [--lata ...] [--typy ...] [--dir ...] [--yes] [--polite]
```

Bez `--yes` każda komenda `download` tylko pokazuje szacowany rozmiar/czas i nic nie
pobiera — to zamierzone zabezpieczenie przed przypadkowym pobraniem gigabajtów danych.

**Uwaga:** `--zespol/--sy` identyfikuje jednostkę po numerze sygnatury w obrębie
zespołu. Dla zwykłych zespołów to jest unikalne. Dla ok. 5 z 521 zespołów w ar=9 —
zbiorczych kolekcji diecezjalnych z wewnętrznym podziałem na „Serie" (miejscowości) —
numery sygnatur powtarzają się między seriami i `--sy` może być niejednoznaczne.
Dla tych przypadków używaj `--query`, które operuje na pełnych, unikalnych rekordach
z indeksu, albo UI.

## Układ folderów po pobraniu

```
<pobieranieDir>/
└── Filipowice/
    ├── Urodzenia/
    │   ├── Filipowice_1854-1900_z1809-sy3500/
    │   │   ├── 001.jpg … 116.jpg
    │   │   ├── _opis.txt         ← czytelny opis (parafia, lata, źródło…)
    │   │   └── _metadane.json    ← to samo maszynowo
    │   └── Ruda Kameralna_1849-1885_z1809-sy3505/
    ├── Malzenstwa/
    └── Zgony/
```

Szablon jest konfigurowalny w `config.json` (`szablonFolderu`). Pobieranie jest
wznawialne: przerwane (Ctrl-C) albo ponowione pobranie pomija pliki, które już są
na dysku i są poprawnymi JPEG-ami; dociąga tylko brakujące/uszkodzone.

## Konfiguracja (`config.json`)

Tworzony automatycznie z domyślnych wartości przy pierwszym uruchomieniu. Pola:

| Pole | Opis | Domyślnie |
|---|---|---|
| `archiwum` | numer archiwum Skanoteki | `9` (Parafia) |
| `pobieranieDir` | domyślny folder docelowy pobierania | `./skany` |
| `szablonFolderu` | szablon ścieżki dla jednostki | patrz wyżej |
| `delayMs` | odstęp między requestami HTML (ms) | `1000` |
| `imageDelayMs` | odstęp między requestami obrazów (ms) | `500` |
| `concurrency` | równoległe pobrania obrazów | `2` |
| `port` | port lokalnego serwera | `7777` |
| `cacheMaxWiekDni` | tylko informacyjne, do UI | `30` |

## Testy

```bash
npm test
```

38+ testów na `node:test`, w tym regresyjne na 5 zespołach z nietypowym układem HTML
(odkrytym podczas realnego crawlu — zob. PLAN.md i historię commitów).

## Prawa do skanów i etyka użycia

Skany są efektem pracy wolontariuszy Polskiego Towarzystwa Genealogicznego i
współpracujących indeksatorów/fotografów (autorzy widoczni w `_opis.txt` każdej
jednostki). To narzędzie jest do **własnego, niekomercyjnego użytku genealogicznego**
— nie do masowego ściągania całych archiwów na sprzedaż czy redystrybucję, i nie do
obciążania serwera szybciej niż to, co to narzędzie już robi domyślnie. Jeśli planujesz
pobrać dużo (całą parafię czy więcej), rozważ `--polite`.

## Znane ograniczenia

- UI (`public/`) nie zostało przetestowane interaktywnie w przeglądarce w tym
  środowisku (rozszerzenie Chrome było niedostępne) — zweryfikowane statycznie
  (składnia, routing API, zgodność ID elementów). Przed poleganiem na nim w ważnej
  pracy, przejdź ścieżkę szukaj → zaznacz → pobierz raz ręcznie.
- Pole `nrZespolu` bywa alfanumeryczne (np. `0150ad`) — zawsze string, nigdy liczba.
- Jednostki bez możliwych do ustalenia lat (`lata: null`) przechodzą każdy filtr dat
  i są oznaczone w UI/CLI jako „bez dat" — sprawdź je przed pobraniem, żeby nie
  zgarnąć więcej niż chciałeś.
