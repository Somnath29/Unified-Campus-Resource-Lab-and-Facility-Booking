'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Mail,
  Shield,
  Building,
  Phone,
  Lock,
  Eye,
  EyeOff,
  Laptop,
  LogOut,
  Bell,
  Calendar,
  Copy,
  RefreshCw,
  Trash2,
  Download,
  CheckCircle2,
  AlertTriangle,
  Save,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/lib/auth-context';
import { api, setStoredToken } from '@/lib/api';
import { formatKolkataDateTime } from '@/lib/timezone';
import {
  NotificationPreferenceDTO,
  UserProfileDTO,
  UserSessionDTO,
} from '@lpu/shared';

export default function ProfilePage() {
  const { user, logout } = useAuth();

  // Profile state
  const [profile, setProfile] = useState<UserProfileDTO | null>(null);
  const [nameInput, setNameInput] = useState('');
  const [phoneInput, setPhoneInput] = useState('');
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [profileFeedback, setProfileFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Password change state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [isChangingPassword, setIsChangingPassword] = useState(false);
  const [passwordFeedback, setPasswordFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Sessions state
  const [sessions, setSessions] = useState<UserSessionDTO[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [sessionFeedback, setSessionFeedback] = useState<string | null>(null);

  // Notification Preferences state
  const [preferences, setPreferences] = useState<NotificationPreferenceDTO[]>([]);
  const [leadMinutes, setLeadMinutes] = useState<number>(30);
  const [isSavingPrefs, setIsSavingPrefs] = useState(false);
  const [prefsFeedback, setPrefsFeedback] = useState<{ type: 'ok' | 'err'; msg: string } | null>(null);

  // Calendar Subscription state
  const [hasActiveFeed, setHasActiveFeed] = useState(false);
  const [generatedFeedUrl, setGeneratedFeedUrl] = useState<string | null>(null);
  const [isFeedBusy, setIsFeedBusy] = useState(false);
  const [feedFeedback, setFeedFeedback] = useState<string | null>(null);

  const loadAccountData = useCallback(async () => {
    try {
      const [meRes, sessRes, prefRes, feedRes] = await Promise.all([
        api.me.get(),
        api.me.getSessions(),
        api.notificationPreferences.get(),
        api.me.getCalendarFeed(),
      ]);
      setProfile(meRes.user);
      setNameInput(meRes.user.name || '');
      setPhoneInput(meRes.user.phone || '');
      setSessions(sessRes.sessions || []);
      setPreferences(prefRes.preferences || []);
      setLeadMinutes(prefRes.reminderLeadMinutes || 30);
      setHasActiveFeed(feedRes.hasActiveFeed);
    } catch {
      // ignore if unauthenticated
    } finally {
      setIsLoadingSessions(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      loadAccountData();
    }
  }, [user, loadAccountData]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSavingProfile(true);
    setProfileFeedback(null);
    try {
      const res = await api.me.updateProfile({
        name: nameInput,
        phone: phoneInput.trim() || null,
      });
      setProfile(res.user);
      setProfileFeedback({ type: 'ok', msg: res.message });
    } catch (err: any) {
      setProfileFeedback({ type: 'err', msg: err.message || 'Failed to update profile.' });
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordFeedback(null);
    if (newPassword !== confirmPassword) {
      setPasswordFeedback({ type: 'err', msg: 'New password and confirmation do not match.' });
      return;
    }
    setIsChangingPassword(true);
    try {
      const res = await api.me.changePassword({ currentPassword, newPassword });
      if (res.token) {
        setStoredToken(res.token);
      }
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPasswordFeedback({ type: 'ok', msg: res.message });
      const sessRes = await api.me.getSessions();
      setSessions(sessRes.sessions || []);
    } catch (err: any) {
      setPasswordFeedback({ type: 'err', msg: err.message || 'Failed to change password.' });
    } finally {
      setIsChangingPassword(false);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      await api.me.revokeSession(sessionId);
      setSessions((prev) => prev.filter((s) => s.id !== sessionId));
      setSessionFeedback('Session revoked successfully.');
    } catch (err: any) {
      setSessionFeedback(err.message || 'Failed to revoke session.');
    }
  };

  const handleRevokeAllSessions = async () => {
    if (!confirm('Sign out of all devices including this browser?')) return;
    try {
      await api.me.revokeAllSessions();
      await logout();
    } catch (err: any) {
      setSessionFeedback(err.message || 'Failed to sign out all devices.');
    }
  };

  const handleSavePreferences = async () => {
    setIsSavingPrefs(true);
    setPrefsFeedback(null);
    try {
      const res = await api.notificationPreferences.update({
        reminderLeadMinutes: Number(leadMinutes),
        preferences: preferences.map((p) => ({
          notificationType: p.notificationType,
          emailEnabled: p.emailEnabled,
        })),
      });
      setPreferences(res.preferences);
      setLeadMinutes(res.reminderLeadMinutes);
      setPrefsFeedback({ type: 'ok', msg: res.message });
    } catch (err: any) {
      setPrefsFeedback({ type: 'err', msg: err.message || 'Failed to save preferences.' });
    } finally {
      setIsSavingPrefs(false);
    }
  };

  const handleRegenerateFeed = async () => {
    setIsFeedBusy(true);
    setFeedFeedback(null);
    try {
      const res = await api.me.regenerateCalendarFeed();
      setGeneratedFeedUrl(res.feedUrl);
      setHasActiveFeed(true);
      setFeedFeedback(res.message);
    } catch (err: any) {
      setFeedFeedback(err.message || 'Failed to generate feed URL.');
    } finally {
      setIsFeedBusy(false);
    }
  };

  const handleRevokeFeed = async () => {
    if (!confirm('Revoke your calendar subscription URL? External calendar apps will stop syncing.')) {
      return;
    }
    setIsFeedBusy(true);
    try {
      await api.me.revokeCalendarFeed();
      setHasActiveFeed(false);
      setGeneratedFeedUrl(null);
      setFeedFeedback('Calendar subscription feed revoked.');
    } catch (err: any) {
      setFeedFeedback(err.message || 'Failed to revoke feed.');
    } finally {
      setIsFeedBusy(false);
    }
  };

  const displayUser = profile || user;

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
              <span className="text-[#F58220] font-semibold">Account Settings</span>
            </div>
            <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
              Profile, Security & Preferences
            </h1>
            <p className="text-xs text-gray-500 mt-0.5">
              Manage your personal details, password, active sessions, email alerts, and calendar feed.
            </p>
          </div>

          {/* 1. Personal Details */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-extrabold text-[#292929]">Personal Details</h2>
                <p className="text-xs text-gray-400">
                  Role and department are governed by university administration.
                </p>
              </div>
              <span className="bg-[#FFF4EA] text-[#F58220] border border-[#FED7AA] text-xs font-bold px-2.5 py-0.5 rounded-full uppercase">
                {displayUser?.role}
              </span>
            </div>

            {profileFeedback && (
              <div
                className={`p-3 rounded-xl text-xs flex items-center gap-2 ${
                  profileFeedback.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {profileFeedback.type === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                ) : (
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                )}
                <span>{profileFeedback.msg}</span>
              </div>
            )}

            <form onSubmit={handleSaveProfile} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">Full Name</label>
                  <input
                    type="text"
                    required
                    value={nameInput}
                    onChange={(e) => setNameInput(e.target.value)}
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1 flex items-center gap-1">
                    <Phone className="w-3.5 h-3.5 text-[#F58220]" /> Contact Phone
                  </label>
                  <input
                    type="tel"
                    value={phoneInput}
                    onChange={(e) => setPhoneInput(e.target.value)}
                    placeholder="+91 98765 43210"
                    className="w-full px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 flex items-center gap-1">
                    <Mail className="w-3.5 h-3.5" /> University Email (Read-Only)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={displayUser?.email || ''}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 flex items-center gap-1">
                    <Building className="w-3.5 h-3.5" /> Department (Read-Only)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={displayUser?.department || ''}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 cursor-not-allowed"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-gray-400 mb-1 flex items-center gap-1">
                    <Shield className="w-3.5 h-3.5" /> Role (Read-Only)
                  </label>
                  <input
                    type="text"
                    readOnly
                    value={displayUser?.role || ''}
                    className="w-full px-3.5 py-2.5 bg-gray-50 border border-gray-200 rounded-xl text-sm text-gray-500 cursor-not-allowed"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={isSavingProfile}
                className="px-5 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition flex items-center gap-2 disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                <span>{isSavingProfile ? 'Saving...' : 'Save Profile'}</span>
              </button>
            </form>
          </section>

          {/* 2. Account Security (Password Change) */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-gray-100 pb-3">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-[#1976B9]" />
                <h2 className="text-base font-extrabold text-[#292929]">Change Password</h2>
              </div>
              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="text-xs font-bold text-gray-500 hover:text-gray-800 flex items-center gap-1"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                <span>{showPasswords ? 'Hide' : 'Show'}</span>
              </button>
            </div>

            {passwordFeedback && (
              <div
                className={`p-3 rounded-xl text-xs ${
                  passwordFeedback.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {passwordFeedback.msg}
              </div>
            )}

            <form onSubmit={handleChangePassword} className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                placeholder="Current password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1976B9]"
              />
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                minLength={6}
                placeholder="New password (min 6 chars)"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1976B9]"
              />
              <input
                type={showPasswords ? 'text' : 'password'}
                required
                minLength={6}
                placeholder="Confirm new password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="px-3.5 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#1976B9]"
              />
              <div className="sm:col-span-3">
                <button
                  type="submit"
                  disabled={isChangingPassword}
                  className="px-5 py-2.5 bg-[#292929] hover:bg-black text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
                >
                  {isChangingPassword ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </section>

          {/* 3. Active Sessions */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-extrabold text-[#292929] flex items-center gap-2">
                  <Laptop className="w-4 h-4 text-[#F58220]" />
                  <span>Active Sessions</span>
                </h2>
                <p className="text-xs text-gray-400">
                  Revoked sessions immediately stop authenticating across all server instances.
                </p>
              </div>
              <button
                type="button"
                onClick={handleRevokeAllSessions}
                className="px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span>Sign Out All Devices</span>
              </button>
            </div>

            {sessionFeedback && (
              <div className="p-2.5 bg-blue-50 text-blue-800 border border-blue-200 rounded-xl text-xs">
                {sessionFeedback}
              </div>
            )}

            {isLoadingSessions ? (
              <div className="h-16 bg-gray-100 rounded-xl animate-pulse" />
            ) : sessions.length === 0 ? (
              <p className="text-xs text-gray-400">No active tracked sessions found.</p>
            ) : (
              <div className="divide-y divide-gray-100">
                {sessions.map((s) => (
                  <div key={s.id} className="py-3 flex items-center justify-between gap-3">
                    <div className="text-xs space-y-0.5">
                      <div className="font-bold text-[#292929] flex items-center gap-2">
                        <span>{s.deviceLabel || 'Unknown device'}</span>
                        {s.isCurrent && (
                          <span className="px-2 py-0.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-full text-[10px]">
                            Current Device
                          </span>
                        )}
                      </div>
                      <div className="text-gray-400">
                        IP: {s.ipAddress || 'Unavailable'} • Last active:{' '}
                        {formatKolkataDateTime(s.lastActiveAt)} IST
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleRevokeSession(s.id)}
                      className="px-3 py-1.5 text-xs font-bold text-red-600 hover:bg-red-50 border border-red-200 rounded-lg transition"
                    >
                      Revoke
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 4. Notification Preferences */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-gray-100 pb-3">
              <div>
                <h2 className="text-base font-extrabold text-[#292929] flex items-center gap-2">
                  <Bell className="w-4 h-4 text-[#F58220]" />
                  <span>Email Notification Preferences</span>
                </h2>
                <p className="text-xs text-gray-400">
                  In-app alerts always remain enabled; configure email delivery and reminder lead time.
                </p>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <label className="font-bold text-gray-700">Reminder lead time (min):</label>
                <input
                  type="number"
                  min={5}
                  max={1440}
                  value={leadMinutes}
                  onChange={(e) => setLeadMinutes(Number(e.target.value))}
                  className="w-20 px-2.5 py-1.5 border border-gray-200 rounded-lg text-xs font-bold"
                />
              </div>
            </div>

            {prefsFeedback && (
              <div
                className={`p-3 rounded-xl text-xs ${
                  prefsFeedback.type === 'ok'
                    ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                    : 'bg-red-50 text-red-700 border border-red-200'
                }`}
              >
                {prefsFeedback.msg}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {preferences.map((pref) => (
                <label
                  key={pref.notificationType}
                  className="p-3 border border-gray-100 rounded-xl bg-gray-50/50 flex items-start justify-between gap-3 cursor-pointer"
                >
                  <div className="text-xs">
                    <div className="font-bold text-[#292929]">{pref.label}</div>
                    <div className="text-[11px] text-gray-500">{pref.description}</div>
                  </div>
                  <input
                    type="checkbox"
                    checked={pref.emailEnabled}
                    onChange={(e) =>
                      setPreferences((prev) =>
                        prev.map((p) =>
                          p.notificationType === pref.notificationType
                            ? { ...p, emailEnabled: e.target.checked }
                            : p
                        )
                      )
                    }
                    className="mt-1 accent-[#F58220]"
                  />
                </label>
              ))}
            </div>

            <button
              type="button"
              onClick={handleSavePreferences}
              disabled={isSavingPrefs}
              className="px-5 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl transition disabled:opacity-50"
            >
              {isSavingPrefs ? 'Saving Preferences...' : 'Save Preferences'}
            </button>
          </section>

          {/* 5. Calendar Subscription & Export */}
          <section className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 space-y-4">
            <div className="border-b border-gray-100 pb-3">
              <h2 className="text-base font-extrabold text-[#292929] flex items-center gap-2">
                <Calendar className="w-4 h-4 text-[#1976B9]" />
                <span>Calendar Export & Subscription Feed</span>
              </h2>
              <p className="text-xs text-gray-400">
                Subscribe in Google Calendar, Apple Calendar, or Outlook. Anyone possessing your secret URL can view your upcoming schedule until revoked.
              </p>
            </div>

            {feedFeedback && (
              <div className="p-3 bg-blue-50 border border-blue-200 rounded-xl text-xs text-blue-900">
                {feedFeedback}
              </div>
            )}

            {generatedFeedUrl && (
              <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
                <div className="text-xs font-bold text-amber-900">
                  Copy your secret calendar URL now (shown once):
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={generatedFeedUrl}
                    className="flex-1 px-3 py-2 bg-white border border-amber-200 rounded-lg text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => navigator.clipboard.writeText(generatedFeedUrl)}
                    className="px-3 py-2 bg-[#292929] text-white text-xs font-bold rounded-lg flex items-center gap-1"
                  >
                    <Copy className="w-3.5 h-3.5" /> Copy
                  </button>
                </div>
              </div>
            )}

            <div className="flex flex-wrap items-center gap-3">
              <a
                href="/api/me/calendar.ics"
                download="lpu-my-bookings.ics"
                className="px-4 py-2.5 bg-[#292929] hover:bg-black text-white text-xs font-bold rounded-xl flex items-center gap-2 transition"
              >
                <Download className="w-4 h-4" />
                <span>Download .ICS Schedule</span>
              </a>

              <button
                type="button"
                onClick={handleRegenerateFeed}
                disabled={isFeedBusy}
                className="px-4 py-2.5 bg-[#1976B9] hover:bg-[#145E94] text-white text-xs font-bold rounded-xl flex items-center gap-2 transition disabled:opacity-50"
              >
                <RefreshCw className={`w-4 h-4 ${isFeedBusy ? 'animate-spin' : ''}`} />
                <span>{hasActiveFeed ? 'Regenerate Feed URL' : 'Generate Feed URL'}</span>
              </button>

              {hasActiveFeed && (
                <button
                  type="button"
                  onClick={handleRevokeFeed}
                  disabled={isFeedBusy}
                  className="px-4 py-2.5 bg-red-50 hover:bg-red-100 text-red-700 border border-red-200 text-xs font-bold rounded-xl flex items-center gap-2 transition disabled:opacity-50"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Revoke Feed</span>
                </button>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
