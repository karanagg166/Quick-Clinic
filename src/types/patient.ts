export interface Patient {
  id: string;
  userId?: string;
  name: string;
  gender: string;
  age: number;
  email: string;
  phoneNo: string;             // ✅ added
  city?: string;
  state?: string;
  medicalHistory: string[];
  allergies: string[];
  currentMedications: string[];
}

export interface PatientAppointment{
id:string;
appointmentDate:string;
appointmentTime:string;
doctorName:string;
doctorEmail:string;
city:string;
fees:string;
status:string;
specialty:string;
}