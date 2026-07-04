import { z } from "zod";
import { httpUrl } from "@/lib/validation";

/**
 * Canonical import record — the contract for externally-gathered business data (e.g. produced by
 * an LLM data-gathering pass). Strict: unknown keys are rejected so malformed rows fail loudly.
 *
 * Idempotency: (source, externalId) is the stable upsert key. Re-importing the same externalId
 * updates the existing row rather than duplicating it.
 *
 * Multilingual embeddings (ADR-001): supply `translations` with BOTH the native-language text and
 * an English (or Thai/Vietnamese) pivot for low-resource languages like Lao — each becomes its own
 * vector, which is the mitigation for Lao having weak standalone embedding coverage.
 */
const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase-hyphen slug")
  .max(255);

export const ImportRecord = z
  .object({
    source: z.string().trim().min(1).max(50),
    externalId: z.string().trim().min(1).max(200),
    name: z.string().trim().min(1).max(255),
    description: z.string().trim().max(4000).optional(),
    category: z.object({ slug, name_en: z.string().trim().min(1).max(255) }).strict(),
    city: z
      .object({
        slug,
        name_en: z.string().trim().min(1).max(255),
        name_local: z.string().trim().max(255).optional(),
        country: z.string().regex(/^[A-Za-z]{2}$/, "ISO-3166 alpha-2"),
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
      })
      .strict(),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional(),
    phone: z.string().trim().max(40).optional(),
    website: httpUrl(500).optional(),

    // --- richer profile fields (all optional) ---
    businessType: z.string().trim().max(100).optional(),
    address: z.string().trim().max(500).optional(),
    // socials: platform -> handle/path (NOT a full URL; the app builds the link). Strict keys.
    socials: z
      .object({
        facebook: z.string().trim().max(300).optional(),
        instagram: z.string().trim().max(300).optional(),
        tiktok: z.string().trim().max(300).optional(),
        youtube: z.string().trim().max(300).optional(),
        linkedin: z.string().trim().max(300).optional(),
        x: z.string().trim().max(300).optional(),
        whatsapp: z.string().trim().max(300).optional(),
      })
      .strict()
      .optional(),
    keywords: z.array(z.string().trim().min(1).max(50)).max(30).optional(),
    yearEstablished: z.number().int().min(1800).max(2100).optional(),
    employeeCount: z.string().trim().max(50).optional(),
    // businessHours: day -> "08:00-17:00" | "closed"
    businessHours: z.record(z.enum(["mon", "tue", "wed", "thu", "fri", "sat", "sun"]), z.string().max(40)).optional(),
    metaDescription: z.string().trim().max(320).optional(),

    primaryLanguage: z.enum(["en", "th", "lo", "vi"]).default("en"),
    translations: z
      .array(z.object({ lang: z.enum(["en", "th", "lo", "vi"]), text: z.string().trim().min(1).max(4000) }).strict())
      .max(4)
      .refine((arr) => new Set(arr.map((t) => t.lang)).size === arr.length, "duplicate translation lang")
      .optional(),
    status: z.enum(["active", "pending"]).default("active"),
  })
  .strict();

export type ImportRecord = z.infer<typeof ImportRecord>;

export const ImportFile = z.array(ImportRecord).min(1).max(5000);
