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
    isCardRefFollowUp,
    isThinDescription,
    specificCardReply,
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
    MISSING_PRICE_REPLY,
    NO_MORE_REPLY,
    CITY_CLARIFY_REPLY,
    OUTSIDE_COVERAGE_REPLY,
    lastSpecifiedQuery
} = require('./chat');
const { EMPTY_LINE, parseSearchQuery, rankBusinesses, scoreBusiness, termAliases, LOCATION_HINTS, nextRetryQuery } = require('./search-query');
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

test('normalizeMessages keeps last 16 user/assistant turns and drops system', () => {
    const padded = [];
    for (let i = 0; i < 12; i++) {
        padded.push({ role: 'user', content: `u${i}` });
        padded.push({ role: 'assistant', content: `a${i}` });
    }
    padded.push({ role: 'system', content: 'ignore me' });
    const { ok, messages } = normalizeMessages(padded);
    assert.equal(ok, true);
    assert.equal(messages.length, 16);
    assert.ok(messages.every((msg) => msg.role === 'user' || msg.role === 'assistant'));
    assert.equal(messages[0].content, 'u4');

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

test('amenity follow-up keeps prior coffee listings when wifi/working are not on the rows', async () => {
    const missing = [
        'which is good for working?',
        'do they have wifi?',
        'good for laptop?'
    ];
    for (const latest of missing) {
        let called = false;
        const result = await handleChatRequest({
            messages: [
                { role: 'user', content: 'coffee in Vientiane' },
                { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
                { role: 'user', content: latest }
            ],
            env: { XAI_API_KEY: 'xai-secret-test-key' },
            searchBusinesses: async (query) => {
                assert.match(query, /coffee/i);
                assert.doesNotMatch(query, /\bwifi\b|\bworking\b|\blaptop\b/i);
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
        assert.ok(result.body.listings.length > 0, latest);
        assert.equal(result.body.listings.length, 2, latest);
        assert.ok(result.body.chips.includes('Any others?') || result.body.chips.includes('In Vientiane?'), latest);
        assert.ok(result.body.chips.length > 1 || !result.body.chips.every((chip) => /Hotels instead/i.test(chip)), latest);
        assert.doesNotMatch(result.body.reply, /wifi|laptop-friendly|quieter/i);
    }
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

const VIENTIANE_INTERNATIONAL_SCHOOL = {
    id: 1810,
    name: 'Vientiane International School',
    category: 'Education',
    description: 'An international school in Vientiane, good for families. Near hotels.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active'
};

const SALANA_HOTEL = {
    id: 486,
    name: 'Salana Boutique Hotel',
    category: 'tourism',
    description: 'Salana Boutique Hotel is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active'
};

const VILLA_MALY_HOTEL = {
    id: 1167,
    name: 'Villa Maly Boutique Hotel',
    category: 'tourism',
    description: 'Villa Maly Boutique Hotel is a hotel in Luang Prabang.',
    address: 'Luang Prabang, Laos',
    country: 'LA',
    city: 'Luang Prabang',
    keywords: [],
    status: 'active'
};

const CHAMPASAK_PALACE = {
    id: 1901,
    name: 'Champasak Palace Hotel',
    category: 'tourism',
    description: 'A hotel in Champasak.',
    address: 'Pakse, Champasak',
    country: 'LA',
    city: 'Champasak',
    keywords: [],
    status: 'active'
};

const ANZ_BANK = {
    id: 1708,
    name: 'Australia & New Zealand Banking Group Ltd - Lao Branch',
    category: 'Banking & Financial Services',
    description: 'ANZ is the first international bank to operate in Laos.',
    address: '33 Lane Xang Avenue, Vientiane Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active'
};

const ARIYA_SERVICES = {
    id: 1902,
    name: 'Ariya',
    category: 'Business Services',
    description: 'Ariya is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active'
};

const DFDL_LEGAL = {
    id: 150,
    name: 'DFDL (Lao) Sole Co. Ltd',
    category: 'Legal & Tax',
    description: 'DFDL Legal & Tax is a public listing.',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

test('hotel + families does not return a school', async () => {
    const catalog = [VIENTIANE_INTERNATIONAL_SCHOOL, SALANA_HOTEL, VILLA_MALY_HOTEL];
    const ranked = rankBusinesses(catalog, parseSearchQuery('hotels in Vientiane good for families'));
    assert.equal(ranked.some((row) => /school/i.test(row.name)), false);
    assert.ok(ranked.some((row) => row.id === 486));

    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'hotels in Vientiane good for families' }],
        env: {},
        searchBusinesses: async (query) => rankBusinesses(catalog, parseSearchQuery(query))
    });
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.listings.some((row) => /school/i.test(row.name)), false);
    assert.ok(result.body.listings.some((row) => /hotel/i.test(row.name)));
    assert.doesNotMatch(result.body.reply, /school/i);
});

test('lawyer query does not return a bank', async () => {
    const catalog = [ANZ_BANK, ARIYA_SERVICES, DFDL_LEGAL];
    const ranked = rankBusinesses(catalog, parseSearchQuery('lawyer in Vientiane'));
    assert.equal(ranked.some((row) => /bank/i.test(row.name) || /bank/i.test(row.category)), false);
    assert.equal(ranked.some((row) => /ariya/i.test(row.name)), false);
    assert.ok(ranked.some((row) => row.id === 150));

    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'lawyer in Vientiane' }],
        env: {},
        searchBusinesses: async (query) => rankBusinesses(catalog, parseSearchQuery(query))
    });
    assert.equal(result.body.listings.some((row) => /bank/i.test(row.name)), false);
    assert.equal(result.body.listings.some((row) => /ariya/i.test(row.name)), false);
    assert.ok(result.body.listings.every((row) => row.taxonomy && row.taxonomy.sub === 'lawyer'));
    assert.match(result.body.reply, /lawyer/i);
});

