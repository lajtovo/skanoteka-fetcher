#!/usr/bin/env node
import { loadConfig, applyPoliteMode, expandHome } from '../lib/config.mjs';
import * as cache from '../lib/cache.mjs';
import { search, parseLataRanges } from '../lib/search.mjs';
import { downloadSelection, estimateDownload } from '../lib/download.mjs';
import { startServer } from '../lib/server.mjs';

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function fmtDuration(ms) {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}m ${rem}s`;
}

async function cmdCacheBuild(flags, config) {
  const ar = Number(flags.ar || config.archiwum);
  const cfg = flags.polite ? applyPoliteMode(config) : config;
  const start = Date.now();
  let lastLog = 0;

  const result = await cache.build({
    ar,
    config: cfg,
    onProgress: (ev) => {
      if (ev.type === 'start') {
        console.log(ev.message);
      } else if (ev.type === 'progress') {
        const now = Date.now();
        if (now - lastLog > 2000 || ev.processed === ev.total) {
          console.log(`[${ev.processed}/${ev.total}] ${ev.nazwa}`);
          lastLog = now;
        }
      } else if (ev.type === 'done') {
        console.log(
          `Gotowe: ${ev.zespolow} zespołów, ${ev.bledy} błędów, czas ${fmtDuration(Date.now() - start)}`
        );
      }
    }
  });

  if (result.errors.length) {
    console.log('\nBłędy (zespoły pobrane bez jednostek, spróbuj "cache refresh" ponownie):');
    for (const e of result.errors) console.log(`  id${e.id} ${e.nazwa}: ${e.error}`);
  }
}

async function cmdCacheRefresh(flags, config) {
  const ar = Number(flags.ar || config.archiwum);
  const cfg = flags.polite ? applyPoliteMode(config) : config;
  const start = Date.now();

  const result = await cache.refresh({
    ar,
    config: cfg,
    onProgress: (ev) => {
      if (ev.type === 'start') console.log(ev.message);
      else if (ev.type === 'progress') {
        if (ev.processed % 5 === 0 || ev.processed === ev.total) {
          console.log(`[${ev.processed}/${ev.total}] sprawdzono (odświeżono: ${ev.nazwa})`);
        }
      } else if (ev.type === 'done') {
        console.log(
          `Gotowe: ${ev.zespolow} zespołów, odświeżono ${ev.odswiezonych}, błędów ${ev.bledy}, czas ${fmtDuration(Date.now() - start)}`
        );
      }
    }
  });

  if (result.errors.length) {
    console.log('\nBłędy:');
    for (const e of result.errors) console.log(`  id${e.id} ${e.nazwa}: ${e.error}`);
  }
}

async function cmdCacheStatus(flags, config) {
  const ar = Number(flags.ar || config.archiwum);
  const st = await cache.status(ar);
  if (!st.istnieje) {
    console.log(`Cache dla ar=${ar} nie istnieje. Użyj: skanoteka cache build --ar ${ar}`);
    return;
  }
  console.log(`Archiwum ar=${ar}`);
  console.log(`  zbudowano:   ${st.zbudowano}`);
  console.log(`  wiek:        ${st.wiekDni} dni`);
  console.log(`  zespołów:    ${st.zespolow}`);
  console.log(`  jednostek:   ${st.jednostek}`);
  console.log(`  plików:      ${st.plikow}`);
}

function fmtMB(plikow) {
  return `~${Math.round(plikow * 1.3)} MB`;
}

async function cmdSearch(positional, flags, config) {
  const ar = Number(flags.ar || config.archiwum);
  const data = await cache.load(ar);
  if (!data) {
    console.log(`Cache dla ar=${ar} nie istnieje. Użyj: skanoteka cache build --ar ${ar}`);
    return;
  }

  const q = positional.join(' ');
  const lata = parseLataRanges(flags.lata);
  const typy = flags.typy
    ? String(flags.typy)
        .split(',')
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean)
    : undefined;

  const results = search(data, { q, lata, typy });
  const limit = flags.all ? results.length : 50;

  console.log(`Znaleziono ${results.length} jednostek${q ? ` dla "${q}"` : ''}.\n`);
  for (const r of results.slice(0, limit)) {
    const miejsce = r.jednostka.miejscowosc || `(${r.zespol.parafia})`;
    const lataTxt = r.jednostka.lata ? `${r.jednostka.lata[0]}-${r.jednostka.lata[1]}` : 'bez dat';
    const trafienie = r.trafienieW ? ` [${r.trafienieW}]` : '';
    console.log(
      `  id${r.zespol.id}-sy${r.jednostka.sy}${r.jednostka.seriaSuffix || ''}  ` +
        `${r.zespol.parafia} / ${r.jednostka.typNazwa} / ${miejsce}  ${lataTxt}  ` +
        `${r.jednostka.plikow} plików, ${fmtMB(r.jednostka.plikow)}${trafienie}`
    );
  }
  if (results.length > limit) {
    console.log(`\n… i ${results.length - limit} więcej (użyj --all, żeby zobaczyć wszystkie)`);
  }
}

async function cmdDownload(flags, config) {
  const ar = Number(flags.ar || config.archiwum);
  const data = await cache.load(ar);
  if (!data) {
    console.log(`Cache dla ar=${ar} nie istnieje. Użyj: skanoteka cache build --ar ${ar}`);
    return;
  }

  let items;
  if (flags.zespol) {
    const zespolId = Number(flags.zespol);
    const zespol = data.zespoly.find((z) => z.id === zespolId);
    if (!zespol) {
      console.error(`Nie znaleziono zespołu id${zespolId}`);
      process.exitCode = 1;
      return;
    }
    const syList = flags.sy
      ? String(flags.sy)
          .split(',')
          .map((s) => Number(s.trim()))
      : null;
    const jednostki = syList
      ? zespol.jednostki.filter((j) => syList.includes(j.sy))
      : zespol.jednostki;
    items = jednostki.map((jednostka) => ({ zespol, jednostka }));
  } else if (flags.query !== undefined) {
    const lata = parseLataRanges(flags.lata);
    const typy = flags.typy
      ? String(flags.typy)
          .split(',')
          .map((s) => s.trim().toUpperCase())
      : undefined;
    const results = search(data, { q: flags.query, lata, typy });
    items = results.map((r) => ({ zespol: data.zespoly.find((z) => z.id === r.zespolId), jednostka: r.jednostka }));
  } else {
    console.error('Podaj --zespol <id> [--sy sy1,sy2] albo --query "<tekst>" [--lata ...] [--typy ...]');
    process.exitCode = 1;
    return;
  }

  if (!items.length) {
    console.log('Nic do pobrania (zapytanie/filtr nie dało wyników).');
    return;
  }

  const cfg = flags.polite ? applyPoliteMode(config) : config;
  const est = estimateDownload(items, cfg);
  console.log(
    `Do pobrania: ${items.length} jednostek, ${est.plikow} plików, ` +
      `~${Math.round(est.bajtySzac / MB_UNIT)} MB, szac. czas ${fmtDuration(est.czasSzacMs)}`
  );

  if (!flags.yes) {
    console.log('\nDodaj --yes, aby faktycznie pobrać.');
    return;
  }

  const baseDir = flags.dir ? expandHome(flags.dir) : cfg.pobieranieDir;
  console.log(`Folder docelowy: ${baseDir}\n`);

  let lastLine = '';
  const results = await downloadSelection(items, {
    baseDir,
    template: cfg.szablonFolderu,
    config: cfg,
    onProgress: (ev) => {
      if (ev.type === 'unit-start') {
        lastLine = `id${ev.zespolId}-sy${ev.sy}${ev.jednostka.seriaSuffix || ''}`;
        process.stdout.write(`\n${lastLine}  `);
      } else if (ev.type === 'file') {
        process.stdout.write(ev.status === 'downloaded' ? '.' : ev.status === 'skipped' ? 's' : 'E');
      } else if (ev.type === 'unit-done') {
        process.stdout.write(
          `  pobrano ${ev.pobrane}, pominięto ${ev.pominiete}, błędów ${ev.bledy.length}` +
            (ev.dir ? ` -> ${ev.dir}` : '')
        );
      }
    }
  });

  const totalErr = results.reduce((a, r) => a + r.bledy.length, 0);
  const totalDone = results.reduce((a, r) => a + r.pobrane, 0);
  const totalSkipped = results.reduce((a, r) => a + r.pominiete, 0);
  console.log(
    `\n\nGotowe. Pobrano ${totalDone}, pominięto ${totalSkipped}, błędów ${totalErr}.`
  );
  if (totalErr) {
    console.log('\nBłędy (lista też zapisana w _bledy.txt w folderze jednostki):');
    for (const r of results) {
      for (const b of r.bledy) console.log(`  id${r.zespolId}-sy${r.sy} ${b.plik || ''}: ${b.powod}`);
    }
  }
}

const MB_UNIT = 1024 * 1024;

async function main() {
  const [, , command, ...afterCommand] = process.argv;
  const config = await loadConfig();
  const { positional, flags } = parseArgs(afterCommand);

  if (command === 'cache') {
    const sub = positional[0];
    if (sub === 'build') return cmdCacheBuild(flags, config);
    if (sub === 'refresh') return cmdCacheRefresh(flags, config);
    if (sub === 'status') return cmdCacheStatus(flags, config);
    console.error('Użycie: skanoteka cache <build|refresh|status> [--ar 9] [--polite]');
    process.exitCode = 1;
    return;
  }

  if (command === 'search') {
    return cmdSearch(positional, flags, config);
  }

  if (command === 'download') {
    return cmdDownload(flags, config);
  }

  if (command === 'serve') {
    const port = Number(flags.port || config.port);
    await startServer(port);
    console.log(`Skanoteka Fetcher nasłuchuje na http://127.0.0.1:${port}`);
    return;
  }

  console.error(
    [
      'Użycie:',
      '  skanoteka serve [--port 7777]',
      '  skanoteka cache build [--ar 9] [--polite]',
      '  skanoteka cache refresh [--ar 9] [--polite]',
      '  skanoteka cache status [--ar 9]',
      '  skanoteka search <zapytanie> [--lata 1850-1900,1920] [--typy U,M]',
      '  skanoteka download --zespol <id> --sy <sy1,sy2> [--dir ...]'
    ].join('\n')
  );
  process.exitCode = command ? 1 : 0;
}

main().catch((err) => {
  console.error('Błąd:', err.message);
  process.exitCode = 1;
});
