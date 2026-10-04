// @vitest-environment happy-dom
import React, { Suspense, act } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { DoctorMedicalChatCitations } from "@/components/doctor/DoctorMedicalChatCitations";
import { DoctorMedicalChatSidebar } from "@/components/doctor/DoctorMedicalChatSidebar";
import DoctorPatientMedicalChatPage from "@/app/(protected)/doctor/patients/[patientId]/medical-chat/page";
import { showToast } from "@/lib/toast";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/doctor/patients/pat_test_123/medical-chat",
}));

vi.mock("@/lib/toast", () => ({
  showToast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  },
}));

describe("Doctor Medical AI Chat Frontend Test Suite", () => {
  const patientId = "pat_test_123";
  const originalFetch = global.fetch;
  const originalOpen = window.open;

  beforeEach(() => {
    vi.clearAllMocks();
    window.open = vi.fn();
    Element.prototype.scrollIntoView = vi.fn();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    window.open = originalOpen;
  });

  describe("DoctorMedicalChatCitations Component", () => {
    const sampleCitations = [
      {
        citationId: 1,
        documentId: "doc_vital_1",
        fileName: "vitals-oct2026.pdf",
        documentType: "LAB_REPORT",
        reportDate: "2026-10-01T00:00:00.000Z",
        pageNumber: 2,
        chunkIndex: 0,
        content: "Blood pressure reading: 120/80 mmHg. Heart rate: 72 bpm.",
        score: 0.95,
      },
    ];

    it("renders citations badge, document metadata, and disclaimer", () => {
      render(
        <DoctorMedicalChatCitations
          citations={sampleCitations}
          patientId={patientId}
        />
      );

      expect(screen.getByText(/Attributed Sources \(1\)/i)).toBeDefined();
      expect(screen.getByText("[1]")).toBeDefined();
      expect(screen.getByText("vitals-oct2026.pdf")).toBeDefined();
      expect(screen.getByText("p. 2")).toBeDefined();
      expect(screen.getByText("LAB REPORT")).toBeDefined();
      expect(screen.getByRole("button", { name: /view source/i })).toBeDefined();
    });

    it("opens signed document URL when 'View Source' is clicked", async () => {
      global.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ url: "https://storage.example.com/signed-vital-doc" }),
      } as any);

      render(
        <DoctorMedicalChatCitations
          citations={sampleCitations}
          patientId={patientId}
        />
      );

      const viewSourceBtn = screen.getByRole("button", { name: /view source/i });
      fireEvent.click(viewSourceBtn);

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          `/api/doctors/me/patients/${patientId}/medical-documents/doc_vital_1/access?action=view`
        );
        expect(window.open).toHaveBeenCalledWith(
          "https://storage.example.com/signed-vital-doc",
          "_blank",
          "noopener,noreferrer"
        );
      });
    });

    it("toggles expandable supporting evidence excerpts", async () => {
      render(
        <DoctorMedicalChatCitations
          citations={sampleCitations}
          patientId={patientId}
        />
      );

      expect(screen.getByText("Show Excerpts")).toBeDefined();
      expect(screen.queryByText(/Blood pressure reading: 120\/80 mmHg/i)).toBeNull();

      fireEvent.click(screen.getByText("Show Excerpts"));
      expect(screen.getByText(/Blood pressure reading: 120\/80 mmHg/i)).toBeDefined();
      expect(screen.getByText("Hide Excerpts")).toBeDefined();

      fireEvent.click(screen.getByText("Hide Excerpts"));
      expect(screen.queryByText(/Blood pressure reading: 120\/80 mmHg/i)).toBeNull();
    });
  });

  describe("DoctorMedicalChatSidebar Component", () => {
    const mockConversations = [
      {
        id: "conv_1",
        title: "Hypertension Review",
        createdAt: "2026-10-01T10:00:00.000Z",
        updatedAt: "2026-10-01T10:30:00.000Z",
        messageCount: 4,
      },
      {
        id: "conv_2",
        title: "Blood Glucose Follow-up",
        createdAt: "2026-10-02T11:00:00.000Z",
        updatedAt: "2026-10-02T11:15:00.000Z",
        messageCount: 2,
      },
    ];

    it("renders conversation list and handles selection and creation", () => {
      const onSelect = vi.fn();
      const onNew = vi.fn();
      const onDelete = vi.fn();

      render(
        <DoctorMedicalChatSidebar
          conversations={mockConversations}
          activeConversationId="conv_1"
          onSelectConversation={onSelect}
          onNewConversation={onNew}
          onDeleteConversation={onDelete}
          isCreating={false}
          deletingId={null}
        />
      );

      expect(screen.getByText("Conversations")).toBeDefined();
      expect(screen.getByText("Hypertension Review")).toBeDefined();
      expect(screen.getByText("Blood Glucose Follow-up")).toBeDefined();
      expect(screen.getByText("4")).toBeDefined();
      expect(screen.getByText("2")).toBeDefined();

      // Click conversation 2
      fireEvent.click(screen.getByText("Blood Glucose Follow-up"));
      expect(onSelect).toHaveBeenCalledWith("conv_2");

      // Click new chat
      const newChatBtn = screen.getByRole("button", { name: /new chat/i });
      fireEvent.click(newChatBtn);
      expect(onNew).toHaveBeenCalled();
    });

    it("triggers onDeleteConversation when delete button is clicked", () => {
      const onDelete = vi.fn();

      render(
        <DoctorMedicalChatSidebar
          conversations={mockConversations}
          activeConversationId="conv_1"
          onSelectConversation={vi.fn()}
          onNewConversation={vi.fn()}
          onDeleteConversation={onDelete}
          isCreating={false}
          deletingId={null}
        />
      );

      const deleteButtons = screen.getAllByTitle("Delete conversation");
      expect(deleteButtons.length).toBe(2);
      fireEvent.click(deleteButtons[0]);

      expect(onDelete).toHaveBeenCalledWith("conv_1");
    });
  });

  describe("DoctorPatientMedicalChatPage (Page Integration)", () => {
    it("renders MedicalRecordAccessDenied when API returns 403 forbidden", async () => {
      global.fetch = vi.fn((url: string) => {
        if (url.includes("/medical-record-patients")) {
          return Promise.resolve({
            ok: true,
            json: async () => [],
          } as any);
        }
        if (url.includes("/medical-chat/conversations")) {
          return Promise.resolve({
            ok: false,
            status: 403,
            json: async () => ({ error: "Access denied. Eligible appointment required." }),
          } as any);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as any);
      }) as any;

      const stableParams = Promise.resolve({ patientId });

      await act(async () => {
        render(
          <Suspense fallback={<div>Loading...</div>}>
            <DoctorPatientMedicalChatPage params={stableParams} />
          </Suspense>
        );
      });

      await waitFor(() => {
        expect(screen.getByText(/Medical Records Access Denied/i)).toBeDefined();
        expect(screen.getByText(/Access denied. Eligible appointment required./i)).toBeDefined();
      });
    });

    it("loads conversations, fetches messages for active conversation, and displays chat interface", async () => {
      const mockPatient = {
        id: patientId,
        name: "Jane Doe",
        age: 34,
        gender: "Female",
        relationship: "CONFIRMED",
      };

      const mockConversations = [
        {
          id: "conv_100",
          title: "Vitals Check",
          createdAt: "2026-10-04T12:00:00.000Z",
          updatedAt: "2026-10-04T12:10:00.000Z",
          messageCount: 2,
        },
      ];

      const mockMessages = [
        {
          id: "msg_user_1",
          role: "USER",
          content: "What were the recent BP readings?",
          status: "COMPLETE",
          createdAt: "2026-10-04T12:01:00.000Z",
        },
        {
          id: "msg_asst_1",
          role: "ASSISTANT",
          content: "The recent blood pressure reading was 120/80 mmHg [1].",
          citations: [
            {
              citationId: 1,
              documentId: "doc_vitals_01",
              fileName: "vitals.pdf",
              documentType: "LAB_REPORT",
              reportDate: "2026-10-01T00:00:00.000Z",
              pageNumber: 1,
              chunkIndex: 0,
              content: "Blood pressure: 120/80 mmHg",
              score: 0.99,
            },
          ],
          status: "COMPLETE",
          createdAt: "2026-10-04T12:01:05.000Z",
        },
      ];

      global.fetch = vi.fn((url: string) => {
        if (url.includes("/medical-record-patients")) {
          return Promise.resolve({
            ok: true,
            json: async () => [mockPatient],
          } as any);
        }
        if (url.endsWith("/medical-chat/conversations")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ conversations: mockConversations }),
          } as any);
        }
        if (url.includes("/medical-chat/conversations/conv_100")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              conversation: {
                id: "conv_100",
                title: "Vitals Check",
              },
              messages: mockMessages,
            }),
          } as any);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as any);
      }) as any;

      const stableParams = Promise.resolve({ patientId });

      await act(async () => {
        render(
          <Suspense fallback={<div>Loading...</div>}>
            <DoctorPatientMedicalChatPage params={stableParams} />
          </Suspense>
        );
      });

      await waitFor(() => {
        expect(screen.getAllByText("Vitals Check").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("What were the recent BP readings?")).toBeDefined();
        expect(
          screen.getByText("The recent blood pressure reading was 120/80 mmHg [1].")
        ).toBeDefined();
        expect(screen.getByText("vitals.pdf")).toBeDefined();
      });
    });

    it("creates a new conversation when New Chat button is clicked", async () => {
      const mockPatient = {
        id: patientId,
        name: "Jane Doe",
        age: 34,
        gender: "Female",
        relationship: "CONFIRMED",
      };

      const newConv = {
        id: "conv_new_200",
        title: "New AI Consultation",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        messageCount: 0,
      };

      global.fetch = vi.fn((url: string, opts?: any) => {
        if (url.includes("/medical-record-patients")) {
          return Promise.resolve({
            ok: true,
            json: async () => [mockPatient],
          } as any);
        }
        if (url.endsWith("/medical-chat/conversations") && (!opts || opts.method !== "POST")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({ conversations: [] }),
          } as any);
        }
        if (url.endsWith("/medical-chat/conversations") && opts?.method === "POST") {
          return Promise.resolve({
            ok: true,
            status: 201,
            json: async () => ({ conversation: newConv }),
          } as any);
        }
        if (url.includes("/medical-chat/conversations/conv_new_200")) {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              conversation: newConv,
              messages: [],
            }),
          } as any);
        }
        return Promise.resolve({ ok: true, json: async () => ({}) } as any);
      }) as any;

      const stableParams = Promise.resolve({ patientId });

      await act(async () => {
        render(
          <Suspense fallback={<div>Loading...</div>}>
            <DoctorPatientMedicalChatPage params={stableParams} />
          </Suspense>
        );
      });

      await waitFor(() => {
        expect(screen.getByRole("button", { name: /new chat/i })).toBeDefined();
      });

      fireEvent.click(screen.getByRole("button", { name: /new chat/i }));

      await waitFor(() => {
        expect(showToast.success).toHaveBeenCalledWith("New conversation started");
      });
    });
  });
});
