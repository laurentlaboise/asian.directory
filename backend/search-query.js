'use strict';

/**
 * Public business search planner.
 *
 * The live catalog (verified 2026-08-23) is Laos-heavy: country is stored as
 * ISO `LA`, while descriptions/addresses say "Laos" / "Lao PDR". The old
 * implementation split the query on whitespace, dropped tokens of length <= 2,
 * then OR-ed each leftover token across name/category/description/address/
 * keywords/country/city. That made q="ANZ bank Laos" and q="coffee in Vientiane"
 * match almost every Laos row.
 *
 * This planner:
 *   - drops stopwords so "in"/"the"/"and"/"best"/"places" cannot zero or broaden a query
 *   - treats country-generic tokens (laos, lao, pdr) as ranking boosts only
 *   - ANDs remaining content tokens so a specific query stays a tight set
 *   - cuisine/style + place (japanese restaurant) stays AND — no restaurant OR-dump
 *   - retries once with the strongest leftover token if the AND set is empty
 *     (never by dropping a cuisine/style when a place word is also present)
 *   - ranks name/category hits above description/address matches
 *   - consumer food/drink/stay queries boost cafes/restaurants/hotels and
 *     demote factories/machineries/associations (factories still match, just later)
 *   - cafe/café/coffee house/coffee shop in the NAME beats messy Manufacture /
 *     Business Services / Association categories (name+category text only)
 *   - mapped primary/sub (categories.js) are query aliases and ranking
 *     signals: restaurants matches restaurant/cafe/hotel tokens already
 *     on the row; food_drink/hotels_travel/legal beat industry parents
 *   - merges the last few user turns when the new message is a short follow-up
 *     (cheaper / wifi / working / "in Vientiane only")
 *
 * Public search stays status='active'. Location-only queries (just "laos")
 * and greetings return no SQL so they cannot dump the catalog.
 */

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'in', 'into', 'is', 'it', 'near', 'of', 'on', 'or', 'the', 'to',
    'vs', 'via', 'with', 'within', 'without', 'about', 'around', 'over',
    'under', 'please', 'find', 'show', 'me', 'looking', 'look', 'search',
    // Conversational leftovers that are not in listing text (AND would zero the set).
    'best', 'better', 'good', 'great', 'need', 'want', 'some',
    'places', 'place', 'spot', 'spots', 'shop', 'shops',
    'hello', 'hi', 'hey', 'i', 'my', 'our',
    // Follow-up / filler words. They refine a prior turn; they are not listing text.
    'cheaper', 'cheap', 'late', 'open', 'others', 'another', 'more',
    'else', 'instead', 'again', 'nearby', 'also', 'any',
    'business', 'businesses',
    // Vague / junk tokens. Do not AND these into SQL or treat them as a category.
    'what', 'should', 'where', 'hungry', 'eat', 'bored', 'help',
    // Amenity / quality follow-ups. They refine a prior city+category; they are
    // not listing text and must not AND into SQL (wifi/working would zero the set).
    'wifi', 'working', 'work', 'hours', 'which', 'they', 'have', 'only',
    'reviews', 'review', 'laptop', 'laptops'
]);

const GREETINGS = new Set(['hello', 'hi', 'hey']);

const FOLLOW_UP_CUES = new Set([
    'cheaper', 'cheap', 'late', 'open', 'others', 'another', 'more',
    'else', 'instead', 'again', 'nearby', 'also', 'any',
    'wifi', 'working', 'work', 'hours', 'which', 'they', 'have', 'only',
    'reviews', 'review', 'laptop', 'laptops'
]);

// Tokens that match almost the entire LA catalog via description/address text.
const COUNTRY_GENERICS = {
    laos: { aliases: ['la', 'laos', 'lao'], iso: 'LA' },
    lao: { aliases: ['la', 'laos', 'lao'], iso: 'LA' },
    pdr: { aliases: ['la', 'laos', 'lao'], iso: 'LA' }
};

