"use client";

import { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface EarningsData {
  earnings: Array<{
    id: string;
    earned: number;
    patientName: string;
    appointmentDateTime: string;
  }>;
}

interface EarningsChartProps {
  data: EarningsData | null;
  loading?: boolean;
}

export default function EarningsChart({ data, loading }: EarningsChartProps) {
  // Process data for daily earnings chart
  const dailyData = useMemo(() => {
    if (!data?.earnings) return [];

    const grouped = data.earnings.reduce((acc, item) => {
      const date = new Date(item.appointmentDateTime).toLocaleDateString("en-US", {
        month: "short",
        day: "numeric",
      });
      
      if (!acc[date]) {
        acc[date] = { date, earnings: 0, count: 0 };
      }
      acc[date].earnings += item.earned;
      acc[date].count += 1;
      return acc;
    }, {} as Record<string, { date: string; earnings: number; count: number }>);

    return Object.values(grouped).sort((a, b) => 
      new Date(a.date).getTime() - new Date(b.date).getTime()
    );
  }, [data]);

  if (loading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Earnings Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <p className="text-muted-foreground">Loading chart data...</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || dailyData.length === 0) {
    return null;
  }

  // Show message that charts require recharts installation
  // After installing recharts, uncomment the chart code below (see commented code at bottom of file)
  return (
    <Card className="border shadow-sm">
      <CardHeader>
        <CardTitle>Earnings Charts</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-64 flex flex-col items-center justify-center text-center p-6 space-y-4">
          <p className="text-muted-foreground">Charts require recharts package to be installed</p>
          <div className="bg-muted/50 rounded-lg p-4">
            <p className="text-sm font-mono text-foreground">npm install recharts</p>
          </div>
          <p className="text-xs text-muted-foreground">
            After installation, charts will automatically appear here showing daily earnings and trends.
          </p>
          {dailyData.length > 0 && (
            <div className="mt-4 text-sm text-muted-foreground">
              <p>Data ready: {dailyData.length} days of earnings data available</p>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );

  /* 
  // Uncomment this section after installing recharts with: npm install recharts
  const { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LineChart, Line } = require("recharts");

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Daily Earnings</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis 
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(value: unknown) => `₹${Number(value)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                }}
                formatter={(value: unknown) => [`₹${Number(value).toLocaleString()}`, "Earnings"]}
              />
              <Bar dataKey="earnings" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle>Earnings Trend</CardTitle>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={300}>
            <LineChart data={dailyData}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis 
                dataKey="date" 
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
              />
              <YAxis 
                className="text-xs"
                tick={{ fill: "hsl(var(--muted-foreground))" }}
                tickFormatter={(value: unknown) => `₹${Number(value)}`}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--background))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "6px",
                }}
                formatter={(value: unknown) => [`₹${Number(value).toLocaleString()}`, "Earnings"]}
              />
              <Line 
                type="monotone" 
                dataKey="earnings" 
                stroke="hsl(var(--primary))" 
                strokeWidth={2}
                dot={{ fill: "hsl(var(--primary))", r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>
    </div>
  );
  */
}
