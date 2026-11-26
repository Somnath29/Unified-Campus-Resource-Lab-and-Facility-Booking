CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE "Booking"
ADD CONSTRAINT no_overlapping_confirmed_bookings
EXCLUDE USING gist (
  "resourceId" WITH =,
  tsrange("startTime", "endTime") WITH &&
)
WHERE (status IN ('CONFIRMED', 'CHECKED_IN', 'APPROVED'));
