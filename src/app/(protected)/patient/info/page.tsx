"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";

export default function PatientInfo() {
  const { user, patientId } = useUserStore();
  const [loading, setLoading] = useState(false);
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");
  const [exists, setExists] = useState(false);

  // GET PATIENT INFO
  useEffect(() => {
    const loadInfo = async () => {
      try {
        if (!patientId) return;

        setLoading(true);

        const res = await fetch(`/api/patients/${patientId}`, {
          method: "GET",
          credentials: "include",
        });

        if (!res.ok) {
          setExists(false);
          return;
        }

        const data = await res.json();

        setMedicalHistory(data.patient.medicalHistory || "");
        setAllergies(data.patient.allergies || "");
        setCurrentMedications(data.patient.currentMedications || "");
        setExists(true);
      } catch (e) {
        setExists(false);
      } finally {
        setLoading(false);
      }
    };

    loadInfo();
  }, [patientId]);

  // CREATE
  const createInfo = async () => {
    try {
      if (!user?.userId) {
        showToast.error("User ID not found");
        return;
      }

      setLoading(true);

      const response = await fetch("/api/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.userId,
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        setExists(true);
        showToast.success("Patient info created successfully");
      } else {
        showToast.error(data.error || "Failed to create info");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Create error";
      showToast.error(errorMessage);
      console.error("Create error:", err);
    } finally {
      setLoading(false);
    }
  };

  // UPDATE
  const updateInfo = async () => {
    try {
      if (!patientId) {
        showToast.error("Patient ID not found");
        return;
      }

      setLoading(true);

      const res = await fetch(`/api/patients/${patientId}`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ medicalHistory, allergies, currentMedications }),
      });

      const data = await res.json();
      if (res.ok) {
        showToast.success("Patient info updated successfully");
      } else {
        showToast.error(data.error || "Update failed");
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Update error";
      showToast.error(errorMessage);
      console.error("Update error:", err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Medical Information</h1>
        <p className="text-muted-foreground">Manage your medical history and records</p>
      </div>

      <Card className="max-w-2xl border shadow-sm">
        <CardHeader>
          <CardTitle>Patient Information</CardTitle>
        </CardHeader>
      <CardContent className="space-y-4">
        {loading && !exists ? (
          <div className="space-y-4">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-24 w-full" />
          </div>
        ) : (
          <>
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Medical History</label>
              <Textarea
                value={medicalHistory}
                onChange={(e) => setMedicalHistory(e.target.value)}
                placeholder="Enter your medical history"
                rows={4}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Allergies</label>
              <Textarea
                value={allergies}
                onChange={(e) => setAllergies(e.target.value)}
                placeholder="List any allergies"
                rows={3}
              />
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Current Medications</label>
              <Textarea
                value={currentMedications}
                onChange={(e) => setCurrentMedications(e.target.value)}
                placeholder="List current medications"
                rows={3}
              />
            </div>

            <div className="flex justify-end pt-4">
              {!exists ? (
                <Button
                  onClick={createInfo}
                  disabled={loading}
                >
                  {loading ? "Creating..." : "Create Info"}
                </Button>
              ) : (
                <Button
                  onClick={updateInfo}
                  disabled={loading}
                >
                  {loading ? "Updating..." : "Update Info"}
                </Button>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
    </div>
  );
}
