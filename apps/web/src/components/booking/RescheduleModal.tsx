'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, AlertCircle, CheckCircle2, ArrowRight } from 'lucide-react';
import { api } from '@/lib/api';
import { BookingListItemDTO, AlternativeSlot } from '@lpu/shared';
import { formatKolkataDateTime, formatSlotTime12Hour } from '@/lib/timezone';

interface RescheduleModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
  onSuccess: (updated: BookingListItemDTO, message: string) => void;
}

export function RescheduleModal({
  isOpen,
  onClose,
  booking,
  onSuccess,
}: RescheduleModalProps) {
  const [date, setDate] = useState('');
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [purpose, setPurpose] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [alternativeSlots, setAlternativeSlots] = useState<AlternativeSlot[]>([]);

  useEffect(() => {
    if (booking) {
      const start = new Date(booking.startTime);
      const end = new Date(booking.endTime);
      
      const istDate = start.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
      const istStartTime = start.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });
      const istEndTime = end.toLocaleTimeString('en-GB', {
        timeZone: 'Asia/Kolkata',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      });

      setDate(istDate);
      setStartTime(istStartTime);
      setEndTime(istEndTime);
      setPurpose(booking.purpose || '');
      setErrorMessage(null);
      setAlternativeSlots([]);
    }
  }, [booking]);

  if (!isOpen || !booking) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!date || !startTime || !endTime) {
      setErrorMessage('Please specify date, start time, and end time.');
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);
    setAlternativeSlots([]);

    try {
      // Build ISO strings with IST timezone offset (+05:30)
      const startIso = new Date(`${date}T${startTime}:00+05:30`).toISOString();
      const endIso = new Date(`${date}T${endTime}:00+05:30`).toISOString();

      const res = await api.bookings.reschedule(booking.id, {
        startTime: startIso,
        endTime: endIso,
        purpose: purpose.trim() || undefined,
      });

      onSuccess(res.booking, res.message);
      onClose();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to reschedule booking.');
      if (err.details?.alternativeSlots) {
        setAlternativeSlots(err.details.alternativeSlots);
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSelectAlternative = (slot: AlternativeSlot) => {
    setDate(slot.date);
    setStartTime(slot.startTime);
    setEndTime(slot.endTime);
    setErrorMessage(null);
    setAlternativeSlots([]);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-lg w-full p-6 shadow-2xl border border-gray-100 space-y-5">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div>
            <h2 className="text-lg font-bold text-[#292929]">Reschedule Booking</h2>
            <p className="text-xs text-gray-500 font-medium">
              Reservation #{booking.bookingNumber} • {booking.resource?.name}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Current Schedule Summary */}
        <div className="p-3 bg-gray-50 rounded-xl border border-gray-200/80 text-xs text-gray-600 space-y-1">
          <div className="font-semibold text-gray-700">Currently Scheduled:</div>
          <div className="flex items-center gap-2 text-gray-500">
            <Calendar className="w-3.5 h-3.5 text-[#F58220]" />
            <span>{formatKolkataDateTime(booking.startTime)} - {formatKolkataDateTime(booking.endTime)}</span>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">New Date</label>
            <input
              type="date"
              value={date}
              min={new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' })}
              onChange={(e) => setDate(e.target.value)}
              required
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">Start Time</label>
              <input
                type="time"
                value={startTime}
                onChange={(e) => setStartTime(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-gray-700">End Time</label>
              <input
                type="time"
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                required
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-bold text-gray-700">Updated Purpose (Optional)</label>
            <input
              type="text"
              value={purpose}
              onChange={(e) => setPurpose(e.target.value)}
              placeholder="e.g., Rescheduled study group session"
              className="w-full px-3 py-2 text-xs border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220] transition"
            />
          </div>

          {/* Error Message */}
          {errorMessage && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-600 flex items-start gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div>{errorMessage}</div>
            </div>
          )}

          {/* Alternative Slots Suggestions */}
          {alternativeSlots.length > 0 && (
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl space-y-2">
              <div className="text-xs font-bold text-amber-800 flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5" />
                Suggested Available Slots for {booking.resource?.name}:
              </div>
              <div className="grid grid-cols-1 gap-1.5">
                {alternativeSlots.map((slot, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSelectAlternative(slot)}
                    className="flex items-center justify-between px-3 py-1.5 bg-white border border-amber-200/80 rounded-lg text-xs text-gray-700 hover:bg-amber-100/50 hover:border-amber-300 transition text-left"
                  >
                    <span>
                      {slot.date} • {formatSlotTime12Hour(slot.startTime)} - {formatSlotTime12Hour(slot.endTime)}
                    </span>
                    <span className="text-[#F58220] font-bold text-[11px] flex items-center gap-1">
                      Choose <ArrowRight className="w-3 h-3" />
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Policy Notice */}
          <div className="p-2.5 bg-blue-50/70 border border-blue-100 rounded-xl text-[11px] text-blue-700 flex items-start gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 mt-0.5 text-blue-500" />
            <span>
              If this resource requires approver endorsement, your booking will move to Pending status after rescheduling.
            </span>
          </div>

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
              className="px-4 py-2 bg-[#F58220] hover:bg-[#E06D0C] disabled:opacity-50 text-white rounded-xl text-xs font-bold shadow-sm transition flex items-center gap-1.5"
            >
              {isSubmitting ? 'Rescheduling...' : 'Confirm Reschedule'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
