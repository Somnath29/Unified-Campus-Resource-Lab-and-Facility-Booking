'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  QrCode,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Camera,
  CameraOff,
  KeyRound,
  RefreshCw,
  MapPin,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { api } from '@/lib/api';
import { BookingDTO, CheckInMethod, CheckInTokenResponse } from '@lpu/shared';
import { formatKolkataTime } from '@/lib/timezone';

interface CheckInModalProps {
  isOpen: boolean;
  onClose: () => void;
  booking: BookingDTO | null;
  onCheckInUpdated?: () => void;
  userRole?: string;
}

type CheckInTab = 'QR' | 'PIN';
type ScannerTarget = 'VENUE' | 'BOOKING' | null;

export function CheckInModal({
  isOpen,
  onClose,
  booking,
  onCheckInUpdated,
  userRole,
}: CheckInModalProps) {
  const [activeTab, setActiveTab] = useState<CheckInTab>('QR');

  // Signed QR Token state
  const [tokenData, setTokenData] = useState<CheckInTokenResponse | null>(null);
  const [scannedBookingToken, setScannedBookingToken] = useState<string>('');
  const [tokenSecondsLeft, setTokenSecondsLeft] = useState<number>(0);
  const [isGeneratingToken, setIsGeneratingToken] = useState(false);

  // Venue QR state
  const [venueQrValue, setVenueQrValue] = useState<string>('');

  // Manual PIN fallback state
  const [pinInput, setPinInput] = useState<string>('');
  const [remainingAttempts, setRemainingAttempts] = useState<number | null>(null);
  const [pinLockedUntil, setPinLockedUntil] = useState<string | null>(null);

  // Override state (for late check-in / venue exception by authorized staff)
  const [showOverridePanel, setShowOverridePanel] = useState(false);
  const [overrideReason, setOverrideReason] = useState('');
  const [bypassLateWindow, setBypassLateWindow] = useState(true);
  const [bypassVenue, setBypassVenue] = useState(false);

  // Camera scanner state (html5-qrcode)
  const [scannerTarget, setScannerTarget] = useState<ScannerTarget>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const scannerRef = useRef<any>(null);
  const scanProcessedRef = useRef<boolean>(false);

  // Verification status state
  const [isVerifying, setIsVerifying] = useState(false);
  const [errorState, setErrorState] = useState<{
    message: string;
    code?: string;
  } | null>(null);
  const [successState, setSuccessState] = useState<{
    message: string;
    checkedInAt: string;
    checkInMethod: CheckInMethod;
  } | null>(null);

  const stopCamera = useCallback(async () => {
    if (scannerRef.current) {
      try {
        if (scannerRef.current.isScanning) {
          await scannerRef.current.stop();
        }
        await scannerRef.current.clear();
      } catch {
        // Ignore cleanup errors if already stopped
      } finally {
        scannerRef.current = null;
      }
    }
    setScannerTarget(null);
  }, []);

  // Reset modal state on close/change and ensure camera is always cleaned up
  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      setTokenData(null);
      setScannedBookingToken('');
      setVenueQrValue('');
      setPinInput('');
      setRemainingAttempts(null);
      setPinLockedUntil(null);
      setShowOverridePanel(false);
      setOverrideReason('');
      setCameraError(null);
      setErrorState(null);
      setSuccessState(null);
    }
  }, [isOpen, stopCamera]);

  useEffect(() => {
    return () => {
      stopCamera();
    };
  }, [stopCamera]);

  // Escape key accessibility
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        stopCamera();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose, stopCamera]);

  // Live 5-minute countdown for signed booking QR token
  useEffect(() => {
    if (!tokenData?.expiresAt) {
      setTokenSecondsLeft(0);
      return;
    }
    const updateTimer = () => {
      const diff = Math.max(
        0,
        Math.floor((new Date(tokenData.expiresAt).getTime() - Date.now()) / 1000)
      );
      setTokenSecondsLeft(diff);
    };
    updateTimer();
    const interval = setInterval(updateTimer, 1000);
    return () => clearInterval(interval);
  }, [tokenData]);

  // Start html5-qrcode scanner when user explicitly requests camera scanning
  useEffect(() => {
    if (!scannerTarget || !isOpen) return;

    let cancelled = false;
    scanProcessedRef.current = false;
    setCameraError(null);

    const startScanner = async () => {
      try {
        const { Html5Qrcode } = await import('html5-qrcode');
        if (cancelled) return;

        const readerId = 'lpu-checkin-qr-reader';
        const el = document.getElementById(readerId);
        if (!el) return;

        const html5QrCode = new Html5Qrcode(readerId);
        scannerRef.current = html5QrCode;

        await html5QrCode.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 220, height: 220 } },
          async (decodedText: string) => {
            if (scanProcessedRef.current || cancelled) return;
            scanProcessedRef.current = true;

            if (scannerTarget === 'VENUE') {
              setVenueQrValue(decodedText);
              setErrorState(null);
            } else if (scannerTarget === 'BOOKING') {
              setScannedBookingToken(decodedText);
              setErrorState(null);
            }
            await stopCamera();
          },
          () => {
            // Per-frame scan miss is expected; do not spam UI
          }
        );
      } catch (err: any) {
        if (cancelled) return;
        const msg = String(err?.message || err || '');
        if (msg.toLowerCase().includes('permission') || msg.toLowerCase().includes('notallowed')) {
          setCameraError(
            'Camera permission denied. Please enable camera access in your browser settings or paste the QR payload.'
          );
        } else if (msg.toLowerCase().includes('notfound') || msg.toLowerCase().includes('device')) {
          setCameraError('No camera detected on this device.');
        } else {
          setCameraError(msg || 'Unable to initialize camera scanner.');
        }
        setScannerTarget(null);
      }
    };

    startScanner();

    return () => {
      cancelled = true;
    };
  }, [scannerTarget, isOpen, stopCamera]);

  if (!isOpen || !booking) return null;

  const isAlreadyCheckedIn = booking.status === 'CHECKED_IN' || Boolean(successState);
  const isStaff = userRole === 'ADMINISTRATOR' || userRole === 'DEPARTMENT_APPROVER';
  const isPinLocked = Boolean(pinLockedUntil && new Date(pinLockedUntil) > new Date());
  const activeBookingToken = scannedBookingToken || tokenData?.token || '';

  const handleGenerateToken = async () => {
    setIsGeneratingToken(true);
    setErrorState(null);
    try {
      const res = await api.checkin.generateToken(booking.id);
      setTokenData(res);
      setScannedBookingToken('');
    } catch (err: any) {
      setErrorState({
        message: err.message || 'Unable to generate check-in QR token.',
        code: err.code,
      });
      if (err.code === 'CHECK_IN_TOO_LATE' && isStaff) {
        setShowOverridePanel(true);
      }
    } finally {
      setIsGeneratingToken(false);
    }
  };

  const handleSubmitCheckIn = async (overrideMode = false) => {
    if (isVerifying) return;
    setIsVerifying(true);
    setErrorState(null);

    try {
      const payload: any = {
        venueQr: venueQrValue.trim() || undefined,
      };

      if (overrideMode) {
        payload.override = {
          reason: overrideReason.trim(),
          bypassLateWindow,
          bypassVenueVerification: bypassVenue,
        };
      } else if (activeTab === 'QR') {
        payload.bookingToken = activeBookingToken;
      } else {
        payload.pin = pinInput.trim();
      }

      const res = await api.checkin.checkIn(booking.id, payload);
      await stopCamera();
      setSuccessState({
        message: res.message,
        checkedInAt: res.checkedInAt,
        checkInMethod: res.checkInMethod,
      });
      if (onCheckInUpdated) onCheckInUpdated();
    } catch (err: any) {
      setErrorState({
        message: err.message || 'Check-in verification failed.',
        code: err.code,
      });
      if (typeof err.remainingAttempts === 'number') {
        setRemainingAttempts(err.remainingAttempts);
      }
      if (err.lockedUntil) {
        setPinLockedUntil(err.lockedUntil);
      }
      if (err.code === 'CHECK_IN_TOO_LATE' && (err.canOverride || isStaff)) {
        setShowOverridePanel(true);
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const formatTimer = (sec: number) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/55 backdrop-blur-sm animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="checkin-modal-title"
    >
      <div className="bg-white rounded-2xl max-w-md w-full max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-100 p-5 sm:p-6 text-left">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100 mb-4">
          <div>
            <h2 id="checkin-modal-title" className="text-lg font-bold text-[#292929]">
              Verified Venue Check-In
            </h2>
            <p className="text-xs text-gray-500 font-mono">{booking.bookingNumber}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              stopCamera();
              onClose();
            }}
            aria-label="Close check-in modal"
            className="p-2 text-gray-400 hover:text-gray-700 rounded-full hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status / Error Alerts */}
        {errorState && (
          <div
            role="alert"
            className="mb-4 p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-800 flex items-start gap-2.5"
          >
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
            <div className="space-y-1">
              <div className="font-bold">
                {errorState.code ? `[${errorState.code}] ` : ''}Check-In Rejected
              </div>
              <p>{errorState.message}</p>
              {errorState.code === 'PIN_LOCKED' && pinLockedUntil && (
                <p className="font-semibold text-red-700">
                  Locked until {formatKolkataTime(pinLockedUntil)} IST
                </p>
              )}
              {errorState.code === 'INVALID_PIN' && remainingAttempts !== null && (
                <p className="font-semibold text-red-700">
                  {remainingAttempts} PIN attempt(s) remaining before 10-minute lockout.
                </p>
              )}
            </div>
          </div>
        )}

        {cameraError && (
          <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-xl text-xs text-amber-800 flex items-start gap-2">
            <CameraOff className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
            <span>{cameraError}</span>
          </div>
        )}

        {successState && (
          <div className="mb-4 p-4 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-900 space-y-2">
            <div className="flex items-center gap-2 font-bold text-sm text-emerald-800">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
              <span>Check-In Confirmed</span>
            </div>
            <p>{successState.message}</p>
            <div className="pt-1 border-t border-emerald-200/70 flex flex-wrap gap-3 text-[11px] font-medium">
              <span>Time: {formatKolkataTime(successState.checkedInAt)} IST</span>
              <span>Method: {successState.checkInMethod}</span>
            </div>
          </div>
        )}

        {/* Booking Summary */}
        <div className="bg-[#F5F5F5] p-3.5 rounded-xl border border-gray-200/70 text-xs text-gray-600 space-y-1.5 mb-4">
          <div className="flex justify-between gap-2">
            <span className="text-gray-400">Resource:</span>
            <span className="font-semibold text-[#292929] text-right">{booking.resource?.name}</span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-400">Timing (IST):</span>
            <span className="font-semibold text-[#292929]">
              {formatKolkataTime(booking.startTime)} – {formatKolkataTime(booking.endTime)}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-gray-400">Release Deadline:</span>
            <span className="font-semibold text-[#F58220]">
              {booking.releaseDeadline
                ? `${formatKolkataTime(booking.releaseDeadline)} IST`
                : '15 mins after start'}
            </span>
          </div>
        </div>

        {!isAlreadyCheckedIn && (
          <>
            {/* Credential Method Tabs */}
            <div className="grid grid-cols-2 gap-2 p-1 bg-gray-100 rounded-xl mb-4">
              <button
                type="button"
                onClick={() => {
                  setActiveTab('QR');
                  setErrorState(null);
                }}
                className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'QR'
                    ? 'bg-white text-[#292929] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <QrCode className="w-4 h-4 text-[#F58220]" />
                <span>Signed QR Pass</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setActiveTab('PIN');
                  setErrorState(null);
                }}
                className={`py-2.5 px-3 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition ${
                  activeTab === 'PIN'
                    ? 'bg-white text-[#292929] shadow-sm'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                <KeyRound className="w-4 h-4 text-[#1976B9]" />
                <span>PIN Fallback</span>
              </button>
            </div>

            {/* Active Camera Scanner Viewport (html5-qrcode) */}
            {scannerTarget && (
              <div className="mb-4 p-3 bg-gray-900 rounded-2xl text-white space-y-2.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-bold flex items-center gap-1.5">
                    <Camera className="w-4 h-4 text-[#F58220]" />
                    {scannerTarget === 'VENUE'
                      ? 'Scan Room Venue QR Code'
                      : 'Scan Booking QR Pass'}
                  </span>
                  <button
                    type="button"
                    onClick={() => stopCamera()}
                    className="px-2.5 py-1 bg-white/15 hover:bg-white/25 rounded-lg text-[11px] font-semibold"
                  >
                    Stop Camera
                  </button>
                </div>
                <div id="lpu-checkin-qr-reader" className="w-full overflow-hidden rounded-xl" />
              </div>
            )}

            {/* Step 1: Credential Input */}
            {activeTab === 'QR' ? (
              <div className="mb-4 p-3.5 border border-gray-200 rounded-xl space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-[#292929]">
                    1. Booking Credential (5-Min Signed Token)
                  </span>
                  {tokenData && (
                    <span
                      className={`text-[11px] font-mono font-bold px-2 py-0.5 rounded-full flex items-center gap-1 ${
                        tokenSecondsLeft > 0
                          ? 'bg-orange-50 text-[#F58220]'
                          : 'bg-red-50 text-red-600'
                      }`}
                    >
                      <Clock className="w-3 h-3" />
                      {tokenSecondsLeft > 0 ? formatTimer(tokenSecondsLeft) : 'Expired'}
                    </span>
                  )}
                </div>

                {tokenData ? (
                  <div className="flex flex-col items-center gap-2 py-2">
                    <div className="p-2.5 bg-white border-2 border-dashed border-[#F58220]/40 rounded-xl">
                      <QRCodeSVG value={tokenData.qrPayload} size={144} level="M" includeMargin />
                    </div>
                    <span className="text-[11px] text-emerald-700 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5" /> Signed booking token active
                    </span>
                  </div>
                ) : scannedBookingToken ? (
                  <div className="p-2.5 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-800 flex items-center justify-between">
                    <span className="font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" /> Booking QR scanned
                    </span>
                    <button
                      type="button"
                      onClick={() => setScannedBookingToken('')}
                      className="text-[11px] underline text-emerald-700"
                    >
                      Clear
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-gray-500">
                    Generate an on-demand 5-minute signed pass or scan your booking QR.
                  </p>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={handleGenerateToken}
                    disabled={isGeneratingToken}
                    className="py-2.5 px-3 bg-[#FFF4EA] hover:bg-[#FFE6D1] text-[#D8690A] font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isGeneratingToken ? 'animate-spin' : ''}`} />
                    <span>{tokenData ? 'Regenerate Pass' : 'Generate QR Pass'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setScannerTarget('BOOKING')}
                    disabled={scannerTarget !== null}
                    className="py-2.5 px-3 bg-gray-100 hover:bg-gray-200 text-[#292929] font-bold rounded-xl text-xs transition flex items-center justify-center gap-1.5 disabled:opacity-50"
                  >
                    <Camera className="w-3.5 h-3.5" />
                    <span>Scan Booking QR</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="mb-4 p-3.5 border border-gray-200 rounded-xl space-y-2.5">
                <label htmlFor="checkin-pin-input" className="block text-xs font-bold text-[#292929]">
                  1. Manual 6-Digit Fallback PIN
                </label>
                <input
                  id="checkin-pin-input"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  disabled={isPinLocked || isVerifying}
                  value={pinInput}
                  onChange={(e) => setPinInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="Enter 6-digit PIN"
                  className="w-full px-4 py-3 text-center text-xl font-black font-mono tracking-[0.35em] border border-gray-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-[#F58220] disabled:bg-gray-100 disabled:text-gray-400"
                />
                <p className="text-[11px] text-gray-500">
                  PIN fallback still requires scanning the room&apos;s venue QR below. Max 5 attempts before 10-min lockout.
                </p>
              </div>
            )}

            {/* Step 2: Mandatory Room Venue QR Verification */}
            <div className="mb-4 p-3.5 border border-gray-200 rounded-xl space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[#292929] flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-[#F58220]" />
                  2. Room Venue QR Verification (Required)
                </span>
                {venueQrValue && (
                  <span className="text-[11px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full">
                    Scanned
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => setScannerTarget('VENUE')}
                disabled={scannerTarget !== null}
                className="w-full py-2.5 px-3 bg-[#292929] hover:bg-black text-white font-bold rounded-xl text-xs transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Camera className="w-4 h-4 text-[#F58220]" />
                <span>{venueQrValue ? 'Rescan Room Venue QR' : 'Scan Room Venue QR'}</span>
              </button>

              <input
                type="text"
                aria-label="Room Venue QR Code Value"
                value={venueQrValue}
                onChange={(e) => setVenueQrValue(e.target.value)}
                placeholder="Or paste scanned venue QR payload..."
                className="w-full px-3 py-2 text-xs border border-gray-200 rounded-lg font-mono focus:outline-none focus:ring-2 focus:ring-[#F58220]"
              />
            </div>

            {/* Primary Submit Button */}
            <button
              type="button"
              onClick={() => handleSubmitCheckIn(false)}
              disabled={
                isVerifying ||
                !venueQrValue.trim() ||
                (activeTab === 'QR' ? !activeBookingToken : pinInput.length !== 6 || isPinLocked)
              }
              className="w-full py-3 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition flex items-center justify-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ShieldCheck className="w-4 h-4" />
              <span>{isVerifying ? 'Verifying Credentials...' : 'Verify & Check In'}</span>
            </button>

            {/* Authorized Staff Override Section */}
            {isStaff && (
              <div className="mt-4 pt-3 border-t border-gray-100">
                <button
                  type="button"
                  onClick={() => setShowOverridePanel((v) => !v)}
                  className="text-xs font-bold text-[#1976B9] hover:underline flex items-center gap-1.5"
                >
                  <ShieldAlert className="w-3.5 h-3.5" />
                  <span>{showOverridePanel ? 'Hide Staff Override' : 'Approver / Admin Override'}</span>
                </button>

                {showOverridePanel && (
                  <div className="mt-3 p-3.5 bg-blue-50/70 border border-blue-200 rounded-xl space-y-2.5">
                    <p className="text-[11px] text-blue-900 font-medium">
                      Staff override is recorded in the audit log with your identity and reason.
                    </p>
                    <textarea
                      rows={2}
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="Required override reason (e.g., Late arrival approved due to lab transit)"
                      className="w-full px-3 py-2 text-xs border border-blue-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-[#1976B9]"
                    />
                    <div className="flex flex-col gap-1.5 text-xs text-blue-950">
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bypassLateWindow}
                          onChange={(e) => setBypassLateWindow(e.target.checked)}
                        />
                        <span>Override late release deadline</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={bypassVenue}
                          onChange={(e) => setBypassVenue(e.target.checked)}
                        />
                        <span>Override venue QR scan (equipment failure)</span>
                      </label>
                    </div>
                    <button
                      type="button"
                      onClick={() => handleSubmitCheckIn(true)}
                      disabled={isVerifying || overrideReason.trim().length < 3 || (!bypassVenue && !venueQrValue.trim())}
                      className="w-full py-2.5 bg-[#1976B9] hover:bg-[#145E94] text-white font-bold rounded-xl text-xs transition disabled:opacity-50"
                    >
                      Complete Staff Override Check-In
                    </button>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
