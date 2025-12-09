// this is a slot where patient will book timeslots with doctor

'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useUserStore } from '@/store/userStore';
import { set } from 'date-fns';

// this component will take doctorId as prop
interface BookTimeSlotProps {
    doctorId: string;
}

interface Slot {
    id: string;
    startTime: string;
    endTime: string;
    status: 'AVAILABLE' | 'HELD' | 'BOOKED' | 'UNAVAILABLE' | 'CANCELLED';
    date: string;
}

export default function BookTimeSlot({doctorId}: BookTimeSlotProps) {
    const router = useRouter();
    const { patientId } = useUserStore();
    const [date, setDate] = useState<string>('');
    const [slots, setSlots] = useState<Slot[]>([]);
    const [loading, setLoading] = useState(false);
    const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
    const [booking, setBooking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Initialize date to today
    useEffect(() => {
        const today = new Date();
        const formattedDate = today.toISOString().split('T')[0];
        setDate(formattedDate);
    }, []);

    useEffect(() => {
        // Fetch available time slots for the given doctor and date
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
                    console.error("Failed to fetch slots");
                    console.log(res);
                    setError("Error: " + res.error);
                }
            } catch (error) {
                console.error("Error fetching slots:", error);
                setError("Error: "+ (error instanceof Error ? error.message : String(error)));
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
        const date = new Date(dateString);
        return date.toLocaleTimeString('en-US', { 
            hour: '2-digit', 
            minute: '2-digit',
            hour12: true 
        });
    };

    const handleBookSlot = async (slotId: string) => {
        if (!patientId) {
            alert("Please login to book a slot");
            return;
        }

        try {
            setBooking(true);
            const res = await fetch(`/api/appointments`, {
                method: 'POST',
                credentials: 'include',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    slotId,
                    doctorId,
                    patientId,
                }),
            });

            if (res.ok) {
                alert("Slot booked successfully!");
                // Refresh slots by updating the state
                setSlots(prev => prev.map(slot => 
                    slot.id === slotId ? { ...slot, status: 'BOOKED' as const } : slot
                ));
                setSelectedSlot(null);
            } else {
                const error = await res.json();
                alert(error.message || "Failed to book slot");
            }
        } catch (error) {
            console.error("Error booking slot:", error);
            alert("Failed to book slot");
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
                        setSelectedSlot(null); // Reset selected slot when date changes
                    }}
                    min={new Date().toISOString().split('T')[0]}
                    className="w-full md:w-auto px-4 py-2 border-2 border-gray-300 rounded-lg focus:outline-none focus:border-blue-500 text-gray-700 font-medium"
                />
            </div>

            <h2 className="text-2xl font-bold text-gray-800 mb-4">
                Available Slots for {date && new Date(date).toLocaleDateString('en-US', { 
                    weekday: 'long', 
                    year: 'numeric', 
                    month: 'long', 
                    day: 'numeric' 
                })}
            </h2>

            {loading ? (
                <div className="text-center py-8">
                    <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto"></div>
                    <p className="mt-4 text-gray-600">Loading available slots...</p>
                </div>
            ) : totalSlots === 0 ? (
                <div className="text-center py-8">
                    <p className="text-gray-600 text-lg">No slots available for this date</p>
                </div>
            ) : (
                <div className="space-y-6">
                    {/* All Available Slots */}
                    <div>
                        <h3 className="text-xl font-semibold text-gray-700 mb-3">Available Time Slots</h3>
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                            {slots.map((slot) => (
                                <button
                                    key={slot.id}
                                    onClick={() => setSelectedSlot(slot.id)}
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

                    {/* Book Button */}
                    {selectedSlot && (
                        <div className="pt-4 border-t">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-gray-600">Selected Time:</p>
                                    <p className="text-xl font-semibold text-gray-800">
                                        {formatTime(slots.find((s) => s.id === selectedSlot)?.startTime || '')}
                                    </p>
                                </div>
                                <button
                                    onClick={() => handleBookSlot(selectedSlot)}
                                    disabled={booking}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-lg font-semibold
                                             hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed
                                             transition-colors duration-200 shadow-md"
                                >
                                    {booking ? 'Booking...' : 'Confirm Booking'}
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Legend */}
                    <div className="pt-4 border-t">
                        <p className="text-sm text-gray-600 mb-2">Legend:</p>
                        <div className="flex flex-wrap gap-4 text-sm">
                            <div className="flex items-center">
                                <div className="w-4 h-4 bg-green-50 border-2 border-green-300 rounded mr-2"></div>
                                <span className="text-gray-700">Available</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-4 h-4 bg-blue-600 border-2 border-blue-600 rounded mr-2"></div>
                                <span className="text-gray-700">Selected</span>
                            </div>
                            <div className="flex items-center">
                                <div className="w-4 h-4 bg-gray-100 border-2 border-gray-200 rounded mr-2"></div>
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
