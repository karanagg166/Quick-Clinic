import { MedicalDocumentProcessingStatus } from "@/generated/prisma";

/** Validate the upstream state before persisting or displaying it. */
export function searchSphereProcessingState(value: unknown) {
  if (typeof value !== "string") throw new Error("Invalid Search Sphere processing state.");
  const status = value.trim().toUpperCase() as MedicalDocumentProcessingStatus;
  if (!Object.values(MedicalDocumentProcessingStatus).includes(status)) {
    throw new Error("Invalid Search Sphere processing state.");
  }
  return {
    processingStatus: status,
    processingError: status === "FAILED"
      ? "Search Sphere could not process this document. Retry processing."
      : null,
  };
}
