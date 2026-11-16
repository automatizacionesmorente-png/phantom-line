import { describe, expect, it } from "vitest";
import {
  BookingActionSchema,
  LoginRequestSchema,
  MessageActionSchema,
  PollQuerySchema,
  SlotsQuerySchema,
} from "@/lib/owner/api";
import { PIN_PATTERN } from "@/lib/owner/pin";

const unknownKey = (r: { success: boolean; error?: { issues: { code: string }[] } }) =>
  !r.success && r.error!.issues.some((i) => i.code === "unrecognized_keys");

describe("Machine_API request schemas (lib/owner/api.ts)", () => {
  const valid = {
    login: { pin: "123456", label: "Lola" },
    poll: { since: "41" },
    message: { action: "play" },
    confirm: { action: "confirm", revision: 3 },
    cancel: { action: "cancel", revision: 0 },
    move: { action: "move", revision: 3, start: "2026-11-14T10:30:00Z" },
    slots: { date: "2026-11-14" },
  };

  it("accepts the valid bodies and queries", () => {
    expect(LoginRequestSchema.safeParse(valid.login).success).toBe(true);
    expect(LoginRequestSchema.safeParse({ pin: "123456" }).success).toBe(true);
    expect(PollQuerySchema.safeParse(valid.poll).data).toEqual({ since: 41 });
    expect(PollQuerySchema.safeParse({}).data).toEqual({});
    expect(MessageActionSchema.safeParse(valid.message).success).toBe(true);
    expect(MessageActionSchema.safeParse({ action: "erase" }).success).toBe(true);
    for (const b of [valid.confirm, valid.cancel, valid.move]) expect(BookingActionSchema.safeParse(b).success).toBe(true);
    expect(BookingActionSchema.safeParse({ ...valid.move, start: "2026-11-14T11:30:00+01:00" }).success).toBe(true);
    expect(SlotsQuerySchema.safeParse(valid.slots).success).toBe(true);
  });

  it("every schema rejects an unknown key", () => {
    expect(unknownKey(LoginRequestSchema.safeParse({ ...valid.login, admin: true }))).toBe(true);
    expect(unknownKey(PollQuerySchema.safeParse({ ...valid.poll, transcript: "1" }))).toBe(true);
    expect(unknownKey(MessageActionSchema.safeParse({ ...valid.message, shopId: "x" }))).toBe(true);
    expect(unknownKey(BookingActionSchema.safeParse({ ...valid.confirm, start: "2026-11-14T10:30:00Z" }))).toBe(true);
    expect(unknownKey(BookingActionSchema.safeParse({ ...valid.cancel, resourceId: "chair-1" }))).toBe(true);
    expect(unknownKey(BookingActionSchema.safeParse({ ...valid.move, resourceId: "chair-1" }))).toBe(true);
    expect(unknownKey(SlotsQuerySchema.safeParse({ ...valid.slots, ignore: "1" }))).toBe(true);
  });

  it("a move without revision is rejected, and so is a confirm or cancel without one", () => {
    expect(BookingActionSchema.safeParse({ action: "move", start: "2026-11-14T10:30:00Z" }).success).toBe(false);
    expect(BookingActionSchema.safeParse({ action: "confirm" }).success).toBe(false);
    expect(BookingActionSchema.safeParse({ action: "cancel" }).success).toBe(false);
  });

  it("rejects malformed values", () => {
    for (const pin of ["12345", "1234567", "12345a", " 123456", "١٢٣٤٥٦"]) {
      expect(LoginRequestSchema.safeParse({ pin }).success).toBe(false);
    }
    expect(LoginRequestSchema.safeParse({ pin: "123456", label: "x".repeat(31) }).success).toBe(false);
    for (const since of ["-1", "1.5", "abc", "", "1".repeat(16)]) {
      expect(PollQuerySchema.safeParse({ since }).success).toBe(false);
    }
    expect(MessageActionSchema.safeParse({ action: "unerase" }).success).toBe(false);
    for (const revision of [-1, 1.5, "3"]) {
      expect(BookingActionSchema.safeParse({ action: "confirm", revision }).success).toBe(false);
    }
    // A move needs an instant with an offset: a local time is ambiguous.
    for (const start of ["2026-11-14T10:30:00", "2026-11-14", "2026-02-30T10:30:00Z", "mañana"]) {
      expect(BookingActionSchema.safeParse({ action: "move", revision: 1, start }).success).toBe(false);
    }
    for (const date of ["2026-02-30", "2026-1-1", "14/11/2026"]) {
      expect(SlotsQuerySchema.safeParse({ date }).success).toBe(false);
    }
  });

  it("the login PIN rule equals PIN_PATTERN in pin.ts", () => {
    for (const pin of ["000000", "123456", "12345", "1234567", "abcdef"]) {
      expect(LoginRequestSchema.safeParse({ pin }).success).toBe(PIN_PATTERN.test(pin));
    }
  });
});
