'use client';
import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { processOnlinePayment } from '@/lib/processOnlinePayment';
import { useThrottledCallback } from '@/lib/useThrottledCallback';
import type { Slot } from '@/types/common';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { showToast } from '@/lib/toast';
import { getTodayInUserTimezone, formatUTCToUserTimezone } from '@/lib/dateUtils';

interface BookTimeSlotProps {
  doctorId: string;
}

export default function BookTimeSlot({ doctorId }: BookTimeSlotProps) {
  const { patientId } = useUserStore();
  const userId = useUserStore((state) => state.user?.id);

  const [date, setDate] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);

  useEffect(() => {
    // Get today's date in user's local timezone (YYYY-MM-DD)
    const formattedDate = getTodayInUserTimezone();
    setDate(formattedDate);
  }, []);
  
    // Function to check slots
  
  useEffect(() => {
    const fetchSlots = async () => {
      if (!date) return;
      try {
        setLoading(true);
        const data = await fetch(`/api/doctors/${doctorId}/slots?date=${date}`, {
          method: 'GET',
          credentials: 'include',
        });
        const res = await data.json();
        if (data.ok) {
          setSlots(res.slots || []);
        } else {
          console.error('Failed to fetch slots');
          setError('Error: ' + res.error);
        }
      } catch (err) {
        console.error('Error fetching slots:', err);
        setError('Error: ' + (err instanceof Error ? err.message : String(err)));
      } finally {
        setLoading(false);
      }
    };

    if (doctorId && date) {
      setError(null);
      fetchSlots();
    }
  }, [doctorId, date]);

  const formatTime = (dateString: string) => {
    const d = new Date(dateString);
    return d.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    });
  };

  /**
   * handleBookSlot
   * - slotId: string
   * - paymentMethod: 'ONLINE' | 'OFFLINE'
   * - transactionId?: string (present only for ONLINE)
   */
  const handleBookSlot = async (slotId: string, paymentMethod: string, transactionId?: string | null) => {
    if (!patientId) {
      showToast.warning('Please login to book a slot');
      return;
    }
    if (!date || !slotId || !doctorId) {
      showToast.warning('Invalid selection');
      return;
    }

    try {
      setBooking(true);

      const bodyPayload: any = {
        doctorId,
        slotId,
        paymentMethod,
      };

      // Include transactionId only when provided (ONLINE)
      if (paymentMethod === 'ONLINE' && transactionId) {
        bodyPayload.transactionId = transactionId;
      }

      const bookingData = await fetch(`/api/patients/${patientId}/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(bodyPayload),
        credentials: 'include',
      });

      if (bookingData.ok) {
        await bookingData.json();
        showToast.success(paymentMethod === 'ONLINE' ? 'Slot booked successfully (Online payment)' : 'Slot booked successfully (Offline)');
        setSelectedSlot(null);
        setShowPaymentOptions(false);

        setSlots((prevSlots) =>
          prevSlots.map((slot) => (slot.id === slotId ? { ...slot, status: 'BOOKED' } : slot))
        );
      } else {
        const errorData = await bookingData.json().catch(() => ({}));
        throw new Error(errorData.message || 'Failed to book slot');
      }
    } catch (err: any) {
      showToast.error(err?.message || 'Failed to book slot');
      console.error('Error booking slot:', err);
    } finally {
      setBooking(false);
    }
  };

  /**
   * handleOnlinePayment
   * - Finds slot object to determine amount (tries slot.fee or slot.price)
   * - Calls processOnlinePayment(amount)
   * - On success calls handleBookSlot(slotId, 'ONLINE', transactionId)
   *
   * NO redirects, NO new pages — processOnlinePayment is expected to call your server endpoints.
   */
  // --- CORRECTION & THROTTLING IMPLEMENTATION ---

// 1. Throttled function for "Pay at Clinic" button
// It wraps the complex handleBookSlot logic, fixing the dependency issue.
const throttledBookOffline = useThrottledCallback((slotId: string) => {
    // We call the original function here, passing the required arguments.
    // The base function (handleBookSlot) is stable because it's wrapped in useCallback (as shown in the prior response).
    return handleBookSlot(slotId, 'OFFLINE');
}, 3000); // Set delay to 3000ms (3 seconds)









// 2. Throttled function for "Pay Online" button
// It wraps the handleOnlinePayment logic.
const throttledPayOnline = useThrottledCallback((slotId: string) => {
    // We call the original function here.
    return handleOnlinePayment(slotId);
}, 3000); // Set delay to 3000ms (3 seconds)
  const handleOnlinePayment = async (slotId: string) => {
    if (!patientId) {
      showToast.warning('Please login to pay online');
      return;
    }
    if (!date || !slotId || !doctorId) {
      showToast.warning('Missing payment parameters');
      return;
    }

    // derive amount from slot if available, fallback to 50000 (adjust as needed)
    const slot = slots.find((s) => s.id === slotId) as any;
    const amount = Number(slot?.fee ?? slot?.price ?? 50000);

    try {
      setBooking(true);
      // processOnlinePayment returns { success, transactionId, error? }
      const result = await processOnlinePayment(amount,userId!);

      if (!result || !result.success) {
        const msg = result?.error ?? 'Payment failed or cancelled';
        showToast.error('Payment failed: ' + msg);
        return;
      }

      const transactionId = result.transactionId;
      if (!transactionId) {
        showToast.error('Payment succeeded but no transactionId returned.');
        return;
      }

      // Now finalize booking using your existing booking endpoint
      await handleBookSlot(slotId, 'ONLINE', transactionId);
    } catch (err: any) {
      console.error('handleOnlinePayment error', err);
      showToast.error(err?.message || 'Online payment failed');
    } finally {
      setBooking(false);
    }
  };

  const totalSlots = slots.length;

  return (
    <Card className="max-w-5xl mx-auto">
      <CardHeader>
        <div className="space-y-4">
          <div>
            <label htmlFor="date-picker" className="block text-lg font-semibold mb-2">
              Select Date
            </label>
            <Input
              id="date-picker"
              type="date"
              value={date}
              onChange={(e) => {
                setDate(e.target.value);
                setSelectedSlot(null);
                setShowPaymentOptions(false);
              }}
              min={new Date().toISOString().split('T')[0]}
              className="w-full md:w-auto"
            />
          </div>
          <CardTitle>
            Available Slots for{' '}
            {date &&
              new Date(date).toLocaleDateString('en-US', {
                weekday: 'long',
                year: 'numeric',
                month: 'long',
                day: 'numeric',
              })}
          </CardTitle>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="text-center py-8 space-y-4">
            <Skeleton className="h-12 w-12 rounded-full mx-auto" />
            <Skeleton className="h-4 w-48 mx-auto" />
          </div>
        ) : totalSlots === 0 ? (
          <div className="text-center py-8">
            <p className="text-muted-foreground text-lg">No slots available for this date</p>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-xl font-semibold mb-3">Available Time Slots</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {slots.map((slot) => (
                  <Button
                    key={slot.id}
                    onClick={() => {
                      setSelectedSlot(slot.id);
                      setShowPaymentOptions(false);
                    }}
                    disabled={slot.status !== 'AVAILABLE'}
                    variant={selectedSlot === slot.id ? "default" : "outline"}
                    className={
                      slot.status === 'AVAILABLE'
                        ? selectedSlot === slot.id
                          ? "bg-blue-600 hover:bg-blue-700"
                          : "border-green-300 bg-green-50 text-green-700 hover:bg-green-100 hover:border-green-500"
                        : "opacity-50 cursor-not-allowed"
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
                      {formatTime(slots.find((s) => s.id === selectedSlot)?.startTime || '')}
                    </p>
                  </div>

                  {!showPaymentOptions ? (
                    <Button
                      onClick={() => setShowPaymentOptions(true)}
                      size="lg"
                    >
                      Proceed to Book
                    </Button>
                  ) : (
                    <div className="flex flex-wrap gap-3">
                      <Button
                        onClick={() => selectedSlot && throttledPayOnline(selectedSlot)}
                        size="lg"
                        className="bg-purple-600 hover:bg-purple-700"
                      >
                        Pay Online
                      </Button>

                      <Button
                        onClick={() => selectedSlot && throttledBookOffline(selectedSlot)}
                        disabled={booking}
                        size="lg"
                        className="bg-green-600 hover:bg-green-700"
                      >
                        {booking ? 'Booking...' : 'Pay at Clinic'}
                      </Button>

                      <Button
                        onClick={() => setShowPaymentOptions(false)}
                        variant="ghost"
                        size="lg"
                      >
                        Cancel
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            )}

            <div className="pt-4 border-t">
              <p className="text-sm text-muted-foreground mb-2">Legend:</p>
              <div className="flex flex-wrap gap-4 text-sm">
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-green-50 border-2 border-green-300 rounded mr-2" />
                  <span>Available</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-blue-600 border-2 border-blue-600 rounded mr-2" />
                  <span>Selected</span>
                </div>
                <div className="flex items-center">
                  <div className="w-4 h-4 bg-gray-100 border-2 border-gray-200 rounded mr-2" />
                  <span>Unavailable</span>
                </div>
              </div>
            </div>
          </div>
        )}

        {error && (
          <div className="mt-6 p-4 bg-destructive/10 border border-destructive text-destructive rounded-lg">
            {error}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
