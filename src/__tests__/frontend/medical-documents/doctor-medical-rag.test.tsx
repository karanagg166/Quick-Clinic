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

describe("Doctor Grounded Medical RAG Component (<DoctorMedicalSearchSection />)", () => {
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

  it("renders Ask AI button, title, and Grounded AI badge", () => {
    render(<DoctorMedicalSearchSection patientId={patientId} />);

    expect(screen.getByText(/Ask about this patient's records/i)).toBeDefined();
    expect(screen.getByText("Grounded AI")).toBeDefined();
    expect(screen.getByRole("button", { name: /ask ai/i })).toBeDefined();
  });

  it("shows toast error when question is empty and Ask AI is clicked", async () => {
    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const askAiButton = screen.getByRole("button", { name: /ask ai/i });
    fireEvent.click(askAiButton);

    expect(showToast.error).toHaveBeenCalledWith("Please enter a question");
  });

  it("executes grounded RAG question and displays answer, citations, and clinical disclaimer", async () => {
    const mockRagResponse = {
      answer: "The patient had a recorded blood pressure of 120/80 mmHg on October 1, 2026. [1]",
      citations: [
        {
          citationId: 1,
          documentId: "doc_vitals_01",
          fileName: "vitals_report.pdf",
          documentType: "LAB_REPORT",
          reportDate: "2026-10-01T00:00:00.000Z",
          pageNumber: 2,
          chunkIndex: 0,
          content: "Vitals: Blood pressure 120/80 mmHg, pulse 72 bpm regular.",
          score: 0.95,
        },
      ],
      resultCount: 1,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockRagResponse,
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records or ask AI/i);
    fireEvent.change(input, { target: { value: "What was the blood pressure?" } });

    const askAiButton = screen.getByRole("button", { name: /ask ai/i });
    fireEvent.click(askAiButton);

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/doctors/me/patients/${patientId}/medical-answer`,
        expect.objectContaining({
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: "What was the blood pressure?", limit: 8 }),
        })
      );
    });

    await waitFor(() => {
      // Check grounded answer text
      expect(screen.getByText(/The patient had a recorded blood pressure of 120\/80 mmHg/)).toBeDefined();
      // Check disclaimer
      expect(
        screen.getByText(/Answers are generated from the patient's uploaded medical records and may require clinical verification/i)
      ).toBeDefined();
      // Check source citation metadata
      expect(screen.getByText("[1]")).toBeDefined();
      expect(screen.getByText("vitals_report.pdf")).toBeDefined();
      expect(screen.getByText("p. 2")).toBeDefined();
      expect(screen.getByRole("button", { name: /view source/i })).toBeDefined();
    });
  });

  it("opens signed document link when 'View Source' is clicked from citation", async () => {
    const mockRagResponse = {
      answer: "Normal chest radiograph documented on Sept 20, 2026. [1]",
      citations: [
        {
          citationId: 1,
          documentId: "doc_xray_99",
          fileName: "chest_xray.pdf",
          documentType: "RADIOLOGY_SCAN",
          reportDate: "2026-09-20T00:00:00.000Z",
          pageNumber: 1,
          chunkIndex: 0,
          content: "Lungs are clear bilaterally.",
          score: 0.9,
        },
      ],
      resultCount: 1,
    };

    global.fetch = vi
      .fn()
      // First fetch: RAG answer
      .mockResolvedValueOnce({
        ok: true,
        json: async () => mockRagResponse,
      } as any)
      // Second fetch: view source signed URL
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://storage.example.com/signed-url-for-doc-99" }),
      } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records or ask AI/i);
    fireEvent.change(input, { target: { value: "Chest x-ray results" } });

    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /view source/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole("button", { name: /view source/i }));

    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        `/api/doctors/me/patients/${patientId}/medical-documents/doc_xray_99/access?action=view`
      );
      expect(window.open).toHaveBeenCalledWith(
        "https://storage.example.com/signed-url-for-doc-99",
        "_blank",
        "noopener,noreferrer"
      );
    });
  });

  it("toggles expandable supporting evidence excerpts when clicked", async () => {
    const mockRagResponse = {
      answer: "Serum glucose was 95 mg/dL. [1]",
      citations: [
        {
          citationId: 1,
          documentId: "doc_glucose_1",
          fileName: "metabolic_panel.pdf",
          documentType: "LAB_REPORT",
          reportDate: "2026-10-02T00:00:00.000Z",
          pageNumber: 1,
          chunkIndex: 0,
          content: "Fasting Glucose: 95 mg/dL (Reference: 70-99)",
          score: 0.98,
        },
      ],
      resultCount: 1,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockRagResponse,
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records or ask AI/i);
    fireEvent.change(input, { target: { value: "glucose level" } });
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

    await waitFor(() => {
      expect(screen.getByText("Show Supporting Evidence")).toBeDefined();
    });

    // Evidence content initially hidden
    expect(screen.queryByText(/Fasting Glucose: 95 mg\/dL/)).toBeNull();

    // Click to show evidence
    fireEvent.click(screen.getByText("Show Supporting Evidence"));

    await waitFor(() => {
      expect(screen.getByText(/Fasting Glucose: 95 mg\/dL/)).toBeDefined();
      expect(screen.getByText("Hide Supporting Evidence")).toBeDefined();
    });

    // Click to hide evidence
    fireEvent.click(screen.getByText("Hide Supporting Evidence"));

    await waitFor(() => {
      expect(screen.queryByText(/Fasting Glucose: 95 mg\/dL/)).toBeNull();
    });
  });

  it("shows error toast when RAG generation endpoint fails", async () => {
    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: false,
      json: async () => ({ error: "AI service temporarily unavailable" }),
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records or ask AI/i);
    fireEvent.change(input, { target: { value: "What are the allergies?" } });
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

    await waitFor(() => {
      expect(showToast.error).toHaveBeenCalledWith("AI service temporarily unavailable");
    });
  });

  it("resets RAG answer and citations when reset button is clicked", async () => {
    const mockRagResponse = {
      answer: "Sample RAG answer to be cleared.",
      citations: [
        {
          citationId: 1,
          documentId: "doc_1",
          fileName: "sample.pdf",
          documentType: "OTHER",
          reportDate: null,
          pageNumber: 1,
          chunkIndex: 0,
          content: "Sample excerpt",
          score: 0.9,
        },
      ],
      resultCount: 1,
    };

    global.fetch = vi.fn().mockResolvedValueOnce({
      ok: true,
      json: async () => mockRagResponse,
    } as any);

    render(<DoctorMedicalSearchSection patientId={patientId} />);

    const input = screen.getByPlaceholderText(/Search this patient's medical records or ask AI/i) as HTMLInputElement;
    fireEvent.change(input, { target: { value: "test query" } });
    fireEvent.click(screen.getByRole("button", { name: /ask ai/i }));

    await waitFor(() => {
      expect(screen.getByText("Sample RAG answer to be cleared.")).toBeDefined();
    });

    const resetButton = screen.getByTitle("Reset search");
    fireEvent.click(resetButton);

    expect(input.value).toBe("");
    expect(screen.queryByText("Sample RAG answer to be cleared.")).toBeNull();
  });
});
