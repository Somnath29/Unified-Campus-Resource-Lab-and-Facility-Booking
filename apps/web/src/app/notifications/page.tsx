'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Bell,
  Check,
  Calendar,
  Clock,
  ShieldCheck,
  AlertTriangle,
  Info,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { api } from '@/lib/api';

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [filter, setFilter] = useState<'ALL' | 'UNREAD'>('ALL');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    fetchNotifications();
  }, []);

  const fetchNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await api.notifications.list();
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMarkAll = async () => {
    try {
      await api.notifications.markAllRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const handleMarkOne = async (id: string) => {
    try {
      await api.notifications.markRead(id);
      setNotifications((prev) =>
        prev.map((n) => (n.id === id ? { ...n, read: true } : n))
      );
      setUnreadCount((c) => Math.max(0, c - 1));
    } catch (err) {
      console.error(err);
    }
  };

  const filtered = notifications.filter((n) => {
    if (filter === 'UNREAD') return !n.read;
    return true;
  });

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
                  <span className="bg-[#F58220] text-white text-xs font-bold px-2 py-0.5 rounded-full">
                    {unreadCount} new
                  </span>
                )}
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Check-in reminders, approval notices, and schedule updates.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <div className="flex bg-white p-1 rounded-xl border border-gray-200 text-xs font-bold">
                <button
                  onClick={() => setFilter('ALL')}
                  className={`px-3 py-1 rounded-lg transition ${
                    filter === 'ALL'
                      ? 'bg-[#F58220] text-white shadow-sm'
                      : 'text-gray-600'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilter('UNREAD')}
                  className={`px-3 py-1 rounded-lg transition ${
                    filter === 'UNREAD'
                      ? 'bg-[#F58220] text-white shadow-sm'
                      : 'text-gray-600'
                  }`}
                >
                  Unread ({unreadCount})
                </button>
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={handleMarkAll}
                  className="px-3 py-1.5 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 transition flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5 text-[#F58220]" />
                  <span>Mark All Read</span>
                </button>
              )}
            </div>
          </div>

          {/* List */}
          {isLoading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-xs text-gray-400">Loading alerts...</div>
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-white p-16 rounded-3xl border border-gray-100 text-center space-y-2">
              <Bell className="w-10 h-10 text-gray-300 mx-auto" />
              <div className="text-sm font-bold text-gray-800">No alerts to display</div>
              <div className="text-xs text-gray-400">You are all caught up on campus notices.</div>
            </div>
          ) : (
            <div className="bg-white rounded-3xl border border-gray-100 shadow-sm divide-y divide-gray-100 overflow-hidden">
              {filtered.map((n) => (
                <div
                  key={n.id}
                  onClick={() => !n.read && handleMarkOne(n.id)}
                  className={`p-4 sm:p-5 flex items-start justify-between gap-4 transition cursor-pointer hover:bg-gray-50 ${
                    !n.read ? 'bg-orange-50/30' : ''
                  }`}
                >
                  <div className="flex items-start gap-3.5">
                    <div
                      className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        n.type === 'CHECKIN'
                          ? 'bg-blue-100 text-blue-700'
                          : n.type === 'APPROVAL'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-orange-100 text-[#F58220]'
                      }`}
                    >
                      {n.type === 'CHECKIN' ? (
                        <Clock className="w-4 h-4" />
                      ) : n.type === 'APPROVAL' ? (
                        <ShieldCheck className="w-4 h-4" />
                      ) : (
                        <Calendar className="w-4 h-4" />
                      )}
                    </div>

                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-extrabold text-sm text-gray-900">{n.title}</span>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-[#F58220] shrink-0" />
                        )}
                      </div>
                      <p className="text-xs text-gray-600 leading-relaxed">{n.message}</p>
                      <div className="text-[10px] text-gray-400 font-medium">
                        {new Date(n.createdAt).toLocaleDateString()} at{' '}
                        {new Date(n.createdAt).toLocaleTimeString([], {
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </div>
                    </div>
                  </div>

                  {n.link && (
                    <Link
                      href={n.link}
                      className="text-xs font-bold text-[#F58220] hover:underline shrink-0"
                    >
                      View
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

