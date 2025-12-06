import { create } from 'zustand';

type UserRole = 'ADMIN' | 'DOCTOR' | 'PATIENT';

interface User {
  userId: string;
  email: string;
  role: UserRole | string;
  name?: string;
  gender?: string;
  age?: number;
  doctorId?: string | null;
  patientId?: string | null;
}

interface UserState {
  user: User | null;

  // Actions
  setUser: (user: User) => void;
  logout: () => void;
  updateUser: (user: Partial<User>) => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,

  setUser: (user: User) => set({ user }),

  logout: () => set({ user: null }),

  updateUser: (updates: Partial<User>) =>
    set((state) => ({
      user: state.user ? { ...state.user, ...updates } : null,
    })),
}));
