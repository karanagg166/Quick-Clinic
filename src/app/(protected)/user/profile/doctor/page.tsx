"use client";

import { useState, useEffect } from "react";
import { useRouter} from "next/navigation";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
export default function DoctorDetails() {
  const router = useRouter();
  const userId = useUserStore((state) => state.user?.userId);
  const user = useUserStore((state) => state.user);
  const setUser = useUserStore((state) => state.setUser);
  const [fees, setFees] = useState("");
  const [experience, setExperience] = useState("");
  

  const [specialty, setSpecialty] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);

  const [qualification, setQualification] = useState<string[]>([]);
  const [qualifications, setQualifications] = useState<string[]>([]);

  const [loading, setLoading] = useState(false); // button loading
  const [enumLoading, setEnumLoading] = useState(true); // loading enums
  
  // Toggle qualification
  const toggleQualification = (value: string) => {
    setQualification((prev) =>
      prev.includes(value)
        ? prev.filter((item) => item !== value)
        : [...prev, value]
    );
  };

  // ============================
  //  Fetch Enum Lists (GET)
  // ============================
  useEffect(() => {
    const fetchEnums = async () => {
      try {
        setEnumLoading(true);

        const sp = await fetch("/api/doctors/specializations");
        const spData = await sp.json();
        if (sp.ok) setSpecialties(spData.specialties);

        const q = await fetch("/api/doctors/qualifications");
        const qData = await q.json();
        if (q.ok) setQualifications(qData.qualifications);

      } catch (err: unknown) {
        const errorMessage = err instanceof Error ? err.message : "Unknown error";
        console.error("Enum fetch error:", errorMessage);
      } finally {
        setEnumLoading(false);
      }
    };

    fetchEnums();
  }, []);

  // ============================
  //  CREATE Doctor Info (POST)
  // ============================
  const handleCreateInfo = async () => {
    if (!userId || Array.isArray(userId)) {
      showToast.error("Missing user id from URL.");
      return;
    }

    // Basic Validation
    if (!fees || !experience || !specialty) {
      showToast.warning("Please fill all required fields.");
      return;
    }

    try {
      setLoading(true);

      const response = await fetch("/api/doctors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId,
          fees: Number(fees),
          specialty,
          experience: Number(experience),
          qualifications: qualification,
        }),
      });

      const data = await response.json();

      if (response.ok) {
        // Update store with doctorId
        if (user) {
          setUser(user, undefined, data.doctor.id);
        }
        showToast.success("Doctor info created successfully.");
        router.push(`/doctor/schedule`);
      } else {
        showToast.error("Error creating doctor info: " + data.error);
      }

    } catch (err: unknown) {
      const errorMessage = err instanceof Error ? err.message : "Unknown error";
      showToast.error("Create error: " + errorMessage);
    } finally {
      setLoading(false);
    }
  };

  // ============================
  //  UI
  // ============================
  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Doctor Information</h1>
        <p className="text-muted-foreground">Complete your professional profile</p>
      </div>

      <Card className="max-w-2xl border shadow-sm">
        <CardHeader>
          <CardTitle>Professional Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Loading for ENUM fetch */}
          {enumLoading && (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          )}

          {!enumLoading && (
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

              {/* SPECIALTY */}
              <div className="space-y-2">
                <Label htmlFor="specialty">Specialty</Label>
                <Select value={specialty} onValueChange={setSpecialty}>
                  <SelectTrigger id="specialty">
                    <SelectValue placeholder="Select specialty" />
                  </SelectTrigger>
                  <SelectContent>
                    {specialties.map((sp) => (
                      <SelectItem key={sp} value={sp}>
                        {sp}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* QUALIFICATIONS */}
              <div className="space-y-2">
                <Label>Qualifications</Label>
                <Card className="p-4 max-h-48 overflow-y-auto">
                  <div className="space-y-3">
                    {qualifications.length > 0 ? (
                      qualifications.map((q) => (
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
                    ) : (
                      <p className="text-sm text-muted-foreground">Loading qualifications...</p>
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
                  onClick={handleCreateInfo}
                  disabled={loading}
                  className="w-full"
                >
                  {loading ? "Saving..." : "Create Info"}
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}