"use client";

import { useEffect, useState, useRef } from "react";
import { useUserStore } from "@/store/userStore";
import AppointmentCard from "@/components/doctor/appointmentCard";
import type { DoctorAppointment } from "@/types/doctor";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { io, Socket } from "socket.io-client";

export default function DoctorAppointmentsPage() {
  const doctorId = useUserStore((s) => s.doctorId);
  const userId = useUserStore((s) => s.user?.id);
  const socketRef = useRef<Socket | null>(null);

  const [appointments, setAppointments] = useState<DoctorAppointment[]>([]);
  const [loading, setLoading] = useState(false);
  const [socketConnected, setSocketConnected] = useState(false);

  // Existing Filters
  const [patientName, setPatientName] = useState("");
  const [patientEmail, setPatientEmail] = useState("");
  const [gender, setGender] = useState("");
  const [city, setCity] = useState("");
  const [age, setAge] = useState("");

  const [status, setStatus] = useState("");

  // NEW filters
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("");

  const [paymentMethod, setPaymentMethod] = useState("");

  const fetchAppointments = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();
    params.append("doctorId", doctorId);

    if (patientName) params.append("patientName", patientName);
    if (patientEmail) params.append("patientEmail", patientEmail);
    if (gender && gender !== "all") params.append("gender", gender);
    if (city) params.append("city", city);
    if (age) params.append("age", age);

    // NEW FILTERS
    if (startDate) params.append("startDate", startDate);
    if (startTime) params.append("startTime", startTime);
    if (endDate) params.append("endDate", endDate);
    if (endTime) params.append("endTime", endTime);

    if (paymentMethod && paymentMethod !== "all") params.append("paymentMethod", paymentMethod);

    if (status && status !== "all") params.append("status", status);

    const res = await fetch(
      `/api/doctors/${doctorId}/appointments?${params.toString()}`
    );
    const data = await res.json();

    if (res.ok && Array.isArray(data)) {
      setAppointments(data);
    } else {
      console.error("Failed to fetch appointments", data?.error || data);
      setAppointments([]);
    }

    setLoading(false);
  };

  useEffect(() => {
    if (doctorId) {
      fetchAppointments();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doctorId]);

  // Setup Socket.IO connection for real-time appointment requests
  useEffect(() => {
    if (!userId) return;

    // Clean up existing connection if any
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const socketUrl = process.env.NEXT_PUBLIC_SOCKET_URL || 'http://localhost:4000';
    
    console.log('Connecting to Socket.IO for appointment requests:', socketUrl);
    
    const socket = io(socketUrl, {
      auth: {
        userId, // Only userId, no relationId for notifications
      },
      transports: ['polling', 'websocket'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      timeout: 20000,
      forceNew: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('Appointment requests socket connected');
      setSocketConnected(true);
    });

    socket.on('notification_connected', (data: { message: string; userId: string; userRole: string; userName: string }) => {
      console.log('Notification connection confirmed:', data);
    });

    // Listen for new appointment requests
    socket.on('new_appointment_request', (data: { appointment: DoctorAppointment }) => {
      console.log('Received new appointment request:', data.appointment);
      
      // Add the new appointment to the list (if it's pending and matches filters)
      setAppointments((prev) => {
        // Check if appointment already exists
        const exists = prev.some((apt) => apt.id === data.appointment.id);
        if (exists) {
          // Update existing appointment
          return prev.map((apt) => 
            apt.id === data.appointment.id ? data.appointment : apt
          );
        }
        // Add new appointment at the beginning (most recent first)
        return [data.appointment, ...prev];
      });

      // Optionally refetch to ensure consistency
      if (doctorId) {
        fetchAppointments();
      }
    });

    socket.on('disconnect', () => {
      console.log('Appointment requests socket disconnected');
      setSocketConnected(false);
    });

    socket.on('connect_error', (error: Error) => {
      console.error('Appointment socket connection error:', error.message);
      setSocketConnected(false);
    });

    socket.on('error', (error: Error) => {
      console.error('Appointment socket error:', error);
    });

    return () => {
      console.log('Cleaning up appointment requests socket');
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId, doctorId]);

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h1 className="text-3xl font-semibold mb-2">Your Appointments</h1>
            <p className="text-muted-foreground">Manage and filter your appointments</p>
          </div>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${socketConnected ? 'bg-green-500' : 'bg-red-500'}`}></div>
            <span className="text-sm text-muted-foreground">
              {socketConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Filter Appointments</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-4">
            <Input
              value={patientName}
              onChange={(e) => setPatientName(e.target.value)}
              placeholder="Patient Name"
            />
            <Input
              value={patientEmail}
              onChange={(e) => setPatientEmail(e.target.value)}
              placeholder="Patient Email"
            />
            <Select value={gender} onValueChange={setGender}>
              <SelectTrigger>
                <SelectValue placeholder="Gender" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Genders</SelectItem>
                <SelectItem value="MALE">Male</SelectItem>
                <SelectItem value="FEMALE">Female</SelectItem>
                <SelectItem value="BINARY">Other</SelectItem>
              </SelectContent>
            </Select>
            <Input
              value={city}
              onChange={(e) => setCity(e.target.value)}
              placeholder="City"
            />
            <Input
              type="number"
              value={age}
              onChange={(e) => setAge(e.target.value)}
              placeholder="Age"
            />
            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />
            <Input
              type="time"
              value={startTime}
              onChange={(e) => setStartTime(e.target.value)}
              placeholder="Start Time"
            />
            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />
            <Input
              type="time"
              value={endTime}
              onChange={(e) => setEndTime(e.target.value)}
              placeholder="End Time"
            />
            <Select value={paymentMethod} onValueChange={setPaymentMethod}>
              <SelectTrigger>
                <SelectValue placeholder="Payment Method" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Payment Methods</SelectItem>
                <SelectItem value="CASH">Cash</SelectItem>
                <SelectItem value="CARD">Card</SelectItem>
                <SelectItem value="UPI">UPI</SelectItem>
              </SelectContent>
            </Select>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="PENDING">Pending</SelectItem>
                <SelectItem value="CONFIRMED">Confirmed</SelectItem>
                <SelectItem value="COMPLETED">Completed</SelectItem>
                <SelectItem value="CANCELLED">Cancelled</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={fetchAppointments} className="w-full">
              Search
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Appointments */}
      {loading && (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
          <Skeleton className="h-32 w-full" />
        </div>
      )}

      {!loading && (
        <div className="flex flex-col gap-4">
          {appointments.length === 0 ? (
            <div className="text-center py-12 text-gray-500">
              <p>No appointments found</p>
            </div>
          ) : (
            appointments.map((a) => (
              <AppointmentCard 
                appointment={a} 
                key={a.id}
                onStatusUpdate={fetchAppointments}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}
