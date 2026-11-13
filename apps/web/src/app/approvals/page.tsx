'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Check,
  X,
  Edit3,
  Clock,
  MapPin,
  Users,
  AlertTriangle,
  CheckCircle2,
  Filter,
  Search,
  ChevronRight,
  ShieldAlert,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import { BookingDTO, ResourceDTO } from '@lpu/shared';

export default function ApprovalsPage() {
  const { user } = useAuth();
  const [requests, setRequests] = useState<BookingDTO[]>([]);
  const [allResources, setAllResources] = useState<ResourceDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'PENDING' | 'HISTORY'>('PENDING');

  // Modals
  const [rejectingBooking, setRejectingBooking] = useState<BookingDTO | null>(null);
  const [rejectionReason, setRejectionReason] = useState('');
  const [modifyingBooking, setModifyingBooking] = useState<BookingDTO | null>(null);
  const [modifiedResourceId, setModifiedResourceId] = useState('');
  const [actionNotes, setActionNotes] = useState('');

  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    fetchRequests();
    api.resources.list().then((r) => setAllResources(r.resources || []));
  }, [activeTab]);

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const statusParam = activeTab === 'PENDING' ? 'PENDING' : undefined;
      const res = await api.approvals.list(statusParam);
      setRequests(res.requests || []);
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleApprove = async (id: string) => {
    if (confirm('Approve this campus reservation? An automatic check-in token will be issued to the requester.')) {
      try {
        await api.approvals.takeAction(id, { action: 'APPROVE', notes: 'Approved by Department In-charge' });
        fetchRequests();
      } catch (err: any) {
        alert(err.message || 'Approval failed.');
      }
    }
  };

  const handleRejectConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rejectingBooking) return;
    setIsSubmitting(true);
    try {
      await api.approvals.takeAction(rejectingBooking.id, {
        action: 'REJECT',
        reason: rejectionReason || 'Capacity or policy conflict',
      });
      setRejectingBooking(null);
      setRejectionReason('');
      fetchRequests();
    } catch (err: any) {
      alert(err.message || 'Rejection failed.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModifyConfirm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!modifyingBooking) return;
    setIsSubmitting(true);
    try {
      await api.approvals.takeAction(modifyingBooking.id, {
        action: 'MODIFY',
        alternateResourceId: modifiedResourceId || undefined,
        notes: actionNotes || 'Room adjusted by department approver for optimal space utilization',
      });
      setModifyingBooking(null);
      setModifiedResourceId('');
      setActionNotes('');
      fetchRequests();
    } catch (err: any) {
      alert(err.message || 'Modification failed.');
    } finally {
      setIsSubmitting(false);
    }
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
                <span className="text-[#F58220] font-semibold">Department Approvals</span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight flex items-center gap-2">
                <span>Facility Allocation Approval Queue</span>
                <span className="bg-[#FFF4EA] text-[#F58220] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#FED7AA]">
                  Approver Role
                </span>
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Review booking requests for auditoriums, labs, and seminar halls across campus.
              </p>
            </div>

            {/* Tab switchers */}
            <div className="flex bg-white p-1 rounded-2xl border border-gray-200 text-xs font-bold shadow-sm">
              <button
                onClick={() => setActiveTab('PENDING')}
                className={`px-4 py-2 rounded-xl transition ${
                  activeTab === 'PENDING'
                    ? 'bg-[#F58220] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Pending Requests ({requests.filter((r) => r.status === 'PENDING').length})
              </button>
              <button
                onClick={() => setActiveTab('HISTORY')}
                className={`px-4 py-2 rounded-xl transition ${
                  activeTab === 'HISTORY'
                    ? 'bg-[#F58220] text-white shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                Audit History
              </button>
            </div>
          </div>

          {/* Requests Queue */}
          {isLoading ? (
            <div className="p-16 text-center">
              <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
              <div className="text-xs text-gray-400">Loading approval queue...</div>
            </div>
          ) : requests.length === 0 ? (
            <div className="bg-white p-16 rounded-3xl border border-gray-100 text-center space-y-3">
              <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto" />
              <div className="text-base font-bold text-gray-800">
                All Caught Up! No Pending Requests
              </div>
              <div className="text-xs text-gray-400 max-w-sm mx-auto">
                There are no resource requests currently awaiting department approval.
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {requests.map((r) => (
                <div
                  key={r.id}
                  className="bg-white p-6 rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition flex flex-col lg:flex-row lg:items-center justify-between gap-6"
                >
                  {/* Left: Requester + Facility info */}
                  <div className="flex items-start gap-4">
                    <img
                      src={
                        r.user?.avatarUrl ||
                        'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
                      }
                      alt={r.user?.name}
                      className="w-14 h-14 rounded-2xl object-cover shrink-0 border border-gray-200"
                    />

                    <div className="space-y-1.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-extrabold text-base text-[#292929]">
                          {r.user?.name}
                        </span>
                        <span className="text-xs font-bold text-[#F58220] bg-orange-50 px-2 py-0.5 rounded">
                          {r.user?.role}
                        </span>
                        <span className="text-xs text-gray-400">UID: {r.user?.regNo || 'N/A'}</span>
                        <span className="text-[10px] font-mono text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                          Ref: {r.bookingNumber}
                        </span>
                      </div>

                      <div className="text-xs text-gray-500">
                        Requested Facility:{' '}
                        <span className="font-bold text-gray-900">{r.resource?.name}</span> (
                        {r.resource?.building} • Max Cap: {r.resource?.capacity})
                      </div>

                      <div className="flex items-center gap-4 text-xs text-gray-600 flex-wrap">
                        <span className="flex items-center gap-1 font-semibold text-gray-800">
                          <Clock className="w-3.5 h-3.5 text-gray-400" />
                          {new Date(r.startTime).toLocaleDateString()} (
                          {new Date(r.startTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          -{' '}
                          {new Date(r.endTime).toLocaleTimeString([], {
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                          )
                        </span>
                        <span className="flex items-center gap-1">
                          <Users className="w-3.5 h-3.5 text-gray-400" />
                          Expected: {r.expectedAttendance} attendees
                        </span>
                      </div>

                      <div className="text-xs text-gray-700 bg-gray-50 p-2.5 rounded-xl border border-gray-100">
                        <span className="font-bold text-gray-500">Agenda: </span>
                        <span>{r.purpose}</span>
                      </div>
                    </div>
                  </div>

                  {/* Right Action Buttons */}
                  <div className="flex flex-col sm:flex-row items-center gap-2 shrink-0">
                    {r.status === 'PENDING' ? (
                      <>
                        <button
                          onClick={() => handleApprove(r.id)}
                          className="w-full sm:w-auto px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-sm transition flex items-center justify-center gap-1.5"
                        >
                          <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                          <span>Approve Request</span>
                        </button>

                        <button
                          onClick={() => {
                            setModifyingBooking(r);
                            setModifiedResourceId(r.resourceId);
                          }}
                          className="w-full sm:w-auto px-3.5 py-2 bg-blue-50 hover:bg-blue-100 text-[#1976B9] font-bold text-xs rounded-xl border border-blue-200 transition flex items-center justify-center gap-1.5"
                        >
                          <Edit3 className="w-3.5 h-3.5" />
                          <span>Modify / Reassign</span>
                        </button>

                        <button
                          onClick={() => {
                            setRejectingBooking(r);
                            setRejectionReason('');
                          }}
                          className="w-full sm:w-auto px-3.5 py-2 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl border border-red-200 transition flex items-center justify-center gap-1.5"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Decline</span>
                        </button>
                      </>
                    ) : (
                      <span
                        className={`text-xs font-bold px-3 py-1 rounded-full ${
                          r.status === 'CONFIRMED' || r.status === 'CHECKED_IN'
                            ? 'bg-emerald-100 text-emerald-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        Status: {r.status}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </main>
      </div>

      {/* Rejection Modal */}
      {rejectingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100">
            <h3 className="text-base font-extrabold text-gray-900 mb-1">
              Decline Booking Request
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Please state the reason for declining this request ({rejectingBooking.resource?.name} for{' '}
              {rejectingBooking.user?.name}). The student will receive an instant notification.
            </p>

            <form onSubmit={handleRejectConfirm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Rejection Reason *
                </label>
                <textarea
                  required
                  value={rejectionReason}
                  onChange={(e) => setRejectionReason(e.target.value)}
                  placeholder="e.g. Facility reserved for official university convocation prep..."
                  rows={3}
                  className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setRejectingBooking(null)}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow"
                >
                  Confirm Rejection
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Modify & Reassign Room Modal */}
      {modifyingBooking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100">
            <h3 className="text-base font-extrabold text-gray-900 mb-1">
              Modify & Assign Alternate Facility
            </h3>
            <p className="text-xs text-gray-500 mb-4">
              Reassign {modifyingBooking.user?.name}'s reservation to a different room of appropriate
              size.
            </p>

            <form onSubmit={handleModifyConfirm} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Select Alternate Room *
                </label>
                <select
                  value={modifiedResourceId}
                  onChange={(e) => setModifiedResourceId(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                >
                  {allResources.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.name} ({res.building} • Cap: {res.capacity})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Approver Notes</label>
                <textarea
                  value={actionNotes}
                  onChange={(e) => setActionNotes(e.target.value)}
                  placeholder="e.g. Reassigned to Seminar Hall 2 due to larger attendee capacity."
                  rows={2}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setModifyingBooking(null)}
                  className="flex-1 py-2 bg-gray-100 text-gray-700 text-xs font-bold rounded-xl"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex-1 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow"
                >
                  Apply & Approve
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

