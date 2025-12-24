"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";

export default function DoctorInfo() {
  const { doctorId } = useUserStore();
  //  console.log(user, doctorId);
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");

  const [specialty, setSpecialty] = useState(""); // selected
  const [specialties, setSpecialties] = useState<string[]>([]); // list

  const [qualification, setQualification] = useState<string[]>([]); // selected
  const [qualifications, setQualifications] = useState<string[]>([]); // list

  const toggleQualification = (value: string) => {
    setQualification((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value) // remove
        : [...prev, value] // add
    );
  };

  const [loading, setLoading] = useState(false);

  // GET DOCTOR INFO
  useEffect(() => {
    // console.log(user, doctorId);

    const handleGetInfo = async () => {
      try {
        if (!doctorId) {
          console.log("Doctor not created yet.");
          return;
        }

        setLoading(true);

        const response = await fetch(`/api/doctors/${doctorId}`);
        const data = await response.json();
// console.log("Fetched doctor data:", data);
        if (response.ok) {
          setFees(String(data.doctor.fees));
          setExperience(String(data.doctor.experience));
          setSpecialty(data.doctor.specialty);
          setQualification(data.doctor.qualifications || []);
        }

      } catch (err: unknown) {
        console.error("Doctor not created yet.", err);
      } finally {
        setLoading(false);
      }
    };

    handleGetInfo();
  }, [doctorId]);

  // GET ENUM VALUES (qualifications, specializations)
  useEffect(() => {
    const fetchEnums = async () => {
      try {
        const sp = await fetch("/api/doctors/specializations");
        const spData = await sp.json();
        if (sp.ok) setSpecialties(spData.specialties);

        const q = await fetch("/api/doctors/qualifications");
        const qData = await q.json();
        if (q.ok) setQualifications(qData.qualifications);
      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error("Enum fetch error:", errorMessage);
      }
    };

    fetchEnums();
  }, []);

  // UPDATE DOCTOR INFO
  const handleUpdateInfo = async () => {
    try {
      if (!doctorId) {
        showToast.error("Doctor ID not found");
        return;
      }

      setLoading(true);
      console.log(doctorId);

      const response = await fetch(`/api/doctors/${doctorId}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fees: Number(fees),
          specialty,
          experience: Number(experience),
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      console.log(data);

      if (response.ok) {
        showToast.success("Doctor info updated successfully.");
      } else {
        showToast.error("Error updating doctor info: " + data.error);
      }
    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      showToast.error("Error updating doctor info: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

 

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Doctor Information</h1>
        <p className="text-muted-foreground">Update your professional details</p>
      </div>

      <Card className="max-w-2xl">
        <CardHeader>
          <CardTitle>Professional Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <>
              {/* FEES */}
              <div className="space-y-2">
                <Label htmlFor="fees">Fees (₹)</Label>
                <Input
                  id="fees"
                  type="number"
                  value={fees}
                  onChange={(e) => setFees(e.target.value)}
                  placeholder="Enter consultation fees"
                />
              </div>

              {/* EXPERIENCE */}
              <div className="space-y-2">
                <Label htmlFor="experience">Experience (years)</Label>
                <Input
                  id="experience"
                  type="number"
                  value={experience}
                  onChange={(e) => setExperience(e.target.value)}
                  placeholder="Years of experience"
                />
              </div>

              {/* SPECIALITY — SINGLE SELECT */}
              <div className="space-y-2">
                <Label htmlFor="specialty">Specialty</Label>
                <Select value={specialty} onValueChange={setSpecialty}>
                  <SelectTrigger id="specialty">
                    <SelectValue placeholder="Select specialty" />
                  </SelectTrigger>
                  <SelectContent>
                    {specialties.map((sp: string) => (
                      <SelectItem key={sp} value={sp}>
                        {sp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* QUALIFICATIONS — MULTIPLE SELECT */}
              <div className="space-y-2">
                <Label>Qualifications</Label>
                <Card className="p-4 max-h-48 overflow-y-auto">
                  <div className="space-y-3">
                    {qualifications.length === 0 ? (
                      <p className="text-sm text-muted-foreground">Loading qualifications...</p>
                    ) : (
                      qualifications.map((q: string) => (
                        <div key={q} className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            id={`qual-${q}`}
                            checked={qualification.includes(q)}
                            onChange={() => toggleQualification(q)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                          <Label htmlFor={`qual-${q}`} className="cursor-pointer text-sm font-normal">
                            {q}
                          </Label>
                        </div>
                      ))
                    )}
                  </div>
                </Card>
                {qualification.length > 0 && (
                  <div className="flex flex-wrap gap-2 mt-2">
                    {qualification.map((q) => (
                      <Badge key={q} variant="secondary">{q}</Badge>
                    ))}
                  </div>
                )}
              </div>

              {/* BUTTON */}
              <div className="pt-4">
                <Button
                  onClick={handleUpdateInfo}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Updating..." : "Update Info"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
