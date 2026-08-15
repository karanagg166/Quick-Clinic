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
