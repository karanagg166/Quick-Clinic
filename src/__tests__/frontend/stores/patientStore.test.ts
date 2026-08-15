import { describe, it, expect, beforeEach } from "vitest";
import { usePatientStore } from "@/store/patientStore";

describe("usePatientStore", () => {
  beforeEach(() => {
    usePatientStore.getState().clearPatientData();
  });

  it("should initialize with default empty state", () => {
    const state = usePatientStore.getState();
    expect(state.appointments).toEqual([]);
    expect(state.selectedDoctor).toBeNull();
  });

  it("should set appointments list", () => {
    const appointments = [
      { id: "a1", doctorId: "d1", doctorName: "Dr. Smith", date: "2026-08-20", status: "scheduled" as const },
    ];
    usePatientStore.getState().setAppointments(appointments);
    expect(usePatientStore.getState().appointments).toEqual(appointments);
  });

  it("should add a single appointment via addAppointment", () => {
    const apt = { id: "a2", doctorId: "d2", doctorName: "Dr. Jane", date: "2026-08-21", status: "scheduled" as const };
    usePatientStore.getState().addAppointment(apt);
    expect(usePatientStore.getState().appointments).toContainEqual(apt);
  });

  it("should update appointment by id", () => {
    const apt = { id: "a3", doctorId: "d3", doctorName: "Dr. Who", date: "2026-08-22", status: "scheduled" as const };
    usePatientStore.getState().addAppointment(apt);
    usePatientStore.getState().updateAppointment("a3", { status: "completed" });

    const updated = usePatientStore.getState().appointments.find((a) => a.id === "a3");
    expect(updated?.status).toBe("completed");
  });

  it("should set selected doctor", () => {
    usePatientStore.getState().setSelectedDoctor("doctor_123");
    expect(usePatientStore.getState().selectedDoctor).toBe("doctor_123");
  });

  it("should reset state on clearPatientData", () => {
    usePatientStore.getState().setSelectedDoctor("doc_1");
    usePatientStore.getState().addAppointment({ id: "a1", doctorId: "d1", doctorName: "Dr. Smith", date: "2026-08-20", status: "scheduled" });
    usePatientStore.getState().clearPatientData();

    const state = usePatientStore.getState();
    expect(state.appointments).toEqual([]);
    expect(state.selectedDoctor).toBeNull();
  });
});
