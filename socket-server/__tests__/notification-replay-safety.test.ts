import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import express from 'express';
import request from 'supertest';
import { requireInternalAuth } from '../main';
import { SocketServer } from '../server';

const TEST_SECRET = 'internal_secret_at_least_32_characters_key';

describe('Notification Creation Replay Safety & Deduplication', () => {
  let app: express.Application;
  let socketServer: any;
  let mockPrisma: any;

  beforeAll(() => {
    process.env.INTERNAL_API_SECRET = TEST_SECRET;
    process.env.JWT_SECRET = TEST_SECRET;

    mockPrisma = {
      appointment: {
        findUnique: vi.fn(),
      },
      notification: {
        findUnique: vi.fn(),
        create: vi.fn(),
      },
      user: {
        findUnique: vi.fn(),
      },
      doctorPatientRelation: {
        findUnique: vi.fn(),
      },
      chatMessages: {
        findMany: vi.fn(),
        count: vi.fn(),
        create: vi.fn(),
      },
    };

    socketServer = {
      sendNotificationToUser: vi.fn(),
      sendAppointmentStatusUpdate: vi.fn(),
    };

    app = express();
    app.use(express.json());

    // Mount appointment status notification route matching production main.ts
    app.post('/api/notifications/appointment-status', requireInternalAuth, async (req, res) => {
      const { appointmentId, status, recipientId, doctorName, patientName, scheduledAt } = req.body;

      if (!appointmentId || !status || !recipientId) {
        return res.status(400).json({ error: 'appointmentId, status, and recipientId are required' });
      }

      // Authoritative DB verification
      let authoritativeRecipient = recipientId;
      if (mockPrisma?.appointment) {
        try {
          const appointment = await mockPrisma.appointment.findUnique({
            where: { id: appointmentId },
            include: {
              patient: { select: { userId: true } },
              doctor: { select: { userId: true } },
            },
          });

          if (!appointment) {
            return res.status(404).json({ error: 'Appointment not found' });
          }

          const allowedRecipients = [
            appointment.patient?.userId,
            appointment.doctor?.userId,
          ].filter(Boolean);

          if (!allowedRecipients.includes(recipientId)) {
            return res.status(400).json({ error: 'Recipient is not associated with this appointment' });
          }
        } catch (dbErr: any) {
          console.warn('Authoritative DB appointment lookup error:', dbErr?.message);
        }
      }

      const eventId = `apt:${appointmentId}:${status}`;
      const message = `Your appointment status was updated to ${status}`;

      let notification: any = null;
      if (mockPrisma?.notification) {
        try {
          const existing = await mockPrisma.notification.findUnique({
            where: {
              userId_eventId: {
                userId: authoritativeRecipient,
                eventId,
              },
            },
          });

          if (existing) {
            notification = existing;
          } else {
            notification = await mockPrisma.notification.create({
              data: {
                userId: authoritativeRecipient,
                eventId,
                type: 'APPOINTMENT_STATUS',
                message,
                read: false,
                link: `/patient/appointments`,
              },
            });
          }
        } catch (dbErr: any) {
          if (dbErr?.code === 'P2002') {
            notification = await mockPrisma.notification.findUnique({
              where: {
                userId_eventId: {
                  userId: authoritativeRecipient,
                  eventId,
                },
              },
            });
          } else {
            return res.status(500).json({ error: 'Failed to persist notification' });
          }
        }
      }

      if (!notification) {
        notification = {
          id: `notif_${Date.now()}`,
          message,
          eventId,
          createdAt: new Date().toISOString(),
          isRead: false,
        };
      }

      try {
        socketServer.sendNotificationToUser(authoritativeRecipient, notification);
      } catch (emitErr) {
        console.warn('Socket notification emission failed after persistence:', emitErr);
      }

      return res.json({ success: true, notification, eventId, isDuplicate: !!notification?.createdAt });
    });
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('rejects request with missing or invalid internal credentials (401 Unauthorized)', async () => {
    // Missing secret
    const res1 = await request(app)
      .post('/api/notifications/appointment-status')
      .send({ appointmentId: 'apt_1', status: 'CONFIRMED', recipientId: 'user_pat_1' });
    expect(res1.status).toBe(401);

    // Invalid secret
    const res2 = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', 'wrong_secret')
      .send({ appointmentId: 'apt_1', status: 'CONFIRMED', recipientId: 'user_pat_1' });
    expect(res2.status).toBe(401);
  });

  it('rejects malformed payload missing mandatory fields (400 Bad Request)', async () => {
    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_1' }); // missing status and recipientId

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  it('rejects when appointment does not exist in authoritative DB (404 Not Found)', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce(null);

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'non_existent_apt', status: 'CONFIRMED', recipientId: 'user_pat_1' });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Appointment not found');
  });

  it('rejects when recipient does not match appointment patient or doctor (400 Bad Request)', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce({
      id: 'apt_1',
      patient: { userId: 'real_patient_id' },
      doctor: { userId: 'real_doctor_id' },
    });

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_1', status: 'CONFIRMED', recipientId: 'attacker_user_id' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/not associated with this appointment/i);
  });

  it('persists and emits canonical notification on first delivery', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce({
      id: 'apt_100',
      patient: { userId: 'patient_100' },
      doctor: { userId: 'doctor_100' },
    });

    mockPrisma.notification.findUnique.mockResolvedValueOnce(null);
    mockPrisma.notification.create.mockResolvedValueOnce({
      id: 'notif_created_1',
      eventId: 'apt:apt_100:CONFIRMED',
      userId: 'patient_100',
      message: 'Your appointment status was updated to CONFIRMED',
      read: false,
    });

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_100', status: 'CONFIRMED', recipientId: 'patient_100' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.eventId).toBe('apt:apt_100:CONFIRMED');
    expect(socketServer.sendNotificationToUser).toHaveBeenCalledWith('patient_100', expect.objectContaining({
      id: 'notif_created_1',
      eventId: 'apt:apt_100:CONFIRMED',
    }));
  });

  it('deduplicates repeated delivery: reuses existing notification without duplicate DB insert', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce({
      id: 'apt_100',
      patient: { userId: 'patient_100' },
      doctor: { userId: 'doctor_100' },
    });

    const existingCanonical = {
      id: 'notif_existing_canonical',
      eventId: 'apt:apt_100:CONFIRMED',
      userId: 'patient_100',
      message: 'Your appointment status was updated to CONFIRMED',
      read: false,
      createdAt: '2026-10-19T10:00:00Z',
    };

    mockPrisma.notification.findUnique.mockResolvedValueOnce(existingCanonical);

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_100', status: 'CONFIRMED', recipientId: 'patient_100' });

    expect(res.status).toBe(200);
    expect(res.body.notification.id).toBe('notif_existing_canonical');
    expect(mockPrisma.notification.create).not.toHaveBeenCalled();
    expect(socketServer.sendNotificationToUser).toHaveBeenCalledWith('patient_100', existingCanonical);
  });

  it('safely handles concurrent conflict (P2002) by returning canonical notification', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce({
      id: 'apt_race',
      patient: { userId: 'patient_race' },
      doctor: { userId: 'doctor_race' },
    });

    // Initial pre-check returns null due to race
    mockPrisma.notification.findUnique.mockResolvedValueOnce(null);
    const p2002Error: any = new Error('Unique constraint failed on the fields: (`userId`,`eventId`)');
    p2002Error.code = 'P2002';
    mockPrisma.notification.create.mockRejectedValueOnce(p2002Error);

    const canonicalWinner = {
      id: 'notif_winner_race',
      eventId: 'apt:apt_race:CONFIRMED',
      userId: 'patient_race',
      message: 'Your appointment status was updated to CONFIRMED',
      read: false,
    };
    mockPrisma.notification.findUnique.mockResolvedValueOnce(canonicalWinner);

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_race', status: 'CONFIRMED', recipientId: 'patient_race' });

    expect(res.status).toBe(200);
    expect(res.body.notification.id).toBe('notif_winner_race');
  });

  it('allows two distinct legitimate status transitions on the same appointment', async () => {
    mockPrisma.appointment.findUnique
      .mockResolvedValueOnce({
        id: 'apt_seq',
        patient: { userId: 'patient_seq' },
        doctor: { userId: 'doctor_seq' },
      })
      .mockResolvedValueOnce({
        id: 'apt_seq',
        patient: { userId: 'patient_seq' },
        doctor: { userId: 'doctor_seq' },
      });

    mockPrisma.notification.findUnique.mockResolvedValue(null);

    mockPrisma.notification.create
      .mockResolvedValueOnce({
        id: 'notif_status_1',
        eventId: 'apt:apt_seq:CONFIRMED',
        userId: 'patient_seq',
      })
      .mockResolvedValueOnce({
        id: 'notif_status_2',
        eventId: 'apt:apt_seq:COMPLETED',
        userId: 'patient_seq',
      });

    const res1 = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_seq', status: 'CONFIRMED', recipientId: 'patient_seq' });

    const res2 = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_seq', status: 'COMPLETED', recipientId: 'patient_seq' });

    expect(res1.body.notification.id).toBe('notif_status_1');
    expect(res2.body.notification.id).toBe('notif_status_2');
    expect(res1.body.eventId).toBe('apt:apt_seq:CONFIRMED');
    expect(res2.body.eventId).toBe('apt:apt_seq:COMPLETED');
  });

  it('returns canonical notification successfully even if socket emission throws', async () => {
    mockPrisma.appointment.findUnique.mockResolvedValueOnce({
      id: 'apt_emit_fail',
      patient: { userId: 'patient_emit_fail' },
      doctor: { userId: 'doctor_emit_fail' },
    });

    mockPrisma.notification.findUnique.mockResolvedValueOnce(null);
    mockPrisma.notification.create.mockResolvedValueOnce({
      id: 'notif_persisted_safely',
      eventId: 'apt:apt_emit_fail:CONFIRMED',
      userId: 'patient_emit_fail',
    });

    socketServer.sendNotificationToUser.mockImplementationOnce(() => {
      throw new Error('Socket client unreachable');
    });

    const res = await request(app)
      .post('/api/notifications/appointment-status')
      .set('x-internal-secret', TEST_SECRET)
      .send({ appointmentId: 'apt_emit_fail', status: 'CONFIRMED', recipientId: 'patient_emit_fail' });

    expect(res.status).toBe(200);
    expect(res.body.notification.id).toBe('notif_persisted_safely');
  });
});
