CREATE TABLE "waitlist" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"shop_name" text NOT NULL,
	"city" text NOT NULL,
	"email" text NOT NULL,
	"language" text NOT NULL,
	"consent_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "waitlist_language_ck" CHECK ("waitlist"."language" IN ('es', 'en'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "waitlist_email_uq" ON "waitlist" USING btree ("email");