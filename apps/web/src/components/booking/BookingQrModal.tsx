'use client';

import React from 'react';
import { X, QrCode, MapPin, Calendar, Clock, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { BookingListItemDTO } from '@lpu/shared';
import { formatKolkataDateTime } from '@/lib/timezone';

interface BookingQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
}

export function BookingQrModal({ isOpen, onClose, booking }: BookingQrModalProps) {
  if (!isOpen || !booking) return null;

  const qrPayload = JSON.stringify({
    bookingNumber: booking.bookingNumber,
    token: booking.checkInToken,
    resource: booking.resource?.name,
    validUntil: booking.releaseDeadline || booking.endTime,
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-5 text-center">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-[#F58220]">
            <QrCode className="w-5 h-5" />
            <h2 className="text-base font-bold text-[#292929]">Check-in Digital Pass</h2>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Venue Information */}
        <div className="space-y-1">
          <h3 className="text-sm font-extrabold text-[#292929]">
            {booking.resource?.name}
          </h3>
          <p className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <MapPin className="w-3.5 h-3.5 text-[#F58220]" />
            {booking.resource?.building} • {booking.resource?.floor || 'Campus'}
          </p>
          <p className="text-[11px] text-gray-400 flex items-center justify-center gap-1 pt-1">
            <Calendar className="w-3.5 h-3.5 text-gray-400" />
            {formatKolkataDateTime(booking.startTime)}
          </p>
        </div>

        {/* QR Code Container */}
        <div className="flex flex-col items-center justify-center p-5 bg-[#F5F5F5] rounded-2xl border border-gray-200 shadow-inner">
          <QRCodeSVG
            value={qrPayload}
            size={180}
            level="H"
            includeMargin={true}
            className="rounded-lg shadow-sm bg-white p-2"
          />
          <div className="mt-3 text-xs text-gray-500 font-medium">
            Scan at venue scanner or provide 6-digit PIN
          </div>
          {booking.checkInToken && (
            <div className="mt-1 tracking-widest text-lg font-black text-[#292929] bg-white px-3 py-1 rounded-lg border border-gray-200">
              {booking.checkInToken}
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-2.5 bg-orange-50/70 border border-orange-100 rounded-xl text-[11px] text-orange-800 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#F58220] shrink-0" />
          <span>Present this pass to complete venue check-in verification</span>
        </div>

        {/* Close Button */}
        <button
          onClick={onClose}
          className="w-full py-2.5 bg-[#292929] hover:bg-black text-white rounded-xl text-xs font-bold transition shadow-sm"
        >
          Dismiss Pass
        </button>
      </div>
    </div>
  );
}
