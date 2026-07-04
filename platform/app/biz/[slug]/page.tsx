import { notFound } from "next/navigation";
import { headers } from "next/headers";
import type { Metadata } from "next";
import { getBusinessBySlug, siteOrigin } from "@/lib/queries";
import { safeJsonLd } from "@/lib/jsonld";

export const revalidate = 3600;

type Params = { slug: string };

export async function generateMetadata({ params }: { params: Promise<Params> }): Promise<Metadata> {
  const { slug } = await params;
  const b = await getBusinessBySlug(slug);
  if (!b) return { title: "Not found", robots: { index: false, follow: false } };

  const where = b.city_name ? ` in ${b.city_name}` : "";
  return {
    title: `${b.name}${where} — SEA Directory`,
    description: b.description ?? `${b.name}${where}.`,
    alternates: { canonical: `${siteOrigin}/biz/${b.slug}` },
    robots: { index: true, follow: true },
  };
}

export default async function BusinessPage({ params }: { params: Promise<Params> }) {
  const { slug } = await params;
  const b = await getBusinessBySlug(slug);
  if (!b) notFound();

  const nonce = (await headers()).get("x-nonce") ?? undefined;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "LocalBusiness",
    name: b.name,
    url: `${siteOrigin}/biz/${b.slug}`,
    ...(b.description ? { description: b.description } : {}),
    ...(b.phone ? { telephone: b.phone } : {}),
    ...(b.city_name || b.country
      ? {
          address: {
            "@type": "PostalAddress",
            ...(b.city_name ? { addressLocality: b.city_name } : {}),
            ...(b.country ? { addressCountry: b.country } : {}),
          },
        }
      : {}),
    ...(b.lat && b.lng ? { geo: { "@type": "GeoCoordinates", latitude: b.lat, longitude: b.lng } } : {}),
    ...(b.review_count > 0
      ? {
          aggregateRating: {
            "@type": "AggregateRating",
            ratingValue: Number(b.review_score).toFixed(1),
            reviewCount: b.review_count,
          },
        }
      : {}),
  };

  return (
    <main className="mx-auto max-w-2xl px-4 py-10">
      <script type="application/ld+json" nonce={nonce} dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{b.name}</h1>
        {b.verification_tier >= 2 && (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Verified</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {[b.category_name, b.city_name].filter(Boolean).join(" · ")}
      </p>
      {b.description && <p className="mt-4 text-gray-700">{b.description}</p>}
      <dl className="mt-6 space-y-1 text-sm text-gray-600">
        {b.phone && (
          <div>
            <dt className="inline font-medium">Phone: </dt>
            <dd className="inline">{b.phone}</dd>
          </div>
        )}
        {b.website && (
          <div>
            <dt className="inline font-medium">Website: </dt>
            <dd className="inline">
              <a href={b.website} rel="nofollow noopener noreferrer" target="_blank" className="text-yellow-600">
                {b.website}
              </a>
            </dd>
          </div>
        )}
        {b.review_count > 0 && (
          <div className="text-gray-400">★ {Number(b.review_score).toFixed(1)} ({b.review_count} reviews)</div>
        )}
      </dl>
    </main>
  );
}
