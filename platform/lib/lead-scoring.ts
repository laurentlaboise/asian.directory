/**
 * Multi-dimensional lead scoring (spec §2.1). Total 0-100 from four independent dimensions:
 *   Intent strength     0-40  (from the intent classifier)
 *   Proximity fit       0-25  (geo distance user -> business)
 *   Verification tier   0-20  (trust)
 *   Historical response 0-15  (self-regulating quality loop)
 * Pure functions so they're trivially unit-testable and deterministic.
 */

export function proximityScore(distanceKm: number | null): number {
  if (distanceKm == null) return 12; // unknown location -> neutral
  if (distanceKm <= 2) return 25;
  if (distanceKm <= 5) return 20;
  if (distanceKm <= 15) return 12;
  if (distanceKm <= 40) return 6;
  return 0;
}

export function verificationScore(tier: number): number {
  const table = [0, 8, 15, 20];
  return table[Math.max(0, Math.min(3, Math.trunc(tier)))]!;
}

export function responsivenessScore(avgResponseMinutes: number | null): number {
  if (avgResponseMinutes == null) return 8; // no history -> neutral, don't over-penalize new merchants
  if (avgResponseMinutes <= 60) return 15;
  if (avgResponseMinutes <= 240) return 10;
  if (avgResponseMinutes <= 1440) return 5;
  return 0;
}

/** Great-circle distance in km between two lat/lng points; null if either is missing. */
export function haversineKm(
  aLat: number | null,
  aLng: number | null,
  bLat: number | null,
  bLng: number | null,
): number | null {
  if (aLat == null || aLng == null || bLat == null || bLng == null) return null;
  const R = 6371;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function totalScore(parts: {
  intentStrength: number;
  proximity: number;
  verification: number;
  responsiveness: number;
}): number {
  const sum = parts.intentStrength + parts.proximity + parts.verification + parts.responsiveness;
  return Math.max(0, Math.min(100, Math.round(sum)));
}
