'use strict';

/**
 * Homepage conversational layer.
 *
 * Official asian.directory voice lives in SYSTEM_PROMPT_TEXT. Greetings and
 * vague need asks (hungry / what should I eat / bored / help) clarify first
 * and never search junk tokens. Clarify chips are coverage-backed from the
 * taxonomy (search or mapped count > 0). Food-intent clarify is food-domain
 * + city only — never Hotels?, Lawyers?, Banks?, or Construction?. Greeting
 * and general need keep a broader coverage-backed mix. Sushi? stays hidden
 * until a row maps to sushi. Specified turns still use search-query.js + searchBusinesses. If
 * XAI_API_KEY (or GROK_API_KEY) is set, a short Grok
 * reply is written from the listing JSON only. Missing fields stay missing —
 * no invented wifi, hours, CEOs, or reviews.
 *
 * SEO lock (Milan): chat is homepage-only. Never persist reply text into
 * listing description, keywords, or static HTML. This module is read-only
 * on the catalog — no add/update business, no file writes.
 *
 * Model id is grok-4.3 (verified 2026-08-23 on docs.x.ai). grok-3-mini and
 * grok-4-fast are retired / redirected. Override with XAI_MODEL if needed.
 */

const https = require('https');
const {
    reformulateWithHistory,
    parseSearchQuery,
    buildAssistantLine,
    buildFollowUpChips,
    tokenize,
    isGreeting,
    isFollowUp,
    isCardRefFollowUp,
    cardRefIndex,
    mentionsOutsideCoverage,
    decodeListingFields,
    namedCategoryConstraint,
    LOCATION_HINTS,
    EMPTY_LINE,
    EMPTY_OUTSIDE_LINE,
    CUISINE_STYLES,
    nameLooksCafe
} = require('./search-query');
const { pickClarifyChips, mapListing } = require('./categories');
const { STRICT_COPY_TOKENS, copyTokensInText } = require('./copy-tokens');

const CHAT_LISTING_LIMIT = 8;
const CHAT_HISTORY_LIMIT = 16;
const CHAT_CONTENT_MAX = 2000;
const XAI_HOST = 'api.x.ai';
const XAI_PATH = '/v1/chat/completions';
const XAI_TIMEOUT_MS = 20000;
const DEFAULT_XAI_MODEL = 'grok-4.3';

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const SYSTEM_PROMPT_TEXT = 'You are asian.directory\'s conversational assistant for a SEA business directory (strongest in Laos: Vientiane, Luang Prabang; expanding Thailand, Vietnam, Cambodia). Warm, lightly local, polite, never pushy. Reply in 1–3 short sentences. No emojis unless the user used one. No hype (amazing, must-try, best in the world). Help people find real catalog businesses. Never invent listings, amenities, reviews, prices, hours, wifi, contact, or features. Use ONLY the listing JSON below (name, city, category, website). Do not read out phone numbers or email addresses. If asked for contact, say the listing card has the public details we have, and do not invent a number. Do not mention prices. If vague (e.g. "I\'m hungry", "what should I eat?") ask 1–2 clarifying questions (cuisine and city). Do not invent places. Hello: short welcome, ask eat/drink/stay/other + city. After search: one natural sentence reflecting intent; cards stay the star. Missing amenity: say "I don’t have that information for these places yet." Do not infer quieter or laptop-friendly from descriptions. Do not say best, #1, top-rated, or verified unless that exact claim is in the listing JSON. List matches; do not rank. Stay on directory purpose; politely decline unrelated asks. If they ask Tokyo/Seoul etc., say strongest coverage is SEA/Laos.';

const AMENITY_QUALITY_CUES = new Set([
    'wifi', 'hours', 'reviews', 'review', 'working', 'work', 'laptop', 'laptops',
    'family', 'families', 'kids', 'children',
    'parking', 'late', 'open'
]);
const PRICE_QUALITY_CUES = new Set(['cheaper', 'cheap', 'price', 'prices']);
const MORE_FOLLOW_UP_CUES = new Set(['others', 'another', 'more', 'else']);

const VAGUE_FOOD_TOKENS = new Set(['hungry', 'eat', 'food']);
const VAGUE_NEED_TOKENS = new Set(['hungry', 'eat', 'food', 'bored', 'help']);
const FOOD_DOMAIN_TOKENS = new Set([
    'coffee', 'cafe', 'cafes', 'restaurant', 'restaurants',
    'food', 'eat', 'hungry', 'sushi', 'japanese', 'ramen',
    'thai', 'lao', 'chinese', 'western', 'bakery', 'bar',
    'lunch', 'dinner', 'breakfast'
]);
const THIN_DESCRIPTION_RE = /\bis a public listing\b|^a public listing\.?$|^contact\s+(email|phone|us)\b/i;

