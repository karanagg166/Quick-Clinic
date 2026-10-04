"use client";

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import {
  FileText,
  Calendar,
  Building2,
  Eye,
  Download,
  FileCheck2,
  Clock,
  AlertCircle,
  Loader2,
  FileSpreadsheet,
  FileCode,
} from "lucide-react";

export interface DoctorMedicalDocument {
  id: string;
  patientId: string;
  title: string;
  type: string;
  fileName: string;
  mimeType: string;
  fileSize: number;
  reportDate: string;
  hospitalOrDoctor?: string | null;
  notes?: string | null;
  processingStatus: "PENDING" | "QUEUED" | "PROCESSING" | "READY" | "FAILED";
  processingError?: string | null;
  processedAt?: string | null;
  createdAt: string;
}

interface DoctorMedicalDocumentCardProps {
  document: DoctorMedicalDocument;
  patientId: string;
  onView: (doc: DoctorMedicalDocument) => void;
  onDownload: (doc: DoctorMedicalDocument) => void;
  isLoading: boolean;
}

export function DoctorMedicalDocumentCard({
  document,
  onView,
  onDownload,
  isLoading,
}: DoctorMedicalDocumentCardProps) {
  const formatBytes = (bytes: number) => {
    if (bytes === 0) return "0 Bytes";
    const k = 1024;
    const sizes = ["Bytes", "KB", "MB", "GB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  const getTypeBadgeVariant = (type: string) => {
    switch (type) {
      case "LAB_REPORT":
        return "bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-400 border-blue-200 dark:border-blue-900";
      case "PRESCRIPTION":
        return "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40 dark:text-emerald-400 border-emerald-200 dark:border-emerald-900";
      case "RADIOLOGY_SCAN":
        return "bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-400 border-purple-200 dark:border-purple-900";
      case "DISCHARGE_SUMMARY":
        return "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-400 border-amber-200 dark:border-amber-900";
      default:
        return "bg-muted text-muted-foreground border-border";
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case "READY":
        return (
          <Badge variant="outline" className="bg-emerald-50 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-400 border-emerald-300 text-[10px] gap-1">
            <FileCheck2 className="w-3 h-3" /> Indexed
          </Badge>
        );
      case "PROCESSING":
      case "QUEUED":
        return (
          <Badge variant="outline" className="bg-amber-50 dark:bg-amber-950/30 text-amber-700 dark:text-amber-400 border-amber-300 text-[10px] gap-1">
            <Clock className="w-3 h-3 animate-spin" /> Processing
          </Badge>
        );
      case "FAILED":
        return (
          <Badge variant="outline" className="bg-rose-50 dark:bg-rose-950/30 text-rose-700 dark:text-rose-400 border-rose-300 text-[10px] gap-1">
            <AlertCircle className="w-3 h-3" /> Raw Only
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="text-[10px] gap-1 text-muted-foreground">
            <Clock className="w-3 h-3" /> Pending
          </Badge>
        );
    }
  };

  const isPdf = document.mimeType.includes("pdf");

  return (
    <Card className="hover:shadow-md transition-all duration-200 border bg-card flex flex-col justify-between overflow-hidden">
      <CardHeader className="p-4 pb-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
              isPdf
                ? "bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-400"
                : "bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-400"
            }`}>
              {isPdf ? <FileText className="w-5 h-5" /> : <FileSpreadsheet className="w-5 h-5" />}
            </div>
            <div className="min-w-0">
              <h4 className="font-semibold text-sm text-foreground truncate" title={document.title}>
                {document.title}
              </h4>
              <p className="text-[11px] text-muted-foreground truncate">
                {document.fileName} • {formatBytes(document.fileSize)}
              </p>
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            <Badge variant="outline" className={`text-[10px] font-medium border ${getTypeBadgeVariant(document.type)}`}>
              {document.type.replace(/_/g, " ")}
            </Badge>
            {getStatusBadge(document.processingStatus)}
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-1 space-y-3 text-xs">
        <div className="grid grid-cols-2 gap-2 text-muted-foreground pt-2 border-t">
          <div className="flex items-center gap-1.5 truncate">
            <Calendar className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate">
              {document.reportDate ? format(new Date(document.reportDate), "MMM d, yyyy") : "No date"}
            </span>
          </div>

          <div className="flex items-center gap-1.5 truncate">
            <Building2 className="w-3.5 h-3.5 text-primary shrink-0" />
            <span className="truncate" title={document.hospitalOrDoctor || "Unspecified"}>
              {document.hospitalOrDoctor || "Unspecified"}
            </span>
          </div>
        </div>

        {document.notes && (
          <p className="text-[11px] text-muted-foreground bg-muted/30 p-2 rounded-lg line-clamp-2 border">
            {document.notes}
          </p>
        )}

        {/* Read-only Action Buttons */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t">
          <Button
            size="sm"
            variant="outline"
            disabled={isLoading}
            onClick={() => onView(document)}
            className="text-xs font-semibold gap-1.5 h-8 rounded-lg"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5 text-primary" />}
            View
          </Button>

          <Button
            size="sm"
            variant="secondary"
            disabled={isLoading}
            onClick={() => onDownload(document)}
            className="text-xs font-semibold gap-1.5 h-8 rounded-lg"
          >
            {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            Download
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
