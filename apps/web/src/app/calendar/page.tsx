'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
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
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { BookingModal } from '@/components/booking/BookingModal';
import { api } from '@/lib/api';
import { ResourceDTO } from '@lpu/shared';

export default function CalendarPage() {
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [viewMode, setViewMode] = useState<'day' | 'week' | 'month'>('week');
  const [timetable, setTimetable] = useState<any[]>([]);
  const [bookings, setBookings] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Booking modal
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);
  const [modalResource, setModalResource] = useState<ResourceDTO | null>(null);

  useEffect(() => {
    fetchInitialData();
  }, []);

  const fetchInitialData = async () => {
    setIsLoading(true);
    try {
      const res = await api.resources.list();
      setResources(res.resources || []);
      if (res.resources?.length > 0) {
        setSelectedResourceId(res.resources[0].id);
        fetchSchedules(res.resources[0].id);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchSchedules = async (resourceId: string) => {
    try {
      const [ttRes, bRes] = await Promise.all([
        api.timetable.list({ resourceId }),
        api.bookings.list({ resourceId }),
      ]);
      setTimetable(ttRes.timetable || []);
      setBookings(bRes.bookings || []);
    } catch (err) {
      console.error('Failed to load schedule slots:', err);
    }
  };

  const handleResourceChange = (id: string) => {
    setSelectedResourceId(id);
    fetchSchedules(id);
  };

  const currentResource = resources.find((r) => r.id === selectedResourceId);

  const hours = [
    '08:00', '09:00', '10:00', '11:00', '12:00',
    '13:00', '14:00', '15:00', '16:00', '17:00', '18:00', '19:00'
  ];

  const weekDays = [
    { label: 'Monday', dayOfWeek: 1, date: '27 Oct' },
    { label: 'Tuesday', dayOfWeek: 2, date: '28 Oct' },
    { label: 'Wednesday', dayOfWeek: 3, date: '29 Oct' },
    { label: 'Thursday', dayOfWeek: 4, date: '30 Oct' },
    { label: 'Friday', dayOfWeek: 5, date: '31 Oct' },
  ];

  const handleBookSlot = () => {
    setModalResource(currentResource || null);
    setIsBookingModalOpen(true);
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">Availability Calendar</span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
                Academic & Resource Timetable
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Inspect scheduled lectures, lab practicals, and available open reservation slots.
              </p>
            </div>

            {/* Quick Actions */}
            <div className="flex items-center gap-3">
              {/* Resource Selector Dropdown */}
              <select
                value={selectedResourceId}
                onChange={(e) => handleResourceChange(e.target.value)}
                className="px-3.5 py-2 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-800 shadow-sm focus:outline-none focus:border-[#F58220]"
              >
                {resources.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} ({r.building})
                  </option>
                ))}
              </select>

              <button
                onClick={handleBookSlot}
                className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Reserve Slot</span>
              </button>
            </div>
          </div>

          {/* Legend Banner */}
          <div className="p-3.5 bg-white rounded-2xl border border-gray-100 shadow-sm flex items-center justify-between flex-wrap gap-4 text-xs">
            <div className="flex items-center gap-4 flex-wrap">
              <span className="font-bold text-gray-700">Slot Status Legend:</span>
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-3 h-3 rounded bg-blue-100 border border-blue-400" />
                <span>Academic Timetable Lecture / Lab</span>
              </span>
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-3 h-3 rounded bg-orange-100 border border-[#F58220]" />
                <span>Confirmed Student / Club Reservation</span>
              </span>
              <span className="flex items-center gap-1.5 text-gray-600">
                <span className="w-3 h-3 rounded bg-emerald-50 border border-emerald-300" />
                <span>Open / Free for Booking</span>
              </span>
            </div>

            <div className="text-[11px] text-gray-400">
              Double-booking is automatically blocked by the platform engine.
            </div>
          </div>

          {/* Weekly Interactive Grid */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm overflow-hidden">
            {/* Table Header: Days of the week */}
            <div className="grid grid-cols-6 border-b border-gray-100 bg-[#FAFAFA] text-center text-xs font-extrabold text-gray-700 py-3">
              <div className="text-gray-400 font-bold">Time</div>
              {weekDays.map((d) => (
                <div key={d.label}>
                  <div className="text-gray-900">{d.label}</div>
                  <div className="text-[10px] text-gray-400 font-normal">{d.date}</div>
                </div>
              ))}
            </div>

            {/* Timetable Rows by Hour */}
            <div className="divide-y divide-gray-100">
              {hours.map((h, hIdx) => {
                const hourNum = parseInt(h.split(':')[0], 10);
                return (
                  <div key={h} className="grid grid-cols-6 min-h-[70px]">
                    {/* Time Column */}
                    <div className="p-3 text-[11px] font-bold text-gray-400 border-r border-gray-100 bg-[#FCFCFD] flex items-center justify-center">
                      {h}
                    </div>

                    {/* Day Columns */}
                    {weekDays.map((d) => {
                      // Check academic class in this room at this day/hour
                      const matchingClass = timetable.find(
                        (tt) =>
                          tt.dayOfWeek === d.dayOfWeek &&
                          parseInt(tt.startTime.split(':')[0], 10) <= hourNum &&
                          parseInt(tt.endTime.split(':')[0], 10) > hourNum
                      );

                      // Check booking in this room
                      const matchingBooking = bookings.find((b) => {
                        const bStart = new Date(b.startTime);
                        return (
                          bStart.getDay() === d.dayOfWeek &&
                          bStart.getHours() <= hourNum &&
                          new Date(b.endTime).getHours() > hourNum
                        );
                      });

                      if (matchingClass) {
                        return (
                          <div
                            key={d.label}
                            className="p-2 border-r border-gray-100 bg-blue-50/70 border-l-2 border-l-[#1976B9] m-1 rounded-xl text-xs flex flex-col justify-between"
                          >
                            <div>
                              <span className="font-extrabold text-blue-900 block truncate">
                                {matchingClass.courseCode}: {matchingClass.courseName}
                              </span>
                              <span className="text-[10px] text-blue-700 block mt-0.5 truncate">
                                {matchingClass.instructorName} • {matchingClass.section}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold bg-blue-200/60 text-blue-800 px-1.5 py-0.5 rounded self-start">
                              Timetable ({matchingClass.startTime} - {matchingClass.endTime})
                            </span>
                          </div>
                        );
                      }

                      if (matchingBooking) {
                        return (
                          <div
                            key={d.label}
                            className="p-2 border-r border-gray-100 bg-orange-50 border-l-2 border-l-[#F58220] m-1 rounded-xl text-xs flex flex-col justify-between"
                          >
                            <div>
                              <span className="font-extrabold text-[#292929] block truncate">
                                {matchingBooking.purpose}
                              </span>
                              <span className="text-[10px] text-gray-500 block truncate">
                                Reserved • {matchingBooking.activityType}
                              </span>
                            </div>
                            <span className="text-[9px] font-bold bg-[#F58220] text-white px-1.5 py-0.5 rounded self-start">
                              {matchingBooking.status}
                            </span>
                          </div>
                        );
                      }

                      // Free slot
                      return (
                        <div
                          key={d.label}
                          onClick={handleBookSlot}
                          className="p-2 border-r border-gray-100 hover:bg-emerald-50/50 transition cursor-pointer group flex items-center justify-center m-1 rounded-xl border border-transparent hover:border-emerald-200"
                        >
                          <span className="opacity-0 group-hover:opacity-100 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-1 rounded-lg transition flex items-center gap-1">
                            <Plus className="w-3 h-3" />
                            <span>Book Free Slot</span>
                          </span>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </div>
        </main>
      </div>

      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        preselectedResource={modalResource}
        onBookingSuccess={() => fetchSchedules(selectedResourceId)}
      />
    </div>
  );
}

