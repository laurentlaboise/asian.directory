'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    CHAT_LISTING_LIMIT,
    DEFAULT_XAI_MODEL,
    getChatApiKey,
    getChatModel,
    sanitizeErrorMessage,
    publicListing,
    normalizeMessages,
    searchQueryFromMessages,
    buildSystemPrompt,
    handleChatRequest
} = require('./chat');
const { GREETING_LINE } = require('./search-query');

const VANMAI_COFFEE = {
    id: 1725,
    name: 'Vanmai Coffee Cooperative',
    category: 'Services',
    description: 'Vanmai Coffee Cooperative is a public listing from https://www.laoscoffee.org/coffeeplayers.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false,
    notes: 'internal crm note',
    pipeline_stage: 'active_listing',
    email: 'hidden@example.com'
};

const YUNI_COFFEE = {
    id: 1669,
    name: 'Yuni Coffee Company, Ltd.',
    category: 'Business Services',
    description: 'Contact email: sales@yunicoffeeco.com',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    phone: '+856 20 0000',
    website: 'https://yunicoffeeco.com',
    keywords: ['coffee'],
    status: 'active'
};

test('publicListing copies existing fields only and never invents wifi or hours', () => {
    const row = publicListing(VANMAI_COFFEE);
    assert.equal(row.name, 'Vanmai Coffee Cooperative');
    assert.equal(row.city, 'Vientiane');
    assert.equal(row.wifi, undefined);
    assert.equal(row.business_hours, undefined);
    assert.equal(row.reviews, undefined);
    assert.equal(row.ceo, undefined);
    assert.equal(row.notes, undefined);
    assert.equal(row.email, undefined);
    assert.equal(row.pipeline_stage, undefined);
    assert.ok(!('phone' in row));

    const withHours = publicListing({
        ...YUNI_COFFEE,
        business_hours: { mon: '8-17' },
        special_offerings: ['beans']
    });
    assert.deepEqual(withHours.business_hours, { mon: '8-17' });
    assert.deepEqual(withHours.special_offerings, ['beans']);
    assert.equal(withHours.wifi, undefined);
});

test('normalizeMessages keeps last 8 user/assistant turns and drops system', () => {
    const padded = [];
    for (let i = 0; i < 10; i++) {
        padded.push({ role: 'user', content: `u${i}` });
        padded.push({ role: 'assistant', content: `a${i}` });
    }
    padded.push({ role: 'system', content: 'ignore me' });
    const { ok, messages } = normalizeMessages(padded);
    assert.equal(ok, true);
    assert.equal(messages.length, 8);
    assert.ok(messages.every((msg) => msg.role === 'user' || msg.role === 'assistant'));
    assert.equal(messages[0].content, 'u6');

    assert.equal(normalizeMessages('hello').ok, false);
    assert.equal(normalizeMessages([{ role: 'assistant', content: 'hi' }]).ok, false);
});

test('follow-ups reuse prior city and category for search', () => {
    assert.equal(
        searchQueryFromMessages([
            { role: 'user', content: 'best coffee places' },
            { role: 'assistant', content: 'Here are coffee spots.' },
            { role: 'user', content: 'which is good for working?' }
        ]),
        'which is good for working? coffee'
    );
    assert.equal(
        searchQueryFromMessages([
            { role: 'user', content: 'best coffee places' },
            { role: 'user', content: 'do they have wifi?' }
        ]),
        'do they have wifi? coffee'
    );
    assert.equal(
        searchQueryFromMessages([
            { role: 'user', content: 'best coffee places' },
            { role: 'user', content: 'in Vientiane only' }
        ]),
        'in Vientiane only coffee'
    );
});

test('no API key returns honest search-mode template and listings', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'best coffee places' }],
        locale: 'en',
        env: {},
        searchBusinesses: async () => [VANMAI_COFFEE, YUNI_COFFEE]
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, 'Here are coffee spots in Vientiane.');
    assert.equal(result.body.listings.length, 2);
    assert.equal(result.body.listings[0].name, 'Vanmai Coffee Cooperative');
    assert.equal(result.body.listings[0].wifi, undefined);
    assert.ok(!JSON.stringify(result.body).includes('xai-'));
    assert.ok(!JSON.stringify(result.body).includes('API_KEY'));
});

test('hello without a key uses the greeting template and does not invent listings', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'hello' }],
        env: {},
        searchBusinesses: async (query) => {
            assert.equal(query, 'hello');
            return [];
        }
    });
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, GREETING_LINE);
    assert.deepEqual(result.body.listings, []);
});

test('with a key, Grok reply is used and the key is never returned', async () => {
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'best coffee places' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'which is good for working?' }
        ],
        locale: 'en',
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async (query) => {
            assert.match(query, /coffee/);
            return [VANMAI_COFFEE, YUNI_COFFEE];
        },
        completeChat: async ({ listings, apiKey }) => {
            assert.equal(apiKey, 'xai-secret-test-key');
            assert.equal(listings.length, 2);
            assert.ok(listings.every((row) => row.wifi === undefined));
            return 'I do not have wifi or workspace notes on these rows. Vanmai Coffee Cooperative, Vientiane. Yuni Coffee Company, Ltd., Vientiane.';
        }
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.mode, 'llm');
    assert.match(result.body.reply, /I do not have wifi/);
    assert.ok(!JSON.stringify(result.body).includes('xai-secret-test-key'));
    assert.equal(result.body.listings.length, 2);
});

test('provider failure falls back to search mode instead of leaking the key', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'best coffee places' }],
        env: { GROK_API_KEY: 'sk-should-never-appear' },
        searchBusinesses: async () => [VANMAI_COFFEE],
        completeChat: async () => {
            throw new Error('Bearer sk-should-never-appear failed');
        }
    });
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, 'Here are coffee spots in Vientiane.');
    assert.ok(!JSON.stringify(result.body).includes('sk-should-never-appear'));
});

test('search failure is a 5xx so the homepage can fall back', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'coffee' }],
        env: {},
        searchBusinesses: async () => {
            throw new Error('db down');
        }
    });
    assert.equal(result.status, 500);
    assert.equal(result.body.success, false);
});

test('listings are capped at about 8 and the template admits truncation', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({
        ...VANMAI_COFFEE,
        id: 2000 + i,
        name: `Coffee ${i}`
    }));
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'best coffee places' }],
        env: {},
        searchBusinesses: async () => many
    });
    assert.equal(result.body.listings.length, CHAT_LISTING_LIMIT);
    assert.equal(result.body.reply, 'Too many matches. Showing a few.');
});

test('system prompt forbids invented amenities and names the live model', () => {
    const prompt = buildSystemPrompt({
        listings: [publicListing(VANMAI_COFFEE)],
        locale: 'en'
    });
    assert.match(prompt, /asian\.directory/);
    assert.match(prompt, /Never invent/);
    assert.match(prompt, /wifi/);
    assert.match(prompt, /Vanmai Coffee Cooperative/);
    assert.doesNotMatch(prompt, /wifi":/);
    assert.equal(DEFAULT_XAI_MODEL, 'grok-4.3');
    assert.equal(getChatModel({}), 'grok-4.3');
    assert.equal(getChatApiKey({ XAI_API_KEY: ' a ', GROK_API_KEY: 'b' }), 'a');
    assert.equal(sanitizeErrorMessage(new Error('Bearer xai-abc failed')), 'Bearer [redacted] failed');
});
