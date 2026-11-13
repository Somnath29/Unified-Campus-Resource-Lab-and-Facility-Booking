'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Calendar,
  Clock,
  MapPin,
  QrCode,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Trash2,
  Plus,
  ChevronRight,
  Filter,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { CheckInModal } from '@/components/booking/CheckInModal';
import { BookingModal } from '@/components/booking/BookingModal';
import { api } from '@/lib/api';
import { BookingDTO, BookingStatus } from '@lpu/shared';

export default function MyBookingsPage() {
  const [bookings, setBookings] = useState<BookingDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('ALL');

  // Modals
  const [isCheckInModalOpen, setIsCheckInModalOpen] = useState(false);
  const [selectedBookingForCheckIn, setSelectedBookingForCheckIn] = useState<BookingDTO | null>(null);
  const [isBookingModalOpen, setIsBookingModalOpen] = useState(false);

  useEffect(() => {
    fetchUserBookings();
  }, []);

  const fetchUserBookings = async () => {
    setIsLoading(true);
    try {
      const res = await api.bookings.list({ myOnly: 'true' });
      setBookings(res.bookings || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleCancelBooking = async (id: string) => {
    if (confirm('Are you sure you want to cancel this reservation? The slot will be released back to other students.')) {
      try {
        await api.bookings.cancel(id, 'Cancelled by student');
        fetchUserBookings();
      } catch (err: any) {
        alert(err.message || 'Failed to cancel booking.');
      }
    }
  };

  const handleOpenCheckIn = (b: BookingDTO) => {
    setSelectedBookingForCheckIn(b);
    setIsCheckInModalOpen(true);
  };

  const filteredBookings = bookings.filter((b) => {
    if (filterStatus === 'ALL') return true;
    return b.status === filterStatus;
  });

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
                <span className="text-[#F58220] font-semibold">My Bookings</span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
                My Reservations & Activity
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Manage upcoming sessions, verify venue check-ins, and inspect booking approvals.
              </p>
            </div>

            <button
              onClick={() => setIsBookingModalOpen(true)}
              className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
            >
              <Plus className="w-4 h-4 stroke-[2.5]" />
              <span>New Reservation</span>
            </button>
          </div>

          {/* Filter Tabs */}
          <div className="flex items-center gap-2 overflow-x-auto pb-1 text-xs font-bold">
            {['ALL', 'CONFIRMED', 'PENDING', 'CHECKED_IN', 'NO_SHOW', 'COMPLETED', 'CANCELLED'].map(
              (st) => (
                <button
                  key={st}
                  onClick={() => setFilterStatus(st)}
                  className={`px-3 py-1.5 rounded-xl transition shrink-0 ${
                    filterStatus === st
                      ? 'bg-[#F58220] text-white shadow-sm'
                      : 'bg-white text-gray-600 hover:bg-gray-100 border border-gray-200'
                  }`}
                >
                  {st.replace('_', ' ')}
                </button>
              )
            )}
          </div>

          {/* Bookings List */}
          {isLoading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-xs text-gray-400">Loading your reservations...</div>
            </div>
          ) : filteredBookings.length === 0 ? (
            <div className="bg-white p-12 rounded-3xl border border-gray-100 text-center space-y-3">
              <Calendar className="w-12 h-12 text-gray-300 mx-auto" />
              <div className="text-sm font-bold text-gray-800">No reservations found</div>
              <div className="text-xs text-gray-500 max-w-sm mx-auto">
                You do not have any bookings matching this filter. Explore campus facilities and
                reserve your room today.
              </div>
              <button
                onClick={() => setIsBookingModalOpen(true)}
                className="mt-2 px-4 py-2 bg-[#F58220] text-white text-xs font-bold rounded-xl shadow"
              >
                Book a Resource Now
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredBookings.map((b) => {
                const isConfirmedOrCheckedIn =
                  b.status === 'CONFIRMED' || b.status === 'CHECKED_IN';
                const isPending = b.status === 'PENDING';
                const isNoShow = b.status === 'NO_SHOW';

                return (
                  <div
                    key={b.id}
                    className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div className="flex items-start sm:items-center gap-4">
                      <img
                        src={
                          b.resource?.imageUrl ||
                          'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=600&q=80'
                        }
                        alt={b.resource?.name}
                        className="w-16 h-16 rounded-2xl object-cover shrink-0 border border-gray-200"
                      />
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-extrabold text-base text-[#292929]">
                            {b.resource?.name}
                          </span>
                          <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                            {b.bookingNumber}
                          </span>
                        </div>

                        <div className="flex items-center gap-4 text-xs text-gray-500 flex-wrap">
                          <span className="flex items-center gap-1 font-semibold text-gray-700">
                            <Clock className="w-3.5 h-3.5 text-gray-400" />
                            {new Date(b.startTime).toLocaleDateString()} (
                            {new Date(b.startTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}{' '}
                            -{' '}
                            {new Date(b.endTime).toLocaleTimeString([], {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                            )
                          </span>
                          <span className="flex items-center gap-1">
                            <MapPin className="w-3.5 h-3.5 text-gray-400" />
                            {b.resource?.building}
                          </span>
                        </div>

                        <div className="text-xs text-gray-600">
                          <span className="font-medium text-gray-400">Purpose: </span>
                          <span>{b.purpose}</span>
                        </div>

                        {b.approvalNotes && (
                          <div className="text-[11px] text-blue-700 bg-blue-50/70 px-2 py-0.5 rounded max-w-lg mt-1">
                            ℹ️ {b.approvalNotes}
                          </div>
                        )}
                        {b.rejectionReason && (
                          <div className="text-[11px] text-red-700 bg-red-50 px-2 py-0.5 rounded max-w-lg mt-1">
                            ⚠️ {b.rejectionReason}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Right Status & Actions */}
                    <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-gray-100">
                      {/* Status Badge */}
                      <div>
                        {b.status === 'CONFIRMED' && (
                          <span className="text-xs font-bold text-emerald-800 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                            <span>Confirmed</span>
                          </span>
                        )}
                        {b.status === 'CHECKED_IN' && (
                          <span className="text-xs font-bold text-blue-800 bg-blue-50 border border-blue-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                            <CheckCircle2 className="w-3.5 h-3.5 text-blue-600" />
                            <span>Checked In</span>
                          </span>
                        )}
                        {b.status === 'PENDING' && (
                          <span className="text-xs font-bold text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                            <span className="w-2 h-2 rounded-full bg-amber-500" />
                            <span>Pending Approval</span>
                          </span>
                        )}
                        {b.status === 'NO_SHOW' && (
                          <span className="text-xs font-bold text-red-800 bg-red-50 border border-red-200 px-3 py-1 rounded-full flex items-center gap-1.5">
                            <AlertCircle className="w-3.5 h-3.5 text-red-600" />
                            <span>No-Show (Auto Released)</span>
                          </span>
                        )}
                        {b.status === 'CANCELLED' && (
                          <span className="text-xs font-bold text-gray-600 bg-gray-100 border border-gray-200 px-3 py-1 rounded-full">
                            Cancelled
                          </span>
                        )}
                      </div>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2">
                        {isConfirmedOrCheckedIn && (
                          <button
                            onClick={() => handleOpenCheckIn(b)}
                            className="px-3 py-1.5 bg-[#FFF4EA] hover:bg-[#F58220] hover:text-white text-[#F58220] border border-[#FED7AA] text-xs font-bold rounded-xl transition flex items-center gap-1.5 shadow-sm"
                          >
                            <QrCode className="w-3.5 h-3.5" />
                            <span>QR Check-In ({b.checkInToken})</span>
                          </button>
                        )}

                        {(isConfirmedOrCheckedIn || isPending) && (
                          <button
                            onClick={() => handleCancelBooking(b.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
                            title="Cancel Booking"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </main>
      </div>

      <CheckInModal
        isOpen={isCheckInModalOpen}
        onClose={() => setIsCheckInModalOpen(false)}
        booking={selectedBookingForCheckIn}
        onCheckInUpdated={() => fetchUserBookings()}
      />

      <BookingModal
        isOpen={isBookingModalOpen}
        onClose={() => setIsBookingModalOpen(false)}
        onBookingSuccess={() => fetchUserBookings()}
      />
    </div>
  );
}

