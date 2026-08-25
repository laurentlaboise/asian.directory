#!/usr/bin/env python3
"""Generate crawlable static listing + city-hub HTML for GitHub Pages."""

from __future__ import annotations

import html
import json
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
LISTINGS_DIR = ROOT / "listings"
SITE = "https://asian.directory"
LASTMOD = "2026-08-23"

# Only the authorized slice. Descriptions are used verbatim.
LISTINGS = [
    {
        "name": "Inthira Vangvieng",
        "slug": "vang-vieng-inthira-vangvieng",
        "city": "Vang Vieng",
        "category": "tourism",
        "phone": "+856 23 511088",
        "website": "https://inthira.com",
        "address": "Vang Vieng, Laos",
        "description": (
            "Inthira Vangvieng is a hotel in Vang Vieng, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: inthira.com."
        ),
    },
    {
        "name": "Amari Vang Vieng Hotel",
        "slug": "vang-vieng-amari-vang-vieng-hotel",
        "city": "Vang Vieng",
        "category": "tourism",
        "phone": "+856 23 511800",
        "website": "https://amari.com/vang-vieng",
        "address": "Vang Vieng, Laos",
        "description": (
            "Amari Vang Vieng Hotel is a hotel in Vang Vieng, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: amari.com/vang-vieng."
        ),
    },
    {
        "name": "Villa Maly Boutique Hotel",
        "slug": "luang-prabang-villa-maly-boutique-hotel",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 71 253903",
        "website": "https://villa-maly.com",
        "address": "Luang Prabang, Laos",
        "description": (
            "Villa Maly Boutique Hotel is a hotel in Luang Prabang, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: villa-maly.com."
        ),
    },
    {
        "name": "The Namkhan",
        "slug": "luang-prabang-the-namkhan",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 30 9997327",
        "website": "https://thenamkhan.com",
        "address": "Luang Prabang, Laos",
        "description": (
            "The Namkhan is a hotel in Luang Prabang, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: thenamkhan.com."
        ),
    },
    {
        "name": "Parasol Blanc Hotel",
        "slug": "luang-prabang-parasol-blanc-hotel",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 71 252124",
        "website": "https://parasol-blanc.com",
        "address": "Luang Prabang, Laos",
        "description": (
            "Parasol Blanc Hotel is a hotel in Luang Prabang, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: parasol-blanc.com."
        ),
    },
    {
        "name": "Ock Pop Tok Living Craft Center",
        "slug": "luang-prabang-ock-pop-tok-living-craft-center",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 07 1212597",
        "website": "https://ockpoptok.com",
        "address": "Luang Prabang, Laos",
        "description": (
            "Ock Pop Tok Living Craft Center is a handicraft and souvenir in Luang Prabang, "
            "publicly listed on Lasting Laos (LNCCI) with a public Lasting Laos / Travelife "
            "sustainability certification. Public website: ockpoptok.com."
        ),
    },
    {
        "name": "Living Land Farm",
        "slug": "luang-prabang-living-land-farm",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 02 077778335",
        "website": "https://livinglandlao.org",
        "address": "Luang Prabang, Laos",
        "description": (
            "Living Land Farm is a cultural excursions in Luang Prabang, publicly listed on "
            "Lasting Laos (LNCCI) with a public Lasting Laos / Travelife sustainability "
            "certification. Public website: livinglandlao.org."
        ),
    },
    {
        "name": "Insight Laos Travel",
        "slug": "luang-prabang-insight-laos-travel",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 20 22 958 777",
        "website": "https://insight-laos.com",
        "address": "Luang Prabang, Laos",
        "description": (
            "Insight Laos Travel is a travel agency in Luang Prabang, publicly listed on "
            "Lasting Laos (LNCCI) with a public Lasting Laos / Travelife sustainability "
            "certification. Public website: insight-laos.com."
        ),
    },
    {
        "name": "GASPARD Restaurant",
        "slug": "luang-prabang-gaspard-restaurant",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 07 1252247",
        "website": "https://gaspardrestaurant.com/home",
        "address": "Luang Prabang, Laos",
        "description": (
            "GASPARD Restaurant is a food and beverage in Luang Prabang, publicly listed on "
            "Lasting Laos (LNCCI) with a public Lasting Laos / Travelife sustainability "
            "certification. Public website: gaspardrestaurant.com."
        ),
    },
    {
        "name": "DTH Travel Laos",
        "slug": "luang-prabang-dth-travel-laos",
        "city": "Luang Prabang",
        "category": "tourism",
        "phone": "+856 20 96 666 425",
        "website": "https://diethelmtravel.com/Laos",
        "address": "Luang Prabang, Laos",
        "description": (
            "DTH Travel Laos is a travel agency in Luang Prabang, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: diethelmtravel.com."
        ),
    },
    {
        "name": "La Folie Lodge",
        "slug": "champasak-la-folie-lodge",
        "city": "Champasak",
        "category": "tourism",
        "phone": "+856 20 55 532 004",
        "website": "https://lafolie-laos.com",
        "address": "Champasak, Laos",
        "description": (
            "La Folie Lodge is a hotel in Champasak, publicly listed on Lasting Laos (LNCCI) "
            "with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: lafolie-laos.com."
        ),
    },
    {
        "name": "Zamil Steel Laos - Vientiane Representative Office",
        "slug": "vientiane-zamil-steel-laos-vientiane-representative-office",
        "city": "Vientiane",
        "category": "Steel construction company",
        "phone": "+856 21 417366",
        "website": "https://zamilsteel.com.vn",
        "address": "Rue 23 Singha Road, No.4 Ban Phonexay, Saysettha District, Vientiene, Vientiane, Laos",
        "description": (
            "Zamil Steel Laos - Vientiane Representative Office is a construction listing on "
            "Google Maps in Vientiane, Laos. Public website: zamilsteel.com.vn."
        ),
    },
    {
        "name": "Thongsy Glass and Aluminium",
        "slug": "vientiane-thongsy-glass-and-aluminium",
        "city": "Vientiane",
        "category": "Construction company",
        "phone": "+856 20 55 518 322",
        "website": "https://thongsygroup.com",
        "address": "Vientiane 01000, Laos",
        "description": (
            "Thongsy Glass and Aluminium is a construction listing on Google Maps in Vientiane, "
            "Laos. Public website: thongsygroup.com."
        ),
    },
    {
        "name": "The Art House Cafe",
        "slug": "vientiane-the-art-house-cafe",
        "city": "Vientiane",
        "category": "tourism",
        "phone": "+856 02 058880288",
        "website": "https://arthouselao.com",
        "address": "Vientiane, Laos",
        "description": (
            "The Art House Cafe is a food and beverage in Vientiane, publicly listed on "
            "Lasting Laos (LNCCI) with a public Lasting Laos / Travelife sustainability "
            "certification. Public website: arthouselao.com."
        ),
    },
    {
        "name": "SSS Electrical Installation Services Company Limited",
        "slug": "vientiane-sss-electrical-installation-services-company-limit",
        "city": "Vientiane",
        "category": "Construction company",
        "phone": "+856 20 22 206 932",
        "website": "https://sssesltd.com",
        "address": "VJCV+P2, Vientiane, Laos",
        "description": (
            "SSS Electrical Installation Services Company Limited is a construction listing on "
            "Google Maps in Vientiane, Laos. Public website: sssesltd.com."
        ),
    },
    {
        "name": "Salana Boutique Hotel",
        "slug": "vientiane-salana-boutique-hotel",
        "city": "Vientiane",
        "category": "tourism",
        "phone": "+856 21 254254",
        "website": "https://salanaboutique.com",
        "address": "Vientiane, Laos",
        "description": (
            "Salana Boutique Hotel is a hotel in Vientiane, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: salanaboutique.com."
        ),
    },
    {
        "name": "PMD Engineering",
        "slug": "vientiane-pmd-engineering",
        "city": "Vientiane",
        "category": "Home builder",
        "phone": "+856 20 54 565 695",
        "website": "https://pmdengineering.blogspot.com",
        "address": "Vientiane, Laos",
        "description": (
            "PMD Engineering is a construction listing on Google Maps in Vientiane, Laos. "
            "Public website: pmdengineering.blogspot.com."
        ),
    },
    {
        "name": "Pasashok Construction Building Sole Co.,LTD",
        "slug": "vientiane-pasashok-construction-building-sole-co-ltd",
        "city": "Vientiane",
        "category": "Construction company",
        "phone": "+856 20 99 603 191",
        "website": "https://pasashok.com",
        "address": "Sawang Road Chanthabuly, 01000, Laos",
        "description": (
            "Pasashok Construction Building Sole Co.,LTD is a construction listing on Google Maps "
            "in Vientiane, Laos. Public website: pasashok.com."
        ),
    },
    {
        "name": "MOHONA CONSTRUCTION COMPANY LIMITED",
        "slug": "vientiane-mohona-construction-company-limited",
        "city": "Vientiane",
        "category": "Construction company",
        "phone": "+856 20 52 156 607",
        "website": "https://mohonaconstruction.com",
        "address": "NONG HAI VILLAGE, HAT XAY, Vientiane, Laos",
        "description": (
            "MOHONA CONSTRUCTION COMPANY LIMITED is a construction listing on Google Maps in "
            "Vientiane, Laos. Public website: mohonaconstruction.com."
        ),
    },
    {
        "name": "Lao Textile Museum",
        "slug": "vientiane-lao-textile-museum",
        "city": "Vientiane",
        "category": "tourism",
        "phone": "+856 02 059596416",
        "website": "https://laotextilemuseum2003.weebly.com",
        "address": "Vientiane, Laos",
        "description": (
            "Lao Textile Museum is a handicraft and souvenir in Vientiane, publicly listed on "
            "Lasting Laos (LNCCI) with a public Lasting Laos / Travelife sustainability "
            "certification. Public website: laotextilemuseum2003.weebly.com."
        ),
    },
    {
        "name": "Lao Global Engineering And Construction",
        "slug": "vientiane-lao-global-engineering-and-construction",
        "city": "Vientiane",
        "category": "Construction company",
        "phone": "+856 20 55 535 799",
        "website": "https://laoglobal.com",
        "address": "Rue Phonpapao, Vientiane, Laos",
        "description": (
            "Lao Global Engineering And Construction is a construction listing on Google Maps "
            "in Vientiane, Laos. Public website: laoglobal.com."
        ),
    },
    {
        "name": "Kualao Restaurant",
        "slug": "vientiane-kualao-restaurant",
        "city": "Vientiane",
        "category": "tourism",
        "phone": "+856 02 055999456",
        "website": "https://kualaorestaurant.com",
        "address": "Vientiane, Laos",
        "description": (
            "Kualao Restaurant is a food and beverage in Vientiane, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: kualaorestaurant.com."
        ),
    },
    {
        "name": "Green Discovery",
        "slug": "vientiane-green-discovery",
        "city": "Vientiane",
        "category": "tourism",
        "phone": "+856 21 264680",
        "website": "https://greendiscoverylaos.com",
        "address": "Vientiane, Laos",
        "description": (
            "Green Discovery is a tour operator in Vientiane, publicly listed on Lasting Laos "
            "(LNCCI) with a public Lasting Laos / Travelife sustainability certification. "
            "Public website: greendiscoverylaos.com."
        ),
    },
]

