'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    CHAT_LISTING_LIMIT,
    DEFAULT_XAI_MODEL,
    SYSTEM_PROMPT_TEXT,
    getChatApiKey,
    getChatModel,
    sanitizeErrorMessage,
    publicListing,
    listingForModel,
    stripSpokenContact,
    stripUnclaimedRanking,
    normalizeMessages,
    searchQueryFromMessages,
    isAmenityFollowUp,
    detectClarifyKind,
    shouldClarify,
    buildSystemPrompt,
    handleChatRequest,
    completeWithXai,
    omitChatReplyFromLog,
    GREETING_REPLY,
    FOOD_CLARIFY_REPLY,
    NEED_CLARIFY_REPLY,
    MISSING_AMENITY_REPLY,
    OUTSIDE_COVERAGE_REPLY
} = require('./chat');
const { EMPTY_LINE, parseSearchQuery } = require('./search-query');
const fs = require('fs');
const path = require('path');

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
    const smashed = publicListing({
        id: 917,
        name: 'CafÃ© Sinouk',
        category: 'Manufacture',
        description: 'CafÃ© in Vientiane',
        city: 'Vientiane'
    });
    assert.equal(smashed.name, 'Café Sinouk');
    assert.equal(smashed.description, 'Café in Vientiane');

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
    assert.equal(withHours.phone, '+856 20 0000');
    assert.equal(withHours.address, 'Vientiane, Laos');
    assert.equal(withHours.business_hours, undefined);
    assert.equal(withHours.special_offerings, undefined);
    assert.equal(withHours.wifi, undefined);
});

test('listingForModel is name, city, category, website only', () => {
    const slim = listingForModel({
        ...YUNI_COFFEE,
        description: `${'Coffee roasted in Vientiane. '.repeat(20)}Extra.`,
        business_hours: { mon: '8-17' },
        special_offerings: ['beans'],
        keywords: ['coffee'],
        email: 'sales@yunicoffeeco.com'
    });
    assert.deepEqual(Object.keys(slim).sort(), ['category', 'city', 'name', 'website']);
    assert.equal(slim.description, undefined);
    assert.equal(slim.country, undefined);
    assert.equal(slim.phone, undefined);
    assert.equal(slim.address, undefined);
    assert.equal(slim.business_hours, undefined);
    assert.equal(slim.special_offerings, undefined);
    assert.equal(slim.keywords, undefined);
    assert.equal(slim.id, undefined);
    assert.doesNotMatch(JSON.stringify(slim), /sales@yunicoffeeco\.com|\+856|description/);
});

