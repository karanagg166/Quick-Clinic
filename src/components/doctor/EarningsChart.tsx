"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { TrendingUp, BarChart3, LineChart, Calendar, IndianRupee, Activity } from "lucide-react";

interface EarningsItem {
  id: string;
  earned: number;
  patientName: string;
  appointmentDateTime: string;
}

interface EarningsData {
  count?: number;
  total?: number;
  earnings?: EarningsItem[];
}

interface EarningsChartProps {
  data: EarningsData | null;
  loading?: boolean;
}

export default function EarningsChart({ data, loading }: EarningsChartProps) {
  const [activeTab, setActiveTab] = useState<"both" | "bar" | "trend">("both");
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Group and sort earnings by date
  const dailyData = useMemo(() => {
    if (!data?.earnings || data.earnings.length === 0) return [];

    const grouped = data.earnings.reduce((acc, item) => {
      const dateObj = new Date(item.appointmentDateTime);
      const dateKey = isNaN(dateObj.getTime())
        ? "Recent"
        : dateObj.toLocaleDateString("en-US", { month: "short", day: "numeric" });

      if (!acc[dateKey]) {
        acc[dateKey] = {
          date: dateKey,
          rawDate: isNaN(dateObj.getTime()) ? 0 : dateObj.getTime(),
          earnings: 0,
          count: 0,
        };
      }
      acc[dateKey].earnings += item.earned;
      acc[dateKey].count += 1;
      return acc;
    }, {} as Record<string, { date: string; rawDate: number; earnings: number; count: number }>);

    return Object.values(grouped).sort((a, b) => a.rawDate - b.rawDate);
  }, [data]);

  const { maxEarning, totalEarnings, avgEarning, peakDay } = useMemo(() => {
    if (dailyData.length === 0) {
      return { maxEarning: 0, totalEarnings: 0, avgEarning: 0, peakDay: null };
    }
    const max = Math.max(...dailyData.map((d) => d.earnings));
    const total = dailyData.reduce((sum, d) => sum + d.earnings, 0);
    const avg = Math.round(total / dailyData.length);
    const peak = dailyData.reduce((prev, curr) => (curr.earnings > prev.earnings ? curr : prev), dailyData[0]);

    return { maxEarning: max, totalEarnings: total, avgEarning: avg, peakDay: peak };
  }, [dailyData]);

  if (loading) {
    return (
      <Card className="border shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Activity className="w-5 h-5 text-emerald-600 animate-spin" />
            Loading Earnings Analytics...
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-64 flex items-center justify-center">
            <div className="space-y-2 text-center">
              <div className="w-10 h-10 border-4 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto" />
              <p className="text-sm text-muted-foreground">Calculating revenue trends...</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data || dailyData.length === 0) {
    return (
      <Card className="border shadow-sm bg-slate-50/50">
        <CardContent className="p-8 text-center space-y-3">
          <BarChart3 className="w-12 h-12 text-gray-300 mx-auto" />
          <h3 className="font-semibold text-gray-700">No Earnings Data Available</h3>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Complete appointments with online payments will automatically generate interactive revenue trends and daily breakdown charts here.
          </p>
        </CardContent>
      </Card>
    );
  }

  // Chart dimensions & calculations
  const chartHeight = 220;
  const paddingLeft = 48;
  const paddingRight = 24;
  const paddingTop = 20;
  const paddingBottom = 36;
  const effectiveMax = maxEarning > 0 ? maxEarning * 1.15 : 1000;

  // Grid steps
  const gridSteps = 4;
  const yTicks = Array.from({ length: gridSteps + 1 }, (_, i) => {
    const val = Math.round((effectiveMax / gridSteps) * (gridSteps - i));
    const y = paddingTop + (i / gridSteps) * (chartHeight - paddingTop - paddingBottom);
    return { val, y };
  });

  // Calculate points for trend curve
  const points = dailyData.map((d, index) => {
    const step = dailyData.length > 1 ? (800 - paddingLeft - paddingRight) / (dailyData.length - 1) : 400;
    const x = dailyData.length === 1 ? 400 : paddingLeft + index * step;
    const y = chartHeight - paddingBottom - (d.earnings / effectiveMax) * (chartHeight - paddingTop - paddingBottom);
    return { x, y, ...d };
  });

  // Build SVG path
  const linePath = points.reduce((acc, pt, i, arr) => {
    if (i === 0) return `M ${pt.x} ${pt.y}`;
    const prev = arr[i - 1];
    const cx = (prev.x + pt.x) / 2;
    return `${acc} C ${cx} ${prev.y}, ${cx} ${pt.y}, ${pt.x} ${pt.y}`;
  }, "");

  const areaPath = points.length > 0
    ? `${linePath} L ${points[points.length - 1].x} ${chartHeight - paddingBottom} L ${points[0].x} ${chartHeight - paddingBottom} Z`
    : "";

  return (
    <div className="space-y-6">
      {/* Metric Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card className="p-4 border shadow-sm hover:shadow transition bg-gradient-to-br from-emerald-50/60 to-white">
          <div className="flex items-center gap-2 text-emerald-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <IndianRupee className="w-4 h-4" /> Total Earned
          </div>
          <p className="text-2xl font-bold text-gray-900">₹{totalEarnings.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">{dailyData.length} active day(s)</p>
        </Card>

        <Card className="p-4 border shadow-sm hover:shadow transition bg-gradient-to-br from-blue-50/60 to-white">
          <div className="flex items-center gap-2 text-blue-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <TrendingUp className="w-4 h-4" /> Daily Average
          </div>
          <p className="text-2xl font-bold text-gray-900">₹{avgEarning.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground mt-1">Per active day</p>
        </Card>

        <Card className="p-4 border shadow-sm hover:shadow transition bg-gradient-to-br from-purple-50/60 to-white">
          <div className="flex items-center gap-2 text-purple-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <BarChart3 className="w-4 h-4" /> Peak Revenue
          </div>
          <p className="text-2xl font-bold text-gray-900">₹{peakDay ? peakDay.earnings.toLocaleString() : 0}</p>
          <p className="text-xs text-muted-foreground mt-1">{peakDay?.date || "N/A"}</p>
        </Card>

        <Card className="p-4 border shadow-sm hover:shadow transition bg-gradient-to-br from-amber-50/60 to-white">
          <div className="flex items-center gap-2 text-amber-600 text-xs font-semibold uppercase tracking-wider mb-1">
            <Calendar className="w-4 h-4" /> Consultations
          </div>
          <p className="text-2xl font-bold text-gray-900">
            {dailyData.reduce((sum, d) => sum + d.count, 0)}
          </p>
          <p className="text-xs text-muted-foreground mt-1">Paid visits</p>
        </Card>
      </div>

      {/* Chart View Selection */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h3 className="text-lg font-bold text-gray-900">Revenue Analytics</h3>
          <p className="text-sm text-muted-foreground">Interactive day-by-day revenue and performance trends</p>
        </div>
        <div className="flex items-center gap-1 bg-slate-100 p-1 rounded-lg border">
          <Button
            size="sm"
            variant={activeTab === "both" ? "default" : "ghost"}
            onClick={() => setActiveTab("both")}
            className="text-xs h-7 px-3"
          >
            All Charts
          </Button>
          <Button
            size="sm"
            variant={activeTab === "bar" ? "default" : "ghost"}
            onClick={() => setActiveTab("bar")}
            className="text-xs h-7 px-3 flex items-center gap-1"
          >
            <BarChart3 className="w-3.5 h-3.5" /> Daily Bars
          </Button>
          <Button
            size="sm"
            variant={activeTab === "trend" ? "default" : "ghost"}
            onClick={() => setActiveTab("trend")}
            className="text-xs h-7 px-3 flex items-center gap-1"
          >
            <LineChart className="w-3.5 h-3.5" /> Trend Line
          </Button>
        </div>
      </div>

      {/* Charts Grid */}
      <div className={`grid gap-6 ${activeTab === "both" ? "grid-cols-1 lg:grid-cols-2" : "grid-cols-1"}`}>
        {/* Daily Bar Chart */}
        {(activeTab === "both" || activeTab === "bar") && (
          <Card className="border shadow-sm overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-emerald-600" />
                Daily Earnings Breakdown
              </CardTitle>
              <CardDescription>Hover over any bar to inspect date and revenue</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="relative w-full overflow-x-auto">
                <svg viewBox="0 0 800 240" className="w-full h-56 select-none">
                  {/* Grid Lines & Y-Labels */}
                  {yTicks.map((tick, idx) => (
                    <g key={idx}>
                      <line
                        x1={paddingLeft}
                        y1={tick.y}
                        x2={800 - paddingRight}
                        y2={tick.y}
                        stroke="#e2e8f0"
                        strokeDasharray="4 4"
                      />
                      <text
                        x={paddingLeft - 8}
                        y={tick.y + 4}
                        textAnchor="end"
                        fontSize="11"
                        fill="#64748b"
                        fontFamily="sans-serif"
                      >
                        ₹{tick.val >= 1000 ? `${(tick.val / 1000).toFixed(1)}k` : tick.val}
                      </text>
                    </g>
                  ))}

                  {/* Bars */}
                  {points.map((pt, i) => {
                    const barWidth = Math.max(16, Math.min(48, (800 - paddingLeft - paddingRight) / (points.length * 1.8)));
                    const barHeight = Math.max(4, (pt.earnings / effectiveMax) * (chartHeight - paddingTop - paddingBottom));
                    const barX = pt.x - barWidth / 2;
                    const barY = chartHeight - paddingBottom - barHeight;
                    const isHovered = hoveredIndex === i;

                    return (
                      <g
                        key={i}
                        className="cursor-pointer transition-all"
                        onMouseEnter={() => setHoveredIndex(i)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      >
                        <defs>
                          <linearGradient id={`barGrad-${i}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={isHovered ? "#059669" : "#10b981"} />
                            <stop offset="100%" stopColor={isHovered ? "#047857" : "#059669"} />
                          </linearGradient>
                        </defs>
                        <rect
                          x={barX}
                          y={barY}
                          width={barWidth}
                          height={barHeight}
                          rx={5}
                          fill={`url(#barGrad-${i})`}
                          className="transition-all duration-200"
                          opacity={hoveredIndex === null || isHovered ? 1 : 0.65}
                        />
                        {/* X-Axis Label */}
                        <text
                          x={pt.x}
                          y={chartHeight - 12}
                          textAnchor="middle"
                          fontSize="11"
                          fill={isHovered ? "#0f172a" : "#64748b"}
                          fontWeight={isHovered ? "600" : "400"}
                        >
                          {pt.date}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Floating Tooltip */}
                {hoveredIndex !== null && points[hoveredIndex] && (
                  <div className="absolute top-2 right-4 bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg pointer-events-none animate-in fade-in zoom-in-95">
                    <p className="font-semibold text-emerald-400">{points[hoveredIndex].date}</p>
                    <p className="font-bold text-sm">₹{points[hoveredIndex].earnings.toLocaleString()}</p>
                    <p className="text-slate-300 text-[11px]">{points[hoveredIndex].count} appointment(s)</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Earnings Trend Area Chart */}
        {(activeTab === "both" || activeTab === "trend") && (
          <Card className="border shadow-sm overflow-hidden">
            <CardHeader className="pb-2">
              <CardTitle className="text-base font-semibold flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-blue-600" />
                Revenue Trend Curve
              </CardTitle>
              <CardDescription>Cumulative trend trajectory across the selected period</CardDescription>
            </CardHeader>
            <CardContent className="pt-2">
              <div className="relative w-full overflow-x-auto">
                <svg viewBox="0 0 800 240" className="w-full h-56 select-none">
                  <defs>
                    <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.35" />
                      <stop offset="100%" stopColor="#3b82f6" stopOpacity="0.0" />
                    </linearGradient>
                  </defs>

                  {/* Grid Lines & Y-Labels */}
                  {yTicks.map((tick, idx) => (
                    <g key={idx}>
                      <line
                        x1={paddingLeft}
                        y1={tick.y}
                        x2={800 - paddingRight}
                        y2={tick.y}
                        stroke="#e2e8f0"
                        strokeDasharray="4 4"
                      />
                      <text
                        x={paddingLeft - 8}
                        y={tick.y + 4}
                        textAnchor="end"
                        fontSize="11"
                        fill="#64748b"
                        fontFamily="sans-serif"
                      >
                        ₹{tick.val >= 1000 ? `${(tick.val / 1000).toFixed(1)}k` : tick.val}
                      </text>
                    </g>
                  ))}

                  {/* Area fill */}
                  {areaPath && <path d={areaPath} fill="url(#areaGradient)" />}

                  {/* Line */}
                  {linePath && (
                    <path
                      d={linePath}
                      fill="none"
                      stroke="#2563eb"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Data Points */}
                  {points.map((pt, i) => {
                    const isHovered = hoveredIndex === i;
                    return (
                      <g
                        key={i}
                        className="cursor-pointer"
                        onMouseEnter={() => setHoveredIndex(i)}
                        onMouseLeave={() => setHoveredIndex(null)}
                      >
                        {isHovered && (
                          <circle cx={pt.x} cy={pt.y} r="8" fill="#3b82f6" opacity="0.25" />
                        )}
                        <circle
                          cx={pt.x}
                          cy={pt.y}
                          r={isHovered ? "5" : "3.5"}
                          fill="#ffffff"
                          stroke="#1d4ed8"
                          strokeWidth="2.5"
                          className="transition-all"
                        />
                        {/* X-Axis Label */}
                        <text
                          x={pt.x}
                          y={chartHeight - 12}
                          textAnchor="middle"
                          fontSize="11"
                          fill={isHovered ? "#0f172a" : "#64748b"}
                          fontWeight={isHovered ? "600" : "400"}
                        >
                          {pt.date}
                        </text>
                      </g>
                    );
                  })}
                </svg>

                {/* Floating Tooltip */}
                {hoveredIndex !== null && points[hoveredIndex] && (
                  <div className="absolute top-2 right-4 bg-slate-900 text-white text-xs px-3 py-2 rounded-lg shadow-lg pointer-events-none animate-in fade-in zoom-in-95">
                    <p className="font-semibold text-blue-400">{points[hoveredIndex].date}</p>
                    <p className="font-bold text-sm">₹{points[hoveredIndex].earnings.toLocaleString()}</p>
                    <p className="text-slate-300 text-[11px]">{points[hoveredIndex].count} appointment(s)</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
