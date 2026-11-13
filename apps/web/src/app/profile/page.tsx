'use client';

import React from 'react';
import Link from 'next/link';
import {
  User,
  Mail,
  Shield,
  Building,
  Phone,
  CheckCircle2,
  Calendar,
  LogOut,
  ExternalLink,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/lib/auth-context';
import { UserRole } from '@lpu/shared';

export default function ProfilePage() {
  const { user, logout, demoLogin } = useAuth();

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-4xl mx-auto w-full space-y-6">
          {/* Header */}
          <div>
            <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
              <Link href="/" className="hover:text-gray-600">
                Dashboard
              </Link>
              <span>›</span>
              <span className="text-[#F58220] font-semibold">User Profile</span>
            </div>
            <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
              Campus Account & Credentials
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Verified university identity, booking quotas, and role privileges.
            </p>
          </div>

          {/* Profile Card */}
          <div className="bg-white rounded-3xl border border-gray-100 shadow-sm p-6 sm:p-8 flex flex-col sm:flex-row items-center gap-6">
            <img
              src={
                user?.avatarUrl ||
                'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
              }
              alt={user?.name}
              className="w-24 h-24 rounded-full object-cover border-4 border-orange-100 shadow-md"
            />
            <div className="space-y-1 text-center sm:text-left flex-1">
              <div className="flex items-center justify-center sm:justify-start gap-2 flex-wrap">
                <h2 className="text-xl font-extrabold text-gray-900">{user?.name}</h2>
                <span className="bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] text-xs font-bold px-2.5 py-0.5 rounded-full uppercase">
                  {user?.role}
                </span>
              </div>
              <p className="text-xs text-gray-500">{user?.designation || 'Student Member'}</p>
              <p className="text-xs text-gray-600 font-medium">{user?.department}</p>
            </div>
          </div>

          {/* Details Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-1 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <Mail className="w-4 h-4 text-[#F58220]" />
                <span>University Email</span>
              </div>
              <div className="font-bold text-gray-800 text-sm">{user?.email}</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-1 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <Shield className="w-4 h-4 text-[#F58220]" />
                <span>Registration / UID</span>
              </div>
              <div className="font-bold text-gray-800 text-sm">{user?.regNo || 'UID-12204598'}</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-1 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <Building className="w-4 h-4 text-[#F58220]" />
                <span>Academic School</span>
              </div>
              <div className="font-bold text-gray-800 text-sm">{user?.department}</div>
            </div>

            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-sm space-y-1 text-xs">
              <div className="flex items-center gap-2 text-gray-400">
                <Phone className="w-4 h-4 text-[#F58220]" />
                <span>Contact Phone</span>
              </div>
              <div className="font-bold text-gray-800 text-sm">{user?.phone || '+91 98765 43210'}</div>
            </div>
          </div>

          {/* Quick Role Switcher Showcase Card */}
          <div className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm space-y-4">
            <div>
              <h3 className="text-sm font-extrabold text-gray-900">
                Role-Based Access Control Simulation
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">
                Switch between different user roles to test and observe UI changes, approval
                queues, and administration privileges.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
              {[
                {
                  role: 'STUDENT',
                  title: 'Student Role',
                  desc: 'Book classrooms & labs; view personal timetable; submit club requests.',
                },
                {
                  role: 'FACULTY',
                  title: 'Faculty Role',
                  desc: 'Priority booking for labs and seminar halls; auto-approved slots.',
                },
                {
                  role: 'DEPARTMENT_APPROVER',
                  title: 'Approver Role',
                  desc: 'Review pending booking queue; approve, decline, or reassign facilities.',
                },
                {
                  role: 'ADMINISTRATOR',
                  title: 'Administrator',
                  desc: 'Access standalone Vite analytics dashboard; manage resources & policies.',
                },
              ].map((item) => (
                <button
                  key={item.role}
                  type="button"
                  onClick={() => demoLogin(item.role as UserRole)}
                  className={`p-3.5 rounded-2xl border text-left flex flex-col justify-between transition ${
                    user?.role === item.role
                      ? 'bg-[#FFF4EA] border-[#F58220] shadow-sm'
                      : 'bg-gray-50 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-bold text-xs text-gray-900">{item.title}</span>
                      {user?.role === item.role && (
                        <CheckCircle2 className="w-4 h-4 text-[#F58220]" />
                      )}
                    </div>
                    <p className="text-[10px] text-gray-500 leading-relaxed">{item.desc}</p>
                  </div>
                  <span
                    className={`mt-3 text-[10px] font-bold px-2 py-0.5 rounded text-center ${
                      user?.role === item.role
                        ? 'bg-[#F58220] text-white'
                        : 'bg-gray-200 text-gray-700'
                    }`}
                  >
                    {user?.role === item.role ? 'Active Role' : 'Switch to this'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {/* Sign Out Button */}
          <div className="pt-2">
            <button
              onClick={logout}
              className="px-5 py-2.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl border border-red-200 transition flex items-center gap-2"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign Out of Platform</span>
            </button>
          </div>
        </main>
      </div>
    </div>
  );
}

