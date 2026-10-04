"use client";

import { useEffect, useState, useCallback, use } from "react";
import { useRouter } from "next/navigation";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { showToast } from "@/lib/toast";
import {
  DoctorMedicalDocumentCard,
  DoctorMedicalDocument,
} from "@/components/doctor/DoctorMedicalDocumentCard";
import {
  DoctorMedicalDocumentHeader,
  PatientSummary,
  AccessiblePatient,
} from "@/components/doctor/DoctorMedicalDocumentHeader";
import { MedicalRecordAccessDenied } from "@/components/doctor/MedicalRecordAccessDenied";
import { FileText, Search, RotateCcw } from "lucide-react";

interface RouteParams {
  params: Promise<{
    patientId: string;
  }>;
}

export default function DoctorPatientMedicalDocumentsPage({ params }: RouteParams) {
  const resolvedParams = use(params);
  const patientId = resolvedParams.patientId;
  const router = useRouter();

  const [patient, setPatient] = useState<PatientSummary | null>(null);
  const [documents, setDocuments] = useState<DoctorMedicalDocument[]>([]);
  const [accessiblePatients, setAccessiblePatients] = useState<AccessiblePatient[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [deniedReason, setDeniedReason] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [activeActionDocId, setActiveActionDocId] = useState<string | null>(null);

  useEffect(() => {
    async function loadAccessiblePatients() {
      try {
        const res = await fetch("/api/doctors/me/medical-record-patients");
        if (res.ok) {
          const list = await res.json();
          setAccessiblePatients(list);
        }
      } catch (err) {
        console.error("Failed to load accessible patients:", err);
      }
    }
    loadAccessiblePatients();
  }, []);

  const fetchDocuments = useCallback(async () => {
    if (!patientId) return;

    setLoading(true);
    setAccessDenied(false);

    try {
      const queryParams = new URLSearchParams();
      if (searchQuery.trim()) queryParams.set("search", searchQuery.trim());
      if (typeFilter !== "all") queryParams.set("type", typeFilter);

      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-documents?${queryParams.toString()}`
      );

      if (res.status === 403) {
        const errData = await res.json();
        setAccessDenied(true);
        setDeniedReason(errData.error || "Access denied. Eligible appointment required.");
        setDocuments([]);
        return;
      }

      if (!res.ok) {
        showToast.error("Failed to load patient medical records");
        setDocuments([]);
        return;
      }

      const data = await res.json();
      setPatient(data.patient);
      setDocuments(data.documents || []);
    } catch (err) {
      console.error("Error fetching medical documents:", err);
      showToast.error("Network error loading medical records");
    } finally {
      setLoading(false);
    }
  }, [patientId, searchQuery, typeFilter]);

  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  const handleView = async (doc: DoctorMedicalDocument) => {
    try {
      setActiveActionDocId(doc.id);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-documents/${doc.id}/access?action=view`
      );

      if (!res.ok) {
        const err = await res.json();
        showToast.error(err.error || "Failed to generate view link");
        return;
      }

      const data = await res.json();
      if (data.url) {
        window.open(data.url, "_blank", "noopener,noreferrer");
      }
    } catch (err) {
      console.error("View document error:", err);
      showToast.error("Could not open document");
    } finally {
      setActiveActionDocId(null);
    }
  };

  const handleDownload = async (doc: DoctorMedicalDocument) => {
    try {
      setActiveActionDocId(doc.id);
      const res = await fetch(
        `/api/doctors/me/patients/${patientId}/medical-documents/${doc.id}/access?action=download`
      );

      if (!res.ok) {
        const err = await res.json();
        showToast.error(err.error || "Failed to prepare download");
        return;
      }

      const data = await res.json();
      if (data.url) {
        const link = document.createElement("a");
        link.href = data.url;
        link.download = doc.fileName || "document";
        link.target = "_blank";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast.success("Download started");
      }
    } catch (err) {
      console.error("Download document error:", err);
      showToast.error("Could not download document");
    } finally {
      setActiveActionDocId(null);
    }
  };

  const handlePatientSwitch = (newId: string) => {
    if (newId && newId !== patientId) {
      router.push(`/doctor/patients/${newId}/medical-documents`);
    }
  };

  if (accessDenied) {
    return <MedicalRecordAccessDenied reason={deniedReason} />;
  }

  const labCount = documents.filter((d) => d.type === "LAB_REPORT").length;
  const rxCount = documents.filter((d) => d.type === "PRESCRIPTION").length;
  const scanCount = documents.filter((d) => d.type === "RADIOLOGY_SCAN").length;

  return (
    <div className="p-4 sm:p-6 space-y-6 max-w-7xl mx-auto">
      <DoctorMedicalDocumentHeader
        patient={patient}
        accessiblePatients={accessiblePatients}
        currentPatientId={patientId}
        onPatientSwitch={handlePatientSwitch}
        labCount={labCount}
        scanCount={scanCount}
        rxCount={rxCount}
      />

      {/* Filter and Search Bar */}
      <Card className="border shadow-xs">
        <CardContent className="p-3.5 space-y-3">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
              <Input
                placeholder="Search document title, clinic, or notes..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-9 text-xs h-9"
              />
            </div>

            <Select value={typeFilter} onValueChange={setTypeFilter}>
              <SelectTrigger className="w-full sm:w-[170px] text-xs h-9">
                <SelectValue placeholder="All Categories" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Document Types</SelectItem>
                <SelectItem value="LAB_REPORT">Lab Reports</SelectItem>
                <SelectItem value="PRESCRIPTION">Prescriptions</SelectItem>
                <SelectItem value="RADIOLOGY_SCAN">Radiology / Scans</SelectItem>
                <SelectItem value="DISCHARGE_SUMMARY">Discharge Summary</SelectItem>
                <SelectItem value="MEDICAL_CERTIFICATE">Certificate</SelectItem>
                <SelectItem value="VACCINATION_RECORD">Vaccination</SelectItem>
                <SelectItem value="OTHER">Other</SelectItem>
              </SelectContent>
            </Select>

            {(searchQuery || typeFilter !== "all") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setTypeFilter("all");
                }}
                className="text-xs h-9 gap-1"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Reset
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Documents Grid */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <FileText className="w-4 h-4 text-primary" />
            Medical Documents ({documents.length})
          </h2>
          <span className="text-xs text-muted-foreground">
            Patient owns records • Read-only access
          </span>
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-44 w-full rounded-xl" />
            ))}
          </div>
        ) : documents.length === 0 ? (
          <Card className="rounded-xl border-dashed">
            <CardContent className="p-10 text-center space-y-3">
              <div className="w-12 h-12 bg-muted rounded-full flex items-center justify-center mx-auto text-muted-foreground">
                <FileText className="w-6 h-6" />
              </div>
              <h3 className="font-semibold text-foreground text-sm">No Medical Documents Found</h3>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                {searchQuery || typeFilter !== "all"
                  ? "No patient documents match your current filter settings."
                  : "The patient has not uploaded any medical records yet."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {documents.map((doc) => (
              <DoctorMedicalDocumentCard
                key={doc.id}
                document={doc}
                patientId={patientId}
                onView={handleView}
                onDownload={handleDownload}
                isLoading={activeActionDocId === doc.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
