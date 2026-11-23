CREATE TABLE "expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"concept" text NOT NULL,
	"category" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"day" date,
	"recurring" boolean DEFAULT false NOT NULL,
	"start_month" text,
	"end_month" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "expenses_concept_ck" CHECK (char_length("expenses"."concept") BETWEEN 1 AND 80),
	CONSTRAINT "expenses_category_ck" CHECK ("expenses"."category" IN ('rent', 'products', 'utilities', 'staff', 'other')),
	CONSTRAINT "expenses_amount_ck" CHECK ("expenses"."amount_cents" > 0),
	CONSTRAINT "expenses_shape_ck" CHECK (("expenses"."recurring" AND "expenses"."start_month" IS NOT NULL AND "expenses"."start_month" ~ '^\d{4}-\d{2}$' AND "expenses"."day" IS NULL) OR (NOT "expenses"."recurring" AND "expenses"."day" IS NOT NULL)),
	CONSTRAINT "expenses_end_month_ck" CHECK ("expenses"."end_month" IS NULL OR "expenses"."end_month" ~ '^\d{4}-\d{2}$')
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"kind" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"client_id" uuid,
	"booking_id" uuid,
	"phone" text NOT NULL,
	"language" text NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'prepared' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"acted_at" timestamp with time zone,
	"curated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "outbox_kind_ck" CHECK ("outbox"."kind" IN ('reminder', 'review', 'gap', 'winback', 'birthday')),
	CONSTRAINT "outbox_phone_ck" CHECK ("outbox"."phone" ~ '^\+[0-9]{6,15}$'),
	CONSTRAINT "outbox_language_ck" CHECK ("outbox"."language" IN ('es', 'en')),
	CONSTRAINT "outbox_body_ck" CHECK (char_length("outbox"."body") <= 700),
	CONSTRAINT "outbox_status_ck" CHECK ("outbox"."status" IN ('prepared', 'sent', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"booking_id" uuid,
	"amount_cents" integer NOT NULL,
	"product_cents" integer DEFAULT 0 NOT NULL,
	"product_label" text DEFAULT '' NOT NULL,
	"method" text NOT NULL,
	"paid_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "payments_booking_id_unique" UNIQUE("booking_id"),
	CONSTRAINT "payments_amount_ck" CHECK ("payments"."amount_cents" >= 0),
	CONSTRAINT "payments_product_ck" CHECK ("payments"."product_cents" >= 0),
	CONSTRAINT "payments_label_ck" CHECK (char_length("payments"."product_label") <= 60),
	CONSTRAINT "payments_method_ck" CHECK ("payments"."method" IN ('cash', 'card', 'bizum', 'voucher'))
);
--> statement-breakpoint
CREATE TABLE "shop_settings" (
	"shop_id" text PRIMARY KEY NOT NULL,
	"automations" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"google_review_url" text,
	"vat_rate_pct" integer DEFAULT 21 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "shop_settings_vat_ck" CHECK ("shop_settings"."vat_rate_pct" BETWEEN 0 AND 30)
);
--> statement-breakpoint
CREATE TABLE "time_blocks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"resource_id" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"curated" boolean DEFAULT false NOT NULL,
	CONSTRAINT "time_blocks_order_ck" CHECK ("time_blocks"."ends_at" > "time_blocks"."starts_at"),
	CONSTRAINT "time_blocks_reason_ck" CHECK (char_length("time_blocks"."reason") <= 80)
);
--> statement-breakpoint
ALTER TABLE "bookings" DROP CONSTRAINT "bookings_channel_ck";--> statement-breakpoint
ALTER TABLE "owner_actions" DROP CONSTRAINT "owner_actions_action_ck";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "client_id" uuid;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "price_cents" integer;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "visit_note" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "birthday" text;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "promo_consent_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "clients" ADD COLUMN "fields" jsonb DEFAULT '{}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox" ADD CONSTRAINT "outbox_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "shop_settings" ADD CONSTRAINT "shop_settings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "time_blocks" ADD CONSTRAINT "time_blocks_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "expenses_shop_idx" ON "expenses" USING btree ("shop_id");--> statement-breakpoint
CREATE UNIQUE INDEX "outbox_shop_dedupe_uq" ON "outbox" USING btree ("shop_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "outbox_shop_status_idx" ON "outbox" USING btree ("shop_id","status");--> statement-breakpoint
CREATE INDEX "payments_shop_paid_idx" ON "payments" USING btree ("shop_id","paid_at");--> statement-breakpoint
CREATE INDEX "time_blocks_shop_start_idx" ON "time_blocks" USING btree ("shop_id","starts_at");--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_client_id_clients_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."clients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_price_ck" CHECK ("bookings"."price_cents" IS NULL OR "bookings"."price_cents" >= 0);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_visit_note_ck" CHECK (char_length("bookings"."visit_note") <= 500);--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_channel_ck" CHECK ("bookings"."channel" IN ('voice', 'whatsapp', 'webchat', 'manual'));--> statement-breakpoint
ALTER TABLE "clients" ADD CONSTRAINT "clients_birthday_ck" CHECK ("clients"."birthday" IS NULL OR "clients"."birthday" ~ '^\d{2}-\d{2}$');--> statement-breakpoint
ALTER TABLE "owner_actions" ADD CONSTRAINT "owner_actions_action_ck" CHECK ("owner_actions"."action" IN ('play', 'erase', 'confirm', 'move', 'cancel', 'no_show', 'book', 'pay'));
--> statement-breakpoint
-- Backfill: link every existing booking to the client card of the same shop and phone.
UPDATE "bookings" b SET "client_id" = c."id" FROM "clients" c WHERE c."shop_id" = b."shop_id" AND c."phone" = b."customer_phone";
