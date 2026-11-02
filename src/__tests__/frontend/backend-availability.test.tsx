/**
 * @vitest-environment happy-dom
 */
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act, waitFor } from "@testing-library/react";
import {
  BackendAvailabilityProvider,
  useBackendAvailability,
} from "@/context/backend-availability-context";
import { BackendStatusBanner } from "@/components/general/BackendStatusBanner";

function TestConsumer() {
  const { status, isReady, isWaking, elapsedSeconds, retry } = useBackendAvailability();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="ready">{String(isReady)}</span>
      <span data-testid="waking">{String(isWaking)}</span>
      <span data-testid="elapsed">{elapsedSeconds}</span>
      <button data-testid="retry-btn" onClick={() => retry()}>
        Retry
      </button>
    </div>
  );
}

describe("Quick-Clinic BackendAvailabilityProvider & Banner", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("transitions to ready when /api/ready and socket /health respond with 200", async () => {
    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/ready")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "ready", database: "connected" }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      });
    });
    global.fetch = fetchMock;

    render(
      <BackendAvailabilityProvider>
        <TestConsumer />
        <BackendStatusBanner />
      </BackendAvailabilityProvider>
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
    expect(screen.getByTestId("ready").textContent).toBe("true");
  });

  it("transitions to waking when socket server or DB takes longer than initial wait threshold", async () => {
    let resolveSocket: (value: any) => void;
    const socketPromise = new Promise((res) => {
      resolveSocket = res;
    });

    const fetchMock = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/ready")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ status: "ready", database: "connected" }),
        });
      }
      return socketPromise;
    });
    global.fetch = fetchMock;

    render(
      <BackendAvailabilityProvider>
        <TestConsumer />
        <BackendStatusBanner />
      </BackendAvailabilityProvider>
    );

    // Fast-forward past 1800ms
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    expect(screen.getByTestId("status").textContent).toBe("waking");
    expect(screen.getByTestId("waking").textContent).toBe("true");

    // Advance timer by 5 seconds
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(parseInt(screen.getByTestId("elapsed").textContent || "0", 10)).toBeGreaterThanOrEqual(4);

    // Now resolve socket
    await act(async () => {
      resolveSocket!({
        ok: true,
        status: 200,
        json: async () => ({ status: "ok" }),
      });
      await Promise.resolve();
    });

    // Advance to next poll
    await act(async () => {
      vi.advanceTimersByTime(3000);
      await Promise.resolve();
    });

    expect(screen.getByTestId("status").textContent).toBe("ready");
  });
});
