-- Safe Non-Destructive Migration Script for Booking Overlap Exclusion Constraint
-- Project: LPU Smart Campus Facility Booking Platform
-- Role: Role 2 - DEPARTMENT_APPROVER & System Concurrency Hardening (P3)
--
-- NOTE: DO NOT EXECUTE AUTOMATICALLY per project guidelines.
-- This script provides the PostgreSQL DDL to enforce database-level exclusion
-- constraints preventing concurrent overlapping reservations on active bookings.

-- Step 1: Ensure btree_gist extension is available (required to index UUID/text alongside tsrange)
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- Step 2: Add partial exclusion constraint on Booking table
-- Restricts overlap only for active statuses (CONFIRMED, CHECKED_IN, APPROVED)
-- Multiple PENDING, CANCELLED, or REJECTED bookings can coexist without violating the constraint.
ALTER TABLE "Booking"
ADD CONSTRAINT no_overlapping_confirmed_bookings
EXCLUDE USING gist (
  "resourceId" WITH =,
  tsrange("startTime", "endTime") WITH &&
)
WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'APPROVED'));
