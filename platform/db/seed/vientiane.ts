import type { IngestBusiness } from "@/lib/ingest/ingest";

/** Reference data for the Vientiane MVP seed. */
export const cities = [
  { slug: "vientiane", name_en: "Vientiane", name_local: "ວຽງຈັນ", country: "LA", lat: 17.9757, lng: 102.6331 },
];

export const categories = [
  { slug: "restaurant", name_en: "Restaurant", name_lo: "ຮ້ານອາຫານ" },
  { slug: "cafe", name_en: "Cafe", name_lo: "ຮ້ານກາເຟ" },
  { slug: "mechanic", name_en: "Mechanic", name_lo: "ຊ່າງສ້ອມແປງລົດ" },
  { slug: "guesthouse", name_en: "Guesthouse", name_lo: "ເຮືອນພັກ" },
  { slug: "pharmacy", name_en: "Pharmacy", name_lo: "ຮ້ານຂາຍຢາ" },
  { slug: "bakery", name_en: "Bakery", name_lo: "ຮ້ານເບເກີຣີ" },
  { slug: "mobile-repair", name_en: "Mobile Repair", name_lo: "ສ້ອມແປງໂທລະສັບ" },
  { slug: "laundry", name_en: "Laundry", name_lo: "ຮ້ານຊັກຣີດ" },
];

/** A small, realistic seed set. Descriptions are English; ingestion embeds them as `lang: en`.
 *  (Native-Lao content + pivot-translation embeddings are added by the translation step later.) */
export const businesses: IngestBusiness[] = [
  {
    name: "Sabaidee Ramen", slug: "sabaidee-ramen", categorySlug: "restaurant", citySlug: "vientiane",
    description: "Cozy ramen and noodle shop near Nam Phou fountain, open late with vegetarian options.",
    lat: 17.9647, lng: 102.6100, phone: "+856 21 000 111",
  },
  {
    name: "Vientiane Bean Cafe", slug: "vientiane-bean-cafe", categorySlug: "cafe", citySlug: "vientiane",
    description: "Specialty coffee roaster serving Lao Bolaven-plateau beans, fast wifi, riverside seating.",
    lat: 17.9520, lng: 102.6050, website: "https://example.la/bean",
  },
  {
    name: "Mekong Auto Care", slug: "mekong-auto-care", categorySlug: "mechanic", citySlug: "vientiane",
    description: "Full-service car and motorbike repair, engine diagnostics, same-day tyre service.",
    lat: 17.9700, lng: 102.6400, phone: "+856 21 000 222",
  },
  {
    name: "Lotus Guesthouse", slug: "lotus-guesthouse", categorySlug: "guesthouse", citySlug: "vientiane",
    description: "Budget-friendly guesthouse with air-conditioned rooms, close to the Talat Sao market.",
    lat: 17.9660, lng: 102.6130, phone: "+856 21 000 333",
  },
  {
    name: "Chanthabouly Pharmacy", slug: "chanthabouly-pharmacy", categorySlug: "pharmacy", citySlug: "vientiane",
    description: "Neighbourhood pharmacy stocking common prescriptions, first-aid, and baby supplies.",
    lat: 17.9612, lng: 102.6088,
  },
  {
    name: "Sunrise Bakery", slug: "sunrise-bakery", categorySlug: "bakery", citySlug: "vientiane",
    description: "French-Lao bakery famous for fresh baguettes, croissants, and coconut pastries.",
    lat: 17.9585, lng: 102.6142,
  },
  {
    name: "PhoneFix Vientiane", slug: "phonefix-vientiane", categorySlug: "mobile-repair", citySlug: "vientiane",
    description: "Fast smartphone repair — cracked screens, battery swaps, and data recovery while you wait.",
    lat: 17.9668, lng: 102.6119, phone: "+856 21 000 444",
  },
  {
    name: "Clean & Fresh Laundry", slug: "clean-fresh-laundry", categorySlug: "laundry", citySlug: "vientiane",
    description: "Same-day wash, dry, and iron service with pickup and delivery across central Vientiane.",
    lat: 17.9631, lng: 102.6175, phone: "+856 21 000 555",
  },
];
