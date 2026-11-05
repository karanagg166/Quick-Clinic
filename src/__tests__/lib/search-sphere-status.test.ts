import { describe, expect, it } from "vitest";
import { searchSphereProcessingState } from "@/lib/search-sphere-status";

describe("Search Sphere upstream processing contract", () => {
  it.each(["PENDING", "QUEUED", "PROCESSING", "READY", "FAILED"])("preserves %s", (status) => {
    const result = searchSphereProcessingState(status);
    expect(result.processingStatus).toBe(status);
    expect(result.processingError === null).toBe(status !== "FAILED");
  });

  it.each([undefined, null, "", "unknown", 202])("rejects invalid upstream state %s", (status) => {
    expect(() => searchSphereProcessingState(status)).toThrow("Invalid Search Sphere processing state");
  });
});
