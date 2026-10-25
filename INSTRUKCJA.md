# Jak odpalić Skanoteka Fetcher (instrukcja krok po kroku)

Ta instrukcja nie wymaga żadnej wcześniejszej wiedzy programistycznej. Zajmie
10–15 minut (głównie czeka się na instalacje).

Program działa **lokalnie na Twoim komputerze** — nic nie wysyła nigdzie poza
Skanoteką, z której pobiera skany.

---

## 1. Zainstaluj Node.js

To jest program, który pozwala uruchamiać ten projekt — jak np. odtwarzacz do pliku wideo.

1. Wejdź na **https://nodejs.org**
2. Kliknij duży zielony przycisk z napisem **LTS** (to ta stabilna, polecana wersja).
3. Otwórz pobrany plik instalatora i klikaj „Dalej" / „Next" ze wszystkimi
   domyślnymi ustawieniami, aż instalacja się skończy.
4. Zrestartuj komputer, jeśli instalator o to poprosi (czasem nie trzeba).

**Jak sprawdzić, że się udało** (Mac): otwórz aplikację **Terminal**
(Spotlight: `cmd+spacja`, wpisz „Terminal", Enter) i wpisz:

```
node --version
```

Powinieneś zobaczyć coś w stylu `v20.x.x` albo wyższej. Jeśli widzisz błąd
„command not found" — zrestartuj komputer i spróbuj ponownie.

(Windows): otwórz **PowerShell** (Start → wpisz „PowerShell" → Enter) i wpisz
to samo polecenie.

---

## 2. Pobierz ten projekt

1. Wejdź na **https://github.com/lajtovo/skanoteka-fetcher**
2. Kliknij zielony przycisk **`<> Code`**, a potem **„Download ZIP"**.
3. Rozpakuj pobrany plik ZIP (zwykle wystarczy dwuklik na plik `.zip`
   w folderze Pobrane/Downloads).
4. Zapamiętaj, gdzie wylądował rozpakowany folder (np. `Downloads/skanoteka-fetcher-main`).

---

## 3. Uruchom program

1. Otwórz **Terminal** (Mac) albo **PowerShell** (Windows) — jak w kroku 1.
2. Wejdź do folderu, który rozpakowałeś. Najłatwiej: wpisz `cd ` (z spacją na
   końcu, bez Entera), a potem **przeciągnij** rozpakowany folder z Findera/
   Eksploratora prosto do okna terminala — ścieżka wpisze się sama. Potem
   wciśnij Enter. Powinno wyglądać np. tak:

   ```
   cd /Users/twojenazwa/Downloads/skanoteka-fetcher-main
   ```

3. Wpisz i wciśnij Enter:

   ```
   node bin/skanoteka.mjs serve
   ```

4. Powinieneś zobaczyć linię:

   ```
   Skanoteka Fetcher nasłuchuje na http://127.0.0.1:7777
   ```

   **To okno terminala musi zostać otwarte** — program działa, dopóki ono
   jest aktywne. Zminimalizuj je, ale nie zamykaj.

5. Otwórz przeglądarkę (Chrome, Safari, Edge — cokolwiek) i wejdź na adres:

   ```
   http://127.0.0.1:7777
   ```

Powinna się pokazać strona programu.

---

## 4. Pierwsze użycie

1. Przy pierwszym uruchomieniu program nie ma jeszcze żadnych danych — zobaczysz
   przycisk **„Zbuduj indeks"**. Kliknij go. **To potrwa około 9 minut** — program
   w tym czasie odwiedza stronę Skanoteki, żeby zebrać listę wszystkiego, co jest
   do pobrania. Możesz w tym czasie robić coś innego, pasek postępu pokaże,
   ile zostało.
2. Gdy indeks jest gotowy: w polu wyszukiwania wpisz nazwę miejscowości albo
   parafii, której szukasz (np. „Ruda Kameralna").
3. Wyniki pokażą się pogrupowane po parafiach. Kliknij na grupę, żeby ją
   rozwinąć, i zaznacz checkboxy przy interesujących Cię zbiorach (Urodzenia/
   Małżeństwa/Zgony, lata).
4. Na dole ekranu pojawi się pasek z liczbą wybranych plików i szacowanym
   rozmiarem. Możesz zmienić folder, do którego się pobierze (domyślnie to
   folder `skany` wewnątrz tego projektu).
5. Kliknij **„Pobierz"**. Zobaczysz postęp na żywo. Możesz anulować w każdej
   chwili.
6. Po zakończeniu pliki znajdziesz w podanym folderze, podzielone na
   podfoldery: parafia → rodzaj akt → miejscowość i lata.

---

## 5. Jak zamknąć program i odpalić go znowu później

- **Zamknięcie**: wróć do okna terminala i wciśnij `ctrl+C`, albo po prostu
  zamknij okno terminala.
- **Ponowne odpalenie**: nie trzeba niczego instalować od nowa. Wystarczy
  powtórzyć krok 3 (otworzyć terminal, wejść do folderu, wpisać
  `node bin/skanoteka.mjs serve`, otworzyć `http://127.0.0.1:7777`).
  Zbudowany wcześniej indeks zostaje zapisany na dysku — nie trzeba go
  budować drugi raz, chyba że klikniesz „Odśwież indeks".

---

## Coś nie działa?

- **„command not found: node"** → Node.js się nie zainstalował poprawnie albo
  terminal trzeba zrestartować/otworzyć od nowa po instalacji.
- **Strona w przeglądarce się nie otwiera** → sprawdź, czy w terminalu nadal
  widać linię „Skanoteka Fetcher nasłuchuje…" i że nie zamknąłeś tego okna.
- **Pobieranie jest wolne** → to zamierzone — program celowo nie zasypuje
  serwera Skanoteki requestami. Pobranie całej parafii może zająć kilka
  minut do kilkunastu minut, zależnie od ilości skanów.
- Inne problemy — zobacz sekcję „Znane ograniczenia" w [README.md](./README.md),
  albo daj znać osobie, od której dostałeś ten projekt.
