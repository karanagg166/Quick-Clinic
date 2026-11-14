// @vitest-environment happy-dom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { generateIdempotencyKey, validateAgentMessage } from "@/lib/ai-agent/client";
import { MAX_AGENT_MESSAGE_LENGTH } from "@/lib/ai-agent/types";
import { ToolActivity } from "@/components/ai-agent/ToolActivity";
import { ApprovalCard } from "@/components/ai-agent/ApprovalCard";
import { AgentChat } from "@/components/ai-agent/AgentChat";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), replace: vi.fn() }),
  usePathname: () => "/doctor/assistant",
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), warning: vi.fn(), loading: vi.fn() },
}));

describe("Quick-Clinic AI Agent Core Suite", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.clearAllMocks();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.unstubAllEnvs();
  });

  it("validates messages and generates bounded idempotency keys", () => {
    expect(validateAgentMessage("   ").valid).toBe(false);
    expect(validateAgentMessage("a".repeat(MAX_AGENT_MESSAGE_LENGTH + 1)).valid).toBe(false);
    expect(validateAgentMessage("hello\x00world").valid).toBe(false);

    const valid = validateAgentMessage("  Check Dr. Sharma slots\nfor tomorrow\tplease  ");
    expect(valid.valid).toBe(true);
    expect(valid.sanitized).toBe("Check Dr. Sharma slots\nfor tomorrow\tplease");

    const key = generateIdempotencyKey("appt");
    expect(key.length).toBeGreaterThanOrEqual(16);
    expect(key.length).toBeLessThanOrEqual(128);
  });

  it("displays ToolActivity summary and expands metadata", () => {
    render(
      <ToolActivity
        activities={[
          {
            id: "tool-1",
            toolName: "get_doctor_appointments",
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
    expect(screen.queryByText(/Inspected open consultation slots/i)).toBeNull();
    fireEvent.click(toggle);

    expect(screen.getByText(/get_doctor_appointments/)).toBeDefined();
    expect(screen.getByText("Read-only")).toBeDefined();
    expect(screen.getByText("date: 2026-11-14")).toBeDefined();
  });

  it("handles ApprovalCard pending sign-off, note entry, and expired state", () => {
    const onDecide = vi.fn();
    const futureIso = new Date(Date.now() + 50 * 1000).toISOString();

    const { rerender } = render(
      <ApprovalCard
        approval={{
          approvalId: "appr_123",
          actionType: "APPLY_LEAVE",
          riskLevel: "MEDIUM_HUMAN_APPROVAL",
          status: "PENDING",
          title: "Approve Leave Request",
          summary: "Apply leave on 2026-11-20.",
          reason: "Medical conference",
          parameters: { start_date: "2026-11-20" },
          idempotencyKey: "qc_agent_1234567890abcdef",
          expiresAt: futureIso,
        }}
        onDecide={onDecide}
      />
    );

    fireEvent.change(screen.getByLabelText(/Approval decision note/i), {
      target: { value: "Confirmed" },
    });
    fireEvent.click(screen.getByRole("button", { name: /Approve & Continue/i }));
    expect(onDecide).toHaveBeenCalledWith("appr_123", "APPROVED", "Confirmed");

    rerender(
      <ApprovalCard
        approval={{
          approvalId: "appr_123",
          actionType: "APPLY_LEAVE",
          riskLevel: "MEDIUM_HUMAN_APPROVAL",
          status: "PENDING",
          title: "Approve Leave Request",
          summary: "Apply leave on 2026-11-20.",
          reason: "Medical conference",
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

  it("runs live Doctor Agent chat and HITL approval resume via FastAPI endpoints", async () => {
    const futureIso = new Date(Date.now() + 55 * 1000).toISOString();
    global.fetch = vi.fn().mockImplementation((url: string) => {
      if (url.includes("/api/ai-agent/threads")) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({ threads: [], mode: "live" }) });
      }
      if (url.includes("/api/ai-agent/approvals/appr_doc_1/decision")) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({
            threadId: "thr_doc_1",
            approval: {
              approvalId: "appr_doc_1",
              actionType: "APPLY_LEAVE",
              riskLevel: "MEDIUM_HUMAN_APPROVAL",
              status: "APPROVED",
              executionStatus: "COMPLETED",
              title: "Apply leave on 2026-11-20",
              summary: "Apply leave on 2026-11-20",
              reason: "Conference",
              parameters: { start_date: "2026-11-20" },
              idempotencyKey: "idem_1",
              expiresAt: futureIso,
              decidedAt: new Date().toISOString(),
            },
            resumedMessage: {
              id: "msg_resumed",
              role: "assistant",
              content: "Leave applied for 2026-11-20.",
              createdAt: new Date().toISOString(),
              status: "sent",
            },
            mode: "live",
          }),
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          threadId: "thr_doc_1",
          response: "Please approve applying leave on 2026-11-20.",
          approvalRequest: {
            approvalId: "appr_doc_1",
            actionType: "APPLY_LEAVE",
            riskLevel: "MEDIUM_HUMAN_APPROVAL",
            status: "PENDING",
            title: "Apply leave on 2026-11-20",
            summary: "Apply leave on 2026-11-20",
            reason: "Conference",
            parameters: { start_date: "2026-11-20" },
            idempotencyKey: "idem_1",
            expiresAt: futureIso,
          },
          mode: "live",
        }),
      });
    }) as unknown as typeof fetch;

    render(<AgentChat role="DOCTOR" userId="doc_user_1" userName="Dr. Kapoor" />);
    await waitFor(() => expect(screen.getByText("Clinical AI Copilot")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Message AI assistant"), {
      target: { value: "Apply leave on 2026-11-20" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Approve & Continue/i })).toBeDefined()
    );
    fireEvent.click(screen.getByRole("button", { name: /Approve & Continue/i }));

    await waitFor(() => {
      expect(screen.getByText("Approved")).toBeDefined();
      expect(screen.getByText("Leave applied for 2026-11-20.")).toBeDefined();
    });
  });

  it("fails closed on backend 404 without falling back to mock responses", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({ detail: "Not Found" }),
    }) as unknown as typeof fetch;

    render(<AgentChat role="DOCTOR" userId="doc_user_2" userName="Dr. Maya" />);
    await waitFor(() => expect(screen.getByText("Clinical AI Copilot")).toBeDefined());

    fireEvent.change(screen.getByLabelText("Message AI assistant"), {
      target: { value: "Check my slots" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(screen.getAllByText(/Not Found/i).length).toBeGreaterThan(0));
  });
});
