'use client';

import React, { useState, useEffect } from 'react';
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
  Heart,
  SlidersHorizontal,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { BookingModal } from '@/components/booking/BookingModal';
import { CheckInModal } from '@/components/booking/CheckInModal';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { ResourceDTO, BookingDTO } from '@lpu/shared';

export default function DashboardPage() {
  const router = useRouter();
  const { user, isLoading: authLoading } = useAuth();

  const [stats, setStats] = useState<any>({
    upcomingBookingsCount: 3,
    pendingRequestsCount: 1,
    availableResourcesCount: 42,
    clubBookingsCount: 5,
    nextBooking: null,
  });
  const [upcomingBookings, setUpcomingBookings] = useState<BookingDTO[]>([]);
  const [recommendedResources, setRecommendedResources] = useState<ResourceDTO[]>([]);
  const [timetableClasses, setTimetableClasses] = useState<any[]>([]);

  // Modals state
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [selectedResourceForBooking, setSelectedResourceForBooking] = useState<ResourceDTO | null>(null);
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [selectedBookingForCheckIn, setSelectedBookingForCheckIn] = useState<BookingDTO | null>(null);

  // Smart Allocation Form State
  const [allocAttendance, setAllocAttendance] = useState('30');
  const [allocActivity, setAllocActivity] = useState('PROJECT_WORK');
  const [allocDate, setAllocDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [allocTimeSlot, setAllocTimeSlot] = useState('14:00 - 16:00');
  const [isSearchingAlloc, setIsSearchingAlloc] = useState(false);

  // Schedule Day Selector (Mon - Sun)
  const [selectedScheduleDay, setSelectedScheduleDay] = useState(1); // 1 = Monday

  useEffect(() => {
    if (!authLoading && !user) {
      router.push('/login');
    }
  }, [user, authLoading, router]);

  useEffect(() => {
    loadDashboardData();
  }, [user]);

  const loadDashboardData = async () => {
    try {
      const res = await api.dashboard.getStats();
      if (res.stats) setStats(res.stats);
      if (res.upcomingBookings) setUpcomingBookings(res.upcomingBookings);
      if (res.recommendedResources) setRecommendedResources(res.recommendedResources);
      if (res.timetableClasses) setTimetableClasses(res.timetableClasses);
    } catch (err) {
      console.error('Error loading dashboard data:', err);
    }
  };

  const handleOpenBooking = (resource?: ResourceDTO) => {
    setSelectedResourceForBooking(resource || null);
    setIsBookingModalOpen(true);
  };

  const handleOpenCheckIn = (booking: BookingDTO) => {
    setSelectedBookingForCheckIn(booking);
    setIsCheckInModalOpen(true);
  };

  const handleSmartAllocate = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSearchingAlloc(true);
    try {
      const res = await api.resources.smartAllocation({
        expectedAttendance: Number(allocAttendance),
        activityType: allocActivity,
        date: allocDate,
        timeSlot: allocTimeSlot,
      });

      if (res.matches && res.matches.length > 0) {
        handleOpenBooking(res.matches[0]);
      } else {
        router.push('/resources');
      }
    } catch {
      router.push('/resources');
    } finally {
      setIsSearchingAlloc(false);
    }
  };

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const daysList = [
    { name: 'Mon', date: '27', dayOfWeek: 1 },
    { name: 'Tue', date: '28', dayOfWeek: 2 },
    { name: 'Wed', date: '29', dayOfWeek: 3 },
    { name: 'Thu', date: '30', dayOfWeek: 4 },
    { name: 'Fri', date: '31', dayOfWeek: 5 },
    { name: 'Sat', date: '1', dayOfWeek: 6 },
    { name: 'Sun', date: '2', dayOfWeek: 0 },
  ];

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      {/* Sidebar */}
      <Sidebar
        pendingApprovalsCount={stats.pendingRequestsCount}
        unreadNotificationsCount={3}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Header Row: Greeting & "+ Book a Resource" Button */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl lg:text-3xl font-extrabold text-[#292929] tracking-tight flex items-center gap-2">
                <span>Good morning, {user.name.split(' ')[0]}</span>
                <span className="text-2xl">☀️</span>
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Find and book the right campus resources for your classes, clubs, projects and events.
              </p>
            </div>

            <button
              onClick={() => handleOpenBooking()}
              className="px-5 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-sm shrink-0"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>Book a Resource</span>
            </button>
          </div>

          {/* Stat Cards Grid (Matching Screenshot 1) */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {/* 1. Upcoming Bookings */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {stats.upcomingBookingsCount}
                </div>
                <div className="text-xs font-bold text-gray-700">Upcoming Bookings</div>
                <div className="text-[11px] text-gray-400">
                  {stats.nextBooking
                    ? `Next: ${new Date(stats.nextBooking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Next: Today, 2:00 PM'}
                </div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-orange-50 border border-orange-100 flex items-center justify-center text-[#F58220]">
                <CalendarIcon className="w-6 h-6" />
              </div>
            </div>

            {/* 2. Pending Request */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {stats.pendingRequestsCount}
                </div>
                <div className="text-xs font-bold text-gray-700">Pending Request</div>
                <div className="text-[11px] text-gray-400">Awaiting approval</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-[#FFF4EA] border border-[#FED7AA] flex items-center justify-center text-[#F58220]">
                <Clock className="w-6 h-6" />
              </div>
            </div>

            {/* 3. Available Resources */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {stats.availableResourcesCount || 42}
                </div>
                <div className="text-xs font-bold text-gray-700">Available Resources</div>
                <div className="text-[11px] text-gray-400">Classrooms, Labs, Halls & more</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-700">
                <Building className="w-6 h-6" />
              </div>
            </div>

            {/* 4. Club Bookings */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between hover:shadow-md transition">
              <div className="space-y-1">
                <div className="text-2xl font-black text-[#292929]">
                  {stats.clubBookingsCount}
                </div>
                <div className="text-xs font-bold text-gray-700">Your Club Bookings</div>
                <div className="text-[11px] text-gray-400">This semester</div>
              </div>
              <div className="w-12 h-12 rounded-2xl bg-gray-50 border border-gray-100 flex items-center justify-center text-gray-700">
                <Users className="w-6 h-6" />
              </div>
            </div>
          </div>

          {/* Two-Column Layout */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* LEFT COLUMN: What do you need today? + Upcoming Bookings List (7 Cols) */}
            <div className="lg:col-span-7 space-y-6">
              {/* Smart Room Allocation Form Card (Matching Screenshot 1) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-5">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-extrabold text-[#292929]">
                      What do you need today?
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      Tell us your requirements and we'll suggest the best-fit rooms for you.
                    </p>
                  </div>
                  <span className="flex items-center gap-1.5 bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] text-[11px] font-bold px-2.5 py-1 rounded-full">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Smart Allocation</span>
                  </span>
                </div>

                <form onSubmit={handleSmartAllocate} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    {/* Expected Attendance */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Expected Attendance
                      </label>
                      <div className="relative">
                        <Users className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="number"
                          value={allocAttendance}
                          onChange={(e) => setAllocAttendance(e.target.value)}
                          placeholder="e.g. 30"
                          min={1}
                          className="w-full pl-10 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        />
                      </div>
                    </div>

                    {/* Activity Type */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">
                        Activity Type
                      </label>
                      <select
                        value={allocActivity}
                        onChange={(e) => setAllocActivity(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                      >
                        <option value="PROJECT_WORK">Project Work / Discussion</option>
                        <option value="CLASS_LECTURE">Class Discussion / Lecture</option>
                        <option value="LAB_SESSION">Lab Session / Practical</option>
                        <option value="CLUB_EVENT">Club Meeting / Event</option>
                        <option value="GUEST_SEMINAR">Guest Seminar / Presentation</option>
                      </select>
                    </div>

                    {/* Date */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Date</label>
                      <div className="relative">
                        <CalendarIcon className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <input
                          type="date"
                          value={allocDate}
                          onChange={(e) => setAllocDate(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        />
                      </div>
                    </div>

                    {/* Time */}
                    <div>
                      <label className="block text-xs font-bold text-gray-700 mb-1">Time Slot</label>
                      <div className="relative">
                        <Clock className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                        <select
                          value={allocTimeSlot}
                          onChange={(e) => setAllocTimeSlot(e.target.value)}
                          className="w-full pl-10 pr-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                        >
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
                    className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
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
              </div>

              {/* Upcoming Bookings List Card (Matching Screenshot 1) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-[#292929]">Upcoming Bookings</h2>
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
                    <div className="p-8 text-center text-xs text-gray-400 border border-dashed rounded-xl">
                      No upcoming bookings. Click '+ Book a Resource' to get started.
                    </div>
                  ) : (
                    upcomingBookings.map((b) => (
                      <div
                        key={b.id}
                        onClick={() => handleOpenCheckIn(b)}
                        className="p-3.5 bg-gray-50 hover:bg-orange-50/40 rounded-xl border border-gray-100 hover:border-orange-200 transition flex items-center justify-between gap-4 cursor-pointer group"
                      >
                        <div className="flex items-center gap-3.5 overflow-hidden">
                          <img
                            src={
                              b.resource?.imageUrl ||
                              'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80'
                            }
                            alt={b.resource?.name}
                            className="w-14 h-14 rounded-xl object-cover shrink-0 border border-gray-200"
                          />
                          <div className="overflow-hidden">
                            <div className="font-bold text-sm text-[#292929] group-hover:text-[#F58220] transition truncate">
                              {b.resource?.name}
                            </div>
                            <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                              <Clock className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                              <span>
                                {new Date(b.startTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                -{' '}
                                {new Date(b.endTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="text-[11px] text-gray-400 mt-0.5 truncate">
                              {b.purpose}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-3 shrink-0">
                          {b.status === 'CONFIRMED' || b.status === 'CHECKED_IN' ? (
                            <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>{b.status === 'CHECKED_IN' ? 'Checked In' : 'Confirmed'}</span>
                            </span>
                          ) : (
                            <span className="text-[11px] font-bold text-amber-700 bg-amber-50 border border-amber-200 px-2.5 py-1 rounded-full flex items-center gap-1">
                              <span className="w-2 h-2 rounded-full bg-amber-500" />
                              <span>Pending</span>
                            </span>
                          )}
                          <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-[#F58220] transition" />
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>

            {/* RIGHT COLUMN: My Schedule (This Week) + Recommended for You (5 Cols) */}
            <div className="lg:col-span-5 space-y-6">
              {/* My Schedule (This Week) Card (Matching Screenshot 1) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <h2 className="text-base font-extrabold text-[#292929]">
                    My Schedule <span className="text-xs font-normal text-gray-400">(This Week)</span>
                  </h2>
                  <Link
                    href="/calendar"
                    className="text-xs font-bold text-[#F58220] hover:text-[#E06D0C] flex items-center gap-1"
                  >
                    <span>View Calendar</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                {/* Day Selector Buttons */}
                <div className="flex items-center justify-between gap-1 pb-2 border-b border-gray-100 overflow-x-auto">
                  {daysList.map((d) => (
                    <button
                      key={d.name}
                      onClick={() => setSelectedScheduleDay(d.dayOfWeek)}
                      className={`flex flex-col items-center py-1.5 px-2.5 rounded-xl text-xs font-bold transition shrink-0 ${
                        selectedScheduleDay === d.dayOfWeek
                          ? 'bg-[#F58220] text-white shadow-sm'
                          : 'text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      <span className="text-[10px] font-normal uppercase">{d.name}</span>
                      <span className="text-sm font-extrabold">{d.date}</span>
                    </button>
                  ))}
                </div>

                {/* Vertical Timeline (Matching Screenshot 1) */}
                <div className="space-y-3 pt-2">
                  {/* Slot 1: 10:00 AM */}
                  <div className="flex items-start gap-4">
                    <span className="text-[11px] font-bold text-gray-400 w-16 pt-1">10:00 AM</span>
                    <div className="flex-1 p-3 bg-gray-50 border-l-4 border-gray-400 rounded-r-xl text-xs">
                      <div className="font-bold text-gray-800">DAA Lecture</div>
                      <div className="text-[11px] text-gray-500 mt-0.5">CSE Block - 204</div>
                    </div>
                  </div>

                  {/* Slot 2: 12:00 PM */}
                  <div className="flex items-start gap-4">
                    <span className="text-[11px] font-bold text-gray-400 w-16 pt-1">12:00 PM</span>
                    <div className="flex-1 p-3 bg-gray-50 border-l-4 border-[#1976B9] rounded-r-xl text-xs flex items-center justify-between">
                      <div>
                        <div className="font-bold text-gray-800">Club Meeting</div>
                        <div className="text-[11px] text-gray-500 mt-0.5">Student Activity Center</div>
                      </div>
                      <Users className="w-4 h-4 text-gray-400" />
                    </div>
                  </div>

                  {/* Slot 3: 2:00 PM (Active Orange Highlight) */}
                  <div className="flex items-start gap-4">
                    <span className="text-[11px] font-bold text-[#F58220] w-16 pt-1">02:00 PM</span>
                    <div className="flex-1 p-3 bg-orange-50 border-l-4 border-[#F58220] rounded-r-xl text-xs shadow-sm">
                      <div className="font-bold text-[#292929]">Project Discussion</div>
                      <div className="text-[11px] text-[#F58220] mt-0.5 flex items-center gap-1 font-medium">
                        <MapPin className="w-3 h-3" />
                        <span>Seminar Hall 2</span>
                      </div>
                    </div>
                  </div>

                  {/* Slot 4: 4:00 PM */}
                  <div className="flex items-start gap-4">
                    <span className="text-[11px] font-bold text-gray-400 w-16 pt-1">04:00 PM</span>
                    <div className="flex-1 p-2.5 bg-gray-50/60 rounded-xl text-xs text-gray-400 font-medium border border-dashed border-gray-200">
                      Free Slot (Available for Booking)
                    </div>
                  </div>
                </div>
              </div>

              {/* Recommended for You Card (Matching Screenshot 1) */}
              <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-extrabold text-[#292929]">Recommended for You</h2>
                    <p className="text-[11px] text-gray-400">Based on your recent activity and preferences</p>
                  </div>
                  <Link
                    href="/resources"
                    className="text-xs font-bold text-[#F58220] hover:text-[#E06D0C] flex items-center gap-1"
                  >
                    <span>View All</span>
                    <ArrowRight className="w-3.5 h-3.5" />
                  </Link>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {recommendedResources.slice(0, 2).map((res) => (
                    <div
                      key={res.id}
                      className="border border-gray-100 rounded-2xl overflow-hidden hover:shadow-md transition flex flex-col justify-between bg-white"
                    >
                      <div className="relative h-28 w-full bg-gray-200">
                        <img
                          src={res.imageUrl}
                          alt={res.name}
                          className="w-full h-full object-cover"
                        />
                        <button className="absolute top-2 right-2 p-1.5 bg-white/80 backdrop-blur rounded-full text-gray-600 hover:text-red-500 shadow transition">
                          <Heart className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="p-3.5 flex-1 flex flex-col justify-between space-y-2">
                        <div>
                          <div className="font-bold text-xs text-gray-900 truncate">{res.name}</div>
                          <div className="text-[10px] text-gray-500 flex items-center gap-1 mt-0.5">
                            <Users className="w-3 h-3 text-gray-400" />
                            <span>Capacity: {res.capacity}</span>
                          </div>
                          <div className="text-[10px] text-gray-400 truncate">{res.building}</div>
                        </div>

                        {/* Amenities Tags */}
                        <div className="flex flex-wrap gap-1">
                          {res.amenities.slice(0, 2).map((a) => (
                            <span
                              key={a}
                              className="text-[9px] bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded font-medium"
                            >
                              {a}
                            </span>
                          ))}
                        </div>

                        <button
                          onClick={() => handleOpenBooking(res)}
                          className="w-full py-1.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-1.5 mt-2"
                        >
                          <span>Book Now</span>
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      </div>
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
        onBookingSuccess={() => loadDashboardData()}
      />

      {/* Check-In Modal */}
      <CheckInModal
        isOpen={isCheckInModalOpen}
        onClose={() => setIsCheckInModalOpen(false)}
        booking={selectedBookingForCheckIn}
        onCheckInUpdated={() => loadDashboardData()}
      />
    </div>
  );
}

