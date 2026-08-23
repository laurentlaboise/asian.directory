'use strict';

/**
 * Homepage conversational layer.
 *
 * Search still comes from search-query.js + searchBusinesses.
 * If XAI_API_KEY (or GROK_API_KEY) is set, a short Grok reply is written
 * from the listing JSON only. Missing fields stay missing — no invented
 * wifi, hours, CEOs, or reviews.
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
    buildFollowUpChips
} = require('./search-query');

const CHAT_LISTING_LIMIT = 8;
const CHAT_HISTORY_LIMIT = 8;
const CHAT_CONTENT_MAX = 2000;
const XAI_HOST = 'api.x.ai';
const XAI_PATH = '/v1/chat/completions';
const XAI_TIMEOUT_MS = 20000;
const DEFAULT_XAI_MODEL = 'grok-4.3';

const ALLOWED_ROLES = new Set(['user', 'assistant']);
const MODEL_DESC_MAX = 200;
const SYSTEM_PROMPT_TEXT = 'You are a helpful local-business assistant for asian.directory. Reply in 1–3 short sentences using ONLY the listing data provided below. Never invent businesses, amenities, hours, wifi, reviews, prices, or any other detail. If the user asks about something that is not present in the data, say we do not have that information. Be natural and concise. Do not read out phone numbers or email addresses. If asked for contact, say the listing card has the public details we have, and do not invent a number. Do not mention prices.';

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_RE = /(?:\+?\d[\d\s().-]{6,}\d)/g;

const CARD_LISTING_FIELDS = [
    'id',
    'name',
    'category',
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
    'category',
    'city',
    'country',
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
    return copyPresentFields(row, CARD_LISTING_FIELDS);
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

/**
 * Slim row for the model only. Description is a 200-char snippet.
 * No phone, address, hours, offerings, keywords, or contact strings.
 */
function listingForModel(row) {
    const out = copyPresentFields(row, MODEL_LISTING_FIELDS);
    if (!out) return null;
    delete out.phone;
    delete out.email;
    delete out.alt_phone;
    if (presentValue(row.description)) {
        const text = stripSpokenContact(String(row.description).trim());
        if (text) {
            out.description = text.length > MODEL_DESC_MAX ? text.slice(0, MODEL_DESC_MAX) : text;
        }
    }
    return out;
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

    const query = searchQueryFromMessages(normalized.messages);
    const parsed = parseSearchQuery(query);
    let all = [];
    try {
        all = await Promise.resolve(searchBusinesses(query));
        if (!Array.isArray(all)) all = [];
    } catch (err) {
        console.error('Chat search failed:', sanitizeErrorMessage(err));
        all = [];
    }

    const truncated = all.length > CHAT_LISTING_LIMIT;
    const listings = all.slice(0, CHAT_LISTING_LIMIT).map(publicListing).filter(Boolean);
    const modelListings = listings.map(listingForModel).filter(Boolean);
    const template = searchPayload({ query, parsed, listings, truncated, retried: false });
    const safeLocale = normalizeLocale(locale);

    const respond = (mode, reply) => {
        logChatResult({ mode, query, n: listings.length });
        return {
            status: 200,
            body: {
                success: true,
                mode,
                reply,
                listings,
                chips: template.chips,
                query
            }
        };
    };

    const apiKey = getChatApiKey(env);
    if (!apiKey) {
        return respond('search', template.reply);
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
        const text = stripSpokenContact(String(reply || '').trim());
        if (!text) throw new Error('empty reply');
        return respond('llm', text);
    } catch (err) {
        console.error('Chat provider failed:', sanitizeErrorMessage(err));
        return respond('search', template.reply);
    }
}

module.exports = {
    CHAT_LISTING_LIMIT,
    CHAT_HISTORY_LIMIT,
    DEFAULT_XAI_MODEL,
    SYSTEM_PROMPT_TEXT,
    MODEL_DESC_MAX,
    getChatApiKey,
    getChatModel,
    sanitizeErrorMessage,
    publicListing,
    listingForModel,
    stripSpokenContact,
    logChatResult,
    omitChatReplyFromLog,
    normalizeMessages,
    userTurns,
    latestUserText,
    searchQueryFromMessages,
    buildSystemPrompt,
    completeWithXai,
    handleChatRequest
};
