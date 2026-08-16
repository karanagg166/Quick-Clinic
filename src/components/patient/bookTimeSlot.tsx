'use client';

import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { processOnlinePayment } from '@/lib/processOnlinePayment';
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

type Hold = { slotId: string; token: string };

export default function BookTimeSlot({ doctorId }: BookTimeSlotProps) {
  const user = useUserStore((state) => state.user);
  const userId = user?.id;
  const [date, setDate] = useState('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);
  const [activeHold, setActiveHold] = useState<Hold | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDate(getTodayInUserTimezone()), 0);
    return () => window.clearTimeout(timeout);
  }, []);

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
    hour: '2-digit', minute: '2-digit', hour12: true,
  });

  const acquireHold = async (slotId: string): Promise<Hold> => {
    const response = await fetch('/api/appointments/hold', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ slotId, doctorId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok || !payload.holdToken) throw new Error(payload.error || 'This slot is no longer available');
    const hold = { slotId, token: payload.holdToken as string };
    setActiveHold(hold);
    return hold;
  };

  const releaseHold = async (hold: Hold | null) => {
    if (!hold) return;
    await fetch('/api/appointments/cancel-hold', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ slotId: hold.slotId, holdToken: hold.token }),
    }).catch(() => undefined);
    setActiveHold(null);
  };

  const confirmHold = async (hold: Hold, paymentMethod: 'ONLINE' | 'OFFLINE', transactionId?: string) => {
    const response = await fetch('/api/appointments/confirm', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
      body: JSON.stringify({ slotId: hold.slotId, doctorId, holdToken: hold.token, paymentMethod, transactionId: transactionId ?? null }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || 'Unable to confirm this booking');
    setActiveHold(null);
    setSlots((previous) => previous.map((slot) => slot.id === hold.slotId ? { ...slot, status: 'BOOKED' } : slot));
    setSelectedSlot(null);
    setShowPaymentOptions(false);
    showToast.success(paymentMethod === 'ONLINE' ? 'Appointment confirmed! Details and cancellation link sent to chat.' : 'Appointment confirmed! Details and cancellation link sent to chat.');
  };

  const handleOfflineBooking = async (slotId: string) => {
    let hold: Hold | null = null;
    try {
      setBooking(true);
      hold = await acquireHold(slotId);
      await confirmHold(hold, 'OFFLINE');
    } catch (cause) {
      await releaseHold(hold);
      showToast.error(cause instanceof Error ? cause.message : 'Unable to book this slot');
    } finally {
      setBooking(false);
    }
  };

  const handleOnlinePayment = async (slotId: string) => {
    if (!userId) {
      showToast.warning('Please login to pay online');
      return;
    }
    let hold: Hold | null = null;
    let paymentCaptured = false;
    try {
      setBooking(true);
      hold = await acquireHold(slotId);
      const payment = await processOnlinePayment({
        doctorId,
        holdToken: hold.token,
        slotId,
        userId,
        userEmail: user?.email || undefined,
        userName: user?.name || undefined,
        userPhone: user?.phoneNo || undefined,
      });
      paymentCaptured = Boolean(payment.paymentCaptured);
      if (!payment?.success || !payment.transactionId) throw new Error(payment?.error || 'Payment failed or was cancelled');
      setActiveHold(null);
      setSlots((previous) => previous.map((slot) => slot.id === hold?.slotId ? { ...slot, status: 'BOOKED' } : slot));
      setSelectedSlot(null);
      setShowPaymentOptions(false);
      showToast.success('Payment successful and appointment confirmed.');
    } catch (cause) {
      if (!paymentCaptured) {
        await releaseHold(hold);
      }
      showToast.error(cause instanceof Error ? cause.message : 'Online payment failed');
    } finally {
      setBooking(false);
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
          : slots.filter((slot) => slot.status === 'AVAILABLE' || (activeHold && slot.id === activeHold.slotId)).length === 0 ? (
            <div className="text-center py-8">
              <p className="text-muted-foreground text-lg">No available slots for this date</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div>
                <h3 className="text-xl font-semibold mb-3">Available Time Slots</h3>
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {slots
                    .filter((slot) => slot.status === 'AVAILABLE' || (activeHold && slot.id === activeHold.slotId))
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
                    </div>
                    {!showPaymentOptions ? (
                      <Button onClick={() => setShowPaymentOptions(true)} size="lg" disabled={booking}>
                        Proceed to Book
                      </Button>
                    ) : (
                      <div className="flex flex-wrap gap-3">
                        <Button onClick={() => void handleOnlinePayment(selectedSlot)} disabled={booking} size="lg" className="bg-purple-600 hover:bg-purple-700">
                          {booking ? 'Booking...' : 'Pay Online'}
                        </Button>
                        <Button onClick={() => void handleOfflineBooking(selectedSlot)} disabled={booking} size="lg" className="bg-green-600 hover:bg-green-700">
                          {booking ? 'Booking...' : 'Pay at Clinic'}
                        </Button>
                        <Button onClick={() => { void releaseHold(activeHold); setShowPaymentOptions(false); }} disabled={booking} variant="ghost" size="lg">
                          Cancel
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
              <div className="pt-4 border-t text-sm text-muted-foreground">
                A selected slot is held for up to 10 minutes only while payment is in progress.
              </div>
            </div>
          )}
        {error && <div className="mt-6 p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">{error}</div>}
      </CardContent>
    </Card>
  );
}
