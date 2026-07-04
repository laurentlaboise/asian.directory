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
