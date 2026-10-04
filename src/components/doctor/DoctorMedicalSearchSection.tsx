"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import { format } from "date-fns";
import {
  Search,
  FileText,
  Calendar,
  ExternalLink,
  Loader2,
  RotateCcw,
  Sparkles,
  AlertCircle,
  FileSearch,
} from "lucide-react";

export interface MedicalRetrievalChunkResult {
  score: number;
  content: string;
  documentId: string;
  documentType: string;
  reportDate: string | null;
  fileName: string;
  pageNumber: number;
  chunkIndex: number;
  patientId: string;
}

interface DoctorMedicalSearchSectionProps {
  patientId: string;
}

export function DoctorMedicalSearchSection({
  patientId,
}: DoctorMedicalSearchSectionProps) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<MedicalRetrievalChunkResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [viewingDocId, setViewingDocId] = useState<string | null>(null);

  const handleSearch = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      showToast.error("Please enter a search query");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch(`/api/doctors/me/patients/${patientId}/medical-search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery, limit: 8 }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Failed to search patient medical records");
      }

      const data = await res.json();
      setResults(data.results || []);
      setHasSearched(true);
    } catch (err: any) {
      console.error("Medical search failed:", err);
      showToast.error(err.message || "Search failed");
    } finally {
      setLoading(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
  };

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
    <Card className="border shadow-xs bg-linear-to-b from-card to-muted/10">
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Search Medical Records
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Retrieve relevant excerpts from this patient&apos;s indexed clinical documents
            </CardDescription>
          </div>
          <Badge variant="outline" className="text-[10px] w-fit font-medium text-muted-foreground">
            Semantic & Keyword Retrieval
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-1 space-y-4">
        {/* Search Form */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search this patient's medical records (e.g., blood pressure, HbA1c, allergies)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 text-xs h-9"
              disabled={loading}
            />
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={loading || !query.trim()}
              className="text-xs h-9 gap-1.5 px-4 font-semibold shrink-0"
            >
              {loading ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Searching...
                </>
              ) : (
                <>
                  <Search className="w-3.5 h-3.5" />
                  Search
                </>
              )}
            </Button>

            {(query || hasSearched) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={loading}
                className="text-xs h-9 gap-1 px-2.5 shrink-0"
                title="Reset search"
                aria-label="Reset search"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </form>

        {/* Loading State */}
        {loading && (
          <div className="space-y-3 pt-2">
            {[1, 2].map((i) => (
              <div key={i} className="p-3 border rounded-xl space-y-2 bg-card">
                <div className="flex items-center justify-between">
                  <Skeleton className="h-4 w-1/3 rounded" />
                  <Skeleton className="h-4 w-16 rounded" />
                </div>
                <Skeleton className="h-12 w-full rounded" />
                <div className="flex justify-between pt-1">
                  <Skeleton className="h-3 w-24 rounded" />
                  <Skeleton className="h-6 w-20 rounded" />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Empty State */}
        {!loading && hasSearched && results.length === 0 && (
          <div className="p-6 text-center space-y-2 border border-dashed rounded-xl bg-card">
            <div className="w-10 h-10 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
              <FileSearch className="w-5 h-5" />
            </div>
            <p className="text-xs font-medium text-foreground">No matching excerpts found</p>
            <p className="text-[11px] text-muted-foreground max-w-md mx-auto">
              No relevant excerpts were found in this patient&apos;s indexed records for your query. Try different terms or verify if documents are indexed.
            </p>
          </div>
        )}

        {/* Results List */}
        {!loading && results.length > 0 && (
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
                        <span className="font-medium text-foreground truncate max-w-[200px] sm:max-w-[300px]" title={res.fileName}>
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
                        onClick={() => handleViewSource(res.documentId)}
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
        )}
      </CardContent>
    </Card>
  );
}
