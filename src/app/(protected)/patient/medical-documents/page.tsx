"use client";

import React, { useState, useMemo, useEffect } from "react";
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
  INITIAL_MOCK_DOCUMENTS,
  isPdfDocument,
  isImageDocument,
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
  const [documents, setDocuments] =
    useState<MedicalDocument[]>(INITIAL_MOCK_DOCUMENTS);
  const [filters, setFilters] =
    useState<MedicalDocumentFiltersState>(INITIAL_FILTERS);
  const [isLoading, setIsLoading] = useState(true);

  // Active dialog states
  const [previewDoc, setPreviewDoc] = useState<MedicalDocument | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<MedicalDocument | null>(null);
  const [renameDoc, setRenameDoc] = useState<MedicalDocument | null>(null);

  // Brief initial loading simulation to demonstrate loading skeleton state
  useEffect(() => {
    const timer = setTimeout(() => {
      setIsLoading(false);
    }, 400);
    return () => clearTimeout(timer);
  }, []);

  const handleFilterChange = (
    updated: Partial<MedicalDocumentFiltersState>
  ) => {
    setFilters((prev) => ({ ...prev, ...updated }));
  };

  const handleResetFilters = () => {
    setFilters(INITIAL_FILTERS);
  };

  // Filter and sort client-side
  const filteredDocuments = useMemo(() => {
    return documents
      .filter((doc) => {
        // 1. Search Query
        if (filters.searchQuery.trim()) {
          const q = filters.searchQuery.toLowerCase();
          const matchTitle = doc.title.toLowerCase().includes(q);
          const matchFileName = doc.fileName.toLowerCase().includes(q);
          const matchDoctor = doc.hospitalOrDoctor
            ?.toLowerCase()
            .includes(q);
          if (!matchTitle && !matchFileName && !matchDoctor) {
            return false;
          }
        }

        // 2. Document Type
        if (filters.documentType !== "ALL" && doc.type !== filters.documentType) {
          return false;
        }

        // 3. File Type
        if (filters.fileType === "PDF") {
          if (!isPdfDocument(doc.fileName, doc.mimeType)) return false;
        } else if (filters.fileType === "IMAGE") {
          if (!isImageDocument(doc.fileName, doc.mimeType)) return false;
        }

        // 4. Report Date
        if (filters.reportDate) {
          if (doc.reportDate !== filters.reportDate) return false;
        }

        return true;
      })
      .sort((a, b) => {
        switch (filters.sortBy) {
          case "newest":
            return (
              new Date(b.reportDate).getTime() -
              new Date(a.reportDate).getTime()
            );
          case "oldest":
            return (
              new Date(a.reportDate).getTime() -
              new Date(b.reportDate).getTime()
            );
          case "name_asc":
            return a.title.localeCompare(b.title);
          case "name_desc":
            return b.title.localeCompare(a.title);
          default:
            return 0;
        }
      });
  }, [documents, filters]);

  // Handlers for document actions
  const handleView = (doc: MedicalDocument) => {
    setPreviewDoc(doc);
  };

  const handleDownload = (doc: MedicalDocument) => {
    toast.success(`Downloading "${doc.fileName}" (mock preview)`);
  };

  const handleDeleteRequest = (doc: MedicalDocument) => {
    setDeleteDoc(doc);
  };

  const handleConfirmDelete = (doc: MedicalDocument) => {
    setDocuments((prev) => prev.filter((d) => d.id !== doc.id));
    toast.success(`"${doc.title}" was deleted.`);
  };

  const handleRenameRequest = (doc: MedicalDocument) => {
    setRenameDoc(doc);
  };

  const handleConfirmRename = (doc: MedicalDocument, newTitle: string) => {
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, title: newTitle } : d))
    );
    toast.success(`Document renamed to "${newTitle}".`);
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
        totalCount={documents.length}
        filteredCount={filteredDocuments.length}
      />

      {/* Document Grid / Loading / Empty State */}
      {isLoading ? (
        <MedicalDocumentSkeleton count={6} />
      ) : filteredDocuments.length === 0 ? (
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
          {filteredDocuments.map((doc) => (
            <MedicalDocumentCard
              key={doc.id}
              document={doc}
              onView={handleView}
              onDownload={handleDownload}
              onRename={handleRenameRequest}
              onDelete={handleDeleteRequest}
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
