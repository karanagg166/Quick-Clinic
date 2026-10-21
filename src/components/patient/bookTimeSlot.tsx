'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { processOnlinePayment, type CheckoutState } from '@/lib/processOnlinePayment';
import type { Slot } from '@/types/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { showToast } from '@/lib/toast';
import { getTodayInUserTimezone } from '@/lib/dateUtils';

interface BookTimeSlotProps {
  doctorId: string;
}

export default function BookTimeSlot({ doctorId }: BookTimeSlotProps) {
  const router = useRouter();
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [checkoutProgressText, setCheckoutProgressText] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);

  const isSlotBookable = (slot: Slot) => {
    if (slot.status !== 'AVAILABLE') return false;
    const today = getTodayInUserTimezone();
    if (date === today) {
      const slotStart = new Date(slot.startTime);
      if (slotStart <= new Date()) return false;
    }
    return true;
  };

  useEffect(() => {
    const timeout = window.setTimeout(() => setDate(getTodayInUserTimezone()), 0);
    return () => window.clearTimeout(timeout);
  }, []);

  const clearIdempotencyKey = useCallback((slotId: string, method?: 'ONLINE' | 'OFFLINE') => {
    if (typeof window === 'undefined') return;
    if (method) {
      sessionStorage.removeItem(`checkout_idem_${userId || 'anon'}_${doctorId}_${slotId}_${method}`);
    } else {
      sessionStorage.removeItem(`checkout_idem_${userId || 'anon'}_${doctorId}_${slotId}_ONLINE`);
      sessionStorage.removeItem(`checkout_idem_${userId || 'anon'}_${doctorId}_${slotId}_OFFLINE`);
    }
    sessionStorage.removeItem(`checkout_active_${userId || 'anon'}_${doctorId}`);
  }, [doctorId, userId]);

  // Resume status checks across page refresh for any in-flight checkout
  useEffect(() => {
    if (!userId || !doctorId) return;
    const activeDataStr = sessionStorage.getItem(`checkout_active_${userId}_${doctorId}`);
    if (!activeDataStr) return;

    try {
      const activeData = JSON.parse(activeDataStr);
      if (!activeData?.checkoutId) return;

      const checkActive = async () => {
        try {
          const res = await fetch(`/api/checkout/${encodeURIComponent(activeData.checkoutId)}/status`, {
            credentials: 'include',
          });
          if (res.ok) {
            const data = await res.json();
            if (data.isConfirmed && data.appointment) {
              clearIdempotencyKey(activeData.slotId, activeData.paymentMethod);
              showToast.success('Appointment confirmed! Redirecting to dashboard...');
              router.push('/patient');
              return;
            }
            if (data.status === 'REFUNDED' || data.refundStatus === 'REFUNDED') {
              clearIdempotencyKey(activeData.slotId, activeData.paymentMethod);
              showToast.info('Your reservation expired. Payment has been refunded.');
              return;
            }
            if (data.status === 'REFUND_PENDING' || data.refundStatus === 'REFUND_PENDING') {
              showToast.warning('Reservation expired. A refund has been initiated and is pending.');
              return;
            }
            if (data.status === 'READY_FOR_PAYMENT') {
              // Restore active slot reservation state on refresh
              if (activeData.date) {
                setDate(activeData.date);
              }
              setSelectedSlot(activeData.slotId);
              setShowPaymentOptions(true);
              return;
            }
            if (data.status === 'UNRESOLVED') {
              showToast.info('Payment verification in progress for your slot reservation.');
              setSelectedSlot(activeData.slotId);
              return;
            }
            if (data.status === 'EXPIRED' || data.status === 'FAILED') {
              clearIdempotencyKey(activeData.slotId, activeData.paymentMethod);
            }
          }
        } catch {
          // ignore transient mount fetch error
        }
      };

      void checkActive();
    } catch {
      sessionStorage.removeItem(`checkout_active_${userId}_${doctorId}`);
    }
  }, [userId, doctorId, clearIdempotencyKey, router]);

  useEffect(() => {
    if (!doctorId || !date) return;
    const fetchSlots = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetch(`/api/doctors/${doctorId}/slots?date=${date}`, { credentials: 'include' });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || 'Unable to load slots');
        setSlots(payload.slots || []);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Unable to load slots');
      } finally {
        setLoading(false);
      }
    };
    void fetchSlots();
  }, [doctorId, date]);

  const formatTime = (dateString: string) => new Date(dateString).toLocaleTimeString('en-US', {
    hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'UTC',
  });

  const getOrGenerateIdempotencyKey = useCallback((slotId: string, method: 'ONLINE' | 'OFFLINE') => {
    if (typeof window === 'undefined') return `ord_${userId || 'anon'}_${slotId}_${method}_${Date.now()}`;
    const storageKey = `checkout_idem_${userId || 'anon'}_${doctorId}_${slotId}_${method}`;
    let key = sessionStorage.getItem(storageKey);
    if (!key) {
      key = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ord_${userId?.slice(-6) || 'usr'}_${slotId}_${method}_${Date.now()}`;
      sessionStorage.setItem(storageKey, key);
    }
    return key;
  }, [doctorId, userId]);

  const handleOfflineBooking = async (slotId: string) => {
    if (!userId) {
      showToast.warning('Please login to book an appointment');
      return;
    }

    try {
      setBooking(true);
      setCheckoutProgressText('Confirming clinic booking...');
      const idempotencyKey = getOrGenerateIdempotencyKey(slotId, 'OFFLINE');

      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          action: 'INITIATE',
          doctorId,
          slotId,
          paymentMethod: 'OFFLINE',
          idempotencyKey,
        }),
      });

      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 || payload.canRestart) {
          clearIdempotencyKey(slotId, 'OFFLINE');
        }
        throw new Error(payload.error || payload.message || 'Unable to confirm booking');
      }

      clearIdempotencyKey(slotId, 'OFFLINE');
      setSlots((previous) => previous.map((slot) => slot.id === slotId ? { ...slot, status: 'BOOKED' } : slot));
      setSelectedSlot(null);
      setShowPaymentOptions(false);
      showToast.success('Appointment confirmed! Redirecting to dashboard...');
      setTimeout(() => {
        router.push('/patient');
      }, 1000);
    } catch (cause) {
      showToast.error(cause instanceof Error ? cause.message : 'Unable to book this slot');
    } finally {
      setBooking(false);
      setCheckoutProgressText(null);
    }
  };

  const handleOnlinePayment = async (slotId: string) => {
    if (!userId) {
      showToast.warning('Please login to pay online');
      return;
    }

    try {
      setBooking(true);
      const idempotencyKey = getOrGenerateIdempotencyKey(slotId, 'ONLINE');

      const payment = await processOnlinePayment({
        doctorId,
        slotId,
        userId,
        idempotencyKey,
        userEmail: user?.email || undefined,
        userName: user?.name || undefined,
        userPhone: user?.phoneNo || undefined,
        onStateChange: (state: CheckoutState) => {
          switch (state) {
            case 'LOADING_SDK':
            case 'CREATING_ORDER':
              setCheckoutProgressText('Preparing payment...');
              break;
            case 'AWAITING_PAYMENT':
              setCheckoutProgressText('Awaiting payment...');
              break;
            case 'CONFIRMING':
              setCheckoutProgressText('Confirming booking...');
              break;
            default:
              setCheckoutProgressText(null);
              break;
          }
        },
      });

      if (payment.state === 'BOOKED' && payment.success && payment.appointmentId) {
        clearIdempotencyKey(slotId, 'ONLINE');
        setSlots((previous) => previous.map((slot) => slot.id === slotId ? { ...slot, status: 'BOOKED' } : slot));
        setSelectedSlot(null);
        setShowPaymentOptions(false);
        showToast.success('Payment successful and appointment confirmed! Redirecting to dashboard...');
        setTimeout(() => {
          router.push('/patient');
        }, 1000);
        return;
      }

      if (payment.state === 'REFUNDED') {
        clearIdempotencyKey(slotId, 'ONLINE');
        showToast.error(payment.error || 'The slot reservation expired. Your payment has been refunded.');
        return;
      }

      if (payment.state === 'REFUND_PENDING') {
        clearIdempotencyKey(slotId, 'ONLINE');
        showToast.error(payment.error || 'The slot reservation expired. A refund has been initiated and is pending.');
        return;
      }

      if (payment.state === 'PAYMENT_RECEIVED_BOOKING_PENDING') {
        if (payment.checkoutId) {
          sessionStorage.setItem(
            `checkout_active_${userId}_${doctorId}`,
            JSON.stringify({ checkoutId: payment.checkoutId, slotId, doctorId, paymentMethod: 'ONLINE', date })
          );
        }
        showToast.warning('Payment was received! Your booking confirmation is finalizing. Redirecting to dashboard...');
        setTimeout(() => {
          router.push('/patient');
        }, 2000);
        return;
      }

      if (payment.state === 'FAILED') {
        clearIdempotencyKey(slotId, 'ONLINE');
      }

      throw new Error(payment.error || 'Payment failed or was cancelled');
    } catch (cause) {
      showToast.error(cause instanceof Error ? cause.message : 'Online payment failed');
    } finally {
      setBooking(false);
      setCheckoutProgressText(null);
    }
  };

  return (
    <Card className="max-w-5xl mx-auto">
      <CardHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="date-picker" className="block text-lg font-semibold mb-2">Select Date</label>
            <Input id="date-picker" type="date" value={date} onChange={(event) => {
              setDate(event.target.value); setSelectedSlot(null); setShowPaymentOptions(false);
            }} min={new Date().toISOString().split('T')[0]} className="w-full md:w-auto" />
          </div>
          <CardTitle>Available Slots for {date && new Date(date).toLocaleDateString('en-US', {
            weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
          })}</CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? <div className="text-center py-8 space-y-4"><Skeleton className="h-12 w-12 rounded-full mx-auto" /><Skeleton className="h-4 w-48 mx-auto" /></div>
          : slots.filter(isSlotBookable).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-lg">No available slots for this date</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-3">Available Time Slots</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {slots
                    .filter(isSlotBookable)
                    .map((slot) => (
                      <Button
                        key={slot.id}
                        onClick={() => {
                          setSelectedSlot(slot.id);
                          setShowPaymentOptions(false);
                        }}
                        disabled={booking}
                        variant={selectedSlot === slot.id ? 'default' : 'outline'}
                        className={
                          selectedSlot === slot.id
                            ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm'
                            : 'border-green-300 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-500'
                        }
                      >
                        {formatTime(slot.startTime)}
                      </Button>
                    ))}
                </div>
              </div>
              {selectedSlot && (
                <div className="pt-4 border-t space-y-4">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                    <div>
                      <p className="text-muted-foreground">Selected Time:</p>
                      <p className="text-xl font-semibold">
                        {formatTime(slots.find((slot) => slot.id === selectedSlot)?.startTime || '')}
                      </p>
                      {checkoutProgressText && (
                        <p className="text-sm font-medium text-blue-600 animate-pulse mt-1">
                          {checkoutProgressText}
                        </p>
                      )}
                    </div>
                    {!showPaymentOptions ? (
                      <Button onClick={() => setShowPaymentOptions(true)} size="lg" disabled={booking}>
                        Proceed to Book
                      </Button>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={() => void handleOnlinePayment(selectedSlot)} disabled={booking} size="lg" className="bg-purple-600 hover:bg-purple-700">
                          {booking ? (checkoutProgressText || 'Booking...') : 'Pay Online'}
                        </Button>
                        <Button onClick={() => void handleOfflineBooking(selectedSlot)} disabled={booking} size="lg" className="bg-green-600 hover:bg-green-700">
                          {booking ? (checkoutProgressText || 'Booking...') : 'Pay at Clinic'}
                        </Button>
                        <Button onClick={() => setShowPaymentOptions(false)} disabled={booking} variant="ghost" size="lg">
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="pt-4 border-t text-sm text-muted-foreground">
                Slots are reserved for up to 10 minutes only upon proceeding to payment.
              </div>
            </div>
          )}
        {error && <div className="mt-6 p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">{error}</div>}
      </CardContent>
    </Card>
  );
}
