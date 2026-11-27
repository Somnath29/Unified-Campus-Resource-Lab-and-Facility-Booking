'use client';

import React, { useState } from 'react';
import { X, Clock, AlertCircle, PlusCircle, CheckCircle2 } from 'lucide-react';
import { api } from '@/lib/api';
import { BookingListItemDTO } from '@lpu/shared';
import { formatKolkataTime } from '@/lib/timezone';

interface ExtendBookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
  onSuccess: (updated: BookingListItemDTO, message: string) => void;
}

export function ExtendBookingModal({
  isOpen,
  onClose,
  booking,
  onSuccess,
}: ExtendBookingModalProps) {
  const [durationMinutes, setDurationMinutes] = useState<number>(30);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  const currentEnd = new Date(booking.endTime);
  const projectedEnd = new Date(currentEnd.getTime() + durationMinutes * 60000);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const res = await api.bookings.extend(booking.id, durationMinutes);
      onSuccess(res.booking, res.message);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to extend booking.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const extensionOptions = [15, 30, 45, 60, 90, 120];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-2xl border border-gray-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-[#1976B9]">
            <PlusCircle className="w-5 h-5" />
            <h2 className="text-lg font-bold text-[#292929]">Extend Session</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current & Projected Schedule */}
        <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 text-xs space-y-2">
          <div className="flex items-center justify-between text-gray-600">
            <span>Current scheduled conclusion:</span>
            <span className="font-bold text-gray-800">{formatKolkataTime(booking.endTime)}</span>
          </div>
          <div className="flex items-center justify-between text-blue-800 font-semibold border-t border-blue-200/60 pt-2">
            <span>New proposed end time:</span>
            <span className="font-bold">{formatKolkataTime(projectedEnd.toISOString())}</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-700 block">
              Select Additional Duration
            </label>
            <div className="grid grid-cols-3 gap-2">
              {extensionOptions.map((mins) => (
                <button
                  key={mins}
                  type="button"
                  onClick={() => setDurationMinutes(mins)}
                  className={`py-2 px-3 text-xs rounded-xl font-bold border transition ${
                    durationMinutes === mins
                      ? 'bg-[#1976B9] text-white border-[#1976B9] shadow-sm'
                      : 'bg-gray-50 text-gray-700 border-gray-200 hover:bg-gray-100'
                  }`}
                >
                  +{mins} min
                </button>
              ))}
            </div>
          </div>

          {/* Availability Notice */}
          <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl text-[11px] text-gray-500 flex items-start gap-2">
            <Clock className="w-3.5 h-3.5 shrink-0 mt-0.5 text-gray-400" />
            <span>
              Extensions are subject to immediate venue availability and must not conflict with upcoming reservations or scheduled academic lectures.
            </span>
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
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="px-4 py-2 bg-[#1976B9] hover:bg-[#1565C0] disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5"
            >
              {isSubmitting ? 'Extending...' : `Extend by ${durationMinutes}m`}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
