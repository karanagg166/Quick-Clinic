export interface Patient {
  id: string;
  name: string;
  gender: string;
  age: number;
  email: string;
  phoneNo?: string;
  city?: string;
  state?: string;
  medicalHistory: string | string[];
  allergies: string | string[];
  currentMedications: string | string[];
  profileImageUrl?: string;
  appointments?: {
    id: string;
    status: string;
    bookedAt: string;
    paymentMethod: string;
    transactionId?: string | null;
    isAppointmentOffline: boolean;
    notes?: string | null;
    slot?: {
      date: string;
      startTime: string;
      endTime: string;
    };
  }[];
}

export interface PatientAppointment {
  id: string;
  appointmentDate: string;
  appointmentTime: string;
  doctorName: string;
  doctorEmail: string;
  city: string;
  state: string;
  fees: number;
  status: string;
  specialty: string;
}