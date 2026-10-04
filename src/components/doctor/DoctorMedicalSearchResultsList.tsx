"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Calendar, ExternalLink, Loader2 } from "lucide-react";
import { MedicalRetrievalChunkResult } from "@/components/doctor/DoctorMedicalSearchSection";

interface DoctorMedicalSearchResultsListProps {
  results: MedicalRetrievalChunkResult[];
  viewingDocId: string | null;
  onViewSource: (docId: string) => void;
}

export function DoctorMedicalSearchResultsList({
  results,
  viewingDocId,
  onViewSource,
}: DoctorMedicalSearchResultsListProps) {
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

  return (
    <div className="space-y-3 pt-1">
      <div className="flex items-center justify-between text-xs text-muted-foreground px-0.5">
        <span>Found {results.length} relevant excerpts</span>
        <span className="text-[11px]">Ranked by relevance</span>
      </div>

      <div className="space-y-3">
        {results.map((res, index) => {
          const isViewing = viewingDocId === res.documentId;
          const formattedDate = res.reportDate
            ? format(new Date(res.reportDate), "MMM d, yyyy")
            : null;

          return (
            <div
              key={`${res.documentId}-${res.chunkIndex}-${index}`}
              className="p-3.5 border rounded-xl bg-card hover:border-primary/40 transition-colors duration-150 space-y-2.5 text-xs shadow-2xs"
            >
              {/* Excerpt Meta Header */}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-medium border ${getTypeBadgeVariant(
                      res.documentType
                    )}`}
                  >
                    {res.documentType.replace(/_/g, " ")}
                  </Badge>
                  <span
                    className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[300px]"
                    title={res.fileName}
                  >
                    {res.fileName}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground text-[11px] shrink-0">
                  {formattedDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-primary" />
                      {formattedDate}
                    </span>
                  )}
                  <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                    p. {res.pageNumber}
                  </span>
                  <span className="bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-medium px-1.5 py-0.5 rounded text-[10px] border border-emerald-200 dark:border-emerald-800">
                    {Math.round(res.score * 100)}% match
                  </span>
                </div>
              </div>

              {/* Excerpt Content */}
              <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-foreground font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                {res.content}
              </div>

              {/* Action Bar */}
              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-muted-foreground">
                  Excerpt #{res.chunkIndex + 1}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={isViewing}
                  onClick={() => onViewSource(res.documentId)}
                  className="text-xs h-7 gap-1.5 font-medium rounded-lg"
                >
                  {isViewing ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <ExternalLink className="w-3 h-3 text-primary" />
                  )}
                  View Source
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
