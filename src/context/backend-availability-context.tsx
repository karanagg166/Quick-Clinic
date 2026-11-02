"use client";

import React, {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  useCallback,
  useMemo,
  type ReactNode,
} from "react";

export type BackendStatus = "checking" | "waking" | "ready" | "degraded" | "offline";

export interface BackendAvailabilityContextType {
  status: BackendStatus;
  isReady: boolean;
  isWaking: boolean;
  isChecking: boolean;
  isDegraded: boolean;
  isOffline: boolean;
  databaseStatus: "checking" | "connected" | "disconnected";
  socketStatus: "checking" | "waking" | "ready" | "offline";
  elapsedSeconds: number;
  retryCount: number;
  lastChecked: number | null;
  errorMessage: string | null;
  checkAvailability: (force?: boolean) => Promise<boolean>;
  retry: () => Promise<boolean>;
}

const BackendAvailabilityContext = createContext<
  BackendAvailabilityContextType | undefined
>(undefined);

export const AVAILABILITY_CONFIG = {
  INITIAL_FAST_WAIT_MS: 1800,
  PROBE_TIMEOUT_MS: 15000,
  TOTAL_STARTUP_DEADLINE_MS: 90000,
  BASE_RETRY_DELAY_MS: 2000,
  MAX_RETRY_DELAY_MS: 8000,
  BACKOFF_FACTOR: 1.35,
  STALE_THRESHOLD_MS: 60000,
};

function calculateBackoffDelay(attempt: number): number {
  const base = Math.min(
    AVAILABILITY_CONFIG.MAX_RETRY_DELAY_MS,
    AVAILABILITY_CONFIG.BASE_RETRY_DELAY_MS *
      Math.pow(AVAILABILITY_CONFIG.BACKOFF_FACTOR, attempt)
  );
  // Add ±20% jitter to prevent thundering herd
  const jitter = (Math.random() * 0.4 - 0.2) * base;
  return Math.round(base + jitter);
}

