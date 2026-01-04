import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { UserDetail } from '@/types/common';


interface UserState {
  user: UserDetail | null;
  patientId: string | null;
  doctorId: string | null;
  isLoading: boolean;
  hasHydrated?: boolean;

  // Actions
  setUser: (user: UserDetail, patientId?: string, doctorId?: string) => void;
  setPatientId: (patientId: string | null) => void;
  setDoctorId: (doctorId: string | null) => void;
  logout: () => void;
  updateUser: (updates: Partial<UserDetail>) => void;
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

      setUser: (user: UserDetail, patientId?: string, doctorId?: string) =>
        set({
          user,
          patientId: patientId || null,
          doctorId: doctorId || null,
        }),

      setPatientId: (patientId: string | null) =>
        set({ patientId }),

      setDoctorId: (doctorId: string | null) =>
        set({ doctorId }),

      logout: () =>
        set({
          user: null,
          patientId: null,
          doctorId: null,
          isLoading: false,
        }),

      updateUser: (updates: Partial<UserDetail>) =>
        set((state) => ({
          user: state.user ? { ...state.user, ...updates } : null,
        })),

      setLoading: (loading: boolean) => set({ isLoading: loading }),
    }),
    {
      name: 'user-store',
      version: 1,
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.hasHydrated = true;
        }
      },
      migrate: (persistedState: any, _version: number) => {
        if (!persistedState?.user) return persistedState;

        const migratedUser = persistedState.user;

        // Rename legacy userId/isVerified fields to id/emailVerified
        if (!migratedUser.id && migratedUser.userId) {
          migratedUser.id = migratedUser.userId;
          delete migratedUser.userId;
        }

        if (migratedUser.isVerified !== undefined && migratedUser.emailVerified === undefined) {
          migratedUser.emailVerified = migratedUser.isVerified;
          delete migratedUser.isVerified;
        }

        if (migratedUser.patientId === undefined) {
          migratedUser.patientId = null;
        }

        if (migratedUser.doctorId === undefined) {
          migratedUser.doctorId = null;
        }

        return { ...persistedState, user: migratedUser } as UserState;
      },
    }
  )
);
