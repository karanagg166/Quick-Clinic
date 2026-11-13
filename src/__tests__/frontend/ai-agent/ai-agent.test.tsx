// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  generateIdempotencyKey,
  validateAgentMessage,
} from "@/lib/ai-agent/client";
import { MAX_AGENT_MESSAGE_LENGTH } from "@/lib/ai-agent/types";
import { ToolActivity } from "@/components/ai-agent/ToolActivity";
import { ApprovalCard } from "@/components/ai-agent/ApprovalCard";
import { AgentChat } from "@/components/ai-agent/AgentChat";
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
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    loading: vi.fn(),
  },
}));

describe("Quick-Clinic AI Agent Frontend Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    const store = new Map<string, string>();
    Object.defineProperty(window, "localStorage", {
      value: {
        getItem: (key: string) => store.get(key) ?? null,
        setItem: (key: string, val: string) => {
          store.set(key, String(val));
        },
        removeItem: (key: string) => {
          store.delete(key);
        },
        clear: () => {
          store.clear();
        },
      },
      configurable: true,
    });
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  describe("1. Guardrail Validation & Idempotency", () => {
    it("rejects empty, oversized, and control-character messages", () => {
      expect(validateAgentMessage("   ").valid).toBe(false);
      expect(validateAgentMessage("a".repeat(MAX_AGENT_MESSAGE_LENGTH + 1)).valid).toBe(false);
      expect(validateAgentMessage("hello\x00world").valid).toBe(false);

      const valid = validateAgentMessage("  Check Dr. Sharma slots\nfor tomorrow\tplease  ");
      expect(valid.valid).toBe(true);
      expect(valid.sanitized).toBe("Check Dr. Sharma slots\nfor tomorrow\tplease");
    });

    it("generates idempotency keys within backend length bounds (16-128)", () => {
      const key = generateIdempotencyKey("appt");
      expect(key.length).toBeGreaterThanOrEqual(16);
      expect(key.length).toBeLessThanOrEqual(128);
    });
  });

  describe("2. ToolActivity Component", () => {
    it("displays summary and expands to reveal tool metadata and risk tier", () => {
      render(
        <ToolActivity
          activities={[
            {
              id: "tool-1",
              toolName: "DoctorSchedulingToolInterface.get_available_slots",
              actionType: "CHECK_AVAILABILITY",
              riskLevel: "LOW_AUTONOMOUS",
              status: "completed",
              summary: "Inspected open consultation slots.",
              startedAt: new Date().toISOString(),
              metadata: { date: "2026-11-14", count: 4 },
            },
          ]}
        />
      );

      const toggle = screen.getByRole("button", { name: /1 tool step: CHECK_AVAILABILITY/i });
      expect(toggle).toBeDefined();
      expect(screen.queryByText(/Inspected open consultation slots/i)).toBeNull();

      fireEvent.click(toggle);

      expect(screen.getByText(/DoctorSchedulingToolInterface\.get_available_slots/)).toBeDefined();
      expect(screen.getByText("Read-only")).toBeDefined();
      expect(screen.getByText("date: 2026-11-14")).toBeDefined();
      expect(screen.getByText("count: 4")).toBeDefined();
    });
  });

  describe("3. ApprovalCard Component", () => {
    it("handles pending sign-off, note entry, approve/reject callbacks, and expired state", () => {
      const onDecide = vi.fn();
      const futureIso = new Date(Date.now() + 10 * 60 * 1000).toISOString();

      const { rerender } = render(
        <ApprovalCard
          approval={{
            approvalId: "appr_123",
            actionType: "PROPOSE_APPOINTMENT",
            riskLevel: "MEDIUM_HUMAN_APPROVAL",
            status: "PENDING",
            title: "Approve 10-Minute Slot Hold",
            summary: "Hold slot with Dr. Mehta at 10:00 AM.",
            reason: "Patient requested morning slot",
            parameters: { doctorId: "doc_1", slotId: "slot_9" },
            idempotencyKey: "qc_agent_1234567890abcdef",
            expiresAt: futureIso,
          }}
          onDecide={onDecide}
        />
      );

      expect(screen.getByText("Approve 10-Minute Slot Hold")).toBeDefined();
      expect(screen.getByText(/Awaiting Sign-off/i)).toBeDefined();

      const noteInput = screen.getByLabelText(/Approval decision note/i);
      fireEvent.change(noteInput, { target: { value: "Confirmed for morning" } });
      fireEvent.click(screen.getByRole("button", { name: /Approve & Continue/i }));

      expect(onDecide).toHaveBeenCalledWith("appr_123", "APPROVED", "Confirmed for morning");

      // Expired state disables action buttons
      rerender(
        <ApprovalCard
          approval={{
            approvalId: "appr_123",
            actionType: "PROPOSE_APPOINTMENT",
            riskLevel: "MEDIUM_HUMAN_APPROVAL",
            status: "PENDING",
            title: "Approve 10-Minute Slot Hold",
            summary: "Hold slot with Dr. Mehta at 10:00 AM.",
            reason: "Patient requested morning slot",
            parameters: {},
            idempotencyKey: "qc_agent_1234567890abcdef",
            expiresAt: new Date(Date.now() - 60 * 1000).toISOString(),
          }}
          onDecide={onDecide}
        />
      );

      expect(screen.getByText(/Approval window expired/i)).toBeDefined();
      expect(screen.queryByRole("button", { name: /Approve & Continue/i })).toBeNull();
    });
  });

  describe("4. AgentChat Workspace (Preview & Live Modes)", () => {
    it("runs interactive patient workflow in preview mode when NEXT_PUBLIC_AGENT_PREVIEW_ENABLED is true", async () => {
      vi.stubEnv("NEXT_PUBLIC_AGENT_PREVIEW_ENABLED", "true");
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Not Found" }),
      }) as unknown as typeof fetch;

      render(<AgentChat role="PATIENT" userId="pat_user_1" userName="Aarav" />);

      await waitFor(() => {
        expect(screen.getByText("Quick-Clinic Care Assistant")).toBeDefined();
      });

      expect(screen.getByText("Frontend Preview Mode")).toBeDefined();
      expect(screen.getByText("Hello, Aarav")).toBeDefined();

      // Trigger starter prompt that stages an approval card
      fireEvent.click(screen.getByText("Propose & hold an appointment"));

      await waitFor(() => {
        expect(screen.getByText("Approve 10-Minute Slot Hold")).toBeDefined();
      });

      // Approve the staged action
      fireEvent.click(screen.getByRole("button", { name: /Approve & Continue/i }));

      await waitFor(() => {
        expect(screen.getByText("Approved")).toBeDefined();
        expect(screen.getByText(/Approval recorded for PROPOSE_APPOINTMENT/i)).toBeDefined();
      });
    });

    it("fails closed on 404 when preview mode is disabled", async () => {
      vi.stubEnv("NEXT_PUBLIC_AGENT_PREVIEW_ENABLED", "false");
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Not Found" }),
      }) as unknown as typeof fetch;

      render(<AgentChat role="PATIENT" userId="pat_user_2" userName="Maya" />);

      await waitFor(() => {
        expect(screen.getByText("Quick-Clinic Care Assistant")).toBeDefined();
      });

      const input = screen.getByLabelText("Message AI assistant");
      fireEvent.change(input, { target: { value: "Check doctor slots" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() => {
        expect(screen.getAllByText(/Not Found/i).length).toBeGreaterThan(0);
      });
    });

    it("uses live FastAPI response when /api/ai-agent/chat returns 200", async () => {
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/ai-agent/threads")) {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ detail: "Not Found" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: "Dr. Kapoor has 3 open slots today at 2:00 PM, 2:30 PM, and 4:00 PM.",
          }),
        });
      }) as unknown as typeof fetch;

      render(<AgentChat role="DOCTOR" userId="doc_user_1" userName="Dr. Kapoor" />);

      const input = screen.getByLabelText("Message AI assistant");
      fireEvent.change(input, { target: { value: "Check my open slots today" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() => {
        expect(screen.getByText("Live Agent API")).toBeDefined();
        expect(
          screen.getByText("Dr. Kapoor has 3 open slots today at 2:00 PM, 2:30 PM, and 4:00 PM.")
        ).toBeDefined();
      });
    });
  });

  describe("5. Sidebar Navigation Integration", () => {
    it("renders AI Assistant links in patient and doctor sidebars", () => {
      currentPathname = "/patient/assistant";
      const { unmount } = render(
        <PatientSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />
      );
      const patientLink = screen.getByRole("link", { name: /AI Assistant/i });
      expect(patientLink.getAttribute("href")).toBe("/patient/assistant");
      unmount();

      currentPathname = "/doctor/assistant";
      render(<DoctorSidebar isSidebarOpen={true} setSidebarOpen={vi.fn()} />);
      const doctorLink = screen.getByRole("link", { name: /AI Copilot/i });
      expect(doctorLink.getAttribute("href")).toBe("/doctor/assistant");
    });
  });

  describe("6. AiPetIcon & FloatingAgentWidget", () => {
    it("renders AiPetIcon across moods and sizes", () => {
      const { rerender } = render(<AiPetIcon size="lg" mood="idle" showGlow />);
      const icon = screen.getByTestId("ai-pet-icon");
      expect(icon.getAttribute("data-mood")).toBe("idle");

      rerender(<AiPetIcon size="xl" mood="thinking" showGlow />);
      expect(screen.getByTestId("ai-pet-icon").getAttribute("data-mood")).toBe("thinking");

      rerender(<AiPetIcon size="sm" mood="excited" />);
      expect(screen.getByTestId("ai-pet-icon").getAttribute("data-mood")).toBe("excited");
    });

    it("opens floating Ask AI pet popover, sends a message, and closes on Escape", async () => {
      currentPathname = "/patient";
      global.fetch = vi.fn().mockImplementation((url: string) => {
        if (url.includes("/api/ai-agent/threads")) {
          return Promise.resolve({
            ok: false,
            status: 404,
            json: async () => ({ detail: "Not Found" }),
          });
        }
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            response: "Dr. Sharma has openings at 10:30 AM and 3:00 PM tomorrow.",
          }),
        });
      }) as unknown as typeof fetch;

      render(<FloatingAgentWidget role="PATIENT" />);

      const trigger = screen.getByTestId("floating-ai-pet-trigger");
      expect(trigger.getAttribute("aria-label")).toBe("Ask AI Assistant");
      expect(screen.getByText("Ask AI")).toBeDefined();

      fireEvent.click(trigger);

      expect(screen.getByTestId("floating-ai-chat-panel")).toBeDefined();
      expect(screen.getByText("Ask AI Care Pet")).toBeDefined();
      const expandLink = screen.getByRole("link", { name: /Expand full workspace/i });
      expect(expandLink.getAttribute("href")).toBe("/patient/assistant");

      const input = screen.getByLabelText("Message AI assistant");
      fireEvent.change(input, { target: { value: "Check Dr. Sharma slots tomorrow" } });
      fireEvent.click(screen.getByRole("button", { name: "Send message" }));

      await waitFor(() => {
        expect(
          screen.getByText("Dr. Sharma has openings at 10:30 AM and 3:00 PM tomorrow.")
        ).toBeDefined();
      });

      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.queryByTestId("floating-ai-chat-panel")).toBeNull();
      expect(screen.getByTestId("floating-ai-pet-trigger")).toBeDefined();
    });

    it("hides FloatingAgentWidget when already on assistant pages", () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ detail: "Not Found" }),
      }) as unknown as typeof fetch;

      currentPathname = "/patient/assistant";
      const { rerender } = render(<FloatingAgentWidget role="PATIENT" />);
      expect(screen.queryByTestId("floating-ai-pet-trigger")).toBeNull();

      currentPathname = "/doctor/assistant";
      rerender(<FloatingAgentWidget role="DOCTOR" />);
      expect(screen.queryByTestId("floating-ai-pet-trigger")).toBeNull();
    });
  });
});
