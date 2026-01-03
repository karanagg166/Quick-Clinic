import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { PatientMedicalData } from "@/types/patientProfile";

interface MedicalDetailsProps {
    patientId: string | null;
    patientData: PatientMedicalData;
    handlePatientChange: (field: keyof PatientMedicalData, value: string) => void;
}

export function MedicalDetails({
    patientId,
    patientData,
    handlePatientChange,
}: MedicalDetailsProps) {
    return (
        <Card className="shadow-sm">
            <CardHeader>
                <div className="flex items-center justify-between">
                    <div>
                        <CardTitle>Medical Details</CardTitle>
                        <p className="text-sm text-muted-foreground">Keep your care team updated</p>
                    </div>
                    {patientId && <Badge variant="outline">Patient ID: {patientId}</Badge>}
                </div>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="space-y-2">
                    <Label htmlFor="medicalHistory">Medical History</Label>
                    <Textarea
                        id="medicalHistory"
                        value={patientData.medicalHistory}
                        onChange={(e) => handlePatientChange("medicalHistory", e.target.value)}
                        placeholder="Chronic conditions, surgeries, notes"
                        rows={4}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="allergies">Allergies</Label>
                    <Textarea
                        id="allergies"
                        value={patientData.allergies}
                        onChange={(e) => handlePatientChange("allergies", e.target.value)}
                        placeholder="Food, drug, or seasonal allergies"
                        rows={3}
                    />
                </div>

                <div className="space-y-2">
                    <Label htmlFor="currentMedications">Current Medications</Label>
                    <Textarea
                        id="currentMedications"
                        value={patientData.currentMedications}
                        onChange={(e) => handlePatientChange("currentMedications", e.target.value)}
                        placeholder="List active prescriptions"
                        rows={3}
                    />
                </div>
            </CardContent>
        </Card>
    );
}
