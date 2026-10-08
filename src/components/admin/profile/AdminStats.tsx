import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Users, Calendar } from "lucide-react";

interface AdminStatsProps {
    totalUsers?: number | null;
    totalAppointments?: number | null;
    loading?: boolean;
}

export function AdminStats({ totalUsers, totalAppointments, loading = false }: AdminStatsProps) {
    return (
        <div className="grid gap-4 md:grid-cols-3">
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Total Users</CardTitle>
                    <Users className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {loading ? "--" : totalUsers !== null && totalUsers !== undefined ? totalUsers.toLocaleString() : "Unavailable"}
                    </div>
                    <p className="text-xs text-muted-foreground">Active platform users</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">Appointments</CardTitle>
                    <Calendar className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold">
                        {loading ? "--" : totalAppointments !== null && totalAppointments !== undefined ? totalAppointments.toLocaleString() : "Unavailable"}
                    </div>
                    <p className="text-xs text-muted-foreground">Total scheduled bookings</p>
                </CardContent>
            </Card>
            <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                    <CardTitle className="text-sm font-medium">System Status</CardTitle>
                    <BarChart3 className="h-4 w-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                    <div className="text-2xl font-bold text-emerald-600">Operational</div>
                    <p className="text-xs text-muted-foreground">Core services active</p>
                </CardContent>
            </Card>
        </div>
    );
}
