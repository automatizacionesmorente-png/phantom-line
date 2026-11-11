/**
 * The Booking_Match (Requirement 12.1): an existing booking belongs to the
 * caller only when the phone AND the name match. Names are compared ignoring
 * case and accents, after trimming and collapsing spaces.
 */

export function normalizeName(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase().trim().replace(/\s+/g, " ");
}

/** E.164 for comparison: only "+" and digits. */
function canonicalPhone(p: string): string {
  return p.replace(/[^\d+]/g, "");
}

export function matchesCaller(
  caller: { name: string; phone: string },
  booking: { customerName: string; customerPhone: string },
): boolean {
  const phone = canonicalPhone(caller.phone);
  const name = normalizeName(caller.name);
  return (
    phone.length > 0 &&
    name.length > 0 &&
    phone === canonicalPhone(booking.customerPhone) &&
    name === normalizeName(booking.customerName)
  );
}
