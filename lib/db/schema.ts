import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import type { ShopProfile } from "@/lib/conversation/shopProfile";
import type { CallState, Line } from "@/lib/conversation/types";

/**
 * Text enums are plain `text` with CHECK constraints rather than Postgres
 * enums, so adding a channel or an outcome later is a one-line migration.
 * The no-overlap EXCLUDE constraint on bookings is a custom SQL migration
 * (drizzle/0001_bookings_no_overlap.sql): Drizzle has no builder for it.
 */

const tstz = (name: string) => timestamp(name, { withTimezone: true });

export const shops = pgTable(
  "shops",
  {
    /** URL slug, e.g. "peluqueria-lola". */
    id: text().primaryKey(),
    name: text().notNull(),
    sectorPackId: text("sector_pack_id").notNull(),
    timeZone: text("time_zone").notNull(),
    profile: jsonb().$type<ShopProfile>().notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [uniqueIndex("shops_name_uq").on(t.name)],
);

export const calls = pgTable(
  "calls",
  {
    id: uuid().primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    channel: text().notNull(),
    language: text().notNull(),
    status: text().notNull().default("open"),
    state: jsonb().$type<CallState>().notNull(),
    /** The lines the server itself handled. */
    transcript: jsonb().$type<Line[]>().notNull().default([]),
    turnCount: integer("turn_count").notNull().default(0),
    startedAt: tstz("started_at").notNull().defaultNow(),
    updatedAt: tstz("updated_at").notNull().defaultNow(),
    endedAt: tstz("ended_at"),
  },
  (t) => [
    index("calls_shop_started_idx").on(t.shopId, t.startedAt.desc()),
    index("calls_open_idx").on(t.shopId, t.updatedAt).where(sql`status = 'open'`),
    check("calls_channel_ck", sql`${t.channel} IN ('voice', 'whatsapp', 'webchat')`),
    check("calls_language_ck", sql`${t.language} IN ('es', 'en')`),
    check("calls_status_ck", sql`${t.status} IN ('open', 'completed', 'abandoned', 'failed')`),
  ],
);

export const bookings = pgTable(
  "bookings",
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    /** An id from shop.profile.resources. */
    resourceId: text("resource_id").notNull(),
    serviceId: text("service_id").notNull(),
    startsAt: tstz("starts_at").notNull(),
    endsAt: tstz("ends_at").notNull(),
    status: text().notNull().default("confirmed"),
    customerName: text("customer_name").notNull(),
    /** E.164. */
    customerPhone: text("customer_phone").notNull(),
    channel: text().notNull(),
    callId: uuid("call_id").references(() => calls.id),
    /** The booking this one replaced (reschedule). */
    rescheduledFrom: uuid("rescheduled_from"),
    createdAt: tstz("created_at").notNull().defaultNow(),
    cancelledAt: tstz("cancelled_at"),
  },
  (t) => [
    check("bookings_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_status_ck", sql`${t.status} IN ('confirmed', 'cancelled')`),
    check("bookings_channel_ck", sql`${t.channel} IN ('voice', 'whatsapp', 'webchat')`),
    /** A Call creates at most one Booking (retry-safe). */
    uniqueIndex("bookings_call_uq").on(t.callId),
    index("bookings_shop_start_idx").on(t.shopId, t.startsAt),
    index("bookings_phone_idx").on(t.shopId, t.customerPhone).where(sql`status = 'confirmed'`),
  ],
);

export const messages = pgTable(
  "messages",
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    callId: uuid("call_id")
      .notNull()
      .references(() => calls.id),
    channel: text().notNull(),
    callerName: text("caller_name"),
    callerPhone: text("caller_phone"),
    reason: text().notNull(),
    urgency: text().notNull(),
    /** Written by code from the outcome. */
    agreed: text().notNull(),
    suggestedReply: text("suggested_reply").notNull(),
    outcome: text().notNull(),
    /** Requirement 6.4. */
    modelFailed: boolean("model_failed").notNull().default(false),
    bookingId: uuid("booking_id").references(() => bookings.id),
    readAt: tstz("read_at"),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    /** One Message per Call: hang-up and retries are idempotent. */
    uniqueIndex("messages_call_uq").on(t.callId),
    index("messages_shop_created_idx").on(t.shopId, t.createdAt.desc()),
    index("messages_unread_idx").on(t.shopId).where(sql`read_at IS NULL`),
    check("messages_urgency_ck", sql`${t.urgency} IN ('low', 'normal', 'urgent')`),
    check(
      "messages_outcome_ck",
      sql`${t.outcome} IN ('booked', 'rescheduled', 'cancelled', 'answered', 'message', 'fallback', 'abandoned')`,
    ),
    check("messages_channel_ck", sql`${t.channel} IN ('voice', 'whatsapp', 'webchat')`),
  ],
);

export const rateLimits = pgTable(
  "rate_limits",
  {
    key: text().notNull(),
    windowStart: tstz("window_start").notNull(),
    count: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.windowStart] })],
);

/**
 * `bytea` as a Uint8Array. drizzle-orm 0.45 has no `bytea` column builder, so this is a custom
 * type. Values are sent as a Buffer: PGlite binds it as binary, and the Neon HTTP driver encodes
 * a Buffer parameter as Postgres hex text itself (`encodeBuffersAsBytea`). Neon returns a Buffer
 * (its bundled pg-types parser), PGlite a Uint8Array, and hex text is decoded too (task 9.1).
 */
export const bytea = customType<{ data: Uint8Array; driverData: string | Uint8Array }>({
  dataType: () => "bytea",
  toDriver: (value) => Buffer.from(value.buffer, value.byteOffset, value.byteLength),
  fromDriver: (value) => {
    if (typeof value === "string") {
      if (!value.startsWith("\\x")) throw new Error("bytea: expected hex output");
      return new Uint8Array(Buffer.from(value.slice(2), "hex"));
    }
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  },
});

/**
 * Stored Neural_Voice audio, one row per line without caller data (natural-voice design.md,
 * "The voice cache"). The key is content-addressed (model, voice, style, language and text), and
 * the table holds no text, so a row cannot be read back as a transcript.
 */
export const voiceCache = pgTable(
  "voice_cache",
  {
    /** 32 hex characters (lib/receptionist/voiceCacheKey.ts). */
    key: text().primaryKey(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    language: text().notNull(),
    model: text().notNull(),
    /** audio/mpeg (pre-generated) or audio/wav (live). */
    mime: text().notNull(),
    bytes: bytea().notNull(),
    sizeBytes: integer("size_bytes").notNull(),
    durationMs: integer("duration_ms"),
    /** pregen or live. */
    source: text().notNull(),
    /** Tiers 1–2 of the plan: never evicted. */
    pinned: boolean().notNull().default(false),
    createdAt: tstz("created_at").notNull().defaultNow(),
    lastUsedAt: tstz("last_used_at").notNull().defaultNow(),
  },
  (t) => [
    index("voice_cache_evict_idx").on(t.pinned, t.lastUsedAt),
    check("voice_cache_key_ck", sql`${t.key} ~ '^[0-9a-f]{32}$'`),
    check("voice_cache_language_ck", sql`${t.language} IN ('es', 'en')`),
    check("voice_cache_source_ck", sql`${t.source} IN ('pregen', 'live')`),
    check("voice_cache_size_ck", sql`${t.sizeBytes} > 0`),
  ],
);
