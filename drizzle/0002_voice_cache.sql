CREATE TABLE "voice_cache" (
	"key" text PRIMARY KEY NOT NULL,
	"shop_id" text NOT NULL,
	"language" text NOT NULL,
	"model" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" "bytea" NOT NULL,
	"size_bytes" integer NOT NULL,
	"duration_ms" integer,
	"source" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "voice_cache_key_ck" CHECK ("voice_cache"."key" ~ '^[0-9a-f]{32}$'),
	CONSTRAINT "voice_cache_language_ck" CHECK ("voice_cache"."language" IN ('es', 'en')),
	CONSTRAINT "voice_cache_source_ck" CHECK ("voice_cache"."source" IN ('pregen', 'live')),
	CONSTRAINT "voice_cache_size_ck" CHECK ("voice_cache"."size_bytes" > 0)
);
--> statement-breakpoint
ALTER TABLE "voice_cache" ADD CONSTRAINT "voice_cache_shop_id_shops_id_fk" FOREIGN KEY ("shop_id") REFERENCES "public"."shops"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "voice_cache_evict_idx" ON "voice_cache" USING btree ("pinned","last_used_at");