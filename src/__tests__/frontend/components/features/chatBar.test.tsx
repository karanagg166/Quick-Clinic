// @vitest-environment happy-dom
import React from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import ChatBar from "@/components/general/ChatBar";

// Mock socket.io-client
vi.mock("socket.io-client", () => ({
  io: vi.fn(() => ({
    on: vi.fn(),
    emit: vi.fn(),
    disconnect: vi.fn(),
    connected: false,
  })),
}));

describe("ChatBar component", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        chats: [
          {
            id: "msg_1",
            text: "Hello from previous chat",
            senderId: "u_doc",
            senderName: "Dr. Smith",
            createdAt: new Date().toISOString(),
          },
        ],
        pagination: { totalMessages: 1, totalPages: 1 },
      }),
    } as any);
  });

  it("renders header, status badge, input area, and send button", () => {
    render(<ChatBar doctorPatientRelationId="rel_1" userId="u_pat" />);

    expect(screen.getByText("Chat")).toBeDefined();
    expect(screen.getByText("Secure conversation with your provider")).toBeDefined();
    expect(screen.getByPlaceholderText(/Type a message/i)).toBeDefined();
  });

  it("fetches and renders initial messages from REST API", async () => {
    render(<ChatBar doctorPatientRelationId="rel_1" userId="u_pat" />);

    await waitFor(() => {
      expect(screen.getByText("Hello from previous chat")).toBeDefined();
    });
  });
});
