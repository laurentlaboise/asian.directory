'use strict';

/**
 * Exact copy-token tagging (Laurent / Sage, 23 Aug).
 *
 * Overrides the earlier no-extract freeze for the allow-list only.
 * Casey still applies: never infer wifi, date-night, laptop, or quiet
 * from vibe. Residual lock: do not tag wifi from "no wifi" / "not wifi"
 * / "without wifi" / "no wi-fi", and do not tag working from
 * "working capital". Never invent tokens. Never tag best / #1 /
 * verified / top-rated even when those words appear.
 *
 * extractTokens(row) is a pure function. It reads name, category, and
 * description only and returns unique allowed tokens that already
 * appear as whole words or obvious phrases. No new SQL columns —
 * callers write into existing keywords JSONB (and special_offerings
 * only when the token is already an offering word).
 */

const ORIGIN = ['chinese', 'thai', 'lao', 'vietnamese', 'korean', 'japanese', 'french', 'foreign'];
const ACTIVITY = ['developer', 'construction', 'building'];
const SERVICE = ['rental', 'rent', 'apartment', 'hotel', 'cafe', 'restaurant', 'lawyer', 'legal', 'travel'];
const AMENITY = ['wifi', 'wi-fi', 'parking'];
const SUITABLE = ['family', 'working', 'laptop', 'quiet'];
const CUISINE = ['lao', 'thai', 'chinese', 'japanese', 'sushi', 'ramen', 'western', 'french'];
const PHRASES = ['currently building'];

const BLOCKED = new Set(['best', '#1', '1', 'verified', 'top-rated', 'toprated', 'top rated']);

const OFFERING_WORDS = new Set([...AMENITY, ...SERVICE]);

const ALLOWED_IN_ORDER = uniqueTokens([
    ...ORIGIN,
    ...ACTIVITY,
    ...PHRASES,
    ...SERVICE,
    ...AMENITY,
    ...SUITABLE,
    ...CUISINE
]);

const SEARCHABLE_COPY_TOKENS = new Set(ALLOWED_IN_ORDER);

const STRICT_COPY_TOKENS = new Set([
    'wifi',
    'wi-fi',
    'parking',
    'currently building',
    'working',
    'laptop',
    'quiet',
    'family'
]);

const TOKEN_ALIASES = {
    wifi: ['wifi', 'wi-fi'],
    'wi-fi': ['wi-fi', 'wifi']
};

function uniqueTokens(list) {
    const out = [];
    const seen = new Set();
    for (const item of list || []) {
        const token = String(item || '').trim().toLowerCase();
        if (!token || seen.has(token) || BLOCKED.has(token)) continue;
        seen.add(token);
        out.push(token);
    }
    return out;
}

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

function normalizeCopy(value) {
    return decodeMojibake(String(value == null ? '' : value))
        .toLowerCase()
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '');
}

