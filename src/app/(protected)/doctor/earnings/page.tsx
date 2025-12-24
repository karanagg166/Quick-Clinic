"use client";

import { useState, useEffect } from "react";
import { useUserStore } from "@/store/userStore";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { showToast } from "@/lib/toast";
import EarningsChart from "@/components/doctor/EarningsChart";
import EmptyState from "@/components/general/EmptyState";
import { Wallet } from "lucide-react";
import EnhancedSkeleton from "@/components/general/EnhancedSkeleton";

export default function DoctorEarnings() {
  const doctorId = useUserStore((s) => s.doctorId);

  const [filters, setFilters] = useState({
    startDate: "",
    endDate: "",
    startTime: "",
    endTime: "",
  });

  const [data, setData] = useState<{ count: number; total: number; earnings?: Array<{ id: string; earned: number; patientName: string; appointmentDateTime: string }> } | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchEarnings = async () => {
    if (!doctorId) return;

    setLoading(true);

    const params = new URLSearchParams();

    if (filters.startDate) params.append("startDate", filters.startDate);
    if (filters.endDate) params.append("endDate", filters.endDate);
    if (filters.startTime) params.append("startTime", filters.startTime);
    if (filters.endTime) params.append("endTime", filters.endTime);

    const res = await fetch(`/api/doctors/${doctorId}/earnings?${params.toString()}`);
    const json = await res.json();

    if (res.ok) setData(json);
    else showToast.error(json.error || "Failed to fetch earnings");

    setLoading(false);
  };

  useEffect(() => {
    fetchEarnings();
  }, [doctorId]);

  return (
    <div className="min-h-screen p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-semibold mb-2">Earnings Dashboard</h1>
        <p className="text-muted-foreground">Track your earnings and revenue</p>
      </div>

      {/* Filters */}
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Filter Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
            {/* Start Date */}
            <div className="space-y-2">
              <Label htmlFor="startDate">Start Date</Label>
              <Input
                id="startDate"
                type="date"
                value={filters.startDate || ""}
                onChange={(e) => setFilters({ ...filters, startDate: e.target.value })}
              />
            </div>

            {/* End Date */}
            <div className="space-y-2">
              <Label htmlFor="endDate">End Date</Label>
              <Input
                id="endDate"
                type="date"
                value={filters.endDate || ""}
                onChange={(e) => setFilters({ ...filters, endDate: e.target.value })}
              />
            </div>

            {/* Start Time */}
            <div className="space-y-2">
              <Label htmlFor="startTime">Start Time</Label>
              <Input
                id="startTime"
                type="time"
                value={filters.startTime || ""}
                onChange={(e) => setFilters({ ...filters, startTime: e.target.value })}
              />
            </div>

            {/* End Time */}
            <div className="space-y-2">
              <Label htmlFor="endTime">End Time</Label>
              <Input
                id="endTime"
                type="time"
                value={filters.endTime || ""}
                onChange={(e) => setFilters({ ...filters, endTime: e.target.value })}
              />
            </div>

            {/* Filter Button */}
            <div className="flex items-end">
              <Button
                onClick={fetchEarnings}
                disabled={loading}
                className="w-full"
              >
                {loading ? "Loading..." : "Filter"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {loading && (
        <div className="space-y-6">
          <EnhancedSkeleton variant="card" />
          <EnhancedSkeleton variant="card" />
        </div>
      )}

      {/* No Results */}
      {!loading && data?.count === 0 && (
        <EmptyState
          icon={Wallet}
          title="No earnings found"
          description="No earnings found for the selected filters. Try adjusting your date range or check back later."
        />
      )}

      {/* Stats and Charts */}
      {!loading && data && data.count > 0 && (
        <div className="space-y-6">
          <Card className="border shadow-sm">
            <CardHeader>
              <CardTitle>Earnings Summary</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="text-center space-y-2">
                <p className="text-lg text-muted-foreground">
                  Total Appointments: <span className="font-semibold text-foreground">{data.count}</span>
                </p>
                <p className="text-3xl font-semibold text-foreground">
                  Total Earnings: ₹{data.total.toLocaleString()}
                </p>
              </div>
            </CardContent>
          </Card>

          {/* Charts */}
          {data.earnings && data.earnings.length > 0 && (
            <EarningsChart data={{ earnings: data.earnings }} />
          )}
        </div>
      )}
    </div>
  );
}