test('spoken reply never includes phone or email', () => {
    assert.equal(
        stripSpokenContact('Call +856 20 5551234 or email sales@yunicoffeeco.com today.'),
        'Call or email today.'
    );
    assert.doesNotMatch(stripSpokenContact('Ping me at hello@asian.directory'), /@/);
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

test('best coffee lists matching rows and does not rank', async () => {
    assert.match(SYSTEM_PROMPT_TEXT, /You are asian\.directory's conversational assistant/);
    assert.match(SYSTEM_PROMPT_TEXT, /Do not say best, #1, top-rated, or verified unless that exact claim is in the listing JSON/);
    assert.match(SYSTEM_PROMPT_TEXT, /List matches; do not rank/);
    assert.equal(
        stripUnclaimedRanking('The best and #1 top-rated verified cafe.', [listingForModel(VANMAI_COFFEE)]),
        'The and cafe.'
    );
    assert.match(
        stripUnclaimedRanking('A verified stall.', [{ name: 'verified stall', city: 'Vientiane', category: 'Services' }]),
        /verified/i
    );

    const listed = await handleChatRequest({
        messages: [{ role: 'user', content: 'best coffee' }],
        env: {},
        searchBusinesses: async (query) => {
            assert.deepEqual(parseSearchQuery(query).contentTerms, ['coffee']);
            return [VANMAI_COFFEE, YUNI_COFFEE];
        }
    });
    assert.equal(listed.body.mode, 'search');
    assert.equal(listed.body.reply, 'Here are coffee spots in Vientiane.');
    assert.doesNotMatch(listed.body.reply, /\bbest\b|#1|top-rated|\bverified\b/i);
    assert.equal(listed.body.listings.length, 2);

    const grokTried = await handleChatRequest({
        messages: [{ role: 'user', content: 'best coffee' }],
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async () => [VANMAI_COFFEE, YUNI_COFFEE],
        completeChat: async () => 'The best #1 top-rated verified pick is Vanmai Coffee Cooperative.'
    });
    assert.equal(grokTried.body.mode, 'llm');
    assert.doesNotMatch(grokTried.body.reply, /\bbest\b|#1|top-rated|\bverified\b/i);
    assert.match(grokTried.body.reply, /Vanmai Coffee Cooperative/);
    assert.equal(grokTried.body.listings.length, 2);
});

test('hello clarifies before search and does not invent listings', async () => {
    const probed = [];
    const hotel = {
        id: 486,
        name: 'Salana Boutique Hotel',
        category: 'tourism',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'hello' }],
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async (query) => {
            probed.push(query);
            if (/sushi/i.test(query)) return [];
            if (/hotel/i.test(query)) return [hotel];
            if (/lawyer|legal/i.test(query)) return [];
            return [VANMAI_COFFEE];
        },
        completeChat: async () => 'should not be used'
    });
    assert.ok(probed.every((query) => !/\bhello\b/i.test(query)));
    assert.equal(result.body.mode, 'clarify');
    assert.equal(result.body.reply, GREETING_REPLY);
    assert.deepEqual(result.body.listings, []);
    assert.ok(result.body.chips.some((chip) => /Hotels|Travel|Lawyers|Banks/i.test(chip)));
    assert.ok(!result.body.chips.some((chip) => /sushi/i.test(chip)));
    assert.doesNotMatch(result.body.reply, /[\u{1F300}-\u{1FAFF}]/u);
});

test('with a key, Grok reply is used and the key is never returned', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'coffee in Vientiane' }],
        locale: 'en',
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async (query) => {
            assert.match(query, /coffee/i);
            return [VANMAI_COFFEE, YUNI_COFFEE];
        },
        completeChat: async ({ listings, apiKey }) => {
            assert.equal(apiKey, 'xai-secret-test-key');
            assert.equal(listings.length, 2);
            assert.ok(listings.every((row) => !('description' in row)));
            assert.ok(listings.every((row) => row.phone === undefined));
            assert.ok(listings.every((row) => row.address === undefined));
            assert.deepEqual(Object.keys(listings[1]).sort(), ['category', 'city', 'name', 'website']);
            return 'Call +856 20 5551234 or sales@yunicoffeeco.com. Coffee listings in Vientiane: Vanmai Coffee Cooperative.';
        }
    });

    assert.equal(result.status, 200);
    assert.equal(result.body.mode, 'llm');
    assert.match(result.body.reply, /Vanmai Coffee Cooperative/);
    assert.doesNotMatch(result.body.reply, /@|\+856|5551234/);
    assert.ok(!JSON.stringify(result.body).includes('xai-secret-test-key'));
    assert.equal(result.body.listings.length, 2);
    assert.equal(result.body.listings[1].phone, '+856 20 0000');
    assert.equal(result.body.listings[1].address, 'Vientiane, Laos');
});

