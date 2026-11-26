'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import {
  X,
  MapPin,
  Users,
  Clock,
  Sparkles,
  Calendar,
  AlertTriangle,
  ChevronRight,
  ShieldAlert,
  CheckCircle2,
  Building,
} from 'lucide-react';
import { ResourceDTO, AvailabilitySlot } from '@lpu/shared';
import { api } from '@/lib/api';
import {
  getCurrentKolkataDateString,
  getCurrentKolkataTimeString,
  addDaysKolkata,
  formatSlotTimeRange,
  formatKolkataDate,
} from '@/lib/timezone';

interface ResourceDetailModalProps {
  resource: ResourceDTO | null;
  isOpen: boolean;
  onClose: () => void;
  onReserve: (resource: ResourceDTO, date?: string, startTime?: string, endTime?: string) => void;
  onViewCalendar?: (resourceId: string) => void;
}

export function ResourceDetailModal({
  resource,
  isOpen,
  onClose,
  onReserve,
  onViewCalendar,
}: ResourceDetailModalProps) {
  const modalRef = useRef<HTMLDivElement>(null);
  const previouslyFocusedElement = useRef<HTMLElement | null>(null);

  const [nextSlotLoading, setNextSlotLoading] = useState(false);
  const [nextAvailableSlot, setNextAvailableSlot] = useState<{
    date: string;
    slot: AvailabilitySlot;
  } | null>(null);

  // Focus trap & Escape key listener
  useEffect(() => {
    if (!isOpen) return;

    previouslyFocusedElement.current = document.activeElement as HTMLElement;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    // Focus the modal container
    const focusTimer = setTimeout(() => {
      const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      );
      if (focusable && focusable.length > 0) {
        focusable[0].focus();
      }
    }, 50);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === 'Tab') {
        const focusable = modalRef.current?.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
        );
        if (!focusable || focusable.length === 0) return;

        const firstElement = focusable[0];
        const lastElement = focusable[focusable.length - 1];

        if (e.shiftKey) {
          if (document.activeElement === firstElement) {
            e.preventDefault();
            lastElement.focus();
          }
        } else {
          if (document.activeElement === lastElement) {
            e.preventDefault();
            firstElement.focus();
          }
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      clearTimeout(focusTimer);
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previouslyFocusedElement.current) {
        previouslyFocusedElement.current.focus();
      }
    };
  }, [isOpen, onClose]);

  // Fetch real next free slot using availability API
  useEffect(() => {
    if (!isOpen || !resource) {
      setNextAvailableSlot(null);
      return;
    }

    let isMounted = true;
    setNextSlotLoading(true);

    const findNextSlot = async () => {
      try {
        const todayStr = getCurrentKolkataDateString();
        const currentTimeStr = getCurrentKolkataTimeString();

        // 1. Check today's availability starting from current time
        const todayAvail = await api.resources.getAvailability(resource.id, todayStr);
        if (!isMounted) return;

        const upcomingToday = todayAvail.slots.find(
          (s) => s.status === 'available' && s.startTime >= currentTimeStr
        );

        if (upcomingToday) {
          setNextAvailableSlot({ date: todayStr, slot: upcomingToday });
          setNextSlotLoading(false);
          return;
        }

        // 2. If no available slots remain today, check tomorrow
        const tomorrowStr = addDaysKolkata(todayStr, 1);
        const tomorrowAvail = await api.resources.getAvailability(resource.id, tomorrowStr);
        if (!isMounted) return;

        const firstTomorrow = tomorrowAvail.slots.find((s) => s.status === 'available');
        if (firstTomorrow) {
          setNextAvailableSlot({ date: tomorrowStr, slot: firstTomorrow });
        } else {
          setNextAvailableSlot(null);
        }
      } catch (err) {
        if (isMounted) setNextAvailableSlot(null);
      } finally {
        if (isMounted) setNextSlotLoading(false);
      }
    };

    findNextSlot();

    return () => {
      isMounted = false;
    };
  }, [isOpen, resource]);

  if (!isOpen || !resource) return null;

  const handleBackdropClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/60 backdrop-blur-sm animate-in fade-in duration-200"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="resource-detail-title"
    >
      <div
        ref={modalRef}
        className="bg-white rounded-3xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 flex flex-col focus:outline-none"
        tabIndex={-1}
      >
        {/* Header Media Banner */}
        <div className="relative h-48 sm:h-56 w-full bg-gray-900 shrink-0">
          <img
            src={resource.imageUrl || 'https://images.unsplash.com/photo-1497366216548-37526070297c?auto=format&fit=crop&w=800&q=80'}
            alt={resource.name}
            className="w-full h-full object-cover opacity-90"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/30 to-black/30" />

          {/* Close Button */}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close resource details"
            className="absolute top-4 right-4 p-2 bg-black/50 hover:bg-black/70 text-white rounded-full transition focus:outline-none focus:ring-2 focus:ring-white"
          >
            <X className="w-5 h-5" />
          </button>

          {/* Category Badge & Code */}
          <div className="absolute top-4 left-4 flex items-center gap-2">
            <span className="bg-[#F58220] text-white text-[11px] font-extrabold px-3 py-1 rounded-full uppercase tracking-wider shadow">
              {resource.category.replace('_', ' ')}
            </span>
            <span className="bg-black/60 backdrop-blur-md text-white text-xs font-mono font-semibold px-2.5 py-1 rounded-full border border-white/20">
              {resource.code}
            </span>
          </div>

          {/* Title & Location Over Image */}
          <div className="absolute bottom-4 left-4 right-4 text-white">
            <h2 id="resource-detail-title" className="text-xl sm:text-2xl font-extrabold tracking-tight">
              {resource.name}
            </h2>
            <div className="flex items-center gap-2 text-xs text-gray-200 mt-1 flex-wrap">
              <span className="flex items-center gap-1 font-medium">
                <Building className="w-3.5 h-3.5 text-[#F58220]" />
                {resource.building}
              </span>
              <span>•</span>
              <span>{resource.floor}</span>
              <span>•</span>
              <span>{resource.department}</span>
            </div>
          </div>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 space-y-5 flex-1">
          {/* Maintenance Notice if Under Maintenance */}
          {resource.isUnderMaintenance && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-2xl flex items-start gap-3 text-xs text-amber-900">
              <ShieldAlert className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
              <div>
                <span className="font-extrabold block text-amber-800">
                  Resource Under Maintenance
                </span>
                <span className="text-amber-700 mt-0.5 block">
                  {resource.maintenanceReason ||
                    'This facility is temporarily undergoing routine maintenance and is not available for new reservations.'}
                </span>
              </div>
            </div>
          )}

          {/* Key Quick Facts Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col">
              <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                <Users className="w-3.5 h-3.5 text-gray-400" />
                Capacity
              </span>
              <span className="text-sm font-extrabold text-gray-900 mt-1">
                {resource.capacity} People
              </span>
            </div>

            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col">
              <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-gray-400" />
                Operating Hours
              </span>
              <span className="text-sm font-extrabold text-gray-900 mt-1 truncate">
                {resource.operatingHours || '08:00 AM - 08:00 PM'}
              </span>
            </div>

            <div className="p-3 bg-gray-50 rounded-2xl border border-gray-100 flex flex-col col-span-2 sm:col-span-1">
              <span className="text-[11px] text-gray-400 font-semibold uppercase tracking-wider flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                Approval
              </span>
              <span className="text-sm font-extrabold text-gray-900 mt-1">
                {resource.requiresApproval ? 'Requires Review' : 'Instant Confirmation'}
              </span>
            </div>
          </div>

          {/* Amenities & Facilities */}
          <div>
            <h3 className="text-xs font-bold text-gray-700 uppercase tracking-wider mb-2 flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-[#F58220]" />
              Equipped Amenities
            </h3>
            {resource.amenities && resource.amenities.length > 0 ? (
              <div className="flex flex-wrap gap-2">
                {resource.amenities.map((amenity) => (
                  <span
                    key={amenity}
                    className="px-3 py-1 bg-gray-100 text-gray-800 text-xs font-semibold rounded-xl border border-gray-200"
                  >
                    {amenity}
                  </span>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-400 italic">Standard campus room amenities provided.</p>
            )}
          </div>

          {/* Next Free Slot derived from real API availability */}
          <div className="p-4 bg-orange-50/60 border border-orange-200/70 rounded-2xl space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-orange-900 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-[#F58220]" />
                Next Available Free Slot
              </span>
              {nextSlotLoading && (
                <span className="text-[10px] text-gray-400 animate-pulse">Checking live schedule...</span>
              )}
            </div>

            {nextSlotLoading ? (
              <div className="h-6 bg-orange-100/60 rounded-lg animate-pulse" />
            ) : nextAvailableSlot ? (
              <div className="flex items-center justify-between pt-1">
                <div>
                  <span className="text-xs font-extrabold text-[#292929]">
                    {nextAvailableSlot.date === getCurrentKolkataDateString()
                      ? 'Today'
                      : formatKolkataDate(nextAvailableSlot.date)}
                    , {formatSlotTimeRange(nextAvailableSlot.slot.startTime, nextAvailableSlot.slot.endTime)}
                  </span>
                  <span className="text-[10px] text-emerald-700 block font-semibold">
                    Live schedule open for reservation
                  </span>
                </div>
                {!resource.isUnderMaintenance && (
                  <button
                    type="button"
                    onClick={() => {
                      onReserve(
                        resource,
                        nextAvailableSlot.date,
                        nextAvailableSlot.slot.startTime,
                        nextAvailableSlot.slot.endTime
                      );
                    }}
                    className="px-3 py-1 bg-[#F58220] hover:bg-[#E06D0C] text-white text-xs font-bold rounded-xl shadow-sm transition"
                  >
                    Reserve This Slot
                  </button>
                )}
              </div>
            ) : (
              <p className="text-xs text-gray-600">
                {resource.isUnderMaintenance
                  ? 'Currently unavailable due to maintenance.'
                  : 'No open booking slots found in the next 48 hours. Please inspect the full calendar for upcoming openings.'}
              </p>
            )}
          </div>

          {/* Action Buttons */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
            <Link
              href={`/calendar?resourceId=${encodeURIComponent(resource.id)}`}
              onClick={() => {
                if (onViewCalendar) onViewCalendar(resource.id);
                onClose();
              }}
              className="py-2.5 px-4 bg-white hover:bg-gray-50 border border-gray-300 text-gray-800 text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2"
            >
              <Calendar className="w-4 h-4 text-gray-600" />
              <span>View Full Calendar</span>
            </Link>

            <button
              type="button"
              disabled={resource.isUnderMaintenance}
              onClick={() => {
                onReserve(resource);
              }}
              className={`py-2.5 px-4 text-xs font-bold rounded-xl shadow-sm transition flex items-center justify-center gap-2 ${
                resource.isUnderMaintenance
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#F58220] hover:bg-[#E06D0C] text-white'
              }`}
            >
              <span>{resource.isUnderMaintenance ? 'Maintenance Blocked' : 'Book Resource Now'}</span>
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