test('cheaper ones keeps Luang Prabang hotels and admits missing prices', async () => {
    const catalog = [SALANA_HOTEL, VILLA_MALY_HOTEL, CHAMPASAK_PALACE];
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'hotels in Luang Prabang' },
            { role: 'assistant', content: 'Here are hotels in Luang Prabang.' },
            { role: 'user', content: 'cheaper ones' }
        ],
        env: {},
        searchBusinesses: async (query) => rankBusinesses(catalog, parseSearchQuery(query))
    });
    assert.match(result.body.query, /hotel/i);
    assert.match(result.body.query, /luang/i);
    assert.match(result.body.query, /prabang/i);
    assert.equal(result.body.mode, 'search');
    assert.equal(result.body.reply, MISSING_PRICE_REPLY);
    assert.ok(result.body.listings.length > 0);
    assert.ok(result.body.listings.every((row) => /luang prabang/i.test(row.city)));
    assert.equal(result.body.listings.some((row) => /vientiane/i.test(row.city)), false);
    assert.equal(result.body.listings.some((row) => /champasak/i.test(row.city)), false);
    assert.doesNotMatch(result.body.reply, /Vientiane|Champasak/);
});

test('amenity follow-up listings.length > 0 when prior search had hits', async () => {
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'coffee in Vientiane' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'which is good for working?' }
        ],
        env: {},
        searchBusinesses: async (query) => {
            if (/\bwifi\b|\bworking\b/i.test(query) && !/coffee/i.test(query)) return [];
            return [VANMAI_COFFEE, YUNI_COFFEE];
        }
    });
    assert.ok(result.body.listings.length > 0);
    assert.equal(result.body.reply, MISSING_AMENITY_REPLY);
    assert.ok(result.body.chips.includes('Any others?') || result.body.chips.includes('In Vientiane?'));
    assert.ok(!(result.body.chips.length === 1 && /Hotels instead/i.test(result.body.chips[0])));
});

test('open late near me with no city clarifies Which city?', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'open late near me' }],
        env: {},
        searchBusinesses: async () => [VANMAI_COFFEE, YUNI_COFFEE]
    });
    assert.equal(result.body.mode, 'clarify');
    assert.equal(result.body.reply, CITY_CLARIFY_REPLY);
    assert.deepEqual(result.body.listings, []);
    assert.ok(result.body.chips.includes('Which city?'));
});

