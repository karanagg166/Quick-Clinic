"use client";

import { Calendar, Clock } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import Avatar from "@/components/general/Avatar";

export default function AppointmentCard({
  appointment,
  role,
  onDelete,
  onComplete,
  onConfirm,
}: {
  appointment: any;
  role: "patient" | "doctor";
  onDelete?: (id: string) => void;
  onComplete?: (id: string) => void;
  onConfirm?: (id: string) => void;
}) {
  const getStatusVariant = (status: string) => {
    switch (status) {
      case "CANCELLED":
        return "destructive";
      case "COMPLETED":
        return "default";
      case "CONFIRMED":
        return "secondary";
      default:
        return "outline";
    }
  };

  return (
    <Card className="hover:shadow-lg transition-shadow">
      <CardHeader>
        <div className="flex items-start gap-3">
          <Avatar 
            src={role === "patient" ? appointment.doctorImage : appointment.patientImage}
            name={role === "patient" ? appointment.doctorName : (appointment.patientName || "Patient")}
            size="md"
          />
          <div className="flex-1">
            <h2 className="text-lg font-semibold">
              {role === "patient"
                ? `Dr. ${appointment.doctorName}`
                : appointment.patientName
                  ? `Patient: ${appointment.patientName}`
                  : "Patient"}
            </h2>
            {role === "patient" && (
              <p className="text-sm text-muted-foreground font-medium mt-1">{appointment.specialty}</p>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Date */}
        <div className="flex items-center gap-2 text-sm">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">
            {new Date(appointment.slotDate).toDateString()}
          </span>
        </div>

        {/* Time */}
        <div className="flex items-center gap-2 text-sm">
          <Clock className="w-4 h-4 text-muted-foreground" />
          <span className="font-medium">
            {new Date(appointment.slotStart).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
            {" - "}
            {new Date(appointment.slotEnd).toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>

        {/* Status */}
        <div>
          <Badge variant={getStatusVariant(appointment.status)}>
            {appointment.status}
          </Badge>
        </div>

        {/* Notes */}
        {appointment.notes && (
          <p className="text-sm text-muted-foreground">Notes: {appointment.notes}</p>
        )}

        {/* Patient Actions */}
        {role === "patient" && appointment.status !== "CANCELLED" && (
          <Button
            variant="destructive"
            size="sm"
            onClick={() => onDelete && onDelete(appointment.id)}
            className="w-full"
          >
            Cancel Appointment
          </Button>
        )}

        {/* Doctor Actions */}
        {role === "doctor" && (
          <div className="flex flex-col gap-2">
            {appointment.status === "PENDING" && (
              <Button
                variant="default"
                size="sm"
                onClick={() => onConfirm && onConfirm(appointment.id)}
                className="w-full"
              >
                Confirm Appointment
              </Button>
            )}

            {appointment.status !== "COMPLETED" &&
              appointment.status !== "CANCELLED" && (
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => onComplete && onComplete(appointment.id)}
                  className="w-full bg-green-600 hover:bg-green-700"
                >
                  Mark as Completed
                </Button>
              )}

            {appointment.status !== "CANCELLED" && (
              <Button
                variant="destructive"
                size="sm"
                onClick={() => onDelete && onDelete(appointment.id)}
                className="w-full"
              >
                Cancel Appointment
              </Button>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
