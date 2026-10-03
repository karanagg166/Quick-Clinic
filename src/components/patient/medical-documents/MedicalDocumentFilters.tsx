"use client";

import React from "react";
import { Search, X, Filter } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  MedicalDocumentFiltersState,
  MedicalDocumentType,
  MedicalFileTypeFilter,
  MedicalDocumentSortOption,
} from "@/types/medical-document";

interface MedicalDocumentFiltersProps {
  filters: MedicalDocumentFiltersState;
  onFilterChange: (updated: Partial<MedicalDocumentFiltersState>) => void;
  onResetFilters: () => void;
  totalCount: number;
  filteredCount: number;
}

export function MedicalDocumentFilters({
  filters,
  onFilterChange,
  onResetFilters,
  totalCount,
  filteredCount,
}: MedicalDocumentFiltersProps) {
  const isFiltered =
    Boolean(filters.searchQuery) ||
    filters.documentType !== "ALL" ||
    filters.fileType !== "ALL" ||
    Boolean(filters.reportDate) ||
    filters.sortBy !== "newest";

  return (
    <Card className="border shadow-xs bg-card">
      <CardHeader className="pb-3 flex flex-row items-center justify-between space-y-0">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-primary" />
          <CardTitle className="text-base font-semibold">
            Filter Documents
          </CardTitle>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">
            Showing {filteredCount} of {totalCount}
          </span>
          {isFiltered && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onResetFilters}
              className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"
            >
              <X className="w-3.5 h-3.5" /> Reset
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:gap-4 grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
            <Input
              value={filters.searchQuery}
              onChange={(e) => onFilterChange({ searchQuery: e.target.value })}
              placeholder="Search documents..."
              className="pl-9 h-9 text-sm"
              aria-label="Search documents"
            />
          </div>

          {/* Document Type */}
          <div>
            <Select
              value={filters.documentType}
              onValueChange={(val) =>
                onFilterChange({
                  documentType: val as MedicalDocumentType | "ALL",
                })
              }
            >
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue placeholder="All Types" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Types</SelectItem>
                <SelectItem value="LAB_REPORT">Lab Report</SelectItem>
                <SelectItem value="PRESCRIPTION">Prescription</SelectItem>
                <SelectItem value="RADIOLOGY_SCAN">Radiology / Scan</SelectItem>
                <SelectItem value="DISCHARGE_SUMMARY">
                  Discharge Summary
                </SelectItem>
                <SelectItem value="MEDICAL_CERTIFICATE">
                  Medical Certificate
                </SelectItem>
                <SelectItem value="VACCINATION_RECORD">
                  Vaccination Record
                </SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* File Type */}
          <div>
            <Select
              value={filters.fileType}
              onValueChange={(val) =>
                onFilterChange({
                  fileType: val as MedicalFileTypeFilter,
                })
              }
            >
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue placeholder="All Files" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ALL">All Files</SelectItem>
                <SelectItem value="PDF">PDF</SelectItem>
                <SelectItem value="IMAGE">Image</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Report Date */}
          <div className="relative">
            <Input
              type="date"
              value={filters.reportDate}
              onChange={(e) => onFilterChange({ reportDate: e.target.value })}
              className="h-9 text-sm"
              aria-label="Filter by report date"
            />
          </div>

          {/* Sort */}
          <div>
            <Select
              value={filters.sortBy}
              onValueChange={(val) =>
                onFilterChange({
                  sortBy: val as MedicalDocumentSortOption,
                })
              }
            >
              <SelectTrigger className="w-full h-9 text-sm">
                <SelectValue placeholder="Sort by" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest First</SelectItem>
                <SelectItem value="oldest">Oldest First</SelectItem>
                <SelectItem value="name_asc">Name A-Z</SelectItem>
                <SelectItem value="name_desc">Name Z-A</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
