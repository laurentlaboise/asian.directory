import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getBusinessBySlug, siteOrigin } from "@/lib/queries";
import { safeJsonLd } from "@/lib/jsonld";
import { safeHref } from "@/lib/validation";
import { socialLinks } from "@/lib/socials";
import { RequestContact } from "./RequestContact";

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

  const socials = socialLinks(b.socials);

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
      {/* JSON-LD is inert data — no CSP nonce needed; keeps the page ISR-cacheable. */}
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: safeJsonLd(jsonLd) }} />
      <div className="flex items-center gap-2">
        <h1 className="text-2xl font-bold">{b.name}</h1>
        {b.verification_tier >= 2 && (
          <span className="rounded bg-green-100 px-2 py-0.5 text-xs text-green-700">Verified</span>
        )}
      </div>
      <p className="mt-1 text-sm text-gray-500">
        {[b.business_type || b.category_name, b.city_name].filter(Boolean).join(" · ")}
      </p>
      {b.trust_summary && (
        <p className="mt-4 rounded-lg bg-yellow-50 p-3 text-sm text-gray-700">
          <span className="font-medium">What people say: </span>
          {b.trust_summary}
        </p>
      )}
      {(b.description || b.meta_description) && (
        <p className="mt-4 text-gray-700">{b.description || b.meta_description}</p>
      )}
      <dl className="mt-6 space-y-1 text-sm text-gray-600">
        {b.address && (
          <div><dt className="inline font-medium">Address: </dt><dd className="inline">{b.address}</dd></div>
        )}
        {b.phone && (
          <div><dt className="inline font-medium">Phone: </dt><dd className="inline">{b.phone}</dd></div>
        )}
        {safeHref(b.website) && (
          <div>
            <dt className="inline font-medium">Website: </dt>
            <dd className="inline">
              <a href={safeHref(b.website)} rel="nofollow noopener noreferrer" target="_blank" className="text-yellow-600">
                {b.website}
              </a>
            </dd>
          </div>
        )}
        {b.year_established && (
          <div><dt className="inline font-medium">Established: </dt><dd className="inline">{b.year_established}</dd></div>
        )}
        {b.employee_count && (
          <div><dt className="inline font-medium">Employees: </dt><dd className="inline">{b.employee_count}</dd></div>
        )}
        {b.review_count > 0 && (
          <div className="text-gray-400">★ {Number(b.review_score).toFixed(1)} ({b.review_count} reviews)</div>
        )}
      </dl>

      {Array.isArray(b.keywords) && b.keywords.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-2">
          {(b.keywords as string[]).map((k) => (
            <span key={k} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">{k}</span>
          ))}
        </div>
      )}

      {socials.length > 0 && (
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          {socials.map((s) => (
            <a key={s.platform} href={s.url} target="_blank" rel="nofollow noopener noreferrer" className="text-yellow-600">
              {s.label}
            </a>
          ))}
        </div>
      )}

      {b.business_hours && typeof b.business_hours === "object" && (
        <div className="mt-4 text-sm text-gray-600">
          <p className="font-medium">Hours</p>
          {Object.entries(b.business_hours as Record<string, string>).map(([day, hrs]) => (
            <div key={day} className="capitalize">{day}: {hrs}</div>
          ))}
        </div>
      )}

      <div className="mt-8">
        <RequestContact businessId={b.id} businessName={b.name} cityId={b.city_id ?? null} />
      </div>
    </main>
  );
}
