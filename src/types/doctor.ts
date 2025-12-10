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