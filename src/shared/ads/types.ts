/**
 * Types for Winnow's sponsorship slot.
 *
 * Read the constraint before the code. Winnow's product claim is that its
 * grades cannot be bought. An ad system inside that product is only defensible
 * if the ad is structurally incapable of knowing what it sits next to — not
 * merely if we promise not to look. Every type here exists to make that
 * incapability a compile-time fact rather than a policy.
 */

/** Where a slot renders. Both are Winnow's own surfaces, never an Amazon page. */
export type AdSlot = 'popup' | 'options';

/**
 * The complete set of creative shapes Winnow will render.
 *
 * Deliberately not 'html' or 'script'. A network that can only hand us fields
 * cannot hand us behaviour.
 */
export type AdFormat = 'text' | 'image';

export type AdProviderId = 'direct' | 'ethical' | 'playyield';

/**
 * A normalised creative, after every hostile field has been rejected.
 *
 * There is no `html` field and there will not be one. Everything here is
 * assigned with textContent or as a validated URL.
 */
export interface AdCreative {
  /** Which provider produced it, for the disclosure line. */
  readonly provider: AdProviderId;
  /** Short headline. Plain text, rendered via textContent. */
  readonly headline: string;
  /** One line of body copy. Plain text. */
  readonly body: string;
  /** Advertiser name, shown so the reader always knows who is paying. */
  readonly advertiser: string;
  /** Where clicking goes. https, on a registry origin, validated before storage. */
  readonly clickUrl: string;
  /** Optional creative image. https, on a registry origin. */
  readonly imageUrl: string | null;
  /**
   * Optional impression-count URL, fetched by the worker when the creative is
   * shown. Carries no page data — it is an opaque token minted by the network.
   */
  readonly viewUrl: string | null;
}

/**
 * The entire payload Winnow sends to ask for an ad.
 *
 * Three fields, none of which describes the user or the page. The shape is
 * asserted key-for-key in tests/ads-policy.test.ts, so adding a field here
 * fails the suite rather than leaking quietly — which is the only way a
 * promise like this survives future edits by people who never read this file.
 */
export interface AdRequest {
  /** Request schema version, so a network can evolve without guessing. */
  readonly v: 1;
  /** Which of Winnow's own surfaces is asking. */
  readonly slot: AdSlot;
  /** Formats this slot can render. */
  readonly formats: readonly AdFormat[];
}

/**
 * How a network wants to be asked.
 *
 * Networks differ here and the difference is not cosmetic: EthicalAds' client
 * issues a GET with query parameters, while a self-hosted sponsor manifest is
 * a plain document. Encoding this as config rather than as branches in the
 * broker means adding a network is a registry entry, not a new code path
 * through the one function that touches the network.
 */
export type AdTransport = 'GET' | 'POST';

/** A configured ad network. */
export interface AdNetwork {
  readonly id: AdProviderId;
  /** Scheme + host, no path. The single host this network may be reached at. */
  readonly origin: string;
  /** Path appended to origin for an ad decision. */
  readonly path: string;
  /** Human-readable name for the disclosure line. */
  readonly label: string;
  /** GET with query parameters, or POST with a JSON body. */
  readonly transport: AdTransport;
  /**
   * Fixed parameters this network requires, such as a publisher account id.
   *
   * Constant per build, never per install, so two installations still send
   * byte-identical requests and the slot cannot become a fingerprint.
   */
  readonly params: Readonly<Record<string, string>>;
  /**
   * Whether this network is wired to a verified, reachable endpoint.
   *
   * A network with `configured: false` is an adapter waiting for credentials.
   * It is never given a host permission and never fetched — see registry.ts.
   */
  readonly configured: boolean;
}

/** Result of asking a provider for a creative. */
export interface AdResponse {
  readonly ok: boolean;
  readonly creative: AdCreative | null;
}
