// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Avatar from "@/components/general/Avatar";

describe("Avatar component", () => {
  it("renders initials fallback when src is not provided", () => {
    render(<Avatar name="Karan Aggarwal" />);
    const fallback = screen.getByText("KA");
    expect(fallback).toBeDefined();
  });

  it("handles single name initials correctly", () => {
    render(<Avatar name="Doctor" />);
    const fallback = screen.getByText("D");
    expect(fallback).toBeDefined();
  });

  it("renders with default User name if name prop is omitted", () => {
    render(<Avatar />);
    const fallback = screen.getByText("U");
    expect(fallback).toBeDefined();
  });
});
