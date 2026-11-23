ALTER TABLE "bookings" ADD COLUMN "curated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "calls" ADD COLUMN "curated" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "curated" boolean DEFAULT false NOT NULL;