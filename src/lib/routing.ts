import type { Coordinates } from "@/lib/coordinates";

const ROUTING_TIMEOUT_MS = 8_000;

export type RouteMetric = {
  distanceKm: number;
  durationMinutes: number;
};

/** Server-only OpenRouteService Matrix client. Never import this from a client component. */
export async function getRouteMetrics(
  origin: Coordinates,
  destinations: Coordinates[],
): Promise<Array<RouteMetric | null>> {
  const apiKey = process.env.OPENROUTESERVICE_API_KEY;
  if (!apiKey) throw new Error("OpenRouteService is not configured");
  if (destinations.length === 0) return [];
  if (destinations.length > 30) throw new Error("At most 30 routing destinations are supported");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ROUTING_TIMEOUT_MS);

  try {
    const response = await fetch("https://api.openrouteservice.org/v2/matrix/driving-car", {
      method: "POST",
      headers: {
        Authorization: apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        locations: [
          [origin.longitude, origin.latitude],
          ...destinations.map(({ latitude, longitude }) => [longitude, latitude]),
        ],
        sources: [0],
        destinations: destinations.map((_, index) => index + 1),
        metrics: ["distance", "duration"],
      }),
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`OpenRouteService returned ${response.status}`);
    const payload = await response.json() as {
      distances?: Array<Array<number | null>>;
      durations?: Array<Array<number | null>>;
    };
    const distances = payload.distances?.[0];
    const durations = payload.durations?.[0];
    if (!distances || !durations || distances.length !== destinations.length || durations.length !== destinations.length) {
      throw new Error("OpenRouteService returned an invalid matrix");
    }

    return destinations.map((_, index) => {
      const distance = distances[index];
      const duration = durations[index];
      if (typeof distance !== "number" || typeof duration !== "number") return null;
      return {
        distanceKm: Math.round((distance / 1000) * 10) / 10,
        durationMinutes: Math.max(1, Math.round(duration / 60)),
      };
    });
  } finally {
    clearTimeout(timeout);
  }
}
