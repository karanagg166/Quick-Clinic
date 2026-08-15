import { describe, it, expect, beforeEach } from "vitest";
import { useDoctorStore } from "@/store/doctorStore";

describe("useDoctorStore", () => {
  beforeEach(() => {
    useDoctorStore.getState().clearDoctorData();
  });

  it("should initialize with empty patients and schedule", () => {
    const state = useDoctorStore.getState();
    expect(state.patients).toEqual([]);
    expect(state.schedule).toEqual([]);
  });

  it("should set patients array", () => {
    const patients = [
      { id: "p1", name: "Alice", email: "alice@example.com" },
      { id: "p2", name: "Bob", email: "bob@example.com" },
    ];
    useDoctorStore.getState().setPatients(patients);
    expect(useDoctorStore.getState().patients).toEqual(patients);
  });

  it("should add a single patient via addPatient", () => {
    const patient = { id: "p3", name: "Charlie", email: "charlie@example.com" };
    useDoctorStore.getState().addPatient(patient);
    expect(useDoctorStore.getState().patients).toContainEqual(patient);
  });

  it("should set schedule array", () => {
    const schedule = [{ day: "Monday", slots: [{ slotNo: 1, start: "09:00", end: "12:00" }] }];
    useDoctorStore.getState().setSchedule(schedule);
    expect(useDoctorStore.getState().schedule).toEqual(schedule);
  });

  it("should clear data on clearDoctorData", () => {
    useDoctorStore.getState().addPatient({ id: "p1", name: "Alice", email: "alice@example.com" });
    useDoctorStore.getState().setSchedule([{ day: "Monday" }]);
    useDoctorStore.getState().clearDoctorData();

    const state = useDoctorStore.getState();
    expect(state.patients).toEqual([]);
    expect(state.schedule).toEqual([]);
  });
});