test('amenity follow-ups stay search mode even when XAI_API_KEY is set', async () => {
    const honestyWithCards = [
        'what are the hours?',
        'any reviews?'
    ];
    for (const latest of honestyWithCards) {
        let called = false;
        const result = await handleChatRequest({
            messages: [
                { role: 'user', content: 'best coffee places' },
                { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
                { role: 'user', content: latest }
            ],
            env: { XAI_API_KEY: 'xai-secret-test-key' },
            searchBusinesses: async (query) => {
                assert.match(query, /coffee/);
                return [VANMAI_COFFEE, YUNI_COFFEE];
            },
            completeChat: async () => {
                called = true;
                return 'should not be used';
            }
        });
        assert.equal(isAmenityFollowUp(latest), true, latest);
        assert.equal(called, false, latest);
        assert.equal(result.body.mode, 'search', latest);
        assert.equal(result.body.reply, MISSING_AMENITY_REPLY, latest);
        assert.equal(result.body.listings.length, 2, latest);
        assert.doesNotMatch(result.body.reply, /wifi|laptop-friendly|quieter/i);
        assert.doesNotMatch(result.body.reply, /@|\+856/);
        assert.ok(!JSON.stringify(result.body).includes('xai-secret-test-key'));
    }
});

test('copy-token amenity with no tagged row is honest empty; tagged wifi filters', async () => {
    const missing = [
        'which is good for working?',
        'do they have wifi?',
        'good for laptop?'
    ];
    for (const latest of missing) {
        let called = false;
        const result = await handleChatRequest({
            messages: [
                { role: 'user', content: 'best coffee places' },
                { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
                { role: 'user', content: latest }
            ],
            env: { XAI_API_KEY: 'xai-secret-test-key' },
            searchBusinesses: async () => [],
            completeChat: async () => {
                called = true;
                return 'should not be used';
            }
        });
        assert.equal(isAmenityFollowUp(latest), true, latest);
        assert.equal(called, false, latest);
        assert.equal(result.body.mode, 'search', latest);
        assert.equal(result.body.reply, MISSING_AMENITY_REPLY, latest);
        assert.deepEqual(result.body.listings, []);
        assert.doesNotMatch(result.body.reply, /wifi|laptop-friendly|quieter/i);
    }

    const wifiRow = {
        ...YUNI_COFFEE,
        description: 'A cafe with wifi.',
        keywords: ['cafe', 'wifi']
    };
    const hit = await handleChatRequest({
        messages: [
            { role: 'user', content: 'best coffee places' },
            { role: 'user', content: 'do they have wifi?' }
        ],
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async (query) => {
            assert.match(query, /wifi/i);
            return [wifiRow];
        },
        completeChat: async () => 'should not be used'
    });
    assert.equal(hit.body.mode, 'search');
    assert.equal(hit.body.listings.length, 1);
    assert.notEqual(hit.body.reply, MISSING_AMENITY_REPLY);
    assert.equal(hit.body.listings[0].keywords, undefined);
    assert.doesNotMatch(JSON.stringify(hit.body.listings), /"keywords"/);
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

test('search failure is 200 with empty listings and the honest empty template', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'coffee' }],
        env: {},
        searchBusinesses: async () => {
            throw new Error('db down');
        }
    });
    assert.equal(result.status, 200);
    assert.equal(result.body.success, true);
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, EMPTY_LINE);
    assert.deepEqual(result.body.listings, []);
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

