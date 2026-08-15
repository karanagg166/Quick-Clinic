// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { Badge } from "@/components/ui/badge";

describe("Badge component", () => {
  it("renders with default variant", () => {
    render(<Badge>Active</Badge>);
    const badge = screen.getByText("Active");
    expect(badge).toBeDefined();
  });

  it("renders secondary and destructive variants", () => {
    const { container: secContainer } = render(
      <Badge variant="secondary">Secondary</Badge>
    );
    expect(secContainer.textContent).toBe("Secondary");

    const { container: desContainer } = render(
      <Badge variant="destructive">Error</Badge>
    );
    expect(desContainer.textContent).toBe("Error");
  });
});
