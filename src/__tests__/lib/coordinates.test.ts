import { describe, expect, it } from 'vitest';
import { parseCoordinates, parseSearchCoordinates } from '@/lib/coordinates';

describe('coordinate validation', () => {
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
});
