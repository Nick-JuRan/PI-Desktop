/**
 * Global request throttle for CNKI.
 *
 * CNKI rate-limits aggressively and answers bursts with a captcha page. The
 * original crawler settled on a minimum gap of 1.2 s plus up to 0.9 s of random
 * jitter between requests; every CNKI request in this plugin (login, search,
 * abstract pages, reader redirects, full-text JSON) waits its turn on one
 * shared instance so the two tools cannot double the rate.
 */
export function createThrottle({
  minGapMs = 1200,
  jitterMs = 900,
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  random = Math.random,
} = {}) {
  let last = -Infinity;
  let chain = Promise.resolve();

  async function waitTurn(signal) {
    const previous = chain;
    let release;
    chain = new Promise((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (signal?.aborted) throw signal.reason ?? new Error("cancelled");
      const gap = minGapMs + Math.floor(random() * jitterMs);
      const wait = last + gap - now();
      if (wait > 0) await sleep(wait);
      last = now();
    } finally {
      release();
    }
  }

  return { waitTurn, get last() { return last; } };
}
