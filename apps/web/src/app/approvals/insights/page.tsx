'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';
import {
  Calendar,
  Download,
  AlertTriangle,
  Send,
  Clock,
  TrendingUp,
  UserCheck,
  Building2,
  FileSpreadsheet,
  CheckCircle,
  XCircle,
  HelpCircle,
  Filter,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { api } from '@/lib/api';

const COLORS = ['#F58220', '#1976B9', '#10B981', '#6366F1', '#EC4899', '#8B5CF6'];

export default function ApproverInsightsPage() {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split('T')[0];
  });
  const [endDate, setEndDate] = useState<string>(() => {
    return new Date().toISOString().split('T')[0];
  });
  const [idleThreshold, setIdleThreshold] = useState<number>(5);

  // Policy modal
  const [policyModal, setPolicyModal] = useState<{
    isOpen: boolean;
    action?: any;
    subject: string;
    details: string;
    suggestedPolicy: string;
  }>({
    isOpen: false,
    subject: '',
    details: '',
    suggestedPolicy: '',
  });

  // No-show note modal
  const [noteModal, setNoteModal] = useState<{
    isOpen: boolean;
    user?: any;
    note: string;
  }>({
    isOpen: false,
    note: '',
  });

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 4000);
  };

  const fetchInsights = async () => {
    setIsLoading(true);
    try {
      const res = await api.approvals.getInsights({
        startDate: new Date(startDate).toISOString(),
        endDate: new Date(endDate + 'T23:59:59.999Z').toISOString(),
        idleThresholdHours: String(idleThreshold),
      });
      setData(res);
    } catch (err: any) {
      console.error(err);
      showToast(err.message || 'Failed to load department insights.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchInsights();
  }, [startDate, endDate, idleThreshold]);

  // Export CSV
  const handleExportCSV = () => {
    if (!data || !data.resourceUtilisation) return;

    const headers = [
      'Resource Name',
      'Resource Code',
      'Category',
      'Department',
      'Building',
      'Capacity',
      'Configured Daily Hours',
      'Total Bookings',
      'Confirmed Bookings',
      'Checked-In Bookings',
      'Total Booked Hours',
      'Utilisation Rate (%)',
      'No-Show Count',
    ];

    const rows = data.resourceUtilisation.map((r: any) => [
      `"${r.resourceName}"`,
      `"${r.resourceCode}"`,
      `"${r.category}"`,
      `"${r.department}"`,
      `"${r.building}"`,
      r.capacity,
      r.operatingHours || '12h',
      r.totalBookings,
      r.confirmedBookings,
      r.checkedInBookings,
      r.totalBookedHours,
      `${r.utilizationRate}%`,
      r.noShowBookings,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e: any[]) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute(
      'download',
      `department_utilisation_insights_${startDate}_to_${endDate}.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast('Utilisation insights exported successfully as CSV.');
  };

  // Submit Policy Request
  const handleSubmitPolicyRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await api.approvals.sendPolicyRequest({
        department: policyModal.action?.department || 'Department',
        resourceId: policyModal.action?.resourceId,
        subject: policyModal.subject,
        details: policyModal.details,
        suggestedPolicy: policyModal.suggestedPolicy,
      });
      setPolicyModal({ isOpen: false, subject: '', details: '', suggestedPolicy: '' });
      showToast('Policy adjustment request sent to central administrators.');
    } catch (err: any) {
      showToast(err.message || 'Failed to send policy request.');
    }
  };

  // Submit Internal Note on No-Show
  const handleSubmitNoShowNote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!noteModal.user || !noteModal.note.trim()) return;
    try {
      await api.approvals.addNoShowNote({
        targetUserId: noteModal.user.userId,
        note: noteModal.note.trim(),
      });
      setNoteModal({ isOpen: false, note: '' });
      showToast(`Internal note recorded against repeat no-show requester.`);
      fetchInsights();
    } catch (err: any) {
      showToast(err.message || 'Failed to record internal note.');
    }
  };

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* Toast Notification */}
          {toastMessage && (
            <div className="fixed top-5 right-5 z-50 bg-[#292929] text-white px-4 py-2.5 rounded-xl shadow-lg text-xs font-semibold flex items-center gap-2 animate-in slide-in-from-top-2">
              <CheckCircle className="w-4 h-4 text-emerald-400" />
              <span>{toastMessage}</span>
            </div>
          )}

          {/* Page Header */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <Link href="/approvals" className="hover:text-gray-600">
                  Approvals
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">Department Insights</span>
              </div>
              <h1 className="text-2xl font-extrabold text-[#292929] tracking-tight">
                Department Utilisation & Operations Insights
              </h1>
              <p className="text-xs text-gray-500 mt-0.5">
                Aggregated capacity telemetry, peak demand curves, no-show monitoring, and policy recommendations.
              </p>
            </div>

            {/* Filter Bar & CSV Export */}
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-gray-200 text-xs shadow-xs">
                <Calendar className="w-3.5 h-3.5 text-gray-400" />
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="focus:outline-none text-gray-700 font-semibold"
                />
                <span className="text-gray-400">to</span>
                <input
                  type="date"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                  className="focus:outline-none text-gray-700 font-semibold"
                />
              </div>

              <button
                onClick={handleExportCSV}
                disabled={isLoading || !data}
                className="px-3.5 py-2 bg-white hover:bg-gray-50 border border-gray-200 text-gray-700 text-xs font-bold rounded-xl shadow-xs transition flex items-center gap-1.5"
              >
                <Download className="w-3.5 h-3.5 text-gray-500" />
                <span>Export CSV</span>
              </button>
            </div>
          </div>

          {/* Quick Metrics Cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-1">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                <span>Total Bookings</span>
                <Building2 className="w-4 h-4 text-[#F58220]" />
              </div>
              <div className="text-2xl font-extrabold text-gray-900">
                {isLoading ? '...' : data?.summary?.totalBookings ?? 0}
              </div>
              <div className="text-[11px] text-gray-500">
                Across {data?.summary?.totalResources ?? 0} departmental facilities
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-1">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                <span>No-Show Rate</span>
                <AlertTriangle className="w-4 h-4 text-amber-500" />
              </div>
              <div className="text-2xl font-extrabold text-amber-600">
                {isLoading ? '...' : `${data?.summary?.noShowRate ?? 0}%`}
              </div>
              <div className="text-[11px] text-gray-500">
                {data?.summary?.totalNoShows ?? 0} unverified reservations
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-1">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                <span>Avg Decision Time</span>
                <Clock className="w-4 h-4 text-blue-500" />
              </div>
              <div className="text-2xl font-extrabold text-blue-600">
                {isLoading ? '...' : `${data?.decisionMetrics?.averageDecisionTimeHours ?? 0}h`}
              </div>
              <div className="text-[11px] text-gray-500">
                {data?.decisionMetrics?.averageDecisionTimeMinutes ?? 0} minutes average
              </div>
            </div>

            <div className="bg-white p-4 rounded-2xl border border-gray-100 shadow-xs space-y-1">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider flex items-center justify-between">
                <span>Approval Ratio</span>
                <CheckCircle className="w-4 h-4 text-emerald-500" />
              </div>
              <div className="text-2xl font-extrabold text-emerald-600">
                {isLoading ? '...' : `${data?.decisionMetrics?.approveToRejectRatio?.approvalRate ?? 100}%`}
              </div>
              <div className="text-[11px] text-gray-500">
                Ratio: {data?.decisionMetrics?.approveToRejectRatio?.ratioString ?? '1 : 0'}
              </div>
            </div>
          </div>

          {/* Suggested Actions Section */}
          {data?.suggestedActions && data.suggestedActions.length > 0 && (
            <div className="bg-gradient-to-r from-amber-50 via-orange-50 to-white p-5 rounded-2xl border border-amber-200 shadow-xs space-y-3">
              <div className="flex items-center gap-2 text-amber-900 font-extrabold text-sm">
                <AlertTriangle className="w-4 h-4 text-amber-600" />
                <span>Suggested Operational & Policy Actions</span>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {data.suggestedActions.map((act: any) => (
                  <div
                    key={act.id}
                    className="p-4 bg-white/90 backdrop-blur-xs rounded-xl border border-amber-100 text-xs space-y-2 flex flex-col justify-between"
                  >
                    <div>
                      <div className="font-bold text-gray-900 text-sm">{act.title}</div>
                      <p className="text-gray-600 mt-1 leading-relaxed">{act.description}</p>
                      <div className="mt-2 p-2 bg-amber-50/70 rounded-lg text-amber-800 text-[11px]">
                        <strong>Proposed Adjustment:</strong> {act.suggestedPolicyChange}
                      </div>
                    </div>

                    <div className="pt-2 flex justify-end">
                      <button
                        onClick={() => {
                          setPolicyModal({
                            isOpen: true,
                            action: act,
                            subject: `Policy adjustment for ${act.title}`,
                            details: act.description,
                            suggestedPolicy: act.suggestedPolicyChange,
                          });
                        }}
                        className="px-3 py-1.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold text-xs rounded-lg transition flex items-center gap-1.5 shadow-2xs"
                      >
                        <Send className="w-3 h-3" />
                        <span>Request Policy Change</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Main Analytics Charts Grid */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Chart 1: Utilisation per Resource */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-[#292929]">Utilisation by Resource</h3>
                  <p className="text-[11px] text-gray-400">Total booked operating hours vs capacity</p>
                </div>
                <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                  {data?.resourceUtilisation?.length ?? 0} Venues
                </span>
              </div>
              <div className="h-64 w-full">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading chart...</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={data?.resourceUtilisation?.slice(0, 8) || []}
                      margin={{ top: 10, right: 10, left: -20, bottom: 40 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis dataKey="resourceCode" angle={-35} textAnchor="end" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} unit="%" />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#292929', color: '#fff', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Bar dataKey="utilizationRate" fill="#F58220" radius={[4, 4, 0, 0]} name="Utilisation (%)" />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Chart 2: Peak Usage Hours */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-[#292929]">Peak Demand Curve</h3>
                  <p className="text-[11px] text-gray-400">Hourly reservation distribution (08:00 - 20:00)</p>
                </div>
                <span className="text-xs font-bold text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                  Campus Hours
                </span>
              </div>
              <div className="h-64 w-full">
                {isLoading ? (
                  <div className="h-full flex items-center justify-center text-xs text-gray-400">Loading curve...</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data?.peakUsageHours || []}
                      margin={{ top: 10, right: 10, left: -20, bottom: 10 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
                      <XAxis dataKey="hour" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip
                        contentStyle={{ backgroundColor: '#292929', color: '#fff', borderRadius: '8px', fontSize: '11px' }}
                      />
                      <Line
                        type="monotone"
                        dataKey="bookingsCount"
                        stroke="#1976B9"
                        strokeWidth={2.5}
                        dot={{ r: 3 }}
                        name="Bookings"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Chart 3: Quota Usage by Role */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-[#292929]">Quota Consumption by Role</h3>
                  <p className="text-[11px] text-gray-400">Booked hours share across user classifications</p>
                </div>
              </div>
              <div className="h-64 w-full flex items-center">
                {isLoading ? (
                  <div className="h-full w-full flex items-center justify-center text-xs text-gray-400">Loading quota...</div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={data?.quotaUsage?.filter((q: any) => q.totalHours > 0) || []}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={5}
                        dataKey="totalHours"
                        nameKey="role"
                        label={(entry) => `${entry.role}: ${entry.totalHours}h`}
                      >
                        {(data?.quotaUsage || []).map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip />
                    </PieChart>
                  </ResponsiveContainer>
                )}
              </div>
            </div>

            {/* Idle Resources Table */}
            <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-extrabold text-sm text-[#292929]">Under-Utilised / Idle Resources</h3>
                  <p className="text-[11px] text-gray-400">Venues below threshold ({idleThreshold}h or &lt; 20%)</p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-gray-500">
                  <span>Threshold:</span>
                  <select
                    value={idleThreshold}
                    onChange={(e) => setIdleThreshold(Number(e.target.value))}
                    className="p-1 border border-gray-200 rounded font-semibold text-xs"
                  >
                    <option value={3}>3 Hours</option>
                    <option value={5}>5 Hours</option>
                    <option value={10}>10 Hours</option>
                    <option value={20}>20 Hours</option>
                  </select>
                </div>
              </div>

              <div className="overflow-x-auto max-h-56">
                <table className="w-full text-left text-xs">
                  <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                    <tr>
                      <th className="p-2">Resource</th>
                      <th className="p-2">Building</th>
                      <th className="p-2">Booked Hours</th>
                      <th className="p-2">Utilisation</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {data?.idleResources?.length === 0 ? (
                      <tr>
                        <td colSpan={4} className="p-4 text-center text-gray-400 italic">
                          No idle resources detected below current threshold.
                        </td>
                      </tr>
                    ) : (
                      data?.idleResources?.map((ir: any) => (
                        <tr key={ir.resourceId} className="hover:bg-gray-50">
                          <td className="p-2 font-bold text-gray-900">{ir.resourceName}</td>
                          <td className="p-2 text-gray-500">{ir.building}</td>
                          <td className="p-2 font-semibold text-gray-700">{ir.totalBookedHours} hrs</td>
                          <td className="p-2 font-black text-amber-600">{ir.utilizationRate}%</td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Repeat No-Show Table & Interventions */}
          <div className="bg-white p-5 rounded-2xl border border-gray-100 shadow-xs space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="font-extrabold text-sm text-[#292929]">Repeat No-Show Requesters</h3>
                <p className="text-[11px] text-gray-400">
                  Users with multiple confirmed reservations that failed to check-in (≥ 2 no-shows)
                </p>
              </div>
              <span className="text-xs font-bold text-red-600 bg-red-50 border border-red-200 px-2.5 py-0.5 rounded-full">
                {data?.noShowMetrics?.repeatNoShowRequesters?.length ?? 0} High-Risk Requesters
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-gray-50 text-gray-500 font-bold border-b border-gray-100">
                  <tr>
                    <th className="p-3">Requester Name</th>
                    <th className="p-3">Email & Role</th>
                    <th className="p-3">No-Show Count</th>
                    <th className="p-3">Total Requests</th>
                    <th className="p-3">No-Show %</th>
                    <th className="p-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {data?.noShowMetrics?.repeatNoShowRequesters?.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-6 text-center text-gray-400 italic">
                        No repeat no-show requesters identified in this date range.
                      </td>
                    </tr>
                  ) : (
                    data?.noShowMetrics?.repeatNoShowRequesters?.map((u: any) => (
                      <tr key={u.userId} className="hover:bg-gray-50">
                        <td className="p-3 font-bold text-gray-900">{u.name}</td>
                        <td className="p-3 text-gray-500">
                          {u.email} <span className="text-[10px] bg-gray-100 px-1.5 py-0.5 rounded font-bold">({u.role})</span>
                        </td>
                        <td className="p-3 font-extrabold text-red-600">{u.noShowCount} missed</td>
                        <td className="p-3 text-gray-600">{u.totalBookings}</td>
                        <td className="p-3 font-bold text-red-700">{u.noShowRate}%</td>
                        <td className="p-3 text-right">
                          <button
                            onClick={() => {
                              setNoteModal({
                                isOpen: true,
                                user: u,
                                note: '',
                              });
                            }}
                            className="px-3 py-1 bg-gray-100 hover:bg-gray-200 text-gray-800 font-bold text-xs rounded-lg transition shadow-2xs"
                          >
                            + Add Internal Note
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </main>
      </div>

      {/* Policy Change Request Modal */}
      {policyModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-gray-100">
              <h3 className="font-extrabold text-base text-gray-900 flex items-center gap-2">
                <Send className="w-4 h-4 text-[#F58220]" />
                <span>Submit Policy Modification Request</span>
              </h3>
              <button
                onClick={() => setPolicyModal({ isOpen: false, subject: '', details: '', suggestedPolicy: '' })}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmitPolicyRequest} className="space-y-3 text-xs">
              <div>
                <label className="block text-gray-500 font-bold mb-1">Subject</label>
                <input
                  type="text"
                  value={policyModal.subject}
                  onChange={(e) => setPolicyModal({ ...policyModal, subject: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:border-[#F58220] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-gray-500 font-bold mb-1">Telemetry Observation & Details</label>
                <textarea
                  rows={3}
                  value={policyModal.details}
                  onChange={(e) => setPolicyModal({ ...policyModal, details: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:border-[#F58220] focus:outline-none"
                  required
                />
              </div>

              <div>
                <label className="block text-gray-500 font-bold mb-1">Proposed Policy Adjustment</label>
                <textarea
                  rows={2}
                  value={policyModal.suggestedPolicy}
                  onChange={(e) => setPolicyModal({ ...policyModal, suggestedPolicy: e.target.value })}
                  className="w-full p-2.5 border border-gray-200 rounded-xl focus:border-[#F58220] focus:outline-none"
                  required
                />
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPolicyModal({ isOpen: false, subject: '', details: '', suggestedPolicy: '' })}
                  className="px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-xs"
                >
                  Dispatch to Admins
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Internal Note Modal on Repeat No-Show User */}
      {noteModal.isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-xs p-4 animate-in fade-in">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b pb-3 border-gray-100">
              <h3 className="font-extrabold text-base text-gray-900 flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <span>Internal Note: {noteModal.user?.name}</span>
              </h3>
              <button
                onClick={() => setNoteModal({ isOpen: false, note: '' })}
                className="text-gray-400 hover:text-gray-600"
              >
                ✕
              </button>
            </div>

            <p className="text-xs text-gray-500">
              Record a confidential warning note regarding this requester's repeat no-shows. This note is strictly shielded from the student and visible only to authorized department approvers and administrators.
            </p>

            <form onSubmit={handleSubmitNoShowNote} className="space-y-3 text-xs">
              <textarea
                rows={4}
                value={noteModal.note}
                onChange={(e) => setNoteModal({ ...noteModal, note: e.target.value })}
                placeholder="Enter approver internal observations or flagged disciplinary note..."
                className="w-full p-3 border border-gray-200 rounded-xl focus:border-[#F58220] focus:outline-none"
                required
              />

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setNoteModal({ isOpen: false, note: '' })}
                  className="px-4 py-2 border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600 font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-[#292929] hover:bg-black text-white font-bold rounded-xl shadow-xs"
                >
                  Save Internal Note
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
