
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
  gender: string;
  address: string;
  city: string;
  state: string;
  pinCode: number;
  profileImageUrl?: string;
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
  bookedAt: string;
  updatedAt: string;
  isAppointmentOffline: boolean;
  doctor: DoctorDetail;
  patient: PatientDetail;
  slot: SlotDetail;
}

export interface Appointment{
id:string;
doctorId:string;
patientId:string;
patientName:string;
doctorName:string;
slotId:string;
appointmentDate:string;
appointmentTime:string;
bookedAt:string;
status:'SCHEDULED' | 'COMPLETED' | 'CANCELLED';
}

type UserRole = 'ADMIN' | 'DOCTOR' | 'PATIENT';
export interface User {
  userId: string;
  email: string;
  role: UserRole;
  name: string;
  gender: string;
  age: number;
  doctorId: string | null;
  patientId: string | null;
}