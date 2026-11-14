// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AiPetIcon } from "@/components/ai-agent/AiPetIcon";
import { FloatingAgentWidget } from "@/components/ai-agent/FloatingAgentWidget";
import PatientSidebar from "@/components/patient/sidebar";
import DoctorSidebar from "@/components/doctor/sidebar";

let currentPathname = "/patient/assistant";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => currentPathname,
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}));

describe("AI Agent Navigation & Floating Widget", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("renders AI Assistant links in patient and doctor sidebars", () => {
    currentPathname = "/patient/assistant";
    const { unmount } = render(<PatientSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />);
    expect(screen.getByRole("link", { name: /AI Assistant/i }).getAttribute("href")).toBe("/patient/assistant");
    unmount();

    currentPathname = "/doctor/assistant";
    render(<DoctorSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />);
    expect(screen.getByRole("link", { name: /AI Copilot/i }).getAttribute("href")).toBe("/doctor/assistant");
  });

  it("renders AiPetIcon across moods", () => {
    const { rerender } = render(<AiPetIcon size="lg" mood="idle" showGlow />);
    expect(screen.getByTestId("ai-pet-icon").getAttribute("data-mood")).toBe("idle");

    rerender(<AiPetIcon size="xl" mood="thinking" showGlow />);
    expect(screen.getByTestId("ai-pet-icon").getAttribute("data-mood")).toBe("thinking");

    rerender(<AiPetIcon size="sm" mood="excited" />);
    expect(screen.getByTestId("ai-pet-icon").getAttribute("data-mood")).toBe("excited");
  });

  it("opens floating Ask AI pet popover, sends a message, and closes on Escape", async () => {
    currentPathname = "/doctor";
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/ai-agent/threads")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ threads: [], mode: "live" }) });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          threadId: "thr_float_1",
          response: "You have 3 open slots tomorrow.",
          mode: "live",
        }),
      });
    }) as unknown as typeof fetch;

    render(<FloatingAgentWidget role="DOCTOR" />);
    fireEvent.click(screen.getByTestId("floating-ai-pet-trigger"));

    expect(screen.getByTestId("floating-ai-chat-panel")).toBeDefined();
    expect(screen.getByRole("link", { name: /Expand full workspace/i }).getAttribute("href")).toBe("/doctor/assistant");

    fireEvent.change(screen.getByLabelText("Message AI assistant"), {
      target: { value: "Check my slots tomorrow" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => {
      expect(screen.getByText("You have 3 open slots tomorrow.")).toBeDefined();
    });

    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByTestId("floating-ai-chat-panel")).toBeNull();
  });

  it("hides FloatingAgentWidget when already on assistant pages", () => {
    currentPathname = "/patient/assistant";
    const { rerender } = render(<FloatingAgentWidget role="PATIENT" />);
    expect(screen.queryByTestId("floating-ai-pet-trigger")).toBeNull();

    currentPathname = "/doctor/assistant";
    rerender(<FloatingAgentWidget role="DOCTOR" />);
    expect(screen.queryByTestId("floating-ai-pet-trigger")).toBeNull();
  });
});
