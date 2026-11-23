CREATE TABLE "clients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"phone" text NOT NULL,
	"name" text NOT NULL,
	"language" text DEFAULT 'es' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "clients_phone_ck" CHECK ("clients"."phone" ~ '^\+[0-9]{6,15}$'),
	CONSTRAINT "clients_language_ck" CHECK ("clients"."language" IN ('es', 'en')),
	CONSTRAINT "clients_note_ck" CHECK (char_length("clients"."note") <= 500)
);
--> statement-breakpoint
ALTER TABLE "owner_actions" DROP CONSTRAINT "owner_actions_action_ck";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "no_show_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "clients_shop_phone_uq" ON "clients" USING btree ("shop_id","phone");--> statement-breakpoint
ALTER TABLE "owner_actions" ADD CONSTRAINT "owner_actions_action_ck" CHECK ("owner_actions"."action" IN ('play', 'erase', 'confirm', 'move', 'cancel', 'no_show'));--> statement-breakpoint
-- Backfill: every shop's existing customers, the latest name per phone (demo rows stay curated = false:
-- the retention sweep removes them with the rest). Phones that are not E.164 are skipped.
INSERT INTO "clients" ("shop_id", "phone", "name", "language", "created_at", "updated_at")
SELECT DISTINCT ON (b."shop_id", b."customer_phone") b."shop_id", b."customer_phone", b."customer_name", 'es', b."created_at", b."created_at"
  FROM "bookings" b
 WHERE b."customer_phone" ~ '^\+[0-9]{6,15}$'
 ORDER BY b."shop_id", b."customer_phone", b."created_at" DESC;