test('system prompt is the locked short text plus LISTINGS JSON', () => {
    const slim = [listingForModel(VANMAI_COFFEE)];
    const prompt = buildSystemPrompt({ listings: slim });
    assert.equal(
        SYSTEM_PROMPT_TEXT,
        'You are asian.directory\'s conversational assistant for a SEA business directory (strongest in Laos: Vientiane, Luang Prabang; expanding Thailand, Vietnam, Cambodia). Warm, lightly local, polite, never pushy. Reply in 1–3 short sentences. No emojis unless the user used one. No hype (amazing, must-try, best in the world). Help people find real catalog businesses. Never invent listings, amenities, reviews, prices, hours, wifi, contact, or features. Use ONLY the listing JSON below (name, city, category, website). Do not read out phone numbers or email addresses. If asked for contact, say the listing card has the public details we have, and do not invent a number. Do not mention prices. If vague (e.g. "I\'m hungry", "what should I eat?") ask 1–2 clarifying questions (cuisine and city). Do not invent places. Hello: short welcome, ask eat/drink/stay/other + city. After search: one natural sentence reflecting intent; cards stay the star. Missing amenity: say "I don’t have that information for these places yet." Do not infer quieter or laptop-friendly from descriptions. Do not say best, #1, top-rated, or verified unless that exact claim is in the listing JSON. List matches; do not rank. Stay on directory purpose; politely decline unrelated asks. If they ask Tokyo/Seoul etc., say strongest coverage is SEA/Laos.'
    );
    assert.equal(prompt, `${SYSTEM_PROMPT_TEXT}\n${JSON.stringify(slim)}`);
    assert.match(SYSTEM_PROMPT_TEXT, /Do not read out phone numbers or email addresses/);
    assert.match(SYSTEM_PROMPT_TEXT, /Do not mention prices/);
    assert.match(SYSTEM_PROMPT_TEXT, /do not rank/i);
    assert.match(SYSTEM_PROMPT_TEXT, /name, city, category, website/);
    assert.match(SYSTEM_PROMPT_TEXT, /strongest coverage is SEA\/Laos/);
    assert.match(SYSTEM_PROMPT_TEXT, /I don’t have that information for these places yet/);
    assert.doesNotMatch(JSON.stringify(slim), /"phone"|"email"|business_hours|special_offerings|keywords|"description"/);
    assert.doesNotMatch(JSON.stringify(slim), /wifi":/);
    assert.equal(DEFAULT_XAI_MODEL, 'grok-4.3');
    assert.equal(getChatModel({}), 'grok-4.3');
    assert.equal(getChatApiKey({ XAI_API_KEY: ' a ', GROK_API_KEY: 'b' }), 'a');
    assert.equal(sanitizeErrorMessage(new Error('Bearer xai-abc failed')), 'Bearer [redacted] failed');
});

test('SEO lock: never persist spoken reply into description, keywords, or static HTML', () => {
    const logged = omitChatReplyFromLog({
        userQuery: 'best coffee places',
        reply: 'Here are coffee spots. Call +856 20 5551234.',
        aiResponse: [{
            id: 1725,
            name: 'Vanmai Coffee Cooperative',
            description: 'Public listing from laoscoffee.org.',
            keywords: ['coffee'],
            reply: 'Here are coffee spots. Call +856 20 5551234.'
        }],
        businessIds: [1725]
    });
    assert.equal(logged.userQuery, 'best coffee places');
    assert.equal(logged.aiResponse[0].reply, undefined);
    assert.equal(logged.reply, undefined);
    assert.equal(logged.aiResponse[0].description, 'Public listing from laoscoffee.org.');
    assert.deepEqual(logged.businessIds, [1725]);

    const chatSrc = fs.readFileSync(path.join(__dirname, 'chat.js'), 'utf8');
    const serverSrc = fs.readFileSync(path.join(__dirname, 'server.js'), 'utf8');
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const enSrc = fs.readFileSync(path.join(__dirname, '..', 'en', 'index.html'), 'utf8');

    assert.doesNotMatch(chatSrc, /updateBusiness|addBusiness|writeFileSync|writeFile\(/);
    const chatRoute = serverSrc.slice(
        serverSrc.indexOf("app.post('/api/chat'"),
        serverSrc.indexOf('// Dashboard stats', serverSrc.indexOf("app.post('/api/chat'"))
    );
    assert.doesNotMatch(chatRoute, /updateBusiness|addBusiness|writeFile|saveConversation/);
    assert.match(indexSrc, /\$\{API_BASE_URL\}\/chat/);
    assert.doesNotMatch(enSrc, /\/api\/chat|API_BASE_URL\}\/chat/);

    const logFn = indexSrc.slice(
        indexSrc.indexOf('const logConversation'),
        indexSrc.indexOf('const searchOnlyFallback')
    );
    assert.doesNotMatch(logFn, /reply:/);
    assert.match(logFn, /delete copy\.reply/);
    assert.match(indexSrc, /const clearFollowUpChips/);
    assert.match(indexSrc, /querySelectorAll\('\.follow-up-chips'\)/);
    assert.match(indexSrc, /querySelectorAll\('\.follow-up-chip'\)/);
    assert.match(indexSrc, /class="follow-up-chips/);
    assert.match(indexSrc, /const isVaguePrompt/);
    assert.match(indexSrc, /Welcome\. Looking to eat, drink, stay/);
    assert.doesNotMatch(indexSrc, /chips:\s*\[[^\]]*Sushi\?/);
    assert.match(indexSrc, /\? \['Coffee\?', 'Restaurants\?', 'Vientiane\?'\]/);
    assert.match(chatSrc, /food:\s*\['Coffee\?', 'Restaurants\?', 'Vientiane\?'\]/);
    assert.doesNotMatch(chatSrc, /food:\s*\[[^\]]*Hotels\?/);
    assert.match(chatSrc, /reasoning_effort:\s*'none'/);

    const listingsDir = path.join(__dirname, '..', 'listings');
    for (const file of fs.readdirSync(listingsDir)) {
        if (!file.endsWith('.html')) continue;
        const html = fs.readFileSync(path.join(listingsDir, file), 'utf8');
        assert.doesNotMatch(html, /\/api\/chat/);
    }
});

test('Jordan visual lock: chips only under the latest assistant reply', () => {
    const indexSrc = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
    const submitFn = indexSrc.slice(
        indexSrc.indexOf('const submitPrompt'),
        indexSrc.indexOf('const startNewChat')
    );
    const addFn = indexSrc.slice(
        indexSrc.indexOf('const addAIResponse'),
        indexSrc.indexOf('const logConversation')
    );
    assert.match(submitFn, /clearFollowUpChips\(\)/);
    assert.match(addFn, /clearFollowUpChips\(\)/);
    assert.match(addFn, /class="follow-up-chips/);
    assert.match(indexSrc, /#chat-input \.follow-up-chips/);

    const inputBlock = indexSrc.slice(
        indexSrc.indexOf('id="chat-input"'),
        indexSrc.indexOf('id="submit-modal"')
    );
    assert.doesNotMatch(inputBlock, /follow-up-chips|follow-up-chip/);
});

test('vague food and need asks clarify before search and skip junk listings', async () => {
    assert.equal(detectClarifyKind('hello'), 'greeting');
    assert.equal(detectClarifyKind("I'm hungry"), 'food');
    assert.equal(detectClarifyKind('what should I eat?'), 'food');
    assert.equal(detectClarifyKind('bored'), 'need');
    assert.equal(detectClarifyKind('help'), 'need');
    assert.equal(detectClarifyKind('coffee in Vientiane'), null);
    assert.equal(detectClarifyKind('food'), 'food');
    assert.equal(detectClarifyKind('food in Vientiane'), null);
    assert.equal(shouldClarify("I'm hungry", []), 'food');
    assert.equal(shouldClarify('which is good for working?', ['best coffee places']), null);

    const prompts = [
        { text: "I'm hungry", reply: FOOD_CLARIFY_REPLY },
        { text: 'what should I eat?', reply: FOOD_CLARIFY_REPLY },
        { text: 'bored', reply: NEED_CLARIFY_REPLY },
        { text: 'help', reply: NEED_CLARIFY_REPLY }
    ];

    for (const { text, reply } of prompts) {
        const probed = [];
        let called = false;
        const result = await handleChatRequest({
            messages: [{ role: 'user', content: text }],
            env: { XAI_API_KEY: 'xai-secret-test-key' },
            searchBusinesses: async (query) => {
                probed.push(query);
                if (/sushi/i.test(query)) return [];
                return [VANMAI_COFFEE, YUNI_COFFEE];
            },
            completeChat: async () => {
                called = true;
                return 'should not be used';
            }
        });
        assert.ok(probed.every((query) => !/\b(hungry|eat|bored|help)\b/i.test(query)), text);
        assert.equal(called, false, text);
        assert.equal(result.status, 200, text);
        assert.equal(result.body.mode, 'clarify', text);
        assert.equal(result.body.reply, reply, text);
        assert.deepEqual(result.body.listings, [], text);
        assert.ok(result.body.chips.length > 0, text);
        if (/hungry|eat|food/i.test(text)) {
            assert.ok(result.body.chips.some((chip) => /Coffee|Restaurants|Lao food|Vientiane/i.test(chip)), text);
            assert.ok(!result.body.chips.some((chip) => /Hotels|Travel|Lawyers|Banks|Construction/i.test(chip)), text);
        } else {
            assert.ok(result.body.chips.some((chip) => /Vientiane|Coffee|Hotels|Lawyers|Restaurants|Banks|Travel/i.test(chip)), text);
        }
        assert.ok(!result.body.chips.some((chip) => /sushi/i.test(chip)), text);
        assert.doesNotMatch(result.body.reply, /amazing|must-try|best in the world/i);
        assert.doesNotMatch(JSON.stringify(result.body), /xai-secret-test-key/);
    }
});

test('hungry chips do not include Sushi when searchBusinesses(sushi) is empty', async () => {
    const probed = [];
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: "I'm hungry" }],
        env: {},
        searchBusinesses: async (query) => {
            probed.push(query);
            if (/sushi/i.test(query)) return [];
            if (/coffee/i.test(query)) return [VANMAI_COFFEE];
            return [];
        }
    });
    assert.equal(result.body.mode, 'clarify');
    assert.deepEqual(result.body.listings, []);
    assert.ok(probed.some((query) => /sushi/i.test(query)));
    assert.deepEqual(
        probed.filter((query) => /sushi/i.test(query)).map((query) => parseSearchQuery(query).contentTerms),
        [['sushi']]
    );
    assert.ok(!result.body.chips.includes('Sushi?'));
    assert.ok(result.body.chips.includes('Coffee?'));
    assert.ok(result.body.chips.includes('Vientiane?'));
    assert.ok(!result.body.chips.some((chip) => /Hotels|Travel|Lawyers|Banks|Construction/i.test(chip)));
});

