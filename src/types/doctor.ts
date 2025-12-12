export interface Doctor {

  id: string;
  userId?: string;
  name?: string;
  gender?: string;
  email?:string;
  age?: number;
  specialty?: string;
  experience?: number;
  fees?: number;
  qualifications?: string[];
  city?:string;
  state?:string;
  
}
export interface DoctorAppointment{
id:string;
patientName:string;
patientEmail:string;
gender:string;
appointmentDate:string;
appointmentTime:string;
status:string;
city:string;
age:Number;
paymentMethod:string;
}