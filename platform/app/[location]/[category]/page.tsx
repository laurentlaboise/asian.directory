import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getCity, getCategory, getBusinessesByLocationCategory, siteOrigin } from "@/lib/queries";
import { safeJsonLd } from "@/lib/jsonld";

// ISR: served from cache, refreshed hourly (programmatic pages, spec §4.4).
export const revalidate = 3600;
export const dynamicParams = true;

// Thin-content guard: pages with fewer than this many listings are noindex'd (spec §4.1),
// and pages with zero are 404'd rather than served as thin content.
const MIN_INDEXABLE = 3;

type Params = { location: string; category: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { location, category } = await params;
  const [city, cat] = await Promise.all([getCity(location), getCategory(category)]);
  if (!city || !cat) return { title: "Not found", robots: { index: false, follow: false } };

  const list = await getBusinessesByLocationCategory(location, category);
  const title = `${cat.name_en} in ${city.name_en} — SEA Directory`;
  const description = list.length
    ? `Discover ${list.length} ${String(cat.name_en).toLowerCase()} in ${city.name_en}. Verified local businesses with reviews and directions.`
    : `${cat.name_en} in ${city.name_en}.`;

  return {
    title,
    description,
    alternates: { canonical: `${siteOrigin}/${location}/${category}` },
    // Below the threshold, keep it out of the index but let crawlers follow links.
    robots: list.length < MIN_INDEXABLE ? { index: false, follow: true } : { index: true, follow: true },
  };
}

export default async function LocationCategoryPage({ params }: { params: Promise<Params> }) {
  const { location, category } = await params;
  const [city, cat] = await Promise.all([getCity(location), getCategory(category)]);
  if (!city || !cat) notFound();

  const list = await getBusinessesByLocationCategory(location, category);
  if (list.length === 0) notFound(); // no content -> 404, never a thin page

  const avg = list.reduce((s, b) => s + Number(b.review_score), 0) / list.length;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: `${cat.name_en} in ${city.name_en}`,
    numberOfItems: list.length,
    itemListElement: list.map((b, i) => ({
      "@type": "ListItem",
      position: i + 1,
      item: {
        "@type": "LocalBusiness",
        name: b.name,
        url: `${siteOrigin}/biz/${b.slug}`,
        ...(b.review_count > 0
          ? {
              aggregateRating: {
                "@type": "AggregateRating",
                ratingValue: Number(b.review_score).toFixed(1),
                reviewCount: b.review_count,
              },
            }
          : {}),
      },
    })),
  };

  return (
    <main className="mx-auto max-w-3xl px-4 py-10">
      {/* JSON-LD is non-executable data (type=application/ld+json), so it needs no CSP nonce;
          omitting headers() keeps this page statically generated / ISR-cacheable. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <h1 className="text-2xl font-bold">
        {cat.name_en} in {city.name_en}
      </h1>
      <p className="mt-1 text-sm text-gray-500">
        {list.length} local {String(cat.name_en).toLowerCase()} · average rating {avg.toFixed(1)}
      </p>
      {list.length < MIN_INDEXABLE && (
        <p className="mt-2 text-xs text-amber-600">Limited listings so far — more coming soon.</p>
      )}
      <ul className="mt-6 grid gap-3 sm:grid-cols-2">
        {list.map((b) => (
          <li key={b.id} className="rounded-xl border border-gray-200 bg-white p-4">
            <a href={`/biz/${b.slug}`} className="font-semibold text-yellow-600">
              {b.name}
            </a>
            {b.description && <p className="mt-1 text-sm text-gray-600">{b.description}</p>}
            <p className="mt-2 text-xs text-gray-400">
              ★ {Number(b.review_score).toFixed(1)} ({b.review_count})
            </p>
          </li>
        ))}
      </ul>
    </main>
  );
}
