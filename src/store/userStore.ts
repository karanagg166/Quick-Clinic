import { create } from 'zustand';
import { persist, PersistStorage } from 'zustand/middleware';

type UserRole = 'ADMIN' | 'DOCTOR' | 'PATIENT';

interface User {
  userId: string;
  email: string;
  phoneNo?: string;
  name?: string;
  gender?: string;
  age?: number;
  role: UserRole;
}

interface UserState {
  user: User | null;
  patientId: string | null;
  doctorId: string | null;
  isLoading: boolean;

  // Actions
  setUser: (user: User, patientId?: string, doctorId?: string) => void;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
  setLoading: (loading: boolean) => void;
}

export const useUserStore = create<
  UserState,
  [['zustand/persist', UserState]]
>(
  persist(
    (set) => ({
      user: null,
      patientId: null,
      doctorId: null,
      isLoading: false,

      setUser: (user: User, patientId?: string, doctorId?: string) =>
        set({
          user,
          patientId: patientId || null,
          doctorId: doctorId || null,
        }),

      logout: () =>
        set({
          user: null,
          patientId: null,
          doctorId: null,
          isLoading: false,
        }),

      updateUser: (updates: Partial<User>) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setLoading: (loading: boolean) => set({ isLoading: loading }),
    }),
    {
      name: 'user-store',
    }
  )
);