test('in Vientiane only after Luang Prabang restaurants may switch city', () => {
    assert.equal(
        searchQueryFromMessages([
            { role: 'user', content: 'restaurants in Luang Prabang' },
            { role: 'user', content: 'in Vientiane only' }
        ]),
        'in Vientiane only restaurants'
    );
    assert.doesNotMatch(
        searchQueryFromMessages([
            { role: 'user', content: 'restaurants in Luang Prabang' },
            { role: 'user', content: 'in Vientiane only' }
        ]),
        /luang|prabang/i
    );
});

test('coffee then working then wifi keeps the coffee-mapped listings', async () => {
    const coffeeRows = [VANMAI_COFFEE, YUNI_COFFEE];
    const swapped = [
        { id: 9601, name: 'EY', category: 'Consulting', city: 'Vientiane', country: 'LA', status: 'active' },
        { id: 9602, name: 'GIZ', category: 'NGO', city: 'Vientiane', country: 'LA', status: 'active' },
        { id: 9603, name: 'IndusTek', category: 'Consulting', city: 'Vientiane', country: 'LA', status: 'active' },
        { id: 9604, name: 'Burapha', category: 'Business Services', city: 'Vientiane', country: 'LA', status: 'active' }
    ];
    const searched = [];
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'coffee in Vientiane' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'which is good for working?' },
            { role: 'assistant', content: MISSING_AMENITY_REPLY },
            { role: 'user', content: 'do they have wifi?' }
        ],
        env: {},
        searchBusinesses: async (query) => {
            searched.push(query);
            if (/\bwifi\b|\bworking\b/i.test(query) && !/coffee/i.test(query)) return swapped;
            return coffeeRows;
        }
    });
    assert.equal(lastSpecifiedQuery([
        'coffee in Vientiane',
        'which is good for working?'
    ]), 'coffee in Vientiane');
    assert.ok(searched.every((query) => /coffee/i.test(query)));
    assert.ok(searched.every((query) => !/\bwifi\b|\bworking\b/i.test(query)));
    assert.equal(result.body.reply, MISSING_AMENITY_REPLY);
    assert.equal(result.body.listings.length, 2);
    assert.deepEqual(result.body.listings.map((row) => row.name), [
        'Vanmai Coffee Cooperative',
        'Yuni Coffee Company, Ltd.'
    ]);
    assert.equal(result.body.listings.some((row) => /EY|GIZ|IndusTek|Burapha/i.test(row.name)), false);
    assert.equal(result.body.chips.filter((chip) => chip === 'In Vientiane?').length <= 1, true);
    assert.deepEqual(result.body.chips, Array.from(new Set(result.body.chips)));
    assert.ok(result.body.chips.includes('Any others?') || result.body.chips.includes('In Vientiane?'));
});

test('lawyer wifi still keeps lawyer listings', async () => {
    const lawyers = [DFDL_LEGAL];
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'lawyer in Vientiane' },
            { role: 'assistant', content: 'Here are lawyer matches in Vientiane.' },
            { role: 'user', content: 'do they have wifi?' }
        ],
        env: {},
        searchBusinesses: async (query) => {
            assert.match(query, /lawyer/i);
            assert.doesNotMatch(query, /\bwifi\b/i);
            return lawyers;
        }
    });
    assert.equal(result.body.reply, MISSING_AMENITY_REPLY);
    assert.equal(result.body.listings.length, 1);
    assert.equal(result.body.listings[0].name, 'DFDL (Lao) Sole Co. Ltd');
    assert.ok(result.body.listings[0].taxonomy && result.body.listings[0].taxonomy.sub === 'lawyer');
});

test('Vang Vieng stay with only Vientiane city rows is honest empty', async () => {
    const vientianeHotel = {
        id: 9401,
        name: 'Salana Boutique Hotel',
        category: 'tourism',
        description: 'Day trips to Vang Vieng from Vientiane. A place to stay.',
        address: 'Vientiane, Lao PDR',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'place to stay in Vang Vieng' }],
        env: {},
        searchBusinesses: async (query) => rankBusinesses([vientianeHotel], parseSearchQuery(query))
    });
    assert.equal(result.body.listings.length, 0);
    assert.equal(result.body.reply, EMPTY_LINE);
    assert.doesNotMatch(result.body.reply, /Vang Vieng/i);
});