export function BackendAvailabilityProvider({ children }: { children: ReactNode }) {
  const [status, setStatusState] = useState<BackendStatus>("checking");
  const [databaseStatus, setDatabaseStatus] = useState<"checking" | "connected" | "disconnected">("checking");
  const [socketStatus, setSocketStatus] = useState<"checking" | "waking" | "ready" | "offline">("checking");
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(0);
  const [retryCount, setRetryCountState] = useState<number>(0);
  const [lastChecked, setLastChecked] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const statusRef = useRef<BackendStatus>("checking");
  const retryCountRef = useRef<number>(0);

  const setStatus = useCallback((next: BackendStatus) => {
    statusRef.current = next;
    setStatusState(next);
  }, []);

  const setRetryCount = useCallback((next: number) => {
    retryCountRef.current = next;
    setRetryCountState(next);
  }, []);

  const activeCheckPromiseRef = useRef<Promise<boolean> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const retryTimerRef = useRef<NodeJS.Timeout | null>(null);
  const elapsedIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wakeStartTimeRef = useRef<number | null>(null);
  const isMountedRef = useRef<boolean>(true);
  const triggerCheckRef = useRef<(force?: boolean) => Promise<boolean>>(() =>
    Promise.resolve(false)
  );

  const clearTimers = useCallback(() => {
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
  }, []);

  const stopElapsedTracking = useCallback(() => {
    if (elapsedIntervalRef.current) {
      clearInterval(elapsedIntervalRef.current);
      elapsedIntervalRef.current = null;
    }
    wakeStartTimeRef.current = null;
  }, []);

  const startElapsedTracking = useCallback(() => {
    if (!wakeStartTimeRef.current) {
      wakeStartTimeRef.current = Date.now();
    }
    if (!elapsedIntervalRef.current) {
      elapsedIntervalRef.current = setInterval(() => {
        if (!isMountedRef.current) return;
        const elapsed = wakeStartTimeRef.current
          ? Math.max(1, Math.floor((Date.now() - wakeStartTimeRef.current) / 1000))
          : 0;
        setElapsedSeconds((prev) => Math.max(prev + 1, elapsed));
      }, 1000);
    }
  }, []);

  const onBecameReady = useCallback(() => {
    stopElapsedTracking();
    clearTimers();
    setElapsedSeconds(0);
    setRetryCount(0);
    setErrorMessage(null);
    setLastChecked(Date.now());
    setStatus("ready");
  }, [clearTimers, stopElapsedTracking, setStatus, setRetryCount]);

  const executeCheck = useCallback(
    async (isManualRetry = false): Promise<boolean> => {
      if (!wakeStartTimeRef.current) {
        wakeStartTimeRef.current = Date.now();
      }

      if (typeof navigator !== "undefined" && !navigator.onLine) {
        stopElapsedTracking();
        clearTimers();
        setStatus("offline");
        setDatabaseStatus("disconnected");
        setSocketStatus("offline");
        setErrorMessage("Internet connection offline. Please check your network.");
        return false;
      }

      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      const controller = new AbortController();
      abortControllerRef.current = controller;

      const probeTimeout = setTimeout(() => {
        controller.abort();
      }, AVAILABILITY_CONFIG.PROBE_TIMEOUT_MS);

      let fastWakingTimer: NodeJS.Timeout | null = null;
      if (statusRef.current === "checking" || isManualRetry) {
        fastWakingTimer = setTimeout(() => {
          if (isMountedRef.current && statusRef.current !== "ready") {
            setStatus("waking");
            startElapsedTracking();
          }
        }, AVAILABILITY_CONFIG.INITIAL_FAST_WAIT_MS);
      }

      try {
        const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL;

        // Run checks in parallel:
        // 1. Next.js DB readiness (/api/ready)
        // 2. Render Socket.IO server health (/health) - wakes sleeping Render service
        const readyPromise = fetch("/api/ready", {
          signal: controller.signal,
          cache: "no-store",
        }).then(async (r) => {
          const body = await r.json().catch(() => ({}));
          return { ok: r.ok, status: r.status, data: body };
        }).catch((err) => ({ ok: false, status: 0, error: err }));

        const socketPromise = socketUrl
          ? fetch(`${socketUrl.replace(/\/+$/, "")}/health`, {
              signal: controller.signal,
              cache: "no-store",
            }).then((r) => ({ ok: r.ok, status: r.status })).catch((err) => ({ ok: false, status: 0, error: err }))
          : Promise.resolve({ ok: true, status: 200 });

        const [readyRes, socketRes] = await Promise.all([readyPromise, socketPromise]);

        const dbOk = readyRes.ok && "data" in readyRes && (readyRes.data as any)?.database === "connected";
        const socketOk = socketRes.ok;

        if (isMountedRef.current) {
          setDatabaseStatus(dbOk ? "connected" : "disconnected");
          setSocketStatus(socketOk ? "ready" : "waking");
        }

        if (dbOk) {
          // Database is ready!
          if (socketOk) {
            if (isMountedRef.current) {
              onBecameReady();
            }
            return true;
          } else {
            // Web & DB are ready, but socket server is still warming up on Render
            if (isMountedRef.current) {
              setStatus("waking");
              startElapsedTracking();
              setErrorMessage("Realtime chat & notifications server is waking up...");
            }
          }
        } else {
          // Database is disconnected / scaling up
          if (isMountedRef.current) {
            setStatus("waking");
            startElapsedTracking();
            setErrorMessage("Database is connecting...");
          }
        }

        // Schedule next retry with exponential backoff & jitter
        const currentElapsed = wakeStartTimeRef.current ? Date.now() - wakeStartTimeRef.current : 0;
        if (currentElapsed >= AVAILABILITY_CONFIG.TOTAL_STARTUP_DEADLINE_MS) {
          stopElapsedTracking();
          clearTimers();
          setStatus("degraded");
          setErrorMessage("Connection deadline exceeded. Please click retry.");
          return false;
        }

        const nextAttempt = retryCountRef.current + 1;
        setRetryCount(nextAttempt);

        if (typeof document === "undefined" || document.visibilityState === "visible") {
          const delay = calculateBackoffDelay(nextAttempt);
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (isMountedRef.current && (statusRef.current === "waking" || statusRef.current === "checking")) {
              triggerCheckRef.current(false);
            }
          }, delay);
        }

        return false;
      } catch (err: any) {
        if (!isMountedRef.current) return false;
        if (err.name === "AbortError") return false;

        const currentElapsed = wakeStartTimeRef.current ? Date.now() - wakeStartTimeRef.current : 0;
        if (currentElapsed >= AVAILABILITY_CONFIG.TOTAL_STARTUP_DEADLINE_MS) {
          stopElapsedTracking();
          clearTimers();
          setStatus("offline");
          setErrorMessage("Service is temporarily unreachable. Please retry.");
          return false;
        }

        setStatus("waking");
        startElapsedTracking();
        const nextAttempt = retryCountRef.current + 1;
        setRetryCount(nextAttempt);

        if (typeof document === "undefined" || document.visibilityState === "visible") {
          const delay = calculateBackoffDelay(nextAttempt);
          if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
          retryTimerRef.current = setTimeout(() => {
            if (isMountedRef.current && statusRef.current === "waking") {
              triggerCheckRef.current(false);
            }
          }, delay);
        }

        return false;
      } finally {
        clearTimeout(probeTimeout);
        if (fastWakingTimer) clearTimeout(fastWakingTimer);
      }
    },
    [onBecameReady, clearTimers, startElapsedTracking, stopElapsedTracking, setStatus, setRetryCount]
  );

  const checkAvailability = useCallback(
    (force = false): Promise<boolean> => {
      if (force) {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
          abortControllerRef.current = null;
        }
        activeCheckPromiseRef.current = null;
      } else if (activeCheckPromiseRef.current) {
        return activeCheckPromiseRef.current;
      }

      if (statusRef.current === "ready" && !force) {
        return Promise.resolve(true);
      }

      const promise = executeCheck(force).finally(() => {
        activeCheckPromiseRef.current = null;
      });

      activeCheckPromiseRef.current = promise;
      return promise;
    },
    [executeCheck]
  );

  useEffect(() => {
    triggerCheckRef.current = checkAvailability;
  }, [checkAvailability]);

  const retry = useCallback(async (): Promise<boolean> => {
    clearTimers();
    wakeStartTimeRef.current = Date.now();
    setElapsedSeconds(0);
    setRetryCount(0);
    setErrorMessage(null);
    setStatus("checking");
    return checkAvailability(true);
  }, [clearTimers, checkAvailability, setStatus, setRetryCount]);

  useEffect(() => {
    isMountedRef.current = true;
    checkAvailability(false);

    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        const isStale = !lastChecked || (Date.now() - lastChecked > AVAILABILITY_CONFIG.STALE_THRESHOLD_MS);
        if (isStale) {
          // Tab became visible after inactivity: force a fresh verification
          checkAvailability(true);
        } else if (statusRef.current !== "ready") {
          checkAvailability(false);
        }
      }
    };

    const handleOnline = () => {
      if (statusRef.current !== "ready") {
        retry();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    window.addEventListener("online", handleOnline);

    return () => {
      isMountedRef.current = false;
      clearTimers();
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      window.removeEventListener("online", handleOnline);
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [checkAvailability, clearTimers, lastChecked, retry]);

  const value = useMemo<BackendAvailabilityContextType>(
    () => ({
      status,
      isReady: status === "ready",
      isWaking: status === "waking",
      isChecking: status === "checking",
      isDegraded: status === "degraded",
      isOffline: status === "offline",
      databaseStatus,
      socketStatus,
      elapsedSeconds,
      retryCount,
      lastChecked,
      errorMessage,
      checkAvailability,
      retry,
    }),
    [
      status,
      databaseStatus,
      socketStatus,
      elapsedSeconds,
      retryCount,
      lastChecked,
      errorMessage,
      checkAvailability,
      retry,
    ]
  );

  return (
    <BackendAvailabilityContext.Provider value={value}>
      {children}
    </BackendAvailabilityContext.Provider>
  );
}

export function useBackendAvailability(): BackendAvailabilityContextType {
  const context = useContext(BackendAvailabilityContext);
  if (!context) {
    throw new Error(
      "useBackendAvailability must be used within a BackendAvailabilityProvider"
    );
  }
  return context;
}