CITIES = [
    {
        "name": "Vientiane",
        "slug": "vientiane",
        "intro": (
            "Vientiane is the capital of Laos, on the Mekong opposite Nong Khai, Thailand. "
            "This page indexes the Vientiane listings currently published on asian.directory — "
            "construction firms and tourism businesses, each with the public name, category, "
            "and description already on file."
        ),
    },
    {
        "name": "Luang Prabang",
        "slug": "luang-prabang",
        "intro": (
            "Luang Prabang sits in northern Laos where the Nam Khan meets the Mekong. "
            "This page indexes the Luang Prabang listings currently published on asian.directory — "
            "hotels, travel agencies, and other tourism businesses already on file."
        ),
    },
    {
        "name": "Vang Vieng",
        "slug": "vang-vieng",
        "intro": (
            "Vang Vieng is a town in Vientiane Province on the Nam Song river, between Vientiane and Luang Prabang. "
            "This page indexes the Vang Vieng listings currently published on asian.directory."
        ),
    },
    {
        "name": "Champasak",
        "slug": "champasak",
        "intro": (
            "Champasak is a town and province in southern Laos on the Mekong, near Wat Phou. "
            "This page indexes the Champasak listings currently published on asian.directory."
        ),
    },
]


def city_slug(city: str) -> str:
    return next(c["slug"] for c in CITIES if c["name"] == city)


