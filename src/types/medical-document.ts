export type MedicalDocumentType =
  | "LAB_REPORT"
  | "PRESCRIPTION"
  | "RADIOLOGY_SCAN"
  | "DISCHARGE_SUMMARY"
  | "MEDICAL_CERTIFICATE"
  | "VACCINATION_RECORD"
  | "OTHER";

export type MedicalFileTypeFilter = "ALL" | "PDF" | "IMAGE";

export type MedicalDocumentSortOption =
  | "newest"
  | "oldest"
  | "name_asc"
  | "name_desc";

export type MedicalDocumentProcessingStatus =
  | "PENDING"
  | "QUEUED"
  | "PROCESSING"
  | "READY"
  | "FAILED";

export interface MedicalDocument {
  id: string;
  title: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  type: MedicalDocumentType;
  reportDate: string;
  uploadedAt: string;
  hospitalOrDoctor?: string;
  notes?: string;
  previewUrl?: string;
  processingStatus?: MedicalDocumentProcessingStatus;
  processingError?: string | null;
  processedAt?: string | null;
}

export interface MedicalDocumentFiltersState {
  searchQuery: string;
  documentType: MedicalDocumentType | "ALL";
  fileType: MedicalFileTypeFilter;
  reportDate: string;
  sortBy: MedicalDocumentSortOption;
}

export const DOCUMENT_TYPE_LABELS: Record<MedicalDocumentType, string> = {
  LAB_REPORT: "Lab Report",
  PRESCRIPTION: "Prescription",
  RADIOLOGY_SCAN: "Radiology / Scan",
  DISCHARGE_SUMMARY: "Discharge Summary",
  MEDICAL_CERTIFICATE: "Medical Certificate",
  VACCINATION_RECORD: "Vaccination Record",
  OTHER: "Other",
};

export const DOCUMENT_TYPE_BADGE_CLASSES: Record<MedicalDocumentType, string> = {
  LAB_REPORT: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  PRESCRIPTION: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  RADIOLOGY_SCAN: "bg-purple-500/10 text-purple-700 dark:text-purple-400 border-purple-200 dark:border-purple-800",
  DISCHARGE_SUMMARY: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  MEDICAL_CERTIFICATE: "bg-cyan-500/10 text-cyan-700 dark:text-cyan-400 border-cyan-200 dark:border-cyan-800",
  VACCINATION_RECORD: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
  OTHER: "bg-slate-500/10 text-slate-700 dark:text-slate-400 border-slate-200 dark:border-slate-800",
};

export const PROCESSING_STATUS_LABELS: Record<MedicalDocumentProcessingStatus, string> = {
  PENDING: "Processing",
  QUEUED: "Processing",
  PROCESSING: "Processing",
  READY: "Ready for AI",
  FAILED: "Processing failed",
};

