CREATE TABLE "owner_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_id" text NOT NULL,
	"action" text NOT NULL,
	"booking_id" uuid,
	"message_id" uuid,
	"actor_session" text NOT NULL,
	"actor_label" text NOT NULL,
	"before" jsonb NOT NULL,
	"after" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "owner_actions_action_ck" CHECK ("owner_actions"."action" IN ('play', 'erase', 'confirm', 'move', 'cancel')),
	CONSTRAINT "owner_actions_target_ck" CHECK (("owner_actions"."booking_id" IS NULL) <> ("owner_actions"."message_id" IS NULL))
);
--> statement-breakpoint
DROP INDEX "messages_unread_idx";--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "owner_confirmed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "cancelled_by" text;--> statement-breakpoint
ALTER TABLE "bookings" ADD COLUMN "revision" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "erased_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "urgency_suggested" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "urgency_basis" jsonb;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "sample_key" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "owner_pin_hash" text;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "owner_pin_set_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "machine_version" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "demo_swept_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "owner_actions" ADD CONSTRAINT "owner_actions_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_actions" ADD CONSTRAINT "owner_actions_booking_id_bookings_id_fk" FOREIGN KEY ("booking_id") REFERENCES "public"."bookings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "owner_actions" ADD CONSTRAINT "owner_actions_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "owner_actions_booking_idx" ON "owner_actions" USING btree ("booking_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "owner_actions_shop_idx" ON "owner_actions" USING btree ("shop_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "messages_new_idx" ON "messages" USING btree ("shop_id") WHERE erased_at IS NULL;--> statement-breakpoint
CREATE INDEX "messages_unheard_idx" ON "messages" USING btree ("shop_id") WHERE erased_at IS NULL AND read_at IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "messages_sample_uq" ON "messages" USING btree ("shop_id","sample_key") WHERE sample_key IS NOT NULL AND erased_at IS NULL;--> statement-breakpoint
ALTER TABLE "bookings" ADD CONSTRAINT "bookings_cancelled_by_ck" CHECK ("bookings"."cancelled_by" IS NULL OR "bookings"."cancelled_by" IN ('caller', 'owner'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_urgency_suggested_ck" CHECK ("messages"."urgency_suggested" IS NULL OR "messages"."urgency_suggested" IN ('low', 'normal', 'urgent'));--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sample_key_ck" CHECK ("messages"."sample_key" IS NULL OR "messages"."sample_key" IN ('urgent', 'booking', 'question'));