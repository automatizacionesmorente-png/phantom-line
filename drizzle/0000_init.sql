CREATE TABLE "bookings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"resource_id" text NOT NULL,
	"service_id" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'confirmed' NOT NULL,
	"customer_name" text NOT NULL,
	"customer_phone" text NOT NULL,
	"channel" text NOT NULL,
	"call_id" uuid,
	"rescheduled_from" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"cancelled_at" timestamp with time zone,
	CONSTRAINT "bookings_time_order" CHECK ("bookings"."ends_at" > "bookings"."starts_at"),
	CONSTRAINT "bookings_status_ck" CHECK ("bookings"."status" IN ('confirmed', 'cancelled')),
	CONSTRAINT "bookings_channel_ck" CHECK ("bookings"."channel" IN ('voice', 'whatsapp', 'webchat'))
);
--> statement-breakpoint
CREATE TABLE "calls" (
	"id" uuid PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"channel" text NOT NULL,
	"language" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"state" jsonb NOT NULL,
	"transcript" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"turn_count" integer DEFAULT 0 NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ended_at" timestamp with time zone,
	CONSTRAINT "calls_channel_ck" CHECK ("calls"."channel" IN ('voice', 'whatsapp', 'webchat')),
	CONSTRAINT "calls_language_ck" CHECK ("calls"."language" IN ('es', 'en')),
	CONSTRAINT "calls_status_ck" CHECK ("calls"."status" IN ('open', 'completed', 'abandoned', 'failed'))
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"call_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"caller_name" text,
	"caller_phone" text,
	"reason" text NOT NULL,
	"urgency" text NOT NULL,
	"agreed" text NOT NULL,
	"suggested_reply" text NOT NULL,
	"outcome" text NOT NULL,
	"model_failed" boolean DEFAULT false NOT NULL,
	"booking_id" uuid,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_urgency_ck" CHECK ("messages"."urgency" IN ('low', 'normal', 'urgent')),
	CONSTRAINT "messages_outcome_ck" CHECK ("messages"."outcome" IN ('booked', 'rescheduled', 'cancelled', 'answered', 'message', 'fallback', 'abandoned')),
	CONSTRAINT "messages_channel_ck" CHECK ("messages"."channel" IN ('voice', 'whatsapp', 'webchat'))
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer NOT NULL,
	CONSTRAINT "rate_limits_key_window_start_pk" PRIMARY KEY("key","window_start")
);
--> statement-breakpoint
CREATE TABLE "shops" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sector_pack_id" text NOT NULL,
	"time_zone" text NOT NULL,
	"profile" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "calls" ADD CONSTRAINT "calls_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_call_id_calls_id_fk" FOREIGN KEY ("call_id") REFERENCES "public"."calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "bookings_call_uq" ON "bookings" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "bookings_shop_start_idx" ON "bookings" USING btree ("shop_id","starts_at");--> statement-breakpoint
CREATE INDEX "bookings_phone_idx" ON "bookings" USING btree ("shop_id","customer_phone") WHERE status = 'confirmed';--> statement-breakpoint
CREATE INDEX "calls_shop_started_idx" ON "calls" USING btree ("shop_id","started_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "calls_open_idx" ON "calls" USING btree ("shop_id","updated_at") WHERE status = 'open';--> statement-breakpoint
CREATE UNIQUE INDEX "messages_call_uq" ON "messages" USING btree ("call_id");--> statement-breakpoint
CREATE INDEX "messages_shop_created_idx" ON "messages" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_unread_idx" ON "messages" USING btree ("shop_id") WHERE read_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "shops_name_uq" ON "shops" USING btree ("name");