ALTER TABLE "shops" ADD COLUMN "trial" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "shops" ADD COLUMN "expires_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "shops_trial_expiry_idx" ON "shops" USING btree ("trial","expires_at");