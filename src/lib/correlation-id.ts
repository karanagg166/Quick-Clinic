import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "crypto";

const SAFE_REQUEST_ID_REGEX = /^[a-zA-Z0-9_\-\.:]{8,128}$/;

const asyncLocalStorage = new AsyncLocalStorage<{ requestId: string }>();

/**
 * Runs a function within the context of a correlation ID.
 */
export function runWithRequestId<T>(requestId: string, fn: () => T): T {
  return asyncLocalStorage.run({ requestId }, fn);
}

/**
 * Returns the correlation ID for the current asynchronous execution context.
 */
export function getCurrentRequestId(): string | undefined {
  return asyncLocalStorage.getStore()?.requestId;
}

/**
 * Extracts a safe correlation ID from an incoming HTTP request or generates a fresh random UUID v4.
 * Strictly prevents PHI (patient IDs, doctor IDs, emails) or script injection from being treated as correlation IDs.
 */
export function getOrCreateRequestId(
  req?: Request | { headers?: Headers | Record<string, string | null | undefined> } | null
): string {
  if (req) {
    let headerVal: string | null | undefined = null;
    if ("headers" in req && req.headers) {
      if (typeof (req.headers as Headers).get === "function") {
        headerVal =
          (req.headers as Headers).get("x-request-id") ||
          (req.headers as Headers).get("x-correlation-id");
      } else {
        const rawHeaders = req.headers as Record<string, string | null | undefined>;
        headerVal =
          rawHeaders["x-request-id"] ||
          rawHeaders["X-Request-ID"] ||
          rawHeaders["x-correlation-id"];
      }
    }

    if (headerVal && typeof headerVal === "string") {
      const trimmed = headerVal.trim();
      if (SAFE_REQUEST_ID_REGEX.test(trimmed)) {
        return trimmed;
      }
    }
  }

  const existingStore = getCurrentRequestId();
  if (existingStore) {
    return existingStore;
  }

  return randomUUID();
}
