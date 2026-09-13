/**
 * Great-circle distance between two WGS84 points.
 *
 * The 250 m rule is **server-authoritative** — the client never supplies a
 * distance — so every proximity decision (discovery eligibility, interest
 * creation) is derived from stored coordinates with this function rather than
 * from anything the caller sent.
 */
export interface GeoCoordinate {
  latitude: number;
  longitude: number;
}

/** Mean Earth radius in metres (IUGG mean radius). */
const EARTH_RADIUS_METERS = 6_371_008.8;

const toRadians = (degrees: number): number => (degrees * Math.PI) / 180;

/** Haversine distance, in metres, between two latitude/longitude points. */
export function haversineDistanceMeters(a: GeoCoordinate, b: GeoCoordinate): number {
  const deltaLat = toRadians(b.latitude - a.latitude);
  const deltaLng = toRadians(b.longitude - a.longitude);
  const latA = toRadians(a.latitude);
  const latB = toRadians(b.latitude);

  const h =
    Math.sin(deltaLat / 2) ** 2 + Math.cos(latA) * Math.cos(latB) * Math.sin(deltaLng / 2) ** 2;

  // `min(1, …)` guards against tiny floating-point overshoot at antipodes.
  return 2 * EARTH_RADIUS_METERS * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Rounds a distance down to a coarse bucket.
 *
 * Cross-user responses must never carry a precise distance: repeated exact
 * distances make trilateration trivial, so discovery only ever exposes a
 * bucketed (default 50 m) approximation.
 */
export function coarsenDistance(meters: number, bucketMeters = 50): number {
  if (!Number.isFinite(meters) || meters <= 0) return 0;
  return Math.floor(meters / bucketMeters) * bucketMeters;
}
