import { sql } from "drizzle-orm";
import {
  bigint,
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
import type { UrgencyBasis } from "@/lib/messages/urgency";
import type { AuditValues } from "@/lib/owner/types";

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
    /** Salted scrypt hash of the Owner_PIN, never inside `profile` (owner-machine 2.1). */
    ownerPinHash: text("owner_pin_hash"),
    /** When the PIN last changed: sessions issued before it are invalid (1.8). */
    ownerPinSetAt: tstz("owner_pin_set_at"),
    /** Bumped at commit by the deferred triggers of drizzle/0004_machine_triggers.sql (12.4). */
    machineVersion: bigint("machine_version", { mode: "number" }).notNull().default(0),
    /** Demo_Retention throttle; only ever set for the Demo_Shop (16.6). */
    demoSweptAt: tstz("demo_swept_at"),
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
    /** The Owner's confirmation (10.2); an active Booking stays `status = 'confirmed'` for the constraint. */
    ownerConfirmedAt: tstz("owner_confirmed_at"),
    /** Who cancelled: 'caller' (11.5) or 'owner' (10.8). */
    cancelledBy: text("cancelled_by"),
    /** Bumped by trigger on every UPDATE, whoever writes: the optimistic check of 10.7. */
    revision: integer().notNull().default(0),
  },
  (t) => [
    check("bookings_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check("bookings_status_ck", sql`${t.status} IN ('confirmed', 'cancelled')`),
    check("bookings_cancelled_by_ck", sql`${t.cancelledBy} IS NULL OR ${t.cancelledBy} IN ('caller', 'owner')`),
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
    /** Erased (8.1): permanent, a trigger refuses to clear it (8.3). */
    erasedAt: tstz("erased_at"),
    /** The model's Suggested_Urgency, next to the Final_Urgency in `urgency` (4.3). */
    urgencySuggested: text("urgency_suggested"),
    /** Which Urgency_Rule fired and which term matched (4.3). Null on rows written before it existed. */
    urgencyBasis: jsonb("urgency_basis").$type<UrgencyBasis>(),
    /** Set on the Demo_Shop's Sample_Messages (16.4). */
    sampleKey: text("sample_key"),
  },
  (t) => [
    /** One Message per Call: hang-up and retries are idempotent. */
    uniqueIndex("messages_call_uq").on(t.callId),
    index("messages_shop_created_idx").on(t.shopId, t.createdAt.desc()),
    index("messages_new_idx").on(t.shopId).where(sql`erased_at IS NULL`),
    index("messages_unheard_idx").on(t.shopId).where(sql`erased_at IS NULL AND read_at IS NULL`),
    /** A Sample_Message is on the Tape at most once (16.4): the backstop for insertDemoSamples. */
    uniqueIndex("messages_sample_uq")
      .on(t.shopId, t.sampleKey)
      .where(sql`sample_key IS NOT NULL AND erased_at IS NULL`),
    check("messages_urgency_ck", sql`${t.urgency} IN ('low', 'normal', 'urgent')`),
    check(
      "messages_urgency_suggested_ck",
      sql`${t.urgencySuggested} IS NULL OR ${t.urgencySuggested} IN ('low', 'normal', 'urgent')`,
    ),
    check(
      "messages_sample_key_ck",
      sql`${t.sampleKey} IS NULL OR ${t.sampleKey} IN ('urgent', 'booking', 'question')`,
    ),
    check(
      "messages_outcome_ck",
      sql`${t.outcome} IN ('booked', 'rescheduled', 'cancelled', 'answered', 'message', 'fallback', 'abandoned')`,
    ),
    check("messages_channel_ck", sql`${t.channel} IN ('voice', 'whatsapp', 'webchat')`),
  ],
);

/**
 * The Audit_Record of every Owner_Action that changed something (owner-machine 11), written in
 * the same statement as the change (lib/db/ownerRepository.ts). Exactly one target: a Booking
 * or a Message.
 */
export const ownerActions = pgTable(
  "owner_actions",
  {
    id: uuid().primaryKey().defaultRandom(),
    shopId: text("shop_id")
      .notNull()
      .references(() => shops.id),
    action: text().notNull(),
    bookingId: uuid("booking_id").references(() => bookings.id),
    messageId: uuid("message_id").references(() => messages.id),
    actorSession: text("actor_session").notNull(),
    actorLabel: text("actor_label").notNull(),
    before: jsonb().$type<AuditValues>().notNull(),
    after: jsonb().$type<AuditValues>().notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    check("owner_actions_action_ck", sql`${t.action} IN ('play', 'erase', 'confirm', 'move', 'cancel')`),
    check("owner_actions_target_ck", sql`(${t.bookingId} IS NULL) <> (${t.messageId} IS NULL)`),
    index("owner_actions_booking_idx").on(t.bookingId, t.createdAt.desc()),
    index("owner_actions_shop_idx").on(t.shopId, t.createdAt.desc()),
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
 * The /startup waitlist (BACKLOG 12). Private: no route or page ever reads it back. `email` is
 * stored lowercased and is unique, so a repeat sign-up is a no-op. `consent_at` is the moment the
 * visitor ticked the explicit consent box; a row without it cannot exist.
 */
export const waitlist = pgTable(
  "waitlist",
  {
    id: uuid().primaryKey().defaultRandom(),
    shopName: text("shop_name").notNull(),
    city: text().notNull(),
    email: text().notNull(),
    language: text().notNull(),
    consentAt: tstz("consent_at").notNull(),
    createdAt: tstz("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("waitlist_email_uq").on(t.email),
    check("waitlist_language_ck", sql`${t.language} IN ('es', 'en')`),
  ],
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
