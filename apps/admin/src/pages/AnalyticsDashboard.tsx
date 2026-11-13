import React, { useState, useEffect } from 'react';
import {
  BarChart,
  Bar,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  TrendingUp,
  Users,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Building,
  Calendar,
  Sparkles,
} from 'lucide-react';
import { adminApi } from '../lib/api';

const COLORS = ['#F58220', '#1976B9', '#10B981', '#F59E0B', '#8B5CF6', '#EC4899', '#6366F1'];

export function AnalyticsDashboard() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchAnalytics();
  }, []);

  const fetchAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await adminApi.analytics.getOverview();
      setData(res);
    } catch (err) {
      console.error('Failed to load analytics:', err);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading || !data) {
    return (
      <div className="p-20 text-center">
        <div className="w-10 h-10 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
        <div className="text-xs font-bold text-gray-500">
          Aggregating Campus Utilization Metrics from PostgreSQL...
        </div>
      </div>
    );
  }

  const { summary, categoryDistribution, hourlyOccupancy, weeklyTrends, departmentBreakdown, topResources } =
    data;

  return (
    <div className="space-y-6">
      {/* Title & Timeframe */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
            Campus Analytics & Utilization Dashboard
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">
            Real-time space occupancy, reservation compliance, no-show rates, and equipment trends.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-500 bg-white px-3 py-1.5 rounded-xl border border-gray-200 shadow-sm">
            Current Semester 2026
          </span>
          <button
            onClick={fetchAnalytics}
            className="px-3 py-1.5 bg-[#F58220] text-white text-xs font-bold rounded-xl shadow-sm hover:bg-[#E06D0C] transition"
          >
            Refresh Data
          </button>
        </div>
      </div>

      {/* 4 Summary Stat Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Bookings */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400">Total Reservations</span>
            <div className="w-8 h-8 rounded-lg bg-orange-50 text-[#F58220] flex items-center justify-center">
              <Calendar className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-[#292929] mt-2">{summary.totalBookings}</div>
          <div className="text-[11px] text-emerald-600 font-bold mt-1 flex items-center gap-1">
            <TrendingUp className="w-3 h-3" />
            <span>+18% from last week</span>
          </div>
        </div>

        {/* Space Utilization Rate */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400">Campus Space Utilization</span>
            <div className="w-8 h-8 rounded-lg bg-blue-50 text-[#1976B9] flex items-center justify-center">
              <Building className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-[#292929] mt-2">
            {summary.overallUtilization}%
          </div>
          <div className="text-[11px] text-gray-400 mt-1">Across 16 monitored facilities</div>
        </div>

        {/* Check-in Compliance */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400">Check-in Compliance</span>
            <div className="w-8 h-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center">
              <CheckCircle2 className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-[#292929] mt-2">{summary.checkInRate}%</div>
          <div className="text-[11px] text-gray-400 mt-1">
            Verified via QR / 6-digit PIN code
          </div>
        </div>

        {/* No-Show / Release Rate */}
        <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-400">No-Show & Auto-Release</span>
            <div className="w-8 h-8 rounded-lg bg-red-50 text-red-600 flex items-center justify-center">
              <AlertTriangle className="w-4 h-4" />
            </div>
          </div>
          <div className="text-2xl font-black text-[#292929] mt-2">{summary.noShowRate}%</div>
          <div className="text-[11px] text-gray-400 mt-1">Released after 15 min deadline</div>
        </div>
      </div>

      {/* Row 1: Hourly Peak Demand Heatmap & Category Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Hourly Peak Occupancy (Recharts AreaChart) (7 cols) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-[#292929]">
                Hourly Demand & Occupancy Curve
              </h2>
              <p className="text-[11px] text-gray-400">
                Facility utilization levels from 08:00 AM to 08:00 PM
              </p>
            </div>
            <div className="flex items-center gap-3 text-xs font-bold">
              <span className="flex items-center gap-1.5 text-[#F58220]">
                <span className="w-3 h-3 rounded-full bg-[#F58220]" />
                <span>Weekday (%)</span>
              </span>
              <span className="flex items-center gap-1.5 text-[#1976B9]">
                <span className="w-3 h-3 rounded-full bg-[#1976B9]" />
                <span>Weekend (%)</span>
              </span>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={hourlyOccupancy}>
                <defs>
                  <linearGradient id="colorWeekday" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F58220" stopOpacity={0.4} />
                    <stop offset="95%" stopColor="#F58220" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorWeekend" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#1976B9" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#1976B9" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F1F1" />
                <XAxis dataKey="hour" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis unit="%" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <Tooltip />
                <Area
                  type="monotone"
                  dataKey="weekday"
                  stroke="#F58220"
                  strokeWidth={2.5}
                  fillOpacity={1}
                  fill="url(#colorWeekday)"
                  name="Weekday Occupancy"
                />
                <Area
                  type="monotone"
                  dataKey="weekend"
                  stroke="#1976B9"
                  strokeWidth={2}
                  fillOpacity={1}
                  fill="url(#colorWeekend)"
                  name="Weekend Occupancy"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Facility Breakdown (Recharts BarChart) (5 cols) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-extrabold text-[#292929]">
              Facility Allocation by Category
            </h2>
            <p className="text-[11px] text-gray-400">Total reservations logged per category</p>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={categoryDistribution}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F1F1" />
                <XAxis dataKey="category" tick={{ fontSize: 10, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                <Tooltip />
                <Bar dataKey="count" fill="#F58220" radius={[6, 6, 0, 0]} name="Total Bookings">
                  {categoryDistribution.map((entry: any, index: number) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 2: Weekly Trends & Department Distribution */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Weekly Bookings vs Check-ins vs No-Shows (7 cols) */}
        <div className="lg:col-span-7 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-extrabold text-[#292929]">
                Weekly Reservation & No-Show Trends
              </h2>
              <p className="text-[11px] text-gray-400">
                Comparing total reservations vs verified check-ins and released slots
              </p>
            </div>
          </div>

          <div className="h-64 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={weeklyTrends}>
                <CartesianGrid strokeDasharray="3 3" stroke="#F1F1F1" />
                <XAxis dataKey="day" tick={{ fontSize: 11, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 11, fill: '#6B7280' }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="bookings" fill="#1976B9" name="Total Reservations" radius={[4, 4, 0, 0]} />
                <Bar dataKey="checkIns" fill="#10B981" name="Verified Check-Ins" radius={[4, 4, 0, 0]} />
                <Bar dataKey="noShows" fill="#EF4444" name="Released (No-Show)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Department Distribution (5 cols) */}
        <div className="lg:col-span-5 bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
          <div>
            <h2 className="text-sm font-extrabold text-[#292929]">
              Department Space Allocation
            </h2>
            <p className="text-[11px] text-gray-400">Share of campus bookings by school/unit</p>
          </div>

          <div className="h-64 w-full flex items-center justify-center">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={departmentBreakdown}
                  dataKey="bookings"
                  nameKey="department"
                  cx="50%"
                  cy="50%"
                  outerRadius={75}
                  innerRadius={45}
                  paddingAngle={4}
                  label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                >
                  {departmentBreakdown.map((entry: any, index: number) => (
                    <Cell key={`dept-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* Row 3: Top Performing Facilities Table */}
      <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-sm font-extrabold text-[#292929]">
              Most Utilized Campus Resources
            </h2>
            <p className="text-[11px] text-gray-400">High-demand facilities ranked by booked hours</p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b border-gray-100 text-gray-400 font-bold uppercase text-[10px]">
                <th className="pb-3">Facility Name</th>
                <th className="pb-3">Category</th>
                <th className="pb-3">Completed Sessions</th>
                <th className="pb-3">Utilization Rate</th>
                <th className="pb-3">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {topResources.map((item: any, idx: number) => (
                <tr key={item.name} className="hover:bg-gray-50 transition">
                  <td className="py-3 font-bold text-gray-900 flex items-center gap-2">
                    <span className="w-5 h-5 rounded-full bg-[#FFF4EA] text-[#F58220] flex items-center justify-center text-[10px] font-black">
                      {idx + 1}
                    </span>
                    <span>{item.name}</span>
                  </td>
                  <td className="py-3 text-gray-500">{item.category}</td>
                  <td className="py-3 font-bold text-gray-800">{item.bookingsCount} bookings</td>
                  <td className="py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-24 bg-gray-100 h-2 rounded-full overflow-hidden">
                        <div
                          className="bg-[#F58220] h-full rounded-full"
                          style={{ width: `${item.utilization}%` }}
                        />
                      </div>
                      <span className="font-bold text-gray-700">{item.utilization}%</span>
                    </div>
                  </td>
                  <td className="py-3">
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200">
                      Optimal
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

