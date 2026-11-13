'use client';

import React from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Home,
  Search,
  Calendar,
  CalendarDays,
  Bell,
  User,
  Settings,
  LogOut,
  CheckSquare,
  BarChart3,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@lpu/shared';

interface SidebarProps {
  pendingApprovalsCount?: number;
  unreadNotificationsCount?: number;
}

export function Sidebar({ pendingApprovalsCount = 0, unreadNotificationsCount = 3 }: SidebarProps) {
  const pathname = usePathname();
  const { user, logout, demoLogin } = useAuth();

  const isRoleElevated = user?.role === 'DEPARTMENT_APPROVER' || user?.role === 'ADMINISTRATOR';

  const navItems = [
    { name: 'Dashboard', href: '/', icon: Home },
    { name: 'Find Resources', href: '/resources', icon: Search },
    { name: 'My Bookings', href: '/my-bookings', icon: Calendar },
    { name: 'Campus Calendar', href: '/calendar', icon: CalendarDays },
    ...(isRoleElevated
      ? [
          {
            name: 'Approvals',
            href: '/approvals',
            icon: CheckSquare,
            badge: pendingApprovalsCount > 0 ? pendingApprovalsCount : undefined,
          },
        ]
      : []),
    {
      name: 'Notifications',
      href: '/notifications',
      icon: Bell,
      badge: unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
    },
    { name: 'Profile', href: '/profile', icon: User },
  ];

  return (
    <aside className="w-64 bg-[#161922] text-white flex flex-col justify-between shrink-0 h-screen sticky top-0 select-none border-r border-[#262B38] z-30">
      {/* Top Header & Branding */}
      <div>
        <div className="p-5 pb-6 border-b border-[#232734]">
          <Link href="/" className="flex items-center gap-3">
            {/* LPU Sun Rays Emblem */}
            <div className="w-11 h-11 rounded-full bg-gradient-to-tr from-[#EA580C] to-[#F58220] flex items-center justify-center p-2 shadow-md">
              <svg viewBox="0 0 24 24" fill="none" className="w-7 h-7 text-white">
                <circle cx="12" cy="12" r="4" fill="currentColor" />
                <path
                  d="M12 2V4M12 20V22M4 12H2M22 12H20M5.636 5.636L7.05 7.05M16.95 16.95L18.364 18.364M5.636 18.364L7.05 16.95M16.95 7.05L18.364 5.636"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </svg>
            </div>
            <div>
              <div className="flex items-center gap-1.5 leading-tight">
                <span className="font-extrabold text-[15px] tracking-tight text-white">LOVELY</span>
                <span className="bg-[#F58220] text-black text-[10px] font-black px-1 rounded-sm">LPU</span>
              </div>
              <div className="text-[11px] font-bold tracking-wider text-gray-200 uppercase leading-none">
                PROFESSIONAL
              </div>
              <div className="text-[10px] tracking-widest text-[#F58220] font-semibold uppercase leading-tight">
                UNIVERSITY
              </div>
              <div className="text-[8px] tracking-[0.2em] text-gray-400 font-medium uppercase mt-0.5">
                LEARN • GROW • BELONG
              </div>
            </div>
          </Link>
        </div>

        {/* Navigation Links */}
        <nav className="p-3 space-y-1.5 mt-2">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;

            return (
              <Link
                key={item.name}
                href={item.href}
                className={`flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm transition-all duration-150 ${
                  isActive
                    ? 'bg-[#F58220] text-white shadow-sm font-semibold'
                    : 'text-gray-300 hover:text-white hover:bg-[#202430]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-gray-400'}`} />
                  <span>{item.name}</span>
                </div>
                {item.badge !== undefined && (
                  <span
                    className={`text-[11px] font-bold px-2 py-0.5 rounded-full ${
                      isActive ? 'bg-white text-[#F58220]' : 'bg-[#F58220] text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </Link>
            );
          })}

          {/* Standalone Admin Portal Button */}
          <a
            href="http://localhost:5174"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center justify-between px-3.5 py-2.5 rounded-xl font-medium text-sm text-[#F58220] bg-[#F58220]/10 hover:bg-[#F58220]/20 border border-[#F58220]/20 transition-all mt-3"
          >
            <div className="flex items-center gap-3">
              <BarChart3 className="w-4 h-4 text-[#F58220]" />
              <span>Admin Analytics App</span>
            </div>
            <span className="text-[10px] bg-[#F58220] text-white font-bold px-1.5 py-0.5 rounded uppercase">
              Vite
            </span>
          </a>
        </nav>
      </div>

      {/* Bottom Section: Role Switcher & User Card */}
      <div className="p-3 border-t border-[#232734] space-y-3">
        {/* Fast Role Switcher */}
        <div className="bg-[#1D212C] p-2 rounded-xl border border-[#2B3040]">
          <div className="text-[10px] font-bold tracking-wider text-gray-400 uppercase mb-1.5 px-1 flex items-center justify-between">
            <span>Quick Role Switch</span>
            <span className="text-[#F58220]">{user?.role?.substring(0, 4)}</span>
          </div>
          <div className="grid grid-cols-2 gap-1 text-[11px]">
            <button
              onClick={() => demoLogin('STUDENT')}
              className={`py-1 px-1.5 rounded font-medium text-center transition ${
                user?.role === 'STUDENT'
                  ? 'bg-[#F58220] text-white font-bold'
                  : 'bg-[#262C3A] text-gray-300 hover:text-white'
              }`}
            >
              Student
            </button>
            <button
              onClick={() => demoLogin('FACULTY')}
              className={`py-1 px-1.5 rounded font-medium text-center transition ${
                user?.role === 'FACULTY'
                  ? 'bg-[#F58220] text-white font-bold'
                  : 'bg-[#262C3A] text-gray-300 hover:text-white'
              }`}
            >
              Faculty
            </button>
            <button
              onClick={() => demoLogin('DEPARTMENT_APPROVER')}
              className={`py-1 px-1.5 rounded font-medium text-center transition ${
                user?.role === 'DEPARTMENT_APPROVER'
                  ? 'bg-[#F58220] text-white font-bold'
                  : 'bg-[#262C3A] text-gray-300 hover:text-white'
              }`}
            >
              Approver
            </button>
            <button
              onClick={() => demoLogin('ADMINISTRATOR')}
              className={`py-1 px-1.5 rounded font-medium text-center transition ${
                user?.role === 'ADMINISTRATOR'
                  ? 'bg-[#F58220] text-white font-bold'
                  : 'bg-[#262C3A] text-gray-300 hover:text-white'
              }`}
            >
              Admin
            </button>
          </div>
        </div>

        {/* User Profile Card */}
        <div className="flex items-center justify-between p-2 rounded-xl bg-[#1D212C] border border-[#2B3040]">
          <div className="flex items-center gap-2.5 overflow-hidden">
            <img
              src={user?.avatarUrl || 'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'}
              alt={user?.name || 'User'}
              className="w-9 h-9 rounded-full object-cover border border-[#F58220]/50"
            />
            <div className="overflow-hidden">
              <div className="text-xs font-bold text-white truncate">{user?.name || 'Ketan Meshram'}</div>
              <div className="text-[10px] text-gray-400 truncate">
                {user?.role === 'STUDENT' ? 'Student • B.Tech CSE' : user?.designation || user?.role}
              </div>
            </div>
          </div>
          <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />
        </div>

        {/* Footer Actions */}
        <div className="flex items-center justify-between px-1 text-xs text-gray-400">
          <Link href="/profile" className="flex items-center gap-1.5 hover:text-white transition">
            <Settings className="w-3.5 h-3.5" />
            <span>Settings</span>
          </Link>
          <button
            onClick={logout}
            className="flex items-center gap-1.5 hover:text-red-400 transition"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span>Log Out</span>
          </button>
        </div>
      </div>
    </aside>
  );
}