// City / country leftovers used to pick a retry token and to carry history.
// They stay searchable on the first pass so "coffee in Vientiane" still ANDs.
const LOCATION_HINTS = new Set([
    ...Object.keys(COUNTRY_GENERICS),
    'vientiane', 'tokyo', 'bangkok', 'seoul', 'hanoi', 'singapore',
    'jakarta', 'manila', 'kuala', 'lumpur', 'mumbai', 'delhi',
    'luang', 'prabang', 'pakse', 'champasak', 'vieng', 'vang',
    'japan', 'korea', 'china', 'thailand', 'vietnam', 'malaysia',
    'indonesia', 'philippines', 'india', 'asia',
    'osaka', 'kyoto', 'yokohama', 'beijing', 'shanghai'
]);

// Places the live catalog does not cover. Empty results mention Southeast Asia.
const OUT_OF_COVERAGE = new Set([
    'tokyo', 'japan', 'osaka', 'kyoto', 'yokohama',
    'seoul', 'korea', 'beijing', 'shanghai', 'ramen'
]);

const CITY_DISPLAY = {
    vientiane: 'Vientiane',
    tokyo: 'Tokyo',
    bangkok: 'Bangkok',
    seoul: 'Seoul',
    hanoi: 'Hanoi',
    singapore: 'Singapore',
    jakarta: 'Jakarta',
    manila: 'Manila',
    mumbai: 'Mumbai',
    delhi: 'Delhi',
    pakse: 'Pakse',
    champasak: 'Champasak',
    japan: 'Japan',
    korea: 'Korea',
    china: 'China',
    thailand: 'Thailand',
    vietnam: 'Vietnam',
    malaysia: 'Malaysia',
    indonesia: 'Indonesia',
    philippines: 'Philippines',
    india: 'India',
    asia: 'Asia',
    osaka: 'Osaka',
    kyoto: 'Kyoto'
};

const CATEGORY_PHRASES = {
    coffee: 'coffee spots',
    cafe: 'cafes',
    hotel: 'hotels',
    hotels: 'hotels',
    ramen: 'ramen spots',
    restaurant: 'restaurants',
    food: 'food matches',
    bank: 'bank matches',
    lawyer: 'lawyer matches',
    travel: 'travel matches'
};

// Cuisine/style + place must stay AND. Live catalog has no sushi/japanese rows
// (verified 2026-08-23); dropping "japanese" and retrying "restaurant" dumped
// western restaurants such as Highland Garden.
const CUISINE_STYLES = new Set([
    'japanese', 'sushi', 'lao', 'thai', 'chinese', 'western'
]);
const PLACE_WORDS = new Set([
    'restaurant', 'restaurants', 'cafe', 'cafes', 'hotel', 'hotels'
]);

// Food / drink / stay (and lawyer as professional-ok). Boost consumer-facing
// name/category; demote industrial rows only for consumer place-words.
const CONSUMER_INTENTS = new Set([
    'coffee', 'cafe', 'cafes', 'restaurant', 'restaurants',
    'hotel', 'hotels', 'eat', 'food', 'lawyer'
]);
const CONSUMER_PLACE_WORDS = new Set([
    'coffee', 'cafe', 'cafes', 'restaurant', 'restaurants',
    'hotel', 'hotels', 'food'
]);
const CONSUMER_SIGNALS = [
    'coffee shop', 'coffee house', 'cafe', 'café', 'restaurant',
    'hotel', 'hospitality', 'tourism', 'bakery', 'bar', 'legal',
    'supermarket', 'food & beverages', 'food and beverages', 'grocery'
];
const INDUSTRIAL_SIGNALS = [
    'manufacture', 'factory', 'association', 'machineries',
    'agriculture', 'agric', 'garment', 'importer', 'cold storage',
    'import-export'
];
const NAME_CAFE_SIGNALS = [
    'coffee shop', 'coffee house', 'cafe', 'café'
];
const CONSUMER_BOOST = 80;
const NAME_CAFE_BOOST = 120;
const INDUSTRIAL_DEMOTE = 90;
const BUSINESS_SERVICES_DEMOTE = 20;
const TAXONOMY_PARENT_BOOST = 40;
const TAXONOMY_INDUSTRY_DEMOTE = 40;

const {
    mapListing,
    termAliases,
    queryConsumerParents,
    CONSUMER_PARENTS,
    INDUSTRY_PARENTS
} = require('./categories');

