'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  Trash2,
  ChevronLeft,
  ChevronRight,
  ExternalLink,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { api } from '@/lib/api';
import { formatKolkataDateTime } from '@/lib/timezone';
import { NotificationItemDTO } from '@lpu/shared';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<NotificationItemDTO[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const fetchNotifications = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    try {
      const res = await api.notifications.list({
        page,
        limit: 15,
        read: filter === 'UNREAD' ? 'UNREAD' : undefined,
        type: typeFilter !== 'ALL' ? typeFilter : undefined,
      });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
      setTotalPages(res.pagination?.totalPages || 1);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Unable to load notifications.');
    } finally {
      setIsLoading(false);
    }
  }, [page, filter, typeFilter]);

  useEffect(() => {
    fetchNotifications();
  }, [fetchNotifications]);

  const handleMarkAll = async () => {
    try {
      await api.notifications.markAllRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mark all as read.');
    }
  };

  const handleMarkOne = async (id: string) => {
    try {
      await api.notifications.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to mark notification as read.');
    }
  };

  const handleDelete = async (id: string, wasRead: boolean) => {
    try {
      await api.notifications.delete(id);
      setNotifications((prev) => prev.filter((n) => n.id !== id));
      if (!wasRead) {
        setUnreadCount((c) => Math.max(0, c - 1));
      }
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to delete notification.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      <Sidebar unreadNotificationsCount={unreadCount} />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">Notifications</span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight flex items-center gap-2">
                <span>Campus Alerts & Activity</span>
                {unreadCount > 0 && (
                  <span className="bg-[#F58220] text-white text-xs font-bold px-2.5 py-0.5 rounded-full">
                    {unreadCount} unread
                  </span>
                )}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Check-in reminders, approval notices, waitlist offers, and security alerts.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <div className="flex bg-white p-1 rounded-xl border border-gray-200 text-xs font-bold">
                <button
                  onClick={() => {
                    setFilter('ALL');
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg transition ${
                    filter === 'ALL' ? 'bg-[#F58220] text-white shadow-sm' : 'text-gray-600'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => {
                    setFilter('UNREAD');
                    setPage(1);
                  }}
                  className={`px-3 py-1 rounded-lg transition ${
                    filter === 'UNREAD' ? 'bg-[#F58220] text-white shadow-sm' : 'text-gray-600'
                  }`}
                >
                  Unread ({unreadCount})
                </button>
              </div>

              <select
                value={typeFilter}
                onChange={(e) => {
                  setTypeFilter(e.target.value);
                  setPage(1);
                }}
                aria-label="Filter by notification type"
                className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl text-xs font-bold text-gray-700 focus:outline-none"
              >
                <option value="ALL">All Types</option>
                <option value="BOOKING">Booking</option>
                <option value="APPROVAL">Approval</option>
                <option value="REMINDER">Reminder</option>
                <option value="CHECKIN">Check-In</option>
                <option value="SECURITY">Security</option>
              </select>

              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="px-3 py-1.5 bg-[#292929] hover:bg-black text-white text-xs font-bold rounded-xl flex items-center gap-1.5 transition"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
            </div>
          </div>

          {errorMsg && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 font-medium">
              {errorMsg}
            </div>
          )}

          {/* List */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-100">
            {isLoading ? (
              <div className="p-8 space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />
                ))}
              </div>
            ) : notifications.length === 0 ? (
              <div className="py-14 text-center space-y-2">
                <Bell className="w-8 h-8 text-gray-300 mx-auto" />
                <p className="text-sm font-bold text-gray-700">No notifications found</p>
                <p className="text-xs text-gray-400">
                  You&apos;re all caught up on your campus alerts.
                </p>
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition ${
                    !n.read ? 'bg-orange-50/40' : 'hover:bg-gray-50/60'
                  }`}
                >
                  <div className="space-y-1 flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-gray-100 text-gray-700">
                        {n.type}
                      </span>
                      <h3 className="text-sm font-bold text-[#292929]">{n.title}</h3>
                      {!n.read && (
                        <span className="w-2 h-2 rounded-full bg-[#F58220]" title="Unread" />
                      )}
                    </div>
                    <p className="text-xs text-gray-600">{n.message}</p>
                    <div className="text-[11px] text-gray-400">
                      {formatKolkataDateTime(n.createdAt)} IST
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    {n.link && (
                      <Link
                        href={n.link}
                        className="px-2.5 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#1976B9] text-xs font-bold rounded-lg flex items-center gap-1 transition"
                      >
                        <span>Open</span>
                        <ExternalLink className="w-3 h-3" />
                      </Link>
                    )}
                    {!n.read && (
                      <button
                        onClick={() => handleMarkOne(n.id)}
                        className="px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-[#F58220] text-xs font-bold rounded-lg transition"
                      >
                        Mark read
                      </button>
                    )}
                    <button
                      onClick={() => handleDelete(n.id, n.read)}
                      aria-label="Delete notification"
                      className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 transition"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs text-gray-500">
              <span>
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Prev
                </button>
                <button
                  disabled={page >= totalPages}
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-bold disabled:opacity-40 flex items-center gap-1"
                >
                  Next <ChevronRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}
