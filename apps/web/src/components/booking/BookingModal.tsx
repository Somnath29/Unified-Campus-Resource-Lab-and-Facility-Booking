'use client';

import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, Users, Tag, AlertCircle, CheckCircle2, ShieldCheck } from 'lucide-react';
import { api } from '@/lib/api';
import { ResourceDTO, ActivityType, PriorityLevel } from '@lpu/shared';

interface BookingModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedResource?: ResourceDTO | null;
  onBookingSuccess?: () => void;
}

export function BookingModal({
  isOpen,
  onClose,
  preselectedResource,
  onBookingSuccess,
}: BookingModalProps) {
  const [resources, setResources] = useState<ResourceDTO[]>([]);
  const [selectedResourceId, setSelectedResourceId] = useState<string>('');
  const [date, setDate] = useState<string>(() => new Date().toISOString().split('T')[0]);
  const [startTime, setStartTime] = useState<string>('14:00');
  const [endTime, setEndTime] = useState<string>('16:00');
  const [purpose, setPurpose] = useState<string>('');
  const [activityType, setActivityType] = useState<ActivityType>('PROJECT_WORK');
  const [expectedAttendance, setExpectedAttendance] = useState<number>(20);
  const [priority, setPriority] = useState<PriorityLevel>('NORMAL');

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successBooking, setSuccessBooking] = useState<any | null>(null);

  useEffect(() => {
    if (isOpen) {
      setErrorMessage(null);
      setSuccessBooking(null);
      if (preselectedResource) {
        setSelectedResourceId(preselectedResource.id);
      } else {
        api.resources.list().then((res) => {
          setResources(res.resources || []);
          if (res.resources?.length > 0 && !selectedResourceId) {
            setSelectedResourceId(res.resources[0].id);
          }
        });
      }
    }
  }, [isOpen, preselectedResource]);

  if (!isOpen) return null;

  const currentResource =
    preselectedResource || resources.find((r) => r.id === selectedResourceId);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setIsLoading(true);

    try {
      const startDateTime = new Date(`${date}T${startTime}:00`).toISOString();
      const endDateTime = new Date(`${date}T${endTime}:00`).toISOString();

      const res = await api.bookings.create({
        resourceId: selectedResourceId,
        startTime: startDateTime,
        endTime: endDateTime,
        purpose,
        activityType,
        expectedAttendance: Number(expectedAttendance),
        priority,
      });

      setSuccessBooking(res.booking);
      if (onBookingSuccess) onBookingSuccess();
    } catch (err: any) {
      setErrorMessage(err.message || 'Failed to submit booking request.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto shadow-2xl border border-gray-100 p-6">
        {/* Header */}
        <div className="flex items-center justify-between pb-4 border-b border-gray-100">
          <div>
            <h2 className="text-xl font-bold text-gray-900">
              {successBooking ? 'Booking Confirmed' : 'Reserve Campus Resource'}
            </h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {currentResource?.name || 'Classrooms, Labs, Halls & Facilities'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100 transition"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Success View */}
        {successBooking ? (
          <div className="py-6 space-y-5 text-center">
            <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto shadow-sm">
              <CheckCircle2 className="w-10 h-10" />
            </div>

            <div>
              <h3 className="text-lg font-bold text-gray-900">
                {successBooking.status === 'CONFIRMED'
                  ? 'Your Reservation is Confirmed!'
                  : 'Booking Request Submitted for Approval!'}
              </h3>
              <p className="text-xs text-gray-600 mt-1">
                Booking Reference:{' '}
                <span className="font-mono font-bold text-gray-900">
                  {successBooking.bookingNumber}
                </span>
              </p>
            </div>

            {/* Check-in PIN box */}
            {successBooking.checkInToken && (
              <div className="p-4 bg-orange-50 border border-orange-200 rounded-xl text-center max-w-xs mx-auto">
                <span className="text-[11px] font-bold text-[#F58220] uppercase tracking-wider block mb-1">
                  6-Digit Check-In PIN
                </span>
                <span className="text-3xl font-black font-mono tracking-widest text-[#292929]">
                  {successBooking.checkInToken}
                </span>
                <span className="text-[10px] text-gray-500 block mt-1">
                  Enter this code or scan QR code at venue within 15 mins of start time
                </span>
              </div>
            )}

            <div className="bg-gray-50 p-4 rounded-xl text-left text-xs text-gray-600 space-y-1.5 border border-gray-100">
              <div className="flex justify-between">
                <span className="text-gray-400">Resource:</span>
                <span className="font-semibold text-gray-800">{currentResource?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Date & Time:</span>
                <span className="font-semibold text-gray-800">
                  {new Date(successBooking.startTime).toLocaleDateString()} ({startTime} - {endTime})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Purpose:</span>
                <span className="font-semibold text-gray-800">{successBooking.purpose}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-400">Status:</span>
                <span
                  className={`font-bold px-2 py-0.5 rounded text-[10px] ${
                    successBooking.status === 'CONFIRMED'
                      ? 'bg-green-100 text-green-700'
                      : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {successBooking.status}
                </span>
              </div>
            </div>

            <button
              onClick={onClose}
              className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition"
            >
              Done & Return to Dashboard
            </button>
          </div>
        ) : (
          /* Form View */
          <form onSubmit={handleSubmit} className="py-4 space-y-4">
            {errorMessage && (
              <div className="p-3.5 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2.5 text-xs text-red-700">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5 text-red-600" />
                <div>
                  <div className="font-bold">Reservation Conflict / Validation Error</div>
                  <div className="mt-0.5">{errorMessage}</div>
                </div>
              </div>
            )}

            {/* Resource Selector (if not preselected) */}
            {!preselectedResource && (
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Select Facility or Resource *
                </label>
                <select
                  value={selectedResourceId}
                  onChange={(e) => setSelectedResourceId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  required
                >
                  {resources.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.category} • Capacity: {r.capacity})
                    </option>
                  ))}
                </select>
              </div>
            )}

            {/* Resource Info Pill */}
            {currentResource && (
              <div className="p-3 bg-gray-50 rounded-xl border border-gray-200 flex items-center justify-between text-xs">
                <div>
                  <div className="font-bold text-gray-900">{currentResource.name}</div>
                  <div className="text-gray-500">
                    {currentResource.building} • Max Capacity: {currentResource.capacity}
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
                      ? 'Requires Approval'
                      : 'Instant Auto-Approve'}
                  </span>
                </div>
              </div>
            )}

            {/* Date and Time */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Date *</label>
                <input
                  type="date"
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  min={new Date().toISOString().split('T')[0]}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Start Time *</label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">End Time *</label>
                <input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  required
                />
              </div>
            </div>

            {/* Purpose */}
            <div>
              <label className="block text-xs font-bold text-gray-700 mb-1">
                Booking Purpose / Agenda *
              </label>
              <textarea
                value={purpose}
                onChange={(e) => setPurpose(e.target.value)}
                placeholder="e.g. DAA Project Discussion, GDSC Club Workshop, Group Study..."
                rows={2}
                className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                required
              />
            </div>

            {/* Activity Type & Attendance */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">Activity Type</label>
                <select
                  value={activityType}
                  onChange={(e) => setActivityType(e.target.value as ActivityType)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                >
                  <option value="PROJECT_WORK">Project Work / Discussion</option>
                  <option value="CLASS_LECTURE">Extra Lecture / Tutorial</option>
                  <option value="LAB_SESSION">Practical / Lab Session</option>
                  <option value="CLUB_EVENT">Student Club Event</option>
                  <option value="FACULTY_MEETING">Faculty Meeting</option>
                  <option value="GUEST_SEMINAR">Guest Seminar / Speaker</option>
                  <option value="SPORTS_PRACTICE">Sports Practice</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-700 mb-1">
                  Expected Attendance
                </label>
                <input
                  type="number"
                  min={1}
                  max={currentResource ? currentResource.capacity : 500}
                  value={expectedAttendance}
                  onChange={(e) => setExpectedAttendance(Number(e.target.value))}
                  className="w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-[#F58220]/20 focus:border-[#F58220]"
                  required
                />
              </div>
            </div>

            {/* Notice Footer */}
            <div className="p-3 bg-blue-50/60 rounded-xl border border-blue-100 flex items-start gap-2 text-xs text-blue-800">
              <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5 text-blue-600" />
              <span>
                Double-booking prevention and academic timetables are actively verified. Unused
                reservations are released 15 minutes after start time.
              </span>
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={isLoading}
                className="w-full py-2.5 bg-[#F58220] hover:bg-[#E06D0C] text-white font-bold rounded-xl shadow transition flex items-center justify-center gap-2 disabled:opacity-50"
              >
                {isLoading ? (
                  <span className="inline-block animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <span>Confirm Reservation</span>
                )}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