const GREETING_LINE = "That's not a listing. Try a business name, or a city + what they do.";
const EMPTY_LINE = 'Nothing in the directory for that. Try a name, or a city + what they do.';
const EMPTY_OUTSIDE_LINE = `${EMPTY_LINE} We list Southeast Asia.`;
const TOO_MANY_LINE = 'Too many matches. Showing a few.';
const WEAK_LINE = 'Closest matches I have.';

function tokenize(query) {
    return String(query || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.replace(/[%_]/g, ''))
        .filter(Boolean);
}

function tokenStrength(token) {
    const length = String(token || '').length;
    return LOCATION_HINTS.has(token) ? length * 0.25 : length;
}

/**
 * Pick the leftover token most likely to match a listing (e.g. coffee).
 * Location words are weaker so a failed "coffee + mistyped-city" retries coffee.
 */
function strongestContentTerms(terms) {
    const list = [];
    const seen = new Set();
    for (const term of terms || []) {
        if (!term || seen.has(term)) continue;
        seen.add(term);
        list.push(term);
    }
    if (list.length <= 1) return list;

    let best = list[0];
    let bestScore = tokenStrength(best);
    for (const term of list.slice(1)) {
        const score = tokenStrength(term);
        if (score > bestScore) {
            best = term;
            bestScore = score;
        }
    }
    return [best];
}

function hasCuisineStyle(terms) {
    return (terms || []).some((term) => CUISINE_STYLES.has(term));
}

function hasPlaceWord(terms) {
    return (terms || []).some((term) => PLACE_WORDS.has(term));
}

function isCuisinePlaceQuery(terms) {
    return hasCuisineStyle(terms) && hasPlaceWord(terms);
}

function cuisinePlaceTerms(terms) {
    return (terms || []).filter((term) => CUISINE_STYLES.has(term) || PLACE_WORDS.has(term));
}

function nextRetryQuery(parsed) {
    if (!parsed || !Array.isArray(parsed.contentTerms) || parsed.contentTerms.length <= 1) {
        return null;
    }

    // Cuisine + place is a specific ask. Zero is correct when the catalog
    // has no sushi/japanese rows — do not fall back to restaurant-only.
    if (isCuisinePlaceQuery(parsed.contentTerms)) {
        const required = cuisinePlaceTerms(parsed.contentTerms);
        const extras = parsed.contentTerms.filter((term) => !required.includes(term));
        if (!extras.length) return null;
        return {
            ...parsed,
            contentTerms: required,
            isEmpty: false
        };
    }

    const contentTerms = strongestContentTerms(parsed.contentTerms);
    if (!contentTerms.length) return null;
    if (
        contentTerms.length === parsed.contentTerms.length &&
        contentTerms.every((term, index) => term === parsed.contentTerms[index])
    ) {
        return null;
    }
    return {
        ...parsed,
        contentTerms,
        isEmpty: false
    };
}

/**
 * Decode text that looks like UTF-8 bytes read as Latin-1 (CafÃ©, àº…).
 * One pass only; leaves already-valid copy unchanged.
 */
function decodeMojibake(value) {
    if (typeof value !== 'string' || !value) return value;
    if (!/Ã.|àº|à»/.test(value)) return value;
    try {
        const decoded = Buffer.from(value, 'latin1').toString('utf8');
        if (!decoded || decoded.includes('\uFFFD')) return value;
        return decoded;
    } catch {
        return value;
    }
}

