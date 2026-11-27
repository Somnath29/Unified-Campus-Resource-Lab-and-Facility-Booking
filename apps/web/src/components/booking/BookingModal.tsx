'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import {
  X,
  Calendar,
  Clock,
  Users,
  AlertCircle,
  CheckCircle2,
  ShieldCheck,
  Copy,
  Check,
  Download,
  Sparkles,
  HelpCircle,
  ArrowRight,
  Info,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import {
  ResourceDTO,
  ActivityType,
  PriorityLevel,
  BookingPreviewResponse,
  AlternativeSlot,
  AvailabilitySlot,
  RecurrenceFrequency,
  Weekday,
  BookingSeriesMode,
  BookingSeriesPreviewResponse,
  BookingSeriesResponse,
  BookingOccurrenceResult,
  QuotaResponse,
} from '@lpu/shared';
import {
  Repeat,
  CalendarRange,
  Layers,
  CheckCheck,
  AlertTriangle,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

const bookingSchema = z
  .object({
    resourceId: z.string().min(1, 'Please select a facility or resource'),
    date: z.string().min(1, 'Date is required'),
    startTime: z.string().regex(/^\d{2}:\d{2}$/, 'Valid start time required (HH:mm)'),
    endTime: z.string().regex(/^\d{2}:\d{2}$/, 'Valid end time required (HH:mm)'),
    expectedAttendance: z.coerce
      .number({ invalid_type_error: 'Attendance must be a number' })
      .int('Attendance must be a whole number')
      .min(1, 'Attendance must be at least 1 person'),
    activityType: z.string().min(1, 'Please select an activity type'),
    purpose: z
      .string()
      .min(5, 'Purpose must be at least 5 characters')
      .max(500, 'Purpose cannot exceed 500 characters'),
    priority: z.string(),
  })
  .refine((data) => data.endTime > data.startTime, {
    message: 'End time must be strictly after start time',
    path: ['endTime'],
  });

type BookingFormValues = z.infer<typeof bookingSchema>;

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedResource?: ResourceDTO | null;
  preselectedDate?: string;
  preselectedStartTime?: string;
  preselectedEndTime?: string;
  onBookingSuccess?: () => void;
}

const DURATION_PRESETS = [
  { label: '30m', minutes: 30 },
  { label: '1 hr', minutes: 60 },
  { label: '1.5 hrs', minutes: 90 },
  { label: '2 hrs', minutes: 120 },
  { label: '3 hrs', minutes: 180 },
  { label: '4 hrs', minutes: 240 },
];

/**
 * Calculates end time HH:mm given start time HH:mm and duration in minutes.
 */
function addMinutesToTime(timeStr: string, minutes: number): string {
  if (!timeStr || !timeStr.includes(':')) return '16:00';
  const [h, m] = timeStr.split(':').map(Number);
  const totalM = h * 60 + m + minutes;
  const newH = Math.min(23, Math.floor(totalM / 60));
  const newM = totalM % 60;
  return `${String(newH).padStart(2, '0')}:${String(newM).padStart(2, '0')}`;
}

/**
 * Weekday ordering for recurring series
 */
const WEEKDAY_ORDER: { label: string; value: Weekday }[] = [
  { label: 'Mon', value: 'MONDAY' },
  { label: 'Tue', value: 'TUESDAY' },
  { label: 'Wed', value: 'WEDNESDAY' },
  { label: 'Thu', value: 'THURSDAY' },
  { label: 'Fri', value: 'FRIDAY' },
  { label: 'Sat', value: 'SATURDAY' },
  { label: 'Sun', value: 'SUNDAY' },
];

function getWeekdayFromDate(dateStr: string): Weekday {
  if (!dateStr || !dateStr.includes('-')) return 'MONDAY';
  const parts = dateStr.split('-').map(Number);
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  const day = d.getUTCDay(); // 0 = Sun, 1 = Mon ...
  const map: Weekday[] = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
  return map[day];
}

/**
 * Generates an RFC 5545 iCalendar (.ics) file for an entire recurring series.
 */
