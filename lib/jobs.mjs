import { randomUUID } from 'node:crypto';

// Rejestr zadań w pamięci procesu serwera. UI odpytuje GET /api/job/:id
// (prosty polling, patrz PLAN.md §5.7 — SSE nie jest tu wart komplikacji).
const jobs = new Map();

export function createJob(type, meta = {}) {
  const id = randomUUID();
  const job = {
    id,
    type, // 'cache-build' | 'cache-refresh' | 'download'
    stan: 'kolejka', // kolejka | trwa | zrobione | blad | anulowane
    meta,
    postep: {
      processed: 0,
      total: 0,
      plikow: 0,
      pobrane: 0,
      pominiete: 0,
      bledy: []
    },
    log: [],
    error: null,
    controller: new AbortController(),
    startedAt: null,
    finishedAt: null
  };
  jobs.set(id, job);
  return job;
}

export function getJob(id) {
  return jobs.get(id) || null;
}

export function listJobs() {
  return [...jobs.values()];
}

export function cancelJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  if (job.stan === 'trwa' || job.stan === 'kolejka') {
    job.controller.abort();
    job.stan = 'anulowane';
    job.finishedAt = new Date().toISOString();
  }
  return true;
}

function pushLog(job, message) {
  job.log.push({ t: new Date().toISOString(), message });
  if (job.log.length > 200) job.log.shift(); // nie rośnie bez końca przy długich crawlach
}

/**
 * Odpala zadanie asynchronicznie (bez await w handlerze HTTP) i aktualizuje
 * jego stan na podstawie zdarzeń z `runner(signal, onProgress)`.
 */
export function runJob(job, runner) {
  job.stan = 'trwa';
  job.startedAt = new Date().toISOString();

  const onProgress = (ev) => {
    if (ev.type === 'start') {
      pushLog(job, ev.message);
    } else if (ev.type === 'progress') {
      job.postep.processed = ev.processed;
      job.postep.total = ev.total;
      pushLog(job, `[${ev.processed}/${ev.total}] ${ev.nazwa || ''}`);
    } else if (ev.type === 'done') {
      pushLog(job, 'Zakończono etap pobierania metadanych.');
    } else if (ev.type === 'unit-start') {
      pushLog(job, `→ id${ev.zespolId}-sy${ev.sy}`);
    } else if (ev.type === 'retry-sweep') {
      pushLog(job, `  ponawiam ${ev.count} plik(ów), które się nie udały (fala ${ev.sweep})…`);
    } else if (ev.type === 'file') {
      if (ev.status === 'downloaded') job.postep.pobrane++;
      else if (ev.status === 'skipped') job.postep.pominiete++;
      else if (ev.status === 'error') {
        job.postep.bledy.push({ plik: ev.plik, powod: ev.error });
        pushLog(job, `  ✗ ${ev.plik}: ${ev.error}`);
      }
    } else if (ev.type === 'unit-done') {
      pushLog(
        job,
        `  id${ev.zespolId}-sy${ev.sy}: pobrano ${ev.pobrane}, pominięto ${ev.pominiete}, błędów ${ev.bledy.length}`
      );
    }
  };

  runner(job.controller.signal, onProgress)
    .then((result) => {
      if (job.stan !== 'anulowane') job.stan = 'zrobione';
      job.result = result;
      job.finishedAt = new Date().toISOString();
    })
    .catch((err) => {
      job.stan = 'blad';
      job.error = err.message;
      pushLog(job, `Błąd: ${err.message}`);
      job.finishedAt = new Date().toISOString();
    });

  return job;
}

export function toPublicJob(job) {
  const { controller, ...rest } = job;
  return rest;
}