function parseSearchQuery(query) {
    const tokens = tokenize(query);
    const contentTerms = [];
    const locationTerms = [];
    const seenContent = new Set();
    const seenLocation = new Set();
    const rawHasPlace = tokens.some((token) => PLACE_WORDS.has(token));

    for (const token of tokens) {
        if (STOPWORDS.has(token)) continue;
        if (COUNTRY_GENERICS[token]) {
            if (!seenLocation.has(token)) {
                seenLocation.add(token);
                locationTerms.push({ token, ...COUNTRY_GENERICS[token] });
            }
            // "lao restaurant" is cuisine+place, not a country-only leftover.
            if (rawHasPlace && CUISINE_STYLES.has(token) && !seenContent.has(token)) {
                seenContent.add(token);
                contentTerms.push(token);
            }
            continue;
        }
        if (token.length <= 2) continue;
        if (!seenContent.has(token)) {
            seenContent.add(token);
            contentTerms.push(token);
        }
    }

    // City-only leftovers ("Vientiane", "In Tokyo?") are location, not a catalog dump.
    // Category + city ("coffee in Vientiane") still ANDs both content terms.
    const onlyLocationHints = contentTerms.length > 0 && contentTerms.every((term) => LOCATION_HINTS.has(term));
    if (onlyLocationHints) {
        for (const term of contentTerms) {
            if (!seenLocation.has(term)) {
                seenLocation.add(term);
                locationTerms.push({
                    token: term,
                    aliases: COUNTRY_GENERICS[term]?.aliases || [term],
                    iso: COUNTRY_GENERICS[term]?.iso || ''
                });
            }
        }
        return {
            contentTerms: [],
            locationTerms,
            isEmpty: true,
            isLocationOnly: true
        };
    }

    return {
        contentTerms,
        locationTerms,
        isEmpty: contentTerms.length === 0,
        isLocationOnly: contentTerms.length === 0 && locationTerms.length > 0
    };
}

function isGreeting(query) {
    const tokens = tokenize(query);
    if (!tokens.length) return false;
    const meaningful = tokens.filter((token) => !STOPWORDS.has(token) || GREETINGS.has(token));
    if (!meaningful.length) return false;
    return meaningful.every((token) => GREETINGS.has(token));
}

function mentionsOutsideCoverage(query) {
    return tokenize(query).some((token) => OUT_OF_COVERAGE.has(token));
}

function isFollowUp(query) {
    if (isGreeting(query)) return false;
    if (/\bgood\s+for\b/i.test(String(query || ''))) return true;
    const tokens = tokenize(query);
    if (!tokens.length) return false;
    if (tokens.some((token) => FOLLOW_UP_CUES.has(token))) return true;

    const leftover = tokens.filter((token) => (
        !STOPWORDS.has(token)
        && !GREETINGS.has(token)
        && !FOLLOW_UP_CUES.has(token)
        && !COUNTRY_GENERICS[token]
        && token.length > 2
    ));
    const onlyLocation = leftover.length > 0 && leftover.every((token) => LOCATION_HINTS.has(token));
    return onlyLocation && tokens.length <= 5;
}

function extractCityAndCategory(turns) {
    const cities = [];
    const categories = [];
    for (const turn of turns || []) {
        const parsed = parseSearchQuery(turn);
        for (const term of parsed.contentTerms) {
            if (LOCATION_HINTS.has(term)) {
                if (!cities.includes(term)) cities.push(term);
            } else if (!categories.includes(term)) {
                categories.push(term);
            }
        }
    }
    return { cities, categories };
}

/**
 * Tiny multi-turn helper (no LLM). If the latest message is a follow-up
 * ("cheaper?", "open late?", "any others?", "In Vientiane?"), append city
 * and category words from the last three user turns.
 */
function reformulateWithHistory(latest, history) {
    const last3 = (history || []).map((turn) => String(turn || '').trim()).filter(Boolean).slice(-3);
    if (!last3.length || !isFollowUp(latest)) return String(latest || '');

    const { cities, categories } = extractCityAndCategory(last3);
    const latestTokens = new Set(tokenize(latest));
    const latestParsed = parseSearchQuery(latest);
    const replacing = latestTokens.has('instead');
    const extras = (replacing ? cities : [...categories, ...cities])
        .filter((term) => !latestParsed.contentTerms.includes(term) && !latestTokens.has(term));

    if (!extras.length) return String(latest || '');
    return `${String(latest || '').trim()} ${extras.join(' ')}`.trim();
}

function parseHistoryParam(raw) {
    if (raw == null || raw === '') return [];
    if (Array.isArray(raw)) {
        return raw.map((item) => String(item || '').trim()).filter(Boolean).slice(-3);
    }
    const text = String(raw).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean).slice(-3);
            }
        } catch {
            // Fall through to delimiter split.
        }
    }
    return text.split(/\s*\|\s*/).map((item) => item.trim()).filter(Boolean).slice(-3);
}

