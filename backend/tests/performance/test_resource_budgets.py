"""Local regression budgets, never production benchmarks or load tests."""

import asyncio
import time
import tracemalloc

from app.core.serialization import encode_utc
from app.infrastructure.database import utcnow


async def test_liveness_handles_bounded_parallel_requests_without_state_growth(client):
    from app.core.middleware import _rate_windows

    started = time.perf_counter()
    responses = await asyncio.gather(*(client.get("/api/health") for _ in range(100)))
    elapsed = time.perf_counter() - started
    assert all(response.status_code == 200 for response in responses)
    assert len({response.headers["x-request-id"] for response in responses}) == 100
    assert len(_rate_windows) == 0
    assert elapsed < 10, f"100 local health requests exceeded the 10s regression budget: {elapsed:.2f}s"


def test_utc_serialization_has_bounded_time_and_memory():
    values = [{"timestamp": utcnow(), "id": n} for n in range(10000)]
    tracemalloc.start()
    try:
        started = time.perf_counter()
        result = encode_utc(values)
        _, peak = tracemalloc.get_traced_memory()
        assert len(result) == 10000
        assert all(row["timestamp"].endswith("Z") for row in result)
        assert time.perf_counter() - started < 5
        assert peak < 20 * 1024 * 1024
    finally:
        tracemalloc.stop()
