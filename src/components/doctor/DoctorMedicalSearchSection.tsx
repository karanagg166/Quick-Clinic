"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import {
  Search,
  Loader2,
  RotateCcw,
  Sparkles,
  FileSearch,
} from "lucide-react";
import { MedicalRagCitation } from "@/lib/search-sphere-client";
import { DoctorMedicalRagAnswer } from "@/components/doctor/DoctorMedicalRagAnswer";
import { DoctorMedicalSearchResultsList } from "@/components/doctor/DoctorMedicalSearchResultsList";

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

  // Grounded Medical RAG state
  const [aiResult, setAiResult] = useState<{
    answer: string;
    citations: MedicalRagCitation[];
    resultCount: number;
  } | null>(null);
  const [loadingAi, setLoadingAi] = useState(false);
  const [hasAskedAi, setHasAskedAi] = useState(false);

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

  const handleAskAi = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    const cleanQuery = query.trim();
    if (!cleanQuery) {
      showToast.error("Please enter a question");
      return;
    }

    setLoadingAi(true);
    try {
      const res = await fetch(`/api/doctors/me/patients/${patientId}/medical-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: cleanQuery, limit: 8 }),
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => null);
        throw new Error(errData?.error || "Failed to generate grounded medical answer");
      }

      const data = await res.json();
      setAiResult({
        answer: data.answer || "",
        citations: data.citations || [],
        resultCount: data.resultCount ?? (data.citations ? data.citations.length : 0),
      });
      setHasAskedAi(true);
    } catch (err: any) {
      console.error("Medical AI Q&A failed:", err);
      showToast.error(err.message || "Failed to generate AI answer");
    } finally {
      setLoadingAi(false);
    }
  };

  const handleClear = () => {
    setQuery("");
    setResults([]);
    setHasSearched(false);
    setAiResult(null);
    setHasAskedAi(false);
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

  return (
    <Card className="border shadow-xs bg-linear-to-b from-card to-muted/10">
      <CardHeader className="p-4 pb-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <CardTitle className="text-sm font-semibold flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              Ask about this patient&apos;s records
            </CardTitle>
            <CardDescription className="text-xs text-muted-foreground mt-0.5">
              Grounded AI answers and semantic search over verified clinical documents
            </CardDescription>
          </div>
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge variant="outline" className="text-[10px] w-fit font-medium text-muted-foreground">
              Search Medical Records
            </Badge>
            <Badge variant="outline" className="text-[10px] w-fit font-medium text-primary border-primary/30">
              Grounded AI
            </Badge>
          </div>
        </div>
      </CardHeader>

      <CardContent className="p-4 pt-1 space-y-4">
        {/* Search & Ask AI Form */}
        <form onSubmit={handleSearch} className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input
              placeholder="Search this patient's medical records or ask AI (e.g. BP readings, medications)..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-9 text-xs h-9"
              disabled={loading || loadingAi}
            />
          </div>

          <div className="flex items-center gap-2 flex-wrap sm:flex-nowrap">
            {/* Ask AI Button */}
            <Button
              type="button"
              size="sm"
              disabled={loading || loadingAi}
              onClick={handleAskAi}
              className="text-xs h-9 gap-1.5 px-3.5 font-semibold shrink-0"
            >
              {loadingAi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Thinking...
                </>
              ) : (
                <>
                  <Sparkles className="w-3.5 h-3.5" />
                  Ask AI
                </>
              )}
            </Button>

            {/* Keyword/Semantic Search Button */}
            <Button
              type="submit"
              variant="outline"
              size="sm"
              disabled={loading || loadingAi || !query.trim()}
              className="text-xs h-9 gap-1.5 px-3 font-semibold shrink-0"
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

            {(query || hasSearched || hasAskedAi) && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleClear}
                disabled={loading || loadingAi}
                className="text-xs h-9 gap-1 px-2.5 shrink-0"
                title="Reset search"
                aria-label="Reset search"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </Button>
            )}
          </div>
        </form>

        {/* AI Answer Loading State */}
        {loadingAi && (
          <div className="p-4 border rounded-xl space-y-3 bg-card" data-testid="medical-rag-loading">
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin text-primary" />
              <span className="text-xs font-medium text-foreground">
                Analyzing medical records and generating grounded response...
              </span>
            </div>
            <Skeleton className="h-4 w-4/5 rounded" />
            <Skeleton className="h-4 w-3/5 rounded" />
            <Skeleton className="h-4 w-2/3 rounded" />
            <div className="pt-1 flex gap-2">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-28 rounded-md" />
            </div>
          </div>
        )}

        {/* AI Answer Presentation */}
        {!loadingAi && aiResult && (
          <DoctorMedicalRagAnswer
            patientId={patientId}
            answer={aiResult.answer}
            citations={aiResult.citations}
          />
        )}

        {/* Search Results Loading State */}
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

        {/* Search Empty State */}
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

        {/* Search Results List */}
        {!loading && results.length > 0 && (
          <DoctorMedicalSearchResultsList
            results={results}
            viewingDocId={viewingDocId}
            onViewSource={handleViewSource}
          />
        )}
      </CardContent>
    </Card>
  );
}