function haystack(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.join(' ').toLowerCase();
    if (typeof value === 'object') return JSON.stringify(value).toLowerCase();
    return String(value).toLowerCase();
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function hasSignal(text, signals) {
    const hay = haystack(text);
    if (!hay) return false;
    return (signals || []).some((signal) => {
        const body = escapeRegExp(signal).replace(/\\ /g, '[\\s&/-]+');
        return new RegExp(`(?:^|[^a-z0-9])${body}(?:[^a-z0-9]|$)`, 'i').test(hay);
    });
}

function listingFaceText(business) {
    return [
        haystack(business && business.name),
        haystack(business && business.category),
        haystack(business && business.business_type)
    ].join(' ');
}

function listingMatchText(business) {
    return [
        haystack(business && business.name),
        haystack(business && business.category),
        haystack(business && business.description),
        haystack(business && business.address),
        haystack(business && business.keywords),
        haystack(business && business.city),
        haystack(business && business.country),
        haystack(business && business.business_type)
    ].join(' ');
}

function looksConsumerFacing(business) {
    return hasSignal(listingFaceText(business), CONSUMER_SIGNALS);
}

function looksIndustrial(business) {
    return hasSignal(listingFaceText(business), INDUSTRIAL_SIGNALS);
}

function looksAssociation(business) {
    return hasSignal(listingFaceText(business), ['association']);
}

/**
 * Consumer cafe cue from the listing NAME only. Do not read description.
 * "Coffee Fix" / "Miracle Coffee Factory" do not match; "ASTER COFFEE HOUSE" does.
 */
function nameLooksCafe(business) {
    const name = haystack(decodeMojibake(business && business.name));
    return hasSignal(name, NAME_CAFE_SIGNALS);
}

function isConsumerIntentQuery(parsed) {
    return ((parsed && parsed.contentTerms) || []).some((term) => CONSUMER_INTENTS.has(term));
}

function isConsumerPlaceQuery(parsed) {
    return ((parsed && parsed.contentTerms) || []).some((term) => CONSUMER_PLACE_WORDS.has(term));
}

function rowMatchesCuisinePlace(business, parsed) {
    const terms = (parsed && parsed.contentTerms) || [];
    if (!isCuisinePlaceQuery(terms)) return true;
    const required = cuisinePlaceTerms(terms);
    const text = listingMatchText(business);
    return required.every((term) => text.includes(term));
}

function decodeListingFields(business) {
    if (!business || typeof business !== 'object') return business;
    const out = { ...business };
    for (const key of ['name', 'category', 'description', 'address']) {
        if (typeof out[key] === 'string') out[key] = decodeMojibake(out[key]);
    }
    return out;
}

function scoreBusiness(business, parsed) {
    const row = decodeListingFields(business);
    const name = haystack(row && row.name);
    const category = haystack(row && row.category);
    const description = haystack(row && row.description);
    const address = haystack(row && row.address);
    const keywords = haystack(row && row.keywords);
    const city = haystack(row && row.city);
    const country = haystack(row && row.country);

    const mapped = mapListing(business);
    const mappedHay = [mapped.primary, mapped.sub, mapped.label].join(' ').toLowerCase();

    let score = 0;
    for (const term of parsed.contentTerms) {
        const aliases = termAliases(term);
        const nameHit = aliases.some((alias) => name.includes(alias));
        const categoryHit = aliases.some((alias) => category.includes(alias) || mappedHay.includes(alias));
        const cityHit = aliases.some((alias) => city.includes(alias));
        const descriptionHit = aliases.some((alias) => description.includes(alias));
        const otherHit = aliases.some((alias) => (
            address.includes(alias) || keywords.includes(alias) || country.includes(alias)
        ));

        if (nameHit) score += 100;
        else if (categoryHit) score += 50;
        else if (cityHit) score += 25;
        else if (descriptionHit) score += 10;
        else if (otherHit) score += 5;

        // Brand-leading descriptions ("ANZ is the first…") should beat a stray address hit.
        if (aliases.some((alias) => description.startsWith(alias))) score += 40;
    }

    for (const loc of parsed.locationTerms) {
        const aliases = new Set([
            ...(loc.iso ? [loc.iso.toLowerCase()] : []),
            ...(loc.aliases || []),
            loc.token
        ]);
        if (aliases.has(country)) score += 20;
        if (city.includes(loc.token)) score += 8;
    }

    if (isConsumerIntentQuery(parsed)) {
        // Name cafe/café/coffee house/coffee shop beats messy industrial categories.
        // Association orgs ("Hotel and Restaurant Association") stay demoted even
        // when hotel/restaurant appears in the name.
        if (nameLooksCafe(row)) {
            score += NAME_CAFE_BOOST;
        } else if (isConsumerPlaceQuery(parsed) && looksAssociation(row)) {
            score -= INDUSTRIAL_DEMOTE;
        } else if (looksConsumerFacing(row)) {
            score += CONSUMER_BOOST;
        } else if (isConsumerPlaceQuery(parsed) && looksIndustrial(row)) {
            score -= INDUSTRIAL_DEMOTE;
        } else if (isConsumerPlaceQuery(parsed) && listingFaceText(row).includes('business services')) {
            score -= BUSINESS_SERVICES_DEMOTE;
        }
    }

    const consumerParents = queryConsumerParents(parsed);
    if (consumerParents.size) {
        if (consumerParents.has(mapped.primary) && CONSUMER_PARENTS.has(mapped.primary)) {
            score += TAXONOMY_PARENT_BOOST;
        } else if (!nameLooksCafe(row) && INDUSTRY_PARENTS.has(mapped.primary)) {
            // Cafe/café/coffee house names keep their boost even if category
            // maps to Manufacture or another industry parent.
            score -= TAXONOMY_INDUSTRY_DEMOTE;
        }
    }

    if (row && row.is_featured) score += 5;
    return score;
}

function rankBusinesses(businesses, parsed) {
    return (businesses || [])
        .filter((business) => rowMatchesCuisinePlace(business, parsed))
        .map((business, index) => ({
            business: decodeListingFields(business),
            index,
            score: scoreBusiness(business, parsed)
        }))
        .sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            const featured = Number(!!b.business.is_featured) - Number(!!a.business.is_featured);
            if (featured) return featured;
            return a.index - b.index;
        })
        .map((row) => row.business);
}

