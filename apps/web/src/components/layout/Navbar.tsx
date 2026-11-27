'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, Bell, Check, ExternalLink, Menu } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { formatKolkataTime } from '@/lib/timezone';

export function Navbar() {
  const router = useRouter();
  const { user } = useAuth();
  const [searchQuery, setSearchQuery] = useState('');
  const [notifications, setNotifications] = useState<any[]>([]);
  const [unreadCount, setUnreadCount] = useState<number>(0);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isFetchingRef = useRef(false);

  const loadNotifications = useCallback(async () => {
    if (!user || isFetchingRef.current) return;
    isFetchingRef.current = true;
    try {
      const res = await api.notifications.list({ page: 1, limit: 10 });
      setNotifications(res.notifications || []);
      setUnreadCount(res.unreadCount || 0);
    } catch {
      // Handle transient network/auth errors gracefully
    } finally {
      isFetchingRef.current = false;
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    loadNotifications();

    const intervalId = setInterval(() => {
      if (document.visibilityState === 'visible') {
        loadNotifications();
      }
    }, 30_000);

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadNotifications();
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      clearInterval(intervalId);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [user, loadNotifications]);

  const handleNotificationClick = async (n: any) => {
    if (!n.read) {
      try {
        await api.notifications.markRead(n.id);
        setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
        setUnreadCount((c) => Math.max(0, c - 1));
      } catch {}
    }
    setIsDropdownOpen(false);
    if (n.link) {
      router.push(n.link);
    }
  };

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      router.push(`/resources?search=${encodeURIComponent(searchQuery.trim())}`);
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await api.notifications.markAllRead();
      setUnreadCount(0);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    } catch (err) {
      console.error(err);
    }
  };

  const getRoleBadgeColor = (role?: string) => {
    switch (role) {
      case 'ADMINISTRATOR':
        return 'bg-purple-100 text-purple-800 border-purple-200';
      case 'DEPARTMENT_APPROVER':
        return 'bg-blue-100 text-blue-800 border-blue-200';
      case 'FACULTY':
        return 'bg-emerald-100 text-emerald-800 border-emerald-200';
      default:
        return 'bg-orange-100 text-orange-800 border-orange-200';
    }
  };

  return (
    <header className="h-16 bg-white border-b border-gray-200 sticky top-0 z-20 px-4 sm:px-6 lg:px-8 flex items-center justify-between gap-2 sm:gap-4 shadow-sm">
      <div className="flex items-center gap-2 sm:gap-3 flex-1 min-w-0">
        <button
          type="button"
          onClick={() => window.dispatchEvent(new CustomEvent('toggle-mobile-sidebar'))}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-1 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition shrink-0"
        >
          <Menu className="w-5 h-5" />
        </button>

        {/* Search Input */}
        <form onSubmit={handleSearch} className="w-full max-w-xl min-w-0">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-500 absolute left-3.5 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              aria-label="Search campus resources"
              placeholder="Search rooms, labs, halls..."
              className="w-full pl-10 pr-4 py-2 bg-[#F8F9FA] border border-gray-200 rounded-full text-sm text-gray-800 placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-[#F58220]/30 focus:border-[#F58220] transition"
            />
          </div>
        </form>
      </div>

      {/* Right Controls */}
      <div className="flex items-center gap-2 sm:gap-4 shrink-0">
        {/* Role Pill */}
        {user?.role && (
          <span
            className={`hidden sm:inline-flex text-[11px] font-bold px-2.5 py-1 rounded-full uppercase border ${getRoleBadgeColor(
              user.role
            )}`}
          >
            {user.role.replace('_', ' ')}
          </span>
        )}

        {/* Admin App Quick Link */}
        <a
          href="http://localhost:5174"
          target="_blank"
          rel="noopener noreferrer"
          className="hidden md:flex items-center gap-1.5 text-xs font-semibold text-blue-700 hover:text-blue-900 bg-blue-50 px-3 py-1.5 rounded-lg border border-blue-200 transition"
        >
          <span>Admin App</span>
          <ExternalLink className="w-3.5 h-3.5" />
        </a>

        {/* Notifications Dropdown */}
        <div className="relative" ref={dropdownRef}>
          <button
            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
            className="relative p-2 text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-full transition"
            aria-label="Notifications"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1.5 right-1.5 w-2.5 h-2.5 bg-[#F58220] rounded-full ring-2 ring-white" />
            )}
          </button>

          {isDropdownOpen && (
            <div className="absolute right-0 mt-2 w-80 sm:w-96 bg-white rounded-2xl shadow-xl border border-gray-100 py-3 z-50">
              <div className="px-4 pb-2 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-gray-900 text-sm">Notifications</span>
                  {unreadCount > 0 && (
                    <span className="text-[11px] bg-[#F58220] text-white px-2 py-0.5 rounded-full font-bold">
                      {unreadCount} new
                    </span>
                  )}
                </div>
                {unreadCount > 0 && (
                  <button
                    onClick={handleMarkAllRead}
                    className="text-xs text-[#F58220] hover:text-[#E06D0C] font-semibold flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    Mark all read
                  </button>
                )}
              </div>

              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {notifications.length === 0 ? (
                  <div className="py-8 text-center text-xs text-gray-400">
                    No notifications right now
                  </div>
                ) : (
                  notifications.map((n) => (
                    <div
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      className={`p-3.5 hover:bg-gray-50 transition cursor-pointer ${
                        !n.read ? 'bg-orange-50/40' : ''
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="text-xs font-bold text-gray-900">{n.title}</div>
                        {!n.read && (
                          <span className="w-2 h-2 rounded-full bg-[#F58220] shrink-0 mt-1" />
                        )}
                      </div>
                      <div className="text-xs text-gray-600 mt-0.5 line-clamp-2">{n.message}</div>
                      <div className="text-[10px] text-gray-400 mt-1.5">
                        {formatKolkataTime(n.createdAt)} IST
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="px-4 pt-2 border-t border-gray-100 text-center">
                <Link
                  href="/notifications"
                  onClick={() => setIsDropdownOpen(false)}
                  className="text-xs font-bold text-[#1976B9] hover:underline"
                >
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* User Avatar */}
        <div className="flex items-center gap-2 pl-2 border-l border-gray-200">
          <img
            src={
              user?.avatarUrl ||
              'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
            }
            alt={user?.name || 'User'}
            className="w-8 h-8 rounded-full object-cover border border-[#F58220]/40"
          />
        </div>
      </div>
    </header>
  );
}

