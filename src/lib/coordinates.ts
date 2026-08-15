import { z } from "zod";

export const coordinateSchema = z.object({
  latitude: z.coerce.number().finite().min(-90).max(90),
  longitude: z.coerce.number().finite().min(-180).max(180),
});

export type Coordinates = z.infer<typeof coordinateSchema>;

export function parseCoordinates(input: {
  latitude?: unknown;
  longitude?: unknown;
}): Coordinates | null {
  const hasLatitude = input.latitude !== undefined && input.latitude !== null && input.latitude !== "";
  const hasLongitude = input.longitude !== undefined && input.longitude !== null && input.longitude !== "";

  if (!hasLatitude && !hasLongitude) return null;

  const parsed = coordinateSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function parseSearchCoordinates(params: URLSearchParams): Coordinates | null | "invalid" {
  const latitude = params.get("lat");
  const longitude = params.get("lng");
  if (latitude === null && longitude === null) return null;

  const parsed = coordinateSchema.safeParse({ latitude, longitude });
  return parsed.success ? parsed.data : "invalid";
}

/**
 * Calculates great-circle distance between two coordinates in kilometers using the Haversine formula.
 */
export function calculateHaversineDistanceKm(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number,
): number {
  const R = 6371; // Earth's mean radius in km
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Math.round(R * c * 10) / 10;
}

/**
 * Estimates driving travel duration in minutes based on distance in km (average city/suburban speed ~35 km/h).
 */
export function estimateTravelTimeMinutes(distanceKm: number): number {
  const speedKmH = 35;
  return Math.max(1, Math.round((distanceKm / speedKmH) * 60));
}
