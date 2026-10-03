// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import PatientSidebar from "@/components/patient/sidebar";
import { MedicalDocumentCard } from "@/components/patient/medical-documents/MedicalDocumentCard";
import { MedicalDocumentFilters } from "@/components/patient/medical-documents/MedicalDocumentFilters";
import { MedicalDocumentPreviewDialog } from "@/components/patient/medical-documents/MedicalDocumentPreviewDialog";
import { MedicalDocumentDeleteDialog } from "@/components/patient/medical-documents/MedicalDocumentDeleteDialog";
import { MedicalDocumentRenameDialog } from "@/components/patient/medical-documents/MedicalDocumentRenameDialog";
import { MedicalDocumentUploadZone } from "@/components/patient/medical-documents/MedicalDocumentUploadZone";
import MedicalDocumentsPage from "@/app/(protected)/patient/medical-documents/page";
import UploadMedicalDocumentPage from "@/app/(protected)/patient/medical-documents/upload/page";
import {
  MedicalDocument,
  INITIAL_MOCK_DOCUMENTS,
  formatFileSize,
  formatDisplayDate,
} from "@/types/medical-document";
import { toast } from "sonner";

let currentPathname = "/patient/medical-documents";
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => currentPathname,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("Patient Medical Documents Feature Test Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  describe("1. Patient Sidebar Integration", () => {
    it("renders Medical Documents navigation link with correct href and active state", () => {
      currentPathname = "/patient/medical-documents";
      render(<PatientSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />);

      const medicalDocsLink = screen.getByRole("link", {
        name: /medical documents/i,
      });
      expect(medicalDocsLink).toBeDefined();
      expect(medicalDocsLink.getAttribute("href")).toBe(
        "/patient/medical-documents"
      );
      expect(medicalDocsLink.className).toContain("font-semibold");
    });
  });

  describe("2. MedicalDocumentCard Component", () => {
    const mockPdfDoc: MedicalDocument = {
      id: "doc-test-1",
      title: "Blood Test - September 2026",
      fileName: "Blood Test - September 2026.pdf",
      mimeType: "application/pdf",
      fileSize: 1450000,
      type: "LAB_REPORT",
      reportDate: "2026-09-15",
      uploadedAt: "2026-09-16",
      hospitalOrDoctor: "Metropolis Diagnostics",
      notes: "Normal metabolic markers",
    };

    const mockImageDoc: MedicalDocument = {
      id: "doc-test-2",
      title: "Chest X-Ray",
      fileName: "Chest X-Ray.jpg",
      mimeType: "image/jpeg",
      fileSize: 2850000,
      type: "RADIOLOGY_SCAN",
      reportDate: "2026-08-20",
      uploadedAt: "2026-08-21",
      hospitalOrDoctor: "Apollo Hospital Radiology",
      previewUrl: "data:image/svg+xml;utf8,<svg></svg>",
    };

    it("renders PDF document details, metadata, and badge properly", () => {
      const handleView = vi.fn();
      const handleDownload = vi.fn();
      const handleRename = vi.fn();
      const handleDelete = vi.fn();

      render(
        <MedicalDocumentCard
          document={mockPdfDoc}
          onView={handleView}
          onDownload={handleDownload}
          onRename={handleRename}
          onDelete={handleDelete}
        />
      );

      expect(screen.getByText("Blood Test - September 2026")).toBeDefined();
      expect(screen.getByText("Lab Report")).toBeDefined();
      expect(screen.getAllByText("PDF")[0]).toBeDefined();
      expect(screen.getByText(formatFileSize(1450000))).toBeDefined();
      expect(screen.getByText(formatDisplayDate("2026-09-15"))).toBeDefined();
      expect(screen.getByText("Metropolis Diagnostics")).toBeDefined();

      const viewBtn = screen.getByRole("button", { name: /^view$/i });
      fireEvent.click(viewBtn);
      expect(handleView).toHaveBeenCalledWith(mockPdfDoc);
    });

    it("renders image document details and thumbnail image", () => {
      render(
        <MedicalDocumentCard
          document={mockImageDoc}
          onView={vi.fn()}
          onDownload={vi.fn()}
          onRename={vi.fn()}
          onDelete={vi.fn()}
        />
      );

      expect(screen.getByText("Chest X-Ray")).toBeDefined();
      expect(screen.getByText("Radiology / Scan")).toBeDefined();
      expect(screen.getByText("JPG")).toBeDefined();
      expect(screen.getByText(formatFileSize(2850000))).toBeDefined();
      expect(screen.getByAltText("Chest X-Ray")).toBeDefined();
    });
  });

  describe("3. MedicalDocumentFilters Component", () => {
    it("fires filter change events for search query and reset filters", () => {
      const handleFilterChange = vi.fn();
      const handleReset = vi.fn();

      render(
        <MedicalDocumentFilters
          filters={{
            searchQuery: "",
            documentType: "ALL",
            fileType: "ALL",
            reportDate: "",
            sortBy: "newest",
          }}
          onFilterChange={handleFilterChange}
          onResetFilters={handleReset}
          totalCount={6}
          filteredCount={6}
        />
      );

      const searchInput = screen.getByPlaceholderText("Search documents...");
      fireEvent.change(searchInput, { target: { value: "x-ray" } });
      expect(handleFilterChange).toHaveBeenCalledWith({ searchQuery: "x-ray" });
    });

    it("triggers reset when reset button is clicked", () => {
      const handleReset = vi.fn();

      render(
        <MedicalDocumentFilters
          filters={{
            searchQuery: "scan",
            documentType: "ALL",
            fileType: "ALL",
            reportDate: "",
            sortBy: "newest",
          }}
          onFilterChange={vi.fn()}
          onResetFilters={handleReset}
          totalCount={6}
          filteredCount={2}
        />
      );

      const resetBtn = screen.getByRole("button", { name: /reset/i });
      expect(resetBtn).toBeDefined();
      fireEvent.click(resetBtn);
      expect(handleReset).toHaveBeenCalledTimes(1);
    });
  });

  describe("4. Dialogs (Preview, Rename, Delete)", () => {
    const testDoc = INITIAL_MOCK_DOCUMENTS[0];

    it("renders MedicalDocumentPreviewDialog with metadata and close button", () => {
      const handleClose = vi.fn();
      const handleDownload = vi.fn();

      render(
        <MedicalDocumentPreviewDialog
          document={testDoc}
          isOpen={true}
          onClose={handleClose}
          onDownload={handleDownload}
        />
      );

      expect(screen.getByText(testDoc.title)).toBeDefined();
      expect(screen.getAllByText(testDoc.fileName).length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText(testDoc.mimeType)).toBeDefined();
      expect(screen.getByText(/preview mode/i)).toBeDefined();

      const downloadBtn = screen.getByRole("button", {
        name: /download file/i,
      });
      fireEvent.click(downloadBtn);
      expect(handleDownload).toHaveBeenCalledWith(testDoc);

      const closeButtons = screen.getAllByRole("button", { name: /close/i });
      expect(closeButtons.length).toBeGreaterThanOrEqual(1);
      fireEvent.click(closeButtons[0]);
      expect(handleClose).toHaveBeenCalled();
    });

    it("handles MedicalDocumentDeleteDialog confirmation", () => {
      const handleClose = vi.fn();
      const handleConfirmDelete = vi.fn();

      render(
        <MedicalDocumentDeleteDialog
          document={testDoc}
          isOpen={true}
          onClose={handleClose}
          onConfirmDelete={handleConfirmDelete}
        />
      );

      expect(screen.getByText(/delete medical document\?/i)).toBeDefined();
      expect(screen.getByText(new RegExp(testDoc.title, "i"))).toBeDefined();

      const deleteBtn = screen.getByRole("button", {
        name: /^delete document$/i,
      });
      fireEvent.click(deleteBtn);
      expect(handleConfirmDelete).toHaveBeenCalledWith(testDoc);
      expect(handleClose).toHaveBeenCalled();
    });

    it("handles MedicalDocumentRenameDialog renaming and validation", () => {
      const handleClose = vi.fn();
      const handleConfirmRename = vi.fn();

      render(
        <MedicalDocumentRenameDialog
          document={testDoc}
          isOpen={true}
          onClose={handleClose}
          onConfirmRename={handleConfirmRename}
        />
      );

      expect(screen.getByText(/rename document/i)).toBeDefined();
      const input = screen.getByDisplayValue(testDoc.title);

      fireEvent.change(input, { target: { value: "" } });
      const submitBtn = screen.getByRole("button", { name: /save title/i });
      expect(submitBtn.hasAttribute("disabled")).toBe(true);

      fireEvent.change(input, { target: { value: "Updated Blood Report" } });
      fireEvent.click(submitBtn);

      expect(handleConfirmRename).toHaveBeenCalledWith(
        testDoc,
        "Updated Blood Report"
      );
      expect(handleClose).toHaveBeenCalled();
    });
  });

  describe("5. MedicalDocumentUploadZone Component", () => {
    it("renders dropzone instructions, accepted formats, and security note", () => {
      render(
        <MedicalDocumentUploadZone
          selectedFile={null}
          onFileSelect={vi.fn()}
        />
      );

      expect(
        screen.getByText(/drag and drop your medical file here/i)
      ).toBeDefined();
      expect(screen.getByText(/pdf, jpg, jpeg, png, webp/i)).toBeDefined();
      expect(
        screen.getByText(
          /your medical documents are private and will only be accessible to authorized users/i
        )
      ).toBeDefined();
    });

    it("validates and sets selected PDF file correctly", () => {
      const handleFileSelect = vi.fn();
      render(
        <MedicalDocumentUploadZone
          selectedFile={null}
          onFileSelect={handleFileSelect}
        />
      );

      const fileInput = screen.getByTestId("medical-document-file-input");
      const file = new File(["dummy pdf content"], "prescription.pdf", {
        type: "application/pdf",
      });

      fireEvent.change(fileInput, { target: { files: [file] } });
      expect(handleFileSelect).toHaveBeenCalledWith(file);
    });

    it("displays error for oversized file (> 10MB)", () => {
      const handleErrorChange = vi.fn();
      render(
        <MedicalDocumentUploadZone
          selectedFile={null}
          onFileSelect={vi.fn()}
          onErrorChange={handleErrorChange}
        />
      );

      const fileInput = screen.getByTestId("medical-document-file-input");
      const largeFile = new File([""], "huge-scan.pdf", {
        type: "application/pdf",
      });
      Object.defineProperty(largeFile, "size", { value: 12 * 1024 * 1024 });

      fireEvent.change(fileInput, { target: { files: [largeFile] } });
      expect(handleErrorChange).toHaveBeenCalledWith(
        expect.stringContaining("exceeds the 10 MB limit")
      );
    });

    it("displays error for invalid file format", () => {
      const handleErrorChange = vi.fn();
      render(
        <MedicalDocumentUploadZone
          selectedFile={null}
          onFileSelect={vi.fn()}
          onErrorChange={handleErrorChange}
        />
      );

      const fileInput = screen.getByTestId("medical-document-file-input");
      const badFile = new File(["bad content"], "test.exe", {
        type: "application/x-msdownload",
      });

      fireEvent.change(fileInput, { target: { files: [badFile] } });
      expect(handleErrorChange).toHaveBeenCalledWith(
        expect.stringContaining("Invalid file format")
      );
    });
  });

  describe("6. MedicalDocumentsPage Real API Integration", () => {
    it("loads documents from real API GET route and displays them", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ documents: INITIAL_MOCK_DOCUMENTS }),
      } as any);

      render(<MedicalDocumentsPage />);

      expect(screen.getByText("Medical Documents")).toBeDefined();
      expect(screen.getByRole("link", { name: /upload document/i })).toBeDefined();

      await waitFor(() => {
        expect(screen.getByText("Blood Test - September 2026")).toBeDefined();
      });

      expect(screen.getByText("Chest X-Ray")).toBeDefined();
      expect(screen.getByText("Dr Sharma Prescription")).toBeDefined();
      expect(screen.getByText("Diabetes Lab Report")).toBeDefined();
    });

    it("displays empty state when no documents match filters", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ documents: [] }),
      } as any);

      render(<MedicalDocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText(/no medical documents found/i)).toBeDefined();
      });

      expect(
        screen.getByText(/try changing your filters or upload a new medical document/i)
      ).toBeDefined();
    });

    it("requests signed access URL when viewing a document", async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("/access")) {
          return {
            ok: true,
            json: async () => ({
              url: "https://signed.supabase.co/preview/report.pdf",
              expiresIn: 600,
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ documents: [INITIAL_MOCK_DOCUMENTS[0]] }),
        };
      }) as any;

      render(<MedicalDocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("Blood Test - September 2026")).toBeDefined();
      });

      const viewBtn = screen.getAllByRole("button", { name: /^view$/i })[0];
      fireEvent.click(viewBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          expect.stringContaining(`/api/patients/me/medical-documents/${INITIAL_MOCK_DOCUMENTS[0].id}/access`)
        );
      });
    });

    it("sends DELETE request to API when confirming document deletion", async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
        if (opts?.method === "DELETE") {
          return {
            ok: true,
            json: async () => ({ success: true, message: "Deleted" }),
          };
        }
        return {
          ok: true,
          json: async () => ({ documents: [INITIAL_MOCK_DOCUMENTS[0]] }),
        };
      }) as any;

      render(<MedicalDocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("Blood Test - September 2026")).toBeDefined();
      });

      // Open action dropdown
      const actionsBtn = screen.getAllByRole("button", { name: /actions for/i })[0];
      fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false });
      fireEvent.click(actionsBtn);

      const deleteMenuItem = screen.getByRole("menuitem", { name: /delete/i });
      fireEvent.click(deleteMenuItem);

      const confirmBtn = screen.getByRole("button", { name: /^delete document$/i });
      fireEvent.click(confirmBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/patients/me/medical-documents/${INITIAL_MOCK_DOCUMENTS[0].id}`,
          { method: "DELETE" }
        );
      });

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("deleted")
      );
    });

    it("sends PATCH request to API when renaming a document", async () => {
      global.fetch = vi.fn().mockImplementation(async (url: string, opts?: any) => {
        if (opts?.method === "PATCH") {
          return {
            ok: true,
            json: async () => ({
              document: {
                ...INITIAL_MOCK_DOCUMENTS[0],
                title: "Renamed Title",
              },
            }),
          };
        }
        return {
          ok: true,
          json: async () => ({ documents: [INITIAL_MOCK_DOCUMENTS[0]] }),
        };
      }) as any;

      render(<MedicalDocumentsPage />);

      await waitFor(() => {
        expect(screen.getByText("Blood Test - September 2026")).toBeDefined();
      });

      // Open action dropdown
      const actionsBtn = screen.getAllByRole("button", { name: /actions for/i })[0];
      fireEvent.pointerDown(actionsBtn, { button: 0, ctrlKey: false });
      fireEvent.click(actionsBtn);

      const renameMenuItem = screen.getByRole("menuitem", { name: /rename/i });
      fireEvent.click(renameMenuItem);

      const input = screen.getByDisplayValue("Blood Test - September 2026");
      fireEvent.change(input, { target: { value: "Renamed Title" } });

      const saveBtn = screen.getByRole("button", { name: /save title/i });
      fireEvent.click(saveBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/patients/me/medical-documents/${INITIAL_MOCK_DOCUMENTS[0].id}`,
          expect.objectContaining({
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ title: "Renamed Title" }),
          })
        );
      });

      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("renamed")
      );
    });
  });

  describe("7. UploadMedicalDocumentPage Real API Integration", () => {
    it("renders upload page with metadata fields and validation", () => {
      render(<UploadMedicalDocumentPage />);

      expect(screen.getByText("Upload Medical Document")).toBeDefined();
      expect(
        screen.getByRole("link", { name: /back to medical documents/i })
      ).toBeDefined();

      const submitBtn = screen.getByRole("button", {
        name: /^upload document$/i,
      });
      fireEvent.click(submitBtn);

      expect(
        screen.getByText(/please select a medical document to upload/i)
      ).toBeDefined();
      expect(screen.getByText(/document title is required/i)).toBeDefined();
      expect(screen.getByText(/please select a document type/i)).toBeDefined();
      expect(
        screen.getByText(/please select the date when the medical report/i)
      ).toBeDefined();
    });

    it("submits FormData to real POST API and redirects on success", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          document: { id: "doc-new-123", title: "Prescription_Cardio" },
        }),
      } as any);

      render(<UploadMedicalDocumentPage />);

      // 1. Select file
      const fileInput = screen.getByTestId("medical-document-file-input");
      const file = new File(["test data"], "Prescription_Cardio.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(fileInput, { target: { files: [file] } });

      // Title should auto-populate
      expect(screen.getByDisplayValue("Prescription_Cardio")).toBeDefined();

      // 2. Select Report Date
      const dateInput = screen.getByLabelText(/report date/i);
      fireEvent.change(dateInput, { target: { value: "2026-09-20" } });

      // 3. Select Document Type
      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);

      const option = screen.getByRole("option", { name: /prescription/i });
      fireEvent.click(option);

      // 4. Submit form
      const submitBtn = screen.getByRole("button", {
        name: /^upload document$/i,
      });
      fireEvent.click(submitBtn);

      // Verify fetch was called with FormData
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/patients/me/medical-documents",
          expect.objectContaining({
            method: "POST",
            body: expect.any(FormData),
          })
        );
      });

      // Verify redirect and toast
      await waitFor(() => {
        expect(mockPush).toHaveBeenCalledWith("/patient/medical-documents");
      });
      expect(toast.success).toHaveBeenCalledWith(
        expect.stringContaining("uploaded successfully")
      );
    });

    it("displays error toast and remains on form if upload fails", async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: "File size exceeds 10 MB limit",
        }),
      } as any);

      render(<UploadMedicalDocumentPage />);

      const fileInput = screen.getByTestId("medical-document-file-input");
      const file = new File(["test data"], "Report.pdf", {
        type: "application/pdf",
      });
      fireEvent.change(fileInput, { target: { files: [file] } });

      const dateInput = screen.getByLabelText(/report date/i);
      fireEvent.change(dateInput, { target: { value: "2026-09-20" } });

      const selectTrigger = screen.getByRole("combobox");
      fireEvent.click(selectTrigger);
      const option = screen.getByRole("option", { name: /lab report/i });
      fireEvent.click(option);

      const submitBtn = screen.getByRole("button", {
        name: /^upload document$/i,
      });
      fireEvent.click(submitBtn);

      await waitFor(() => {
        expect(toast.error).toHaveBeenCalledWith(
          "File size exceeds 10 MB limit"
        );
      });

      expect(mockPush).not.toHaveBeenCalled();
    });
  });
});
