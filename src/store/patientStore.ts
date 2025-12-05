import { create } from 'zustand';

interface Appointment {
  id: string;
  doctorId: string;
  doctorName: string;
  date: string;
  status: 'scheduled' | 'completed' | 'cancelled';
}

interface PatientState {
  appointments: Appointment[];
  selectedDoctor: string | null;
  
  // Actions
  setAppointments: (appointments: Appointment[]) => void;
  addAppointment: (appointment: Appointment) => void;
  updateAppointment: (id: string, updates: Partial<Appointment>) => void;
  setSelectedDoctor: (doctorId: string | null) => void;
  clearPatientData: () => void;
}

export const usePatientStore = create<PatientState>((set) => ({
  appointments: [],
  selectedDoctor: null,

  setAppointments: (appointments) => set({ appointments }),

  addAppointment: (appointment) =>
    set((state) => ({
      appointments: [...state.appointments, appointment],
    })),

  updateAppointment: (id, updates) =>
    set((state) => ({
      appointments: state.appointments.map((apt) =>
        apt.id === id ? { ...apt, ...updates } : apt
      ),
    })),

  setSelectedDoctor: (doctorId) => set({ selectedDoctor: doctorId }),

  clearPatientData: () =>
    set({
      appointments: [],
      selectedDoctor: null,
    }),
}));