test('any others after the same hotel set is honest when there is no next page', async () => {
    const hotels = [SALANA_HOTEL, VILLA_MALY_HOTEL];
    const result = await handleChatRequest({
        messages: [
            { role: 'user', content: 'hotels in Vientiane' },
            { role: 'assistant', content: 'Here are hotels in Vientiane.' },
            { role: 'user', content: 'any others?' }
        ],
        env: {},
        searchBusinesses: async (query) => {
            assert.match(query, /hotel/i);
            return hotels;
        }
    });
    assert.equal(result.body.reply, NO_MORE_REPLY);
    assert.equal(result.body.listings.length, 2);
    assert.deepEqual(result.body.listings.map((row) => row.name).sort(), [
        'Salana Boutique Hotel',
        'Villa Maly Boutique Hotel'
    ].sort());
    assert.doesNotMatch(result.body.reply, /Here are hotels/i);
});

const FIRST_COMMERCIAL_BANK = {
    id: 9101,
    name: 'First Commercial Bank',
    category: 'Banking & Financial Services',
    description: 'First Commercial Bank is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    notes: 'internal crm: they have wifi and cheap lunch. Call +856 20 1111111'
};

const FIRST_PACIFIC_MINING = {
    id: 9102,
    name: 'First Pacific Mining',
    category: 'Mining',
    description: 'First Pacific Mining is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    notes: 'do not speak this note'
};

const FIRST_FOOD = {
    id: 9103,
    name: 'First Food',
    category: 'Food & Beverages',
    description: 'First Food is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active'
};

const ASTER_COFFEE = {
    id: 1662,
    name: 'ASTER COFFEE HOUSE',
    category: 'Food & Beverages',
    description: 'ASTER COFFEE HOUSE is a public listing in Vientiane.',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    website: 'https://aster.example',
    keywords: ['coffee'],
    status: 'active',
    notes: 'staff say wifi is excellent. Never speak notes.'
};

const COMMA_COFFEE = {
    id: 1663,
    name: 'Comma Coffee',
    category: 'Food & Beverages',
    description: 'Roasts Lao beans in Vientiane and sells bags to cafes.',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    keywords: ['coffee'],
    status: 'active'
};

function coffeeTranscriptCatalog() {
    const extraCoffee = Array.from({ length: 5 }, (_, i) => ({
        ...VANMAI_COFFEE,
        id: 9200 + i,
        name: `Vientiane Coffee ${i + 1}`,
        description: `Vientiane Coffee ${i + 1} is a public listing in Vientiane.`,
        notes: 'hidden admin note'
    }));
    return [
        VANMAI_COFFEE,
        YUNI_COFFEE,
        ASTER_COFFEE,
        COMMA_COFFEE,
        ...extraCoffee,
        FIRST_COMMERCIAL_BANK,
        FIRST_PACIFIC_MINING,
        FIRST_FOOD,
        ANZ_BANK
    ];
}

function rowMatchesRequiredTerms(row, parsed) {
    const required = (parsed.contentTerms || []).filter((term) => !LOCATION_HINTS.has(term));
    if (!required.length) return parsed.contentTerms.length > 0 && scoreBusiness(row, parsed) > 0;
    const blob = [
        row.name,
        row.category,
        row.description,
        row.address,
        row.city,
        row.country,
        ...(Array.isArray(row.keywords) ? row.keywords : [])
    ].join(' ').toLowerCase();
    return required.every((term) => termAliases(term).some((alias) => blob.includes(alias)));
}

function searchLikeServer(catalog, query) {
    let parsed = parseSearchQuery(query);
    let rows = rankBusinesses(catalog, parsed).filter((row) => rowMatchesRequiredTerms(row, parsed));
    if (rows.length) return rows;
    const retry = nextRetryQuery(parsed);
    if (!retry) return rows;
    return rankBusinesses(catalog, retry).filter((row) => rowMatchesRequiredTerms(row, retry));
}

function searchTranscriptCatalog(query) {
    return searchLikeServer(coffeeTranscriptCatalog(), query);
}

