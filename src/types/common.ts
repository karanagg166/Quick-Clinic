
export interface Slot {
    id: string;
    startTime: string;
    endTime: string;
    status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED';
    date: string;
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
export interface User {
  userId: string;
  email: string;
  role: string;
  name: string;
  gender: string;
  age: number;
  doctorId: string | null;
  patientId: string | null;
}