// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Label } from "@/components/ui/label";

describe("Label component", () => {
  it("renders with text and htmlFor attribute", () => {
    render(<Label htmlFor="email-input">Email Address</Label>);
    const label = screen.getByText("Email Address");
    expect(label).toBeDefined();
    expect(label.getAttribute("for")).toBe("email-input");
  });
});
