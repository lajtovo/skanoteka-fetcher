import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, expandHome } from '../lib/config.mjs';
import { homedir } from 'node:os';
import path from 'node:path';

test('DEFAULT_CONFIG ma wymagane pola', () => {
  assert.equal(DEFAULT_CONFIG.archiwum, 9);
  assert.equal(DEFAULT_CONFIG.delayMs, 1000);
  assert.equal(DEFAULT_CONFIG.concurrency, 2);
});

test('expandHome rozwija tyldę', () => {
  const result = expandHome('~/foo/bar');
  assert.equal(result, path.join(homedir(), 'foo/bar'));
});

test('expandHome nie zmienia ścieżki absolutnej', () => {
  assert.equal(expandHome('/tmp/foo'), '/tmp/foo');
});