function downloadSeriesIcsCalendar(seriesRes: BookingSeriesResponse, resource: any) {
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const events = (seriesRes.results || [])
    .filter((r) => r.isCreated && r.bookingNumber)
    .map((r) => {
      const dateParts = r.date.split('-').map(Number);
      const [sH, sM] = r.startTime.split(':').map(Number);
      const [eH, eM] = r.endTime.split(':').map(Number);
      // In IST (UTC+5:30)
      const startUtc = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], sH - 5, sM - 30)).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      const endUtc = new Date(Date.UTC(dateParts[0], dateParts[1] - 1, dateParts[2], eH - 5, eM - 30)).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      return [
        'BEGIN:VEVENT',
        `UID:${r.bookingNumber || r.bookingId}@lpu.in`,
        `DTSTAMP:${nowUtc}`,
        `DTSTART:${startUtc}`,
        `DTEND:${endUtc}`,
        `SUMMARY:Recurring: ${resource?.name || 'Campus Resource'} (${r.bookingNumber})`,
        `DESCRIPTION:Series Reservation\\nStatus: ${r.status}\\nReference: ${r.bookingNumber}`,
        `LOCATION:${resource?.name || 'LPU Room'}${resource?.building ? ', ' + resource.building : ''}`,
        `STATUS:CONFIRMED`,
        'END:VEVENT',
      ].join('\r\n');
    });

  if (events.length === 0) return;

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LPU Campus Booking Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    ...events,
    'END:VCALENDAR',
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `series-${seriesRes.seriesId || Date.now()}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Generates an RFC 5545 iCalendar (.ics) file and triggers browser download.
 */
function downloadIcsCalendar(booking: any, resource: any) {
  const startUtc = new Date(booking.startTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const endUtc = new Date(booking.endTime).toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
  const nowUtc = new Date().toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';

  const icsLines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//LPU Campus Booking Platform//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${booking.bookingNumber || booking.id}@lpu.in`,
    `DTSTAMP:${nowUtc}`,
    `DTSTART:${startUtc}`,
    `DTEND:${endUtc}`,
    `SUMMARY:Reservation: ${resource?.name || 'Campus Resource'} (${booking.bookingNumber})`,
    `DESCRIPTION:Purpose: ${booking.purpose || 'Campus Resource Booking'}\\nCheck-in PIN: ${booking.checkInToken || 'N/A'}\\nStatus: ${booking.status}\\nReference: ${booking.bookingNumber}`,
    `LOCATION:${resource?.name || 'LPU Room'}${resource?.building ? ', ' + resource.building : ''}`,
    `STATUS:${booking.status === 'CONFIRMED' ? 'CONFIRMED' : 'TENTATIVE'}`,
    'END:VEVENT',
    'END:VCALENDAR',
  ];

  const blob = new Blob([icsLines.join('\r\n')], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', `${booking.bookingNumber || 'campus-booking'}.ics`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function BookingModal({
  isOpen,
  onClose,
  preselectedResource,
  preselectedDate,
  preselectedStartTime,
  preselectedEndTime,
  onBookingSuccess,
}: BookingModalProps) {
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [selectedDuration, setSelectedDuration] = useState<number>(60);
  const [availabilitySlots, setAvailabilitySlots] = useState<AvailabilitySlot[]>([]);
  const [isLoadingSlots, setIsLoadingSlots] = useState<boolean>(false);

  // Live Policy Preview State
  const [previewData, setPreviewData] = useState<BookingPreviewResponse | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState<boolean>(false);

  // Submission & Success state
  const [idempotencyKey, setIdempotencyKey] = useState<string>(() =>
    typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `key-${Date.now()}-${Math.random()}`
  );
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submissionError, setSubmissionError] = useState<string | null>(null);
  const [successBooking, setSuccessBooking] = useState<any | null>(null);
  const [copiedPin, setCopiedPin] = useState<boolean>(false);

  // R5 Recurrence State
  const [isRecurring, setIsRecurring] = useState<boolean>(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<RecurrenceFrequency>('WEEKLY');
  const [recurrenceInterval, setRecurrenceInterval] = useState<number>(1);
  const [recurrenceWeekdays, setRecurrenceWeekdays] = useState<Weekday[]>(['MONDAY']);
  const [endCondition, setEndCondition] = useState<'count' | 'until'>('count');
  const [recurrenceCount, setRecurrenceCount] = useState<number>(4);
  const [recurrenceUntil, setRecurrenceUntil] = useState<string>('');
  const [bookingMode, setBookingMode] = useState<BookingSeriesMode>('ATOMIC');
  const [seriesPreviewData, setSeriesPreviewData] = useState<BookingSeriesPreviewResponse | null>(null);
  const [isSeriesPreviewLoading, setIsSeriesPreviewLoading] = useState<boolean>(false);
  const [successSeries, setSuccessSeries] = useState<BookingSeriesResponse | null>(null);
  const [authoritativeQuota, setAuthoritativeQuota] = useState<QuotaResponse | null>(null);
  const [showOccurrenceList, setShowOccurrenceList] = useState<boolean>(false);

  const defaultDate = useMemo(() => {
    return preselectedDate || new Date().toISOString().split('T')[0];
  }, [preselectedDate]);

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    reset,
    formState: { errors },
  } = useForm<BookingFormValues>({
    resolver: zodResolver(bookingSchema),
    defaultValues: {
      resourceId: preselectedResource?.id || '',
      date: defaultDate,
      startTime: preselectedStartTime || '14:00',
      endTime: preselectedEndTime || '15:00',
      expectedAttendance: 20,
      activityType: 'PROJECT_WORK',
      purpose: '',
      priority: 'NORMAL',
    },
  });

  const formResourceId = watch('resourceId');
  const formDate = watch('date');
  const formStartTime = watch('startTime');
  const formEndTime = watch('endTime');
  const formAttendance = watch('expectedAttendance');
  const formActivityType = watch('activityType');
  const formPurpose = watch('purpose');

  // Load resource list & authoritative quota on modal open
  useEffect(() => {
    if (isOpen) {
      setSubmissionError(null);
      setSuccessBooking(null);
      setSuccessSeries(null);
      setCopiedPin(false);
      setIsRecurring(false);
      setSeriesPreviewData(null);
      setRecurrenceFrequency('WEEKLY');
      setRecurrenceInterval(1);
      setRecurrenceCount(4);
      setEndCondition('count');
      setBookingMode('ATOMIC');
      setShowOccurrenceList(false);

      // Load authoritative quota from API
      api.me.quota().then((q) => setAuthoritativeQuota(q)).catch(() => {});

      // New idempotency key per modal session
      setIdempotencyKey(
        typeof crypto !== 'undefined' && crypto.randomUUID
          ? crypto.randomUUID()
          : `key-${Date.now()}-${Math.random()}`
      );

      if (preselectedResource) {
        setValue('resourceId', preselectedResource.id);
      } else {
        api.resources.list({ limit: 50 }).then((res) => {
          setResources(res.resources || []);
          if (res.resources?.length > 0 && !formResourceId) {
            setValue('resourceId', res.resources[0].id);
          }
        });
      }

      if (preselectedDate) setValue('date', preselectedDate);
      if (preselectedStartTime) setValue('startTime', preselectedStartTime);
      if (preselectedEndTime) setValue('endTime', preselectedEndTime);
    }
  }, [
    isOpen,
    preselectedResource,
    preselectedDate,
    preselectedStartTime,
    preselectedEndTime,
    setValue,
  ]);

  // Synchronize default recurrence weekday when date changes
  useEffect(() => {
    if (formDate) {
      const wk = getWeekdayFromDate(formDate);
      setRecurrenceWeekdays([wk]);
    }
  }, [formDate]);

  // Current resource object
  const currentResource = useMemo(() => {
    if (preselectedResource && preselectedResource.id === formResourceId) {
      return preselectedResource;
    }
    return resources.find((r) => r.id === formResourceId) || preselectedResource;
  }, [preselectedResource, resources, formResourceId]);

  // Fetch real availability slots whenever resourceId or date changes
  useEffect(() => {
    if (!isOpen || !formResourceId || !formDate) return;

    let active = true;
    setIsLoadingSlots(true);

    api.resources
      .getAvailability(formResourceId, formDate)
      .then((res) => {
        if (!active) return;
        setAvailabilitySlots(res.slots || []);
      })
      .catch(() => {
        if (active) setAvailabilitySlots([]);
      })
      .finally(() => {
        if (active) setIsLoadingSlots(false);
      });

    return () => {
      active = false;
    };
  }, [isOpen, formResourceId, formDate]);

  // Handle Duration Preset selection
  const handleSelectDuration = (minutes: number) => {
    setSelectedDuration(minutes);
    if (formStartTime) {
      const calculatedEnd = addMinutesToTime(formStartTime, minutes);
      setValue('endTime', calculatedEnd, { shouldValidate: true });
    }
  };

  // Handle Slot Click from Availability Grid
  const handleSlotClick = (slot: AvailabilitySlot) => {
    if (slot.status !== 'available') return;
    setValue('startTime', slot.startTime, { shouldValidate: true });
    const calculatedEnd = addMinutesToTime(slot.startTime, selectedDuration);
    setValue('endTime', calculatedEnd, { shouldValidate: true });
  };

  // Live Policy Preview with 300ms debounce
  useEffect(() => {
    if (!isOpen || !formResourceId || !formDate || !formStartTime || !formEndTime) {
      setPreviewData(null);
      return;
    }

    if (formEndTime <= formStartTime) {
      setPreviewData(null);
      return;
    }

    let active = true;
    setIsPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const startIso = new Date(`${formDate}T${formStartTime}:00`).toISOString();
        const endIso = new Date(`${formDate}T${formEndTime}:00`).toISOString();

        const previewRes = await api.bookings.preview({
          resourceId: formResourceId,
          startTime: startIso,
          endTime: endIso,
          expectedAttendance: Number(formAttendance) || 1,
          activityType: formActivityType as ActivityType,
          purpose: formPurpose || 'Campus Booking',
        });

        if (active) {
          setPreviewData(previewRes);
        }
      } catch (err: any) {
        if (active) {
          setPreviewData(null);
        }
      } finally {
        if (active) {
          setIsPreviewLoading(false);
        }
      }
    }, 300);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    isOpen,
    formResourceId,
    formDate,
    formStartTime,
    formEndTime,
    formAttendance,
    formActivityType,
    formPurpose,
  ]);

  // Live Recurring Series Preview with 350ms debounce
  useEffect(() => {
    if (!isOpen || !isRecurring || !formResourceId || !formDate || !formStartTime || !formEndTime) {
      setSeriesPreviewData(null);
      return;
    }

    if (formEndTime <= formStartTime) {
      setSeriesPreviewData(null);
      return;
    }

    let active = true;
    setIsSeriesPreviewLoading(true);

    const timer = setTimeout(async () => {
      try {
        const [sH, sM] = formStartTime.split(':').map(Number);
        const [eH, eM] = formEndTime.split(':').map(Number);
        const durationMinutes = (eH * 60 + eM) - (sH * 60 + sM);

        const previewRes = await api.bookings.previewSeries({
          resourceId: formResourceId,
          frequency: recurrenceFrequency,
          interval: Number(recurrenceInterval) || 1,
          weekdays: recurrenceFrequency === 'WEEKLY' ? recurrenceWeekdays : undefined,
          startDate: formDate,
          count: endCondition === 'count' ? Number(recurrenceCount) || 1 : undefined,
          until: endCondition === 'until' ? recurrenceUntil : undefined,
          startTime: formStartTime,
          durationMinutes,
          expectedAttendance: Number(formAttendance) || 1,
          activityType: formActivityType as ActivityType,
          purpose: formPurpose || 'Campus Series Reservation',
        });

        if (active) {
          setSeriesPreviewData(previewRes);
        }
      } catch (err: any) {
        if (active) {
          setSeriesPreviewData(null);
        }
      } finally {
        if (active) {
          setIsSeriesPreviewLoading(false);
        }
      }
    }, 350);

    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [
    isOpen,
    isRecurring,
    formResourceId,
    formDate,
    formStartTime,
    formEndTime,
    formAttendance,
    formActivityType,
    formPurpose,
    recurrenceFrequency,
    recurrenceInterval,
    recurrenceWeekdays,
    endCondition,
    recurrenceCount,
    recurrenceUntil,
    bookingMode,
  ]);

  // Form Submission Handler
  const onSubmit = async (values: BookingFormValues) => {
    setSubmissionError(null);
    setIsSubmitting(true);

    try {
      if (isRecurring) {
        const [sH, sM] = values.startTime.split(':').map(Number);
        const [eH, eM] = values.endTime.split(':').map(Number);
        const durationMinutes = (eH * 60 + eM) - (sH * 60 + sM);

        const seriesPayload = {
          resourceId: values.resourceId,
          frequency: recurrenceFrequency,
          interval: Number(recurrenceInterval) || 1,
          weekdays: recurrenceFrequency === 'WEEKLY' ? recurrenceWeekdays : undefined,
          startDate: values.date,
          count: endCondition === 'count' ? Number(recurrenceCount) || 1 : undefined,
          until: endCondition === 'until' ? recurrenceUntil : undefined,
          startTime: values.startTime,
          durationMinutes,
          expectedAttendance: Number(values.expectedAttendance),
          activityType: values.activityType as ActivityType,
          purpose: values.purpose.trim(),
          priority: values.priority as PriorityLevel,
          bookingMode,
        };

        const res = await api.bookings.createSeries(seriesPayload, idempotencyKey);
        setSuccessSeries(res);
        if (onBookingSuccess) {
          onBookingSuccess();
        }
      } else {
        const startDateTime = new Date(`${values.date}T${values.startTime}:00`).toISOString();
        const endDateTime = new Date(`${values.date}T${values.endTime}:00`).toISOString();

        const res = await api.bookings.create(
          {
            resourceId: values.resourceId,
            startTime: startDateTime,
            endTime: endDateTime,
            purpose: values.purpose.trim(),
            activityType: values.activityType as ActivityType,
            expectedAttendance: Number(values.expectedAttendance),
            priority: values.priority as PriorityLevel,
          },
          idempotencyKey
        );

        setSuccessBooking(res.booking);
        if (onBookingSuccess) {
          onBookingSuccess();
        }
      }
    } catch (err: any) {
      setSubmissionError(err.message || 'Failed to submit booking reservation.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Helper to apply an alternative slot
  const applyAlternativeSlot = (slot: AlternativeSlot) => {
    setValue('date', slot.date, { shouldValidate: true });
    setValue('startTime', slot.startTime, { shouldValidate: true });
    setValue('endTime', slot.endTime, { shouldValidate: true });
    setSubmissionError(null);
  };

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="booking-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
    >
      <div className="bg-white rounded-2xl max-w-2xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-gray-100 overflow-hidden">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-white sticky top-0 z-10">
          <div>
            <h2 id="booking-modal-title" className="text-xl font-bold text-gray-900">
              {successSeries
                ? 'Series Reservation Confirmation'
                : successBooking
                ? 'Booking Confirmation'
                : isRecurring
                ? 'Recurring Series Reservation'
                : 'Reserve Campus Resource'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {currentResource?.name || 'Classrooms, Auditoriums, Computer Labs & Facilities'}
            </p>
          </div>
          <button
            onClick={onClose}
            aria-label="Close modal"
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">
          {successSeries ? (
            /* ================= SERIES SUCCESS CONFIRMATION VIEW ================= */
            <div className="py-4 space-y-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCheck className="w-10 h-10" />
              </div>

              <div>
                <span className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 bg-emerald-100 text-emerald-800">
                  {recurrenceFrequency} Series Scheduled ({successSeries.bookingMode} Mode)
                </span>
                <h3 className="text-xl font-bold text-gray-900">
                  Recurring Series Reserved!
                </h3>
                {successSeries.seriesId && (
                  <p className="text-xs text-gray-600 mt-1">
                    Series ID:{' '}
                    <span className="font-mono font-bold text-gray-900 text-sm">
                      {successSeries.seriesId}
                    </span>
                  </p>
                )}
              </div>

              {/* Stats Summary Pill Grid */}
              <div className="grid grid-cols-3 gap-3 max-w-md mx-auto">
                <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-gray-500 uppercase block">Total Requested</span>
                  <span className="text-xl font-black text-gray-900">{successSeries.totalOccurrences}</span>
                </div>
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-emerald-700 uppercase block">Booked</span>
                  <span className="text-xl font-black text-emerald-700">{successSeries.successfulCount}</span>
                </div>
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-center">
                  <span className="text-[10px] font-bold text-amber-700 uppercase block">Skipped / Clashes</span>
                  <span className="text-xl font-black text-amber-700">{successSeries.failedCount}</span>
                </div>
              </div>

              {/* Occurrence Results List */}
              <div className="bg-gray-50 p-4 rounded-xl text-left border border-gray-100 max-w-md mx-auto space-y-2 max-h-48 overflow-y-auto">
                <span className="text-xs font-bold text-gray-700 block mb-1">
                  Scheduled Dates & Status:
                </span>
                {successSeries.results.map((r, idx) => (
                  <div key={idx} className="flex items-center justify-between py-1.5 border-b border-gray-200/60 last:border-0 text-xs">
                    <div>
                      <span className="font-semibold text-gray-800">{r.date}</span>
                      <span className="text-gray-400 text-[11px] ml-1">({r.startTime} - {r.endTime})</span>
                      {r.bookingNumber && (
                        <span className="font-mono text-[10px] text-gray-500 block">
                          Ref: {r.bookingNumber}
                        </span>
                      )}
                    </div>
                    <div>
                      {r.isCreated ? (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                          {r.approvalStatus || 'RESERVED'}
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-red-100 text-red-800" title={r.reason}>
                          {r.status}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions: Add Series to Calendar (.ics) & Done */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto pt-2">
                <button
                  type="button"
                  onClick={() => downloadSeriesIcsCalendar(successSeries, currentResource)}
                  className="flex-1 py-2.5 px-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-xs"
                >
                  <Download className="w-4 h-4 text-gray-500" />
                  Add Series to Calendar (.ics)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 px-4 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition text-xs"
                >
                  Done & View Dashboard
                </button>
              </div>
            </div>
          ) : successBooking ? (
            /* ================= SUCCESS CONFIRMATION VIEW ================= */
            <div className="py-4 space-y-6 text-center">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
                <CheckCircle2 className="w-10 h-10" />
              </div>

              <div>
                <span
                  className={`inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider mb-2 ${
                    successBooking.status === 'CONFIRMED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : 'bg-amber-100 text-amber-800'
                  }`}
                >
                  {successBooking.status === 'CONFIRMED'
                    ? 'Instant Reservation Confirmed'
                    : 'Pending Approver Endorsement'}
                </span>
                <h3 className="text-xl font-bold text-gray-900">
                  {successBooking.status === 'CONFIRMED'
                    ? 'Your Space is Reserved!'
                    : 'Booking Request Submitted!'}
                </h3>
                <p className="text-xs text-gray-600 mt-1">
                  Booking Reference:{' '}
                  <span className="font-mono font-bold text-gray-900 text-sm">
                    {successBooking.bookingNumber}
                  </span>
                </p>
              </div>

              {/* 6-Digit Check-In PIN Card */}
              {successBooking.checkInToken && (
                <div className="p-4 bg-orange-50/90 border border-orange-200 rounded-2xl max-w-sm mx-auto shadow-sm">
                  <span className="text-[11px] font-bold text-[#F58220] uppercase tracking-wider block mb-1">
                    6-Digit Check-In PIN
                  </span>
                  <div className="flex items-center justify-center gap-3">
                    <span className="text-3xl font-black font-mono tracking-widest text-[#292929]">
                      {successBooking.checkInToken}
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        if (typeof navigator !== 'undefined') {
                          navigator.clipboard.writeText(successBooking.checkInToken);
                          setCopiedPin(true);
                          setTimeout(() => setCopiedPin(false), 2000);
                        }
                      }}
                      className="p-1.5 text-orange-700 bg-orange-100 hover:bg-orange-200 rounded-lg transition"
                      title="Copy check-in PIN"
                    >
                      {copiedPin ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <span className="text-[11px] text-gray-500 block mt-1.5">
                    Enter this PIN or present the QR code at the facility within 15 minutes of start.
                  </span>
                </div>
              )}

              {/* QR Code */}
              <div className="flex flex-col items-center justify-center p-4 bg-white border border-gray-200 rounded-2xl max-w-xs mx-auto shadow-sm">
                <div className="p-2 bg-white rounded-xl">
                  <QRCodeSVG
                    value={JSON.stringify({
                      bookingNumber: successBooking.bookingNumber,
                      token: successBooking.checkInToken,
                      resource: currentResource?.name,
                    })}
                    size={140}
                    level="M"
                    includeMargin={false}
                  />
                </div>
                <span className="text-[10px] text-gray-400 font-medium mt-2">
                  Venue Check-In QR Pass
                </span>
              </div>

              {/* Booking Summary Details */}
              <div className="bg-gray-50 p-4 rounded-xl text-left text-xs text-gray-600 space-y-2 border border-gray-100 max-w-md mx-auto">
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Facility:</span>
                  <span className="font-semibold text-gray-800">
                    {currentResource?.name} ({currentResource?.building})
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Date & Slot:</span>
                  <span className="font-semibold text-gray-800">
                    {formDate} ({formStartTime} - {formEndTime})
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Purpose:</span>
                  <span className="font-semibold text-gray-800 truncate max-w-[220px]">
                    {successBooking.purpose}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-gray-400">Attendance:</span>
                  <span className="font-semibold text-gray-800">
                    {successBooking.expectedAttendance || formAttendance} attendees
                  </span>
                </div>
              </div>

              {/* Actions: Add to Calendar (.ics) & Done */}
              <div className="flex flex-col sm:flex-row gap-3 max-w-md mx-auto pt-2">
                <button
                  type="button"
                  onClick={() => downloadIcsCalendar(successBooking, currentResource)}
                  className="flex-1 py-2.5 px-4 bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 text-xs"
                >
                  <Download className="w-4 h-4 text-gray-500" />
                  Add to Calendar (.ics)
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="flex-1 py-2.5 px-4 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition text-xs"
                >
                  Done & View Dashboard
                </button>
              </div>
            </div>
          ) : (
            /* ================= BOOKING RESERVATION FORM ================= */
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              {/* Submission Error Banner with Alternative Slots if available */}
              {submissionError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-xl space-y-2 text-xs text-red-700">
                  <div className="flex items-start gap-2.5">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                    <div>
                      <div className="font-bold">Reservation Conflict / Refusal</div>
                      <div className="mt-0.5">{submissionError}</div>
                    </div>
                  </div>

                  {previewData?.alternativeSlots && previewData.alternativeSlots.length > 0 && !isRecurring && (
                    <div className="pt-2 border-t border-red-100">
                      <span className="font-bold text-red-800 block mb-1">
                        Recommended Alternative Slots:
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {previewData.alternativeSlots.map((alt, idx) => (
                          <button
                            key={idx}
                            type="button"
                            onClick={() => applyAlternativeSlot(alt)}
                            className="px-2.5 py-1 bg-white border border-red-200 rounded-lg text-[11px] font-bold text-red-700 hover:bg-red-100 transition shadow-sm"
                          >
                            {alt.date === formDate ? 'Today' : alt.date} {alt.startTime} -{' '}
                            {alt.endTime}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* Resource Selector (if not preselected) */}
              {!preselectedResource && (
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Select Facility or Room *
                  </label>
                  <select
                    {...register('resourceId')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  >
                    {resources.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.name} ({r.category} • Capacity: {r.capacity} • {r.building})
                      </option>
                    ))}
                  </select>
                  {errors.resourceId && (
                    <p className="text-[11px] text-red-600 mt-1">{errors.resourceId.message}</p>
                  )}
                </div>
              )}

              {/* Resource Info Card */}
              {currentResource && (
                <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                  <div>
                    <div className="font-bold text-gray-900">{currentResource.name}</div>
                    <div className="text-gray-500">
                      {currentResource.building} • Max Capacity: {currentResource.capacity} seats
                    </div>
                  </div>
                  <div className="text-right">
                    <span
                      className={`inline-block text-[10px] font-bold px-2 py-0.5 rounded ${
                        currentResource.requiresApproval
                          ? 'bg-amber-100 text-amber-800'
                          : 'bg-emerald-100 text-emerald-800'
                      }`}
                    >
                      {currentResource.requiresApproval
                        ? 'Requires Approver Endorsement'
                        : 'Instant Auto-Approve'}
                    </span>
                  </div>
                </div>
              )}

              {/* Date & Duration Presets */}
              <div className="space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      {isRecurring ? 'Series Start Date *' : 'Date *'}
                    </label>
                    <input
                      type="date"
                      {...register('date')}
                      min={new Date().toISOString().split('T')[0]}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                    {errors.date && (
                      <p className="text-[11px] text-red-600 mt-1">{errors.date.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">
                      Start Time *
                    </label>
                    <input
                      type="time"
                      {...register('startTime')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                    {errors.startTime && (
                      <p className="text-[11px] text-red-600 mt-1">{errors.startTime.message}</p>
                    )}
                  </div>

                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-1">End Time *</label>
                    <input
                      type="time"
                      {...register('endTime')}
                      className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                    />
                    {errors.endTime && (
                      <p className="text-[11px] text-red-600 mt-1">{errors.endTime.message}</p>
                    )}
                  </div>
                </div>

                {/* Duration Presets Row */}
                <div>
                  <span className="text-[11px] font-bold text-gray-500 block mb-1.5">
                    Quick Duration Presets:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    {DURATION_PRESETS.map((preset) => {
                      const isSelected = selectedDuration === preset.minutes;
                      return (
                        <button
                          key={preset.minutes}
                          type="button"
                          onClick={() => handleSelectDuration(preset.minutes)}
                          className={`px-3 py-1 rounded-lg text-xs font-bold transition border ${
                            isSelected
                              ? 'bg-[#F58220] text-white border-[#F58220] shadow-sm'
                              : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                          }`}
                        >
                          {preset.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* 30-Minute Availability Slot Grid */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-gray-800 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-[#F58220]" />
                    Facility Slots for {formDate}
                  </span>
                  {isLoadingSlots && (
                    <span className="text-[10px] text-gray-400 font-medium">Checking live slots...</span>
                  )}
                </div>

                <div className="max-h-28 overflow-y-auto pr-1">
                  {availabilitySlots.length === 0 ? (
                    <p className="text-[11px] text-gray-400 py-2">
                      {isLoadingSlots
                        ? 'Loading availability slots...'
                        : 'No operating slots for this date.'}
                    </p>
                  ) : (
                    <div className="grid grid-cols-4 sm:grid-cols-6 gap-1.5">
                      {availabilitySlots.map((slot, idx) => {
                        const isAvailable = slot.status === 'available';
                        const isCurrentStart = formStartTime === slot.startTime;

                        return (
                          <button
                            key={idx}
                            type="button"
                            disabled={!isAvailable}
                            onClick={() => handleSlotClick(slot)}
                            title={
                              isAvailable
                                ? `Available (${slot.startTime} - ${slot.endTime})`
                                : `${slot.status}: ${slot.reason || 'Unavailable'}`
                            }
                            className={`py-1 px-1 rounded text-[11px] font-mono font-medium transition text-center truncate ${
                              isCurrentStart
                                ? 'bg-[#F58220] text-white ring-2 ring-[#F58220]/40 font-bold'
                                : isAvailable
                                ? 'bg-white text-emerald-800 border border-emerald-300 hover:bg-emerald-50'
                                : 'bg-gray-100 text-gray-400 border border-gray-200 cursor-not-allowed opacity-60'
                            }`}
                          >
                            {slot.startTime}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              {/* R5 Recurrence Toggle & Configuration */}
              <div className="p-3.5 bg-orange-50/50 border border-orange-200/70 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-orange-100 flex items-center justify-center text-[#F58220]">
                      <Repeat className="w-4 h-4" />
                    </div>
                    <div>
                      <span className="text-xs font-bold text-gray-900 block">
                        Repeat this booking (Recurring Series)
                      </span>
                      <span className="text-[11px] text-gray-500">
                        Schedule recurring weekly sessions or multi-day reservations
                      </span>
                    </div>
                  </div>

                  {/* Toggle Switch */}
                  <button
                    type="button"
                    role="switch"
                    aria-checked={isRecurring}
                    onClick={() => setIsRecurring(!isRecurring)}
                    className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      isRecurring ? 'bg-[#F58220]' : 'bg-gray-300'
                    }`}
                  >
                    <span
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-lg ring-0 transition duration-200 ease-in-out ${
                        isRecurring ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {/* Expanded Recurrence Options */}
                {isRecurring && (
                  <div className="pt-2 border-t border-orange-200/60 space-y-3 text-xs">
                    {/* Frequency & Interval */}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Frequency
                        </label>
                        <div className="grid grid-cols-2 gap-1.5 p-1 bg-white rounded-lg border border-gray-200">
                          <button
                            type="button"
                            onClick={() => setRecurrenceFrequency('WEEKLY')}
                            className={`py-1 rounded text-center text-xs font-bold transition ${
                              recurrenceFrequency === 'WEEKLY'
                                ? 'bg-[#F58220] text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            Weekly
                          </button>
                          <button
                            type="button"
                            onClick={() => setRecurrenceFrequency('DAILY')}
                            className={`py-1 rounded text-center text-xs font-bold transition ${
                              recurrenceFrequency === 'DAILY'
                                ? 'bg-[#F58220] text-white shadow-sm'
                                : 'text-gray-600 hover:bg-gray-100'
                            }`}
                          >
                            Daily
                          </button>
                        </div>
                      </div>

                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Repeat Every
                        </label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min={1}
                            max={recurrenceFrequency === 'DAILY' ? 12 : 16}
                            value={recurrenceInterval}
                            onChange={(e) => setRecurrenceInterval(Math.max(1, parseInt(e.target.value) || 1))}
                            className="w-20 px-2.5 py-1.5 bg-white border border-gray-200 rounded-lg text-xs font-bold text-center focus:outline-none focus:ring-2 focus:ring-[#F58220]/20"
                          />
                          <span className="text-gray-600 font-medium">
                            {recurrenceFrequency === 'WEEKLY'
                              ? recurrenceInterval === 1
                                ? 'week'
                                : 'weeks'
                              : recurrenceInterval === 1
                              ? 'day'
                              : 'days'}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* Weekday Selector (Only when Weekly) */}
                    {recurrenceFrequency === 'WEEKLY' && (
                      <div>
                        <label className="block text-[11px] font-bold text-gray-700 mb-1">
                          Repeat On Weekdays
                        </label>
                        <div className="flex flex-wrap gap-1.5">
                          {WEEKDAY_ORDER.map(({ label, value }) => {
                            const isSelected = recurrenceWeekdays.includes(value);
                            return (
                              <button
                                key={value}
                                type="button"
                                onClick={() => {
                                  if (isSelected) {
                                    if (recurrenceWeekdays.length > 1) {
                                      setRecurrenceWeekdays(recurrenceWeekdays.filter((w) => w !== value));
                                    }
                                  } else {
                                    setRecurrenceWeekdays([...recurrenceWeekdays, value]);
                                  }
                                }}
                                className={`px-2.5 py-1 rounded-lg text-xs font-bold transition border ${
                                  isSelected
                                    ? 'bg-[#F58220] text-white border-[#F58220] shadow-sm'
                                    : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                                }`}
                              >
                                {label}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}

                    {/* End Condition */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">
                        End Condition (Max 16 occurrences)
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <label
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                            endCondition === 'count'
                              ? 'bg-white border-[#F58220] shadow-xs'
                              : 'bg-white/60 border-gray-200 hover:bg-white'
                          }`}
                        >
                          <input
                            type="radio"
                            name="endCondition"
                            checked={endCondition === 'count'}
                            onChange={() => setEndCondition('count')}
                            className="text-[#F58220] focus:ring-[#F58220]"
                          />
                          <span className="font-semibold text-gray-800">End after:</span>
                          <input
                            type="number"
                            min={1}
                            max={16}
                            disabled={endCondition !== 'count'}
                            value={recurrenceCount}
                            onChange={(e) =>
                              setRecurrenceCount(Math.min(16, Math.max(1, parseInt(e.target.value) || 1)))
                            }
                            className="w-14 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-center text-xs font-bold focus:outline-none"
                          />
                          <span className="text-gray-500 text-[11px]">times</span>
                        </label>

                        <label
                          className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition ${
                            endCondition === 'until'
                              ? 'bg-white border-[#F58220] shadow-xs'
                              : 'bg-white/60 border-gray-200 hover:bg-white'
                          }`}
                        >
                          <input
                            type="radio"
                            name="endCondition"
                            checked={endCondition === 'until'}
                            onChange={() => setEndCondition('until')}
                            className="text-[#F58220] focus:ring-[#F58220]"
                          />
                          <span className="font-semibold text-gray-800">End on:</span>
                          <input
                            type="date"
                            min={formDate}
                            disabled={endCondition !== 'until'}
                            value={recurrenceUntil}
                            onChange={(e) => setRecurrenceUntil(e.target.value)}
                            className="flex-1 px-2 py-0.5 bg-gray-50 border border-gray-200 rounded text-xs focus:outline-none"
                          />
                        </label>
                      </div>
                    </div>

                    {/* Booking Mode: Atomic vs Partial */}
                    <div>
                      <label className="block text-[11px] font-bold text-gray-700 mb-1">
                        Series Execution Mode
                      </label>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setBookingMode('ATOMIC')}
                          className={`p-2.5 rounded-xl border text-left transition ${
                            bookingMode === 'ATOMIC'
                              ? 'bg-white border-[#F58220] ring-1 ring-[#F58220] shadow-xs'
                              : 'bg-white/60 border-gray-200 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-900">Atomic Mode</span>
                            {bookingMode === 'ATOMIC' && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#F58220]" />
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            All-or-nothing: if any date encounters a timetable clash or booking conflict, 0 bookings are made.
                          </p>
                        </button>

                        <button
                          type="button"
                          onClick={() => setBookingMode('PARTIAL')}
                          className={`p-2.5 rounded-xl border text-left transition ${
                            bookingMode === 'PARTIAL'
                              ? 'bg-white border-[#F58220] ring-1 ring-[#F58220] shadow-xs'
                              : 'bg-white/60 border-gray-200 hover:bg-white'
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-gray-900">Partial Mode</span>
                            {bookingMode === 'PARTIAL' && (
                              <CheckCircle2 className="w-3.5 h-3.5 text-[#F58220]" />
                            )}
                          </div>
                          <p className="text-[10px] text-gray-500 mt-0.5">
                            Book available dates and skip conflicts or policy refusals with transparent reports.
                          </p>
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Activity Type & Attendance */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-gray-700 mb-1">
                    Activity Type *
                  </label>
                  <select
                    {...register('activityType')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  >
                    <option value="PROJECT_WORK">Project Work / Study Group</option>
                    <option value="CLASS_LECTURE">Extra Lecture / Remedial</option>
                    <option value="LAB_SESSION">Practical / Hands-on Lab</option>
                    <option value="CLUB_EVENT">Student Club / Society Event</option>
                    <option value="FACULTY_MEETING">Department / Faculty Meeting</option>
                    <option value="GUEST_SEMINAR">Guest Speaker / Seminar</option>
                    <option value="SPORTS_PRACTICE">Sports / Recreation</option>
                  </select>
                  {errors.activityType && (
                    <p className="text-[11px] text-red-600 mt-1">{errors.activityType.message}</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-bold text-gray-700">
                      Expected Attendance *
                    </label>
                    {currentResource && (
                      <span className="text-[10px] text-gray-500">
                        Max capacity: {currentResource.capacity}
                      </span>
                    )}
                  </div>
                  <input
                    type="number"
                    min={1}
                    max={currentResource ? currentResource.capacity : 500}
                    {...register('expectedAttendance')}
                    className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  />
                  {errors.expectedAttendance && (
                    <p className="text-[11px] text-red-600 mt-1">
                      {errors.expectedAttendance.message}
                    </p>
                  )}
                </div>
              </div>

              {/* Purpose / Agenda */}
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Booking Purpose / Agenda *
                </label>
                <textarea
                  {...register('purpose')}
                  placeholder="e.g. DAA Project Discussion, GDSC Mobile App Workshop..."
                  rows={2}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                />
                {errors.purpose && (
                  <p className="text-[11px] text-red-600 mt-1">{errors.purpose.message}</p>
                )}
              </div>

              {/* Live Preview Card: Series Preview if isRecurring, otherwise Single Booking Preview */}
              {isRecurring ? (
                <div className="space-y-2">
                  {isSeriesPreviewLoading ? (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2 text-xs text-gray-500">
                      <span className="inline-block animate-spin w-3.5 h-3.5 border-2 border-[#F58220] border-t-transparent rounded-full" />
                      <span>Simulating recurring occurrences & checking conflict state...</span>
                    </div>
                  ) : seriesPreviewData ? (
                    <div className="p-3.5 bg-gray-50/90 border border-gray-200 rounded-xl space-y-3 text-xs">
                      {/* Summary Banner */}
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold">
                          {seriesPreviewData.conflictingOccurrencesCount > 0 ? (
                            bookingMode === 'ATOMIC' ? (
                              <div className="flex items-center gap-1.5 text-red-700">
                                <AlertTriangle className="w-4 h-4 text-red-600 shrink-0" />
                                <span>Conflict Detected ({seriesPreviewData.conflictingOccurrencesCount} date clashes)</span>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-amber-800">
                                <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>Partial Booking ({seriesPreviewData.validOccurrencesCount} of {seriesPreviewData.totalOccurrences} dates available)</span>
                              </div>
                            )
                          ) : (
                            <div className="flex items-center gap-1.5 text-emerald-800">
                              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                              <span>All {seriesPreviewData.totalOccurrences} Occurrences Available</span>
                            </div>
                          )}
                        </div>

                        <span className="px-2 py-0.5 bg-white rounded-md font-mono text-[10px] font-bold border border-gray-200">
                          {seriesPreviewData.totalOccurrences} dates • {bookingMode}
                        </span>
                      </div>

                      {/* Conflict Guidance message */}
                      {seriesPreviewData.conflictingOccurrencesCount > 0 && bookingMode === 'ATOMIC' && (
                        <p className="text-[11px] text-red-700 bg-red-50 p-2 rounded-lg border border-red-200">
                          Atomic mode requires every date to be conflict-free. Switch to <strong>Partial Mode</strong> above to automatically book the {seriesPreviewData.validOccurrencesCount} available dates and skip clashes, or select a different time slot.
                        </p>
                      )}

                      {/* Weekly Quota Breakdown */}
                      {seriesPreviewData.weeklyBreakdowns && seriesPreviewData.weeklyBreakdowns.length > 0 && (
                        <div className="pt-2 border-t border-gray-200/80 space-y-1.5">
                          <span className="font-bold text-gray-700 text-[11px] block">
                            Cumulative Weekly Quota Usage:
                          </span>
                          <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                            {seriesPreviewData.weeklyBreakdowns.map((wb, idx) => (
                              <div
                                key={idx}
                                className={`flex items-center justify-between p-1.5 rounded-lg text-[11px] ${
                                  wb.isExceeded
                                    ? 'bg-red-50 text-red-800 border border-red-200'
                                    : 'bg-white text-gray-700 border border-gray-100'
                                }`}
                              >
                                <span>{wb.weekStart} – {wb.weekEnd}</span>
                                <span className="font-mono font-medium">
                                  +{wb.seriesRequestedHours}h req • {wb.remainingQuotaAfterSeries}h remaining {wb.isExceeded && '⚠️ Exceeds!'}
                                </span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Expandable Occurrence List */}
                      <div className="pt-2 border-t border-gray-200/80">
                        <button
                          type="button"
                          onClick={() => setShowOccurrenceList(!showOccurrenceList)}
                          className="w-full flex items-center justify-between text-[11px] font-bold text-gray-700 hover:text-gray-900"
                        >
                          <span>Review Occurrence Schedule ({seriesPreviewData.occurrences.length} dates)</span>
                          {showOccurrenceList ? (
                            <ChevronUp className="w-3.5 h-3.5" />
                          ) : (
                            <ChevronDown className="w-3.5 h-3.5" />
                          )}
                        </button>

                        {showOccurrenceList && (
                          <div className="mt-2 space-y-1.5 max-h-36 overflow-y-auto pr-1">
                            {seriesPreviewData.occurrences.map((occ, idx) => (
                              <div
                                key={idx}
                                className="flex items-center justify-between p-1.5 bg-white border border-gray-200 rounded-lg text-[11px]"
                              >
                                <span className="font-semibold text-gray-800">
                                  {occ.date} ({occ.startTime} - {occ.endTime})
                                </span>
                                <span
                                  className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                                    occ.status === 'AVAILABLE'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : occ.status === 'REQUIRES_APPROVAL'
                                      ? 'bg-blue-100 text-blue-800'
                                      : occ.status === 'TIMETABLE_CLASH'
                                      ? 'bg-purple-100 text-purple-800'
                                      : 'bg-red-100 text-red-800'
                                  }`}
                                >
                                  {occ.status.replace('_', ' ')}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : null}
                </div>
              ) : (
                /* Single Booking Policy Preview Card */
                <div className="space-y-2">
                  {isPreviewLoading ? (
                    <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center gap-2 text-xs text-gray-500">
                      <span className="inline-block animate-spin w-3.5 h-3.5 border-2 border-[#F58220] border-t-transparent rounded-full" />
                      <span>Evaluating campus booking policies & weekly quota...</span>
                    </div>
                  ) : previewData ? (
                    <div
                      className={`p-3.5 rounded-xl border text-xs space-y-2 ${
                        previewData.decision === 'AUTO_CONFIRMED'
                          ? 'bg-emerald-50/70 border-emerald-200 text-emerald-900'
                          : previewData.decision === 'REQUIRES_APPROVAL'
                          ? 'bg-blue-50/70 border-blue-200 text-blue-900'
                          : 'bg-red-50/70 border-red-200 text-red-900'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 font-bold">
                          {previewData.decision === 'AUTO_CONFIRMED' ? (
                            <>
                              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                              <span>Instant Auto-Confirmation</span>
                            </>
                          ) : previewData.decision === 'REQUIRES_APPROVAL' ? (
                            <>
                              <Clock className="w-4 h-4 text-blue-600" />
                              <span>Requires Approver Endorsement</span>
                            </>
                          ) : (
                            <>
                              <AlertCircle className="w-4 h-4 text-red-600" />
                              <span>Policy Restriction / Conflict</span>
                            </>
                          )}
                        </div>

                        {/* Remaining Quota Badge */}
                        <span className="px-2 py-0.5 bg-white/80 rounded-md font-mono text-[10px] font-bold border border-gray-200 shadow-2xs">
                          Quota: {previewData.remainingWeeklyQuota}h / {previewData.maxWeeklyHours}h left
                        </span>
                      </div>

                      <p className="text-[11px] opacity-90">
                        {previewData.reason ||
                          previewData.policyMessages?.[0] ||
                          'Request matches all policy rules.'}
                      </p>

                      {/* Show alternative slots right in preview if conflict detected */}
                      {previewData.alternativeSlots && previewData.alternativeSlots.length > 0 && (
                        <div className="pt-2 border-t border-black/5">
                          <span className="font-bold text-[11px] block mb-1">
                            Alternative Available Times:
                          </span>
                          <div className="flex flex-wrap gap-1.5">
                            {previewData.alternativeSlots.map((alt, idx) => (
                              <button
                                key={idx}
                                type="button"
                                onClick={() => applyAlternativeSlot(alt)}
                                className="px-2 py-0.5 bg-white rounded text-[10px] font-bold border border-gray-200 hover:bg-gray-50 transition"
                              >
                                {alt.startTime} - {alt.endTime} ({alt.date === formDate ? 'Today' : alt.date})
                              </button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : null}
                </div>
              )}

              {/* Safety notice */}
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-start gap-2 text-xs text-gray-600">
                <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-[#F58220]" />
                <span>
                  Concurrency lock active. Double-booking prevention and 15-minute auto-release are
                  enforced.
                </span>
              </div>

              {/* Submit Button */}
              <div className="pt-2">
                <button
                  type="submit"
                  disabled={
                    isSubmitting ||
                    (isRecurring
                      ? (bookingMode === 'ATOMIC' && (seriesPreviewData?.conflictingOccurrencesCount || 0) > 0) ||
                        (seriesPreviewData !== null && seriesPreviewData.validOccurrencesCount === 0)
                      : previewData !== null && !previewData.allowed)
                  }
                  className="w-full py-3 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow-md transition flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
                >
                  {isSubmitting ? (
                    <>
                      <span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                      <span>{isRecurring ? 'Scheduling Recurring Series...' : 'Submitting Reservation...'}</span>
                    </>
                  ) : isRecurring ? (
                    <span>
                      {bookingMode === 'ATOMIC' && (seriesPreviewData?.conflictingOccurrencesCount || 0) > 0
                        ? 'Cannot Reserve (Atomic Conflicts Exist)'
                        : seriesPreviewData?.validOccurrencesCount === 0
                        ? 'No Available Dates'
                        : `Confirm Series Reservation (${
                            seriesPreviewData?.validOccurrencesCount ?? recurrenceCount
                          } Dates)`}
                    </span>
                  ) : (
                    <span>
                      {previewData?.requiresApproval
                        ? 'Submit for Approval'
                        : 'Confirm & Reserve Space'}
                    </span>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