def category_slug(category: str) -> str:
    return category.strip().lower().replace(" ", "-").replace(",", "")


def e(text: str) -> str:
    return html.escape(text, quote=True)


# Outline pin only — not a filled meter.
PIN_OUTLINE = """<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="#FACC15" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>"""


def page_shell(title: str, description: str, canonical: str, body: str, json_ld: dict | None = None) -> str:
    json_block = ""
    if json_ld:
        payload = json.dumps(json_ld, ensure_ascii=False).replace("<", "\\u003c")
        json_block = f'\n    <script type="application/ld+json">{payload}</script>'
    return f"""<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{e(title)}</title>
    <meta name="description" content="{e(description)}">
    <meta name="theme-color" content="#FACC15">
    <link rel="icon" type="image/svg+xml" href="/assets/favicon.svg">
    <link rel="icon" type="image/x-icon" href="/favicon.ico">
    <link rel="apple-touch-icon" href="/apple-touch-icon.png">
    <link rel="canonical" href="{e(canonical)}">
    <meta property="og:title" content="{e(title)}">
    <meta property="og:description" content="{e(description)}">
    <meta property="og:type" content="website">
    <meta property="og:url" content="{e(canonical)}">
    <script src="https://cdn.tailwindcss.com"></script>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        body {{ font-family: 'Inter', sans-serif; }}
    </style>{json_block}
</head>
<body class="bg-gray-100 dark:bg-black text-gray-800 dark:text-gray-200">
{body}
</body>
</html>
"""


