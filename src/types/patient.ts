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
}