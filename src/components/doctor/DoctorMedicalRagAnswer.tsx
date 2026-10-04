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
  Sparkles,
  ShieldCheck,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { MedicalRagCitation } from "@/lib/search-sphere-client";

interface DoctorMedicalRagAnswerProps {
  patientId: string;
  answer: string;
  citations: MedicalRagCitation[];
}

export function DoctorMedicalRagAnswer({
  patientId,
  answer,
  citations,
}: DoctorMedicalRagAnswerProps) {
  const [showEvidence, setShowEvidence] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  const handleViewSource = async (docId: string) => {
    try {
      setViewingDocId(docId);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-documents/${docId}/access?action=view`
      );

      if (!res.ok) {
        const err = await res.json().catch(() => null);
        showToast.error(err?.error || "Failed to access source document");
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
    <div className="space-y-4 pt-1" data-testid="medical-rag-answer-container">
      {/* Answer Block */}
      <div className="p-4 rounded-xl border border-primary/20 bg-linear-to-b from-primary/5 to-transparent space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold text-primary">
          <Sparkles className="w-4 h-4" />
          <span>Grounded Clinical Answer</span>
        </div>

        <div className="text-sm leading-relaxed text-foreground whitespace-pre-wrap">
          {answer}
        </div>

        {/* Clinical Disclaimer */}
        <div className="flex items-start gap-1.5 text-[11px] text-muted-foreground pt-2 border-t border-border/50">
          <ShieldCheck className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
          <span>
            Answers are generated from the patient&apos;s uploaded medical records and may require clinical verification.
          </span>
        </div>
      </div>

      {/* Citations / Sources */}
      {citations.length > 0 && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">
              Sources ({citations.length})
            </span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowEvidence((prev) => !prev)}
              className="text-[11px] h-7 px-2 gap-1 text-muted-foreground hover:text-foreground"
            >
              <span>{showEvidence ? "Hide Supporting Evidence" : "Show Supporting Evidence"}</span>
              {showEvidence ? (
                <ChevronUp className="w-3 h-3" />
              ) : (
                <ChevronDown className="w-3 h-3" />
              )}
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
                  className="p-3 border rounded-lg bg-card space-y-2 text-xs shadow-2xs"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-semibold text-primary px-1.5 py-0.5 rounded bg-primary/10 text-[11px]">
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
                        className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[280px]"
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
                        className="text-xs h-7 gap-1 font-medium rounded-md px-2.5"
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

                  {/* Expandable Supporting Evidence Excerpt */}
                  {showEvidence && citation.content && (
                    <div className="p-2.5 rounded-lg bg-muted/40 border border-border/60 text-foreground font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
                      {citation.content}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