def header_html() -> str:
    return f"""    <header class="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900">
        <div class="max-w-3xl mx-auto px-4 py-4 flex items-center gap-3">
            {PIN_OUTLINE}
            <a href="../" class="text-lg font-bold text-gray-800 dark:text-gray-100 hover:text-yellow-500 transition-colors">asian.directory</a>
        </div>
    </header>"""


def footer_html(extra: str = "") -> str:
    extra_html = f" {extra}" if extra else ""
    return f"""    <footer class="max-w-3xl mx-auto px-4 py-10 text-xs text-gray-400 dark:text-gray-500">
        <p>© 2026 asian.directory. All rights reserved.{extra_html}</p>
        <p class="mt-2">
            <a href="../" class="hover:text-yellow-500 transition-colors">Home</a>
            · <a href="vientiane.html" class="hover:text-yellow-500 transition-colors">Vientiane listings</a>
            · <a href="../privacy.html" class="hover:text-yellow-500 transition-colors">Privacy Policy</a>
        </p>
    </footer>"""


def listing_page(item: dict) -> str:
    cslug = city_slug(item["city"])
    cat_slug = category_slug(item["category"])
    page_url = f"{SITE}/listings/{item['slug']}.html"
    title = f"{item['name']} · {item['city']} · asian.directory"
    tel_href = "tel:" + item["phone"].replace(" ", "")
    json_ld = {
        "@context": "https://schema.org",
        "@type": "LocalBusiness",
        "name": item["name"],
        "description": item["description"],
        "telephone": item["phone"],
        "url": item["website"],
        "address": {
            "@type": "PostalAddress",
            "streetAddress": item["address"],
            "addressLocality": item["city"],
            "addressCountry": "LA",
        },
        "mainEntityOfPage": page_url,
    }
    body = f"""{header_html()}
    <main class="max-w-3xl mx-auto px-4 py-10">
        <nav class="text-sm text-gray-500 dark:text-gray-400 mb-6" aria-label="Breadcrumb">
            <a href="../" class="hover:text-yellow-500 transition-colors">Home</a>
            <span class="mx-1">/</span>
            <a href="{e(cslug)}.html" class="hover:text-yellow-500 transition-colors">{e(item["city"])}</a>
            <span class="mx-1">/</span>
            <span class="text-gray-700 dark:text-gray-300">{e(item["name"])}</span>
        </nav>

        <article class="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-6 sm:p-8">
            <h1 class="text-3xl sm:text-4xl font-bold text-gray-800 dark:text-gray-100">{e(item["name"])}</h1>
            <p class="mt-3 text-gray-600 dark:text-gray-300">{e(item["city"])}</p>
            <p class="mt-1 text-gray-600 dark:text-gray-300">{e(item["category"])}</p>
            <p class="mt-6 text-[15px] leading-relaxed text-gray-700 dark:text-gray-200">{e(item["description"])}</p>

            <dl class="mt-8 space-y-3 text-sm text-gray-700 dark:text-gray-300">
                <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Address</dt>
                    <dd class="mt-0.5">{e(item["address"])}</dd>
                </div>
                <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Website</dt>
                    <dd class="mt-0.5"><a href="{e(item["website"])}" rel="nofollow noopener noreferrer" target="_blank" class="text-yellow-600 dark:text-yellow-400 hover:underline break-all">{e(item["website"])}</a></dd>
                </div>
                <div>
                    <dt class="font-medium text-gray-500 dark:text-gray-400">Phone</dt>
                    <dd class="mt-0.5"><a href="{e(tel_href)}" class="hover:text-yellow-500 transition-colors">{e(item["phone"])}</a></dd>
                </div>
            </dl>

            <div class="mt-8 flex flex-wrap gap-2" aria-label="Public chips">
                <span class="rounded-full bg-yellow-100 text-gray-800 dark:bg-yellow-400/20 dark:text-yellow-300 px-3 py-1 text-xs font-medium">{e(cslug)}</span>
                <span class="rounded-full bg-yellow-100 text-gray-800 dark:bg-yellow-400/20 dark:text-yellow-300 px-3 py-1 text-xs font-medium">{e(cat_slug)}</span>
                <span class="rounded-full bg-yellow-100 text-gray-800 dark:bg-yellow-400/20 dark:text-yellow-300 px-3 py-1 text-xs font-medium">country=la</span>
            </div>
        </article>
    </main>
{footer_html()}
"""
    return page_shell(title, item["description"], page_url, body, json_ld)


