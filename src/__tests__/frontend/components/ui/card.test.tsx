// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";

describe("Card components", () => {
  it("renders complete card structure with title, description, content, and footer", () => {
    render(
      <Card>
        <CardHeader>
          <CardTitle>Test Card Title</CardTitle>
          <CardDescription>Test Description</CardDescription>
        </CardHeader>
        <CardContent>
          <p>Main Card Body</p>
        </CardContent>
        <CardFooter>
          <span>Footer Note</span>
        </CardFooter>
      </Card>
    );

    expect(screen.getByText("Test Card Title")).toBeDefined();
    expect(screen.getByText("Test Description")).toBeDefined();
    expect(screen.getByText("Main Card Body")).toBeDefined();
    expect(screen.getByText("Footer Note")).toBeDefined();
  });
});
