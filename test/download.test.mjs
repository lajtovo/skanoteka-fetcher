import { test } from 'node:test';
import assert from 'node:assert/strict';
import { estimateDownload } from '../lib/download.mjs';

test('estimateDownload: liczy pliki, rozmiar (~1.3MB/plik) i czas wg concurrency', () => {
  const items = [
    { jednostka: { plikow: 52 } },
    { jednostka: { plikow: 10 } }
  ];
  const est = estimateDownload(items, { concurrency: 2, imageDelayMs: 500 });
  assert.equal(est.plikow, 62);
  assert.ok(Math.abs(est.bajtySzac - 62 * 1.3 * 1024 * 1024) < 1);
  // 62 pliki * (500ms / 2 równoległe) = 15500ms
  assert.equal(est.czasSzacMs, 62 * 250);
});

test('estimateDownload: domyślna współbieżność 1, gdy brak w config', () => {
  const items = [{ jednostka: { plikow: 4 } }];
  const est = estimateDownload(items, {});
  assert.equal(est.plikow, 4);
  assert.equal(est.czasSzacMs, 4 * 500);
});

test('estimateDownload: puste items -> zera, nie wywala się', () => {
  const est = estimateDownload([], { concurrency: 2, imageDelayMs: 500 });
  assert.equal(est.plikow, 0);
  assert.equal(est.bajtySzac, 0);
  assert.equal(est.czasSzacMs, 0);
});
