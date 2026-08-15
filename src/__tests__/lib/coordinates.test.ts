import { describe, expect, it } from 'vitest';
import {
  parseCoordinates,
  parseSearchCoordinates,
  calculateHaversineDistanceKm,
  estimateTravelTimeMinutes,
} from '@/lib/coordinates';

describe('coordinate validation and distance calculations', () => {
  it('accepts valid practice coordinates', () => {
    expect(parseCoordinates({ latitude: '12.9716', longitude: '77.5946' })).toEqual({ latitude: 12.9716, longitude: 77.5946 });
  });

  it('rejects incomplete and out-of-range coordinates', () => {
    expect(parseCoordinates({ latitude: 91, longitude: 77 })).toBeNull();
    expect(parseCoordinates({ latitude: 12 })).toBeNull();
  });

  it('distinguishes omitted patient coordinates from invalid query coordinates', () => {
    expect(parseSearchCoordinates(new URLSearchParams())).toBeNull();
    expect(parseSearchCoordinates(new URLSearchParams('lat=12&lng=77'))).toEqual({ latitude: 12, longitude: 77 });
    expect(parseSearchCoordinates(new URLSearchParams('lat=invalid&lng=77'))).toBe('invalid');
  });

  it('calculates accurate Haversine distance in km between two coordinates', () => {
    // Distance between New Delhi (28.6139, 77.2090) and Mumbai (19.0760, 72.8777) is ~1148 km
    const distance = calculateHaversineDistanceKm(28.6139, 77.2090, 19.0760, 72.8777);
    expect(distance).toBeGreaterThan(1100);
    expect(distance).toBeLessThan(1200);

    // Distance to self is 0
    expect(calculateHaversineDistanceKm(12.9716, 77.5946, 12.9716, 77.5946)).toBe(0);
  });

  it('estimates realistic travel time in minutes', () => {
    // 35 km should be ~60 minutes at 35 km/h
    expect(estimateTravelTimeMinutes(35)).toBe(60);
    expect(estimateTravelTimeMinutes(0.5)).toBeGreaterThanOrEqual(1);
  });
});
