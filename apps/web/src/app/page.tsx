'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  Clock,
  Building,
  Users,
  Plus,
  Sparkles,
  ArrowRight,
  ChevronRight,
  CheckCircle2,
  AlertCircle,
  QrCode,
  MapPin,
  RefreshCw,
  SlidersHorizontal,
  BookOpen,
  PieChart,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { BookingModal } from '@/components/booking/BookingModal';
import { CheckInModal } from '@/components/booking/CheckInModal';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  ResourceDTO,
  BookingDTO,
  DashboardStats,
  ResourceRecommendationItem,
  QuotaResponse,
} from '@lpu/shared';
import {
  getCurrentKolkataDateString,
  formatKolkataDate,
  formatKolkataTimeRange,
  formatKolkataTime,
  addDaysKolkata,
  getDayOfWeekInKolkata,
  kolkataToUtc,
} from '@/lib/timezone';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  // Dashboard Data State (initialized to null to prevent stale/mock data display)
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [quotaData, setQuotaData] = useState<QuotaResponse | null>(null);
  const [upcomingBookings, setUpcomingBookings] = useState<BookingDTO[]>([]);
  const [recommendedResources, setRecommendedResources] = useState<ResourceDTO[]>([]);
  const [timetableClasses, setTimetableClasses] = useState<any[]>([]);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedResourceForBooking, setSelectedResourceForBooking] = useState<ResourceDTO | null>(null);
  const [bookingPreselectDate, setBookingPreselectDate] = useState<string | undefined>(undefined);
  const [bookingPreselectStartTime, setBookingPreselectStartTime] = useState<string | undefined>(undefined);
  const [bookingPreselectEndTime, setBookingPreselectEndTime] = useState<string | undefined>(undefined);

  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [selectedBookingForCheckIn, setSelectedBookingForCheckIn] = useState<BookingDTO | null>(null);

  // Smart Allocation Assistant State
  const [allocAttendance, setAllocAttendance] = useState('30');
  const [allocActivity, setAllocActivity] = useState('PROJECT_WORK');
  const [allocDate, setAllocDate] = useState(() => getCurrentKolkataDateString());
  const [allocTimeSlot, setAllocTimeSlot] = useState('14:00 - 16:00');
  const [allocBuilding, setAllocBuilding] = useState('ALL');
  const [isSearchingAlloc, setIsSearchingAlloc] = useState(false);
  const [allocRecommendations, setAllocRecommendations] = useState<ResourceRecommendationItem[]>([]);
  const [allocSearchDone, setAllocSearchDone] = useState(false);

  // Weekly Schedule Day Selector (0=Sun, 1=Mon, ..., 6=Sat)
  const [selectedScheduleDay, setSelectedScheduleDay] = useState<number>(() => {
    return getDayOfWeekInKolkata(new Date());
  });

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  const loadDashboardData = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [res, quotaRes] = await Promise.all([
        api.dashboard.getStats(),
        api.me.quota().catch(() => null),
      ]);
      if (res.stats) setStats(res.stats);
      if (res.upcomingBookings) setUpcomingBookings(res.upcomingBookings);
      if (res.recommendedResources) setRecommendedResources(res.recommendedResources);
      if (res.timetableClasses) setTimetableClasses(res.timetableClasses);
      if (res.recentActivity) setRecentActivity(res.recentActivity);
      if (quotaRes) setQuotaData(quotaRes);
    } catch (err: any) {
      console.error('Error loading dashboard data:', err);
      setErrorMessage(err.message || 'Unable to load dashboard records.');
    } finally {
      setIsLoading(false);
    }
  }, [user]);

  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  const handleOpenBooking = (
    resource?: ResourceDTO,
    date?: string,
    startTime?: string,
    endTime?: string
  ) => {
    setSelectedResourceForBooking(resource || null);
    setBookingPreselectDate(date);
    setBookingPreselectStartTime(startTime);
    setBookingPreselectEndTime(endTime);
    setIsBookingModalOpen(true);
  };

  const handleOpenCheckIn = (booking: BookingDTO) => {
    setSelectedBookingForCheckIn(booking);
    setIsCheckInModalOpen(true);
  };

  const handleSmartAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearchingAlloc(true);
    setAllocSearchDone(false);

    try {
      const res = await api.resources.smartAllocation({
        expectedAttendance: Number(allocAttendance) || 30,
        activityType: allocActivity,
        date: allocDate,
        timeSlot: allocTimeSlot,
        preferredBuilding: allocBuilding !== 'ALL' ? allocBuilding : undefined,
      });

      if (res.recommendations) {
        setAllocRecommendations(res.recommendations);
      } else if (res.matches) {
        setAllocRecommendations(
          res.matches.map((m: any, idx: number) => ({
            resource: m,
            rankingScore: 100 - idx * 10,
            reason: `Matches group size and activity requirements`,
            capacityFitRatio: 1.0,
            matchedAmenities: [],
            buildingMatch: true,
            isAvailable: true,
          }))
        );
      }
      setAllocSearchDone(true);
    } catch (err) {
      console.error('Smart allocation error:', err);
      setAllocRecommendations([]);
      setAllocSearchDone(true);
    } finally {
      setIsSearchingAlloc(false);
    }
  };

  // Compute dynamic 7 days of the current week in Asia/Kolkata
  const todayStr = getCurrentKolkataDateString();
  const todayDateObj = kolkataToUtc(todayStr, '12:00');
  const todayDayOfWeek = getDayOfWeekInKolkata(todayDateObj);
  const diffToMonday = (todayDayOfWeek === 0 ? -6 : 1) - todayDayOfWeek;

  const currentMondayStr = addDaysKolkata(todayStr, diffToMonday);

  const daysList = [
    { name: 'Mon', dayOfWeek: 1, dateStr: currentMondayStr },
    { name: 'Tue', dayOfWeek: 2, dateStr: addDaysKolkata(currentMondayStr, 1) },
    { name: 'Wed', dayOfWeek: 3, dateStr: addDaysKolkata(currentMondayStr, 2) },
    { name: 'Thu', dayOfWeek: 4, dateStr: addDaysKolkata(currentMondayStr, 3) },
    { name: 'Fri', dayOfWeek: 5, dateStr: addDaysKolkata(currentMondayStr, 4) },
    { name: 'Sat', dayOfWeek: 6, dateStr: addDaysKolkata(currentMondayStr, 5) },
    { name: 'Sun', dayOfWeek: 0, dateStr: addDaysKolkata(currentMondayStr, 6) },
  ].map((d) => ({
    ...d,
    dateDisplay: d.dateStr.split('-')[2],
  }));

  // Filter timetable classes for the selected day of the week
  const filteredScheduleClasses = timetableClasses.filter(
    (c) => c.dayOfWeek === selectedScheduleDay
  );

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col lg:flex-row">
      <Sidebar
        pendingApprovalsCount={stats?.pendingRequestsCount || 0}
        unreadNotificationsCount={3}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Header Row: Greeting & "+ Book a Resource" Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-extrabold text-[#292929] tracking-tight flex items-center gap-2">
                <span>Welcome, {user.name.split(' ')[0]}</span>
                <span className="text-2xl">🎓</span>
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                LPU Campus Resource Booking & Scheduling Platform • Connected to live database
              </p>
            </div>

            <button
              type="button"
              onClick={() => handleOpenBooking()}
              className="px-5 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Book a Resource</span>
            </button>
          </div>

          {/* Error Banner with Retry */}
          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-2xl flex items-center justify-between gap-3 text-xs text-red-800">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                type="button"
                onClick={loadDashboardData}
                className="px-3 py-1 bg-red-600 text-white font-bold rounded-lg shadow-sm hover:bg-red-700"
              >
                Retry
              </button>
            </div>
          )}

          {/* Stat Cards Grid (100% Real API Data) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Upcoming Bookings */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {isLoading ? '...' : stats ? stats.upcomingBookingsCount : 0}
                </div>
                <div className="text-xs font-bold text-gray-700">Upcoming Bookings</div>
                <div className="text-[11px] text-gray-400">
                  {upcomingBookings.length > 0
                    ? `Next: ${formatKolkataDate(upcomingBookings[0].startTime)}`
                    : 'No upcoming reservations'}
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-[#F58220]">
                <CalendarIcon className="w-6 h-6" />
              </div>
            </div>

            {/* 2. Pending Requests */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {isLoading ? '...' : stats ? stats.pendingRequestsCount : 0}
                </div>
                <div className="text-xs font-bold text-gray-700">Pending Approvals</div>
                <div className="text-[11px] text-gray-400">Department review queue</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#FFF4EA] border border-[#FED7AA] flex items-center justify-center text-[#F58220]">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            {/* 3. Weekly Quota (A7 Policy Engine) */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {isLoading
                    ? '...'
                    : quotaData
                    ? `${quotaData.remainingWeeklyQuota}h`
                    : stats
                    ? `${stats.remainingWeeklyQuota}h`
                    : '20h'}
                </div>
                <div className="text-xs font-bold text-gray-700">Weekly Quota Remaining</div>
                <div className="text-[11px] text-gray-400">
                  {quotaData
                    ? `${quotaData.currentWeeklyHours}h of ${quotaData.maxWeeklyHours}h used`
                    : stats
                    ? `Max: ${stats.maxWeeklyHours}h / week`
                    : '20h / week'}
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1976B9]">
                <PieChart className="w-6 h-6" />
              </div>
            </div>

            {/* 4. Available Resources */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {isLoading ? '...' : stats ? stats.availableResourcesCount : 0}
                </div>
                <div className="text-xs font-bold text-gray-700">Available Facilities</div>
                <div className="text-[11px] text-gray-400">Classrooms, Labs & Halls</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-700">
                <Building className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Weekly Quota Meter Card (Authoritative A7 Policy Engine) */}
          {quotaData && (
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-blue-50 border border-blue-100 flex items-center justify-center text-[#1976B9]">
                    <PieChart className="w-4 h-4" />
                  </div>
                  <div>
                    <h2 className="text-sm font-extrabold text-[#292929] flex items-center gap-2">
                      <span>Weekly Allocation Quota Meter</span>
                      <span className="text-[11px] font-normal text-gray-400">
                        ({formatKolkataDate(quotaData.periodStart)} – {formatKolkataDate(quotaData.periodEnd)})
                      </span>
                    </h2>
                    <p className="text-[11px] text-gray-500">
                      Policy:{' '}
                      <span className="font-semibold text-gray-700">
                        {quotaData.policyName}
                      </span>
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <span className="text-xs font-bold text-gray-800">
                      {quotaData.currentWeeklyHours}h of {quotaData.maxWeeklyHours}h used
                    </span>
                    <span className="text-[11px] text-emerald-600 font-bold ml-1.5">
                      ({quotaData.remainingWeeklyQuota}h remaining)
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={loadDashboardData}
                    className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
                    title="Refresh Quota"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Visual Progress Bar */}
              {(() => {
                const usedPercent = Math.min(
                  100,
                  Math.round((quotaData.currentWeeklyHours / quotaData.maxWeeklyHours) * 100)
                );
                const barColor =
                  usedPercent >= 100
                    ? 'bg-red-500'
                    : usedPercent >= 75
                    ? 'bg-amber-500'
                    : 'bg-[#F58220]';

                return (
                  <div className="space-y-1.5">
                    <div className="w-full h-3 bg-gray-100 rounded-full overflow-hidden p-0.5">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                        style={{ width: `${usedPercent}%` }}
                      />
                    </div>
                    <div className="flex justify-between items-center text-[10px] text-gray-400">
                      <span>0h used (100% free)</span>
                      <span>{usedPercent}% quota utilized</span>
                      <span>Cap: {quotaData.maxWeeklyHours}h / week</span>
                    </div>
                  </div>
                );
              })()}

              {/* Warning or Critical Alert Banner */}
              {quotaData.remainingWeeklyQuota <= 0 ? (
                <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl flex items-center gap-2 text-xs text-red-700 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-600" />
                  <span>
                    <strong>Quota Exhausted:</strong> You have reached your maximum booking quota ({quotaData.maxWeeklyHours}h) for this week.
                  </span>
                </div>
              ) : quotaData.remainingWeeklyQuota < 4 ? (
                <div className="p-2.5 bg-amber-50 border border-amber-200 rounded-xl flex items-center gap-2 text-xs text-amber-800 font-medium">
                  <AlertCircle className="w-4 h-4 shrink-0 text-amber-600" />
                  <span>
                    <strong>Quota Running Low:</strong> Only {quotaData.remainingWeeklyQuota} hour(s) remaining for reservations this week.
                  </span>
                </div>
              ) : null}
            </div>
          )}

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
            {/* LEFT COLUMN: Smart Allocation Assistant + Upcoming Bookings (7 Cols) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Smart Allocation Assistant Card */}
              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-extrabold text-[#292929]">
                      What do you need today?
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Tell us your requirements and the Smart Allocation Assistant will rank the best-fit free rooms.
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] text-[11px] font-bold px-2.5 py-1 rounded-full shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Smart Allocation</span>
                  </span>
                </div>

                <form onSubmit={handleSmartAllocate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                    {/* Expected Attendance */}
                    <div>
                      <label htmlFor="alloc-attendance" className="block text-xs font-bold text-gray-700 mb-1">
                        Expected Attendance
                      </label>
                      <div className="relative">
                        <Users className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <input
                          id="alloc-attendance"
                          type="number"
                          value={allocAttendance}
                          onChange={(e) => setAllocAttendance(e.target.value)}
                          placeholder="e.g. 30"
                          min={1}
                          required
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        />
                      </div>
                    </div>

                    {/* Activity Type */}
                    <div>
                      <label htmlFor="alloc-activity" className="block text-xs font-bold text-gray-700 mb-1">
                        Activity Type
                      </label>
                      <select
                        id="alloc-activity"
                        value={allocActivity}
                        onChange={(e) => setAllocActivity(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                      >
                        <option value="PROJECT_WORK">Project Work / Discussion</option>
                        <option value="CLASS_LECTURE">Class Lecture / Review</option>
                        <option value="LAB_SESSION">Lab Session / Practical</option>
                        <option value="CLUB_EVENT">Club Meeting / Activity</option>
                        <option value="GUEST_SEMINAR">Guest Seminar / Workshop</option>
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label htmlFor="alloc-date" className="block text-xs font-bold text-gray-700 mb-1">
                        Booking Date
                      </label>
                      <div className="relative">
                        <CalendarIcon className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <input
                          id="alloc-date"
                          type="date"
                          value={allocDate}
                          onChange={(e) => setAllocDate(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        />
                      </div>
                    </div>

                    {/* Time Slot */}
                    <div>
                      <label htmlFor="alloc-time" className="block text-xs font-bold text-gray-700 mb-1">
                        Desired Time Slot
                      </label>
                      <div className="relative">
                        <Clock className="w-4 h-4 text-gray-400 absolute left-3 top-2.5" />
                        <select
                          id="alloc-time"
                          value={allocTimeSlot}
                          onChange={(e) => setAllocTimeSlot(e.target.value)}
                          className="w-full pl-9 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        >
                          <option value="09:00 - 10:00">09:00 AM - 10:00 AM</option>
                          <option value="10:00 - 12:00">10:00 AM - 12:00 PM</option>
                          <option value="12:00 - 14:00">12:00 PM - 02:00 PM</option>
                          <option value="14:00 - 16:00">02:00 PM - 04:00 PM</option>
                          <option value="16:00 - 18:00">04:00 PM - 06:00 PM</option>
                          <option value="18:00 - 20:00">06:00 PM - 08:00 PM</option>
                        </select>
                      </div>
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={isSearchingAlloc}
                    className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition flex items-center justify-center gap-2 text-xs disabled:opacity-50"
                  >
                    {isSearchingAlloc ? (
                      <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <>
                        <Sparkles className="w-4 h-4" />
                        <span>Find Best-Fit Rooms</span>
                        <ArrowRight className="w-4 h-4" />
                      </>
                    )}
                  </button>
                </form>

                {/* Smart Recommendations Results View */}
                {allocSearchDone && (
                  <div className="pt-2 border-t border-gray-100 space-y-3">
                    <h3 className="text-xs font-bold text-gray-800 uppercase tracking-wider flex items-center justify-between">
                      <span>Recommended Rooms</span>
                      <span className="text-[11px] text-gray-500 font-normal">
                        {allocRecommendations.length} available matches
                      </span>
                    </h3>

                    {allocRecommendations.length === 0 ? (
                      <div className="p-4 bg-gray-50 rounded-xl text-center text-xs text-gray-500 border border-gray-200">
                        No rooms available for the requested capacity and time. Try adjusting the time window or date.
                      </div>
                    ) : (
                      <div className="space-y-2.5">
                        {allocRecommendations.slice(0, 3).map((rec) => {
                          const [sTime, eTime] = allocTimeSlot.split('-').map((s) => s.trim());
                          return (
                            <div
                              key={rec.resource.id}
                              className="p-3 bg-gray-50 hover:bg-orange-50/50 rounded-xl border border-gray-200 hover:border-[#FED7AA] transition flex items-center justify-between gap-3"
                            >
                              <div className="overflow-hidden space-y-1">
                                <div className="flex items-center gap-2">
                                  <span className="font-extrabold text-xs text-gray-900 truncate">
                                    {rec.resource.name}
                                  </span>
                                  <span className="text-[10px] bg-white border border-gray-200 px-1.5 py-0.5 rounded font-mono font-bold text-gray-600">
                                    {rec.resource.code}
                                  </span>
                                </div>
                                <div className="text-[11px] text-gray-500 flex items-center gap-2">
                                  <span>{rec.resource.building}</span>
                                  <span>•</span>
                                  <span>Capacity: {rec.resource.capacity}</span>
                                </div>
                                <div className="text-[10px] text-[#F58220] font-semibold flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  <span>{rec.reason}</span>
                                </div>
                              </div>

                              <button
                                type="button"
                                onClick={() => handleOpenBooking(rec.resource, allocDate, sTime, eTime)}
                                className="px-3 py-1.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition shrink-0"
                              >
                                Reserve Room
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Upcoming Bookings List Card */}
              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-[#292929]">
                    Your Upcoming Reservations
                  </h2>
                  <Link
                    href="/my-bookings"
                    className="text-xs font-bold text-[#F58220] hover:text-[#E06D0C] flex items-center gap-1"
                  >
                    <span>View All</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                <div className="space-y-3">
                  {upcomingBookings.length === 0 ? (
                    <div className="p-8 text-center text-xs text-gray-500 border border-dashed rounded-xl bg-gray-50/50">
                      No upcoming reservations found. Click '+ Book a Resource' or use the Smart Allocation Assistant above.
                    </div>
                  ) : (
                    upcomingBookings.map((b) => (
                      <div
                        key={b.id}
                        className="p-3.5 bg-gray-50 rounded-xl border border-gray-200 hover:border-gray-300 transition flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center gap-3.5 overflow-hidden">
                          <img
                            src={
                              b.resource?.imageUrl ||
                              'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=300&q=80'
                            }
                            alt={b.resource?.name}
                            className="w-12 h-12 rounded-xl object-cover shrink-0 border border-gray-200"
                          />
                          <div className="overflow-hidden">
                            <div className="font-extrabold text-xs text-[#292929] truncate">
                              {b.resource?.name}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                              <CalendarIcon className="w-3 h-3 text-gray-400" />
                              <span>{formatKolkataDate(b.startTime)}</span>
                              <span>•</span>
                              <span>{formatKolkataTimeRange(b.startTime, b.endTime)}</span>
                            </div>
                            <div className="text-[11px] font-mono text-gray-400 mt-0.5">
                              Ref: {b.bookingNumber}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 shrink-0">
                          {b.status === 'CONFIRMED' || b.status === 'CHECKED_IN' ? (
                            <button
                              type="button"
                              onClick={() => handleOpenCheckIn(b)}
                              className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 text-[11px] font-bold rounded-lg transition flex items-center gap-1 shadow-sm"
                            >
                              <QrCode className="w-3.5 h-3.5" />
                              <span>{b.status === 'CHECKED_IN' ? 'Verified' : 'Check In'}</span>
                            </button>
                          ) : (
                            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-lg">
                              Pending
                            </span>
                          )}
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: Weekly Schedule + Recommended Facilities (5 Cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* My Schedule (This Week) Card */}
              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-[#292929]">
                    Campus Schedule <span className="text-xs font-normal text-gray-400">(This Week)</span>
                  </h2>
                  <Link
                    href="/calendar"
                    className="text-xs font-bold text-[#F58220] hover:text-[#E06D0C] flex items-center gap-1"
                  >
                    <span>Full Calendar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Day Selector Buttons (Calculated dynamically for current week) */}
                <div className="flex items-center justify-between gap-1 pb-2 border-b border-gray-100 overflow-x-auto">
                  {daysList.map((d) => (
                    <button
                      key={d.name}
                      type="button"
                      onClick={() => setSelectedScheduleDay(d.dayOfWeek)}
                      className={`flex flex-col items-center py-1.5 px-2.5 rounded-xl text-xs font-bold transition shrink-0 ${
                        selectedScheduleDay === d.dayOfWeek
                          ? 'bg-[#F58220] text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-[10px] font-normal uppercase">{d.name}</span>
                      <span className="text-sm font-extrabold">{d.dateDisplay}</span>
                    </button>
                  ))}
                </div>

                {/* Dynamic Timetable Classes for Selected Day */}
                <div className="space-y-2.5 pt-1">
                  {filteredScheduleClasses.length === 0 ? (
                    <div className="p-6 text-center text-xs text-gray-400 border border-dashed rounded-xl">
                      No scheduled academic classes for this day. Facilities are open for reservation.
                    </div>
                  ) : (
                    filteredScheduleClasses.map((cls) => (
                      <div
                        key={cls.id}
                        className="p-3 bg-blue-50/60 border-l-4 border-[#1976B9] rounded-r-xl text-xs space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-extrabold text-blue-950">
                            {cls.courseCode}: {cls.courseName}
                          </span>
                          <span className="text-[11px] font-mono text-blue-800 font-bold">
                            {cls.startTime} - {cls.endTime}
                          </span>
                        </div>
                        <div className="text-[11px] text-blue-700 flex items-center justify-between">
                          <span>{cls.resource?.name || 'Classroom'} ({cls.resource?.building})</span>
                          <span>{cls.instructorName}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Recommended Facilities Catalog Preview */}
              <div className="bg-white p-5 sm:p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-[#292929]">
                    Featured Campus Facilities
                  </h2>
                  <Link
                    href="/resources"
                    className="text-xs font-bold text-[#F58220] hover:text-[#E06D0C] flex items-center gap-1"
                  >
                    <span>Browse All</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                <div className="space-y-3">
                  {recommendedResources.map((res) => (
                    <div
                      key={res.id}
                      className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between gap-3"
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        <img
                          src={res.imageUrl || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=200&q=80'}
                          alt={res.name}
                          className="w-10 h-10 rounded-lg object-cover shrink-0"
                        />
                        <div className="overflow-hidden">
                          <div className="font-bold text-xs text-gray-900 truncate">
                            {res.name}
                          </div>
                          <div className="text-[11px] text-gray-500 truncate">
                            {res.building} • Cap: {res.capacity}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleOpenBooking(res)}
                        className="px-3 py-1 bg-white hover:bg-orange-50 border border-gray-200 text-[#F58220] text-xs font-bold rounded-lg transition shrink-0"
                      >
                        Reserve
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </main>
      </div>

      {/* Booking Modal */}
      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        preselectedResource={selectedResourceForBooking}
        preselectedDate={bookingPreselectDate}
        preselectedStartTime={bookingPreselectStartTime}
        preselectedEndTime={bookingPreselectEndTime}
        onBookingSuccess={() => loadDashboardData()}
      />

      {/* Check In Modal */}
      <CheckInModal
        isOpen={isCheckInModalOpen}
        onClose={() => setIsCheckInModalOpen(false)}
        booking={selectedBookingForCheckIn}
        onCheckInUpdated={() => loadDashboardData()}
      />
    </div>
  );
}
