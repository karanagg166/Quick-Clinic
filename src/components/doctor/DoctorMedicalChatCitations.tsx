"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { showToast } from "@/lib/toast";
import { format } from "date-fns";
import {
  Calendar,
  ExternalLink,
  Loader2,
  ChevronDown,
  ChevronUp,
  FileText,
} from "lucide-react";
import { MedicalRagCitation } from "@/lib/search-sphere-client";

interface DoctorMedicalChatCitationsProps {
  patientId: string;
  citations: MedicalRagCitation[];
}

export function DoctorMedicalChatCitations({
  patientId,
  citations,
}: DoctorMedicalChatCitationsProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  if (!citations || citations.length === 0) {
    return null;
  }

  const handleViewSource = async (docId: string) => {
    try {
      setViewingDocId(docId);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-documents/${docId}/access?action=view`
      );

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        showToast.error(err?.error || "Document is no longer accessible or has been deleted");
        return;
      }

      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("View source error:", err);
      showToast.error("Could not open source document");
    } finally {
      setViewingDocId(null);
    }
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

  return (
    <div className="mt-3 pt-3 border-t border-border/60 space-y-2" data-testid="chat-message-citations">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1.5">
          <FileText className="w-3.5 h-3.5 text-primary" />
          <span>Attributed Sources ({citations.length})</span>
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowEvidence((prev) => !prev)}
          className="text-[11px] h-6 px-2 gap-1 text-muted-foreground hover:text-foreground"
        >
          <span>{showEvidence ? "Hide Excerpts" : "Show Excerpts"}</span>
          {showEvidence ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </Button>
      </div>

      <div className="grid gap-2">
        {citations.map((citation) => {
          const formattedDate = citation.reportDate
            ? format(new Date(citation.reportDate), "MMM d, yyyy")
            : null;
          const isViewing = viewingDocId === citation.documentId;

          return (
            <div
              key={`${citation.documentId}-${citation.citationId}`}
              className="p-2.5 border rounded-lg bg-card/60 text-xs space-y-2 shadow-2xs"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-primary px-1.5 py-0.5 rounded bg-primary/10 text-[11px]">
                    [{citation.citationId}]
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] font-medium border ${getTypeBadgeVariant(
                      citation.documentType
                    )}`}
                  >
                    {citation.documentType.replace(/_/g, " ")}
                  </Badge>
                  <span
                    className="font-medium text-foreground truncate max-w-[180px] sm:max-w-[260px]"
                    title={citation.fileName}
                  >
                    {citation.fileName}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-muted-foreground text-[11px] shrink-0">
                  {formattedDate && (
                    <span className="flex items-center gap-1">
                      <Calendar className="w-3 h-3 text-primary" />
                      {formattedDate}
                    </span>
                  )}
                  {citation.pageNumber !== null && (
                    <span className="bg-muted px-1.5 py-0.5 rounded text-[10px]">
                      p. {citation.pageNumber}
                    </span>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isViewing}
                    onClick={() => handleViewSource(citation.documentId)}
                    className="text-xs h-6 gap-1 font-medium rounded-md px-2"
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

              {/* Collapsible evidence chunk */}
              {showEvidence && citation.content && (
                <div className="p-2 rounded bg-muted/50 border border-border/40 text-foreground font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                  {citation.content}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
