import type { AdNetwork } from '../../src/shared/ads/types.js';
import { __setTestNetworks } from '../../src/shared/ads/registry.js';

/**
 * A fixture network standing in for a real, credentialled one.
 *
 * Every network in the shipped registry has `configured: false`, because none
 * has a verified endpoint and account yet. That is the honest state, but it
 * makes `activeNetworks()` empty, and then nothing valid can be constructed:
 * suites about URL validation, creative normalisation, rendering and the
 * broker would all pass while exercising nothing — the vacuous green this
 * project keeps rediscovering.
 *
 * The origin is deliberately NOT one of the shipped registry hosts, so a test
 * can never accidentally assert against a host the real build grants.
 */
export const TEST_NETWORK: AdNetwork = {
  id: 'ethical',
  origin: 'https://ads.test.example',
  path: '/api/v1/decision/',
  label: 'Test Network',
  transport: 'GET',
  params: { publisher: 'winnow-test' },
  configured: true,
};

export const TEST_ORIGIN = TEST_NETWORK.origin;

/** Install the fixture network. Pair with clearTestNetwork in afterAll. */
export function useTestNetwork(networks: readonly AdNetwork[] = [TEST_NETWORK]): void {
  __setTestNetworks(networks);
}

/** Restore the real registry. */
export function clearTestNetwork(): void {
  __setTestNetworks(null);
}
