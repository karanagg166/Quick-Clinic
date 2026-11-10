"""Bounded OpenRouteService matrix integration with per-destination fallback."""

import logging
import math
import httpx
from app.core.config import get_settings


async def route_metrics(lat, lng, doctor_profiles):
    api_key = get_settings().openrouteservice_api_key
    targets = [
        item for item in doctor_profiles if item["latitude"] is not None and item["longitude"] is not None
    ][:30]
    if not api_key or not targets:
        return {}
    try:
        async with httpx.AsyncClient(timeout=8) as client:
            response = await client.post(
                "https://api.openrouteservice.org/v2/matrix/driving-car",
                headers={"Authorization": api_key},
                json={
                    "locations": [[lng, lat]] + [[item["longitude"], item["latitude"]] for item in targets],
                    "sources": [0],
                    "destinations": list(range(1, len(targets) + 1)),
                    "metrics": ["distance", "duration"],
                },
            )
            response.raise_for_status()
            body = response.json()
        (distances, durations) = (body["distances"][0], body["durations"][0])
        if len(distances) != len(targets) or len(durations) != len(targets):
            raise ValueError("Invalid route matrix")
        return {
            item["id"]: {
                "distanceKm": round(distance / 1000, 1),
                "durationMinutes": max(1, round(duration / 60)),
            }
            for (item, distance, duration) in zip(targets, distances, durations)
            if isinstance(distance, (int, float))
            and isinstance(duration, (int, float))
            and math.isfinite(distance)
            and math.isfinite(duration)
            and distance >= 0
            and duration >= 0
        }
    except (httpx.HTTPError, ValueError, KeyError, TypeError, IndexError):
        logging.getLogger(__name__).warning("Driving route service unavailable; using distance estimate")
        return {}