def city_page(city: dict, items: list[dict]) -> str:
    page_url = f"{SITE}/listings/{city['slug']}.html"
    title = f"{city['name']} listings · asian.directory"
    description = city["intro"]
    by_category: dict[str, list[dict]] = defaultdict(list)
    for item in items:
        by_category[item["category"]].append(item)

    others = [c for c in CITIES if c["slug"] != city["slug"]]
    other_cities = " · ".join(
        f'<a href="{e(c["slug"])}.html" class="hover:text-yellow-500 transition-colors">{e(c["name"])}</a>'
        for c in others
    )

    groups = []
    for category in sorted(by_category.keys()):
        cards = []
        for item in by_category[category]:
            cards.append(
                f"""            <li class="bg-white dark:bg-gray-800 rounded-xl shadow-sm p-5">
                <h3 class="text-lg font-semibold">
                    <a href="{e(item["slug"])}.html" class="text-gray-800 dark:text-gray-100 hover:text-yellow-500 transition-colors">{e(item["name"])}</a>
                </h3>
                <p class="mt-1 text-sm text-gray-500 dark:text-gray-400">{e(item["city"])} · {e(item["category"])}</p>
                <p class="mt-3 text-sm leading-relaxed text-gray-700 dark:text-gray-300">{e(item["description"])}</p>
                <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">{e(item["address"])}</p>
            </li>"""
            )
        groups.append(
            f"""        <section class="mt-10">
            <h2 class="text-xl font-semibold text-gray-800 dark:text-gray-100 mb-4">{e(category)}</h2>
            <ul class="space-y-4">
{chr(10).join(cards)}
            </ul>
        </section>"""
        )

    count = len(items)
    body = f"""{header_html()}
    <main class="max-w-3xl mx-auto px-4 py-10">
        <nav class="text-sm text-gray-500 dark:text-gray-400 mb-6" aria-label="Breadcrumb">
            <a href="../" class="hover:text-yellow-500 transition-colors">Home</a>
            <span class="mx-1">/</span>
            <span class="text-gray-700 dark:text-gray-300">{e(city["name"])}</span>
        </nav>

        <article>
            <h1 class="text-3xl sm:text-4xl font-bold text-gray-800 dark:text-gray-100">{e(city["name"])} listings</h1>
            <p class="mt-4 text-[15px] leading-relaxed text-gray-700 dark:text-gray-200">{e(city["intro"])}</p>
            <p class="mt-3 text-sm text-gray-500 dark:text-gray-400">{count} published listing{"s" if count != 1 else ""} in this city.</p>
            <p class="mt-4 text-sm text-gray-500 dark:text-gray-400">Other cities: {other_cities}</p>
{chr(10).join(groups)}
        </article>
    </main>
{footer_html()}
"""
    return page_shell(title, description, page_url, body)