function flattenCopyValue(value) {
    if (value == null) return '';
    if (Array.isArray(value)) return value.map(flattenCopyValue).filter(Boolean).join(' ');
    if (typeof value === 'object') return Object.values(value).map(flattenCopyValue).filter(Boolean).join(' ');
    const text = decodeMojibake(String(value)).trim();
    if (!text) return '';
    if (text.startsWith('[')) {
        const normalized = text.replace(/'/g, '"');
        try {
            const parsed = JSON.parse(normalized);
            if (Array.isArray(parsed)) return flattenCopyValue(parsed);
        } catch {
            return text.replace(/[[\]"']/g, ' ').replace(/\s+/g, ' ').trim();
        }
    }
    return text;
}

function copyHay(row) {
    return [
        flattenCopyValue(row && row.name),
        flattenCopyValue(row && row.category),
        flattenCopyValue(row && row.description)
    ].map(normalizeCopy).join(' ');
}

function escapeRegExp(value) {
    return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function tokenPattern(token, { allowHyphen = true } = {}) {
    const edge = allowHyphen ? '[^a-z0-9]' : '[^a-z0-9-]';
    const body = escapeRegExp(token).replace(/\\ /g, '[\\s]+').replace(/\\-/g, '[\\s-]+');
    return new RegExp(`(?:^|${edge})${body}(?:${edge}|$)`, 'i');
}

function isSuitableToken(token) {
    return SUITABLE.includes(String(token || '').toLowerCase());
}

const WIFI_FORMS = new Set(['wifi', 'wi-fi']);
const WIFI_NEGATION_WINDOW = /(?:^|[^a-z0-9])(?:no|not|without)[\s-]+$/i;
const WORKING_CAPITAL_WINDOW = /^[\s-]+capital(?:[^a-z0-9]|$)/i;
const NEGATION_LOOKBEHIND = 32;
const COLLOCATION_LOOKAHEAD = 24;

function wholeWordMatches(hay, token, allowHyphen) {
    const edge = allowHyphen ? '[^a-z0-9]' : '[^a-z0-9-]';
    const body = escapeRegExp(token).replace(/\\ /g, '[\\s]+').replace(/\\-/g, '[\\s-]+');
    const re = new RegExp(`(^|${edge})(${body})(?=${edge}|$)`, 'gi');
    const matches = [];
    let match = re.exec(hay);
    while (match) {
        const start = match.index + match[1].length;
        matches.push({ start, end: start + match[2].length });
        if (match.index === re.lastIndex) re.lastIndex += 1;
        match = re.exec(hay);
    }
    return matches;
}

function wifiMatchIsNegated(hay, start) {
    const window = hay.slice(Math.max(0, start - NEGATION_LOOKBEHIND), start);
    return WIFI_NEGATION_WINDOW.test(window);
}

function workingMatchIsCapital(hay, end) {
    const window = hay.slice(end, end + COLLOCATION_LOOKAHEAD);
    return WORKING_CAPITAL_WINDOW.test(window);
}

function occurrenceCounts(hay, token) {
    const key = String(token || '').toLowerCase();
    const matches = wholeWordMatches(hay, key, !isSuitableToken(key));
    if (WIFI_FORMS.has(key)) {
        return matches.some((item) => !wifiMatchIsNegated(hay, item.start));
    }
    if (key === 'working') {
        return matches.some((item) => !workingMatchIsCapital(hay, item.end));
    }
    return matches.length > 0;
}

function textHasToken(hay, token) {
    return occurrenceCounts(hay, token);
}

function hasCopyToken(text, token) {
    const hay = normalizeCopy(text);
    if (!hay || !token) return false;
    return textHasToken(hay, token);
}

function copyTokensInText(text) {
    const hay = normalizeCopy(text);
    if (!hay) return [];
    return ALLOWED_IN_ORDER.filter((token) => textHasToken(hay, token));
}

/**
 * Unique allowed tokens already present in name, category, or description.
 * Never invents. Never returns blocked ranking words.
 */
function extractTokens(row) {
    const hay = copyHay(row);
    if (!hay.trim()) return [];
    return ALLOWED_IN_ORDER.filter((token) => textHasToken(hay, token));
}

function asList(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item == null ? '' : item).trim()).filter(Boolean);
    }
    if (typeof value === 'string') {
        const text = value.trim();
        if (!text) return [];
        try {
            const parsed = JSON.parse(text);
            if (Array.isArray(parsed)) return asList(parsed);
        } catch {
            return [text];
        }
    }
    return [];
}

function tokensToAdd(row) {
    const have = new Set(asList(row && row.keywords).map((item) => item.toLowerCase()));
    return extractTokens(row).filter((token) => !have.has(token));
}

function offeringsToAdd(row) {
    const have = new Set(asList(row && row.special_offerings).map((item) => item.toLowerCase()));
    return extractTokens(row).filter((token) => OFFERING_WORDS.has(token) && !have.has(token));
}

function applyCopyTokensToRow(row) {
    const addedKeywords = tokensToAdd(row);
    const addedOfferings = offeringsToAdd(row);
    return {
        keywords: [...asList(row && row.keywords), ...addedKeywords],
        special_offerings: [...asList(row && row.special_offerings), ...addedOfferings],
        addedKeywords,
        addedOfferings
    };
}

function planCopyTokenUpdates(rows) {
    const updates = [];
    for (const row of rows || []) {
        const plan = applyCopyTokensToRow(row);
        if (!plan.addedKeywords.length && !plan.addedOfferings.length) continue;
        updates.push({
            id: row && row.id,
            name: row && row.name,
            addedKeywords: plan.addedKeywords,
            addedOfferings: plan.addedOfferings,
            keywords: plan.keywords,
            special_offerings: plan.special_offerings
        });
    }
    return updates;
}

function keywordAliases(token) {
    const key = String(token || '').toLowerCase();
    return TOKEN_ALIASES[key] || (key ? [key] : []);
}

function keywordHasToken(business, token) {
    const have = new Set(asList(business && business.keywords).map((item) => item.toLowerCase()));
    return keywordAliases(token).some((alias) => have.has(alias));
}

function rowHasCopyToken(business, token) {
    if (keywordHasToken(business, token)) return true;
    const hay = copyHay(business);
    return keywordAliases(token).some((alias) => textHasToken(hay, alias));
}

module.exports = {
    ORIGIN,
    ACTIVITY,
    SERVICE,
    AMENITY,
    SUITABLE,
    CUISINE,
    PHRASES,
    BLOCKED,
    OFFERING_WORDS,
    ALLOWED_IN_ORDER,
    SEARCHABLE_COPY_TOKENS,
    STRICT_COPY_TOKENS,
    TOKEN_ALIASES,
    decodeMojibake,
    normalizeCopy,
    copyHay,
    hasCopyToken,
    copyTokensInText,
    extractTokens,
    asList,
    tokensToAdd,
    offeringsToAdd,
    applyCopyTokensToRow,
    planCopyTokenUpdates,
    keywordAliases,
    keywordHasToken,
    rowHasCopyToken
};
