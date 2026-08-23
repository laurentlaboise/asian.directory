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
 *   - drops stopwords so "in"/"the"/"and" cannot broaden a query
 *   - treats country-generic tokens (laos, lao, pdr) as ranking boosts only
 *   - ANDs remaining content tokens so a specific query stays a tight set
 *   - ranks name/category hits above description/address matches
 *
 * Public search stays status='active'. Location-only queries (just "laos")
 * return no SQL so they cannot dump the catalog.
 */

const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'as', 'at', 'be', 'by', 'for', 'from',
    'in', 'into', 'is', 'it', 'near', 'of', 'on', 'or', 'the', 'to',
    'vs', 'via', 'with', 'within', 'without', 'about', 'around', 'over',
    'under', 'please', 'find', 'show', 'me', 'looking', 'look', 'search'
]);

// Tokens that match almost the entire LA catalog via description/address text.
const COUNTRY_GENERICS = {
    laos: { aliases: ['la', 'laos', 'lao'], iso: 'LA' },
    lao: { aliases: ['la', 'laos', 'lao'], iso: 'LA' },
    pdr: { aliases: ['la', 'laos', 'lao'], iso: 'LA' }
};

function tokenize(query) {
    return String(query || '')
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .split(/[^\p{L}\p{N}]+/u)
        .map((token) => token.replace(/[%_]/g, ''))
        .filter(Boolean);
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

    return {
        contentTerms,
        locationTerms,
        isEmpty: contentTerms.length === 0,
        isLocationOnly: contentTerms.length === 0 && locationTerms.length > 0
    };
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
        const aliases = new Set([loc.iso.toLowerCase(), ...loc.aliases, loc.token]);
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

module.exports = {
    STOPWORDS,
    COUNTRY_GENERICS,
    parseSearchQuery,
    scoreBusiness,
    rankBusinesses,
    buildContentSearchSql
};
