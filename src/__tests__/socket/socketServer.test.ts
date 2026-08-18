import { describe, it, expect, vi, beforeEach } from "vitest";
import { SocketServer } from "../../../socket-server/server";

describe("SocketServer Unit Tests", () => {
  let mockIo: any;
  let mockPrisma: any;
  let socketServer: SocketServer;

  beforeEach(() => {
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

    socketServer = new SocketServer(mockIo, mockPrisma);
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

    it("authenticates notification connection when valid userId is provided", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const mockSocket: any = {
        handshake: {
          auth: { userId: "user_valid_1" },
        },
      };
      const mockNext = vi.fn();

      mockPrisma.user.findUnique.mockResolvedValueOnce({
        id: "user_valid_1",
        name: "Test User",
        role: "PATIENT",
      });

      await authMiddleware(mockSocket, mockNext);

      expect(mockSocket.userId).toBe("user_valid_1");
      expect(mockSocket.userName).toBe("Test User");
      expect(mockSocket.userRole).toBe("PATIENT");
      expect(mockNext).toHaveBeenCalledWith();
    });

    it("rejects chat connection when relation is not found", async () => {
      const authMiddleware = mockIo.use.mock.calls[0][0];
      const mockSocket: any = {
        handshake: {
          auth: { userId: "user_1", relationId: "rel_invalid" },
        },
      };
      const mockNext = vi.fn();

      mockPrisma.doctorPatientRelation.findUnique.mockResolvedValueOnce(null);

      await authMiddleware(mockSocket, mockNext);

      expect(mockNext).toHaveBeenCalledWith(expect.any(Error));
      expect(mockNext.mock.calls[0][0].message).toBe("Relation not found");
    });
  });
});
