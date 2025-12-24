"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
export default function PatientDetails() {
  const userId = useUserStore((state) => state.user?.userId);
  const setUser = useUserStore((state) => state.setUser);
  const user=useUserStore((state) => state.user);
  const [loading, setLoading] = useState(false);
  
  const [medicalHistory, setMedicalHistory] = useState("");
  const [allergies, setAllergies] = useState("");
  const [currentMedications, setCurrentMedications] = useState("");

  const router = useRouter();
  // CREATE
  const createInfo = async () => {
    if (!userId || Array.isArray(userId)) {
      showToast.error("Missing user id from URL.");
      return;
    }

    try {
      setLoading(true); // START LOADING

      const response = await fetch("/api/patients", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          medicalHistory,
          allergies,
          currentMedications,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        showToast.success("Patient info saved successfully.");
        if(user){
setUser(user, data.patient.id, undefined);
        }
        
        router.push(`/patient`);
      } else {
        showToast.error(data.error || "Failed to save info.");
      }

      
    } catch (error) {
      console.error("Error:", error);
      showToast.error("Failed to save info.");
    } finally {
      setLoading(false); // END LOADING
    }
  };

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Patient Information</h1>
        <p className="text-muted-foreground">Complete your medical profile</p>
      </div>

      <Card className="max-w-2xl border shadow-sm">
        <CardHeader>
          <CardTitle>Medical Information</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-2">
            <Label htmlFor="medicalHistory">Medical History</Label>
            <Textarea
              id="medicalHistory"
        value={medicalHistory}
        onChange={(e) => setMedicalHistory(e.target.value)}
              placeholder="Enter your medical history"
              rows={4}
      />
          </div>

          <div className="space-y-2">
            <Label htmlFor="allergies">Allergies</Label>
            <Textarea
              id="allergies"
        value={allergies}
        onChange={(e) => setAllergies(e.target.value)}
              placeholder="List any allergies"
              rows={3}
      />
          </div>

          <div className="space-y-2">
            <Label htmlFor="medications">Current Medications</Label>
            <Textarea
              id="medications"
        value={currentMedications}
        onChange={(e) => setCurrentMedications(e.target.value)}
              placeholder="List current medications"
              rows={3}
            />
          </div>

          <div className="flex justify-end pt-4">
            <Button
        onClick={createInfo}
        disabled={loading}
              className="w-full md:w-auto"
      >
        {loading ? "Saving..." : "Create Info"}
            </Button>
          </div>

      {loading && (
            <div className="space-y-2">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-3/4" />
            </div>
      )}
        </CardContent>
      </Card>
    </div>
  );
}
