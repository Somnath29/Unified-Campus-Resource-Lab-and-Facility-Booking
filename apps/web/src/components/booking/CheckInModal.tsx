'use client';

import React, { useState } from 'react';
import { X, QrCode, CheckCircle2, Clock, AlertTriangle, ShieldCheck } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { BookingDTO } from '@lpu/shared';

interface CheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingDTO | null;
  onCheckInUpdated?: () => void;
}

export function CheckInModal({
  isOpen,
  onClose,
  booking,
  onCheckInUpdated,
}: CheckInModalProps) {
  const [manualCode, setManualCode] = useState<string>('');
  const [isVerifying, setIsVerifying] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  if (!isOpen || !booking) return null;

  const isAlreadyCheckedIn = booking.status === 'CHECKED_IN';
  const qrData = JSON.stringify({
    bookingNumber: booking.bookingNumber,
    token: booking.checkInToken,
    resource: booking.resource?.name,
  });

  const handleVerify = async (tokenToUse?: string) => {
    setIsVerifying(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const code = tokenToUse || manualCode || booking.checkInToken;
      const res = await api.checkin.verify({
        token: code || undefined,
        bookingId: booking.id,
      });

      setSuccessMsg(res.message);
      if (onCheckInUpdated) onCheckInUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Check-in verification failed.');
    } finally {
      setIsVerifying(false);
    }
  };

  const handleSimulateAutoRelease = async () => {
    setIsVerifying(true);
    setErrorMsg(null);
    try {
      const res = await api.checkin.autoReleaseScan();
      if (res.releasedCount > 0) {
        setSuccessMsg(`Auto-release scanned: ${res.releasedCount} overdue reservations released.`);
      } else {
        setSuccessMsg('Auto-release scanner checked all reservations. No expired reservations found at this second.');
      }
      if (onCheckInUpdated) onCheckInUpdated();
    } catch (err: any) {
      setErrorMsg(err.message || 'Failed to trigger scan.');
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-md w-full shadow-2xl border border-gray-100 p-6 text-center">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
          <div className="text-left">
            <h2 className="text-lg font-bold text-gray-900">QR Check-In & Verification</h2>
            <p className="text-xs text-gray-500 font-mono">{booking.bookingNumber}</p>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status Alerts */}
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 text-left flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <span>{errorMsg}</span>
          </div>
        )}

        {successMsg && (
          <div className="mb-4 p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 text-left flex items-start gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5 text-emerald-600" />
            <span>{successMsg}</span>
          </div>
        )}

        {/* QR Code Container */}
        <div className="p-4 bg-white border-2 border-dashed border-[#F58220]/40 rounded-2xl inline-block shadow-inner mb-3">
          <QRCodeSVG value={qrData} size={180} level="H" includeMargin={true} />
        </div>

        {/* Numeric PIN */}
        <div className="mb-4">
          <span className="text-[11px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
            Verification PIN
          </span>
          <div className="inline-block px-4 py-1.5 bg-[#FFF4EA] border border-[#FED7AA] rounded-xl text-2xl font-black font-mono tracking-[0.25em] text-[#292929]">
            {booking.checkInToken || '------'}
          </div>
        </div>

        {/* Details Summary */}
        <div className="bg-gray-50 p-3.5 rounded-xl border border-gray-100 text-xs text-gray-600 text-left space-y-1.5 mb-4">
          <div className="flex justify-between">
            <span className="text-gray-400">Resource:</span>
            <span className="font-semibold text-gray-900">{booking.resource?.name}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Timing:</span>
            <span className="font-semibold text-gray-900">
              {new Date(booking.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} -{' '}
              {new Date(booking.endTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Check-in Deadline:</span>
            <span className="font-semibold text-[#F58220]">
              {booking.releaseDeadline
                ? new Date(booking.releaseDeadline).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
                : '15 mins after start'}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="text-gray-400">Status:</span>
            <span
              className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                isAlreadyCheckedIn
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              }`}
            >
              {booking.status}
            </span>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="space-y-2">
          {!isAlreadyCheckedIn ? (
            <button
              onClick={() => handleVerify(booking.checkInToken || undefined)}
              disabled={isVerifying}
              className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition flex items-center justify-center gap-2 text-sm disabled:opacity-50"
            >
              <CheckCircle2 className="w-4 h-4" />
              <span>Simulate Venue Check-In (Verify PIN)</span>
            </button>
          ) : (
            <div className="w-full py-2.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-xl font-bold text-xs flex items-center justify-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-emerald-600" />
              <span>Session is Active & Verified</span>
            </div>
          )}

          {/* Tester trigger for auto-release */}
          <button
            onClick={handleSimulateAutoRelease}
            disabled={isVerifying}
            className="w-full py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl text-xs transition"
          >
            Trigger Background Auto-Release Scanner
          </button>
        </div>
      </div>
    </div>
  );
}

