"use client";

import React, { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeft,
  Upload,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MedicalDocumentUploadZone } from "@/components/patient/medical-documents/MedicalDocumentUploadZone";
import {
  MedicalDocumentType,
} from "@/types/medical-document";

interface FormErrors {
  file?: string;
  title?: string;
  type?: string;
  reportDate?: string;
}

export default function UploadMedicalDocumentPage() {
  const router = useRouter();

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [documentType, setDocumentType] = useState<MedicalDocumentType | "">("");
  const [reportDate, setReportDate] = useState("");
  const [hospitalOrDoctor, setHospitalOrDoctor] = useState("");
  const [notes, setNotes] = useState("");

  const [errors, setErrors] = useState<FormErrors>({});
  const [isUploading, setIsUploading] = useState(false);

  // Auto-fill title with file name without extension if empty
  const handleFileSelect = (file: File | null) => {
    setSelectedFile(file);
    if (file && !title.trim()) {
      const cleanName = file.name.replace(/\.[^/.]+$/, "");
      setTitle(cleanName);
      setErrors((prev) => ({ ...prev, title: undefined, file: undefined }));
    } else if (!file) {
      setErrors((prev) => ({ ...prev, file: undefined }));
    }
  };

  const validate = (): boolean => {
    const newErrors: FormErrors = {};

    if (!selectedFile) {
      newErrors.file = "Please select a medical document to upload.";
    }

    if (!title.trim()) {
      newErrors.title = "Document title is required.";
    }

    if (!documentType) {
      newErrors.type = "Please select a document type.";
    }

    if (!reportDate) {
      newErrors.reportDate =
        "Please select the date when the medical report/test was created.";
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      toast.error("Please fill in all required fields.");
      return;
    }

    setIsUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", selectedFile!);
      formData.append("title", title.trim());
      formData.append("type", documentType);
      formData.append("reportDate", reportDate);
      if (hospitalOrDoctor.trim()) {
        formData.append("hospitalOrDoctor", hospitalOrDoctor.trim());
      }
      if (notes.trim()) {
        formData.append("notes", notes.trim());
      }

      const res = await fetch("/api/patients/me/medical-documents", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to upload document");
      }

      toast.success("Medical document uploaded successfully!");
      router.push("/patient/medical-documents");
    } catch (err: any) {
      toast.error(err.message || "Failed to upload medical document");
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-6 max-w-4xl mx-auto">
      {/* Back button */}
      <div>
        <Button variant="ghost" size="sm" asChild className="gap-1.5" disabled={isUploading}>
          <Link href="/patient/medical-documents">
            <ArrowLeft className="w-4 h-4" /> Back to Medical Documents
          </Link>
        </Button>
      </div>

      {/* Header */}
      <div>
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
            <Upload className="w-5 h-5" />
          </div>
          <div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
              Upload Medical Document
            </h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground mt-1.5">
          Upload medical reports, prescriptions, scans, and other health
          records securely.
        </p>
      </div>

      {/* Form View */}
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Step 1: Upload File */}
        <Card className="border shadow-xs bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold">
              1. Select Document File
            </CardTitle>
            <CardDescription className="text-xs">
              Choose a PDF report or medical image (JPG, PNG, WebP) up to 10
              MB.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <MedicalDocumentUploadZone
              selectedFile={selectedFile}
              onFileSelect={handleFileSelect}
              error={fileError || errors.file}
              onErrorChange={(err) => {
                setFileError(err);
                if (!err && errors.file) {
                  setErrors((prev) => ({ ...prev, file: undefined }));
                }
              }}
            />
          </CardContent>
        </Card>

        {/* Step 2: Metadata */}
        <Card className="border shadow-xs bg-card">
          <CardHeader className="pb-4">
            <CardTitle className="text-base font-semibold">
              2. Document Information
            </CardTitle>
            <CardDescription className="text-xs">
              Add medical report details to help organize and reference your
              health records.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Document Title (Required) */}
            <div className="space-y-1.5">
              <Label htmlFor="doc-title" className="text-xs font-semibold">
                Document Title <span className="text-destructive">*</span>
              </Label>
              <Input
                id="doc-title"
                value={title}
                disabled={isUploading}
                onChange={(e) => {
                  setTitle(e.target.value);
                  if (errors.title) {
                    setErrors((prev) => ({ ...prev, title: undefined }));
                  }
                }}
                placeholder="e.g. Blood Test - September 2026"
                className={errors.title ? "border-destructive" : ""}
              />
              {errors.title && (
                <p className="text-xs text-destructive">{errors.title}</p>
              )}
            </div>

            {/* Document Type (Required) & Report Date (Required) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="doc-type" className="text-xs font-semibold">
                  Document Type <span className="text-destructive">*</span>
                </Label>
                <Select
                  value={documentType}
                  disabled={isUploading}
                  onValueChange={(val) => {
                    setDocumentType(val as MedicalDocumentType);
                    if (errors.type) {
                      setErrors((prev) => ({ ...prev, type: undefined }));
                    }
                  }}
                >
                  <SelectTrigger
                    id="doc-type"
                    className={`w-full ${
                      errors.type ? "border-destructive" : ""
                    }`}
                  >
                    <SelectValue placeholder="Select document type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="LAB_REPORT">Lab Report</SelectItem>
                    <SelectItem value="PRESCRIPTION">
                      Prescription
                    </SelectItem>
                    <SelectItem value="RADIOLOGY_SCAN">
                      Radiology / Scan
                    </SelectItem>
                    <SelectItem value="DISCHARGE_SUMMARY">
                      Discharge Summary
                    </SelectItem>
                    <SelectItem value="MEDICAL_CERTIFICATE">
                      Medical Certificate
                    </SelectItem>
                    <SelectItem value="VACCINATION_RECORD">
                      Vaccination Record
                    </SelectItem>
                    <SelectItem value="OTHER">Other</SelectItem>
                  </SelectContent>
                </Select>
                {errors.type && (
                  <p className="text-xs text-destructive">{errors.type}</p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label
                  htmlFor="doc-report-date"
                  className="text-xs font-semibold"
                >
                  Report Date <span className="text-destructive">*</span>
                </Label>
                <div className="relative">
                  <Input
                    id="doc-report-date"
                    type="date"
                    disabled={isUploading}
                    value={reportDate}
                    onChange={(e) => {
                      setReportDate(e.target.value);
                      if (errors.reportDate) {
                        setErrors((prev) => ({
                          ...prev,
                          reportDate: undefined,
                        }));
                      }
                    }}
                    className={errors.reportDate ? "border-destructive" : ""}
                  />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Date when the test was performed or report was issued.
                </p>
                {errors.reportDate && (
                  <p className="text-xs text-destructive">
                    {errors.reportDate}
                  </p>
                )}
              </div>
            </div>

            {/* Doctor / Hospital (Optional) */}
            <div className="space-y-1.5">
              <Label
                htmlFor="doc-hospital"
                className="text-xs font-semibold flex items-center justify-between"
              >
                <span>Doctor / Hospital</span>
                <span className="text-muted-foreground font-normal text-[11px]">
                  Optional
                </span>
              </Label>
              <div className="relative">
                <Input
                  id="doc-hospital"
                  disabled={isUploading}
                  value={hospitalOrDoctor}
                  onChange={(e) => setHospitalOrDoctor(e.target.value)}
                  placeholder="e.g. Apollo Hospital or Dr. Sharma"
                />
              </div>
            </div>

            {/* Notes (Optional) */}
            <div className="space-y-1.5">
              <Label
                htmlFor="doc-notes"
                className="text-xs font-semibold flex items-center justify-between"
              >
                <span>Notes & Observations</span>
                <span className="text-muted-foreground font-normal text-[11px]">
                  Optional
                </span>
              </Label>
              <Textarea
                id="doc-notes"
                disabled={isUploading}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="e.g. Annual health checkup blood report, doctor advised re-test in 6 months."
                rows={3}
              />
            </div>
          </CardContent>
        </Card>

        {/* Form Submit Buttons */}
        <div className="flex flex-col-reverse sm:flex-row items-center justify-end gap-3 pt-2">
          <Button
            type="button"
            variant="outline"
            asChild
            disabled={isUploading}
            className="w-full sm:w-auto"
          >
            <Link href="/patient/medical-documents">Cancel</Link>
          </Button>
          <Button
            type="submit"
            disabled={isUploading}
            className="w-full sm:w-auto gap-2"
          >
            {isUploading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" /> Uploading...
              </>
            ) : (
              <>
                <Upload className="w-4 h-4" /> Upload Document
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
