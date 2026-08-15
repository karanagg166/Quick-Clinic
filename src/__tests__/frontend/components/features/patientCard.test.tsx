// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import PatientCard from "@/components/patient/patientCard";
import type { Patient } from "@/types/patient";

describe("PatientCard component", () => {
  const mockPatient: Patient = {
    id: "pat_1",
    userId: "u1",
    name: "John Doe",
    email: "john@example.com",
    phoneNo: "1234567890",
    age: 30,
    gender: "MALE",
    city: "Mumbai",
    state: "Maharashtra",
    address: "Street 1",
    pinCode: 400001,
    medicalHistory: "Asthma",
    allergies: "Peanuts",
    currentMedications: "Inhaler",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders patient information accurately", () => {
    render(<PatientCard patient={mockPatient} />);

    expect(screen.getByText("John Doe")).toBeDefined();
    expect(screen.getByText("john@example.com")).toBeDefined();
    expect(screen.getByText("30")).toBeDefined();
    expect(screen.getByText("MALE")).toBeDefined();
    expect(screen.getByText("Mumbai")).toBeDefined();
    expect(screen.getByText("Maharashtra")).toBeDefined();
    expect(screen.getByText("Asthma")).toBeDefined();
    expect(screen.getByText("Peanuts")).toBeDefined();
    expect(screen.getByText("Inhaler")).toBeDefined();
  });
});
