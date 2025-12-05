import { create } from 'zustand';

interface PatientRecord {
  id: string;
  name: string;
  email: string;
  lastVisit?: string;
}

interface DoctorState {
  patients: PatientRecord[];
  schedule: any[];
  
  // Actions
  setPatients: (patients: PatientRecord[]) => void;
  addPatient: (patient: PatientRecord) => void;
  setSchedule: (schedule: any[]) => void;
  clearDoctorData: () => void;
}

export const useDoctorStore = create<DoctorState>((set) => ({
  patients: [],
  schedule: [],

  setPatients: (patients) => set({ patients }),

  addPatient: (patient) =>
    set((state) => ({
      patients: [...state.patients, patient],
    })),

  setSchedule: (schedule) => set({ schedule }),

  clearDoctorData: () =>
    set({
      patients: [],
      schedule: [],
    }),
}));