test('after a vague ask, sushi in Vientiane runs the existing planner', async () => {
    const SUSHI = {
        id: 1801,
        name: 'Khao Niew Sushi',
        category: 'Restaurant',
        city: 'Vientiane',
        website: 'https://example.com/sushi'
    };
    let searchedQuery = '';
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: "I'm hungry" },
            { role: 'assistant', content: FOOD_CLARIFY_REPLY },
            { role: 'user', content: 'sushi in Vientiane' }
        ],
        env: {},
        searchBusinesses: async (query) => {
            searchedQuery = query;
            return [SUSHI];
        }
    });
    assert.match(searchedQuery, /sushi/i);
    assert.match(searchedQuery, /vientiane/i);
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.listings.length, 1);
    assert.equal(result.body.listings[0].name, 'Khao Niew Sushi');
    assert.match(result.body.reply, /sushi|Vientiane/i);
    assert.doesNotMatch(result.body.reply, /hungry/i);
});

test('xAI request stays grok-4.3 with reasoning_effort none', async () => {
    let body;
    await completeWithXai({
        messages: [{ role: 'user', content: 'coffee in Vientiane' }],
        listings: [listingForModel(YUNI_COFFEE)],
        apiKey: 'xai-test',
        model: DEFAULT_XAI_MODEL,
        requestFn: async (args) => {
            body = args.body;
            return 'Coffee listings in Vientiane.';
        }
    });
    assert.equal(body.model, 'grok-4.3');
    assert.equal(body.reasoning_effort, 'none');
    assert.match(body.messages[0].content, /asian\.directory/);
    assert.doesNotMatch(JSON.stringify(body), /"phone"|"email"/);
});

test('Tokyo and Seoul asks stay honest about SEA/Laos coverage', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'ramen in Tokyo' }],
        env: { XAI_API_KEY: 'xai-secret-test-key' },
        searchBusinesses: async () => [],
        completeChat: async () => 'Try Ichiran in Shibuya.'
    });
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, OUTSIDE_COVERAGE_REPLY);
    assert.deepEqual(result.body.listings, []);
    assert.doesNotMatch(result.body.reply, /Ichiran|Shibuya/);
});