export const PROCESSING_STATUS_BADGE_CLASSES: Record<MedicalDocumentProcessingStatus, string> = {
  PENDING: "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-amber-200 dark:border-amber-800",
  QUEUED: "bg-blue-500/10 text-blue-700 dark:text-blue-400 border-blue-200 dark:border-blue-800",
  PROCESSING: "bg-indigo-500/10 text-indigo-700 dark:text-indigo-400 border-indigo-200 dark:border-indigo-800",
  READY: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border-emerald-200 dark:border-emerald-800",
  FAILED: "bg-rose-500/10 text-rose-700 dark:text-rose-400 border-rose-200 dark:border-rose-800",
};

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(1)} MB`;
}

export function formatDisplayDate(dateStr: string): string {
  if (!dateStr) return "";
  try {
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    return date.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export function isPdfDocument(fileName: string, mimeType?: string): boolean {
  if (mimeType?.toLowerCase().includes("pdf")) return true;
  return fileName.toLowerCase().endsWith(".pdf");
}

export function isImageDocument(fileName: string, mimeType?: string): boolean {
  if (mimeType?.toLowerCase().startsWith("image/")) return true;
  const lower = fileName.toLowerCase();
  return (
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".png") ||
    lower.endsWith(".webp")
  );
}

// Inline SVGs for realistic mock image document previews without external network dependencies
const CHEST_XRAY_PREVIEW =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400' width='600' height='400'><rect width='600' height='400' fill='%230f172a'/><path d='M300 60 L300 340 M240 100 Q300 80 360 100 M220 140 Q300 120 380 140 M210 180 Q300 160 390 180 M210 220 Q300 200 390 220 M220 260 Q300 240 380 260 M240 300 Q300 280 360 300' stroke='%2394a3b8' stroke-width='6' fill='none' stroke-linecap='round'/><ellipse cx='300' cy='230' rx='50' ry='70' fill='%2338bdf8' opacity='0.18'/><text x='30' y='40' fill='%2364748b' font-family='sans-serif' font-size='14' font-weight='600'>CHEST PA VIEW - APOLLO RADIOLOGY</text><text x='30' y='370' fill='%2364748b' font-family='sans-serif' font-size='12'>NORMAL PULMONARY VASCULATURE</text></svg>";

const DR_SHARMA_RX_PREVIEW =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400' width='600' height='400'><rect width='600' height='400' fill='%23f8fafc'/><rect x='20' y='20' width='560' height='360' rx='8' fill='%23ffffff' stroke='%23cbd5e1' stroke-width='2'/><text x='50' y='70' fill='%230284c7' font-family='sans-serif' font-size='22' font-weight='bold'>Dr. A. Sharma, MD (Cardiology)</text><text x='50' y='95' fill='%2364748b' font-family='sans-serif' font-size='13'>Reg No: MED-74892 • Apollo Heart Institute</text><line x1='50' y1='115' x2='550' y2='115' stroke='%23e2e8f0' stroke-width='2'/><text x='50' y='160' fill='%230f172a' font-family='serif' font-size='32' font-style='italic' font-weight='bold'>Rx</text><text x='110' y='165' fill='%23334155' font-family='sans-serif' font-size='15'>1. Tab Telmisartan 40mg — 1 tablet OD (Morning)</text><text x='110' y='205' fill='%23334155' font-family='sans-serif' font-size='15'>2. Tab Atorvastatin 10mg — 1 tablet HS (Night)</text><text x='110' y='245' fill='%23334155' font-family='sans-serif' font-size='15'>3. Routine BP checkup every alternate week</text><text x='50' y='330' fill='%2394a3b8' font-family='sans-serif' font-size='12'>Valid for 30 days • Follow up in 1 month</text></svg>";

const MRI_BRAIN_PREVIEW =
  "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 600 400' width='600' height='400'><rect width='600' height='400' fill='%23020617'/><ellipse cx='300' cy='200' rx='130' ry='150' fill='none' stroke='%23334155' stroke-width='3'/><path d='M230 180 Q270 120 300 180 T370 180 Q350 250 300 240 T230 180' fill='%2364748b' opacity='0.3' stroke='%2394a3b8' stroke-width='2'/><ellipse cx='260' cy='180' rx='25' ry='35' fill='%2338bdf8' opacity='0.25'/><ellipse cx='340' cy='180' rx='25' ry='35' fill='%2338bdf8' opacity='0.25'/><text x='30' y='40' fill='%2364748b' font-family='sans-serif' font-size='14' font-weight='600'>MRI BRAIN AXIAL T2 - MAX HEALTHCARE</text><text x='30' y='370' fill='%2364748b' font-family='sans-serif' font-size='12'>NO INTRACRANIAL ABNORMALITY DETECTED</text></svg>";

export const INITIAL_MOCK_DOCUMENTS: MedicalDocument[] = [
  {
    id: "doc-1",
    title: "Blood Test - September 2026",
    fileName: "Blood Test - September 2026.pdf",
    mimeType: "application/pdf",
    fileSize: 1450000,
    type: "LAB_REPORT",
    reportDate: "2026-09-15",
    uploadedAt: "2026-09-16",
    hospitalOrDoctor: "Metropolis Diagnostics",
    notes: "Complete metabolic panel and lipid profile. All markers are within normal biological range.",
  },
  {
    id: "doc-2",
    title: "Chest X-Ray",
    fileName: "Chest X-Ray.jpg",
    mimeType: "image/jpeg",
    fileSize: 2850000,
    type: "RADIOLOGY_SCAN",
    reportDate: "2026-08-20",
    uploadedAt: "2026-08-21",
    hospitalOrDoctor: "Apollo Hospital Radiology",
    notes: "Posteroanterior (PA) chest radiograph. Lung fields clear, no focal consolidation or effusion.",
    previewUrl: CHEST_XRAY_PREVIEW,
  },
  {
    id: "doc-3",
    title: "Dr Sharma Prescription",
    fileName: "Dr Sharma Prescription.png",
    mimeType: "image/png",
    fileSize: 840000,
    type: "PRESCRIPTION",
    reportDate: "2026-07-10",
    uploadedAt: "2026-07-10",
    hospitalOrDoctor: "Dr. A. Sharma (Cardiology)",
    notes: "Prescription for blood pressure monitoring and 30-day maintenance dosage.",
    previewUrl: DR_SHARMA_RX_PREVIEW,
  },
  {
    id: "doc-4",
    title: "Diabetes Lab Report",
    fileName: "Diabetes Lab Report.pdf",
    mimeType: "application/pdf",
    fileSize: 2150000,
    type: "LAB_REPORT",
    reportDate: "2026-06-05",
    uploadedAt: "2026-06-06",
    hospitalOrDoctor: "Dr. Lal PathLabs",
    notes: "HbA1c test and fasting glucose levels monitoring report.",
  },
  {
    id: "doc-5",
    title: "MRI Brain Scan",
    fileName: "MRI Brain Scan.jpeg",
    mimeType: "image/jpeg",
    fileSize: 4320000,
    type: "RADIOLOGY_SCAN",
    reportDate: "2026-05-18",
    uploadedAt: "2026-05-19",
    hospitalOrDoctor: "Max Healthcare Imaging",
    notes: "T1/T2 axial scans with contrast. Normal anatomical structures and no abnormalities.",
    previewUrl: MRI_BRAIN_PREVIEW,
  },
  {
    id: "doc-6",
    title: "Vaccination Certificate",
    fileName: "Vaccination Certificate.pdf",
    mimeType: "application/pdf",
    fileSize: 620000,
    type: "VACCINATION_RECORD",
    reportDate: "2026-03-12",
    uploadedAt: "2026-03-12",
    hospitalOrDoctor: "Government Health Center",
    notes: "Annual booster immunization dose administration certificate.",
  },
];
