"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, ShieldAlert } from "lucide-react";

interface MedicalRecordAccessDeniedProps {
  reason?: string;
}

export function MedicalRecordAccessDenied({ reason }: MedicalRecordAccessDeniedProps) {
  return (
    <div className="p-4 sm:p-6 max-w-4xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" asChild className="gap-1.5">
        <Link href="/doctor/patients">
          <ArrowLeft className="w-4 h-4" /> Back to Patient Roster
        </Link>
      </Button>

      <Card className="border-rose-200 dark:border-rose-900 bg-rose-50/50 dark:bg-rose-950/20">
        <CardContent className="p-8 text-center space-y-4">
          <div className="w-14 h-14 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-400 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-foreground">Medical Records Access Denied</h2>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            {reason ||
              "You can only view medical documents for patients with whom you have a scheduled (CONFIRMED) or past (COMPLETED) appointment."}
          </p>
          <div className="pt-2">
            <Button asChild>
              <Link href="/doctor/patients">Return to Patient Roster</Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
