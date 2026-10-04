// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DoctorMedicalSearchSection } from "@/components/doctor/DoctorMedicalSearchSection";
import { showToast } from "@/lib/toast";

vi.mock("@/lib/toast", () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

describe("Doctor Medical Record Search Component (<DoctorMedicalSearchSection />)", () => {
  const patientId = "pat_test_123";
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
  });

  it("renders search bar with placeholder and search button", () => {
    render(<DoctorMedicalSearchSection patientId={patientId} />);

    expect(screen.getByText("Search Medical Records")).toBeDefined();
    expect(
      screen.getByPlaceholderText(/Search this patient's medical records/i)
    ).toBeDefined();
    expect(screen.getByRole("button", { name: /^search$/i })).toBeDefined();
  });

  it("shows toast error when search query is empty", async () => {
    const { container } = render(<DoctorMedicalSearchSection patientId={patientId} />);

    const form = container.querySelector("form")!;
    fireEvent.submit(form);

    expect(showToast.error).toHaveBeenCalledWith("Please enter a search query");
  });

  it("performs search and displays retrieved ranked excerpts with metadata", async () => {
    const mockResults = [
      {
        score: 0.94,
        content: "Blood Pressure: 120/80 mmHg. Heart Rate: 72 bpm regular.",
        documentId: "doc_bp_01",
        documentType: "LAB_REPORT",
        reportDate: "2026-10-01T00:00:00.000Z",
        fileName: "vitals_report.pdf",
        pageNumber: 2,
        chunkIndex: 1,
        patientId: patientId,
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockResults }),
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records/i);
    fireEvent.change(input, { target: { value: "blood pressure" } });

    const searchButton = screen.getByRole("button", { name: /^search$/i });
    fireEvent.click(searchButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/doctors/me/patients/${patientId}/medical-search`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "blood pressure", limit: 8 }),
        })
      );
    });

    await waitFor(() => {
      expect(screen.getByText("vitals_report.pdf")).toBeDefined();
      expect(screen.getByText(/120\/80 mmHg/)).toBeDefined();
      expect(screen.getByText("p. 2")).toBeDefined();
      expect(screen.getByText("94% match")).toBeDefined();
      expect(screen.getByRole("button", { name: /view source/i })).toBeDefined();
    });
  });

  it("opens signed document link in a new tab when 'View Source' is clicked", async () => {
    const mockResults = [
      {
        score: 0.88,
        content: "Chest X-Ray: Clear lung fields bilaterally.",
        documentId: "doc_xray_99",
        documentType: "RADIOLOGY_SCAN",
        reportDate: "2026-09-20T00:00:00.000Z",
        fileName: "chest_xray.png",
        pageNumber: 1,
        chunkIndex: 0,
        patientId: patientId,
      },
    ];

    global.fetch = vi
      .fn()
      // First fetch: search
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ results: mockResults }),
      } as any)
      // Second fetch: view source signed URL
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://storage.example.com/signed-token-123" }),
      } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records/i);
    fireEvent.change(input, { target: { value: "chest xray" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /view source/i })).toBeDefined();
    });

    const viewSourceButton = screen.getByRole("button", { name: /view source/i });
    fireEvent.click(viewSourceButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/doctors/me/patients/${patientId}/medical-documents/doc_xray_99/access?action=view`
      );
      expect(window.open).toHaveBeenCalledWith(
        "https://storage.example.com/signed-token-123",
        "_blank",
        "noopener,noreferrer"
      );
    });
  });

  it("renders empty state message when no excerpts match query", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: [] }),
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records/i);
    fireEvent.change(input, { target: { value: "rare condition xyz" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText("No matching excerpts found")).toBeDefined();
    });
  });

  it("resets search query and results when reset button is clicked", async () => {
    const mockResults = [
      {
        score: 0.9,
        content: "Excerpt content",
        documentId: "doc_1",
        documentType: "OTHER",
        reportDate: null,
        fileName: "file.txt",
        pageNumber: 1,
        chunkIndex: 0,
        patientId,
      },
    ];

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => ({ results: mockResults }),
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "query to clear" } });
    fireEvent.click(screen.getByRole("button", { name: /^search$/i }));

    await waitFor(() => {
      expect(screen.getByText("file.txt")).toBeDefined();
    });

    const resetButton = screen.getByTitle("Reset search");
    fireEvent.click(resetButton);

    expect(input.value).toBe("");
    expect(screen.queryByText("file.txt")).toBeNull();
  });
});
