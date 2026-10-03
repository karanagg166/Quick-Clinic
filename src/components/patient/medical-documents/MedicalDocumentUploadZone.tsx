"use client";

import React, { useRef, useState, useEffect } from "react";
import {
  UploadCloud,
  FileText,
  Trash2,
  RefreshCw,
  ShieldCheck,
  AlertCircle,
  FileCheck2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { formatFileSize } from "@/types/medical-document";

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10 MB
const ALLOWED_MIME_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
];
const ALLOWED_EXTENSIONS = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];

interface MedicalDocumentUploadZoneProps {
  selectedFile: File | null;
  onFileSelect: (file: File | null) => void;
  error?: string | null;
  onErrorChange?: (err: string | null) => void;
}

function ImageFilePreview({ file }: { file: File }) {
  const previewUrl = React.useMemo(() => {
    return URL.createObjectURL(file);
  }, [file]);

  useEffect(() => {
    return () => {
      URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={previewUrl}
      alt={file.name}
      className="w-full h-full object-cover"
    />
  );
}

export function MedicalDocumentUploadZone({
  selectedFile,
  onFileSelect,
  error,
  onErrorChange,
}: MedicalDocumentUploadZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const validateAndSetFile = (file: File) => {
    // 1. File size check
    if (file.size > MAX_FILE_SIZE_BYTES) {
      const err = `File size (${formatFileSize(
        file.size
      )}) exceeds the 10 MB limit. Please select a smaller file.`;
      onErrorChange?.(err);
      return;
    }

    // 2. Type validation
    const ext = `.${file.name.split(".").pop()?.toLowerCase()}`;
    const isValidType =
      ALLOWED_MIME_TYPES.includes(file.type.toLowerCase()) ||
      ALLOWED_EXTENSIONS.includes(ext);

    if (!isValidType) {
      const err =
        "Invalid file format. Please upload a PDF, JPG, JPEG, PNG, or WebP document.";
      onErrorChange?.(err);
      return;
    }

    // Success
    onErrorChange?.(null);
    onFileSelect(file);
  };

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      validateAndSetFile(files[0]);
    }
  };

  const handleRemoveFile = () => {
    onFileSelect(null);
    onErrorChange?.(null);
    if (inputRef.current) {
      inputRef.current.value = "";
    }
  };

  const isPdf =
    selectedFile?.type === "application/pdf" ||
    selectedFile?.name.toLowerCase().endsWith(".pdf");

  const isImage = selectedFile?.type.startsWith("image/");

  return (
    <div className="space-y-3">
      {/* Hidden File Input */}
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.jpg,.jpeg,.png,.webp,application/pdf,image/jpeg,image/png,image/webp"
        onChange={handleFileInputChange}
        className="sr-only"
        id="medical-document-file-input"
        data-testid="medical-document-file-input"
      />

      {!selectedFile ? (
        /* Empty Dropzone */
        <div
          onDragEnter={handleDragEnter}
          onDragLeave={handleDragLeave}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          role="button"
          tabIndex={0}
          aria-label="Upload document dropzone"
          className={`relative border-2 border-dashed rounded-xl p-8 sm:p-12 text-center cursor-pointer transition-all duration-200 select-none ${
            isDragging
              ? "border-primary bg-primary/5 scale-[1.005]"
              : "border-border hover:border-primary/50 hover:bg-muted/30 bg-card"
          }`}
        >
          <div className="flex flex-col items-center justify-center max-w-sm mx-auto space-y-3">
            <div
              className={`w-14 h-14 rounded-full flex items-center justify-center transition-colors ${
                isDragging
                  ? "bg-primary/20 text-primary"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              <UploadCloud className="w-7 h-7" />
            </div>

            <div className="space-y-1">
              <p className="font-semibold text-base text-foreground">
                Drag and drop your medical file here
              </p>
              <p className="text-sm text-muted-foreground">
                or{" "}
                <span className="text-primary font-medium underline underline-offset-2">
                  click to browse
                </span>
              </p>
            </div>

            <div className="pt-2">
              <Badge
                variant="secondary"
                className="text-xs font-normal text-muted-foreground"
              >
                PDF, JPG, JPEG, PNG, WebP (Max 10 MB)
              </Badge>
            </div>
          </div>
        </div>
      ) : (
        /* Selected File Card Preview */
        <div className="border rounded-xl p-4 sm:p-6 bg-card space-y-4">
          <div className="flex flex-col sm:flex-row items-center gap-4">
            {/* Visual Thumbnail */}
            <div className="relative w-28 h-28 sm:w-32 sm:h-32 shrink-0 rounded-lg border bg-muted/30 overflow-hidden flex items-center justify-center shadow-xs">
              {isImage ? (
                <ImageFilePreview file={selectedFile} />
              ) : isPdf ? (
                <div className="flex flex-col items-center justify-center p-2 text-center">
                  <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-1">
                    <FileText className="w-5 h-5" />
                  </div>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-bold text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900"
                  >
                    PDF
                  </Badge>
                </div>
              ) : (
                <FileCheck2 className="w-8 h-8 text-primary" />
              )}
            </div>

            {/* File Info */}
            <div className="flex-1 min-w-0 space-y-2 text-center sm:text-left w-full">
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                <Badge variant="outline" className="text-xs">
                  {selectedFile.type || "Document"}
                </Badge>
                <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                  Ready to upload
                </span>
              </div>

              <div>
                <p
                  className="font-semibold text-base text-foreground break-all"
                  title={selectedFile.name}
                >
                  {selectedFile.name}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Size: {formatFileSize(selectedFile.size)} • Type:{" "}
                  {selectedFile.type || "Unknown"}
                </p>
              </div>

              {/* Action Buttons */}
              <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => inputRef.current?.click()}
                  className="h-8 text-xs gap-1.5"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Change File
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleRemoveFile}
                  className="h-8 text-xs gap-1.5 text-destructive hover:text-destructive hover:bg-destructive/10"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Validation Error Message */}
      {error && (
        <div
          role="alert"
          className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 text-destructive text-xs border border-destructive/20"
        >
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Security notice */}
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <ShieldCheck className="w-4 h-4 text-muted-foreground/80 shrink-0" />
        <span>
          Your medical documents are private and will only be accessible to
          authorized users.
        </span>
      </div>
    </div>
  );
}
