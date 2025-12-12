
import type { DoctorAppointment } from "@/types/doctor";

export default function AppointmentCard({ appointment }: { appointment: DoctorAppointment }) {
  return (
    <div className="p-4 bg-white rounded-lg shadow-md border hover:shadow-lg transition space-y-1">

      <h1 className="text-xl font-semibold">Appointment Details</h1>

      {/* <p><strong>ID:</strong> {appointment.id}</p> */}

      <p><strong>Patient Name:</strong> {appointment.patientName}</p>

      <p><strong>Gender:</strong> {appointment.gender}</p>

      <p><strong>Date:</strong> {appointment.appointmentDate}</p>

      <p><strong>Time:</strong> {appointment.appointmentTime}</p>

      <p><strong>Status:</strong> {appointment.status}</p>

      <p><strong>City:</strong> {appointment.city}</p>

      <p><strong>Age:</strong> {Number(appointment.age)}</p>

    </div>
  );
}
