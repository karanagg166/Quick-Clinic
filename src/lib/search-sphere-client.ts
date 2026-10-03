export interface StorageUploadResult {
  storagePath: string;
  mimeType: string;
  fileSize: number;
}

export interface StorageSignedUrlResult {
  url: string;
  expiresIn: number;
}

export interface StorageDeleteResult {
  success: boolean;
  message: string;
}

function getServiceConfig() {
  const baseUrl = (process.env.SEARCH_SPHERE_API_URL || "http://localhost:8000").replace(/\/$/, "");
  const secret = process.env.SEARCH_SPHERE_SERVICE_SECRET || "quick-clinic-internal-service-secret-2026";
  return { baseUrl, secret };
}

/**
 * Uploads medical document file bytes to Search Sphere internal storage API.
 */
export async function uploadToStorage(params: {
  file: Blob;
  fileName: string;
  patientId: string;
  documentId: string;
}): Promise<StorageUploadResult> {
  const { baseUrl, secret } = getServiceConfig();
  const form = new FormData();

  form.append("file", params.file, params.fileName);
  form.append("patient_id", params.patientId);
  form.append("document_id", params.documentId);

  const response = await fetch(`${baseUrl}/internal/medical-documents`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
    body: form,
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to store document in object storage";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Storage upload failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    storagePath: data.storagePath,
    mimeType: data.mimeType,
    fileSize: data.fileSize,
  };
}

/**
 * Requests a short-lived signed URL for reading/downloading a medical document.
 */
export async function getSignedStorageUrl(
  storagePath: string,
  expiresIn: number = 600
): Promise<StorageSignedUrlResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents/signed-url`);
  url.searchParams.set("storagePath", storagePath);
  url.searchParams.set("expiresIn", expiresIn.toString());

  const response = await fetch(url.toString(), {
    method: "GET",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to generate signed document URL";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Storage access URL failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    url: data.url,
    expiresIn: data.expiresIn,
  };
}

/**
 * Deletes a medical document object from private storage.
 */
export async function deleteFromStorage(
  storagePath: string
): Promise<StorageDeleteResult> {
  const { baseUrl, secret } = getServiceConfig();

  const url = new URL(`${baseUrl}/internal/medical-documents`);
  url.searchParams.set("storagePath", storagePath);

  const response = await fetch(url.toString(), {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${secret}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    let detail = "Failed to delete document from object storage";
    try {
      const parsed = JSON.parse(errorText);
      detail = parsed.detail || detail;
    } catch {
      // ignore
    }
    throw new Error(`Storage delete failed (${response.status}): ${detail}`);
  }

  const data = await response.json();
  return {
    success: data.success ?? true,
    message: data.message ?? "Medical document deleted successfully",
  };
}