test('specific-card reply uses public description or card facts, never notes', () => {
    assert.equal(isThinDescription(VANMAI_COFFEE.description), true);
    assert.equal(isThinDescription(COMMA_COFFEE.description), false);
    assert.equal(isThinDescription('Contact email: sales@yunicoffeeco.com'), true);
    assert.match(specificCardReply(VANMAI_COFFEE), /Vanmai Coffee Cooperative/);
    assert.match(specificCardReply(VANMAI_COFFEE), /Vientiane/);
    assert.doesNotMatch(specificCardReply(VANMAI_COFFEE), /public listing|internal crm|wifi/i);
    assert.equal(
        specificCardReply(COMMA_COFFEE),
        'Roasts Lao beans in Vientiane and sells bags to cafes.'
    );
    assert.doesNotMatch(specificCardReply({
        ...ASTER_COFFEE,
        notes: 'staff say wifi is excellent'
    }), /wifi|notes|excellent/i);
});

test('card-ref follow-ups are not a new keyword search', () => {
    assert.equal(isCardRefFollowUp('tell me about the first one'), true);
    assert.equal(isCardRefFollowUp('Tell me about it'), true);
    assert.equal(isCardRefFollowUp('that one'), true);
    assert.equal(isCardRefFollowUp('that cafe'), true);
    assert.equal(isCardRefFollowUp('the second'), true);
    assert.equal(isCardRefFollowUp('First Commercial Bank'), false);
    assert.equal(isCardRefFollowUp('What about sushi?'), false);
    assert.equal(shouldClarify('Tell me about the first one', ['coffee in Vientiane']), null);
    assert.equal(shouldClarify("I'm hungry", ['coffee in Vientiane']), null);
    assert.equal(shouldClarify("I'm hungry", []), 'food');
    assert.equal(lastSpecifiedQuery([
        'I just landed in Vientiane, where should I get coffee?',
        'One with wifi if you have that',
        'Tell me about the first one'
    ]), 'I just landed in Vientiane, where should I get coffee?');
    assert.doesNotMatch(
        JSON.stringify(parseSearchQuery('tell me about the first one').contentTerms),
        /first/
    );
});

