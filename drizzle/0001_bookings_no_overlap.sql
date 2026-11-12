-- Two confirmed bookings for the same shop and resource whose half-open ranges
-- [starts_at, ends_at) intersect cannot both exist. Back-to-back bookings are
-- allowed, like overlaps() in lib/booking. Cancelled rows leave the constraint.
-- A violation is SQLSTATE 23P01; the repository maps it to "booking_overlap".
-- btree_gist provides "=" on text inside a GiST index (Neon and PGlite ship it).
CREATE EXTENSION IF NOT EXISTS btree_gist;--> statement-breakpoint
ALTER TABLE "bookings"
  ADD CONSTRAINT "bookings_no_overlap"
  EXCLUDE USING gist (
    "shop_id"     WITH =,
    "resource_id" WITH =,
    tstzrange("starts_at", "ends_at", '[)') WITH &&
  )
  WHERE ("status" = 'confirmed');
