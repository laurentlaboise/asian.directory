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
    mentionsOutsideCoverage,
    decodeListingFields,
    namedCategoryConstraint,
    LOCATION_HINTS
} = require('./search-query');
const { pickClarifyChips, mapListing } = require('./categories');
const { STRICT_COPY_TOKENS, copyTokensInText } = require('./copy-tokens');

const CHAT_LISTING_LIMIT = 8;
const CHAT_HISTORY_LIMIT = 8;
const CHAT_CONTENT_MAX = 2000;
const XAI_HOST = 'api.x.ai';
const XAI_PATH = '/v1/chat/completions';
const XAI_TIMEOUT_MS = 20000;
const DEFAULT_XAI_MODEL = 'grok-4.3';

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const SYSTEM_PROMPT_TEXT = 'You are asian.directory\'s conversational assistant for a SEA business directory (strongest in Laos: Vientiane, Luang Prabang; expanding Thailand, Vietnam, Cambodia). Warm, lightly local, polite, never pushy. Reply in 1–3 short sentences. No emojis unless the user used one. No hype (amazing, must-try, best in the world). Help people find real catalog businesses. Never invent listings, amenities, reviews, prices, hours, wifi, contact, or features. Use ONLY the listing JSON below (name, city, category, website). Do not read out phone numbers or email addresses. If asked for contact, say the listing card has the public details we have, and do not invent a number. Do not mention prices. If vague (e.g. "I\'m hungry", "what should I eat?") ask 1–2 clarifying questions (cuisine and city). Do not invent places. Hello: short welcome, ask eat/drink/stay/other + city. After search: one natural sentence reflecting intent; cards stay the star. Missing amenity: say "I don’t have that information for these places yet." Do not infer quieter or laptop-friendly from descriptions. Do not say best, #1, top-rated, or verified unless that exact claim is in the listing JSON. List matches; do not rank. Stay on directory purpose; politely decline unrelated asks. If they ask Tokyo/Seoul etc., say strongest coverage is SEA/Laos.';

const AMENITY_QUALITY_CUES = new Set([
    'wifi', 'hours', 'reviews', 'review', 'working', 'work', 'laptop', 'laptops',
    'family', 'families', 'kids', 'children'
]);
const PRICE_QUALITY_CUES = new Set(['cheaper', 'cheap', 'price', 'prices']);

const VAGUE_FOOD_TOKENS = new Set(['hungry', 'eat', 'food']);
const VAGUE_NEED_TOKENS = new Set(['hungry', 'eat', 'food', 'bored', 'help']);

const GREETING_REPLY = 'Welcome. Looking to eat, drink, stay, or something else — and in which city?';
const FOOD_CLARIFY_REPLY = 'What kind of food, and in which city?';
const NEED_CLARIFY_REPLY = 'What are you looking for, and in which city?';
const MISSING_AMENITY_REPLY = 'I don’t have that information for these places yet.';
const MISSING_PRICE_REPLY = 'I don’t have prices for these places yet.';
const CITY_CLARIFY_REPLY = 'Which city?';
const OUTSIDE_COVERAGE_REPLY = 'Our strongest coverage is Southeast Asia and Laos — Vientiane and Luang Prabang especially.';

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

function isAmenityFollowUp(query) {
    const text = String(query || '');
    if (namedCategoryConstraint(parseSearchQuery(text).contentTerms)) return false;
    if (/\bgood\s+for\b/i.test(text)) return true;
    return tokenize(text).some((token) => AMENITY_QUALITY_CUES.has(token));
}

function isPriceFollowUp(query) {
    const text = String(query || '');
    if (namedCategoryConstraint(parseSearchQuery(text).contentTerms)) return false;
    return tokenize(text).some((token) => PRICE_QUALITY_CUES.has(token));
}

function lastSpecifiedQuery(historyTurns) {
    for (let i = (historyTurns || []).length - 1; i >= 0; i--) {
        const turn = historyTurns[i];
        const parsed = parseSearchQuery(turn);
        if (!parsed.isEmpty) return String(turn || '').trim();
    }
    return '';
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

function shouldClarify(latest, historyTurns) {
    if ((historyTurns || []).length && (isAmenityFollowUp(latest) || isPriceFollowUp(latest))) {
        return null;
    }
    if ((historyTurns || []).length && isFollowUp(latest)) return null;
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

function searchPayload({ query, parsed, listings, truncated, retried }) {
    const reply = buildAssistantLine({
        query,
        parsed,
        results: listings,
        truncated,
        retried
    });
    const chips = buildFollowUpChips({ parsed, results: listings });
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
    const keepPriorListings = (amenityFollowUp || priceFollowUp) && historyTurns.length > 0;
    let query = searchQueryFromMessages(normalized.messages);
    if (keepPriorListings) {
        const prior = lastSpecifiedQuery(historyTurns);
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

    const truncated = all.length > CHAT_LISTING_LIMIT;
    const listings = all.slice(0, CHAT_LISTING_LIMIT).map(publicListing).filter(Boolean);
    const modelListings = listings.map(listingForModel).filter(Boolean);
    const template = searchPayload({ query, parsed, listings, truncated, retried: false });
    const safeLocale = normalizeLocale(locale);
    const searchReply = priceFollowUp
        ? MISSING_PRICE_REPLY
        : (amenityFollowUp
            ? MISSING_AMENITY_REPLY
            : (!listings.length && mentionsOutsideCoverage(query || latest)
                ? OUTSIDE_COVERAGE_REPLY
                : template.reply));

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
                chips: template.chips,
                query
            }
        };
    };

    const apiKey = getChatApiKey(env);
    if (!apiKey || amenityFollowUp || priceFollowUp || !modelListings.length) {
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
    lastSpecifiedQuery,
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
    CITY_CLARIFY_REPLY,
    OUTSIDE_COVERAGE_REPLY,
    VAGUE_NEED_TOKENS,
    buildSystemPrompt,
    completeWithXai,
    handleChatRequest
};
