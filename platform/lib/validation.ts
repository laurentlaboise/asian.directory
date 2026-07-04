import { z } from "zod";

/**
 * An http(s)-only URL. Plain `z.string().url()` accepts `javascript:` and `data:` URIs (the
 * WHATWG parser doesn't constrain the scheme), which would be a stored-XSS vector for any URL
 * that later renders as an href/src. Always use this for user-supplied URLs we render.
 */
export const httpUrl = (max = 1000) =>
  z
    .string()
    .url()
    .max(max)
    .refine((u) => /^https?:\/\//i.test(u), "Must be an http(s) URL");

/** Render-time guard: returns the URL only if it's an http(s) link, else undefined. */
export function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}
