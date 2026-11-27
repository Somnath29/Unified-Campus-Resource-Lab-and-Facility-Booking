'use client';

import React, { useState } from 'react';
import { X, AlertTriangle, AlertCircle, Trash2, Calendar } from 'lucide-react';
import { api } from '@/lib/api';
import { BookingListItemDTO, OccurrenceCancellationScope } from '@lpu/shared';
import { formatKolkataDateTime } from '@/lib/timezone';

interface CancelBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
  onSuccess: (bookingId: string, message: string) => void;
}

export function CancelBookingModal({
  isOpen,
  onClose,
  booking,
  onSuccess,
}: CancelBookingModalProps) {
  const [reason, setReason] = useState('');
  const [scope, setScope] = useState<OccurrenceCancellationScope>('ONE');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  const cutoffMinutes = booking.eligibility?.cancellationCutoffMinutes ?? 60;
  const isRecurring = Boolean(booking.seriesId || booking.series);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reason.trim()) {
      setErrorMessage('Please provide a valid cancellation reason.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await api.bookings.cancel(
        booking.id,
        reason.trim(),
        isRecurring ? scope : undefined
      );

      onSuccess(booking.id, res.message || 'Booking cancelled successfully.');
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to cancel booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-red-600">
            <Trash2 className="w-5 h-5" />
            <h2 className="text-lg font-bold text-[#292929]">Cancel Reservation</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Booking Summary */}
        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-xs space-y-1.5">
          <div className="font-semibold text-gray-800">
            {booking.resource?.name}
          </div>
          <div className="text-gray-500 flex items-center gap-1.5">
            <Calendar className="w-3.5 h-3.5 text-[#F58220]" />
            <span>{formatKolkataDateTime(booking.startTime)} - {formatKolkataDateTime(booking.endTime)}</span>
          </div>
          <div className="text-[11px] text-gray-400">
            Reservation #{booking.bookingNumber}
          </div>
        </div>

        {/* Cancellation Cutoff Warning */}
        <div className="p-3 bg-amber-50/80 border border-amber-200/70 rounded-xl text-xs text-amber-800 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
          <div>
            <span className="font-bold">Cancellation Policy:</span> Requesters can cancel bookings up to{' '}
            <span className="font-bold">{cutoffMinutes} minutes</span> before the scheduled start time. After the cutoff, only department approvers or administrators can cancel.
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Recurring Scope Selection */}
          {isRecurring && (
            <div className="space-y-2 p-3 bg-orange-50/60 border border-orange-200/60 rounded-xl">
              <label className="text-xs font-bold text-gray-800 block">
                Recurring Series Options
              </label>
              <div className="space-y-1.5 text-xs">
                <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                  <input
                    type="radio"
                    name="scope"
                    value="ONE"
                    checked={scope === 'ONE'}
                    onChange={() => setScope('ONE')}
                    className="accent-[#F58220]"
                  />
                  <span>Cancel this occurrence only</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                  <input
                    type="radio"
                    name="scope"
                    value="THIS_AND_FOLLOWING"
                    checked={scope === 'THIS_AND_FOLLOWING'}
                    onChange={() => setScope('THIS_AND_FOLLOWING')}
                    className="accent-[#F58220]"
                  />
                  <span>Cancel this and following occurrences</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer text-gray-700">
                  <input
                    type="radio"
                    name="scope"
                    value="ENTIRE_SERIES"
                    checked={scope === 'ENTIRE_SERIES'}
                    onChange={() => setScope('ENTIRE_SERIES')}
                    className="accent-[#F58220]"
                  />
                  <span>Cancel entire recurring series</span>
                </label>
              </div>
            </div>
          )}

          {/* Reason Input */}
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">
              Reason for Cancellation <span className="text-red-500">*</span>
            </label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Please provide a clear reason for releasing this reservation..."
              rows={3}
              required
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition resize-none"
            />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Actions */}
          <div className="flex items-center justify-end gap-2.5 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="px-4 py-2 border border-gray-200 hover:bg-gray-50 text-gray-600 rounded-xl text-xs font-semibold transition"
            >
              Keep Booking
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5"
            >
              {isSubmitting ? 'Cancelling...' : 'Confirm Cancellation'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