function buildContentSearchSql(parsed, dialect = 'pg') {
    if (!parsed || parsed.isEmpty || parsed.contentTerms.length === 0) {
        return { sql: null, params: [] };
    }

    const params = [];
    const conditions = [];
    const keywordsExpr = dialect === 'pg' ? 'keywords::text' : 'keywords';
    const fields = [
        'name',
        'category',
        'description',
        'address',
        keywordsExpr,
        "COALESCE(city,'')",
        "COALESCE(country,'')"
    ];

    for (const term of parsed.contentTerms) {
        const aliases = termAliases(term);
        const aliasParts = [];
        if (dialect === 'pg') {
            for (const alias of aliases) {
                params.push(`%${alias}%`);
                const placeholder = `$${params.length}`;
                aliasParts.push(fields.map((field) => `LOWER(${field}) LIKE ${placeholder}`).join(' OR '));
            }
            conditions.push(`(${aliasParts.join(' OR ')})`);
        } else {
            for (const alias of aliases) {
                const like = `%${alias}%`;
                const parts = fields.map((field) => {
                    params.push(like);
                    return `LOWER(${field}) LIKE ?`;
                });
                aliasParts.push(parts.join(' OR '));
            }
            conditions.push(`(${aliasParts.join(' OR ')})`);
        }
    }

    const sql = `SELECT * FROM businesses WHERE status = 'active' AND ${conditions.join(' AND ')}`;
    return { sql, params };
}

async function searchWithRetry(query, execute) {
    const parsed = parseSearchQuery(query);
    const first = await execute(parsed);
    if (first && first.length) return { results: first, parsed, retried: false };
    const retry = nextRetryQuery(parsed);
    if (!retry) return { results: first || [], parsed, retried: false };
    const second = await execute(retry);
    return { results: second || [], parsed: retry, retried: true };
}

function displayCity(term) {
    if (!term) return '';
    const key = String(term).toLowerCase();
    if (CITY_DISPLAY[key]) return CITY_DISPLAY[key];
    return key.charAt(0).toUpperCase() + key.slice(1);
}

