const BACKOFF_MS = [1000, 4000, 10000];

export class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} dla ${url}`);
    this.status = status;
    this.url = url;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Prosty limiter "minimalny odstęp między startami żądań".
 * acquire() serializuje wywołania tak, by kolejne starty były odległe
 * o co najmniej minDelayMs, ale nie czeka na zakończenie poprzedniego
 * żądania (umożliwia współbieżność po stronie wywołującego).
 */
export function createRateLimiter(minDelayMs) {
  let nextAvailable = 0;
  let chain = Promise.resolve();
  return {
    acquire() {
      const result = chain.then(async () => {
        const now = Date.now();
        const wait = Math.max(0, nextAvailable - now);
        if (wait > 0) await sleep(wait);
        nextAvailable = Math.max(Date.now(), nextAvailable) + minDelayMs;
      });
      chain = result;
      return result;
    },
    setDelay(ms) {
      minDelayMs = ms;
    }
  };
}

function isRetryableStatus(status) {
  return status >= 500 && status < 600;
}

async function withRetry(fn, { maxAttempts = 3, onRetry } = {}) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isHttp = err instanceof HttpError;
      const retryable = isHttp ? isRetryableStatus(err.status) : true;
      if (!retryable || attempt === maxAttempts - 1) throw err;
      if (onRetry) onRetry(err, attempt);
      await sleep(BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)]);
    }
  }
  throw lastErr;
}

async function doFetch(url, { userAgent, referer, timeoutMs }) {
  const headers = { 'User-Agent': userAgent };
  if (referer) headers.Referer = referer;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  return res;
}

export async function fetchText(url, opts = {}) {
  const {
    userAgent = 'skanoteka-fetcher/1.0',
    referer,
    timeoutMs = 30000,
    maxAttempts = 3,
    limiter,
    onRetry
  } = opts;
  return withRetry(
    async () => {
      if (limiter) await limiter.acquire();
      const res = await doFetch(url, { userAgent, referer, timeoutMs });
      if (!res.ok) throw new HttpError(res.status, url);
      return res.text();
    },
    { maxAttempts, onRetry }
  );
}

export async function fetchBinary(url, opts = {}) {
  const {
    userAgent = 'skanoteka-fetcher/1.0',
    referer,
    timeoutMs = 120000,
    maxAttempts = 3,
    limiter,
    onRetry
  } = opts;
  return withRetry(
    async () => {
      if (limiter) await limiter.acquire();
      const res = await doFetch(url, { userAgent, referer, timeoutMs });
      if (!res.ok) throw new HttpError(res.status, url);
      const arrayBuffer = await res.arrayBuffer();
      return {
        buffer: Buffer.from(arrayBuffer),
        contentType: res.headers.get('content-type') || '',
        status: res.status
      };
    },
    { maxAttempts, onRetry }
  );
}

export { sleep };
