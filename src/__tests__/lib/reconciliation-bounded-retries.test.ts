import { describe, it, expect, vi, beforeEach } from 'vitest';
import { prisma } from '@/lib/prisma';
import {
  reconcileUnresolvedOrders,
  reconcileCapturedCheckouts,
  reconcilePendingRefunds,
  replayRetryableWebhookEvents,
} from '@/lib/reconciliation-service';
import * as razorpayLib from '@/lib/razorpay';

// Mock razorpay functions
vi.mock('@/lib/razorpay', () => ({
  fetchRazorpayOrderByReceipt: vi.fn(),
  fetchRazorpayOrderPayments: vi.fn(),
  fetchRazorpayRefund: vi.fn(),
  fetchRazorpayPayment: vi.fn(),
  createRazorpayRefund: vi.fn(),
}));

describe('Reconciliation Bounded Retries & Terminal 404 Handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('reconcileUnresolvedOrders', () => {
    it('marks checkout MANUAL_REVIEW and clears nextAttemptAt when order lookup fails with status 404', async () => {
      const mockCheckout = {
        id: 'chk_unres_404',
        providerReference: 'receipt_nonexistent_123',
        status: 'UNRESOLVED',
        attempts: 1,
        expiresAt: new Date(Date.now() + 600_000),
      };

      vi.spyOn(prisma.checkout, 'findMany').mockResolvedValueOnce([mockCheckout as any]);
      vi.spyOn(prisma.checkout, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(razorpayLib, 'fetchRazorpayOrderByReceipt').mockRejectedValueOnce(
        new Error('Razorpay fetch order by receipt failed with status 404')
      );

      const result = await reconcileUnresolvedOrders(10);

      expect(result.errors.length).toBe(1);
      expect(prisma.checkout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'chk_unres_404' }),
          data: expect.objectContaining({
            status: 'MANUAL_REVIEW',
            nextAttemptAt: null,
          }),
        })
      );
    });
  });

  describe('reconcileCapturedCheckouts', () => {
    it('marks checkout MANUAL_REVIEW and clears nextAttemptAt when Razorpay returns 404', async () => {
      const mockCheckout = {
        id: 'chk_test_404',
        userId: 'user_1',
        doctorId: 'doc_1',
        slotId: 'slot_1',
        amount: 500,
        currency: 'INR',
        razorpayOrderId: 'order_nonexistent_123',
        status: 'READY_FOR_PAYMENT',
        attempts: 0,
        expiresAt: new Date(Date.now() + 600_000),
        payment: null,
      };

      vi.spyOn(prisma.checkout, 'findMany').mockResolvedValueOnce([mockCheckout as any]);
      vi.spyOn(prisma.checkout, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(razorpayLib, 'fetchRazorpayOrderPayments').mockRejectedValueOnce(
        new Error('Razorpay fetch order payments failed with status 404')
      );
      // Spy on pending payments query
      vi.spyOn(prisma.payment, 'findMany').mockResolvedValueOnce([]);

      const result = await reconcileCapturedCheckouts(10);

      expect(result.errors.length).toBe(1);
      expect(result.errors[0]).toContain('status 404');

      // Verify checkout was transitioned to MANUAL_REVIEW with nextAttemptAt: null
      expect(prisma.checkout.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'chk_test_404' }),
          data: expect.objectContaining({
            status: 'MANUAL_REVIEW',
            nextAttemptAt: null,
          }),
        })
      );
    });

    it('marks pending Payment FAILED and clears nextAttemptAt when Razorpay returns 404', async () => {
      vi.spyOn(prisma.checkout, 'findMany').mockResolvedValueOnce([]);

      const mockPayment = {
        id: 'pay_test_404',
        razorpayOrderId: 'order_fake_404',
        status: 'PENDING',
        attempts: 1,
        amount: 500,
        refunds: [],
      };

      vi.spyOn(prisma.payment, 'findMany').mockResolvedValueOnce([mockPayment as any]);
      vi.spyOn(prisma.payment, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(razorpayLib, 'fetchRazorpayOrderPayments').mockRejectedValueOnce(
        new Error('Razorpay fetch order payments failed with status 404')
      );

      const result = await reconcileCapturedCheckouts(10);

      expect(result.errors.length).toBe(1);
      expect(prisma.payment.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'pay_test_404' }),
          data: expect.objectContaining({
            status: 'FAILED',
            nextAttemptAt: null,
          }),
        })
      );
    });
  });

  describe('reconcilePendingRefunds', () => {
    it('marks refund FAILED and clears nextAttemptAt when Razorpay refund fails with status 404', async () => {
      const mockRefund = {
        id: 'rfnd_test_404',
        razorpayRefundId: 'rfnd_provider_404',
        status: 'PENDING',
        attempts: 2,
        amount: 500,
        payment: {
          id: 'pay_1',
          razorpayPaymentId: 'pay_rzp_1',
          razorpayOrderId: 'order_1',
        },
      };

      vi.spyOn(prisma.refund, 'findMany').mockResolvedValueOnce([mockRefund as any]);
      vi.spyOn(prisma.refund, 'updateMany').mockResolvedValue({ count: 1 });
      vi.spyOn(razorpayLib, 'fetchRazorpayRefund').mockRejectedValueOnce(
        new Error('Razorpay fetch refund failed with status 404')
      );

      const result = await reconcilePendingRefunds(10);

      expect(result.errors.length).toBe(1);
      expect(prisma.refund.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'rfnd_test_404' }),
          data: expect.objectContaining({
            status: 'FAILED',
            nextAttemptAt: null,
          }),
        })
      );
    });
  });

  describe('replayRetryableWebhookEvents', () => {
    it('clears nextAttemptAt when webhook event reaches max 5 attempts', async () => {
      const mockWebhook = {
        id: 'wh_test_max_attempts',
        eventType: 'payment.captured',
        payload: { event: 'payment.captured' },
        status: 'FAILED',
        attempts: 4, // Next will be 5
      };

      vi.spyOn(prisma.webhookEvent, 'findMany').mockResolvedValueOnce([mockWebhook as any]);
      vi.spyOn(prisma.webhookEvent, 'updateMany').mockResolvedValue({ count: 1 });

      const result = await replayRetryableWebhookEvents(10);

      expect(prisma.webhookEvent.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: 'wh_test_max_attempts' }),
          data: expect.objectContaining({
            status: 'FAILED',
            nextAttemptAt: null,
          }),
        })
      );
    });
  });
});

