"use client";

import { AlertCircle } from "lucide-react";
import { AgentChat } from "@/components/ai-agent/AgentChat";
import LoadingSpinner from "@/components/general/LoadingSpinner";
import { Card, CardContent } from "@/components/ui/card";
import { useUserStore } from "@/store/userStore";

export default function PatientAssistantPage() {
  const { user, isLoading, hasHydrated } = useUserStore();

  if (isLoading || hasHydrated === false) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <LoadingSpinner />
      </div>
    );
  }

  if (!user?.id || user.role !== "PATIENT") {
    return (
      <Card className="max-w-2xl mx-auto border shadow-sm">
        <CardContent className="p-6">
          <div className="flex items-center gap-3 text-destructive">
            <AlertCircle className="h-5 w-5" />
            <p className="text-sm font-medium">
              Please log in as a patient to access the AI Care Assistant.
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return <AgentChat role="PATIENT" userId={user.id} userName={user.name} />;
}
