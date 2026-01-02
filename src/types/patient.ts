export interface Patient {
  id: string;
  name: string;
  gender: string;
  age: number;
  email: string;
  city?: string;
  state?: string;
  medicalHistory: string[];
  allergies: string[];
  currentMedications: string[];
  profileImageUrl?: string;
}
export interface PatientAppointment {
  id: string;
  appointmentDate: string;
  appointmentTime: string;
  doctorName: string;
  doctorEmail: string;
  city: string;
  state: string;
  fees: string;
  status: string;
  specialty: string;
}