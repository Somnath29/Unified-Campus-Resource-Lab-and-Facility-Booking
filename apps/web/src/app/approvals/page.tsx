'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  CheckSquare,
  Square,
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
  ChevronLeft,
  ShieldAlert,
  Calendar,
  MessageSquare,
  RefreshCw,
  ArrowUpDown,
  Building,
  FileText,
  Send,
  HelpCircle,
  Eye,
  Info,
  Layers,
  Sparkles,
} from 'lucide-react';
import { Sidebar } from '@/components/layout/Sidebar';
import { Navbar } from '@/components/layout/Navbar';
import { useAuth } from '@/lib/auth-context';
import { api } from '@/lib/api';
import {
  BookingDTO,
  ResourceDTO,
  EnrichedApprovalItemDTO,
  ApprovalStatsDTO,
  ApprovalQueueResponseDTO,
  ResourceCategory,
  UserRole,
} from '@lpu/shared';

// Toast Notification Type
interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
  title?: string;
}

export default function ApprovalsPage() {
  const { user, isLoading: authLoading, demoLogin } = useAuth();

  // Data State
  const [requests, setRequests] = useState<EnrichedApprovalItemDTO[]>([]);
  const [stats, setStats] = useState<ApprovalStatsDTO | null>(null);
  const [allResources, setAllResources] = useState<ResourceDTO[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isStatsLoading, setIsStatsLoading] = useState(false);
  const [totalRequests, setTotalRequests] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filters & Pagination State
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('PENDING');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const [requesterRoleFilter, setRequesterRoleFilter] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'createdAt' | 'startTime' | 'priority' | 'slaDueAt'>('createdAt');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [showAdvancedFilters, setShowAdvancedFilters] = useState(false);

  // Selection & Keyboard Navigation State
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedIndex, setFocusedIndex] = useState<number>(-1);

  // Detail Slide-Over Drawer State
  const [drawerBookingId, setDrawerBookingId] = useState<string | null>(null);
  const [drawerDetails, setDrawerDetails] = useState<any>(null);
  const [isLoadingDrawer, setIsLoadingDrawer] = useState(false);
  const [drawerTab, setDrawerTab] = useState<'OVERVIEW' | 'TIMELINE' | 'POLICY_COMMENTS'>('OVERVIEW');
  const [drawerTimetable, setDrawerTimetable] = useState<any[]>([]);
  const [drawerNeighbours, setDrawerNeighbours] = useState<any[]>([]);
  const [isLoadingSchedule, setIsLoadingSchedule] = useState(false);
  const [newComment, setNewComment] = useState('');
  const [isInternalComment, setIsInternalComment] = useState(false);
  const [isPostingComment, setIsPostingComment] = useState(false);

  // Decision Modals State
  const [actionModal, setActionModal] = useState<{
    type: 'APPROVE' | 'REJECT' | 'MODIFY' | 'REQUEST_INFO' | 'BULK_APPROVE' | 'BULK_REJECT';
    booking?: EnrichedApprovalItemDTO;
  } | null>(null);

  // Action Form Inputs
  const [approveNotes, setApproveNotes] = useState('');
  const [rejectionReason, setRejectionReason] = useState('');
  const [requestInfoQuestion, setRequestInfoQuestion] = useState('');
  const [modifyResourceId, setModifiedResourceId] = useState('');
  const [modifyStartDate, setModifyStartDate] = useState('');
  const [modifyStartTime, setModifyStartTime] = useState('');
  const [modifyEndDate, setModifyEndDate] = useState('');
  const [modifyEndTime, setModifyEndTime] = useState('');
  const [modifyNotes, setModifyNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [bulkProgress, setBulkProgress] = useState<{ processed: number; total: number; success: number; failed: number } | null>(null);

  // Toasts State
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Presets
  const REJECT_PRESETS = [
    'Facility undergoing mandatory maintenance or scheduled safety inspection.',
    'Official university event / administrative inspection scheduled during this period.',
    'Expected attendance exceeds permissible room safety capacity limits.',
    'Conflicts with department resource allocation guidelines and timetable rules.',
    'Please reschedule for an alternative open time slot or lecture hall.',
  ];

  const REQUEST_INFO_PRESETS = [
    'Please provide faculty mentor endorsement or official departmental permission letter.',
    'Please clarify the detailed session agenda and list of specialized equipment required.',
    'Please confirm the faculty supervisor who will be physically present in the lab.',
  ];

  // Helper: Toast Dispatcher
  const showToast = useCallback((type: 'success' | 'error' | 'info', message: string, title?: string) => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts((prev) => [...prev, { id, type, message, title }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  }, []);

  // Debounce search input
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  // Load Initial Resources & Stats
  useEffect(() => {
    api.resources.list().then((r) => setAllResources(r.resources || [])).catch(() => {});
    fetchStats();
  }, []);

  // Fetch Queue requests whenever filters, sorting, or pagination change
  useEffect(() => {
    fetchRequests();
  }, [
    debouncedSearch,
    statusFilter,
    departmentFilter,
    categoryFilter,
    requesterRoleFilter,
    fromDate,
    toDate,
    overdueOnly,
    sortBy,
    sortOrder,
    page,
    limit,
  ]);

  const fetchStats = async () => {
    try {
      setIsStatsLoading(true);
      const res = await api.approvals.getStats();
      setStats(res);
    } catch (err: any) {
      console.error('Failed to fetch approval stats:', err);
    } finally {
      setIsStatsLoading(false);
    }
  };

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const params: Record<string, any> = {
        page,
        limit,
        sortBy,
        sortOrder,
      };

      if (statusFilter && statusFilter !== 'ALL') params.status = statusFilter;
      if (debouncedSearch) params.search = debouncedSearch;
      if (departmentFilter) params.department = departmentFilter;
      if (categoryFilter) params.category = categoryFilter;
      if (requesterRoleFilter) params.requesterRole = requesterRoleFilter;
      if (fromDate) params.from = new Date(fromDate).toISOString();
      if (toDate) params.to = new Date(toDate).toISOString();
      if (overdueOnly) params.overdue = 'true';

      const res: ApprovalQueueResponseDTO = await api.approvals.list(params);
      setRequests(res.requests || []);
      setTotalRequests(res.total || 0);
      setTotalPages(res.totalPages || 1);
      // Reset selected checkboxes for new page
      setSelectedIds(new Set());
    } catch (err: any) {
      showToast('error', err.message || 'Failed to fetch approval queue.', 'Error Loading Queue');
    } finally {
      setIsLoading(false);
    }
  };

  // Fetch Detailed Drawer Data
  const fetchDrawerDetails = async (id: string) => {
    setIsLoadingDrawer(true);
    setDrawerDetails(null);
    try {
      const res = await api.approvals.getById(id);
      const item = res.request;
      setDrawerDetails(item);

      // Fetch timetable & neighbouring bookings for the mini calendar
      if (item.resourceId) {
        setIsLoadingSchedule(true);
        const bookingDate = new Date(item.startTime);
        const dayOfWeek = bookingDate.getDay();

        // 1. Timetable classes
        const ttRes = await api.timetable.list({
          resourceId: item.resourceId,
          dayOfWeek: String(dayOfWeek),
        });
        setDrawerTimetable(ttRes.timetable || []);

        // 2. Other bookings on that resource
        const bRes = await api.bookings.list({
          resourceId: item.resourceId,
        });
        // Filter to same day
        const sameDayBookings = (bRes.bookings || []).filter((b: BookingDTO) => {
          const d = new Date(b.startTime);
          return (
            d.getFullYear() === bookingDate.getFullYear() &&
            d.getMonth() === bookingDate.getMonth() &&
            d.getDate() === bookingDate.getDate()
          );
        });
        setDrawerNeighbours(sameDayBookings);
        setIsLoadingSchedule(false);
      }
    } catch (err: any) {
      showToast('error', err.message || 'Failed to load booking details.', 'Error');
    } finally {
      setIsLoadingDrawer(false);
    }
  };

  const handleOpenDrawer = (booking: EnrichedApprovalItemDTO) => {
    setDrawerBookingId(booking.id);
    fetchDrawerDetails(booking.id);
  };

  const handleCloseDrawer = () => {
    setDrawerBookingId(null);
    setDrawerDetails(null);
    setDrawerTimetable([]);
    setDrawerNeighbours([]);
  };

  // --------------------------------------------------------------------------
  // Selection Handling
  // --------------------------------------------------------------------------
  const isAllSelected = requests.length > 0 && requests.every((r) => selectedIds.has(r.id));

  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(requests.map((r) => r.id)));
    }
  };

  const toggleSelectOne = (id: string) => {
    const updated = new Set(selectedIds);
    if (updated.has(id)) {
      updated.delete(id);
    } else {
      updated.add(id);
    }
    setSelectedIds(updated);
  };

  // --------------------------------------------------------------------------
  // Keyboard Shortcuts (J, K, A, R, Esc)
  // --------------------------------------------------------------------------
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in form controls
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement ||
        (e.target as HTMLElement).isContentEditable
      ) {
        return;
      }

      // Ignore if action modal is currently open
      if (actionModal !== null) {
        if (e.key === 'Escape') {
          setActionModal(null);
        }
        return;
      }

      // Escape closes drawer
      if (e.key === 'Escape' && drawerBookingId) {
        handleCloseDrawer();
        return;
      }

      // J: Next booking
      if (e.key === 'j' || e.key === 'J') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.min(requests.length - 1, prev + 1);
          if (drawerBookingId && requests[next]) {
            handleOpenDrawer(requests[next]);
          }
          return next;
        });
        return;
      }

      // K: Previous booking
      if (e.key === 'k' || e.key === 'K') {
        e.preventDefault();
        setFocusedIndex((prev) => {
          const next = Math.max(0, prev - 1);
          if (drawerBookingId && requests[next]) {
            handleOpenDrawer(requests[next]);
          }
          return next;
        });
        return;
      }

      // Determine active target booking (drawer booking or focused table item)
      const targetBooking =
        (drawerBookingId ? requests.find((r) => r.id === drawerBookingId) : null) ||
        (focusedIndex >= 0 && focusedIndex < requests.length ? requests[focusedIndex] : null);

      if (!targetBooking) return;

      // A: Approve Shortcut
      if (e.key === 'a' || e.key === 'A') {
        e.preventDefault();
        setApproveNotes('');
        setActionModal({ type: 'APPROVE', booking: targetBooking });
        return;
      }

      // R: Reject Shortcut
      if (e.key === 'r' || e.key === 'R') {
        e.preventDefault();
        setRejectionReason('');
        setActionModal({ type: 'REJECT', booking: targetBooking });
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [requests, focusedIndex, drawerBookingId, actionModal]);

  // --------------------------------------------------------------------------
  // Optimistic Decision Execution with Rollback on Failure
  // --------------------------------------------------------------------------
  const executeDecision = async (
    bookingId: string,
    actionPayload: any,
    optimisticStatus: 'CONFIRMED' | 'REJECTED' | 'NEEDS_INFO'
  ) => {
    // 1. Snapshot previous states for rollback
    const previousRequests = [...requests];
    const previousStats = stats ? { ...stats } : null;

    // 2. Apply Optimistic Update
    setRequests((prev) =>
      prev.map((r) =>
        r.id === bookingId
          ? {
              ...r,
              status: optimisticStatus,
              approvalNotes: actionPayload.notes || r.approvalNotes,
              rejectionReason: actionPayload.reason || r.rejectionReason,
            }
          : r
      )
    );

    // If viewing in drawer, update drawer state optimistically
    if (drawerDetails && drawerDetails.id === bookingId) {
      setDrawerDetails((prev: any) => ({
        ...prev,
        status: optimisticStatus,
      }));
    }

    try {
      const result = await api.approvals.takeAction(bookingId, actionPayload);
      showToast(
        'success',
        `Reservation ${result.booking?.bookingNumber || bookingId} ${optimisticStatus.toLowerCase()} successfully.`,
        'Action Processed'
      );
      // Refresh statistics and list confirmation
      fetchStats();
      fetchRequests();
      if (drawerBookingId === bookingId) {
        fetchDrawerDetails(bookingId);
      }
      return { success: true, result };
    } catch (err: any) {
      // 3. Rollback on failure
      setRequests(previousRequests);
      setStats(previousStats);
      if (drawerDetails && drawerDetails.id === bookingId) {
        setDrawerDetails((prev: any) => ({
          ...prev,
          status: previousRequests.find((r) => r.id === bookingId)?.status || prev.status,
        }));
      }
      showToast('error', err.message || 'Action failed to execute on server.', 'Decision Rolled Back');
      return { success: false, error: err.message };
    }
  };

  // --------------------------------------------------------------------------
  // Form Submission Handlers
  // --------------------------------------------------------------------------
  const handleApproveSubmit = async () => {
    if (!actionModal?.booking) return;
    setIsSubmitting(true);
    try {
      await executeDecision(
        actionModal.booking.id,
        {
          action: 'APPROVE',
          notes: approveNotes || 'Approved per department guidelines.',
        },
        'CONFIRMED'
      );
      setActionModal(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRejectSubmit = async () => {
    if (!actionModal?.booking) return;
    if (rejectionReason.trim().length < 10) {
      showToast('error', 'Rejection reason must be at least 10 characters long.', 'Validation Error');
      return;
    }
    setIsSubmitting(true);
    try {
      await executeDecision(
        actionModal.booking.id,
        {
          action: 'REJECT',
          reason: rejectionReason.trim(),
        },
        'REJECTED'
      );
      setActionModal(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRequestInfoSubmit = async () => {
    if (!actionModal?.booking) return;
    if (requestInfoQuestion.trim().length < 5) {
      showToast('error', 'Clarification question must be at least 5 characters long.', 'Validation Error');
      return;
    }
    setIsSubmitting(true);
    try {
      await executeDecision(
        actionModal.booking.id,
        {
          action: 'REQUEST_INFO',
          question: requestInfoQuestion.trim(),
        },
        'NEEDS_INFO'
      );
      setActionModal(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleModifyOpen = (booking: EnrichedApprovalItemDTO) => {
    setModifiedResourceId(booking.resourceId);
    const start = new Date(booking.startTime);
    const end = new Date(booking.endTime);

    setModifyStartDate(start.toISOString().split('T')[0]);
    setModifyStartTime(start.toTimeString().substring(0, 5));
    setModifyEndDate(end.toISOString().split('T')[0]);
    setModifyEndTime(end.toTimeString().substring(0, 5));
    setModifyNotes('');
    setActionModal({ type: 'MODIFY', booking });
  };

  const handleModifySubmit = async () => {
    if (!actionModal?.booking) return;
    if (modifyNotes.trim().length < 10) {
      showToast('error', 'Modification reason must be at least 10 characters long.', 'Validation Error');
      return;
    }

    const newStart = new Date(`${modifyStartDate}T${modifyStartTime}:00`);
    const newEnd = new Date(`${modifyEndDate}T${modifyEndTime}:00`);

    if (isNaN(newStart.getTime()) || isNaN(newEnd.getTime())) {
      showToast('error', 'Invalid date or time format provided.', 'Validation Error');
      return;
    }

    if (newEnd <= newStart) {
      showToast('error', 'End time must be strictly after start time.', 'Validation Error');
      return;
    }

    setIsSubmitting(true);
    try {
      await executeDecision(
        actionModal.booking.id,
        {
          action: 'MODIFY',
          alternateResourceId: modifyResourceId !== actionModal.booking.resourceId ? modifyResourceId : undefined,
          newStartTime: newStart.toISOString(),
          newEndTime: newEnd.toISOString(),
          notes: modifyNotes.trim(),
        },
        'CONFIRMED'
      );
      setActionModal(null);
    } finally {
      setIsSubmitting(false);
    }
  };

  // --------------------------------------------------------------------------
  // Bulk Actions Processing
  // --------------------------------------------------------------------------
  const handleBulkApprove = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    setIsSubmitting(true);
    setBulkProgress({ processed: 0, total: ids.length, success: 0, failed: 0 });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await api.approvals.takeAction(id, {
          action: 'APPROVE',
          notes: 'Bulk approved by department approver.',
        });
        successCount++;
      } catch (err) {
        failCount++;
      }
      setBulkProgress({
        processed: i + 1,
        total: ids.length,
        success: successCount,
        failed: failCount,
      });
    }

    showToast(
      successCount > 0 ? 'success' : 'error',
      `Bulk Approve complete: ${successCount} approved, ${failCount} failed.`,
      'Bulk Operation Finished'
    );
    setIsSubmitting(false);
    setActionModal(null);
    setSelectedIds(new Set());
    fetchStats();
    fetchRequests();
  };

  const handleBulkReject = async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    if (rejectionReason.trim().length < 10) {
      showToast('error', 'Rejection reason must be at least 10 characters long.', 'Validation Error');
      return;
    }

    setIsSubmitting(true);
    setBulkProgress({ processed: 0, total: ids.length, success: 0, failed: 0 });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < ids.length; i++) {
      const id = ids[i];
      try {
        await api.approvals.takeAction(id, {
          action: 'REJECT',
          reason: rejectionReason.trim(),
        });
        successCount++;
      } catch (err) {
        failCount++;
      }
      setBulkProgress({
        processed: i + 1,
        total: ids.length,
        success: successCount,
        failed: failCount,
      });
    }

    showToast(
      successCount > 0 ? 'success' : 'error',
      `Bulk Reject complete: ${successCount} rejected, ${failCount} failed.`,
      'Bulk Operation Finished'
    );
    setIsSubmitting(false);
    setActionModal(null);
    setSelectedIds(new Set());
    fetchStats();
    fetchRequests();
  };

  // --------------------------------------------------------------------------
  // Comment Submission in Drawer
  // --------------------------------------------------------------------------
  const handlePostComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!drawerBookingId || !newComment.trim()) return;
    setIsPostingComment(true);
    try {
      await api.approvals.addComment(drawerBookingId, {
        body: newComment.trim(),
        isInternal: isInternalComment,
      });
      setNewComment('');
      fetchDrawerDetails(drawerBookingId);
      showToast('success', 'Note added to request thread.', 'Comment Posted');
    } catch (err: any) {
      showToast('error', err.message || 'Failed to post note.', 'Error');
    } finally {
      setIsPostingComment(false);
    }
  };

  // Distinct departments for filter dropdown
  const uniqueDepartments = Array.from(
    new Set(allResources.map((r) => r.department).filter(Boolean))
  ).sort();

  // --------------------------------------------------------------------------
  // Security Role Guard
  // --------------------------------------------------------------------------
  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex items-center justify-center p-6">
        <div className="text-center space-y-3">
          <div className="w-10 h-10 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto" />
          <p className="text-xs font-semibold text-gray-500">Verifying Approver Credentials...</p>
        </div>
      </div>
    );
  }

  const isAuthorized =
    user?.role === 'DEPARTMENT_APPROVER' || user?.role === 'ADMINISTRATOR';

  if (!isAuthorized) {
    return (
      <div className="min-h-screen bg-[#F5F5F5] flex">
        <Sidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <Navbar />
          <main className="flex-1 p-6 lg:p-12 flex items-center justify-center">
            <div className="bg-white rounded-3xl p-10 max-w-lg w-full text-center border border-gray-100 shadow-xl space-y-5">
              <div className="w-16 h-16 bg-red-50 text-red-600 rounded-2xl flex items-center justify-center mx-auto border border-red-100">
                <ShieldAlert className="w-8 h-8" />
              </div>
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">
                Access Restricted
              </h2>
              <p className="text-xs text-gray-500 leading-relaxed">
                The Facility Allocation Approval Queue is strictly reserved for designated{' '}
                <strong className="text-gray-800">Department Approvers</strong> and{' '}
                <strong className="text-gray-800">Administrators</strong>. Your current profile role is{' '}
                <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-[#F58220]">
                  {user?.role || 'STUDENT'}
                </span>
                .
              </p>
              <div className="pt-2 flex flex-col sm:flex-row gap-3">
                <Link
                  href="/"
                  className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition text-center"
                >
                  Return to Dashboard
                </Link>
                <button
                  onClick={() => demoLogin('DEPARTMENT_APPROVER')}
                  className="flex-1 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl transition shadow-sm"
                >
                  Switch to Approver Role
                </button>
              </div>
            </div>
          </main>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F5F5F5] flex">
      <Sidebar />

      <div className="flex-1 flex flex-col min-w-0">
        <Navbar />

        <main className="flex-1 p-4 sm:p-6 lg:p-8 max-w-7xl mx-auto w-full space-y-6">
          {/* 1. Header & Live Statistics */}
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div>
              <div className="text-xs text-gray-400 flex items-center gap-1.5 mb-1">
                <Link href="/" className="hover:text-gray-600">
                  Dashboard
                </Link>
                <span>›</span>
                <span className="text-[#F58220] font-semibold">Department Approvals</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold text-[#292929] tracking-tight flex items-center gap-3">
                <span>Approval Decision Queue</span>
                <span className="bg-[#FFF4EA] text-[#F58220] text-xs font-bold px-2.5 py-0.5 rounded-full border border-[#FED7AA]">
                  {user.role === 'ADMINISTRATOR' ? 'Admin Scope' : 'Dept Scope'}
                </span>
              </h1>
              <p className="text-xs text-gray-500 mt-1">
                Review, verify, adjust, and approve campus facility reservations in your department.
              </p>
            </div>

            {/* Top Shortcut & Refresh Bar */}
            <div className="flex items-center gap-2 self-start md:self-auto">
              <div className="hidden lg:flex items-center gap-2 text-[11px] font-mono bg-white px-3 py-1.5 rounded-xl border border-gray-200 text-gray-500 shadow-2xs">
                <span className="text-gray-400">Shortcuts:</span>
                <kbd className="bg-gray-100 px-1.5 py-0.5 rounded font-bold text-gray-700">J/K</kbd>
                <span>Navigate</span>
                <kbd className="bg-emerald-50 px-1.5 py-0.5 rounded font-bold text-emerald-700">A</kbd>
                <span>Approve</span>
                <kbd className="bg-red-50 px-1.5 py-0.5 rounded font-bold text-red-700">R</kbd>
                <span>Reject</span>
              </div>

              <button
                onClick={() => {
                  fetchStats();
                  fetchRequests();
                }}
                disabled={isLoading || isStatsLoading}
                className="px-3 py-2 bg-white hover:bg-gray-50 text-gray-700 text-xs font-bold rounded-xl border border-gray-200 shadow-2xs transition flex items-center gap-1.5"
                title="Refresh queue and statistics"
              >
                <RefreshCw
                  className={`w-3.5 h-3.5 ${isLoading || isStatsLoading ? 'animate-spin text-[#F58220]' : 'text-gray-500'}`}
                />
                <span className="hidden sm:inline">Refresh</span>
              </button>
            </div>
          </div>

          {/* Metric KPI Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4">
            <div
              onClick={() => {
                setStatusFilter('PENDING');
                setOverdueOnly(false);
                setPage(1);
              }}
              className={`p-4 rounded-2xl border transition cursor-pointer ${
                statusFilter === 'PENDING' && !overdueOnly
                  ? 'bg-amber-50/70 border-amber-300 shadow-xs'
                  : 'bg-white border-gray-200 hover:border-amber-200 shadow-2xs'
              }`}
            >
              <div className="text-[11px] font-bold text-amber-800 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Pending</span>
                <Clock className="w-3.5 h-3.5 text-amber-500" />
              </div>
              <div className="text-2xl font-black text-gray-900">
                {stats?.pending ?? '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Awaiting decision</div>
            </div>

            <div
              onClick={() => {
                setStatusFilter('PENDING');
                setOverdueOnly(true);
                setPage(1);
              }}
              className={`p-4 rounded-2xl border transition cursor-pointer ${
                overdueOnly
                  ? 'bg-red-50 border-red-300 shadow-xs'
                  : 'bg-white border-gray-200 hover:border-red-200 shadow-2xs'
              }`}
            >
              <div className="text-[11px] font-bold text-red-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>SLA Overdue</span>
                <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
              </div>
              <div className="text-2xl font-black text-red-600">
                {stats?.overdue ?? '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Urgent SLA breached</div>
            </div>

            <div
              onClick={() => {
                setStatusFilter('NEEDS_INFO');
                setOverdueOnly(false);
                setPage(1);
              }}
              className={`p-4 rounded-2xl border transition cursor-pointer ${
                statusFilter === 'NEEDS_INFO'
                  ? 'bg-purple-50 border-purple-300 shadow-xs'
                  : 'bg-white border-gray-200 hover:border-purple-200 shadow-2xs'
              }`}
            >
              <div className="text-[11px] font-bold text-purple-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Needs Info</span>
                <HelpCircle className="w-3.5 h-3.5 text-purple-500" />
              </div>
              <div className="text-2xl font-black text-purple-700">
                {stats?.needsInfoCount ?? '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Waiting on requester</div>
            </div>

            <div
              onClick={() => {
                setStatusFilter('CONFIRMED');
                setOverdueOnly(false);
                setPage(1);
              }}
              className={`p-4 rounded-2xl border transition cursor-pointer ${
                statusFilter === 'CONFIRMED'
                  ? 'bg-emerald-50 border-emerald-300 shadow-xs'
                  : 'bg-white border-gray-200 hover:border-emerald-200 shadow-2xs'
              }`}
            >
              <div className="text-[11px] font-bold text-emerald-700 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Approved Today</span>
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
              </div>
              <div className="text-2xl font-black text-emerald-600">
                {stats?.approvedToday ?? '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">Confirmed allocations</div>
            </div>

            <div className="p-4 rounded-2xl bg-white border border-gray-200 shadow-2xs col-span-2 sm:col-span-1">
              <div className="text-[11px] font-bold text-gray-500 uppercase tracking-wider mb-1 flex items-center justify-between">
                <span>Avg Decision Time</span>
                <Sparkles className="w-3.5 h-3.5 text-[#F58220]" />
              </div>
              <div className="text-2xl font-black text-gray-900">
                {stats ? `${stats.averageDecisionTimeMinutes}m` : '—'}
              </div>
              <div className="text-[11px] text-gray-400 mt-0.5">From submit to action</div>
            </div>
          </div>

          {/* 2. Search, Status Tabs & Filters Bar */}
          <div className="bg-white p-4 sm:p-5 rounded-3xl border border-gray-200 shadow-2xs space-y-4">
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
              {/* Status Segmented Tabs */}
              <div className="flex bg-[#F5F5F5] p-1 rounded-2xl border border-gray-200 text-xs font-bold shrink-0 overflow-x-auto">
                {[
                  { key: 'PENDING', label: 'Pending Requests' },
                  { key: 'NEEDS_INFO', label: 'Needs Info' },
                  { key: 'CONFIRMED', label: 'Approved' },
                  { key: 'REJECTED', label: 'Declined' },
                  { key: 'ALL', label: 'All Requests' },
                ].map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => {
                      setStatusFilter(tab.key);
                      setPage(1);
                    }}
                    className={`px-3.5 py-2 rounded-xl transition whitespace-nowrap ${
                      statusFilter === tab.key
                        ? 'bg-[#F58220] text-white shadow-xs'
                        : 'text-gray-600 hover:text-gray-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Search Box & Advanced Filters Toggle */}
              <div className="flex items-center gap-2 w-full lg:w-auto">
                <div className="relative flex-1 lg:w-72">
                  <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search ref #, student, email..."
                    className="w-full pl-9 pr-3 py-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 placeholder-gray-400 focus:outline-none focus:border-[#F58220] focus:bg-white transition"
                  />
                  {search && (
                    <button
                      onClick={() => setSearch('')}
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <button
                  onClick={() => setShowAdvancedFilters(!showAdvancedFilters)}
                  className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition ${
                    showAdvancedFilters ||
                    departmentFilter ||
                    categoryFilter ||
                    requesterRoleFilter ||
                    fromDate ||
                    toDate ||
                    overdueOnly
                      ? 'bg-[#FFF4EA] border-[#FED7AA] text-[#F58220]'
                      : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>Filters</span>
                  {(departmentFilter || categoryFilter || requesterRoleFilter || fromDate || toDate || overdueOnly) && (
                    <span className="w-2 h-2 rounded-full bg-[#F58220]" />
                  )}
                </button>
              </div>
            </div>

            {/* Advanced Filters Expandable Panel */}
            {showAdvancedFilters && (
              <div className="pt-3 border-t border-gray-100 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 animate-in fade-in duration-150">
                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Department
                  </label>
                  <select
                    value={departmentFilter}
                    onChange={(e) => {
                      setDepartmentFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                  >
                    <option value="">All Departments</option>
                    {uniqueDepartments.map((dept) => (
                      <option key={dept} value={dept}>
                        {dept}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Facility Category
                  </label>
                  <select
                    value={categoryFilter}
                    onChange={(e) => {
                      setCategoryFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                  >
                    <option value="">All Categories</option>
                    <option value="CLASSROOM">Classroom</option>
                    <option value="LAB">Laboratory</option>
                    <option value="SEMINAR_HALL">Seminar Hall</option>
                    <option value="MEETING_ROOM">Meeting Room</option>
                    <option value="SPORTS">Sports Facility</option>
                    <option value="EQUIPMENT">Equipment</option>
                    <option value="VEHICLE">Campus Vehicle</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Requester Role
                  </label>
                  <select
                    value={requesterRoleFilter}
                    onChange={(e) => {
                      setRequesterRoleFilter(e.target.value);
                      setPage(1);
                    }}
                    className="w-full p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                  >
                    <option value="">All Roles</option>
                    <option value="STUDENT">Student</option>
                    <option value="FACULTY">Faculty Member</option>
                    <option value="DEPARTMENT_APPROVER">Department Approver</option>
                    <option value="ADMINISTRATOR">Administrator</option>
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-gray-600 mb-1">
                    Date Range (From - To)
                  </label>
                  <div className="flex gap-1.5">
                    <input
                      type="date"
                      value={fromDate}
                      onChange={(e) => {
                        setFromDate(e.target.value);
                        setPage(1);
                      }}
                      className="w-1/2 p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                    />
                    <input
                      type="date"
                      value={toDate}
                      onChange={(e) => {
                        setToDate(e.target.value);
                        setPage(1);
                      }}
                      className="w-1/2 p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                    />
                  </div>
                </div>

                <div className="flex items-end gap-2">
                  <label className="flex items-center gap-2 p-2 bg-[#F9F9F9] border border-gray-200 rounded-xl text-xs text-gray-800 cursor-pointer w-full select-none">
                    <input
                      type="checkbox"
                      checked={overdueOnly}
                      onChange={(e) => {
                        setOverdueOnly(e.target.checked);
                        setPage(1);
                      }}
                      className="rounded text-[#F58220] focus:ring-[#F58220]"
                    />
                    <span className="font-semibold text-red-600">Overdue SLA Only</span>
                  </label>

                  {(departmentFilter || categoryFilter || requesterRoleFilter || fromDate || toDate || overdueOnly) && (
                    <button
                      onClick={() => {
                        setDepartmentFilter('');
                        setCategoryFilter('');
                        setRequesterRoleFilter('');
                        setFromDate('');
                        setToDate('');
                        setOverdueOnly(false);
                        setPage(1);
                      }}
                      className="p-2 text-xs font-bold text-gray-500 hover:text-gray-800 hover:bg-gray-100 rounded-xl transition shrink-0"
                      title="Clear all filters"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 3. Bulk Action Floating Bar */}
          {selectedIds.size > 0 && (
            <div className="bg-[#292929] text-white p-3.5 sm:px-6 rounded-2xl shadow-xl flex flex-wrap items-center justify-between gap-4 animate-in fade-in slide-in-from-top-2 duration-200">
              <div className="flex items-center gap-3">
                <span className="bg-[#F58220] text-white text-xs font-black px-2.5 py-0.5 rounded-full">
                  {selectedIds.size}
                </span>
                <span className="text-xs font-semibold text-gray-200">
                  {selectedIds.size === 1 ? '1 booking selected' : `${selectedIds.size} bookings selected`}
                </span>
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={() => setActionModal({ type: 'BULK_APPROVE' })}
                  className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                >
                  <Check className="w-3.5 h-3.5" />
                  <span>Bulk Approve ({selectedIds.size})</span>
                </button>

                <button
                  onClick={() => {
                    setRejectionReason('');
                    setActionModal({ type: 'BULK_REJECT' });
                  }}
                  className="px-3.5 py-1.5 bg-red-600 hover:bg-red-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>Bulk Reject ({selectedIds.size})</span>
                </button>

                <button
                  onClick={() => setSelectedIds(new Set())}
                  className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 text-gray-200 font-bold text-xs rounded-xl transition"
                >
                  Clear Selection
                </button>
              </div>
            </div>
          )}

          {/* 4. Professional Approval Queue Table */}
          <div className="bg-white rounded-3xl border border-gray-200 shadow-2xs overflow-hidden">
            {isLoading ? (
              <div className="p-20 text-center space-y-3">
                <div className="w-9 h-9 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto" />
                <p className="text-xs font-semibold text-gray-500">Loading department requests...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-16 sm:p-20 text-center space-y-4">
                <div className="w-16 h-16 bg-emerald-50 text-emerald-600 rounded-3xl flex items-center justify-center mx-auto border border-emerald-100">
                  <CheckCircle2 className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h3 className="text-base font-extrabold text-gray-900">
                    All Caught Up! No Requests Match
                  </h3>
                  <p className="text-xs text-gray-400 max-w-sm mx-auto">
                    There are no bookings matching your current filter criteria in your department scope.
                  </p>
                </div>
                {(debouncedSearch || departmentFilter || categoryFilter || requesterRoleFilter || fromDate || toDate || overdueOnly) && (
                  <button
                    onClick={() => {
                      setSearch('');
                      setDepartmentFilter('');
                      setCategoryFilter('');
                      setRequesterRoleFilter('');
                      setFromDate('');
                      setToDate('');
                      setOverdueOnly(false);
                      setStatusFilter('ALL');
                    }}
                    className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
                  >
                    Reset All Filters
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs text-gray-600 border-collapse">
                  <thead>
                    <tr className="bg-[#FAF9F6] border-b border-gray-200 text-[11px] font-black text-gray-700 uppercase tracking-wider select-none">
                      <th className="py-3.5 pl-4 sm:pl-6 pr-2 w-10">
                        <button
                          type="button"
                          onClick={toggleSelectAll}
                          className="text-gray-400 hover:text-[#F58220]"
                        >
                          {isAllSelected ? (
                            <CheckSquare className="w-4 h-4 text-[#F58220]" />
                          ) : (
                            <Square className="w-4 h-4" />
                          )}
                        </button>
                      </th>
                      <th className="py-3.5 px-3">Requester & Ref #</th>
                      <th className="py-3.5 px-3">Facility / Room</th>
                      <th className="py-3.5 px-3">
                        <button
                          onClick={() => {
                            if (sortBy === 'startTime') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('startTime');
                              setSortOrder('asc');
                            }
                          }}
                          className="flex items-center gap-1 hover:text-gray-900"
                        >
                          <span>Slot Time</span>
                          <ArrowUpDown className="w-3 h-3 text-gray-400" />
                        </button>
                      </th>
                      <th className="py-3.5 px-3">
                        <button
                          onClick={() => {
                            if (sortBy === 'priority') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('priority');
                              setSortOrder('desc');
                            }
                          }}
                          className="flex items-center gap-1 hover:text-gray-900"
                        >
                          <span>Priority</span>
                          <ArrowUpDown className="w-3 h-3 text-gray-400" />
                        </button>
                      </th>
                      <th className="py-3.5 px-3">
                        <button
                          onClick={() => {
                            if (sortBy === 'slaDueAt') {
                              setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
                            } else {
                              setSortBy('slaDueAt');
                              setSortOrder('asc');
                            }
                          }}
                          className="flex items-center gap-1 hover:text-gray-900"
                        >
                          <span>SLA Status</span>
                          <ArrowUpDown className="w-3 h-3 text-gray-400" />
                        </button>
                      </th>
                      <th className="py-3.5 px-3">Status</th>
                      <th className="py-3.5 pr-4 sm:pr-6 pl-3 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {requests.map((r, idx) => {
                      const isSelected = selectedIds.has(r.id);
                      const isFocused = focusedIndex === idx;
                      const hasCompeting = r.issues?.hasCompetingPending;

                      // SLA calculations
                      const sla = r.sla;
                      let slaBadge = (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                          <Clock className="w-3 h-3" />
                          <span>ON TIME</span>
                        </span>
                      );
                      if (sla?.status === 'OVERDUE') {
                        slaBadge = (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-red-50 text-red-700 border border-red-200 animate-pulse">
                            <AlertTriangle className="w-3 h-3" />
                            <span>OVERDUE</span>
                          </span>
                        );
                      } else if (sla?.status === 'DUE_SOON') {
                        slaBadge = (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                            <Clock className="w-3 h-3" />
                            <span>DUE SOON</span>
                          </span>
                        );
                      }

                      // Priority badge
                      let priorityBadge = (
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-100 text-gray-600">
                          NORMAL
                        </span>
                      );
                      if (r.priority === 'URGENT') {
                        priorityBadge = (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800 border border-red-200 flex items-center gap-1 w-max">
                            <span className="w-1.5 h-1.5 rounded-full bg-red-600 animate-ping" />
                            <span>URGENT</span>
                          </span>
                        );
                      } else if (r.priority === 'HIGH') {
                        priorityBadge = (
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-orange-100 text-orange-800 border border-orange-200">
                            HIGH
                          </span>
                        );
                      }

                      return (
                        <tr
                          key={r.id}
                          onClick={() => setFocusedIndex(idx)}
                          className={`transition group hover:bg-[#FFFBF7] ${
                            isSelected ? 'bg-orange-50/40' : ''
                          } ${isFocused ? 'ring-2 ring-inset ring-[#F58220]/50' : ''}`}
                        >
                          {/* Checkbox */}
                          <td
                            className="py-3.5 pl-4 sm:pl-6 pr-2"
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelectOne(r.id);
                            }}
                          >
                            <button type="button" className="text-gray-400 hover:text-[#F58220]">
                              {isSelected ? (
                                <CheckSquare className="w-4 h-4 text-[#F58220]" />
                              ) : (
                                <Square className="w-4 h-4" />
                              )}
                            </button>
                          </td>

                          {/* Requester & Ref */}
                          <td className="py-3.5 px-3">
                            <div className="flex items-center gap-3">
                              <img
                                src={
                                  r.user?.avatarUrl ||
                                  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
                                }
                                alt={r.user?.name}
                                className="w-9 h-9 rounded-xl object-cover shrink-0 border border-gray-200 shadow-2xs"
                              />
                              <div className="min-w-0">
                                <div className="font-extrabold text-gray-900 truncate">
                                  {r.user?.name}
                                </div>
                                <div className="text-[11px] text-gray-400 flex items-center gap-1.5">
                                  <span className="font-mono text-[#F58220] font-bold">
                                    {r.bookingNumber}
                                  </span>
                                  <span>•</span>
                                  <span>{r.user?.role}</span>
                                </div>
                              </div>
                            </div>
                          </td>

                          {/* Facility / Room */}
                          <td className="py-3.5 px-3">
                            <div className="font-bold text-gray-900 truncate max-w-[200px]">
                              {r.resource?.name}
                            </div>
                            <div className="text-[11px] text-gray-400 flex items-center gap-1">
                              <Building className="w-3 h-3 text-gray-300" />
                              <span className="truncate">
                                {r.resource?.building} • Cap: {r.resource?.capacity}
                              </span>
                            </div>
                          </td>

                          {/* Slot Time */}
                          <td className="py-3.5 px-3 whitespace-nowrap">
                            <div className="font-bold text-gray-800">
                              {new Date(r.startTime).toLocaleDateString(undefined, {
                                month: 'short',
                                day: 'numeric',
                              })}
                            </div>
                            <div className="text-[11px] text-gray-500 font-mono">
                              {new Date(r.startTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              -{' '}
                              {new Date(r.endTime).toLocaleTimeString([], {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </div>
                          </td>

                          {/* Priority */}
                          <td className="py-3.5 px-3">{priorityBadge}</td>

                          {/* SLA */}
                          <td className="py-3.5 px-3">
                            {slaBadge}
                            {hasCompeting && (
                              <div
                                className="text-[10px] text-amber-700 font-bold mt-1 flex items-center gap-0.5"
                                title="Competing pending requests exist for this time slot"
                              >
                                <AlertTriangle className="w-3 h-3 text-amber-500" />
                                <span>{r.issues.competingCount} competing</span>
                              </div>
                            )}
                          </td>

                          {/* Status */}
                          <td className="py-3.5 px-3">
                            <span
                              className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                                r.status === 'CONFIRMED' || r.status === 'APPROVED'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : r.status === 'REJECTED'
                                  ? 'bg-red-100 text-red-800'
                                  : r.status === 'NEEDS_INFO'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {r.status}
                            </span>
                          </td>

                          {/* Actions */}
                          <td className="py-3.5 pr-4 sm:pr-6 pl-3 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                onClick={() => handleOpenDrawer(r)}
                                className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition"
                                title="View details drawer"
                              >
                                <Eye className="w-4 h-4" />
                              </button>

                              {r.status === 'PENDING' || r.status === 'NEEDS_INFO' ? (
                                <>
                                  <button
                                    onClick={() => {
                                      setApproveNotes('');
                                      setActionModal({ type: 'APPROVE', booking: r });
                                    }}
                                    className="p-1.5 bg-emerald-50 hover:bg-emerald-600 text-emerald-700 hover:text-white rounded-lg transition"
                                    title="Approve booking (A)"
                                  >
                                    <Check className="w-4 h-4 stroke-[2.5]" />
                                  </button>

                                  <button
                                    onClick={() => handleModifyOpen(r)}
                                    className="p-1.5 bg-blue-50 hover:bg-blue-600 text-[#1976B9] hover:text-white rounded-lg transition"
                                    title="Modify room/time"
                                  >
                                    <Edit3 className="w-4 h-4" />
                                  </button>

                                  <button
                                    onClick={() => {
                                      setRequestInfoQuestion('');
                                      setActionModal({ type: 'REQUEST_INFO', booking: r });
                                    }}
                                    className="p-1.5 bg-purple-50 hover:bg-purple-600 text-purple-700 hover:text-white rounded-lg transition"
                                    title="Request clarification from requester"
                                  >
                                    <HelpCircle className="w-4 h-4" />
                                  </button>

                                  <button
                                    onClick={() => {
                                      setRejectionReason('');
                                      setActionModal({ type: 'REJECT', booking: r });
                                    }}
                                    className="p-1.5 bg-red-50 hover:bg-red-600 text-red-600 hover:text-white rounded-lg transition"
                                    title="Decline request (R)"
                                  >
                                    <X className="w-4 h-4 stroke-[2.5]" />
                                  </button>
                                </>
                              ) : (
                                <span className="text-[10px] text-gray-400 italic pr-2">Decided</span>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Pagination Controls */}
            {!isLoading && requests.length > 0 && (
              <div className="p-4 sm:px-6 bg-[#FAF9F6] border-t border-gray-200 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-gray-600">
                <div className="flex items-center gap-2">
                  <span>
                    Showing <strong className="text-gray-900">{(page - 1) * limit + 1}</strong> to{' '}
                    <strong className="text-gray-900">
                      {Math.min(page * limit, totalRequests)}
                    </strong>{' '}
                    of <strong className="text-gray-900">{totalRequests}</strong> requests
                  </span>

                  <span className="text-gray-300">|</span>

                  <select
                    value={limit}
                    onChange={(e) => {
                      setLimit(parseInt(e.target.value, 10));
                      setPage(1);
                    }}
                    className="p-1 bg-white border border-gray-200 rounded-lg text-xs font-bold text-gray-700 focus:outline-none"
                  >
                    <option value={10}>10 per page</option>
                    <option value={25}>25 per page</option>
                    <option value={50}>50 per page</option>
                  </select>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
                  >
                    <ChevronLeft className="w-3.5 h-3.5" />
                    <span>Previous</span>
                  </button>

                  <span className="px-3 py-1 text-xs font-black text-[#F58220]">
                    {page} / {totalPages}
                  </span>

                  <button
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                    className="px-3 py-1.5 bg-white border border-gray-200 rounded-xl font-bold text-gray-700 hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition flex items-center gap-1"
                  >
                    <span>Next</span>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>

      {/* =========================================================================
          5. DETAIL SLIDE-OVER DRAWER
          ========================================================================= */}
      {drawerBookingId && (
        <div className="fixed inset-0 z-50 overflow-hidden animate-in fade-in duration-200">
          {/* Backdrop */}
          <div
            onClick={handleCloseDrawer}
            className="absolute inset-0 bg-black/40 backdrop-blur-2xs transition-opacity"
          />

          <div className="fixed inset-y-0 right-0 max-w-2xl w-full bg-white shadow-2xl z-50 flex flex-col border-l border-gray-200 animate-in slide-in-from-right duration-300">
            {/* Drawer Top Header */}
            <div className="p-5 sm:px-6 bg-[#FAF9F6] border-b border-gray-200 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-mono text-xs font-black text-[#F58220] bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                    {drawerDetails?.bookingNumber || 'Loading...'}
                  </span>
                  <span
                    className={`text-[10px] font-black px-2 py-0.5 rounded-full ${
                      drawerDetails?.status === 'CONFIRMED' || drawerDetails?.status === 'APPROVED'
                        ? 'bg-emerald-100 text-emerald-800'
                        : drawerDetails?.status === 'REJECTED'
                        ? 'bg-red-100 text-red-800'
                        : drawerDetails?.status === 'NEEDS_INFO'
                        ? 'bg-purple-100 text-purple-800'
                        : 'bg-amber-100 text-amber-800'
                    }`}
                  >
                    {drawerDetails?.status || 'PENDING'}
                  </span>
                  {drawerDetails?.priority === 'URGENT' && (
                    <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-red-100 text-red-800">
                      URGENT
                    </span>
                  )}
                </div>
                <h2 className="text-base font-extrabold text-gray-900 mt-1">
                  {drawerDetails?.resource?.name || 'Facility Reservation'}
                </h2>
              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={handleCloseDrawer}
                  className="p-2 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-xl transition"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Quick Actions in Drawer */}
            {drawerDetails && (drawerDetails.status === 'PENDING' || drawerDetails.status === 'NEEDS_INFO') && (
              <div className="px-5 py-3 bg-white border-b border-gray-100 flex items-center justify-between gap-2 overflow-x-auto">
                <div className="text-[11px] font-bold text-gray-400">Actions:</div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => {
                      setApproveNotes('');
                      setActionModal({ type: 'APPROVE', booking: drawerDetails });
                    }}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Approve (A)</span>
                  </button>
                  <button
                    onClick={() => handleModifyOpen(drawerDetails)}
                    className="px-3 py-1.5 bg-blue-50 hover:bg-blue-100 text-[#1976B9] font-bold text-xs rounded-xl border border-blue-200 transition flex items-center gap-1"
                  >
                    <Edit3 className="w-3.5 h-3.5" />
                    <span>Modify</span>
                  </button>
                  <button
                    onClick={() => {
                      setRequestInfoQuestion('');
                      setActionModal({ type: 'REQUEST_INFO', booking: drawerDetails });
                    }}
                    className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 text-purple-700 font-bold text-xs rounded-xl border border-purple-200 transition flex items-center gap-1"
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Request Info</span>
                  </button>
                  <button
                    onClick={() => {
                      setRejectionReason('');
                      setActionModal({ type: 'REJECT', booking: drawerDetails });
                    }}
                    className="px-3 py-1.5 bg-red-50 hover:bg-red-100 text-red-600 font-bold text-xs rounded-xl border border-red-200 transition flex items-center gap-1"
                  >
                    <X className="w-3.5 h-3.5" />
                    <span>Decline (R)</span>
                  </button>
                </div>
              </div>
            )}

            {/* Drawer Tabs Navigation */}
            <div className="px-5 pt-3 bg-white border-b border-gray-100 flex gap-4 text-xs font-bold text-gray-500">
              <button
                onClick={() => setDrawerTab('OVERVIEW')}
                className={`pb-2.5 transition border-b-2 ${
                  drawerTab === 'OVERVIEW'
                    ? 'border-[#F58220] text-[#F58220]'
                    : 'border-transparent hover:text-gray-900'
                }`}
              >
                Overview & Profile
              </button>
              <button
                onClick={() => setDrawerTab('TIMELINE')}
                className={`pb-2.5 transition border-b-2 ${
                  drawerTab === 'TIMELINE'
                    ? 'border-[#F58220] text-[#F58220]'
                    : 'border-transparent hover:text-gray-900'
                }`}
              >
                Schedule & Timetable
              </button>
              <button
                onClick={() => setDrawerTab('POLICY_COMMENTS')}
                className={`pb-2.5 transition border-b-2 ${
                  drawerTab === 'POLICY_COMMENTS'
                    ? 'border-[#F58220] text-[#F58220]'
                    : 'border-transparent hover:text-gray-900'
                }`}
              >
                Policy & Notes ({drawerDetails?.comments?.length || 0})
              </button>
            </div>

            {/* Drawer Body Content */}
            <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-5">
              {isLoadingDrawer ? (
                <div className="py-20 text-center space-y-3">
                  <div className="w-8 h-8 border-4 border-[#F58220] border-t-transparent rounded-full animate-spin mx-auto" />
                  <p className="text-xs text-gray-400">Loading comprehensive details...</p>
                </div>
              ) : !drawerDetails ? (
                <div className="text-center py-10 text-xs text-gray-400">Failed to load details.</div>
              ) : (
                <>
                  {/* TAB 1: OVERVIEW & PROFILE */}
                  {drawerTab === 'OVERVIEW' && (
                    <div className="space-y-5">
                      {/* Competing Requests Alert Banner */}
                      {drawerDetails.issues?.hasCompetingPending && (
                        <div className="p-3.5 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3">
                          <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
                          <div className="text-xs">
                            <span className="font-extrabold text-amber-900">
                              High Contention Slot Alert:
                            </span>{' '}
                            <span className="text-amber-800">
                              {drawerDetails.issues.competingCount} other pending requests are
                              competing for this exact resource and overlapping time window.
                            </span>
                          </div>
                        </div>
                      )}

                      {/* Requester Profile Card */}
                      <div className="bg-[#FAF9F6] p-4 rounded-2xl border border-gray-200 space-y-3">
                        <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                          Requester Identity & History
                        </div>
                        <div className="flex items-center gap-3">
                          <img
                            src={
                              drawerDetails.user?.avatarUrl ||
                              'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?auto=format&fit=crop&w=150&q=80'
                            }
                            alt={drawerDetails.user?.name}
                            className="w-12 h-12 rounded-2xl object-cover border border-gray-200 shrink-0"
                          />
                          <div>
                            <div className="font-extrabold text-sm text-gray-900">
                              {drawerDetails.user?.name}
                            </div>
                            <div className="text-xs text-gray-500">{drawerDetails.user?.email}</div>
                            <div className="text-[11px] text-gray-400 mt-0.5 flex gap-2">
                              <span>Reg/UID: {drawerDetails.user?.regNo || 'N/A'}</span>
                              <span>•</span>
                              <span>{drawerDetails.user?.department || 'University'}</span>
                            </div>
                          </div>
                        </div>

                        {/* History Metric Chips */}
                        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-200">
                          <div className="p-2.5 bg-white rounded-xl border border-gray-200">
                            <div className="text-[10px] font-bold text-gray-500 uppercase">
                              No-Shows (Last 30 Days)
                            </div>
                            <div
                              className={`text-base font-black ${
                                (drawerDetails.requesterSummary?.recentNoShowCount || 0) > 0
                                  ? 'text-red-600'
                                  : 'text-emerald-600'
                              }`}
                            >
                              {drawerDetails.requesterSummary?.recentNoShowCount || 0}
                            </div>
                          </div>

                          <div className="p-2.5 bg-white rounded-xl border border-gray-200">
                            <div className="text-[10px] font-bold text-gray-500 uppercase">
                              Hours Used This Week
                            </div>
                            <div className="text-base font-black text-gray-900">
                              {drawerDetails.requesterSummary?.hoursUsedThisWeek || 0} hrs
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Facility & Reservation Details */}
                      <div className="bg-white p-4 rounded-2xl border border-gray-200 space-y-3">
                        <div className="text-[11px] font-black uppercase tracking-wider text-gray-500">
                          Reservation Particulars
                        </div>

                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">Target Facility:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.resource?.name} ({drawerDetails.resource?.code})
                            </span>
                          </div>

                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">Location:</span>
                            <span className="font-semibold text-gray-800">
                              {drawerDetails.resource?.building} • Floor{' '}
                              {drawerDetails.resource?.floor || '1'}
                            </span>
                          </div>

                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">Time Slot:</span>
                            <span className="font-mono font-bold text-[#F58220]">
                              {new Date(drawerDetails.startTime).toLocaleString([], {
                                dateStyle: 'medium',
                                timeStyle: 'short',
                              })}{' '}
                              to{' '}
                              {new Date(drawerDetails.endTime).toLocaleTimeString([], {
                                timeStyle: 'short',
                              })}
                            </span>
                          </div>

                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">Expected Attendance:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.expectedAttendance} attendees (Max Capacity:{' '}
                              {drawerDetails.resource?.capacity})
                            </span>
                          </div>

                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">Activity Type:</span>
                            <span className="font-bold text-gray-800">
                              {drawerDetails.activityType}
                            </span>
                          </div>

                          <div className="flex justify-between py-1 border-b border-gray-100">
                            <span className="text-gray-400">SLA Resolution Target:</span>
                            <span className="font-mono text-gray-700">
                              {drawerDetails.slaDueAt
                                ? new Date(drawerDetails.slaDueAt).toLocaleString()
                                : 'Standard (24h)'}
                            </span>
                          </div>

                          <div className="pt-2">
                            <span className="text-gray-400 block mb-1">Stated Agenda / Purpose:</span>
                            <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-gray-800 leading-relaxed">
                              {drawerDetails.purpose}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* TAB 2: SCHEDULE & TIMETABLE (MINI DAY CALENDAR) */}
                  {drawerTab === 'TIMELINE' && (
                    <div className="space-y-4">
                      <div className="text-xs text-gray-500">
                        Neighbouring bookings and scheduled academic timetable classes for{' '}
                        <strong className="text-gray-800">
                          {drawerDetails.resource?.name}
                        </strong>{' '}
                        on{' '}
                        <strong className="text-gray-800">
                          {new Date(drawerDetails.startTime).toLocaleDateString(undefined, {
                            weekday: 'long',
                            year: 'numeric',
                            month: 'long',
                            day: 'numeric',
                          })}
                        </strong>
                        .
                      </div>

                      {isLoadingSchedule ? (
                        <div className="py-12 text-center text-xs text-gray-400">
                          Loading schedule timeline...
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {/* Current Requested Booking Slot */}
                          <div className="p-3.5 bg-orange-50 border-2 border-[#F58220] rounded-2xl">
                            <div className="flex items-center justify-between text-xs font-bold text-[#F58220] mb-1">
                              <span>★ THIS RESERVATION (REQUESTED)</span>
                              <span className="font-mono">
                                {new Date(drawerDetails.startTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}{' '}
                                -{' '}
                                {new Date(drawerDetails.endTime).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <div className="text-xs font-extrabold text-gray-900">
                              {drawerDetails.user?.name} — {drawerDetails.purpose}
                            </div>
                          </div>

                          {/* Academic Timetable Classes */}
                          <div className="space-y-2">
                            <div className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
                              Academic Timetable Classes (Weekly)
                            </div>
                            {drawerTimetable.length === 0 ? (
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-400 text-center">
                                No regular academic classes scheduled for this day of week.
                              </div>
                            ) : (
                              drawerTimetable.map((tt: any) => (
                                <div
                                  key={tt.id}
                                  className="p-3 bg-blue-50/60 border border-blue-200 rounded-xl flex items-center justify-between text-xs"
                                >
                                  <div>
                                    <div className="font-bold text-blue-900">
                                      {tt.courseCode}: {tt.courseName}
                                    </div>
                                    <div className="text-[11px] text-blue-700">
                                      Instructor: {tt.instructorName} • {tt.department}
                                    </div>
                                  </div>
                                  <div className="font-mono font-bold text-blue-800">
                                    {tt.startTime} - {tt.endTime}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>

                          {/* Other Bookings on Same Date */}
                          <div className="space-y-2 pt-2">
                            <div className="text-[11px] font-black uppercase text-gray-500 tracking-wider">
                              Other Bookings on this Facility
                            </div>
                            {drawerNeighbours.filter((b) => b.id !== drawerDetails.id).length === 0 ? (
                              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs text-gray-400 text-center">
                                No other bookings on this facility today.
                              </div>
                            ) : (
                              drawerNeighbours
                                .filter((b) => b.id !== drawerDetails.id)
                                .map((nb: any) => (
                                  <div
                                    key={nb.id}
                                    className={`p-3 rounded-xl border text-xs flex items-center justify-between ${
                                      nb.status === 'CONFIRMED'
                                        ? 'bg-emerald-50/50 border-emerald-200'
                                        : 'bg-gray-50 border-gray-200'
                                    }`}
                                  >
                                    <div>
                                      <div className="font-bold text-gray-900">
                                        {nb.user?.name} ({nb.bookingNumber})
                                      </div>
                                      <div className="text-[11px] text-gray-500 truncate max-w-xs">
                                        {nb.purpose}
                                      </div>
                                    </div>
                                    <div className="text-right">
                                      <div className="font-mono font-bold text-gray-800">
                                        {new Date(nb.startTime).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}{' '}
                                        -{' '}
                                        {new Date(nb.endTime).toLocaleTimeString([], {
                                          hour: '2-digit',
                                          minute: '2-digit',
                                        })}
                                      </div>
                                      <span
                                        className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                                          nb.status === 'CONFIRMED'
                                            ? 'bg-emerald-100 text-emerald-800'
                                            : 'bg-gray-200 text-gray-700'
                                        }`}
                                      >
                                        {nb.status}
                                      </span>
                                    </div>
                                  </div>
                                ))
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* TAB 3: POLICY & COMMENTS THREAD */}
                  {drawerTab === 'POLICY_COMMENTS' && (
                    <div className="space-y-5">
                      {/* Department Policy Card */}
                      <div className="p-4 bg-gray-50 rounded-2xl border border-gray-200 space-y-2">
                        <div className="text-[11px] font-black uppercase text-gray-600 tracking-wider">
                          Department Allocation Policy
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          <div className="flex justify-between py-1 border-b border-gray-200">
                            <span className="text-gray-500">Max Advance Days:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.policy?.maxAdvanceDays || 14} days
                            </span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-gray-200">
                            <span className="text-gray-500">Weekly Allowance:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.policy?.maxBookingHoursPerWeek || 20} hrs
                            </span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-gray-200">
                            <span className="text-gray-500">Auto-Release Window:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.policy?.autoReleaseMinutes ?? 15} mins
                            </span>
                          </div>
                          <div className="flex justify-between py-1 border-b border-gray-200">
                            <span className="text-gray-500">Faculty Endorsement:</span>
                            <span className="font-bold text-gray-900">
                              {drawerDetails.policy?.requireFacultyEndorsement ? 'Required' : 'Optional'}
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* Comment & Decision History Timeline */}
                      <div className="space-y-3">
                        <div className="text-[11px] font-black uppercase text-gray-600 tracking-wider">
                          Audit Trail & Notes Thread
                        </div>

                        {/* Decision History */}
                        {drawerDetails.approvalDecisions?.map((dec: any) => (
                          <div
                            key={dec.id}
                            className="p-3.5 bg-blue-50/50 rounded-2xl border border-blue-100 text-xs space-y-1.5"
                          >
                            <div className="flex items-center justify-between font-bold text-blue-950">
                              <span>Decision: {dec.action}</span>
                              <span className="text-[10px] text-gray-400 font-normal">
                                {new Date(dec.createdAt).toLocaleString()}
                              </span>
                            </div>
                            <div className="text-gray-700">
                              By: <strong className="text-gray-900">{dec.approver?.name}</strong>{' '}
                              ({dec.approver?.role})
                            </div>
                            {dec.reason && (
                              <div className="text-gray-600 italic">"{dec.reason}"</div>
                            )}
                          </div>
                        ))}

                        {/* Comments Thread */}
                        {drawerDetails.comments?.map((c: any) => (
                          <div
                            key={c.id}
                            className={`p-3.5 rounded-2xl border text-xs space-y-1 ${
                              c.isInternal
                                ? 'bg-amber-50/60 border-amber-200'
                                : 'bg-white border-gray-200'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="font-bold text-gray-900 flex items-center gap-1.5">
                                <span>{c.author?.name}</span>
                                <span className="text-[10px] text-gray-400">({c.author?.role})</span>
                                {c.isInternal && (
                                  <span className="bg-amber-200 text-amber-900 text-[9px] font-black px-1.5 py-0.2 rounded">
                                    INTERNAL
                                  </span>
                                )}
                              </span>
                              <span className="text-[10px] text-gray-400 font-mono">
                                {new Date(c.createdAt).toLocaleTimeString([], {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                            <p className="text-gray-800 leading-relaxed whitespace-pre-wrap">{c.body}</p>
                          </div>
                        ))}

                        {/* Add Note Form */}
                        <form onSubmit={handlePostComment} className="pt-2 space-y-2">
                          <textarea
                            rows={3}
                            value={newComment}
                            onChange={(e) => setNewComment(e.target.value)}
                            placeholder="Add an internal note or communication for this booking..."
                            className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                          />
                          <div className="flex items-center justify-between">
                            <label className="flex items-center gap-1.5 text-xs text-gray-600 cursor-pointer select-none">
                              <input
                                type="checkbox"
                                checked={isInternalComment}
                                onChange={(e) => setIsInternalComment(e.target.checked)}
                                className="rounded text-[#F58220] focus:ring-[#F58220]"
                              />
                              <span>Internal Approver Note Only</span>
                            </label>

                            <button
                              type="submit"
                              disabled={isPostingComment || !newComment.trim()}
                              className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] disabled:opacity-40 text-white font-bold text-xs rounded-xl shadow-xs transition flex items-center gap-1.5"
                            >
                              <Send className="w-3.5 h-3.5" />
                              <span>{isPostingComment ? 'Posting...' : 'Post Note'}</span>
                            </button>
                          </div>
                        </form>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          6. DECISION MODALS
          ========================================================================= */}

      {/* MODAL 1: APPROVE CONFIRMATION */}
      {actionModal?.type === 'APPROVE' && actionModal.booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0 border border-emerald-100">
                <Check className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900">
                  Approve Facility Reservation
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Confirm reservation {actionModal.booking.bookingNumber} for{' '}
                  <strong className="text-gray-800">{actionModal.booking.user?.name}</strong>.
                </p>
              </div>
            </div>

            <div className="p-3.5 bg-gray-50 rounded-2xl border border-gray-100 text-xs space-y-1.5">
              <div className="flex justify-between">
                <span className="text-gray-400">Facility:</span>
                <span className="font-bold text-gray-900">{actionModal.booking.resource?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Date & Slot:</span>
                <span className="font-semibold text-gray-800">
                  {new Date(actionModal.booking.startTime).toLocaleDateString()} (
                  {new Date(actionModal.booking.startTime).toLocaleTimeString([], {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  )
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Attendees:</span>
                <span className="font-bold text-gray-800">
                  {actionModal.booking.expectedAttendance} / {actionModal.booking.resource?.capacity}
                </span>
              </div>
            </div>

            <div className="text-[11px] text-emerald-800 bg-emerald-50/70 p-2.5 rounded-xl border border-emerald-100 flex items-center gap-1.5">
              <Info className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
              <span>
                A secure 6-digit numeric check-in PIN and auto-release deadline will be generated.
              </span>
            </div>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Approver Notes (Optional)
              </label>
              <textarea
                value={approveNotes}
                onChange={(e) => setApproveNotes(e.target.value)}
                placeholder="e.g. Approved per departmental laboratory session schedule..."
                rows={2}
                className="w-full p-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleApproveSubmit}
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-50"
              >
                {isSubmitting ? 'Confirming...' : 'Confirm Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 2: REJECT CONFIRMATION */}
      {actionModal?.type === 'REJECT' && actionModal.booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-red-50 text-red-600 flex items-center justify-center shrink-0 border border-red-100">
                <X className="w-5 h-5 stroke-[2.5]" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900">Decline Reservation Request</h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  State the formal reason for declining {actionModal.booking.bookingNumber}.
                </p>
              </div>
            </div>

            {/* Presets Chips */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">
                Quick Reason Presets:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REJECT_PRESETS.map((preset, pIdx) => (
                  <button
                    key={pIdx}
                    type="button"
                    onClick={() => setRejectionReason(preset)}
                    className="text-[11px] text-left px-2.5 py-1 bg-gray-50 hover:bg-red-50 hover:text-red-700 text-gray-600 rounded-lg border border-gray-200 transition"
                  >
                    {preset}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-gray-700">
                  Rejection Reason *
                </label>
                <span
                  className={`text-[10px] font-bold ${
                    rejectionReason.trim().length >= 10 ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {rejectionReason.trim().length}/10 min chars
                </span>
              </div>
              <textarea
                required
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="State reason (minimum 10 characters)..."
                rows={3}
                className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRejectSubmit}
                disabled={isSubmitting || rejectionReason.trim().length < 10}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-40"
              >
                {isSubmitting ? 'Decline...' : 'Confirm Rejection'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 3: MODIFY RESERVATION */}
      {actionModal?.type === 'MODIFY' && actionModal.booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-blue-50 text-[#1976B9] flex items-center justify-center shrink-0 border border-blue-100">
                <Edit3 className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900">
                  Modify / Reassign Facility Reservation
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  Adjust room assignment or timing for {actionModal.booking.bookingNumber} (
                  {actionModal.booking.user?.name}).
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Assign Alternative Resource
                </label>
                <select
                  value={modifyResourceId}
                  onChange={(e) => setModifiedResourceId(e.target.value)}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs text-gray-800 focus:outline-none focus:border-[#F58220]"
                >
                  {allResources.map((res) => (
                    <option key={res.id} value={res.id}>
                      {res.name} ({res.building} • Cap: {res.capacity})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">New Start</label>
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={modifyStartDate}
                      onChange={(e) => setModifyStartDate(e.target.value)}
                      className="w-3/5 p-2 border border-gray-200 rounded-xl text-xs"
                    />
                    <input
                      type="time"
                      value={modifyStartTime}
                      onChange={(e) => setModifyStartTime(e.target.value)}
                      className="w-2/5 p-2 border border-gray-200 rounded-xl text-xs"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">New End</label>
                  <div className="flex gap-1">
                    <input
                      type="date"
                      value={modifyEndDate}
                      onChange={(e) => setModifyEndDate(e.target.value)}
                      className="w-3/5 p-2 border border-gray-200 rounded-xl text-xs"
                    />
                    <input
                      type="time"
                      value={modifyEndTime}
                      onChange={(e) => setModifyEndTime(e.target.value)}
                      className="w-2/5 p-2 border border-gray-200 rounded-xl text-xs"
                    />
                  </div>
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-bold text-gray-700">
                    Modification Reason *
                  </label>
                  <span
                    className={`text-[10px] font-bold ${
                      modifyNotes.trim().length >= 10 ? 'text-emerald-600' : 'text-red-500'
                    }`}
                  >
                    {modifyNotes.trim().length}/10 min chars
                  </span>
                </div>
                <textarea
                  required
                  value={modifyNotes}
                  onChange={(e) => setModifyNotes(e.target.value)}
                  placeholder="e.g. Reassigned to larger lab to accommodate high student attendance..."
                  rows={2}
                  className="w-full p-2.5 border border-gray-200 rounded-xl text-xs focus:outline-none focus:border-[#F58220]"
                />
              </div>
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleModifySubmit}
                disabled={isSubmitting || modifyNotes.trim().length < 10}
                className="flex-1 py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-40"
              >
                {isSubmitting ? 'Applying...' : 'Apply & Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 4: REQUEST CLARIFICATION (REQUEST_INFO) */}
      {actionModal?.type === 'REQUEST_INFO' && actionModal.booking && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-2xl bg-purple-50 text-purple-700 flex items-center justify-center shrink-0 border border-purple-100">
                <HelpCircle className="w-5 h-5" />
              </div>
              <div>
                <h3 className="text-base font-extrabold text-gray-900">
                  Request Information from Requester
                </h3>
                <p className="text-xs text-gray-500 mt-0.5">
                  The reservation status will transition to{' '}
                  <strong className="text-purple-700">NEEDS_INFO</strong>.
                </p>
              </div>
            </div>

            {/* Presets */}
            <div>
              <label className="block text-[11px] font-bold text-gray-500 mb-1.5 uppercase">
                Common Questions:
              </label>
              <div className="flex flex-wrap gap-1.5">
                {REQUEST_INFO_PRESETS.map((q, qIdx) => (
                  <button
                    key={qIdx}
                    type="button"
                    onClick={() => setRequestInfoQuestion(q)}
                    className="text-[11px] text-left px-2.5 py-1 bg-gray-50 hover:bg-purple-50 hover:text-purple-700 text-gray-600 rounded-lg border border-gray-200 transition"
                  >
                    {q}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-xs font-bold text-gray-700">
                  Clarification Question *
                </label>
                <span
                  className={`text-[10px] font-bold ${
                    requestInfoQuestion.trim().length >= 5 ? 'text-emerald-600' : 'text-red-500'
                  }`}
                >
                  {requestInfoQuestion.trim().length}/5 min chars
                </span>
              </div>
              <textarea
                required
                value={requestInfoQuestion}
                onChange={(e) => setRequestInfoQuestion(e.target.value)}
                placeholder="Ask specific clarification question (min 5 characters)..."
                rows={3}
                className="w-full p-3 border border-gray-200 rounded-xl text-xs focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
              />
            </div>

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl transition"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleRequestInfoSubmit}
                disabled={isSubmitting || requestInfoQuestion.trim().length < 5}
                className="flex-1 py-2.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold rounded-xl shadow-xs transition disabled:opacity-40"
              >
                {isSubmitting ? 'Sending...' : 'Send Clarification Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL 5: BULK ACTIONS */}
      {actionModal?.type === 'BULK_APPROVE' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-base font-extrabold text-gray-900">
              Bulk Approve {selectedIds.size} Requests
            </h3>
            <p className="text-xs text-gray-500">
              Each reservation will be validated and confirmed individually. Check-in credentials will
              be generated for all successful allocations.
            </p>

            {bulkProgress && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1">
                <div className="flex justify-between font-bold">
                  <span>Progress:</span>
                  <span>
                    {bulkProgress.processed} / {bulkProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-[#F58220] h-full transition-all duration-150"
                    style={{
                      width: `${(bulkProgress.processed / bulkProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkApprove}
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-xs"
              >
                {isSubmitting ? 'Processing...' : 'Confirm Bulk Approval'}
              </button>
            </div>
          </div>
        </div>
      )}

      {actionModal?.type === 'BULK_REJECT' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-2xs animate-in fade-in duration-200">
          <div className="bg-white rounded-3xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-4">
            <h3 className="text-base font-extrabold text-gray-900">
              Bulk Decline {selectedIds.size} Requests
            </h3>
            <p className="text-xs text-gray-500">
              Please provide the overarching reason for declining all {selectedIds.size} selected
              reservations.
            </p>

            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Decline Reason * (min 10 chars)
              </label>
              <textarea
                value={rejectionReason}
                onChange={(e) => setRejectionReason(e.target.value)}
                placeholder="e.g. Facilities reserved for official university inspection..."
                rows={3}
                className="w-full p-2.5 border border-gray-200 rounded-xl text-xs"
              />
            </div>

            {bulkProgress && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-100 text-xs space-y-1">
                <div className="flex justify-between font-bold">
                  <span>Progress:</span>
                  <span>
                    {bulkProgress.processed} / {bulkProgress.total}
                  </span>
                </div>
                <div className="w-full bg-gray-200 h-2 rounded-full overflow-hidden">
                  <div
                    className="bg-red-500 h-full transition-all duration-150"
                    style={{
                      width: `${(bulkProgress.processed / bulkProgress.total) * 100}%`,
                    }}
                  />
                </div>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                type="button"
                onClick={() => setActionModal(null)}
                disabled={isSubmitting}
                className="flex-1 py-2.5 bg-gray-100 hover:bg-gray-200 text-gray-700 text-xs font-bold rounded-xl"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleBulkReject}
                disabled={isSubmitting || rejectionReason.trim().length < 10}
                className="flex-1 py-2.5 bg-red-600 hover:bg-red-700 text-white text-xs font-bold rounded-xl shadow-xs disabled:opacity-40"
              >
                {isSubmitting ? 'Processing...' : 'Confirm Bulk Decline'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          7. FLOATING TOAST NOTIFICATIONS
          ========================================================================= */}
      <div className="fixed bottom-5 right-5 z-50 flex flex-col gap-2 max-w-sm w-full pointer-events-none">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`p-3.5 rounded-2xl shadow-xl border pointer-events-auto flex items-start gap-3 transition-all animate-in slide-in-from-bottom-2 ${
              t.type === 'success'
                ? 'bg-emerald-950 text-emerald-100 border-emerald-800'
                : t.type === 'error'
                ? 'bg-red-950 text-red-100 border-red-800'
                : 'bg-gray-900 text-gray-100 border-gray-800'
            }`}
          >
            {t.type === 'success' ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
            ) : t.type === 'error' ? (
              <AlertTriangle className="w-5 h-5 text-red-400 shrink-0 mt-0.5" />
            ) : (
              <Info className="w-5 h-5 text-blue-400 shrink-0 mt-0.5" />
            )}
            <div className="flex-1 text-xs">
              {t.title && <div className="font-extrabold mb-0.5">{t.title}</div>}
              <div className="leading-relaxed opacity-90">{t.message}</div>
            </div>
            <button
              onClick={() => setToasts((prev) => prev.filter((item) => item.id !== t.id))}
              className="text-gray-400 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
