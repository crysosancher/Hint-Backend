import { coarsenDistance, haversineDistanceMeters } from './haversine';

/**
 * The 250 m rule is the product's core invariant, so the distance primitive is
 * covered directly: an off-by-a-factor error here would silently let users
 * discover (or send interest to) people far outside the radius.
 */
describe('haversineDistanceMeters', () => {
  it('returns 0 for identical points', () => {
    expect(haversineDistanceMeters({ latitude: 12.97, longitude: 77.59 }, { latitude: 12.97, longitude: 77.59 })).toBe(0);
  });

  it('measures one degree of latitude as ~111 km', () => {
    const distance = haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 1, longitude: 0 });

    expect(distance).toBeGreaterThan(111_000);
    expect(distance).toBeLessThan(111_400);
  });

  it('is symmetric', () => {
    const a = { latitude: 12.971599, longitude: 77.594566 };
    const b = { latitude: 12.972, longitude: 77.596 };

    expect(haversineDistanceMeters(a, b)).toBeCloseTo(haversineDistanceMeters(b, a), 6);
  });

  it('places a point roughly 222 m away inside the 250 m radius', () => {
    const distance = haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.002 });

    expect(distance).toBeGreaterThan(200);
    expect(distance).toBeLessThan(250);
  });

  it('places a point roughly 333 m away outside the 250 m radius', () => {
    const distance = haversineDistanceMeters({ latitude: 0, longitude: 0 }, { latitude: 0, longitude: 0.003 });

    expect(distance).toBeGreaterThan(250);
  });
});

describe('coarsenDistance', () => {
  it('rounds down to the nearest 50 m bucket', () => {
    expect(coarsenDistance(0)).toBe(0);
    expect(coarsenDistance(12)).toBe(0);
    expect(coarsenDistance(49.9)).toBe(0);
    expect(coarsenDistance(50)).toBe(50);
    expect(coarsenDistance(249)).toBe(200);
    expect(coarsenDistance(250)).toBe(250);
  });

  it('honours a custom bucket size', () => {
    expect(coarsenDistance(249, 100)).toBe(200);
  });

  it('clamps non-finite and negative input to 0', () => {
    expect(coarsenDistance(Number.NaN)).toBe(0);
    expect(coarsenDistance(Number.POSITIVE_INFINITY)).toBe(0);
    expect(coarsenDistance(-5)).toBe(0);
  });
});
