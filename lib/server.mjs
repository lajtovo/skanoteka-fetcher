import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { loadConfig, saveConfig, applyPoliteMode, expandHome, ROOT_DIR } from './config.mjs';
import * as cacheLib from './cache.mjs';
import { search, parseLataRanges } from './search.mjs';
import { downloadSelection, estimateDownload } from './download.mjs';
import { createJob, getJob, listJobs, cancelJob, runJob, toPublicJob } from './jobs.mjs';
import { pickFolder } from './folderPicker.mjs';

const PUBLIC_DIR = path.join(ROOT_DIR, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return {};
  }
}

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }
  try {
    const data = await readFile(filePath);
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Nie znaleziono');
  }
}

function findJednostka(data, item) {
  const zespol = data.zespoly.find((z) => z.id === item.zespolId);
  if (!zespol) return null;
  const seria = item.seriaSuffix || '';
  const jednostka = zespol.jednostki.find((j) => j.sy === item.sy && (j.seriaSuffix || '') === seria);
  if (!jednostka) return null;
  return { zespol, jednostka };
}

function resolveItems(data, rawItems) {
  const items = [];
  for (const it of rawItems || []) {
    const found = findJednostka(data, it);
    if (found) items.push(found);
  }
  return items;
}

export function createApp() {
  return async function handler(req, res) {
    let url;
    try {
      url = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400);
      res.end();
      return;
    }
    const pathname = url.pathname;

    try {
      const config = await loadConfig();

      if (pathname === '/api/status' && req.method === 'GET') {
        const ar = Number(url.searchParams.get('ar') || config.archiwum);
        const st = await cacheLib.status(ar);
        const running = listJobs().find(
          (j) =>
            (j.type === 'cache-build' || j.type === 'cache-refresh') &&
            (j.stan === 'trwa' || j.stan === 'kolejka')
        );
        return sendJson(res, 200, {
          ...st,
          config,
          zadanieWToku: running ? toPublicJob(running) : null
        });
      }

      if (pathname === '/api/cache/build' && req.method === 'POST') {
        const body = await readBody(req);
        const ar = Number(body.ar || config.archiwum);
        const cfg = body.polite ? applyPoliteMode(config) : config;
        const job = createJob('cache-build', { ar });
        runJob(job, (signal, onProgress) => cacheLib.build({ ar, config: cfg, onProgress, signal }));
        return sendJson(res, 202, { jobId: job.id });
      }

      if (pathname === '/api/cache/refresh' && req.method === 'POST') {
        const body = await readBody(req);
        const ar = Number(body.ar || config.archiwum);
        const cfg = body.polite ? applyPoliteMode(config) : config;
        const job = createJob('cache-refresh', { ar });
        runJob(job, (signal, onProgress) => cacheLib.refresh({ ar, config: cfg, onProgress, signal }));
        return sendJson(res, 202, { jobId: job.id });
      }

      if (pathname === '/api/search' && req.method === 'GET') {
        const ar = Number(url.searchParams.get('ar') || config.archiwum);
        const data = await cacheLib.load(ar);
        if (!data) return sendJson(res, 404, { error: 'Cache nie istnieje' });
        const q = url.searchParams.get('q') || '';
        const lata = parseLataRanges(url.searchParams.get('lata'));
        const typyParam = url.searchParams.get('typy');
        const typy = typyParam
          ? typyParam
              .split(',')
              .map((s) => s.trim().toUpperCase())
              .filter(Boolean)
          : undefined;
        const results = search(data, { q, lata, typy });
        return sendJson(res, 200, { count: results.length, results });
      }

      const zespolMatch = pathname.match(/^\/api\/zespol\/(\d+)$/);
      if (zespolMatch && req.method === 'GET') {
        const ar = Number(url.searchParams.get('ar') || config.archiwum);
        const data = await cacheLib.load(ar);
        if (!data) return sendJson(res, 404, { error: 'Cache nie istnieje' });
        const zespol = data.zespoly.find((z) => z.id === Number(zespolMatch[1]));
        if (!zespol) return sendJson(res, 404, { error: 'Nie znaleziono zespołu' });
        return sendJson(res, 200, zespol);
      }

      if (pathname === '/api/download/estimate' && req.method === 'POST') {
        const body = await readBody(req);
        const ar = Number(body.ar || config.archiwum);
        const data = await cacheLib.load(ar);
        if (!data) return sendJson(res, 404, { error: 'Cache nie istnieje' });
        const items = resolveItems(data, body.items);
        const est = estimateDownload(items, config);
        return sendJson(res, 200, { count: items.length, ...est });
      }

      if (pathname === '/api/download' && req.method === 'POST') {
        const body = await readBody(req);
        const ar = Number(body.ar || config.archiwum);
        const data = await cacheLib.load(ar);
        if (!data) return sendJson(res, 404, { error: 'Cache nie istnieje' });
        const items = resolveItems(data, body.items);
        if (!items.length) return sendJson(res, 400, { error: 'Brak poprawnych pozycji do pobrania' });

        const cfg = body.polite ? applyPoliteMode(config) : config;
        const baseDir = body.dir ? expandHome(body.dir) : cfg.pobieranieDir;
        const est = estimateDownload(items, cfg);
        const job = createJob('download', { count: items.length, baseDir, est });
        job.postep.total = est.plikow;
        runJob(job, (signal, onProgress) =>
          downloadSelection(items, { baseDir, template: cfg.szablonFolderu, config: cfg, onProgress, signal })
        );
        return sendJson(res, 202, { jobId: job.id, estimate: est, baseDir });
      }

      const jobCancelMatch = pathname.match(/^\/api\/job\/([a-f0-9-]+)\/cancel$/);
      if (jobCancelMatch && req.method === 'POST') {
        const ok = cancelJob(jobCancelMatch[1]);
        return sendJson(res, ok ? 200 : 404, { ok });
      }

      const jobMatch = pathname.match(/^\/api\/job\/([a-f0-9-]+)$/);
      if (jobMatch && req.method === 'GET') {
        const job = getJob(jobMatch[1]);
        if (!job) return sendJson(res, 404, { error: 'Nie znaleziono zadania' });
        return sendJson(res, 200, toPublicJob(job));
      }

      if (pathname === '/api/config' && req.method === 'GET') {
        return sendJson(res, 200, config);
      }
      if (pathname === '/api/config' && req.method === 'POST') {
        const body = await readBody(req);
        const saved = await saveConfig({ ...config, ...body });
        return sendJson(res, 200, saved);
      }

      if (pathname === '/api/pick-folder' && req.method === 'POST') {
        try {
          const result = await pickFolder();
          return sendJson(res, 200, result);
        } catch (err) {
          return sendJson(res, err.notSupported ? 501 : 500, { error: err.message });
        }
      }

      if (pathname.startsWith('/api/')) {
        return sendJson(res, 404, { error: 'Nieznany endpoint' });
      }

      return serveStatic(res, pathname);
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  };
}

export function startServer(port) {
  const server = createServer(createApp());
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}