const GREETING_REPLY = 'Welcome. Looking to eat, drink, stay, or something else — and in which city?';
const FOOD_CLARIFY_REPLY = 'What kind of food, and in which city?';
const NEED_CLARIFY_REPLY = 'What are you looking for, and in which city?';
const MISSING_AMENITY_REPLY = 'I don’t have that information for these places yet.';
const MISSING_PRICE_REPLY = 'I don’t have prices for these places yet.';
const NO_MORE_REPLY = 'I don’t have more listings in that city yet.';
const CITY_CLARIFY_REPLY = 'Which city?';
const OUTSIDE_COVERAGE_REPLY = 'Our strongest coverage is Southeast Asia and Laos — Vientiane and Luang Prabang especially.';
const LIST_NO_RANK_REPLY = 'I can list matches. I don’t pick a favorite or invent a reason.';
const GENERIC_NAME_TOKENS = new Set([
    'coffee', 'cafe', 'cafes', 'house', 'shop', 'shops',
    'company', 'ltd', 'limited', 'cooperative', 'co',
    'restaurant', 'restaurants', 'hotel', 'hotels'
]);

const CLARIFY_CHIPS = {
    greeting: ['Eat?', 'Coffee?', 'Vientiane?'],
    food: ['Coffee?', 'Restaurants?', 'Vientiane?'],
    need: ['Coffee?', 'Hotels?', 'Lawyers?'],
    city: ['Which city?']
};

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;
const RANKING_CLAIMS = [
    { re: /\btop-rated\b/gi, claim: 'top-rated' },
    { re: /\bverified\b/gi, claim: 'verified' },
    { re: /#1\b/g, claim: '#1' },
    { re: /\bbest\b/gi, claim: 'best' }
];

const CARD_LISTING_FIELDS = [
    'id',
    'name',
    'category',
    'taxonomy',
    'description',
    'address',
    'city',
    'country',
    'website',
    'phone',
    'socials'
];

const MODEL_LISTING_FIELDS = [
    'name',
    'city',
    'category',
    'website'
];

function getChatApiKey(env = process.env) {
    const raw = env.XAI_API_KEY || env.GROK_API_KEY || '';
    return typeof raw === 'string' ? raw.trim() : '';
}

function getChatModel(env = process.env) {
    const raw = env.XAI_MODEL || DEFAULT_XAI_MODEL;
    return typeof raw === 'string' && raw.trim() ? raw.trim() : DEFAULT_XAI_MODEL;
}

function sanitizeErrorMessage(err) {
    const text = String((err && err.message) || err || 'error');
    return text
        .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
        .replace(/xai-[A-Za-z0-9_-]+/gi, '[redacted]')
        .replace(/sk-[A-Za-z0-9_-]+/gi, '[redacted]');
}

function presentValue(value) {
    if (value == null) return false;
    if (typeof value === 'string') return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
}

function copyPresentFields(row, keys) {
    if (!row || typeof row !== 'object') return null;
    const out = {};
    for (const key of keys) {
        if (presentValue(row[key])) out[key] = row[key];
    }
    return Object.keys(out).length ? out : null;
}

/**
 * Homepage card row: public search fields only. Never add wifi/hours/reviews.
 */
function publicListing(row) {
    const decoded = decodeListingFields(row);
    const out = copyPresentFields(decoded, CARD_LISTING_FIELDS);
    if (!out) return out;
    if (!out.taxonomy) out.taxonomy = mapListing(decoded);
    return out;
}

/**
 * Spoken reply and model JSON must never include phone or email.
 */
function stripSpokenContact(text) {
    const cleaned = String(text || '')
        .replace(EMAIL_RE, '')
        .replace(PHONE_RE, '')
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([,.;:!?])/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return cleaned;
}

function listingJsonHasClaim(listings, claim) {
    const blob = JSON.stringify(listings || []).toLowerCase();
    return blob.includes(String(claim).toLowerCase());
}

function stripUnclaimedRanking(text, listings) {
    let out = String(text || '');
    for (const { re, claim } of RANKING_CLAIMS) {
        if (!listingJsonHasClaim(listings, claim)) {
            out = out.replace(re, '');
        }
    }
    return out
        .replace(/[ \t]{2,}/g, ' ')
        .replace(/[ \t]+([,.;:!?])/g, '$1')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function sanitizeSpokenReply(text, listings) {
    return stripSpokenContact(stripUnclaimedRanking(text, listings));
}

/**
 * Slim row for the model only: name, city, category, website.
 * No phone, email, address, hours, keywords, offerings, or description.
 */
function listingForModel(row) {
    const out = copyPresentFields(row, MODEL_LISTING_FIELDS);
    if (!out) return null;
    delete out.phone;
    delete out.email;
    delete out.alt_phone;
    delete out.address;
    delete out.description;
    delete out.keywords;
    delete out.special_offerings;
    delete out.business_hours;
    delete out.country;
    return out;
}

function isThinDescription(description) {
    const text = String(description || '').trim();
    if (!text) return true;
    if (THIN_DESCRIPTION_RE.test(text)) return true;
    return !stripSpokenContact(text);
}

function cardFactsReply(listing) {
    const name = String((listing && listing.name) || '').trim();
    const city = String((listing && listing.city) || '').trim();
    const website = String((listing && listing.website) || '').trim();
    if (!name) return 'That listing is on the card.';
    if (city && website) return `${name} is listed in ${city}. The card has the website.`;
    if (city) return `${name} is listed in ${city}.`;
    if (website) return `${name} is in the directory. The card has the website.`;
    return `${name} is in the directory.`;
}

/**
 * Speak about one already-shown card. Public description if it is not a
 * thin template; otherwise only name / city / website. Never notes, phone,
 * email, wifi, hours, or prices unless those exact words are already in
 * the public description.
 */
function specificCardReply(row) {
    const decoded = decodeListingFields(row) || {};
    const description = String(decoded.description || '').trim();
    if (description && !isThinDescription(description)) {
        const spoken = stripSpokenContact(description);
        return spoken.split(/(?<=[.!?])\s+/).filter(Boolean).slice(0, 2).join(' ');
    }
    return cardFactsReply(decoded);
}

function queryHasAmenityCue(query) {
    const text = String(query || '');
    if (/\bgood\s+for\b/i.test(text)) return true;
    return tokenize(text).some((token) => AMENITY_QUALITY_CUES.has(token));
}

function isCuisineAsk(query) {
    return (parseSearchQuery(query).contentTerms || []).some((term) => CUISINE_STYLES.has(term));
}

function isAmenityFollowUp(query) {
    const text = String(query || '');
    if (!queryHasAmenityCue(text)) return false;
    if (isCuisineAsk(text)) return false;
    if (isCardRefFollowUp(text) || /\bdoes\b[\s\S]+\bhave\b/i.test(text)) return true;
    if (namedCategoryConstraint(parseSearchQuery(text).contentTerms)) return false;
    return true;
}

function isPickOneAsk(query) {
    return /\bpick(\s+one)?\b/i.test(String(query || ''));
}

function isCompareAsk(query) {
    return /\b(over|vs\.?|versus|compared to)\b/i.test(String(query || ''));
}

function splitCompareNames(query) {
    const cleaned = String(query || '').replace(/^\s*why\s+/i, '').replace(/[?!.,]+$/g, '').trim();
    return cleaned
        .split(/\s+(?:over|vs\.?|versus|compared to)\s+/i)
        .map((part) => part.trim())
        .filter((part) => part.length > 2);
}

function listingNameKeyTokens(name) {
    return tokenize(name).filter((token) => (
        !STOPWORDS_NAME.has(token)
        && !GENERIC_NAME_TOKENS.has(token)
        && token.length > 2
    ));
}

const STOPWORDS_NAME = new Set(['the', 'and', 'of', 'for', 'in']);

function queryMentionsListing(query, listing) {
    const text = String(query || '').toLowerCase();
    const name = String((listing && listing.name) || '').trim();
    if (!name) return false;
    if (name.length >= 6 && text.includes(name.toLowerCase())) return true;
    const keys = listingNameKeyTokens(name);
    if (!keys.length) return false;
    const qTokens = new Set(tokenize(query));
    return keys.every((token) => qTokens.has(token));
}

function listingsNamedInQuery(query, listings) {
    return (listings || []).filter((row) => queryMentionsListing(query, row));
}

function looksSitDownCafe(row) {
    const mapped = mapListing(row);
    if (mapped && mapped.sub === 'cafe') return true;
    return nameLooksCafe(row);
}

function isSitDownCoffeeAsk(query) {
    return /\b(coffee\s+shop|coffee\s+house|cafes?|café|get coffee)\b/i.test(String(query || ''));
}

function preferSitDownCafes(rows, query) {
    const list = rows || [];
    if (!list.length || !isSitDownCoffeeAsk(query)) return list;
    const cafes = list.filter(looksSitDownCafe);
    const others = list.filter((row) => !looksSitDownCafe(row));
    if (cafes.length && others.length) return cafes;
    return list;
}

function historyHasCity(turns) {
    return (turns || []).some((turn) => tokenize(turn).some((token) => LOCATION_HINTS.has(token)));
}

function isRedundantCityFollowUp(latest, historyTurns) {
    if (!(historyTurns || []).length) return false;
    const cities = tokenize(latest).filter((token) => LOCATION_HINTS.has(token));
    if (!cities.length) return false;
    const parsed = parseSearchQuery(latest);
    const extra = (parsed.contentTerms || []).filter((term) => !LOCATION_HINTS.has(term));
    if (extra.length) return false;
    return cities.every((city) => historyTurns.some((turn) => tokenize(turn).includes(city)));
}

function emptyCuisineReply(query) {
    const cuisine = (parseSearchQuery(query).contentTerms || []).find((term) => CUISINE_STYLES.has(term));
    if (cuisine) return `Nothing in the directory for ${cuisine} yet.`;
    return EMPTY_LINE;
}

function compareReply(listings) {
    const names = (listings || []).map((row) => String((row && row.name) || '').trim()).filter(Boolean);
    const city = (listings || []).map((row) => String((row && row.city) || '').trim()).find(Boolean) || '';
    if (names.length >= 2 && city) {
        return `${names.join(' and ')} are both listed in ${city}. I don’t rank them.`;
    }
    if (names.length >= 2) {
        return `${names.join(' and ')} are both in the directory. I don’t rank them.`;
    }
    return LIST_NO_RANK_REPLY;
}

function pickOneReply({ listings, templateReply, shown }) {
    if ((listings || []).length === 1 && shown && shown[0]) {
        return specificCardReply(shown[0]);
    }
    const base = String(templateReply || '').replace(TOO_MANY_LINE_RE, '').trim();
    const line = base || 'Here are matches.';
    if (/don’t pick a favorite|do not pick/i.test(line)) return line;
    return `${line} I don’t pick a favorite or invent a reason.`;
}

const TOO_MANY_LINE_RE = /Too many matches\. Showing a few\./gi;

function isPriceFollowUp(query) {
    const text = String(query || '');
    if (namedCategoryConstraint(parseSearchQuery(text).contentTerms)) return false;
    return tokenize(text).some((token) => PRICE_QUALITY_CUES.has(token));
}

function isMoreFollowUp(query) {
    const text = String(query || '');
    if (namedCategoryConstraint(parseSearchQuery(text).contentTerms)) return false;
    const tokens = tokenize(text);
    if (!tokens.some((token) => MORE_FOLLOW_UP_CUES.has(token))) return false;
    return isFollowUp(text);
}

function isRefinementTurn(turn) {
    return isAmenityFollowUp(turn)
        || isPriceFollowUp(turn)
        || isMoreFollowUp(turn)
        || isCardRefFollowUp(turn)
        || isCompareAsk(turn);
}

function lastSpecifiedQuery(historyTurns) {
    for (let i = (historyTurns || []).length - 1; i >= 0; i--) {
        const turn = historyTurns[i];
        // Amenity / price / "any others?" / "the first one" refine the current set.
        if (isRefinementTurn(turn)) continue;
        if (detectClarifyKind(turn) === 'food' || detectClarifyKind(turn) === 'need') continue;
        const parsed = parseSearchQuery(turn);
        if (!parsed.isEmpty) return String(turn || '').trim();
    }
    return '';
}

function isDeadEndAssistantReply(text) {
    const reply = String(text || '').trim();
    return reply === EMPTY_LINE
        || reply === EMPTY_OUTSIDE_LINE
        || reply === FOOD_CLARIFY_REPLY
        || reply === NEED_CLARIFY_REPLY
        || reply === GREETING_REPLY
        || reply === CITY_CLARIFY_REPLY
        || reply === OUTSIDE_COVERAGE_REPLY
        || /^Nothing in the directory for .+ yet\.$/i.test(reply);
}

function lastSuccessfulSpecifiedQuery(messages) {
    const list = messages || [];
    for (let i = list.length - 1; i >= 0; i--) {
        const msg = list[i];
        if (!msg || msg.role !== 'user') continue;
        const turn = String(msg.content || '').trim();
        if (!turn || isRefinementTurn(turn)) continue;
        if (detectClarifyKind(turn) === 'food' || detectClarifyKind(turn) === 'need') continue;
        const parsed = parseSearchQuery(turn);
        if (parsed.isEmpty) continue;
        const following = list.slice(i + 1).find((item) => item && item.role === 'assistant');
        if (following && isDeadEndAssistantReply(following.content)) continue;
        return turn;
    }
    return '';
}

function moreFollowUpOffset(latest, historyTurns) {
    if (!isMoreFollowUp(latest)) return 0;
    const priorMores = (historyTurns || []).filter((turn) => isMoreFollowUp(turn)).length;
    return (priorMores + 1) * CHAT_LISTING_LIMIT;
}

function needsCityClarify(query) {
    const tokens = tokenize(query);
    if (tokens.some((token) => LOCATION_HINTS.has(token))) return false;
    const parsed = parseSearchQuery(query);
    if (namedCategoryConstraint(parsed.contentTerms)) return false;
    if (parsed.contentTerms.some((term) => !AMENITY_QUALITY_CUES.has(term) && !PRICE_QUALITY_CUES.has(term))) {
        return false;
    }
    if (/\bnear\s+me\b/i.test(String(query || ''))) return true;
    if (isFollowUp(query) && parsed.isEmpty) return true;
    return false;
}

function requestedStrictCopyTokens(query) {
    return copyTokensInText(query).filter((token) => STRICT_COPY_TOKENS.has(token));
}

function isGreetingTurn(query) {
    if (isGreeting(query)) return true;
    const text = String(query || '').trim().toLowerCase();
    return /^(good\s+)?(morning|afternoon|evening|day)[.!?]*$/.test(text);
}

function detectClarifyKind(query) {
    if (isGreetingTurn(query)) return 'greeting';

    const text = String(query || '').trim().toLowerCase();
    if (
        /\bwhat should i eat\b/.test(text)
        || /\bwhat to eat\b/.test(text)
        || /\b(i['’]?m|i am)\s+hungry\b/.test(text)
        || /\bwhere (can|should|do) i (eat|go)\b/.test(text)
    ) {
        return 'food';
    }
    if (/^(please\s+)?help(\s+me)?[.!?]*$/.test(text)) return 'need';

    const tokens = tokenize(text);
    const terms = parseSearchQuery(query).contentTerms || [];

    if (terms.length && terms.every((term) => VAGUE_NEED_TOKENS.has(term))) {
        return terms.some((term) => VAGUE_FOOD_TOKENS.has(term)) ? 'food' : 'need';
    }

    if (!terms.length) {
        if (tokens.some((token) => VAGUE_FOOD_TOKENS.has(token))) return 'food';
        if (tokens.some((token) => VAGUE_NEED_TOKENS.has(token))) return 'need';
    }

    if (needsCityClarify(query)) return 'city';
    return null;
}

function isFoodDomainTurn(turn) {
    if (detectClarifyKind(turn) === 'food') return true;
    const tokens = tokenize(turn);
    const terms = parseSearchQuery(turn).contentTerms || [];
    return terms.some((term) => FOOD_DOMAIN_TOKENS.has(term))
        || tokens.some((token) => FOOD_DOMAIN_TOKENS.has(token));
}

function isFoodThreadFollowUp(latest, historyTurns) {
    if (!(historyTurns || []).length) return false;
    if (detectClarifyKind(latest) !== 'food') return false;
    return historyTurns.some(isFoodDomainTurn);
}

function shouldClarify(latest, historyTurns) {
    if ((historyTurns || []).length && (
        isAmenityFollowUp(latest)
        || isPriceFollowUp(latest)
        || isCardRefFollowUp(latest)
        || isCompareAsk(latest)
        || isPickOneAsk(latest)
        || isRedundantCityFollowUp(latest, historyTurns)
    )) {
        return null;
    }
    if ((historyTurns || []).length && isFollowUp(latest)) return null;
    if (isFoodThreadFollowUp(latest, historyTurns)) return null;
    if (historyHasCity(historyTurns) && needsCityClarify(latest)) return null;
    if (needsCityClarify(latest)) return 'city';
    if (isAmenityFollowUp(latest)) return null;
    return detectClarifyKind(latest);
}

function clarifyReply(kind) {
    if (kind === 'greeting') return GREETING_REPLY;
    if (kind === 'food') return FOOD_CLARIFY_REPLY;
    if (kind === 'city') return CITY_CLARIFY_REPLY;
    return NEED_CLARIFY_REPLY;
}

function clarifyChips(kind) {
    return (CLARIFY_CHIPS[kind] || CLARIFY_CHIPS.need).slice();
}

async function clarifyChipsForRequest(kind, searchBusinesses) {
    if (kind === 'city') return clarifyChips('city');
    const chips = await pickClarifyChips(kind, { searchBusinesses });
    return chips.length ? chips : clarifyChips(kind);
}

function logChatResult({ mode, query, n }) {
    const q = String(query || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    console.log(`chat mode=${mode} query=${q} n=${n}`);
}

/**
 * Conversation analytics may store the user query and listing ids/cards.
 * Spoken `reply` is dropped so it cannot land in description, keywords, or HTML.
 */
function omitChatReplyFromLog(body) {
    const src = body && typeof body === 'object' ? body : {};
    const userQuery = String(src.userQuery || '').trim();
    const businessIds = Array.isArray(src.businessIds) ? src.businessIds : [];
    const aiResponse = Array.isArray(src.aiResponse)
        ? src.aiResponse.map((row) => {
            if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
            const copy = { ...row };
            delete copy.reply;
            return copy;
        })
        : [];
    return { userQuery, aiResponse, businessIds };
}

function normalizeMessages(raw) {
    if (!Array.isArray(raw)) {
        return { ok: false, error: 'messages must be an array' };
    }
    const messages = [];
    for (const item of raw) {
        if (!item || typeof item !== 'object') continue;
        const role = String(item.role || '').trim().toLowerCase();
        if (!ALLOWED_ROLES.has(role)) continue;
        const content = String(item.content || '').trim();
        if (!content) continue;
        messages.push({
            role,
            content: content.slice(0, CHAT_CONTENT_MAX)
        });
    }
    if (!messages.some((msg) => msg.role === 'user')) {
        return { ok: false, error: 'messages must include a user turn' };
    }
    return { ok: true, messages: messages.slice(-CHAT_HISTORY_LIMIT) };
}

function userTurns(messages) {
    return (messages || [])
        .filter((msg) => msg && msg.role === 'user')
        .map((msg) => msg.content);
}

function latestUserText(messages) {
    const turns = userTurns(messages);
    return turns.length ? turns[turns.length - 1] : '';
}

function searchQueryFromMessages(messages) {
    const turns = userTurns(messages);
    const latest = turns[turns.length - 1] || '';
    return reformulateWithHistory(latest, turns.slice(0, -1));
}

function normalizeLocale(locale) {
    const text = String(locale || '').trim().slice(0, 16);
    return text || 'en';
}

function buildSystemPrompt({ listings }) {
    const rows = Array.isArray(listings) ? listings : [];
    return `${SYSTEM_PROMPT_TEXT}\n${JSON.stringify(rows)}`;
}

function postXaiChat({ apiKey, body, requestFn }) {
    if (typeof requestFn === 'function') {
        return requestFn({ apiKey, body });
    }

    const payload = JSON.stringify(body);
    return new Promise((resolve, reject) => {
        const req = https.request({
            hostname: XAI_HOST,
            path: XAI_PATH,
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'Content-Length': Buffer.byteLength(payload)
            },
            timeout: XAI_TIMEOUT_MS
        }, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const text = Buffer.concat(chunks).toString('utf8');
                if (res.statusCode < 200 || res.statusCode >= 300) {
                    return reject(new Error(`xAI HTTP ${res.statusCode}`));
                }
                let json;
                try {
                    json = JSON.parse(text);
                } catch {
                    return reject(new Error('xAI invalid JSON'));
                }
                const content = json
                    && json.choices
                    && json.choices[0]
                    && json.choices[0].message
                    && json.choices[0].message.content;
                if (!content || typeof content !== 'string' || !content.trim()) {
                    return reject(new Error('xAI empty reply'));
                }
                resolve(content.trim());
            });
        });
        req.on('timeout', () => {
            req.destroy();
            reject(new Error('xAI timeout'));
        });
        req.on('error', () => reject(new Error('xAI network error')));
        req.write(payload);
        req.end();
    });
}

async function completeWithXai({ messages, listings, locale, apiKey, model, requestFn }) {
    const body = {
        model: model || DEFAULT_XAI_MODEL,
        temperature: 0.3,
        max_tokens: 400,
        reasoning_effort: 'none',
        messages: [
            { role: 'system', content: buildSystemPrompt({ listings, locale }) },
            ...messages
        ]
    };
    return postXaiChat({ apiKey, body, requestFn });
}

function searchPayload({ query, parsed, listings, truncated, retried, threadHasCity }) {
    const reply = buildAssistantLine({
        query,
        parsed,
        results: listings,
        truncated,
        retried
    });
    const chips = buildFollowUpChips({
        parsed,
        results: listings,
        threadHasCity,
        canAnswerHours: false
    });
    return { reply, chips };
}

async function handleChatRequest({
    messages,
    locale,
    searchBusinesses,
    env = process.env,
    completeChat
} = {}) {
    const normalized = normalizeMessages(messages);
    if (!normalized.ok) {
        return { status: 400, body: { success: false, error: normalized.error } };
    }

    const latest = latestUserText(normalized.messages);
    const historyTurns = userTurns(normalized.messages).slice(0, -1);
    const clarifyKind = shouldClarify(latest, historyTurns);

    if (clarifyKind) {
        const chips = await clarifyChipsForRequest(clarifyKind, searchBusinesses);
        const spoken = sanitizeSpokenReply(clarifyReply(clarifyKind), []);
        logChatResult({ mode: 'clarify', query: latest, n: 0 });
        return {
            status: 200,
            body: {
                success: true,
                mode: 'clarify',
                reply: spoken,
                listings: [],
                chips,
                query: latest
            }
        };
    }

    const amenityFollowUp = isAmenityFollowUp(latest);
    const priceFollowUp = isPriceFollowUp(latest);
    const moreFollowUp = isMoreFollowUp(latest);
    const cardRefFollowUp = isCardRefFollowUp(latest);
    const foodThreadFollowUp = isFoodThreadFollowUp(latest, historyTurns);
    const compareAsk = isCompareAsk(latest);
    const pickOneAsk = isPickOneAsk(latest);
    const redundantCity = isRedundantCityFollowUp(latest, historyTurns);
    const threadCityLocked = historyHasCity(historyTurns) || tokenize(latest).some((token) => LOCATION_HINTS.has(token));
    const keepPriorListings = (
        amenityFollowUp
        || priceFollowUp
        || moreFollowUp
        || cardRefFollowUp
        || foodThreadFollowUp
        || compareAsk
        || redundantCity
    ) && historyTurns.length > 0;
    let query = searchQueryFromMessages(normalized.messages);
    if (keepPriorListings) {
        const prior = lastSuccessfulSpecifiedQuery(normalized.messages) || lastSpecifiedQuery(historyTurns);
        if (prior) query = prior;
    }
    let parsed = parseSearchQuery(query);
    let all = [];
    try {
        all = await Promise.resolve(searchBusinesses(query));
        if (!Array.isArray(all)) all = [];
    } catch (err) {
        console.error('Chat search failed:', sanitizeErrorMessage(err));
        all = [];
    }

    if (keepPriorListings && !all.length) {
        const prior = lastSpecifiedQuery(historyTurns);
        if (prior && prior !== query) {
            try {
                const fallback = await Promise.resolve(searchBusinesses(prior));
                if (Array.isArray(fallback) && fallback.length) {
                    query = prior;
                    parsed = parseSearchQuery(prior);
                    all = fallback;
                }
            } catch {
                // Keep the empty first result.
            }
        }
    }

    if (compareAsk) {
        const namedFromAll = listingsNamedInQuery(latest, all);
        if (namedFromAll.length >= 2) {
            all = namedFromAll;
        } else if (typeof searchBusinesses === 'function') {
            const collected = [];
            const seen = new Set();
            for (const name of splitCompareNames(latest)) {
                try {
                    const rows = await Promise.resolve(searchBusinesses(name));
                    for (const row of (Array.isArray(rows) ? rows : [])) {
                        const key = String((row && (row.id || row.name)) || '');
                        if (!key || seen.has(key)) continue;
                        if (!queryMentionsListing(name, row) && !queryMentionsListing(latest, row)) continue;
                        seen.add(key);
                        collected.push(row);
                    }
                } catch {
                    // Skip a failed name search.
                }
            }
            if (collected.length) all = collected;
        }
        if (threadCityLocked) {
            const locked = tokenize([latest, ...historyTurns].join(' ')).filter((token) => LOCATION_HINTS.has(token));
            if (locked.length) {
                const kept = all.filter((row) => {
                    const city = String((row && row.city) || '').toLowerCase();
                    return locked.some((token) => city.includes(token));
                });
                if (kept.length) all = kept;
            }
        }
    } else if (!compareAsk) {
        all = preferSitDownCafes(all, keepPriorListings ? query : latest);
    }

    const namedShown = listingsNamedInQuery(latest, all);
    if (namedShown.length && (amenityFollowUp || cardRefFollowUp || compareAsk)) {
        all = namedShown;
    } else if (amenityFollowUp && cardRefFollowUp && all.length) {
        const idx = Math.max(0, cardRefIndex(latest, Math.min(all.length, CHAT_LISTING_LIMIT)));
        all = [all[idx]].filter(Boolean);
    }

    const offset = moreFollowUp ? moreFollowUpOffset(latest, historyTurns) : 0;
    const pageRows = all.slice(offset, offset + CHAT_LISTING_LIMIT);
    const noMoreInCity = moreFollowUp && !pageRows.length;
    let shown = noMoreInCity ? all.slice(0, CHAT_LISTING_LIMIT) : pageRows;
    const truncated = !moreFollowUp && !pickOneAsk && !compareAsk && !redundantCity && all.length > CHAT_LISTING_LIMIT;
    const listings = shown.map(publicListing).filter(Boolean);
    const modelListings = listings.map(listingForModel).filter(Boolean);
    const template = searchPayload({
        query,
        parsed,
        listings,
        truncated,
        retried: false,
        threadHasCity: threadCityLocked
    });
    const safeLocale = normalizeLocale(locale);
    const cardReply = cardRefFollowUp && shown.length && !amenityFollowUp
        ? specificCardReply(namedShown.length ? namedShown[0] : shown[Math.max(0, cardRefIndex(latest, shown.length))])
        : '';
    const searchReply = priceFollowUp
        ? MISSING_PRICE_REPLY
        : (amenityFollowUp
            ? MISSING_AMENITY_REPLY
            : (compareAsk && listings.length
                ? compareReply(listings)
                : (pickOneAsk && listings.length
                    ? pickOneReply({ listings, templateReply: template.reply, shown })
                    : (cardReply
                        ? cardReply
                        : (noMoreInCity
                            ? NO_MORE_REPLY
                            : (!listings.length
                                ? (mentionsOutsideCoverage(query || latest)
                                    ? OUTSIDE_COVERAGE_REPLY
                                    : emptyCuisineReply(latest || query))
                                : template.reply))))));

    const respond = (mode, reply) => {
        const spoken = sanitizeSpokenReply(reply, modelListings);
        logChatResult({ mode, query, n: listings.length });
        return {
            status: 200,
            body: {
                success: true,
                mode,
                reply: spoken,
                listings,
                chips: Array.from(new Set(template.chips || [])),
                query
            }
        };
    };

    const apiKey = getChatApiKey(env);
    if (!apiKey || amenityFollowUp || priceFollowUp || cardRefFollowUp || compareAsk || pickOneAsk || !modelListings.length) {
        return respond('search', searchReply);
    }

    try {
        const complete = completeChat || completeWithXai;
        const reply = await complete({
            messages: normalized.messages,
            listings: modelListings,
            locale: safeLocale,
            apiKey,
            model: getChatModel(env)
        });
        const text = String(reply || '').trim();
        if (!text) throw new Error('empty reply');
        return respond('llm', text);
    } catch (err) {
        console.error('Chat provider failed:', sanitizeErrorMessage(err));
        return respond('search', searchReply);
    }
}

module.exports = {
    CHAT_LISTING_LIMIT,
    CHAT_HISTORY_LIMIT,
    DEFAULT_XAI_MODEL,
    SYSTEM_PROMPT_TEXT,
    AMENITY_QUALITY_CUES,
    PRICE_QUALITY_CUES,
    MORE_FOLLOW_UP_CUES,
    getChatApiKey,
    getChatModel,
    sanitizeErrorMessage,
    publicListing,
    listingForModel,
    stripSpokenContact,
    stripUnclaimedRanking,
    sanitizeSpokenReply,
    logChatResult,
    omitChatReplyFromLog,
    normalizeMessages,
    userTurns,
    latestUserText,
    searchQueryFromMessages,
    isAmenityFollowUp,
    isPriceFollowUp,
    isMoreFollowUp,
    isCardRefFollowUp,
    cardRefIndex,
    isThinDescription,
    specificCardReply,
    isCompareAsk,
    isPickOneAsk,
    listingsNamedInQuery,
    preferSitDownCafes,
    lastSpecifiedQuery,
    lastSuccessfulSpecifiedQuery,
    LIST_NO_RANK_REPLY,
    moreFollowUpOffset,
    needsCityClarify,
    requestedStrictCopyTokens,
    isGreetingTurn,
    detectClarifyKind,
    shouldClarify,
    clarifyReply,
    clarifyChips,
    clarifyChipsForRequest,
    GREETING_REPLY,
    FOOD_CLARIFY_REPLY,
    NEED_CLARIFY_REPLY,
    MISSING_AMENITY_REPLY,
    MISSING_PRICE_REPLY,
    NO_MORE_REPLY,
    CITY_CLARIFY_REPLY,
    OUTSIDE_COVERAGE_REPLY,
    VAGUE_NEED_TOKENS,
    buildSystemPrompt,
    completeWithXai,
    handleChatRequest
};
