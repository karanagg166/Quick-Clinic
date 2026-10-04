// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import {
  DoctorMedicalDocumentCard,
  DoctorMedicalDocument,
} from "@/components/doctor/DoctorMedicalDocumentCard";
import { MedicalRecordAccessDenied } from "@/components/doctor/MedicalRecordAccessDenied";

describe("Doctor Medical Documents Frontend Components", () => {
  const mockDoc: DoctorMedicalDocument = {
    id: "doc_test_1",
    patientId: "pat_test_1",
    title: "Comprehensive Metabolic Panel",
    type: "LAB_REPORT",
    fileName: "metabolic_panel.pdf",
    mimeType: "application/pdf",
    fileSize: 1048576, // 1 MB
    reportDate: "2026-10-01T00:00:00.000Z",
    hospitalOrDoctor: "Apollo Health",
    notes: "Fasting blood test results",
    processingStatus: "READY",
    processingError: null,
    processedAt: "2026-10-01T01:00:00.000Z",
    createdAt: "2026-10-01T00:00:00.000Z",
  };

  it("renders document metadata accurately with read-only controls", () => {
    const onView = vi.fn();
    const onDownload = vi.fn();

    render(
      <DoctorMedicalDocumentCard
        document={mockDoc}
        patientId="pat_test_1"
        onView={onView}
        onDownload={onDownload}
        isLoading={false}
      />
    );

    expect(screen.getByText("Comprehensive Metabolic Panel")).toBeDefined();
    expect(screen.getByText(/metabolic_panel\.pdf/)).toBeDefined();
    expect(screen.getByText(/1 MB/)).toBeDefined();
    expect(screen.getByText("LAB REPORT")).toBeDefined();
    expect(screen.getByText("Apollo Health")).toBeDefined();
    expect(screen.getByText("Fasting blood test results")).toBeDefined();
    expect(screen.getByText("Indexed")).toBeDefined();

    // Verify Read-Only buttons: View and Download exist, Edit/Delete do NOT exist
    const viewBtn = screen.getByRole("button", { name: /view/i });
    const downloadBtn = screen.getByRole("button", { name: /download/i });

    expect(viewBtn).toBeDefined();
    expect(downloadBtn).toBeDefined();
    expect(screen.queryByRole("button", { name: /delete/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /edit/i })).toBeNull();

    fireEvent.click(viewBtn);
    expect(onView).toHaveBeenCalledWith(mockDoc);

    fireEvent.click(downloadBtn);
    expect(onDownload).toHaveBeenCalledWith(mockDoc);
  });

  it("renders MedicalRecordAccessDenied component with security message", () => {
    render(
      <MedicalRecordAccessDenied reason="No eligible appointment on record." />
    );

    expect(screen.getByText("Medical Records Access Denied")).toBeDefined();
    expect(screen.getByText("No eligible appointment on record.")).toBeDefined();
    expect(screen.getByRole("link", { name: /return to patient roster/i })).toBeDefined();
  });
});
