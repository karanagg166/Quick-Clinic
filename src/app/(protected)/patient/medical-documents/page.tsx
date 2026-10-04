"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Plus,
  FolderOpen,
  FileQuestion,
  RotateCcw,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  MedicalDocument,
  MedicalDocumentFiltersState,
} from "@/types/medical-document";
import { MedicalDocumentCard } from "@/components/patient/medical-documents/MedicalDocumentCard";
import { MedicalDocumentFilters } from "@/components/patient/medical-documents/MedicalDocumentFilters";
import { MedicalDocumentPreviewDialog } from "@/components/patient/medical-documents/MedicalDocumentPreviewDialog";
import { MedicalDocumentDeleteDialog } from "@/components/patient/medical-documents/MedicalDocumentDeleteDialog";
import { MedicalDocumentRenameDialog } from "@/components/patient/medical-documents/MedicalDocumentRenameDialog";
import { MedicalDocumentSkeleton } from "@/components/patient/medical-documents/MedicalDocumentSkeleton";

const INITIAL_FILTERS: MedicalDocumentFiltersState = {
  searchQuery: "",
  documentType: "ALL",
  fileType: "ALL",
  reportDate: "",
  sortBy: "newest",
};

export default function MedicalDocumentsPage() {
  const [documents, setDocuments] = useState<MedicalDocument[]>([]);
  const [filters, setFilters] =
    useState<MedicalDocumentFiltersState>(INITIAL_FILTERS);
  const [isLoading, setIsLoading] = useState(true);
  const [totalCount, setTotalCount] = useState(0);

  // Active dialog states
  const [previewDoc, setPreviewDoc] = useState<MedicalDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<MedicalDocument | null>(null);
  const [renameDoc, setRenameDoc] = useState<MedicalDocument | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Search debounce ref
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch documents from backend API with server-side filters and sorting
  const fetchDocuments = useCallback(
    async (currentFilters: MedicalDocumentFiltersState) => {
      try {
        setIsLoading(true);
        const params = new URLSearchParams();

        if (currentFilters.searchQuery.trim()) {
          params.set("search", currentFilters.searchQuery.trim());
        }
        if (currentFilters.documentType && currentFilters.documentType !== "ALL") {
          params.set("type", currentFilters.documentType);
        }
        if (currentFilters.fileType && currentFilters.fileType !== "ALL") {
          params.set("fileType", currentFilters.fileType);
        }
        if (currentFilters.reportDate) {
          params.set("reportDate", currentFilters.reportDate);
        }
        if (currentFilters.sortBy) {
          params.set("sort", currentFilters.sortBy);
        }

        const res = await fetch(
          `/api/patients/me/medical-documents?${params.toString()}`
        );

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || "Failed to load medical documents");
        }

        const data = await res.json();
        const docs: MedicalDocument[] = (data.documents || []).map(
          (d: any) => ({
            id: d.id,
            title: d.title,
            fileName: d.fileName,
            mimeType: d.mimeType,
            fileSize: d.fileSize,
            type: d.type,
            reportDate: typeof d.reportDate === "string" ? d.reportDate.split("T")[0] : d.reportDate,
            uploadedAt: typeof d.createdAt === "string" ? d.createdAt.split("T")[0] : d.createdAt,
            hospitalOrDoctor: d.hospitalOrDoctor || undefined,
            notes: d.notes || undefined,
            processingStatus: d.processingStatus || "PENDING",
            processingError: d.processingError || null,
            processedAt: d.processedAt || null,
          })
        );

        setDocuments(docs);

        // If no search or filter is active, update the baseline totalCount
        const isDefault =
          !currentFilters.searchQuery.trim() &&
          currentFilters.documentType === "ALL" &&
          currentFilters.fileType === "ALL" &&
          !currentFilters.reportDate;

        if (isDefault) {
          setTotalCount(docs.length);
        }
      } catch (err: any) {
        console.error("Error loading medical documents:", err);
        toast.error(err.message || "Failed to load medical documents");
      } finally {
        setIsLoading(false);
      }
    },
    []
  );

  // Debounced effect when filters change
  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    // Debounce search query changes by 300ms, apply non-search filters immediately
    const delay = filters.searchQuery ? 300 : 0;
    debounceTimerRef.current = setTimeout(() => {
      fetchDocuments(filters);
    }, delay);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [filters, fetchDocuments]);

  const handleFilterChange = (
    updated: Partial<MedicalDocumentFiltersState>
  ) => {
    setFilters((prev) => ({ ...prev, ...updated }));
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  // View document handler: request temporary signed URL
  const handleView = async (doc: MedicalDocument) => {
    try {
      const res = await fetch(
        `/api/patients/me/medical-documents/${doc.id}/access`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate preview URL");
      }

      setPreviewDoc({
        ...doc,
        previewUrl: data.url,
      });
    } catch (err: any) {
      toast.error(err.message || "Failed to open document preview");
    }
  };

  // Download handler: request fresh temporary signed URL and trigger download
  const handleDownload = async (doc: MedicalDocument) => {
    try {
      const res = await fetch(
        `/api/patients/me/medical-documents/${doc.id}/access`
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to generate download URL");
      }

      const link = document.createElement("a");
      link.href = data.url;
      link.download = doc.fileName;
      link.target = "_blank";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      toast.success(`Download started for "${doc.fileName}"`);
    } catch (err: any) {
      toast.error(err.message || "Failed to download document");
    }
  };

  // Delete handlers
  const handleDeleteRequest = (doc: MedicalDocument) => {
    setDeleteDoc(doc);
  };

  const handleConfirmDelete = async (doc: MedicalDocument) => {
    try {
      const res = await fetch(
        `/api/patients/me/medical-documents/${doc.id}`,
        {
          method: "DELETE",
        }
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to delete document");
      }

      setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
      setTotalCount((prev) => Math.max(0, prev - 1));
      setDeleteDoc(null);
      toast.success(`"${doc.title}" was deleted.`);
    } catch (err: any) {
      toast.error(err.message || "Failed to delete document");
    }
  };

  // Rename handlers
  const handleRenameRequest = (doc: MedicalDocument) => {
    setRenameDoc(doc);
  };

  const handleConfirmRename = async (
    doc: MedicalDocument,
    newTitle: string
  ) => {
    try {
      const res = await fetch(
        `/api/patients/me/medical-documents/${doc.id}`,
        {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ title: newTitle }),
        }
      );
      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || "Failed to rename document");
      }

      setDocuments((prev) =>
        prev.map((d) => (d.id === doc.id ? { ...d, title: newTitle } : d))
      );
      setRenameDoc(null);
      toast.success(`Document renamed to "${newTitle}".`);
    } catch (err: any) {
      toast.error(err.message || "Failed to rename document");
    }
  };

  const handleRetryProcessing = async (doc: MedicalDocument) => {
    try {
      setRetryingId(doc.id);
      const res = await fetch(
        `/api/patients/me/medical-documents/${doc.id}/retry-processing`,
        { method: "POST" }
      );
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Failed to retry document processing");
      }
      toast.success("Document re-queued for AI processing");
      setDocuments((prev) =>
        prev.map((d) =>
          d.id === doc.id
            ? { ...d, processingStatus: "QUEUED", processingError: null }
            : d
        )
      );
    } catch (err: any) {
      toast.error(err.message || "Failed to retry processing");
    } finally {
      setRetryingId(null);
    }
  };

  return (
    <div className="min-h-screen p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      {/* Back to Dashboard Navigation */}
      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" asChild className="gap-1.5">
          <Link href="/patient">
            <ArrowLeft className="w-4 h-4" /> Back to Dashboard
          </Link>
        </Button>
      </div>

      {/* Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center">
              <FolderOpen className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                Medical Documents
              </h1>
            </div>
          </div>
          <p className="text-sm text-muted-foreground mt-1.5 max-w-2xl">
            View and manage your medical reports, prescriptions, scans, and
            health records.
          </p>
        </div>

        <div>
          <Button asChild className="gap-2 shadow-xs w-full sm:w-auto">
            <Link href="/patient/medical-documents/upload">
              <Plus className="w-4 h-4" /> Upload Document
            </Link>
          </Button>
        </div>
      </div>

      {/* Filters Card */}
      <MedicalDocumentFilters
        filters={filters}
        onFilterChange={handleFilterChange}
        onResetFilters={handleResetFilters}
        totalCount={totalCount || documents.length}
        filteredCount={documents.length}
      />

      {/* Document Grid / Loading / Empty State */}
      {isLoading ? (
        <MedicalDocumentSkeleton count={6} />
      ) : documents.length === 0 ? (
        /* Empty State */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-dashed p-10 sm:p-16 text-center bg-card flex flex-col items-center justify-center space-y-4"
        >
          <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
            <FileQuestion className="w-7 h-7" />
          </div>

          <div className="max-w-md space-y-1">
            <h3 className="text-lg font-semibold text-foreground">
              No medical documents found
            </h3>
            <p className="text-sm text-muted-foreground">
              Try changing your filters or upload a new medical document.
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-3 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleResetFilters}
              className="gap-1.5"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Clear Filters
            </Button>
            <Button asChild size="sm" className="gap-1.5">
              <Link href="/patient/medical-documents/upload">
                <Plus className="w-3.5 h-3.5" /> Upload Document
              </Link>
            </Button>
          </div>
        </motion.div>
      ) : (
        /* Grid */
        <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {documents.map((doc) => (
            <MedicalDocumentCard
              key={doc.id}
              document={doc}
              onView={handleView}
              onDownload={handleDownload}
              onRename={handleRenameRequest}
              onDelete={handleDeleteRequest}
              onRetryProcessing={handleRetryProcessing}
              isRetrying={retryingId === doc.id}
            />
          ))}
        </div>
      )}

      {/* Preview Dialog */}
      <MedicalDocumentPreviewDialog
        document={previewDoc}
        isOpen={Boolean(previewDoc)}
        onClose={() => setPreviewDoc(null)}
        onDownload={handleDownload}
      />

      {/* Delete Confirmation Dialog */}
      <MedicalDocumentDeleteDialog
        document={deleteDoc}
        isOpen={Boolean(deleteDoc)}
        onClose={() => setDeleteDoc(null)}
        onConfirmDelete={handleConfirmDelete}
      />

      {/* Rename Dialog */}
      <MedicalDocumentRenameDialog
        document={renameDoc}
        isOpen={Boolean(renameDoc)}
        onClose={() => setRenameDoc(null)}
        onConfirmRename={handleConfirmRename}
      />
    </div>
  );
}
