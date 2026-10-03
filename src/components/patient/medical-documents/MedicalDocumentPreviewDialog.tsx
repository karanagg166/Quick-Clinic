"use client";

import React from "react";
import {
  FileText,
  Calendar,
  Clock,
  Building2,
  Download,
  Info,
  ExternalLink,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  MedicalDocument,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_BADGE_CLASSES,
  formatFileSize,
  formatDisplayDate,
  isPdfDocument,
  isImageDocument,
} from "@/types/medical-document";

interface MedicalDocumentPreviewDialogProps {
  document: MedicalDocument | null;
  isOpen: boolean;
  onClose: () => void;
  onDownload: (doc: MedicalDocument) => void;
}

export function MedicalDocumentPreviewDialog({
  document,
  isOpen,
  onClose,
  onDownload,
}: MedicalDocumentPreviewDialogProps) {
  if (!document) return null;

  const isPdf = isPdfDocument(document.fileName, document.mimeType);
  const isImage = isImageDocument(document.fileName, document.mimeType);
  const categoryLabel = DOCUMENT_TYPE_LABELS[document.type] || "Document";
  const badgeClass =
    DOCUMENT_TYPE_BADGE_CLASSES[document.type] ||
    "bg-muted text-muted-foreground";

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto p-6">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 mb-1.5">
            <Badge
              variant="outline"
              className={`text-xs font-medium border px-2 py-0.5 ${badgeClass}`}
            >
              {categoryLabel}
            </Badge>
            <Badge variant="secondary" className="text-xs">
              {document.fileName.split(".").pop()?.toUpperCase() || "FILE"}
            </Badge>
            <span className="text-xs text-muted-foreground">
              {formatFileSize(document.fileSize)}
            </span>
          </div>

          <DialogTitle className="text-xl font-bold break-words text-left">
            {document.title}
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground text-left break-all">
            {document.fileName}
          </DialogDescription>
        </DialogHeader>

        {/* Preview Container */}
        <div className="my-3 rounded-lg border bg-muted/20 overflow-hidden flex items-center justify-center p-4 min-h-[260px]">
          {isImage && document.previewUrl ? (
            <div className="w-full flex flex-col items-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={document.previewUrl}
                alt={document.title}
                className="max-h-[50vh] w-auto max-w-full rounded-md object-contain shadow-xs border"
              />
              <p className="text-[11px] text-muted-foreground mt-2">
                High-resolution image preview
              </p>
            </div>
          ) : isPdf ? (
            <div className="w-full flex flex-col items-center justify-center py-8 px-4 text-center max-w-md mx-auto">
              <div className="w-20 h-24 rounded-lg border border-rose-200 dark:border-rose-900 bg-card shadow-sm flex flex-col items-center justify-center p-3 mb-4">
                <div className="w-10 h-10 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-2">
                  <FileText className="w-5 h-5" />
                </div>
                <Badge
                  variant="outline"
                  className="text-[10px] font-bold text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800"
                >
                  PDF
                </Badge>
              </div>

              <h4 className="font-semibold text-sm text-foreground mb-1">
                {document.fileName}
              </h4>
              <p className="text-xs text-muted-foreground mb-4">
                {formatFileSize(document.fileSize)} • Ready for viewing and download
              </p>

              {document.previewUrl ? (
                <div className="flex flex-col items-center gap-2">
                  <Button variant="default" size="sm" asChild className="gap-2">
                    <a
                      href={document.previewUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="w-4 h-4" /> Open PDF in New Tab
                    </a>
                  </Button>
                </div>
              ) : (
                <div className="inline-flex items-center gap-2 p-2.5 rounded-md bg-muted/60 text-muted-foreground text-xs text-left">
                  <Info className="w-4 h-4 shrink-0 text-primary" />
                  <span>
                    PDF preview mode. Loading secure preview link...
                  </span>
                </div>
              )}
            </div>
          ) : (
            <div className="text-center py-8">
              <FileText className="w-12 h-12 text-muted-foreground/60 mx-auto mb-2" />
              <p className="text-sm font-medium">{document.fileName}</p>
              <p className="text-xs text-muted-foreground">
                {formatFileSize(document.fileSize)}
              </p>
            </div>
          )}
        </div>

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs border rounded-lg p-3.5 bg-card">
          <div className="space-y-1">
            <span className="text-muted-foreground block">Report Date</span>
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground" />
              {formatDisplayDate(document.reportDate)}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground block">Uploaded Date</span>
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Clock className="w-3.5 h-3.5 text-muted-foreground" />
              {formatDisplayDate(document.uploadedAt)}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground block">Doctor / Hospital</span>
            <div className="flex items-center gap-1.5 font-medium text-foreground">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground" />
              {document.hospitalOrDoctor || "Not specified"}
            </div>
          </div>

          <div className="space-y-1">
            <span className="text-muted-foreground block">MIME Type</span>
            <div className="font-mono text-muted-foreground">
              {document.mimeType}
            </div>
          </div>
        </div>

        {/* Notes Section if available */}
        {document.notes && (
          <div className="text-xs border rounded-lg p-3.5 bg-card space-y-1">
            <span className="text-muted-foreground font-medium block">
              Notes & Summary
            </span>
            <p className="text-foreground/90 leading-relaxed whitespace-pre-wrap">
              {document.notes}
            </p>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0 mt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onDownload(document)}
            className="gap-1.5"
          >
            <Download className="w-4 h-4" /> Download File
          </Button>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