def write_robots() -> None:
    (ROOT / "robots.txt").write_text(
        "User-agent: *\n"
        "Allow: /listings/\n"
        "Allow: /\n"
        "\n"
        f"Sitemap: {SITE}/sitemap.xml\n",
        encoding="utf-8",
    )


def write_sitemap() -> None:
    urls = [f"{SITE}/"]
    for city in CITIES:
        urls.append(f"{SITE}/listings/{city['slug']}.html")
    for item in LISTINGS:
        urls.append(f"{SITE}/listings/{item['slug']}.html")

    entries = []
    for url in urls:
        entries.append(
            "  <url>\n"
            f"    <loc>{url}</loc>\n"
            f"    <lastmod>{LASTMOD}</lastmod>\n"
            "  </url>"
        )
    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(entries)
        + "\n</urlset>\n"
    )
    (ROOT / "sitemap.xml").write_text(xml, encoding="utf-8")


def main() -> None:
    LISTINGS_DIR.mkdir(parents=True, exist_ok=True)
    by_city: dict[str, list[dict]] = defaultdict(list)
    for item in LISTINGS:
        path = LISTINGS_DIR / f"{item['slug']}.html"
        path.write_text(listing_page(item), encoding="utf-8")
        by_city[item["city"]].append(item)
        print(f"wrote {path.relative_to(ROOT)}")

    for city in CITIES:
        path = LISTINGS_DIR / f"{city['slug']}.html"
        path.write_text(city_page(city, by_city[city["name"]]), encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)}")

    write_robots()
    write_sitemap()
    print(f"wrote robots.txt and sitemap.xml ({len(LISTINGS)} listings, {len(CITIES)} hubs)")


if __name__ == "__main__":
    main()
