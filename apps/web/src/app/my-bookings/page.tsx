'use client';

import React, { useState, useEffect, useCallback } from 'react';
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
  ChevronLeft,
  RefreshCw,
  Clock3,
  Repeat,
  PlusCircle,
  LogOut,
  CalendarRange,
  Users,
  Search,
  Sparkles,
  Timer,
  Check,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { RescheduleModal } from '@/components/booking/RescheduleModal';
import { CancelBookingModal } from '@/components/booking/CancelBookingModal';
import { ExtendBookingModal } from '@/components/booking/ExtendBookingModal';
import { EndEarlyModal } from '@/components/booking/EndEarlyModal';
import { BookingQrModal } from '@/components/booking/BookingQrModal';
import { api } from '@/lib/api';
import { BookingListItemDTO, MyBookingsTab, WaitlistEntryDTO, WaitlistStatus } from '@lpu/shared';
import { formatKolkataDateTime, formatKolkataTimeRange } from '@/lib/timezone';

function OfferCountdownTimer({
  offerExpiresAt,
  onExpire,
}: {
  offerExpiresAt: string;
  onExpire: () => void;
}) {
  const [remaining, setRemaining] = useState<number>(() =>
    Math.max(0, Math.floor((new Date(offerExpiresAt).getTime() - Date.now()) / 1000))
  );

  useEffect(() => {
    const timer = setInterval(() => {
      const diffSec = Math.max(0, Math.floor((new Date(offerExpiresAt).getTime() - Date.now()) / 1000));
      setRemaining(diffSec);
      if (diffSec <= 0) {
        clearInterval(timer);
        onExpire();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [offerExpiresAt, onExpire]);

  const mins = Math.floor(remaining / 60);
  const secs = remaining % 60;

  if (remaining <= 0) {
    return <span className="text-red-500 font-extrabold">Expired</span>;
  }

  return (
    <span className="font-mono font-extrabold text-[#F58220] tabular-nums">
      {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
    </span>
  );
}

export default function MyBookingsPage() {
  const [activeTab, setActiveTab] = useState<MyBookingsTab>('UPCOMING');
  const [bookings, setBookings] = useState<BookingListItemDTO[]>([]);
  const [waitlistEntries, setWaitlistEntries] = useState<WaitlistEntryDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successToast, setSuccessToast] = useState<string | null>(null);

  // Pagination State
  const [page, setPage] = useState(1);
  const [limit] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [tabCounts, setTabCounts] = useState({
    upcoming: 0,
    pending: 0,
    past: 0,
    cancelled: 0,
    waitlist: 0,
  });

  // Modal target states
  const [rescheduleTarget, setRescheduleTarget] = useState<BookingListItemDTO | null>(null);
  const [cancelTarget, setCancelTarget] = useState<BookingListItemDTO | null>(null);
  const [extendTarget, setExtendTarget] = useState<BookingListItemDTO | null>(null);
  const [endEarlyTarget, setEndEarlyTarget] = useState<BookingListItemDTO | null>(null);
  const [qrTarget, setQrTarget] = useState<BookingListItemDTO | null>(null);

  // Waitlist action states
  const [isAcceptingOffer, setIsAcceptingOffer] = useState<string | null>(null);
  const [isLeavingWaitlist, setIsLeavingWaitlist] = useState<string | null>(null);

  const fetchBookings = useCallback(async (targetTab = activeTab, targetPage = page) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.bookings.my({
        tab: targetTab,
        page: targetPage,
        limit,
      });

      setBookings(res.bookings || []);
      setTotalCount(res.pagination.total);
      setTotalPages(res.pagination.totalPages || 1);
      if (res.tabCounts) {
        setTabCounts((prev) => ({
          ...prev,
          upcoming: res.tabCounts.upcoming,
          pending: res.tabCounts.pending,
          past: res.tabCounts.past,
          cancelled: res.tabCounts.cancelled,
          waitlist: res.tabCounts.waitlist ?? prev.waitlist,
        }));
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load bookings. Please try again.');
    } finally {
      setIsLoading(false);
    }
  }, [activeTab, page, limit]);

  const fetchWaitlist = useCallback(async (targetPage = page) => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const res = await api.waitlist.list({
        page: targetPage,
        limit,
      });

      setWaitlistEntries(res.entries || []);
      setTotalCount(res.pagination.total);
      setTotalPages(res.pagination.totalPages || 1);
      setTabCounts((prev) => ({
        ...prev,
        waitlist: res.pagination.total,
      }));
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to load waitlist entries.');
    } finally {
      setIsLoading(false);
    }
  }, [page, limit]);

  useEffect(() => {
    if (activeTab === 'WAITLIST') {
      fetchWaitlist(page);
    } else {
      fetchBookings(activeTab, page);
    }
  }, [activeTab, page, fetchBookings, fetchWaitlist]);

  // Switch tab and reset page to 1
  const handleTabSwitch = (newTab: MyBookingsTab) => {
    if (newTab !== activeTab) {
      setActiveTab(newTab);
      setPage(1);
    }
  };

  const showNotification = (msg: string) => {
    setSuccessToast(msg);
    setTimeout(() => {
      setSuccessToast(null);
    }, 4500);
  };

  // Optimistic Handlers for Bookings
  const handleRescheduleSuccess = (updated: BookingListItemDTO, message: string) => {
    showNotification(message);
    fetchBookings(activeTab, page);
  };

  const handleCancelSuccess = (bookingId: string, message: string) => {
    showNotification(message);
    setBookings((prev) =>
      prev.map((b) => (b.id === bookingId ? { ...b, status: 'CANCELLED' } : b))
    );
    setTabCounts((prev) => ({
      ...prev,
      upcoming: Math.max(0, prev.upcoming - 1),
      cancelled: prev.cancelled + 1,
    }));
    fetchBookings(activeTab, page);
  };

  const handleExtendSuccess = (updated: BookingListItemDTO, message: string) => {
    showNotification(message);
    setBookings((prev) =>
      prev.map((b) => (b.id === updated.id ? updated : b))
    );
  };

  const handleEndEarlySuccess = (updated: BookingListItemDTO, message: string) => {
    showNotification(message);
    setBookings((prev) =>
      prev.map((b) => (b.id === updated.id ? updated : b))
    );
    setTabCounts((prev) => ({
      ...prev,
      upcoming: Math.max(0, prev.upcoming - 1),
      past: prev.past + 1,
    }));
    fetchBookings(activeTab, page);
  };

  // Waitlist Handlers
  const handleAcceptOffer = async (id: string) => {
    setIsAcceptingOffer(id);
    try {
      const res = await api.waitlist.accept(id);
      showNotification(res.message || 'Waitlist offer accepted! Your reservation is confirmed.');
      fetchWaitlist(page);
    } catch (err: any) {
      alert(err.message || 'Failed to accept waitlist offer.');
      fetchWaitlist(page);
    } finally {
      setIsAcceptingOffer(null);
    }
  };

  const handleLeaveWaitlist = async (id: string) => {
    if (!confirm('Are you sure you want to withdraw from this waitlist?')) return;
    setIsLeavingWaitlist(id);
    try {
      const res = await api.waitlist.leave(id);
      showNotification(res.message || 'Withdrawn from waitlist.');
      fetchWaitlist(page);
    } catch (err: any) {
      alert(err.message || 'Failed to withdraw from waitlist.');
    } finally {
      setIsLeavingWaitlist(null);
    }
  };

  // Status Badge Helper for Bookings
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'CONFIRMED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-green-100 text-green-800 border border-green-200">
            <CheckCircle2 className="w-3 h-3 text-green-600" /> Confirmed
          </span>
        );
      case 'CHECKED_IN':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-emerald-100 text-emerald-800 border border-emerald-300 animate-pulse">
            <Clock className="w-3 h-3 text-emerald-600" /> Checked In • Live
          </span>
        );
      case 'PENDING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
            <Clock3 className="w-3 h-3 text-amber-600" /> Pending Approval
          </span>
        );
      case 'COMPLETED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100 text-blue-800 border border-blue-200">
            <CheckCircle2 className="w-3 h-3 text-blue-600" /> Completed
          </span>
        );
      case 'CANCELLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-red-100 text-red-800 border border-red-200">
            <XCircle className="w-3 h-3 text-red-600" /> Cancelled
          </span>
        );
      case 'NO_SHOW':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700 border border-gray-300">
            <AlertCircle className="w-3 h-3 text-gray-500" /> No Show
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-700">
            {status}
          </span>
        );
    }
  };

  // Status Badge Helper for Waitlist
  const getWaitlistStatusBadge = (status: WaitlistStatus) => {
    switch (status) {
      case 'WAITING':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-50 text-[#1976B9] border border-blue-200">
            <Clock className="w-3 h-3" /> Waiting in Queue
          </span>
        );
      case 'OFFERED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-extrabold bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] animate-pulse">
            <Sparkles className="w-3 h-3" /> Active Offer Available!
          </span>
        );
      case 'EXPIRED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-500 border border-gray-200">
            <XCircle className="w-3 h-3" /> Offer Expired
          </span>
        );
      case 'FULFILLED':
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
            <CheckCircle2 className="w-3 h-3" /> Accepted & Booked
          </span>
        );
      case 'WITHDRAWN':
      default:
        return (
          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-gray-100 text-gray-400 border border-gray-200">
            <Trash2 className="w-3 h-3" /> Withdrawn
          </span>
        );
    }
  };

  return (
    <div className="flex h-screen bg-[#F5F5F5] overflow-hidden">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <Navbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Toast Notification */}
          {successToast && (
            <div className="fixed top-5 right-5 z-50 bg-[#292929] text-white px-4 py-3 rounded-2xl shadow-xl flex items-center gap-3 border border-gray-700 animate-in fade-in slide-in-from-top-2">
              <CheckCircle2 className="w-5 h-5 text-[#F58220]" />
              <span className="text-xs font-semibold">{successToast}</span>
            </div>
          )}

          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">My Bookings & Waitlist</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#292929] tracking-tight">
                My Bookings & Waitlist
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-0.5">
                Manage upcoming sessions, track pending approvals, and accept waitlist offers.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <Link
                href="/calendar"
                className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5"
              >
                <CalendarRange className="w-4 h-4 text-[#F58220]" />
                <span>Availability Calendar</span>
              </Link>
              <Link
                href="/resources"
                className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-1.5"
              >
                <Plus className="w-4 h-4" />
                <span>New Reservation</span>
              </Link>
            </div>
          </div>

          {/* Navigation Tabs */}
          <div className="flex border-b border-gray-200/80 overflow-x-auto scrollbar-none gap-2">
            {[
              { id: 'UPCOMING' as MyBookingsTab, label: 'Upcoming', count: tabCounts.upcoming },
              { id: 'PENDING' as MyBookingsTab, label: 'Pending Approval', count: tabCounts.pending },
              { id: 'PAST' as MyBookingsTab, label: 'Past Sessions', count: tabCounts.past },
              { id: 'CANCELLED' as MyBookingsTab, label: 'Cancelled', count: tabCounts.cancelled },
              { id: 'WAITLIST' as MyBookingsTab, label: 'Waitlist', count: tabCounts.waitlist },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => handleTabSwitch(tab.id)}
                className={`flex items-center gap-2 py-3 px-4 border-b-2 text-xs font-bold transition whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'border-[#F58220] text-[#F58220]'
                    : 'border-transparent text-gray-500 hover:text-gray-800 hover:border-gray-300'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`text-[10px] font-extrabold px-1.5 py-0.5 rounded-full ${
                    activeTab === tab.id
                      ? 'bg-[#F58220]/10 text-[#F58220]'
                      : 'bg-gray-200/70 text-gray-600'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            ))}
          </div>

          {/* Error Banner */}
          {errorMessage && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                <span>{errorMessage}</span>
              </div>
              <button
                onClick={() => (activeTab === 'WAITLIST' ? fetchWaitlist(page) : fetchBookings(activeTab, page))}
                className="px-3 py-1 bg-white border border-red-300 text-red-700 rounded-lg text-xs font-bold hover:bg-red-50 transition"
              >
                Retry
              </button>
            </div>
          )}

          {/* Content Area */}
          {isLoading ? (
            <div className="space-y-3">
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="bg-white rounded-2xl p-5 border border-gray-100 shadow-sm animate-pulse space-y-3"
                >
                  <div className="h-4 bg-gray-200 rounded w-1/4" />
                  <div className="h-3 bg-gray-100 rounded w-1/2" />
                  <div className="h-8 bg-gray-50 rounded w-full" />
                </div>
              ))}
            </div>
          ) : activeTab === 'WAITLIST' ? (
            /* Waitlist View */
            waitlistEntries.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center space-y-4">
                <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto text-gray-400">
                  <Clock className="w-6 h-6" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-800">No waitlist entries found</h3>
                  <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                    You are not currently in line for any booked slots. Browse the calendar to join the waitlist for occupied facilities.
                  </p>
                </div>
                <Link
                  href="/calendar"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition"
                >
                  <CalendarRange className="w-4 h-4" />
                  <span>Check Availability Calendar</span>
                </Link>
              </div>
            ) : (
              <div className="space-y-4">
                {waitlistEntries.map((entry) => {
                  const isOffered = entry.status === 'OFFERED';
                  const isWaiting = entry.status === 'WAITING';

                  return (
                    <div
                      key={entry.id}
                      className={`bg-white rounded-2xl p-5 sm:p-6 border shadow-sm transition space-y-4 ${
                        isOffered
                          ? 'border-[#FED7AA] bg-orange-50/20 ring-1 ring-[#F58220]/20'
                          : 'border-gray-200/80 hover:shadow-md'
                      }`}
                    >
                      {/* Top Row: Venue, Queue position & Status Badge */}
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <h2 className="text-base font-extrabold text-[#292929]">
                              {entry.resource?.name || 'Classroom / Lab'}
                            </h2>
                            {getWaitlistStatusBadge(entry.status)}
                            {isWaiting && entry.queuePosition && (
                              <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-blue-100/70 text-[#1976B9] border border-blue-200">
                                #{entry.queuePosition} in Queue
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-gray-500 flex items-center gap-1.5">
                            <MapPin className="w-3.5 h-3.5 text-[#F58220] shrink-0" />
                            <span>
                              {entry.resource?.building} • {entry.resource?.floor || 'Ground Floor'} • Capacity: {entry.resource?.capacity}
                            </span>
                          </p>
                        </div>

                        {/* Active Offer Countdown Indicator */}
                        {isOffered && entry.offerExpiresAt && (
                          <div className="flex items-center gap-2 p-2.5 bg-[#FFF4EA] border border-[#FED7AA] rounded-xl text-xs">
                            <Timer className="w-4 h-4 text-[#F58220] shrink-0" />
                            <div>
                              <div className="text-[10px] uppercase font-bold text-gray-500">Time to Accept</div>
                              <OfferCountdownTimer
                                offerExpiresAt={entry.offerExpiresAt}
                                onExpire={() => fetchWaitlist(page)}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Middle Details Box */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 bg-[#F5F5F5]/70 rounded-xl border border-gray-200/60 text-xs text-gray-600">
                        <div className="flex items-center gap-2">
                          <Calendar className="w-4 h-4 text-[#F58220] shrink-0" />
                          <div>
                            <div className="text-[10px] uppercase font-bold text-gray-400">Requested Slot</div>
                            <div className="font-semibold text-gray-800">
                              {formatKolkataDateTime(entry.startTime)}
                            </div>
                          </div>
                        </div>

                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-[#1976B9] shrink-0" />
                          <div>
                            <div className="text-[10px] uppercase font-bold text-gray-400">Duration Range</div>
                            <div className="font-semibold text-gray-800">
                              {formatKolkataTimeRange(entry.startTime, entry.endTime)}
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Action Bar */}
                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                        <div className="text-[11px] text-gray-400">
                          Joined queue on {new Date(entry.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {isOffered && (
                            <>
                              <button
                                onClick={() => handleAcceptOffer(entry.id)}
                                disabled={isAcceptingOffer === entry.id}
                                className="inline-flex items-center gap-1.5 px-4 py-1.5 bg-[#F58220] hover:bg-[#E06D0C] text-white rounded-xl text-xs font-bold transition shadow-sm disabled:opacity-50"
                              >
                                {isAcceptingOffer === entry.id ? (
                                  <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Check className="w-3.5 h-3.5" />
                                )}
                                <span>Accept Offer & Reserve</span>
                              </button>
                              <button
                                onClick={() => handleLeaveWaitlist(entry.id)}
                                disabled={isLeavingWaitlist === entry.id}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-xs font-bold transition disabled:opacity-50"
                              >
                                <XCircle className="w-3.5 h-3.5 text-red-500" />
                                <span>Decline</span>
                              </button>
                            </>
                          )}

                          {isWaiting && (
                            <button
                              onClick={() => handleLeaveWaitlist(entry.id)}
                              disabled={isLeavingWaitlist === entry.id}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-bold transition disabled:opacity-50"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Leave Waitlist</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Server-Side Pagination Bar for Waitlist */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm text-xs">
                    <div className="text-gray-500 font-medium">
                      Showing {(page - 1) * limit + 1} - {Math.min(page * limit, totalCount)} of {totalCount} waitlist entries
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        disabled={page <= 1}
                        className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                      >
                        <ChevronLeft className="w-4 h-4 text-gray-600" />
                      </button>
                      <span className="font-bold text-gray-700 px-2">
                        Page {page} of {totalPages}
                      </span>
                      <button
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        disabled={page >= totalPages}
                        className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                      >
                        <ChevronRight className="w-4 h-4 text-gray-600" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : bookings.length === 0 ? (
            /* Bookings Empty State */
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-12 text-center space-y-4">
              <div className="w-12 h-12 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto text-gray-400">
                <CalendarRange className="w-6 h-6" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-gray-800">
                  No {activeTab.toLowerCase()} bookings found
                </h3>
                <p className="text-xs text-gray-500 mt-1 max-w-sm mx-auto">
                  {activeTab === 'UPCOMING'
                    ? "You don't have any upcoming reservations scheduled. Browse campus resources to reserve a room."
                    : activeTab === 'PENDING'
                    ? 'No reservations currently awaiting departmental approval.'
                    : activeTab === 'PAST'
                    ? 'You have not completed any bookings yet.'
                    : 'No cancelled or rejected reservations recorded.'}
                </p>
              </div>
              {activeTab === 'UPCOMING' && (
                <Link
                  href="/resources"
                  className="inline-flex items-center gap-1.5 px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition"
                >
                  <Plus className="w-4 h-4" />
                  <span>Discover Venues</span>
                </Link>
              )}
            </div>
          ) : (
            /* Bookings List */
            <div className="space-y-4">
              {bookings.map((booking) => {
                const isRecurring = Boolean(booking.series || booking.seriesId);
                const elig = booking.eligibility;

                return (
                  <div
                    key={booking.id}
                    className="bg-white rounded-2xl p-5 sm:p-6 border border-gray-200/80 shadow-sm hover:shadow-md transition space-y-4"
                  >
                    {/* Top Row: Venue, Number & Status Badge */}
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <h2 className="text-base font-extrabold text-[#292929]">
                            {booking.resource?.name || 'Classroom / Lab'}
                          </h2>
                          {getStatusBadge(booking.status)}
                          {isRecurring && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-bold bg-orange-50 text-[#F58220] border border-orange-200">
                              <Repeat className="w-3 h-3" /> Recurring Series
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-500 flex items-center gap-1.5">
                          <MapPin className="w-3.5 h-3.5 text-[#F58220] shrink-0" />
                          <span>
                            {booking.resource?.building} • {booking.resource?.floor || 'Ground Floor'} • Capacity: {booking.resource?.capacity}
                          </span>
                        </p>
                      </div>

                      <div className="text-left sm:text-right text-xs">
                        <div className="font-mono font-bold text-gray-700">
                          #{booking.bookingNumber}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          Booked on {new Date(booking.createdAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' })}
                        </div>
                      </div>
                    </div>

                    {/* Middle Details Box */}
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 bg-[#F5F5F5]/70 rounded-xl border border-gray-200/60 text-xs text-gray-600">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-[#F58220] shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-gray-400">Date & Slot</div>
                          <div className="font-semibold text-gray-800">
                            {formatKolkataDateTime(booking.startTime)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-[#1976B9] shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-gray-400">Time Range</div>
                          <div className="font-semibold text-gray-800">
                            {formatKolkataTimeRange(booking.startTime, booking.endTime)}
                          </div>
                        </div>
                      </div>

                      <div className="flex items-center gap-2">
                        <Users className="w-4 h-4 text-emerald-600 shrink-0" />
                        <div>
                          <div className="text-[10px] uppercase font-bold text-gray-400">Attendance & Activity</div>
                          <div className="font-semibold text-gray-800">
                            {booking.expectedAttendance} attendees • {booking.activityType.replace(/_/g, ' ')}
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Purpose / Cancellation / Approval Notes */}
                    {booking.purpose && (
                      <div className="text-xs text-gray-600">
                        <span className="font-bold text-gray-700">Purpose: </span>
                        <span>{booking.purpose}</span>
                      </div>
                    )}

                    {booking.rejectionReason && (
                      <div className="p-3 bg-red-50 border border-red-200/80 rounded-xl text-xs text-red-700">
                        <span className="font-bold">Cancellation / Rejection Note: </span>
                        <span>{booking.rejectionReason}</span>
                      </div>
                    )}

                    {booking.approvalNotes && booking.status === 'PENDING' && (
                      <div className="p-3 bg-amber-50 border border-amber-200/80 rounded-xl text-xs text-amber-800">
                        <span className="font-bold">Pending Review Note: </span>
                        <span>{booking.approvalNotes}</span>
                      </div>
                    )}

                    {/* Action Controls Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-gray-100">
                      {/* Check-in Token / QR & Add to Calendar */}
                      <div className="flex flex-wrap items-center gap-2">
                        {elig?.canShowQr && (
                          <button
                            onClick={() => setQrTarget(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
                          >
                            <QrCode className="w-3.5 h-3.5 text-[#F58220]" />
                            <span>Show Check-In QR</span>
                          </button>
                        )}
                        <a
                          href={`/api/bookings/${booking.id}/calendar.ics`}
                          download={`${booking.bookingNumber}.ics`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1976B9] rounded-xl text-xs font-bold transition"
                        >
                          <Calendar className="w-3.5 h-3.5" />
                          <span>Add to Calendar (.ics)</span>
                        </a>
                      </div>

                      {/* Action Buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        {/* Extend Session */}
                        {elig?.canExtend && (
                          <button
                            onClick={() => setExtendTarget(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[#1976B9] rounded-xl text-xs font-bold transition"
                          >
                            <PlusCircle className="w-3.5 h-3.5" />
                            <span>Extend</span>
                          </button>
                        )}

                        {/* End Early */}
                        {elig?.canEndEarly && (
                          <button
                            onClick={() => setEndEarlyTarget(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 border border-emerald-200 text-emerald-800 rounded-xl text-xs font-bold transition"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>End Early</span>
                          </button>
                        )}

                        {/* Reschedule */}
                        {elig?.canReschedule && (
                          <button
                            onClick={() => setRescheduleTarget(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-50 hover:bg-gray-100 border border-gray-200 text-gray-700 rounded-xl text-xs font-bold transition"
                          >
                            <RefreshCw className="w-3.5 h-3.5 text-[#F58220]" />
                            <span>Reschedule</span>
                          </button>
                        )}

                        {/* Cancel */}
                        {elig?.canCancel ? (
                          <button
                            onClick={() => setCancelTarget(booking)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-red-50 hover:bg-red-100 border border-red-200 text-red-700 rounded-xl text-xs font-bold transition"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Cancel</span>
                          </button>
                        ) : elig?.cancellationCutoffPassed && booking.status !== 'CANCELLED' && booking.status !== 'COMPLETED' ? (
                          <span
                            className="text-[11px] text-gray-400 italic"
                            title={`Cutoff (${elig.cancellationCutoffMinutes}m) passed`}
                          >
                            Cancellation closed
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Server-Side Pagination Bar */}
              {totalPages > 1 && (
                <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-gray-100 shadow-sm text-xs">
                  <div className="text-gray-500 font-medium">
                    Showing {(page - 1) * limit + 1} - {Math.min(page * limit, totalCount)} of {totalCount} reservations
                  </div>

                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setPage((p) => Math.max(1, p - 1))}
                      disabled={page <= 1}
                      className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                      title="Previous Page"
                    >
                      <ChevronLeft className="w-4 h-4 text-gray-600" />
                    </button>
                    <span className="font-bold text-gray-700 px-2">
                      Page {page} of {totalPages}
                    </span>
                    <button
                      onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                      disabled={page >= totalPages}
                      className="p-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-40 transition"
                      title="Next Page"
                    >
                      <ChevronRight className="w-4 h-4 text-gray-600" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </main>
      </div>

      {/* Lifecycle Action Modals */}
      <RescheduleModal
        isOpen={Boolean(rescheduleTarget)}
        onClose={() => setRescheduleTarget(null)}
        booking={rescheduleTarget}
        onSuccess={handleRescheduleSuccess}
      />

      <CancelBookingModal
        isOpen={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        booking={cancelTarget}
        onSuccess={handleCancelSuccess}
      />

      <ExtendBookingModal
        isOpen={Boolean(extendTarget)}
        onClose={() => setExtendTarget(null)}
        booking={extendTarget}
        onSuccess={handleExtendSuccess}
      />

      <EndEarlyModal
        isOpen={Boolean(endEarlyTarget)}
        onClose={() => setEndEarlyTarget(null)}
        booking={endEarlyTarget}
        onSuccess={handleEndEarlySuccess}
      />

      <BookingQrModal
        isOpen={Boolean(qrTarget)}
        onClose={() => setQrTarget(null)}
        booking={qrTarget}
      />
    </div>
  );
}
