import { NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import type { AppointmentDetail } from '@/types/common';

export async function GET(
	req: Request,
	{ params }: { params: Promise<{ patientId: string; appointmentId: string }> }
) {
	try {
		const { patientId, appointmentId } = await params;

		// Fetch single appointment with all relations
		const appointment = await prisma.appointment.findFirst({
			where: {
				id: appointmentId,
				patientId: patientId,
			},
			include: {
				doctor: {
					include: {
						user: true,
					},
				},
				patient: {
					include: {
						user: {
							include: {
								location: true,
							}
						}
					},
				},
				slot: true,
			},
		});

		if (!appointment) {
			return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
		}

		const result: AppointmentDetail = {
			id: appointment.id,
			doctorId: appointment.doctorId,
			patientId: appointment.patientId,
			slotId: appointment.slotId,
			status: appointment.status as 'PENDING' | 'CONFIRMED' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW' | 'RESCHEDULED',
			paymentMethod: appointment.paymentMethod as 'OFFLINE' | 'ONLINE',
			transactionId: appointment.transactionId ?? null,
			notes: appointment.notes ?? null,
			bookedAt: appointment.bookedAt.toISOString(),
			updatedAt: appointment.updatedAt.toISOString(),
			isAppointmentOffline: appointment.isAppointmentOffline,
			doctor: {
				id: appointment.doctor.id,
				userId: appointment.doctor.userId,
				specialty: String(appointment.doctor.specialty),
				experience: appointment.doctor.experience,
				qualifications: appointment.doctor.qualifications,
				fees: appointment.doctor.fees,
				user: {
					id: appointment.doctor.user.id,
					email: appointment.doctor.user.email,
					phoneNo: appointment.doctor.user.phoneNo,
					name: appointment.doctor.user.name,
					age: appointment.doctor.user.age,
					gender: String(appointment.doctor.user.gender) as 'MALE' | 'FEMALE' | 'BINARY',
					role: appointment.doctor.user.role as 'ADMIN' | 'DOCTOR' | 'PATIENT',
					address: appointment.doctor.user.address,
					city: appointment.doctor.user.location?.city || "N/A",
					state: appointment.doctor.user.location?.state || "N/A",
					pinCode: appointment.doctor.user.location?.pinCode || 0,
					emailVerified: appointment.doctor.user.emailVerified,
				},
			},
			patient: {
				id: appointment.patient.id,
				userId: appointment.patient.userId,
				medicalHistory: appointment.patient.medicalHistory,
				allergies: appointment.patient.allergies,
				currentMedications: appointment.patient.currentMedications,
				user: {
					id: appointment.patient.user.id,
					email: appointment.patient.user.email,
					phoneNo: appointment.patient.user.phoneNo,
					name: appointment.patient.user.name,
					age: appointment.patient.user.age,
					gender: String(appointment.patient.user.gender) as 'MALE' | 'FEMALE' | 'BINARY',
					role: appointment.patient.user.role as 'ADMIN' | 'DOCTOR' | 'PATIENT',
					address: appointment.patient.user.address,
					city: appointment.patient.user.location?.city || "N/A",
					state: appointment.patient.user.location?.state || "N/A",
					pinCode: appointment.patient.user.location?.pinCode || 0,
					emailVerified: appointment.patient.user.emailVerified,
				},
			},
			slot: {
				id: appointment.slot.id,
				doctorId: appointment.slot.doctorId,
				date: appointment.slot.date.toISOString().split('T')[0],
				startTime: appointment.slot.startTime.toISOString(),
				endTime: appointment.slot.endTime.toISOString(),
				status: String(appointment.slot.status) as 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED',
			},
			city: null,
			state: null
		};

		return NextResponse.json(result, { status: 200 });
	} catch (e) {
		console.error('Error fetching appointment detail:', e);
		return NextResponse.json({ error: 'Failed to fetch appointment' }, { status: 500 });
	}
}

// PATCH - Cancel appointment (patient can cancel)
export async function PATCH(
	req: Request,
	{ params }: { params: Promise<{ patientId: string; appointmentId: string }> }
) {
	try {
		const { patientId, appointmentId } = await params;

		if (!patientId || !appointmentId) {
			return NextResponse.json({ error: 'patientId and appointmentId are required' }, { status: 400 });
		}

		// Get appointment details
		const appointment = await prisma.appointment.findFirst({
			where: {
				id: appointmentId,
				patientId,
			},
			include: {
				doctor: {
					include: { user: true },
				},
				patient: {
					include: { user: true },
				},
				slot: true,
			},
		});

		if (!appointment) {
			return NextResponse.json({ error: 'Appointment not found' }, { status: 404 });
		}

		// Check if appointment can be cancelled (only PENDING or CONFIRMED)
		if (appointment.status !== 'PENDING' && appointment.status !== 'CONFIRMED') {
			return NextResponse.json(
				{ error: `Cannot cancel appointment with status: ${appointment.status}` },
				{ status: 400 }
			);
		}

		// Process refund if payment was online
		let refundProcessed = false;
		if (appointment.paymentMethod === 'ONLINE' && appointment.transactionId) {
			try {
				// Find the payment record
				const payment = await prisma.payment.findFirst({
					where: {
						razorpayPaymentId: appointment.transactionId,
						userId: patientId,
						status: 'SUCCESS',
					},
				});

				if (payment && payment.razorpayPaymentId) {
					// Process refund via Razorpay
					if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
						console.warn('Razorpay credentials missing, cannot process refund');
					} else {
						const RazorpayModule = await import('razorpay');
						const Razorpay = RazorpayModule.default;
						const razorpay = new Razorpay({
							key_id: process.env.RAZORPAY_KEY_ID,
							key_secret: process.env.RAZORPAY_KEY_SECRET,
						});

						// Create refund
						const refund = await razorpay.payments.refund(payment.razorpayPaymentId, {
							amount: payment.amount, // Full refund
							notes: {
								reason: 'Appointment cancelled by patient',
								appointmentId: appointmentId,
							},
						});

						console.log('Refund processed:', refund.id);
						refundProcessed = true;

						// Update payment status
						await prisma.payment.update({
							where: { id: payment.id },
							data: {
								status: 'REFUNDED',
							},
						});
					}
				}
			} catch (refundError: unknown) {
				console.error('Refund error:', refundError);
				// Don't fail the cancellation if refund fails, but log it
				// In production, you might want to queue this for retry
			}
		}

		// If appointment was COMPLETED and doctor already received balance, deduct it
		// (This shouldn't happen for PENDING/CONFIRMED, but adding as safeguard)
		if (appointment.status === 'COMPLETED' && appointment.paymentMethod === 'ONLINE') {
			const doctorFees = appointment.doctor.fees * 100; // Convert to paise
			await prisma.doctor.update({
				where: { id: appointment.doctorId },
				data: {
					balance: {
						decrement: doctorFees,
					},
				},
			});
		}

		// Update appointment status to CANCELLED
		await prisma.appointment.update({
			where: { id: appointmentId },
			data: {
				status: 'CANCELLED',
			},
		});

		// Make slot available again
		await prisma.slot.update({
			where: { id: appointment.slotId },
			data: {
				status: 'AVAILABLE',
			},
		});

		// Send notification to doctor via Socket.IO
		try {
			const socketServerUrl = process.env.NEXT_PUBLIC_SOCKET_URL || process.env.SOCKET_SERVER_URL || 'http://localhost:4000';

			await fetch(`${socketServerUrl}/api/notifications/appointment-status`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({
					patientUserId: appointment.patient.user.id,
					appointmentId,
					status: 'CANCELLED',
					appointmentDate: appointment.slot.date.toISOString(),
					appointmentTime: appointment.slot.startTime.toISOString(),
					doctorName: appointment.doctor.user.name,
				}),
			}).catch((err) => {
				console.warn('Socket server notification failed:', err);
			});
		} catch (notifError) {
			console.warn('Failed to send cancellation notification:', notifError);
		}

		return NextResponse.json(
			{
				message: 'Appointment cancelled successfully',
				refundProcessed,
			},
			{ status: 200 }
		);
	} catch (error: unknown) {
		const errorMessage = error instanceof Error ? error.message : 'Failed to cancel appointment';
		console.error('Error cancelling appointment:', error);
		return NextResponse.json(
			{ error: errorMessage },
			{ status: 500 }
		);
	}
}
