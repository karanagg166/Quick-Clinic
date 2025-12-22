"use client";

import type { Patient } from "@/types/patient";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import Avatar from "@/components/general/Avatar";

export default function PatientCard({ patient }: { patient: Patient }) {
  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start gap-4">
          <Avatar 
            src={patient.profileImageUrl} 
            name={patient.name}
            size="lg"
          />
          <div className="flex-1">
            <h2 className="text-xl font-bold">{patient.name}</h2>
            <p className="text-sm text-muted-foreground">{patient.email}</p>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <Separator />
        
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="font-medium">Age:</span>
            <span className="text-muted-foreground">{patient.age}</span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium">Gender:</span>
            <span className="text-muted-foreground">{patient.gender}</span>
          </div>
          
          {patient.city && (
            <div className="flex justify-between">
              <span className="font-medium">City:</span>
              <span className="text-muted-foreground">{patient.city}</span>
            </div>
          )}
          {patient.state && (
            <div className="flex justify-between">
              <span className="font-medium">State:</span>
              <span className="text-muted-foreground">{patient.state}</span>
            </div>
          )}

          <Separator />

          <div>
            <span className="font-medium">Medical History:</span>
            <p className="text-muted-foreground mt-1">{patient.medicalHistory || "None"}</p>
          </div>
          <div>
            <span className="font-medium">Allergies:</span>
            <p className="text-muted-foreground mt-1">{patient.allergies || "None"}</p>
          </div>
          <div>
            <span className="font-medium">Medications:</span>
            <p className="text-muted-foreground mt-1">{patient.currentMedications || "None"}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