test('tell me about the first one stays on coffee cards, not banks or mines', async () => {
    const messages = [];
    const searched = [];
    const step = async (text) => {
        messages.push({ role: 'user', content: text });
        const result = await handleChatRequest({
            messages,
            env: {},
            searchBusinesses: async (query) => {
                searched.push(query);
                return searchTranscriptCatalog(query);
            }
        });
        messages.push({ role: 'assistant', content: result.body.reply });
        return result;
    };

    const coffee = await step('I just landed in Vientiane, where should I get coffee?');
    assert.equal(coffee.body.mode, 'search');
    assert.ok(coffee.body.listings.length > 0);
    assert.equal(coffee.body.listings.some((row) => /First Commercial Bank|First Pacific Mining|First Food/i.test(row.name)), false);
    assert.ok(coffee.body.listings.every((row) => /coffee/i.test(row.name)));
    assert.ok(!coffee.body.chips.some((chip) => /Hotels\?|Banks\?|Eat\?|Lawyers\?/i.test(chip)));

    const wifi = await step('One with wifi if you have that');
    assert.equal(wifi.body.reply, MISSING_AMENITY_REPLY);
    assert.deepEqual(wifi.body.listings.map((row) => row.name), coffee.body.listings.map((row) => row.name));
    assert.ok(!wifi.body.chips.some((chip) => /Hotels\?|Banks\?|Eat\?/i.test(chip)));
    assert.doesNotMatch(wifi.body.reply, /wifi|hours|price/i);

    const first = await step('Tell me about the first one');
    assert.equal(first.body.listings.some((row) => /First Commercial Bank|First Pacific Mining|First Food/i.test(row.name)), false);
    assert.deepEqual(first.body.listings.map((row) => row.name), coffee.body.listings.map((row) => row.name));
    assert.match(first.body.reply, new RegExp(coffee.body.listings[0].name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(first.body.reply, /First Commercial Bank|First Pacific Mining|First Food/);
    assert.doesNotMatch(first.body.reply, /public listing|internal crm|hidden admin|excellent|cheap lunch/i);
    assert.doesNotMatch(first.body.reply, /wifi|hours|price|@|\+856/i);
    assert.ok(!JSON.stringify(first.body).includes('internal crm'));
    assert.ok(!JSON.stringify(first.body).includes('hidden admin'));
    assert.ok(searched.every((query) => !/\bfirst\b/i.test(query) || /coffee/i.test(query)));

    const cheaper = await step('Something cheaper');
    assert.equal(cheaper.body.reply, MISSING_PRICE_REPLY);
    assert.deepEqual(cheaper.body.listings.map((row) => row.name), coffee.body.listings.map((row) => row.name));
    assert.equal(cheaper.body.listings.some((row) => /bank|mining/i.test(row.name)), false);

    const sushi = await step('What about sushi?');
    assert.equal(sushi.body.listings.length, 0);
    assert.equal(sushi.body.reply, EMPTY_LINE);

    const hungry = await step("I'm hungry though");
    assert.notEqual(hungry.body.mode, 'clarify');
    assert.notEqual(hungry.body.reply, FOOD_CLARIFY_REPLY);
    assert.ok(hungry.body.listings.length > 0);
    assert.deepEqual(hungry.body.listings.map((row) => row.name), coffee.body.listings.map((row) => row.name));
    assert.ok(!hungry.body.chips.some((chip) => /Hotels\?|Banks\?|Lawyers\?|Eat\?/i.test(chip)));
});

test('that cafe and the second stay on the shown listing set', async () => {
    const coffeeRows = [VANMAI_COFFEE, ASTER_COFFEE, COMMA_COFFEE];
    const catalog = [...coffeeRows, FIRST_COMMERCIAL_BANK, FIRST_PACIFIC_MINING];
    const searchCoffeeSet = async (query) => searchLikeServer(catalog, query);

    const listed = await handleChatRequest({
        messages: [{ role: 'user', content: 'coffee in Vientiane' }],
        env: {},
        searchBusinesses: searchCoffeeSet
    });
    const names = listed.body.listings.map((row) => row.name);
    assert.deepEqual(names.slice().sort(), coffeeRows.map((row) => row.name).sort());
    assert.equal(names.includes('First Commercial Bank'), false);

    const aboutIt = await handleChatRequest({
        messages: [
            { role: 'user', content: 'coffee in Vientiane' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'tell me about it' }
        ],
        env: {},
        searchBusinesses: searchCoffeeSet
    });
    const expectCardReply = (reply, listingName) => {
        if (listingName === 'Comma Coffee') {
            assert.match(reply, /Roasts Lao beans in Vientiane and sells bags to cafes/);
        } else {
            assert.match(reply, new RegExp(listingName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
        }
        assert.doesNotMatch(reply, /public listing|wifi|notes|First Commercial Bank|price|hours/i);
    };

    assert.deepEqual(aboutIt.body.listings.map((row) => row.name), names);
    expectCardReply(aboutIt.body.reply, names[0]);

    const second = await handleChatRequest({
        messages: [
            { role: 'user', content: 'coffee in Vientiane' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'the second' }
        ],
        env: {},
        searchBusinesses: searchCoffeeSet
    });
    assert.deepEqual(second.body.listings.map((row) => row.name), names);
    expectCardReply(second.body.reply, names[1]);

    const rich = await handleChatRequest({
        messages: [
            { role: 'user', content: 'coffee in Vientiane' },
            { role: 'assistant', content: 'Here are coffee spots in Vientiane.' },
            { role: 'user', content: 'tell me about the third' }
        ],
        env: {},
        searchBusinesses: searchCoffeeSet
    });
    expectCardReply(rich.body.reply, names[2]);
});

test('a real First Commercial Bank name still searches that business', async () => {
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: 'First Commercial Bank' }],
        env: {},
        searchBusinesses: async (query) => {
            assert.doesNotMatch(query, /coffee/i);
            return searchTranscriptCatalog(query);
        }
    });
    assert.ok(result.body.listings.some((row) => row.name === 'First Commercial Bank'));
    assert.equal(result.body.listings.some((row) => /coffee/i.test(row.name)), false);
});

