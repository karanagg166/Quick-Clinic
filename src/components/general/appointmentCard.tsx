"use client";

import { Calendar, User, Clock } from "lucide-react";
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
  return (
    <div className="p-4 bg-white rounded-lg shadow-md border hover:shadow-lg transition">
      {/* ========== DOCTOR/PATIENT INFO WITH AVATAR ========== */}
      <div className="flex items-start gap-3 pb-3 border-b mb-3">
        <Avatar 
          src={role === "patient" ? appointment.doctorImage : appointment.patientImage}
          name={role === "patient" ? appointment.doctorName : (appointment.patientName || "Patient")}
          size="md"
        />
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-gray-900">
            {role === "patient"
              ? `Dr. ${appointment.doctorName}`
              : appointment.patientName
                ? `Patient: ${appointment.patientName}`
                : "Patient"}
          </h2>
          {role === "patient" && (
            <p className="text-sm text-gray-600 font-medium">{appointment.specialty}</p>
          )}
        </div>
      </div>

      {/* ========== DATE ========== */}
      <p className="text-sm text-gray-700 mb-2 flex items-center gap-2">
        <Calendar className="w-4 h-4" />
        <span className="font-medium">
          {new Date(appointment.slotDate).toDateString()}
        </span>
      </p>

      {/* ========== TIME ========== */}
      <p className="text-sm text-gray-700 mb-2 flex items-center gap-2">
        <Clock className="w-4 h-4" />
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
      </p>

      {/* ========== STATUS ========== */}
      <p className="text-sm text-gray-700 mb-2">
        <span
          className={`font-bold ${
            appointment.status === "CANCELLED"
              ? "text-red-600"
              : appointment.status === "COMPLETED"
              ? "text-green-600"
              : appointment.status === "CONFIRMED"
              ? "text-blue-600"
              : "text-yellow-600"
          }`}
        >
          {appointment.status}
        </span>
      </p>

      {/* ========== NOTES ========== */}
      {appointment.notes && (
        <p className="text-sm text-gray-600 mt-2">Notes: {appointment.notes}</p>
      )}

      {/* ======================================================== */}
      {/* ========== PATIENT SIDE ACTIONS ========== */}
      {/* ======================================================== */}

      {role === "patient" && appointment.status !== "CANCELLED" && (
        <button
          onClick={() => onDelete && onDelete(appointment.id)}
          className="mt-4 bg-red-600 text-white px-4 py-1.5 rounded-md text-sm hover:bg-red-700 transition"
        >
          Cancel Appointment
        </button>
      )}

      {/* ======================================================== */}
      {/* ========== DOCTOR SIDE ACTIONS ========== */}
      {/* ======================================================== */}

      {role === "doctor" && (
        <div className="mt-4 flex flex-col gap-2">
          {/* Confirm (only if pending) */}
          {appointment.status === "PENDING" && (
            <button
              onClick={() => onConfirm && onConfirm(appointment.id)}
              className="bg-blue-600 text-white px-4 py-1.5 rounded-md text-sm hover:bg-blue-700 transition"
            >
              Confirm Appointment
            </button>
          )}

          {/* Mark Complete */}
          {appointment.status !== "COMPLETED" &&
            appointment.status !== "CANCELLED" && (
              <button
                onClick={() => onComplete && onComplete(appointment.id)}
                className="bg-green-600 text-white px-4 py-1.5 rounded-md text-sm hover:bg-green-700 transition"
              >
                Mark as Completed
              </button>
            )}

          {/* Cancel */}
          {appointment.status !== "CANCELLED" && (
            <button
              onClick={() => onDelete && onDelete(appointment.id)}
              className="bg-red-600 text-white px-4 py-1.5 rounded-md text-sm hover:bg-red-700 transition"
            >
              Cancel Appointment
            </button>
          )}
        </div>
      )}
    </div>
  );
}
