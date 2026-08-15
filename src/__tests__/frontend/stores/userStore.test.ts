import { describe, it, expect, beforeEach } from "vitest";

const storageMap = new Map<string, string>();
const localStorageMock = {
  getItem: (key: string) => storageMap.get(key) ?? null,
  setItem: (key: string, value: string) => { storageMap.set(key, value); },
  removeItem: (key: string) => { storageMap.delete(key); },
  clear: () => { storageMap.clear(); },
  length: 0,
  key: (i: number) => null,
};

Object.defineProperty(globalThis, "localStorage", {
  value: localStorageMock,
  writable: true,
  configurable: true,
});

if (typeof window !== "undefined") {
  Object.defineProperty(window, "localStorage", {
    value: localStorageMock,
    writable: true,
    configurable: true,
  });
}

import { useUserStore } from "@/store/userStore";
import type { UserDetail } from "@/types/common";

describe("useUserStore", () => {
  const mockUser: UserDetail = {
    id: "user_123",
    name: "Karan Aggarwal",
    email: "karan@gmail.com",
    phoneNo: "7838222130",
    age: 22,
    gender: "MALE",
    role: "PATIENT",
    address: "Flat 1",
    city: "Faridabad",
    state: "Haryana",
    pinCode: 121004,
    emailVerified: true,
    patientId: "patient_123",
    doctorId: null,
  };

  beforeEach(() => {
    storageMap.clear();
    useUserStore.getState().logout();
  });

  it("should initialize with default empty state", () => {
    const state = useUserStore.getState();
    expect(state.user).toBeNull();
    expect(state.patientId).toBeNull();
    expect(state.doctorId).toBeNull();
    expect(state.isLoading).toBe(false);
  });

  it("should set user, patientId, and doctorId via setUser", () => {
    useUserStore.getState().setUser(mockUser, "patient_123", "doctor_456");
    const state = useUserStore.getState();

    expect(state.user).toEqual(mockUser);
    expect(state.patientId).toBe("patient_123");
    expect(state.doctorId).toBe("doctor_456");
  });

  it("should update patientId independently", () => {
    useUserStore.getState().setPatientId("patient_new_999");
    expect(useUserStore.getState().patientId).toBe("patient_new_999");
  });

  it("should update doctorId independently", () => {
    useUserStore.getState().setDoctorId("doc_new_888");
    expect(useUserStore.getState().doctorId).toBe("doc_new_888");
  });

  it("should update partial user fields via updateUser", () => {
    useUserStore.getState().setUser(mockUser);
    useUserStore.getState().updateUser({ name: "Updated Karan", age: 23 });

    const state = useUserStore.getState();
    expect(state.user?.name).toBe("Updated Karan");
    expect(state.user?.age).toBe(23);
    expect(state.user?.email).toBe("karan@gmail.com");
  });

  it("should toggle isLoading via setLoading", () => {
    useUserStore.getState().setLoading(true);
    expect(useUserStore.getState().isLoading).toBe(true);

    useUserStore.getState().setLoading(false);
    expect(useUserStore.getState().isLoading).toBe(false);
  });

  it("should reset state on logout", () => {
    useUserStore.getState().setUser(mockUser, "patient_123");
    useUserStore.getState().logout();

    const state = useUserStore.getState();
    expect(state.user).toBeNull();
    expect(state.patientId).toBeNull();
    expect(state.doctorId).toBeNull();
    expect(state.isLoading).toBe(false);
  });
});
