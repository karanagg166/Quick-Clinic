'use client';
import { useEffect, useState } from 'react';
import { useUserStore } from '@/store/userStore';
import { processOnlinePayment } from '@/lib/processOnlinePayment';
import { useThrottledCallback } from '@/lib/useThrottledCallback';
import type { Slot } from '@/types/common';

interface BookTimeSlotProps {
  doctorId: string;
}

export default function BookTimeSlot({ doctorId }: BookTimeSlotProps) {
  const { patientId } = useUserStore();
  const userId = useUserStore((state) => state.user?.userId);

  const [date, setDate] = useState<string>('');
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPaymentOptions, setShowPaymentOptions] = useState(false);

  useEffect(() => {
    const today = new Date();
    const formattedDate = today.toISOString().split('T')[0];
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
      alert('Please login to book a slot');
      return;
    }
    if (!date || !slotId || !doctorId) {
      alert('Invalid selection');
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
        const data = await bookingData.json();
        alert(paymentMethod === 'ONLINE' ? 'Slot booked successfully (Online payment)' : 'Slot booked successfully (Offline)');
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
      alert(err?.message || 'Failed to book slot');
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
      alert('Please login to pay online');
      return;
    }
    if (!date || !slotId || !doctorId) {
      alert('Missing payment parameters');
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
        alert('Payment failed: ' + msg);
        return;
      }

      const transactionId = result.transactionId;
      if (!transactionId) {
        alert('Payment succeeded but no transactionId returned.');
        return;
      }

      // Now finalize booking using your existing booking endpoint
      await handleBookSlot(slotId, 'ONLINE', transactionId);
    } catch (err: any) {
      console.error('handleOnlinePayment error', err);
      alert(err?.message || 'Online payment failed');
    } finally {
      setBooking(false);
    }
  };

  const totalSlots = slots.length;

  return (
    <div className="max-w-5xl mx-auto p-6 bg-white shadow-lg rounded-lg">
      {/* Date Picker Section */}
      <div className="mb-6 pb-6 border-b">
        <label htmlFor="date-picker" className="block text-lg font-semibold text-gray-700 mb-2">
          Select Date
        </label>
        <input
          id="date-picker"
          type="date"
          value={date}
          onChange={(e) => {
            setDate(e.target.value);
            setSelectedSlot(null);
            setShowPaymentOptions(false);
          }}
          min={new Date().toISOString().split('T')[0]}
          className="w-full md:w-auto px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 font-medium"
        />
      </div>

      <h2 className="text-2xl font-bold text-gray-800 mb-4">
        Available Slots for{' '}
        {date &&
          new Date(date).toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
          })}
      </h2>

      {loading ? (
        <div className="text-center py-8">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto" />
          <p className="mt-4 text-gray-600">Loading available slots...</p>
        </div>
      ) : totalSlots === 0 ? (
        <div className="text-center py-8">
          <p className="text-gray-600 text-lg">No slots available for this date</p>
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h3 className="text-xl font-semibold text-gray-700 mb-3">Available Time Slots</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
              {slots.map((slot) => (
                <button
                  key={slot.id}
                  onClick={() => {
                    setSelectedSlot(slot.id);
                    setShowPaymentOptions(false);
                  }}
                  disabled={slot.status !== 'AVAILABLE'}
                  className={`
                                        py-3 px-4 rounded-lg border-2 transition-all duration-200 font-medium
                                        ${slot.status === 'AVAILABLE'
                      ? selectedSlot === slot.id
                        ? 'border-blue-600 bg-blue-600 text-white shadow-lg'
                        : 'border-green-300 bg-green-50 text-green-700 hover:border-green-500 hover:bg-green-100'
                      : 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                    }
                                    `}
                >
                  {formatTime(slot.startTime)}
                </button>
              ))}
            </div>
          </div>

          {selectedSlot && (
            <div className="pt-4 border-t">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div>
                  <p className="text-gray-600">Selected Time:</p>
                  <p className="text-xl font-semibold text-gray-800">
                    {formatTime(slots.find((s) => s.id === selectedSlot)?.startTime || '')}
                  </p>
                </div>

                {!showPaymentOptions ? (
                  <button
                    onClick={() => setShowPaymentOptions(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors duration-200 shadow-md"
                  >
                    Proceed to Book
                  </button>
                ) : (
                  <div className="flex flex-wrap gap-3 animate-in fade-in slide-in-from-right-4 duration-300">
                    <button
                      onClick={() => selectedSlot && throttledPayOnline(selectedSlot)}
                      className="px-6 py-3 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 shadow-md transition-all"
                    >
                      Pay Online
                    </button>

                    <button
                      onClick={() => selectedSlot && throttledBookOffline(selectedSlot)}
                      disabled={booking}
                      className="px-6 py-3 bg-green-600 text-white rounded-lg font-semibold hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed shadow-md transition-all"
                    >
                      {booking ? 'Booking...' : 'Pay at Clinic'}
                    </button>

                    <button
                      onClick={() => setShowPaymentOptions(false)}
                      className="px-4 py-3 text-gray-500 hover:text-gray-700 underline"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="pt-4 border-t">
            <p className="text-sm text-gray-600 mb-2">Legend:</p>
            <div className="flex flex-wrap gap-4 text-sm">
              <div className="flex items-center">
                <div className="w-4 h-4 bg-green-50 border-2 border-green-300 rounded mr-2" />
                <span className="text-gray-700">Available</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-blue-600 border-2 border-blue-600 rounded mr-2" />
                <span className="text-gray-700">Selected</span>
              </div>
              <div className="flex items-center">
                <div className="w-4 h-4 bg-gray-100 border-2 border-gray-200 rounded mr-2" />
                <span className="text-gray-700">Unavailable</span>
              </div>
            </div>
          </div>
        </div>
      )}

      {error && (
        <div className="mt-6 p-4 bg-red-100 border border-red-400 text-red-700 rounded-lg">
          {error}
        </div>
      )}
    </div>
  );
}
