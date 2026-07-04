/**
 * Build safe outbound social links from a `socials` map (platform -> handle | full URL).
 * Only ever emits http(s) links (never javascript:/data:), matching the SEC-1 posture.
 */
const BASE: Record<string, string> = {
  facebook: "https://facebook.com/",
  instagram: "https://instagram.com/",
  tiktok: "https://tiktok.com/@",
  youtube: "https://youtube.com/@",
  linkedin: "https://linkedin.com/",
  x: "https://x.com/",
  whatsapp: "https://wa.me/",
};

const LABEL: Record<string, string> = {
  facebook: "Facebook",
  instagram: "Instagram",
  tiktok: "TikTok",
  youtube: "YouTube",
  linkedin: "LinkedIn",
  x: "X",
  whatsapp: "WhatsApp",
};

export type SocialLink = { platform: string; label: string; url: string };

export function socialLinks(socials: Record<string, string> | null | undefined): SocialLink[] {
  if (!socials || typeof socials !== "object") return [];
  const out: SocialLink[] = [];
  for (const [platform, raw] of Object.entries(socials)) {
    if (!raw) continue;
    const val = String(raw).trim();
    let url: string;
    if (/^https?:\/\//i.test(val)) {
      url = val; // already a full URL
    } else {
      const base = BASE[platform];
      if (!base) continue;
      url = base + val.replace(/^@/, "").replace(/^\//, "");
    }
    if (!/^https?:\/\//i.test(url)) continue; // final guard: http(s) only
    out.push({ platform, label: LABEL[platform] ?? platform, url });
  }
  return out;
}
