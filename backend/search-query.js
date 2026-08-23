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
 *   - retries once with the strongest leftover token if the AND set is empty
 *   - ranks name/category hits above description/address matches
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
    // Amenity / quality follow-ups. They refine a prior city+category; they are
    // not listing text and must not AND into SQL (wifi/working would zero the set).
    'wifi', 'working', 'work', 'hours', 'which', 'they', 'have', 'only'
]);

const GREETINGS = new Set(['hello', 'hi', 'hey']);

const FOLLOW_UP_CUES = new Set([
    'cheaper', 'cheap', 'late', 'open', 'others', 'another', 'more',
    'else', 'instead', 'again', 'nearby', 'also', 'any',
    'wifi', 'working', 'work', 'hours', 'which', 'they', 'have', 'only'
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
    bank: 'bank matches',
    lawyer: 'lawyer matches',
    travel: 'travel matches'
};

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

function nextRetryQuery(parsed) {
    if (!parsed || !Array.isArray(parsed.contentTerms) || parsed.contentTerms.length <= 1) {
        return null;
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

    for (const token of tokens) {
        if (STOPWORDS.has(token)) continue;
        if (COUNTRY_GENERICS[token]) {
            if (!seenLocation.has(token)) {
                seenLocation.add(token);
                locationTerms.push({ token, ...COUNTRY_GENERICS[token] });
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

function scoreBusiness(business, parsed) {
    const name = haystack(business && business.name);
    const category = haystack(business && business.category);
    const description = haystack(business && business.description);
    const address = haystack(business && business.address);
    const keywords = haystack(business && business.keywords);
    const city = haystack(business && business.city);
    const country = haystack(business && business.country);

    let score = 0;
    for (const term of parsed.contentTerms) {
        if (name.includes(term)) score += 100;
        else if (category.includes(term)) score += 50;
        else if (city.includes(term)) score += 25;
        else if (description.includes(term)) score += 10;
        else if (address.includes(term) || keywords.includes(term) || country.includes(term)) score += 5;

        // Brand-leading descriptions ("ANZ is the first…") should beat a stray address hit.
        if (description.startsWith(term)) score += 40;
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

    if (business && business.is_featured) score += 5;
    return score;
}

function rankBusinesses(businesses, parsed) {
    return (businesses || [])
        .map((business, index) => ({
            business,
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
        const like = `%${term}%`;
        if (dialect === 'pg') {
            params.push(like);
            const placeholder = `$${params.length}`;
            conditions.push(`(${fields.map((field) => `LOWER(${field}) LIKE ${placeholder}`).join(' OR ')})`);
        } else {
            const parts = fields.map((field) => {
                params.push(like);
                return `LOWER(${field}) LIKE ?`;
            });
            conditions.push(`(${parts.join(' OR ')})`);
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
    GREETING_LINE,
    EMPTY_LINE,
    EMPTY_OUTSIDE_LINE,
    TOO_MANY_LINE,
    WEAK_LINE,
    tokenize,
    parseSearchQuery,
    strongestContentTerms,
    nextRetryQuery,
    decodeMojibake,
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
