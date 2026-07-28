/**
 * The service worker's deep-analysis broker.
 *
 * This is the only place in the extension that touches a network, which makes
 * it the only place a privacy failure could originate. `isDevEndpoint` is tested
 * directly in settings.test.ts, but a correct guard is worthless if its caller
 * ignores it, and nothing tested the caller. These tests exercise the real
 * listener from the real module.
 *
 * The load-bearing case is the first one: the developer endpoint setting must
 * never be usable to send page data to an arbitrary host. A settings field that
 * accepted any URL would be a data-exfiltration primitive sitting inside a
 * product whose entire pitch is that it does not phone home.
 */

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { API_ENDPOINT } from '../src/shared/deep.js';
import { SETTINGS_KEY } from '../src/shared/settings.js';

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;

let listener: Listener;
let fetchMock: ReturnType<typeof vi.fn>;
let storage: Record<string, unknown>;

/**
 * Load the worker fresh with a stubbed extension environment. The module
 * registers its listener as a side effect of import, so the stubs must be in
 * place first and the module registry reset between tests.
 */
async function loadWorker(settings: Record<string, unknown> = {}): Promise<void> {
  storage = { [SETTINGS_KEY]: settings };

  const captured: Listener[] = [];
  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: (fn: Listener) => captured.push(fn) },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async () => undefined),
      },
    },
  };

  fetchMock = vi.fn(async () => new Response(JSON.stringify({ asin: 'B000000001' }), { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);

  vi.resetModules();
  await import('../src/background/index.js');
  listener = captured[0]!;
}

/** Drive the listener the way Chrome does and resolve with whatever it replies. */
function send(message: unknown): Promise<{ ok: boolean; error?: string; data?: unknown }> {
  return new Promise((resolve) => {
    const kept = listener(message, {}, resolve as (r: unknown) => void);
    // Chrome requires a synchronous `true` to keep the channel open for an
    // async reply; returning anything else silently drops the response.
    expect(kept).toBe(true);
  });
}

const PAYLOAD = { type: 'winnow:deep-analyse', payload: { contractVersion: 1, asin: 'B000000001', reviews: [] } };

/** The only destination this build can reach, so most tests configure it. */
const LOOPBACK = 'http://127.0.0.1:8787/v1/analyse';

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('deep-analysis broker', () => {
  // This build ships with no hosted endpoint (API_ENDPOINT is null), so the
  // only reachable destination is a loopback address the user configured.
  it('has no hosted endpoint compiled in', () => {
    expect(API_ENDPOINT).toBeNull();
  });

  it('refuses when no endpoint is configured at all, rather than inventing one', async () => {
    await loadWorker();
    const result = await send(PAYLOAD);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'Deep analysis is not configured in this build.' });
  });

  it('refuses a developer endpoint that is not loopback', async () => {
    await loadWorker({ devApiEndpoint: 'https://evil.example.com/collect' });
    const result = await send(PAYLOAD);

    // Nothing is sent anywhere. With no hosted fallback there is not even a
    // benign destination to fall back to, so the request simply does not happen.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
  });

  it.each([
    'http://localhost:8787/v1/analyse',
    'http://127.0.0.1:8787/v1/analyse',
  ])('honours a loopback developer endpoint (%s)', async (endpoint) => {
    await loadWorker({ devApiEndpoint: endpoint });
    await send(PAYLOAD);
    expect(fetchMock.mock.calls[0]![0]).toBe(endpoint);
  });

  it('sends no cookies, credentials or referrer', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    await send(PAYLOAD);

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.credentials).toBe('omit');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.cache).toBe('no-store');
    expect(init.method).toBe('POST');
  });

  it('transmits the payload unchanged and adds nothing to it', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    await send(PAYLOAD);

    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual(PAYLOAD.payload);
  });

  it('ignores messages that are not deep-analysis requests', async () => {
    await loadWorker();
    expect(listener({ type: 'something-else' }, {}, vi.fn())).toBe(false);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a server error without leaking the response body', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    fetchMock.mockResolvedValueOnce(new Response('stack trace here', { status: 500 }));

    const result = await send(PAYLOAD);
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Deep analysis unavailable (500).');
    expect(result.error).not.toContain('stack trace');
  });

  it('reports an unreachable service rather than throwing', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await send(PAYLOAD);
    expect(result).toEqual({ ok: false, error: 'Could not reach the deep-analysis service.' });
  });

  it('reports a timeout distinctly, so the user knows to retry', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    const abort = new Error('aborted');
    abort.name = 'AbortError';
    fetchMock.mockRejectedValueOnce(abort);

    const result = await send(PAYLOAD);
    expect(result).toEqual({ ok: false, error: 'Deep analysis timed out.' });
  });

  it('passes a successful response straight through', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    const result = await send(PAYLOAD);
    expect(result.ok).toBe(true);
    expect(result.data).toEqual({ asin: 'B000000001' });
  });

  it('aborts the request rather than hanging forever', async () => {
    await loadWorker({ devApiEndpoint: LOOPBACK });
    await send(PAYLOAD);
    const [, init] = fetchMock.mock.calls[0]! as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });
});
