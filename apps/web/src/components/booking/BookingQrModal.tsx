'use client';

import React, { useEffect, useState } from 'react';
import { X, QrCode, MapPin, Calendar, ShieldCheck, Clock, RefreshCw, AlertTriangle } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { BookingListItemDTO, CheckInTokenResponse } from '@lpu/shared';
import { formatKolkataDateTime } from '@/lib/timezone';
import { api } from '@/lib/api';

interface BookingQrModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingListItemDTO | null;
}

export function BookingQrModal({ isOpen, onClose, booking }: BookingQrModalProps) {
  const [tokenData, setTokenData] = useState<CheckInTokenResponse | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);

  const fetchToken = async (bookingId: string) => {
    setIsLoading(true);
    setTokenError(null);
    try {
      const res = await api.checkin.generateToken(bookingId);
      setTokenData(res);
    } catch (err: any) {
      setTokenData(null);
      setTokenError(err.message || 'Signed QR pass is only available within the check-in window.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen && booking && booking.status === 'CONFIRMED') {
      fetchToken(booking.id);
    } else if (!isOpen) {
      setTokenData(null);
      setTokenError(null);
    }
  }, [isOpen, booking]);

  useEffect(() => {
    if (!tokenData?.expiresAt) {
      setSecondsLeft(0);
      return;
    }
    const tick = () => {
      setSecondsLeft(
        Math.max(0, Math.floor((new Date(tokenData.expiresAt).getTime() - Date.now()) / 1000))
      );
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [tokenData]);

  if (!isOpen || !booking) return null;

  const formatTimer = (sec: number) => `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in duration-150">
      <div className="bg-white rounded-2xl max-w-sm w-full p-6 shadow-2xl border border-gray-100 space-y-5 text-center">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <div className="flex items-center gap-2 text-[#F58220]">
            <QrCode className="w-5 h-5" />
            <h2 className="text-base font-bold text-[#292929]">Signed Check-In Pass</h2>
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

        {/* Signed 5-Minute QR Container */}
        <div className="flex flex-col items-center justify-center p-5 bg-[#F5F5F5] rounded-2xl border border-gray-200 shadow-inner space-y-3">
          {isLoading ? (
            <div className="py-12 text-xs text-gray-500 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 animate-spin text-[#F58220]" />
              <span>Issuing 5-minute signed pass...</span>
            </div>
          ) : tokenData ? (
            <>
              <QRCodeSVG
                value={tokenData.qrPayload}
                size={180}
                level="M"
                includeMargin={true}
                className="rounded-lg shadow-sm bg-white p-2"
              />
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-mono font-bold px-2.5 py-0.5 rounded-full bg-orange-50 text-[#F58220] flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {secondsLeft > 0 ? `Expires in ${formatTimer(secondsLeft)}` : 'Expired'}
                </span>
                <button
                  type="button"
                  onClick={() => fetchToken(booking.id)}
                  className="text-[11px] font-bold text-[#1976B9] hover:underline flex items-center gap-1"
                >
                  <RefreshCw className="w-3 h-3" /> Refresh
                </button>
              </div>
            </>
          ) : (
            <div className="py-6 px-3 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-left">
              <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
              <span>{tokenError || 'QR pass available 30 minutes before session start.'}</span>
            </div>
          )}

          {booking.checkInToken && (
            <div className="pt-1 w-full border-t border-gray-200/80">
              <div className="text-[11px] text-gray-500 font-medium">
                Manual Fallback PIN (requires venue QR)
              </div>
              <div className="mt-1 tracking-widest text-lg font-black text-[#292929] bg-white px-3 py-1 rounded-lg border border-gray-200 inline-block">
                {booking.checkInToken}
              </div>
            </div>
          )}
        </div>

        {/* Info */}
        <div className="p-2.5 bg-orange-50/70 border border-orange-100 rounded-xl text-[11px] text-orange-800 flex items-center justify-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[#F58220] shrink-0" />
          <span>Single-use pass bound to your booking &amp; room venue QR</span>
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
