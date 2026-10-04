"use client";

import React from "react";
import {
  FileText,
  Calendar,
  Clock,
  Building2,
  Eye,
  Download,
  MoreVertical,
  Pencil,
  Trash2,
  FileCheck,
  RotateCw,
  Sparkles,
  AlertCircle,
  Loader2,
} from "lucide-react";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  MedicalDocument,
  DOCUMENT_TYPE_LABELS,
  DOCUMENT_TYPE_BADGE_CLASSES,
  PROCESSING_STATUS_LABELS,
  PROCESSING_STATUS_BADGE_CLASSES,
  formatFileSize,
  formatDisplayDate,
  isPdfDocument,
  isImageDocument,
} from "@/types/medical-document";

interface MedicalDocumentCardProps {
  document: MedicalDocument;
  onView: (doc: MedicalDocument) => void;
  onDownload: (doc: MedicalDocument) => void;
  onRename: (doc: MedicalDocument) => void;
  onDelete: (doc: MedicalDocument) => void;
  onRetryProcessing?: (doc: MedicalDocument) => void;
  isRetrying?: boolean;
}

export function MedicalDocumentCard({
  document,
  onView,
  onDownload,
  onRename,
  onDelete,
  onRetryProcessing,
  isRetrying,
}: MedicalDocumentCardProps) {
  const isPdf = isPdfDocument(document.fileName, document.mimeType);
  const isImage = isImageDocument(document.fileName, document.mimeType);
  const categoryLabel = DOCUMENT_TYPE_LABELS[document.type] || "Document";
  const badgeClass =
    DOCUMENT_TYPE_BADGE_CLASSES[document.type] ||
    "bg-muted text-muted-foreground";

  const fileExtension =
    document.fileName.split(".").pop()?.toUpperCase() ||
    (isPdf ? "PDF" : "FILE");

  return (
    <Card className="group overflow-hidden border shadow-xs hover:shadow-md transition-all duration-200 flex flex-col justify-between bg-card">
      <div>
        {/* Preview Area */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => onView(document)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onView(document);
            }
          }}
          className="relative h-44 w-full bg-muted/40 cursor-pointer overflow-hidden border-b flex items-center justify-center select-none group/preview"
          aria-label={`Preview ${document.title}`}
        >
          {isImage && document.previewUrl ? (
            <div className="relative w-full h-full">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={document.previewUrl}
                alt={document.title}
                className="w-full h-full object-cover transition-transform duration-300 group-hover/preview:scale-105"
              />
              <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/25 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover/preview:opacity-100 transition-opacity duration-200 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/90 text-foreground text-xs font-medium shadow-sm backdrop-blur-xs">
                  <Eye className="w-3.5 h-3.5" /> Click to preview
                </span>
              </div>
            </div>
          ) : isPdf ? (
            <div className="relative w-full h-full flex flex-col items-center justify-center p-4 bg-linear-to-b from-rose-500/5 via-background to-muted/30">
              {/* Decorative document mockup */}
              <div className="w-24 h-28 rounded-md border border-rose-200 dark:border-rose-900/40 bg-card shadow-xs flex flex-col items-center justify-center p-2 transition-transform duration-200 group-hover/preview:scale-105">
                <div className="w-8 h-8 rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400 flex items-center justify-center mb-2">
                  <FileText className="w-4 h-4" />
                </div>
                <div className="w-14 h-1.5 bg-muted rounded mb-1" />
                <div className="w-10 h-1 bg-muted/70 rounded mb-1" />
                <div className="w-12 h-1 bg-muted/50 rounded" />
                <Badge
                  variant="outline"
                  className="mt-2 text-[10px] font-bold text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-800 px-1.5 py-0"
                >
                  PDF
                </Badge>
              </div>

              <div className="absolute inset-0 bg-black/0 group-hover/preview:bg-black/15 transition-colors flex items-center justify-center">
                <span className="opacity-0 group-hover/preview:opacity-100 transition-opacity duration-200 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-background/90 text-foreground text-xs font-medium shadow-sm backdrop-blur-xs">
                  <Eye className="w-3.5 h-3.5" /> View document
                </span>
              </div>
            </div>
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center p-4 bg-muted/20">
              <FileCheck className="w-10 h-10 text-muted-foreground/60 mb-2" />
              <span className="text-xs text-muted-foreground font-medium uppercase">
                {fileExtension}
              </span>
            </div>
          )}

          {/* Quick format chip in corner */}
          <div className="absolute top-2.5 left-2.5 pointer-events-none">
            <span className="text-[11px] font-semibold tracking-wider px-2 py-0.5 rounded-sm bg-background/80 dark:bg-background/90 text-foreground backdrop-blur-xs border shadow-2xs">
              {fileExtension}
            </span>
          </div>
        </div>

        {/* Content */}
        <CardHeader className="p-4 pb-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <h3
                className="font-semibold text-base text-foreground leading-snug truncate"
                title={document.title}
              >
                {document.title}
              </h3>
              <p
                className="text-xs text-muted-foreground truncate mt-0.5"
                title={document.fileName}
              >
                {document.fileName}
              </p>
            </div>

            {/* More Menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground hover:text-foreground shrink-0 -mr-2 -mt-1"
                  aria-label={`Actions for ${document.title}`}
                >
                  <MoreVertical className="w-4 h-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <DropdownMenuItem onClick={() => onView(document)}>
                  <Eye className="w-4 h-4 mr-2" /> Preview
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onDownload(document)}>
                  <Download className="w-4 h-4 mr-2" /> Download
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onRename(document)}>
                  <Pencil className="w-4 h-4 mr-2" /> Rename
                </DropdownMenuItem>
                {document.processingStatus === "FAILED" && onRetryProcessing && (
                  <DropdownMenuItem
                    onClick={() => onRetryProcessing(document)}
                    disabled={isRetrying}
                  >
                    <RotateCw className={`w-4 h-4 mr-2 ${isRetrying ? "animate-spin" : ""}`} /> Retry Processing
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onClick={() => onDelete(document)}
                >
                  <Trash2 className="w-4 h-4 mr-2 text-destructive" /> Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-2.5">
            <Badge
              variant="outline"
              className={`text-[11px] font-medium border px-2 py-0.5 ${badgeClass}`}
            >
              {categoryLabel}
            </Badge>

            {document.processingStatus && (
              <Badge
                variant="outline"
                className={`text-[11px] font-medium border px-2 py-0.5 inline-flex items-center gap-1 ${
                  PROCESSING_STATUS_BADGE_CLASSES[document.processingStatus] || ""
                }`}
                title={document.processingError || undefined}
              >
                {document.processingStatus === "READY" ? (
                  <Sparkles className="w-3 h-3 text-emerald-600 dark:text-emerald-400" />
                ) : document.processingStatus === "FAILED" ? (
                  <AlertCircle className="w-3 h-3 text-rose-600 dark:text-rose-400" />
                ) : (
                  <Loader2 className="w-3 h-3 animate-spin text-blue-600 dark:text-blue-400" />
                )}
                {PROCESSING_STATUS_LABELS[document.processingStatus]}
              </Badge>
            )}

            <span className="text-[11px] text-muted-foreground ml-auto">
              {formatFileSize(document.fileSize)}
            </span>
          </div>
        </CardHeader>

        <CardContent className="p-4 pt-1 pb-3 space-y-1.5 text-xs text-muted-foreground">
          <div className="flex items-center gap-1.5 truncate">
            <Calendar className="w-3.5 h-3.5 shrink-0 text-muted-foreground/80" />
            <span className="truncate">
              Reported:{" "}
              <strong className="font-medium text-foreground/80">
                {formatDisplayDate(document.reportDate)}
              </strong>
            </span>
          </div>

          <div className="flex items-center gap-1.5 truncate">
            <Clock className="w-3.5 h-3.5 shrink-0 text-muted-foreground/80" />
            <span className="truncate">
              Uploaded: {formatDisplayDate(document.uploadedAt)}
            </span>
          </div>

          {document.hospitalOrDoctor && (
            <div className="flex items-center gap-1.5 truncate">
              <Building2 className="w-3.5 h-3.5 shrink-0 text-muted-foreground/80" />
              <span className="truncate" title={document.hospitalOrDoctor}>
                {document.hospitalOrDoctor}
              </span>
            </div>
          )}
        </CardContent>
      </div>

      {/* Card Actions */}
      <CardFooter className="p-4 pt-2 border-t bg-muted/15 flex items-center justify-between gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onView(document)}
          className="flex-1 text-xs gap-1.5 h-8 font-medium"
        >
          <Eye className="w-3.5 h-3.5" /> View
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDownload(document)}
          className="text-xs gap-1.5 h-8 text-muted-foreground hover:text-foreground font-medium"
          aria-label={`Download ${document.title}`}
        >
          <Download className="w-3.5 h-3.5" /> Download
        </Button>
      </CardFooter>
    </Card>
  );
}
