'use client';

import React, { useState } from 'react';
import { X, CheckCircle2, AlertCircle, LogOut } from 'lucide-react';
import { api } from '@/lib/api';
import { BookingListItemDTO } from '@lpu/shared';
import { formatKolkataDateTime } from '@/lib/timezone';

interface EndEarlyModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
  onSuccess: (updated: BookingListItemDTO, message: string) => void;
}

export function EndEarlyModal({
  isOpen,
  onClose,
  booking,
  onSuccess,
}: EndEarlyModalProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  const handleEndEarly = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await api.bookings.endEarly(booking.id);
      onSuccess(res.booking, res.message);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to complete session early.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-emerald-600">
            <LogOut className="w-5 h-5" />
            <h2 className="text-lg font-bold text-[#292929]">Conclude Session Early</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content */}
        <div className="space-y-3 text-xs text-gray-600">
          <p>
            Are you finished using <span className="font-bold text-gray-800">{booking.resource?.name}</span>?
          </p>
          <div className="p-3 bg-emerald-50/70 border border-emerald-100 rounded-xl space-y-1 text-emerald-800">
            <div className="font-semibold flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              Releasing Campus Facility
            </div>
            <p className="text-[11px] text-emerald-700 leading-relaxed">
              Ending your session early will mark your reservation as completed and release the remaining slot so other students and faculty can utilize the room.
            </p>
          </div>
          <div className="text-[11px] text-gray-400">
            Scheduled conclusion: {formatKolkataDateTime(booking.endTime)}
          </div>
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
            Stay Checked-In
          </button>
          <button
            type="button"
            onClick={handleEndEarly}
            disabled={isSubmitting}
            className="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5"
          >
            {isSubmitting ? 'Concluding...' : 'Conclude Early & Release'}
          </button>
        </div>
      </div>
    </div>
  );
}
