import { describe, it, expect, vi, beforeEach } from "vitest";
import crypto from "crypto";
import { SocketServer } from "../../../socket-server/server";

const TEST_SECRET = "test_jwt_secret_must_be_long_enough_for_hs256";

function createTestToken(payload: Record<string, any>, secret = TEST_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const fullPayload = {
    exp: Math.floor(Date.now() / 1000) + 3600,
    ...payload,
  };
  const body = Buffer.from(JSON.stringify(fullPayload)).toString("base64url");
  const signature = crypto.createHmac("sha256", secret).update(`${header}.${body}`).digest("base64url");
  return `${header}.${body}.${signature}`;
}

describe("SocketServer Unit Tests", () => {
  let mockIo: any;
  let mockPrisma: any;
  let socketServer: SocketServer;

  beforeEach(() => {
    process.env.JWT_SECRET = TEST_SECRET;

    mockIo = {
      use: vi.fn(),
      on: vi.fn(),
      to: vi.fn().mockReturnThis(),
      emit: vi.fn(),
    };

    mockPrisma = {
      doctorPatientRelation: {
        findUnique: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      chatMessages: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
    };

    socketServer = new SocketServer(mockIo, mockPrisma, TEST_SECRET);
  });

  it("should initialize and register middleware and event handlers", () => {
    expect(mockIo.use).toHaveBeenCalled();
    expect(mockIo.on).toHaveBeenCalledWith("connection", expect.any(Function));
  });

  describe("sendNotificationToUser", () => {
    it("emits new_notification event to user room", () => {
      const mockNotification = {
        id: "notif_1",
        message: "Your appointment is confirmed",
        createdAt: new Date().toISOString(),
        isRead: false,
      };

      socketServer.sendNotificationToUser("user_123", mockNotification);

      expect(mockIo.to).toHaveBeenCalledWith("user_user_123");
      expect(mockIo.emit).toHaveBeenCalledWith("new_notification", {
        notification: mockNotification,
      });
    });
  });

  describe("sendAppointmentStatusUpdate", () => {
    it("emits appointment_status_update event to patient room", () => {
      const mockAppointment = {
        id: "apt_1",
        status: "CONFIRMED",
        appointmentDate: "2026-08-20",
        appointmentTime: "10:00 AM",
        doctorName: "Dr. Smith",
      };

      socketServer.sendAppointmentStatusUpdate("pat_user_456", mockAppointment);

      expect(mockIo.to).toHaveBeenCalledWith("user_pat_user_456");
      expect(mockIo.emit).toHaveBeenCalledWith("appointment_status_update", {
        appointment: mockAppointment,
      });
    });
  });

  describe("sendAppointmentRequest", () => {
    it("emits new_appointment_request event to doctor room", () => {
      const mockRequest = {
        id: "apt_2",
        patientName: "John Doe",
        patientString: "john@example.com",
        gender: "MALE",
        appointmentDate: "2026-08-21",
        appointmentTime: "11:00 AM",
        status: "PENDING",
        city: "New Delhi",
        age: 30,
        paymentMethod: "CASH",
      };

      socketServer.sendAppointmentRequest("doc_user_789", mockRequest);

      expect(mockIo.to).toHaveBeenCalledWith("user_doc_user_789");
      expect(mockIo.emit).toHaveBeenCalledWith("new_appointment_request", {
        appointment: mockRequest,
      });
    });
  });

  describe("Authentication Middleware", () => {
    it("rejects connection when token is missing", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const mockSocket = {
        handshake: {
          auth: {},
        },
      };
      const mockNext = vi.fn();

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toMatch(/missing token/i);
    });

    it("rejects connection when only raw userId is provided without a signed token (bypass blocked)", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const mockSocket: any = {
        handshake: {
          auth: { userId: "victim_user_1" },
        },
      };
      const mockNext = vi.fn();

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toMatch(/missing token/i);
    });

    it("authenticates notification connection when valid signed token is provided", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const token = createTestToken({ id: "user_valid_1", role: "PATIENT" });
      const mockSocket: any = {
        handshake: {
          auth: { token },
        },
      };
      const mockNext = vi.fn();

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user_valid_1",
        name: "Test User",
        role: "PATIENT",
        isActive: true,
      });

      await authMiddleware(mockSocket, mockNext);

      expect(mockSocket.userId).toBe("user_valid_1");
      expect(mockSocket.userName).toBe("Test User");
      expect(mockSocket.userRole).toBe("PATIENT");
      expect(mockNext).toHaveBeenCalledWith();
    });

    it("rejects token with mismatched/conflicting userId in auth payload", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const token = createTestToken({ id: "user_valid_1", role: "PATIENT" });
      const mockSocket: any = {
        handshake: {
          auth: { token, userId: "different_claimed_user" },
        },
      };
      const mockNext = vi.fn();

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe("Conflicting identity claims");
    });

    it("rejects connection when user is inactive in database", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const token = createTestToken({ id: "user_inactive_1", role: "PATIENT" });
      const mockSocket: any = {
        handshake: {
          auth: { token },
        },
      };
      const mockNext = vi.fn();

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user_inactive_1",
        name: "Inactive User",
        role: "PATIENT",
        isActive: false,
      });

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe("Account inactive");
    });

    it("rejects chat connection when relation is not found", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const token = createTestToken({ id: "user_1", role: "PATIENT" });
      const mockSocket: any = {
        handshake: {
          auth: { token, relationId: "rel_invalid" },
        },
      };
      const mockNext = vi.fn();

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user_1",
        name: "Test Patient",
        role: "PATIENT",
        isActive: true,
      });
      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce(null);

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe("Relation not found");
    });
  });
});
