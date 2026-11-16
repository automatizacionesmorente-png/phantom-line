-- Owner machine triggers (owner-machine design.md, "Migrations").
--
-- Machine_Version (12.4): every write to a shop's messages or bookings bumps it, at commit
-- time. The triggers are DEFERRABLE INITIALLY DEFERRED so the shop row is locked only after
-- every statement of the transaction has run: a plain AFTER trigger could take the shop lock
-- first and then wait on a conflicting booking of another transaction (deadlock, 40P01).
-- PGlite 0.5.16 runs this form (task 1.1). An INSERT … ON CONFLICT DO NOTHING that inserts
-- nothing, and an UPDATE that matches no row, fire no row trigger and bump nothing.
CREATE OR REPLACE FUNCTION bump_machine_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE shops SET machine_version = machine_version + 1
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.shop_id ELSE NEW.shop_id END;
  RETURN NULL;
END $$;--> statement-breakpoint
CREATE CONSTRAINT TRIGGER messages_machine_version
  AFTER INSERT OR UPDATE OR DELETE ON messages
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bump_machine_version();--> statement-breakpoint
CREATE CONSTRAINT TRIGGER bookings_machine_version
  AFTER INSERT OR UPDATE OR DELETE ON bookings
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION bump_machine_version();--> statement-breakpoint
-- Booking revision for the optimistic checks of 10.7: every UPDATE bumps it, whoever writes
-- (an owner action, a caller's cancel or reschedule).
CREATE OR REPLACE FUNCTION bump_booking_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.revision := OLD.revision + 1;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER bookings_revision BEFORE UPDATE ON bookings
  FOR EACH ROW EXECUTE FUNCTION bump_booking_revision();--> statement-breakpoint
-- Erase is permanent (8.3): no statement, from any code path, can clear erased_at again.
-- Added in task 8; the design's 0003 relied on "no statement does it", this makes Postgres
-- refuse it. Deleting the row (Demo_Retention, 16.3) is still allowed.
CREATE OR REPLACE FUNCTION keep_message_erased() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.erased_at IS NOT NULL AND (NEW.erased_at IS NULL OR NEW.erased_at <> OLD.erased_at) THEN
    RAISE EXCEPTION 'an erased message stays erased' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;--> statement-breakpoint
CREATE TRIGGER messages_erase_permanent BEFORE UPDATE OF erased_at ON messages
  FOR EACH ROW EXECUTE FUNCTION keep_message_erased();