function categoryPhrase(terms) {
    for (const term of terms || []) {
        if (LOCATION_HINTS.has(term)) continue;
        if (CATEGORY_PHRASES[term]) return CATEGORY_PHRASES[term];
        return `${term} matches`;
    }
    return '';
}

function dominantCityName(results) {
    const counts = new Map();
    for (const row of results || []) {
        const city = String((row && row.city) || '').trim();
        if (!city) continue;
        const key = city.toLowerCase();
        counts.set(key, { name: city, count: (counts.get(key)?.count || 0) + 1 });
    }
    let best = null;
    for (const entry of counts.values()) {
        if (!best || entry.count > best.count) best = entry;
    }
    const total = (results || []).length;
    if (!best || best.count < Math.ceil(total / 2)) return '';
    return best.name;
}

function cityFromTerms(terms) {
    const list = terms || [];
    if (list.includes('luang') && list.includes('prabang')) return 'Luang Prabang';
    if (list.includes('vang') && list.includes('vieng')) return 'Vang Vieng';
    if (list.includes('kuala') && list.includes('lumpur')) return 'Kuala Lumpur';
    for (const term of list) {
        if (CITY_DISPLAY[term]) return CITY_DISPLAY[term];
    }
    return '';
}

/**
 * One honest sentence that changes with the prompt. Never invents a listing name.
 */
function buildAssistantLine({ query, parsed, results, truncated, retried, emptyReason }) {
    if (emptyReason === 'greeting' || isGreeting(query)) return GREETING_LINE;

    const list = results || [];
    if (!list.length) {
        return mentionsOutsideCoverage(query) ? EMPTY_OUTSIDE_LINE : EMPTY_LINE;
    }
    if (truncated) return TOO_MANY_LINE;

    const terms = (parsed && parsed.contentTerms) || parseSearchQuery(query).contentTerms;
    const category = categoryPhrase(terms);
    const city = cityFromTerms(terms) || dominantCityName(list);

    if (category && city) return `Here are ${category} in ${city}.`;
    if (category) return `Here are ${category}.`;
    if (city) return `Here are listings in ${city}.`;
    if (retried) return WEAK_LINE;
    return WEAK_LINE;
}

function buildFollowUpChips({ parsed, results }) {
    const terms = (parsed && parsed.contentTerms) || [];
    const category = terms.find((term) => !LOCATION_HINTS.has(term)) || '';
    const hasCity = terms.some((term) => LOCATION_HINTS.has(term));
    const chips = [];

    if (category === 'coffee' && !hasCity) {
        chips.push('In Vientiane?');
        chips.push('Hotels instead?');
    } else {
        if (!hasCity) {
            const city = dominantCityName(results);
            if (city) chips.push(`In ${city}?`);
        }
        if (category === 'coffee') chips.push('Hotels instead?');
        else if (category === 'hotel' || category === 'hotels') chips.push('Coffee instead?');
        else if (category) chips.push('In Vientiane?');
    }

    if ((results || []).length) {
        if (!chips.includes('Any others?')) chips.push('Any others?');
        if (!chips.includes('Open late?')) chips.push('Open late?');
    }

    return chips.slice(0, 3);
}

module.exports = {
    STOPWORDS,
    GREETINGS,
    FOLLOW_UP_CUES,
    COUNTRY_GENERICS,
    LOCATION_HINTS,
    OUT_OF_COVERAGE,
    CUISINE_STYLES,
    PLACE_WORDS,
    CONSUMER_INTENTS,
    CONSUMER_SIGNALS,
    INDUSTRIAL_SIGNALS,
    NAME_CAFE_SIGNALS,
    nameLooksCafe,
    GREETING_LINE,
    EMPTY_LINE,
    EMPTY_OUTSIDE_LINE,
    TOO_MANY_LINE,
    WEAK_LINE,
    tokenize,
    parseSearchQuery,
    strongestContentTerms,
    nextRetryQuery,
    isCuisinePlaceQuery,
    decodeMojibake,
    decodeListingFields,
    mapListing,
    termAliases,
    isGreeting,
    isFollowUp,
    mentionsOutsideCoverage,
    reformulateWithHistory,
    parseHistoryParam,
    searchWithRetry,
    scoreBusiness,
    rankBusinesses,
    buildContentSearchSql,
    buildAssistantLine,
    buildFollowUpChips
};
