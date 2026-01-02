
export interface Slot {
  id: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED';
  date: string;
}

export interface UserDetail {
  id: string;
  email: string;
  phoneNo: string;
  name: string;
  age: number;

  gender: 'MALE' | 'FEMALE' | 'BINARY';
  role: 'ADMIN' | 'DOCTOR' | 'PATIENT';
  patientId?: string | null;
  doctorId?: string | null;
  adminId?: string | null;
  address: string;
  city: string;
  state: string;
  pinCode: number;

  profileImageUrl?: string;
  emailVerified: boolean;
}

export interface PatientDetail {
  id: string;
  userId: string;
  medicalHistory: string;
  allergies: string;
  currentMedications: string;
  user: UserDetail;
}

export interface DoctorDetail {
  id: string;
  userId: string;
  specialty: string;
  experience: number;
  qualifications: string[];
  fees: number;
  user: UserDetail;
}

export interface SlotDetail {
  id: string;
  doctorId: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED';
}

export interface AppointmentDetail {
  id: string;
  doctorId: string;
  patientId: string;
  slotId: string;
  status: 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED';
  paymentMethod: 'OFFLINE' | 'ONLINE';
  transactionId: string | null;
  notes: string | null;
  city: string | null;
  state: string | null;
  bookedAt: string;
  updatedAt: string;
  isAppointmentOffline: boolean;
  doctor: DoctorDetail;
  patient: PatientDetail;
  slot: SlotDetail;
}

export interface Appointment {
  id: string;
  doctorId: string;
  patientId: string;
  patientName: string;
  doctorName: string;
  slotId: string;
  appointmentDate: string;
  appointmentTime: string;
  bookedAt: string;
  status: 'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
}
