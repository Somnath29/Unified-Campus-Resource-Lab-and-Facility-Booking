'use client';

import React, { useState, useEffect, useCallback, useRef, Suspense } from 'react';
import Link from 'next/link';
import { useRouter, usePathname, useSearchParams } from 'next/navigation';
import {
  Calendar as CalendarIcon,
  ChevronLeft,
  ChevronRight,
  Clock,
  Building,
  Users,
  Plus,
  Info,
  Layers,
  BookOpen,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Lock,
  Wrench,
  Ban,
  Moon,
  ChevronDown,
  Sparkles,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { BookingModal } from '@/components/booking/BookingModal';
import { ResourceDetailModal } from '@/components/resource/ResourceDetailModal';
import { api } from '@/lib/api';
import {
  ResourceDTO,
  ResourceAvailabilityResponse,
  ResourceCalendarResponse,
  AvailabilitySlot,
  CalendarEvent,
} from '@lpu/shared';
import {
  getCurrentKolkataDateString,
  addDaysKolkata,
  formatKolkataDate,
  formatSlotTime12Hour,
  formatSlotTimeRange,
  isValidDateString,
  kolkataToUtc,
} from '@/lib/timezone';

function CalendarContent() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // URL state
  const urlResourceId = searchParams.get('resourceId') || '';
  const urlDate = searchParams.get('date') || getCurrentKolkataDateString();

  // Resource & Calendar state
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>(urlResourceId);
  const [selectedDate, setSelectedDate] = useState<string>(
    isValidDateString(urlDate) ? urlDate : getCurrentKolkataDateString()
  );

  // API Data
  const [availability, setAvailability] = useState<ResourceAvailabilityResponse | null>(null);
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Modals state
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [isDetailModalOpen, setIsDetailModalOpen] = useState(false);
  const [reserveSlot, setReserveSlot] = useState<{
    date: string;
    startTime: string;
    endTime: string;
  } | null>(null);

  // Waitlist state
  const [waitlistSuccessMessage, setWaitlistSuccessMessage] = useState<string | null>(null);
  const [isWaitlistJoining, setIsWaitlistJoining] = useState(false);

  const abortControllerRef = useRef<AbortController | null>(null);

  // Synchronize URL helper
  const updateQuery = useCallback(
    (newResourceId: string, newDate: string) => {
      const params = new URLSearchParams();
      if (newResourceId) params.set('resourceId', newResourceId);
      if (newDate) params.set('date', newDate);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [router, pathname]
  );

  // 1. Fetch initial resource list for selector dropdown
  useEffect(() => {
    let isMounted = true;
    const loadResources = async () => {
      try {
        const res = await api.resources.list({ limit: 100 });
        if (!isMounted) return;
        setResources(res.resources || []);

        // If no resource selected yet, choose the first available
        if (!urlResourceId && res.resources?.length > 0) {
          const firstId = res.resources[0].id;
          setSelectedResourceId(firstId);
          updateQuery(firstId, selectedDate);
        }
      } catch (err) {
        console.error('Failed to load resources for calendar:', err);
      }
    };

    loadResources();
    return () => {
      isMounted = false;
    };
  }, [urlResourceId, selectedDate, updateQuery]);

  // Synchronize from URL changes (Back/Forward navigation)
  useEffect(() => {
    if (urlResourceId && urlResourceId !== selectedResourceId) {
      setSelectedResourceId(urlResourceId);
    }
    if (urlDate && urlDate !== selectedDate && isValidDateString(urlDate)) {
      setSelectedDate(urlDate);
    }
  }, [urlResourceId, urlDate]);

  // 2. Fetch Availability & Calendar data for selected resource and date
  const fetchScheduleData = useCallback(async () => {
    if (!selectedResourceId) return;

    setIsLoading(true);
    setErrorMessage(null);

    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Calculate 7-day calendar window centered on or starting from selectedDate
      const fromDate = selectedDate;
      const toDate = addDaysKolkata(selectedDate, 6);

      const [availRes, calRes] = await Promise.all([
        api.resources.getAvailability(selectedResourceId, selectedDate),
        api.resources.getCalendar(selectedResourceId, fromDate, toDate),
      ]);

      if (!controller.signal.aborted) {
        setAvailability(availRes);
        setCalendarEvents(calRes.events || []);
      }
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      if (!controller.signal.aborted) {
        console.error('Failed to load schedule data:', err);
        setErrorMessage(
          err.message || 'Unable to retrieve live schedule data for this resource. Please check connection and retry.'
        );
      }
    } finally {
      if (!controller.signal.aborted) {
        setIsLoading(false);
      }
    }
  }, [selectedResourceId, selectedDate]);

  useEffect(() => {
    fetchScheduleData();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [fetchScheduleData]);

  // Navigation handlers
  const handleResourceChange = (newId: string) => {
    setSelectedResourceId(newId);
    updateQuery(newId, selectedDate);
  };

  const handleDateChange = (newDate: string) => {
    if (!isValidDateString(newDate)) return;
    setSelectedDate(newDate);
    updateQuery(selectedResourceId, newDate);
  };

  const handlePrevDay = () => {
    handleDateChange(addDaysKolkata(selectedDate, -1));
  };

  const handleNextDay = () => {
    handleDateChange(addDaysKolkata(selectedDate, 1));
  };

  const handleToday = () => {
    handleDateChange(getCurrentKolkataDateString());
  };

  const currentResource = resources.find((r) => r.id === selectedResourceId);

  // Trigger one-click reservation on an available slot
  const handleReserveSlot = (slot: AvailabilitySlot) => {
    if (slot.status !== 'available') return;
    setReserveSlot({
      date: selectedDate,
      startTime: slot.startTime,
      endTime: slot.endTime,
    });
    setIsBookingModalOpen(true);
  };

  // Join waitlist for an occupied/booked slot
  const handleJoinWaitlist = async (slot: AvailabilitySlot) => {
    if (!selectedResourceId || slot.status !== 'booked') return;
    setIsWaitlistJoining(true);
    setWaitlistSuccessMessage(null);
    try {
      const startUtc = kolkataToUtc(selectedDate, slot.startTime);
      const endUtc = kolkataToUtc(selectedDate, slot.endTime);
      const res = await api.waitlist.join({
        resourceId: selectedResourceId,
        startTime: startUtc.toISOString(),
        endTime: endUtc.toISOString(),
      });
      setWaitlistSuccessMessage(
        `Successfully joined waitlist for ${currentResource?.name || 'resource'} (${formatSlotTimeRange(slot.startTime, slot.endTime)})! You are #${res.queuePosition} in line.`
      );
      setTimeout(() => setWaitlistSuccessMessage(null), 6000);
    } catch (err: any) {
      alert(err.message || 'Failed to join waitlist. Please check slot availability.');
    } finally {
      setIsWaitlistJoining(false);
    }
  };

  // Helper to render slot badge & actions
  const renderSlotStatus = (slot: AvailabilitySlot) => {
    switch (slot.status) {
      case 'available':
        return (
          <div className="flex items-center justify-between gap-3 w-full">
            <span className="flex items-center gap-1.5 text-emerald-700 text-xs font-bold">
              <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
              <span>Available for Reservation</span>
            </span>
            <button
              type="button"
              onClick={() => handleReserveSlot(slot)}
              aria-label={`Reserve available slot ${formatSlotTimeRange(slot.startTime, slot.endTime)}`}
              className="px-3 py-1 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1 shrink-0"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Reserve</span>
            </button>
          </div>
        );

      case 'booked':
        return (
          <div className="flex items-center justify-between gap-2 w-full">
            <div className="flex items-center gap-2 text-xs font-bold text-orange-950">
              <Lock className="w-4 h-4 text-[#F58220] shrink-0" />
              <div>
                <span>Reserved</span>
                <span className="text-[10px] text-gray-500 font-normal block">
                  {slot.reason || 'Booked for an approved event'}
                </span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => handleJoinWaitlist(slot)}
              disabled={isWaitlistJoining}
              aria-label={`Join waitlist for slot ${formatSlotTimeRange(slot.startTime, slot.endTime)}`}
              className="px-2.5 py-1 bg-amber-500/10 hover:bg-[#F58220] text-[#F58220] hover:text-white border border-[#F58220]/30 hover:border-[#F58220] text-xs font-bold rounded-xl transition flex items-center gap-1 shrink-0 disabled:opacity-50"
            >
              <Clock className="w-3.5 h-3.5" />
              <span>Join Waitlist</span>
            </button>
          </div>
        );

      case 'class':
        return (
          <div className="flex items-center gap-2 text-xs font-bold text-blue-950">
            <BookOpen className="w-4 h-4 text-[#1976B9] shrink-0" />
            <div>
              <span>Academic Timetable Lecture / Lab</span>
              <span className="text-[10px] text-blue-700 font-normal block">
                {slot.reason || 'Scheduled academic lecture'}
              </span>
            </div>
          </div>
        );

      case 'maintenance':
        return (
          <div className="flex items-center gap-2 text-xs font-bold text-amber-900">
            <Wrench className="w-4 h-4 text-amber-600 shrink-0" />
            <div>
              <span>Facility Maintenance</span>
              <span className="text-[10px] text-amber-700 font-normal block">
                {slot.reason || 'Scheduled maintenance block'}
              </span>
            </div>
          </div>
        );

      case 'blackout':
        return (
          <div className="flex items-center gap-2 text-xs font-bold text-purple-900">
            <Ban className="w-4 h-4 text-purple-600 shrink-0" />
            <div>
              <span>Campus Blackout Period</span>
              <span className="text-[10px] text-purple-700 font-normal block">
                {slot.reason || 'Official blackout window (exams / university event)'}
              </span>
            </div>
          </div>
        );

      case 'outside_hours':
      default:
        return (
          <div className="flex items-center gap-2 text-xs text-gray-500 font-semibold">
            <Moon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
            <span>{slot.reason || 'Outside facility operating hours'}</span>
          </div>
        );
    }
  };

  // Helper for slot background styling
  const getSlotContainerClasses = (status: string) => {
    switch (status) {
      case 'available':
        return 'bg-emerald-50/70 border-emerald-200 hover:border-emerald-300';
      case 'booked':
        return 'bg-orange-50/70 border-[#FED7AA]';
      case 'class':
        return 'bg-blue-50/70 border-blue-200';
      case 'maintenance':
        return 'bg-amber-50/70 border-amber-200';
      case 'blackout':
        return 'bg-purple-50/70 border-purple-200';
      case 'outside_hours':
      default:
        return 'bg-gray-50/80 border-gray-200 opacity-60';
    }
  };

  // Filter events occurring on the selected date
  const eventsForSelectedDate = calendarEvents.filter((e) => {
    const eDate = e.start.split(' ')[0];
    return eDate === selectedDate;
  });

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex flex-col lg:flex-row">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Header & Breadcrumb */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <Link href="/resources" className="hover:text-gray-600">
                  Resources
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">Live Calendar</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#292929] tracking-tight">
                Resource Availability Calendar
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Inspect live 30-minute availability slots, academic classes, and reserved periods.
              </p>
            </div>

            {/* Quick Actions: Resource details and Return to catalog */}
            <div className="flex items-center gap-2 self-start sm:self-auto">
              <Link
                href="/resources"
                className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl shadow-sm transition"
              >
                Back to Catalog
              </Link>
              {currentResource && (
                <button
                  type="button"
                  onClick={() => setIsDetailModalOpen(true)}
                  className="px-3.5 py-2 bg-[#FFF4EA] border border-[#FED7AA] text-[#F58220] text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5 hover:bg-[#FED7AA]/30"
                >
                  <Info className="w-4 h-4" />
                  <span>Facility Info</span>
                </button>
              )}
            </div>
          </div>

          {/* Waitlist Success Banner */}
          {waitlistSuccessMessage && (
            <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-xl flex items-center justify-between text-xs font-semibold animate-in fade-in shadow-sm">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>{waitlistSuccessMessage}</span>
              </div>
              <Link href="/my-bookings?tab=WAITLIST" className="underline font-bold hover:text-emerald-950 ml-2 shrink-0">
                View Waitlist →
              </Link>
            </div>
          )}

          {/* Control Bar: Resource Selector + Date Navigation */}
          <div className="bg-white p-4 sm:p-5 rounded-2xl border border-gray-100 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-4">
            {/* Resource Selector Dropdown */}
            <div className="flex-1 max-w-md">
              <label htmlFor="calendar-resource-select" className="block text-xs font-bold text-gray-600 mb-1">
                Select Campus Resource
              </label>
              <div className="relative">
                <select
                  id="calendar-resource-select"
                  value={selectedResourceId}
                  onChange={(e) => handleResourceChange(e.target.value)}
                  className="w-full pl-3 pr-8 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.code} • {r.building})
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Date Navigation Controls */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-gray-50 p-1 rounded-xl border border-gray-200">
                <button
                  type="button"
                  onClick={handlePrevDay}
                  aria-label="Previous day"
                  className="p-1.5 hover:bg-white rounded-lg text-gray-600 hover:text-black transition shadow-none hover:shadow-sm"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  type="button"
                  onClick={handleToday}
                  className="px-3 py-1 text-xs font-bold text-gray-800 hover:bg-white rounded-lg transition"
                >
                  Today
                </button>
                <button
                  type="button"
                  onClick={handleNextDay}
                  aria-label="Next day"
                  className="p-1.5 hover:bg-white rounded-lg text-gray-600 hover:text-black transition shadow-none hover:shadow-sm"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>

              {/* Date Picker Input */}
              <div className="relative">
                <input
                  type="date"
                  value={selectedDate}
                  onChange={(e) => handleDateChange(e.target.value)}
                  aria-label="Select calendar date"
                  className="px-3 py-2 bg-gray-50 border border-gray-200 rounded-xl text-xs font-bold text-gray-800 shadow-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20"
                />
              </div>
            </div>
          </div>

          {/* Current Selection & Legend Bar */}
          <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-sm space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2 pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <CalendarIcon className="w-4 h-4 text-[#F58220]" />
                <span className="text-sm font-extrabold text-[#292929]">
                  {formatKolkataDate(selectedDate, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
                </span>
                {selectedDate === getCurrentKolkataDateString() && (
                  <span className="bg-emerald-100 text-emerald-800 text-[10px] font-extrabold px-2 py-0.5 rounded-full uppercase">
                    Today
                  </span>
                )}
              </div>

              {currentResource && (
                <div className="text-xs text-gray-500">
                  Operating Hours:{' '}
                  <span className="font-bold text-gray-800">
                    {currentResource.operatingHours || '08:00 AM - 08:00 PM'}
                  </span>
                </div>
              )}
            </div>

            {/* Color Legend with Accessible Labels */}
            <div className="flex items-center gap-4 flex-wrap text-xs text-gray-600">
              <span className="font-bold text-gray-800">Legend:</span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-emerald-500 border border-emerald-600" />
                <span>Available</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#F58220] border border-[#E06D0C]" />
                <span>Booked</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-[#1976B9] border border-blue-700" />
                <span>Class Timetable</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-amber-500 border border-amber-600" />
                <span>Maintenance</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-purple-500 border border-purple-600" />
                <span>Blackout</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-gray-400 border border-gray-500" />
                <span>Outside Operating Hours</span>
              </span>
            </div>
          </div>

          {/* Error State with Retry Button */}
          {errorMessage && (
            <div className="p-6 bg-red-50 border border-red-200 rounded-2xl text-center space-y-3">
              <AlertCircle className="w-8 h-8 text-red-500 mx-auto" />
              <div className="text-sm font-bold text-red-800">Error Loading Schedule</div>
              <p className="text-xs text-red-600 max-w-md mx-auto">{errorMessage}</p>
              <button
                type="button"
                onClick={fetchScheduleData}
                className="px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-sm inline-flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Retry Request</span>
              </button>
            </div>
          )}

          {/* Loading Skeleton */}
          {isLoading && !errorMessage && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 space-y-3 animate-pulse" aria-busy="true">
              <div className="h-6 bg-gray-200 rounded w-1/4" />
              <div className="space-y-2 mt-4">
                {Array.from({ length: 8 }).map((_, i) => (
                  <div key={i} className="h-12 bg-gray-100 rounded-xl" />
                ))}
              </div>
            </div>
          )}

          {/* Schedule Visualization: 30-Minute Daily Slots Timeline */}
          {!isLoading && !errorMessage && availability && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-gray-100 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-extrabold text-[#292929]">
                    Daily 30-Minute Schedule
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {availability.resourceName} {currentResource?.code ? `(${currentResource.code})` : ''} • Asia/Kolkata
                  </p>
                </div>
                <div className="text-xs text-gray-400 font-mono">
                  {availability.slots.filter((s) => s.status === 'available').length} Open Slots
                </div>
              </div>

              {/* Slot Items List */}
              <div className="divide-y divide-gray-100 p-2 sm:p-4">
                {availability.slots.map((slot) => {
                  const containerClass = getSlotContainerClasses(slot.status);
                  return (
                    <div
                      key={slot.startTime}
                      className={`p-3 sm:p-3.5 rounded-2xl border transition my-1 flex flex-col sm:flex-row sm:items-center justify-between gap-2 ${containerClass}`}
                    >
                      {/* Time Column */}
                      <div className="flex items-center gap-2 text-xs font-mono font-bold text-gray-800 shrink-0 min-w-[170px]">
                        <Clock className="w-3.5 h-3.5 text-gray-400" />
                        <span>{formatSlotTimeRange(slot.startTime, slot.endTime)}</span>
                      </div>

                      {/* Status & Action */}
                      <div className="flex-1 flex items-center justify-between">
                        {renderSlotStatus(slot)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Calendar Events Summary (Classes & Bookings) */}
          {!isLoading && !errorMessage && eventsForSelectedDate.length > 0 && (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-5 space-y-4">
              <h3 className="text-sm font-extrabold text-gray-900 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-[#F58220]" />
                <span>Scheduled Events & Classes on This Day</span>
              </h3>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {eventsForSelectedDate.map((ev) => (
                  <div
                    key={ev.id}
                    className={`p-3.5 rounded-2xl border flex flex-col justify-between ${
                      ev.type === 'CLASS'
                        ? 'bg-blue-50/60 border-blue-200'
                        : 'bg-orange-50/60 border-[#FED7AA]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`text-[10px] font-extrabold px-2 py-0.5 rounded uppercase ${
                            ev.type === 'CLASS'
                              ? 'bg-blue-200 text-blue-900'
                              : 'bg-orange-200 text-orange-950'
                          }`}
                        >
                          {ev.type}
                        </span>
                        <span className="text-xs font-mono font-bold text-gray-600">
                          {ev.start.split(' ')[1]} - {ev.end.split(' ')[1]}
                        </span>
                      </div>

                      <h4 className="text-xs font-extrabold text-gray-900 mt-2 truncate">
                        {ev.title}
                      </h4>
                      {ev.type === 'CLASS' && (
                        <p className="text-[11px] text-blue-800 mt-0.5">
                          {ev.courseCode} • {ev.instructorName || 'Faculty Instructor'}
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </main>
      </div>

      {/* Booking Modal */}
      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        preselectedResource={currentResource}
        preselectedDate={reserveSlot?.date}
        preselectedStartTime={reserveSlot?.startTime}
        preselectedEndTime={reserveSlot?.endTime}
        onBookingSuccess={() => fetchScheduleData()}
      />

      {/* Resource Detail Modal */}
      <ResourceDetailModal
        resource={currentResource || null}
        isOpen={isDetailModalOpen}
        onClose={() => setIsDetailModalOpen(false)}
        onReserve={(res, date, start, end) => {
          setIsDetailModalOpen(false);
          setReserveSlot(date && start && end ? { date, startTime: start, endTime: end } : null);
          setIsBookingModalOpen(true);
        }}
      />
    </div>
  );
}

export default function CalendarPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-8">
          <div className="w-10 h-10 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin" />
        </div>
      }
    >
      <CalendarContent />
    </Suspense>
  );
}
