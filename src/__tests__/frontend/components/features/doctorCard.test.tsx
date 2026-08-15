// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DoctorCard from "@/components/doctor/doctorCard";
import type { Doctor } from "@/types/doctor";

describe("DoctorCard component", () => {
  const mockDoctor: Doctor = {
    id: "doc_1",
    userId: "u2",
    name: "Dr. Smith",
    email: "smith@example.com",
    phoneNo: "9876543210",
    age: 45,
    gender: "MALE",
    specialty: "CARDIOLOGIST",
    experience: 15,
    fees: 1500,
    city: "New Delhi",
    state: "Delhi",
    address: "Heart Center",
    pinCode: 110001,
    balance: 5000,
    qualifications: ["MBBS", "MD"],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  it("renders doctor profile information accurately", () => {
    render(<DoctorCard doctor={mockDoctor} />);

    expect(screen.getByText("Dr. Smith")).toBeDefined();
    expect(screen.getByText("CARDIOLOGIST")).toBeDefined();
    expect(screen.getByText(/45/)).toBeDefined();
    expect(screen.getByText(/15 years/)).toBeDefined();
    expect(screen.getByText(/\$1500/)).toBeDefined();
    expect(screen.getByText("New Delhi, Delhi")).toBeDefined();
    expect(screen.getByText(/MBBS, MD/)).toBeDefined();
  });
});
