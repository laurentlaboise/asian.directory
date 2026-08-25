'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseSearchQuery,
    rankBusinesses,
    buildContentSearchSql,
    scoreBusiness,
    strongestContentTerms,
    nextRetryQuery,
    namedCategoryConstraint,
    rowMatchesNamedCategory,
    decodeMojibake,
    mapListing,
    termAliases,
    nameLooksCafe,
    isGreeting,
    isFollowUp,
    reformulateWithHistory,
    parseHistoryParam,
    searchWithRetry,
    buildAssistantLine,
    buildFollowUpChips,
    uniqueChips,
    dropMismatchedRequestedCity,
    GREETING_LINE,
    EMPTY_LINE,
    EMPTY_OUTSIDE_LINE,
    TOO_MANY_LINE,
    WEAK_LINE
} = require('./search-query');

// Live rows from GET /api/businesses/search on 2026-08-23. Do not invent listings.
const ANZ_LAO_BRANCH = {
    id: 1708,
    name: 'Australia & New Zealand Banking Group Ltd - Lao Branch',
    category: 'Banking & Financial Services',
    description: 'ANZ is the first international bank to operate in Laos and has been in Laos since 2007.',
    address: 'Australia and New Zealand Banking Group Limited, Lao Branch 33 Lane Xang Avenue, PO Box 5001, Vientiane Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

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
    is_featured: false
};

const KHANG_COMPANY = {
    id: 1724,
    name: 'Khang Company',
    category: 'Services',
    description: 'Khang Company is a public listing from https://laohandicraft.org/members/khang-c',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const YUNI_COFFEE = {
    id: 1669,
    name: 'Yuni Coffee Company, Ltd.',
    category: 'Business Services',
    description: 'Contact email: sales@yunicoffeeco.com',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

// Live GET /api/businesses/search rows from 2026-08-23. Do not invent sushi listings.
const ASTER_COFFEE_HOUSE = {
    id: 71,
    name: 'ASTER COFFEE HOUSE',
    category: 'coffee shop',
    description: 'ASTER COFFEE HOUSE is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const COMMA_COFFEE = {
    id: 1658,
    name: 'Comma Coffee',
    category: 'Business Services',
    description: 'Comma Coffee is a public listing in Vientiane.',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const SAFFRON_COFFEE = {
    id: 1666,
    name: 'Saffron Coffee',
    category: 'Business Services',
    description: 'Saffron Coffee is a public listing in Vientiane.',
    address: 'Vientiane, Laos',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const COFFEE_FIX = {
    id: 128,
    name: 'Coffee Fix',
    category: 'Machineries & Tools',
    description: 'Coffee Fix is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const MIRACLE_COFFEE_FACTORY = {
    id: 398,
    name: 'Miracle Lao Coffee Factory Sole Co.,Ltd',
    category: 'Manufacture',
    description: 'Miracle Lao Coffee Factory Sole Co.,Ltd is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const HIGHLAND_GARDEN = {
    id: 206,
    name: 'Highland Garden Restaurant Vientiane',
    category: 'western restaurant',
    description: 'Highland Garden Restaurant Vientiane is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const WAN_XIANG = {
    id: 623,
    name: 'Wan Xiang Chinese Restaurant Vientiane',
    category: 'chinese restaurant',
    description: 'Wan Xiang Chinese Restaurant Vientiane is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const FOODPANDA = {
    id: 185,
    name: 'Foodpanda - Delivery Hero (Lao) Sole Co. Ltd',
    category: 'Food & Beverages',
    description: 'Foodpanda is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const AENOTECA = {
    id: 37,
    name: 'AEnoteca',
    category: 'Food & Beverages',
    description: 'AEnoteca is a public listing in Vientiane.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const STATE_FOOD_GARMENT = {
    id: 976,
    name: 'Vientiane State Food Enterprise',
    category: 'Garment',
    description: 'Vientiane State Food Enterprise is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const HOTEL_ASSOCIATION = {
    id: 209,
    name: 'Hotel and Restaurant Association of Lao PDR',
    category: 'Association',
    description: 'Hotel and Restaurant Association of Lao PDR is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
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
    status: 'active',
    is_featured: false
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
    status: 'active',
    is_featured: false
};

const SINOUK_CAFE = {
    id: 917,
    name: 'Sinouk Café LAO., LTD',
    category: 'Manufacture',
    description: 'Sinouk Café LAO., LTD is listed in the LNCCI Membership Directory.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const VIENTIANE_COLD_STORAGE = {
    id: 607,
    name: 'Vientiane Cold Storage Sole Co.,Ltd',
    category: 'Trading and Service',
    description: 'Vientiane Cold Storage Sole Co.,Ltd is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

const DELUXE_SUPERMARKET = {
    id: 148,
    name: 'Deluxe Frozen Food Supermarket',
    category: 'importer',
    description: 'Deluxe Frozen Food Supermarket is a public listing.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

// Test double only: construction copy, not used to invent listings.
const CONSTRUCTION_DOUBLE = {
    id: 2,
    name: 'Mohona Construction Company Limited',
    category: 'Construction company',
    description: 'A construction company in Vientiane.',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

// Test double only: a row that already contains "japanese" in catalog text.
// Not a live sushi listing and not added to any database.
const ROW_WITH_JAPANESE = {
    id: 1,
    name: 'Catalog restaurant mentioning japanese',
    category: 'japanese restaurant',
    description: 'Existing catalog text includes japanese.',
    address: 'Vientiane, Lao PDR',
    country: 'LA',
    city: 'Vientiane',
    keywords: [],
    status: 'active',
    is_featured: false
};

test('drops stopwords and country-generic tokens from content AND', () => {
    const coffeeVte = parseSearchQuery('coffee in Vientiane');
    assert.deepEqual(coffeeVte.contentTerms, ['coffee', 'vientiane']);
    assert.equal(coffeeVte.isEmpty, false);

    const anz = parseSearchQuery('ANZ bank Laos');
    assert.deepEqual(anz.contentTerms, ['anz', 'bank']);
    assert.deepEqual(anz.locationTerms.map((loc) => loc.token), ['laos']);

    const coffee = parseSearchQuery('coffee');
    assert.deepEqual(coffee.contentTerms, ['coffee']);

    assert.equal(parseSearchQuery('the a for and').isEmpty, true);
    assert.equal(parseSearchQuery('laos').isEmpty, true);
    assert.equal(parseSearchQuery('Lao PDR').isLocationOnly, true);
});

test('SQL ANDs content tokens and hard-codes status=active', () => {
    const parsed = parseSearchQuery('ANZ bank Laos');
    const { sql, params } = buildContentSearchSql(parsed, 'pg');

    assert.match(sql, /status = 'active'/);
    assert.match(sql, / AND /);
    assert.doesNotMatch(sql, /\) OR \(/);
    assert.deepEqual(params, ['%anz%', '%bank%']);
    assert.ok(!params.some((value) => String(value).includes('laos')));
});

test('location-only country words do not produce a catalog-dump query', () => {
    const { sql, params } = buildContentSearchSql(parseSearchQuery('laos'), 'pg');
    assert.equal(sql, null);
    assert.deepEqual(params, []);

    assert.equal(parseSearchQuery('Vientiane').isLocationOnly, true);
    assert.equal(parseSearchQuery('In Tokyo?').isLocationOnly, true);
    const cityOnly = buildContentSearchSql(parseSearchQuery('In Vientiane?'), 'pg');
    assert.equal(cityOnly.sql, null);
    assert.deepEqual(parseSearchQuery('coffee in Vientiane').contentTerms, ['coffee', 'vientiane']);
});

test('ANZ bank Laos ranks the live ANZ Lao Branch first', () => {
    const parsed = parseSearchQuery('ANZ bank Laos');
    const ranked = rankBusinesses(
        [VANMAI_COFFEE, KHANG_COMPANY, ANZ_LAO_BRANCH, YUNI_COFFEE],
        parsed
    );

    assert.equal(ranked[0].id, 1708);
    assert.ok(scoreBusiness(ANZ_LAO_BRANCH, parsed) > scoreBusiness(VANMAI_COFFEE, parsed));
    assert.ok(scoreBusiness(VANMAI_COFFEE, parsed) < 100, 'coffee-only rows should not look like ANZ hits');
});

test('coffee in Vientiane prefers coffee rows in Vientiane', () => {
    const parsed = parseSearchQuery('coffee in Vientiane');
    const ranked = rankBusinesses(
        [KHANG_COMPANY, VANMAI_COFFEE, ANZ_LAO_BRANCH, YUNI_COFFEE],
        parsed
    );

    assert.deepEqual(ranked.slice(0, 2).map((row) => row.id).sort(), [1669, 1725]);
    assert.ok(ranked[0].name.toLowerCase().includes('coffee'));
    assert.equal(ranked[0].city, 'Vientiane');
});

test('single-word coffee still matches coffee businesses', () => {
    const parsed = parseSearchQuery('coffee');
    assert.ok(scoreBusiness(VANMAI_COFFEE, parsed) >= 100);
    assert.ok(scoreBusiness(ANZ_LAO_BRANCH, parsed) < scoreBusiness(VANMAI_COFFEE, parsed));
});

test('best coffee places searches coffee only; hello does not search', () => {
    const coffee = buildContentSearchSql(parseSearchQuery('best coffee places'), 'pg');
    assert.deepEqual(coffee.params, ['%coffee%']);
    assert.match(coffee.sql, /status = 'active'/);

    const greeting = buildContentSearchSql(parseSearchQuery('hello'), 'pg');
    assert.equal(greeting.sql, null);
    assert.deepEqual(greeting.params, []);
    assert.equal(isGreeting('hello'), true);
    assert.equal(isGreeting('hi'), true);
    assert.equal(isGreeting('hey please'), true);
    assert.equal(isGreeting('show me some places'), false);
});

test('conversational prompts drop leftover tokens that are not in listing text', () => {
    assert.deepEqual(parseSearchQuery('best coffee places').contentTerms, ['coffee']);
    assert.deepEqual(parseSearchQuery('Find a good coffee shop in Vientiane').contentTerms, ['coffee', 'vientiane']);
    assert.deepEqual(parseSearchQuery('I need a lawyer').contentTerms, ['lawyer']);
    assert.deepEqual(parseSearchQuery('which is good for working?').contentTerms, ['working']);
    assert.deepEqual(parseSearchQuery('do they have wifi?').contentTerms, ['wifi']);
    assert.equal(parseSearchQuery('hello').isEmpty, true);
    assert.equal(parseSearchQuery('hi').isEmpty, true);
    assert.equal(parseSearchQuery('hey please').isEmpty, true);
    assert.ok(!parseSearchQuery('hello').contentTerms.includes('hello'));
    assert.deepEqual(parseSearchQuery("I'm hungry").contentTerms, []);
    assert.deepEqual(parseSearchQuery('what should I eat?').contentTerms, []);
    assert.deepEqual(parseSearchQuery('bored').contentTerms, []);
    assert.deepEqual(parseSearchQuery('help').contentTerms, []);
    assert.deepEqual(parseSearchQuery('sushi in Vientiane').contentTerms, ['sushi', 'vientiane']);
});

test('retry uses the strongest leftover token (coffee, not the city)', () => {
    assert.deepEqual(strongestContentTerms(['coffee', 'vientiane']), ['coffee']);
    assert.deepEqual(strongestContentTerms(['coffee', 'xyzzy']), ['coffee']);

    const retry = nextRetryQuery(parseSearchQuery('coffee xyzzy'));
    assert.ok(retry);
    assert.deepEqual(retry.contentTerms, ['coffee']);
    assert.equal(nextRetryQuery(parseSearchQuery('coffee')), null);
    assert.equal(nextRetryQuery(parseSearchQuery('hello')), null);
});

test('searchWithRetry falls back once when AND is empty', async () => {
    const calls = [];
    const execute = async (parsed) => {
        calls.push(parsed.contentTerms.slice());
        if (parsed.contentTerms.length > 1) return [];
        return [VANMAI_COFFEE];
    };

    const { results, retried } = await searchWithRetry('coffee xyzzy', execute);
    assert.equal(retried, true);
    assert.deepEqual(calls, [['coffee', 'xyzzy'], ['coffee']]);
    assert.equal(results[0].id, 1725);

    const emptyAnd = await searchWithRetry('hello', async () => []);
    assert.deepEqual(emptyAnd.results, []);
    assert.equal(emptyAnd.retried, false);
});

test('decodeMojibake repairs UTF-8 read as Latin-1 and leaves valid copy alone', () => {
    assert.equal(decodeMojibake('CafÃ©'), 'Café');
    const lao = 'ວຽງຈັນ';
    const smashed = Buffer.from(lao, 'utf8').toString('latin1');
    assert.match(smashed, /àº/);
    assert.equal(decodeMojibake(smashed), lao);
    assert.equal(decodeMojibake('Café'), 'Café');
    assert.equal(decodeMojibake('Vanmai Coffee Cooperative'), 'Vanmai Coffee Cooperative');
});

test('follow-ups append previous city and category words', () => {
    const history = ['best coffee places'];
    assert.equal(isFollowUp('cheaper?'), true);
    assert.equal(isFollowUp('open late?'), true);
    assert.equal(isFollowUp('any others?'), true);
    assert.equal(isFollowUp('In Vientiane?'), true);
    assert.equal(isFollowUp('which is good for working?'), true);
    assert.equal(isFollowUp('do they have wifi?'), true);
    assert.equal(isFollowUp('any reviews?'), true);
    assert.equal(isFollowUp('good for laptop?'), true);
    assert.equal(isFollowUp('in Vientiane only'), true);
    assert.equal(isFollowUp('best coffee places'), false);
    assert.equal(isFollowUp('hello'), false);
    assert.equal(isFollowUp('tell me about the first one'), true);
    assert.equal(isFollowUp('Tell me about it'), true);
    assert.equal(isFollowUp('that one'), true);
    assert.equal(isFollowUp('that cafe'), true);
    assert.equal(isFollowUp('the second'), true);
    assert.equal(isFollowUp('First Commercial Bank'), false);
    assert.equal(isFollowUp('What about sushi?'), false);
    assert.deepEqual(
        parseSearchQuery('I just landed in Vientiane, where should I get coffee?').contentTerms,
        ['vientiane', 'coffee']
    );

    assert.equal(reformulateWithHistory('cheaper?', history), 'cheaper? coffee');
    assert.equal(reformulateWithHistory('which is good for working?', history), 'which is good for working? coffee');
    assert.equal(reformulateWithHistory('do they have wifi?', history), 'do they have wifi? coffee');
    assert.equal(reformulateWithHistory('in Vientiane only', history), 'in Vientiane only coffee');
    assert.equal(reformulateWithHistory('In Vientiane?', history), 'In Vientiane? coffee');
    assert.equal(reformulateWithHistory('Hotels instead?', history), 'Hotels instead?');
    assert.equal(
        reformulateWithHistory('Hotels instead?', ['coffee in Vientiane']),
        'Hotels instead? vientiane'
    );
    assert.equal(
        reformulateWithHistory('any others?', ['coffee in Vientiane']),
        'any others? coffee vientiane'
    );
    assert.equal(reformulateWithHistory('best coffee places', history), 'best coffee places');
    assert.deepEqual(parseHistoryParam('coffee|hello|vientiane hotels'), ['coffee', 'hello', 'vientiane hotels']);
});

test('assistant line changes with the prompt and never invents a name', () => {
    const coffee = parseSearchQuery('best coffee places');
    const coffeeLine = buildAssistantLine({
        query: 'best coffee places',
        parsed: coffee,
        results: [VANMAI_COFFEE, YUNI_COFFEE]
    });
    assert.equal(coffeeLine, 'Here are coffee spots in Vientiane.');
    assert.doesNotMatch(coffeeLine, /Of course! Here are a few places in Asia/);
    assert.doesNotMatch(coffeeLine, /Vanmai|Yuni/);

    const hotelLine = buildAssistantLine({
        query: 'hotels in Vientiane',
        parsed: parseSearchQuery('hotels in Vientiane'),
        results: [{ city: 'Vientiane', name: 'Salana Boutique Hotel' }]
    });
    assert.equal(hotelLine, 'Here are hotels in Vientiane.');
    assert.notEqual(hotelLine, coffeeLine);

    assert.equal(buildAssistantLine({ query: 'hello', results: [] }), GREETING_LINE);
    assert.equal(buildAssistantLine({ query: 'lawyer', results: [] }), EMPTY_LINE);
    assert.equal(buildAssistantLine({ query: 'ramen in Tokyo', results: [] }), EMPTY_OUTSIDE_LINE);
    assert.equal(buildAssistantLine({
        query: 'coffee',
        parsed: coffee,
        results: [VANMAI_COFFEE, YUNI_COFFEE],
        truncated: true
    }), TOO_MANY_LINE);
    assert.equal(buildAssistantLine({
        query: 'xyzzy',
        parsed: { contentTerms: [], locationTerms: [], isEmpty: true, isLocationOnly: false },
        results: [{ name: 'Khang Company' }],
        retried: true
    }), WEAK_LINE);
});

test('follow-up chips after a listing set stay on the set', () => {
    const coffeeNoCity = buildFollowUpChips({
        parsed: parseSearchQuery('best coffee places'),
        results: [VANMAI_COFFEE]
    });
    assert.ok(coffeeNoCity.includes('In Vientiane?'));
    assert.ok(coffeeNoCity.includes('Any others?') || coffeeNoCity.includes('Open late?'));
    assert.ok(!coffeeNoCity.some((chip) => /Hotels|Banks|Eat\?|Lawyers/i.test(chip)));

    const coffeeInCity = buildFollowUpChips({
        parsed: parseSearchQuery('coffee in Vientiane'),
        results: [VANMAI_COFFEE]
    });
    assert.equal(coffeeInCity.includes('In Vientiane?'), false);
    assert.ok(coffeeInCity.includes('Any others?'));
    assert.ok(coffeeInCity.includes('Open late?'));
    assert.ok(!coffeeInCity.some((chip) => /Hotels|Banks|Eat\?|Lawyers/i.test(chip)));
});

test('coffee ranks cafe names above factory and machineries', () => {
    const parsed = parseSearchQuery('coffee');
    const ranked = rankBusinesses(
        [COFFEE_FIX, MIRACLE_COFFEE_FACTORY, ASTER_COFFEE_HOUSE, COMMA_COFFEE, SAFFRON_COFFEE],
        parsed
    );
    const names = ranked.map((row) => row.name);
    const cafeIds = ranked
        .filter((row) => ['ASTER COFFEE HOUSE', 'Comma Coffee', 'Saffron Coffee'].includes(row.name))
        .map((row) => row.id);
    const factoryIdx = names.indexOf('Miracle Lao Coffee Factory Sole Co.,Ltd');
    const machinesIdx = names.indexOf('Coffee Fix');

    assert.deepEqual(ranked.slice(0, 3).map((row) => row.id).sort(), cafeIds.slice().sort());
    assert.ok(names.indexOf('ASTER COFFEE HOUSE') < factoryIdx);
    assert.ok(names.indexOf('Comma Coffee') < factoryIdx);
    assert.ok(names.indexOf('Saffron Coffee') < factoryIdx);
    assert.ok(names.indexOf('ASTER COFFEE HOUSE') < machinesIdx);
    assert.ok(names.indexOf('Comma Coffee') < machinesIdx);
    assert.ok(factoryIdx !== -1 && machinesIdx !== -1, 'factories still match, just later');
    assert.ok(scoreBusiness(ASTER_COFFEE_HOUSE, parsed) > scoreBusiness(COFFEE_FIX, parsed));
    assert.ok(scoreBusiness(COMMA_COFFEE, parsed) > scoreBusiness(MIRACLE_COFFEE_FACTORY, parsed));
});

test('japanese restaurant stays AND and does not return a western-only restaurant', async () => {
    const parsed = parseSearchQuery('japanese restaurant');
    assert.deepEqual(parsed.contentTerms, ['japanese', 'restaurant']);
    assert.equal(nextRetryQuery(parsed), null);
    assert.deepEqual(parseSearchQuery('lao restaurant').contentTerms, ['lao', 'restaurant']);
    assert.equal(nextRetryQuery(parseSearchQuery('sushi restaurant')), null);

    const sql = buildContentSearchSql(parsed, 'pg');
    assert.deepEqual(sql.params, ['%japanese%', '%restaurant%']);
    assert.match(sql.sql, / AND /);
    assert.doesNotMatch(sql.sql, /\) OR \(/);

    const ranked = rankBusinesses([HIGHLAND_GARDEN, WAN_XIANG], parsed);
    assert.deepEqual(ranked, []);
    assert.equal(ranked.some((row) => row.id === 206), false);

    const withJapanese = rankBusinesses([HIGHLAND_GARDEN, ROW_WITH_JAPANESE, WAN_XIANG], parsed);
    assert.deepEqual(withJapanese.map((row) => row.id), [1]);
    assert.ok(withJapanese[0].category.includes('japanese'));

    const calls = [];
    const { results, retried } = await searchWithRetry('japanese restaurant', async (plan) => {
        calls.push(plan.contentTerms.slice());
        if (plan.contentTerms.length === 1 && plan.contentTerms[0] === 'restaurant') {
            return [HIGHLAND_GARDEN];
        }
        return [];
    });
    assert.equal(retried, false);
    assert.deepEqual(calls, [['japanese', 'restaurant']]);
    assert.deepEqual(results, []);
});

test('food in Vientiane prefers Food & Beverages over Garment and Cold Storage', () => {
    const parsed = parseSearchQuery('food in Vientiane');
    assert.deepEqual(parsed.contentTerms, ['food', 'vientiane']);

    const ranked = rankBusinesses(
        [STATE_FOOD_GARMENT, VIENTIANE_COLD_STORAGE, FOODPANDA, AENOTECA, DELUXE_SUPERMARKET],
        parsed
    );
    const names = ranked.map((row) => row.name);
    const preferred = ['Foodpanda - Delivery Hero (Lao) Sole Co. Ltd', 'AEnoteca', 'Deluxe Frozen Food Supermarket'];
    const lastPreferred = Math.max(...preferred.map((name) => names.indexOf(name)));
    assert.ok(lastPreferred !== -1);
    assert.ok(lastPreferred < names.indexOf('Vientiane State Food Enterprise'));
    assert.ok(lastPreferred < names.indexOf('Vientiane Cold Storage Sole Co.,Ltd'));
    assert.ok(names.includes('Vientiane State Food Enterprise'));
});

test('hungry stays empty for search; hello still does not search', () => {
    assert.deepEqual(parseSearchQuery("I'm hungry").contentTerms, []);
    assert.equal(parseSearchQuery("I'm hungry").isEmpty, true);
    assert.equal(buildContentSearchSql(parseSearchQuery("I'm hungry"), 'pg').sql, null);
    assert.equal(parseSearchQuery('hello').isEmpty, true);
    assert.deepEqual(parseSearchQuery('what should I eat?').contentTerms, []);
});

test('restaurants expands to restaurant without dumping hospitality-only rows', () => {
    const parsed = parseSearchQuery('restaurants');
    assert.deepEqual(termAliases('restaurants'), ['restaurants', 'restaurant']);
    const sql = buildContentSearchSql(parsed, 'pg');
    assert.ok(sql.params.includes('%restaurant%'));
    assert.doesNotMatch(sql.sql, /\) OR \(/);

    const kualao = {
        id: 3,
        name: 'Kualao Restaurant',
        category: 'tourism',
        description: 'A public listing.',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const hospitalityOnly = {
        id: 4,
        name: 'Generic hospitality row',
        category: "['hospitality']",
        description: 'A public listing.',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    assert.equal(mapListing(kualao).sub, 'restaurant');
    assert.ok(scoreBusiness(kualao, parsed) > scoreBusiness(hospitalityOnly, parsed));
});

test('search payload decodes mojibake on listing name and description', () => {
    const smashed = 'CafÃ© Sinouk';
    const ranked = rankBusinesses(
        [{
            id: 917,
            name: smashed,
            category: 'Manufacture',
            description: 'CafÃ© in Vientiane',
            address: 'Vientiane, Lao PDR',
            country: 'LA',
            city: 'Vientiane',
            keywords: ['coffee'],
            status: 'active',
            is_featured: false
        }],
        parseSearchQuery('coffee')
    );
    assert.equal(ranked[0].name, 'Café Sinouk');
    assert.equal(ranked[0].description, 'Café in Vientiane');
});

test('coffee name cafe/café/coffee house beats Manufacture and Business Services', () => {
    const parsed = parseSearchQuery('coffee');
    assert.equal(nameLooksCafe(ASTER_COFFEE_HOUSE), true);
    assert.equal(nameLooksCafe(SINOUK_CAFE), true);
    assert.equal(nameLooksCafe({ name: 'CafÃ© Sinouk', category: 'Manufacture' }), true);
    assert.equal(nameLooksCafe(COMMA_COFFEE), false);
    assert.equal(nameLooksCafe(COFFEE_FIX), false);
    assert.equal(nameLooksCafe(MIRACLE_COFFEE_FACTORY), false);

    const ranked = rankBusinesses(
        [YUNI_COFFEE, COFFEE_FIX, MIRACLE_COFFEE_FACTORY, SINOUK_CAFE, ASTER_COFFEE_HOUSE],
        parsed
    );
    const names = ranked.map((row) => row.name);
    assert.ok(names.indexOf('ASTER COFFEE HOUSE') < names.indexOf('Yuni Coffee Company, Ltd.'));
    assert.ok(names.indexOf('Sinouk Café LAO., LTD') < names.indexOf('Yuni Coffee Company, Ltd.'));
    assert.ok(names.indexOf('Sinouk Café LAO., LTD') < names.indexOf('Coffee Fix'));
    assert.ok(names.indexOf('Sinouk Café LAO., LTD') < names.indexOf('Miracle Lao Coffee Factory Sole Co.,Ltd'));
    assert.ok(scoreBusiness(SINOUK_CAFE, parsed) > scoreBusiness(YUNI_COFFEE, parsed));
    assert.ok(scoreBusiness(SINOUK_CAFE, parsed) > scoreBusiness(COFFEE_FIX, parsed));
    assert.equal(SINOUK_CAFE.category, 'Manufacture');
});

test('hotel queries demote Hotel and Restaurant Association below actual hotels', () => {
    const parsed = parseSearchQuery('hotel');
    const ranked = rankBusinesses(
        [HOTEL_ASSOCIATION, SALANA_HOTEL, VILLA_MALY_HOTEL],
        parsed
    );
    const names = ranked.map((row) => row.name);
    assert.ok(names.indexOf('Salana Boutique Hotel') < names.indexOf('Hotel and Restaurant Association of Lao PDR'));
    assert.ok(names.indexOf('Villa Maly Boutique Hotel') < names.indexOf('Hotel and Restaurant Association of Lao PDR'));
    assert.ok(names.includes('Hotel and Restaurant Association of Lao PDR'), 'association still matches, just later');
    assert.ok(scoreBusiness(SALANA_HOTEL, parsed) > scoreBusiness(HOTEL_ASSOCIATION, parsed));
    assert.ok(scoreBusiness(VILLA_MALY_HOTEL, parsed) > scoreBusiness(HOTEL_ASSOCIATION, parsed));
    assert.equal(HOTEL_ASSOCIATION.category, 'Association');
    assert.equal(SALANA_HOTEL.category, 'tourism');
});

test('copy-token keywords boost chinese+developer and filter wifi / apartment rental', () => {
    const taggedDeveloper = {
        id: 9001,
        name: 'Catalog construction developer',
        category: 'construction',
        description: 'Chinese construction developer',
        address: 'Vientiane, Lao PDR',
        country: 'LA',
        city: 'Vientiane',
        keywords: ['chinese', 'construction', 'developer'],
        status: 'active',
        is_featured: false
    };
    const untaggedConstruction = {
        ...CONSTRUCTION_DOUBLE,
        id: 9002,
        keywords: []
    };
    const parsed = parseSearchQuery('chinese developer');
    assert.deepEqual(parsed.contentTerms, ['chinese', 'developer']);
    assert.equal(nextRetryQuery(parsed), null);

    const ranked = rankBusinesses([untaggedConstruction, taggedDeveloper], parsed);
    assert.deepEqual(ranked.map((row) => row.id), [9001]);
    assert.ok(scoreBusiness(taggedDeveloper, parsed) > scoreBusiness(untaggedConstruction, parsed));

    const wifiCafe = {
        id: 9003,
        name: 'Catalog cafe with wifi word',
        category: 'cafe',
        description: 'A cafe with wifi.',
        city: 'Vientiane',
        country: 'LA',
        keywords: ['cafe', 'wifi'],
        status: 'active'
    };
    const cafeNoWifi = {
        id: 9004,
        name: 'Catalog cafe without that word',
        category: 'cafe',
        description: 'A neighborhood cafe.',
        city: 'Vientiane',
        country: 'LA',
        keywords: ['cafe'],
        status: 'active'
    };
    const wifiParsed = parseSearchQuery('wifi cafe');
    assert.ok(wifiParsed.contentTerms.includes('wifi'));
    const wifiRanked = rankBusinesses([cafeNoWifi, wifiCafe], wifiParsed);
    assert.deepEqual(wifiRanked.map((row) => row.id), [9003]);

    const rental = {
        id: 9005,
        name: 'Catalog apartment rental',
        category: 'rental',
        description: 'Apartment rental listing.',
        city: 'Vientiane',
        country: 'LA',
        keywords: ['apartment', 'rental'],
        status: 'active'
    };
    const rentalParsed = parseSearchQuery('apartment rental');
    assert.deepEqual(rentalParsed.contentTerms, ['apartment', 'rental']);
    assert.deepEqual(rankBusinesses([cafeNoWifi, rental], rentalParsed).map((row) => row.id), [9005]);
});

test('currently building does not dump construction firms; missing wifi is empty', () => {
    const construction = {
        id: 9006,
        name: 'Mohona Construction Company Limited',
        category: 'construction',
        description: 'A construction company in Vientiane.',
        city: 'Vientiane',
        country: 'LA',
        keywords: ['construction'],
        status: 'active'
    };
    const currently = {
        id: 9007,
        name: 'Catalog site notice',
        category: 'construction',
        description: 'Currently building a hotel.',
        city: 'Vientiane',
        country: 'LA',
        keywords: ['currently building', 'building', 'hotel', 'construction'],
        status: 'active'
    };

    const parsed = parseSearchQuery('currently building');
    assert.deepEqual(parsed.contentTerms, ['currently building']);
    assert.equal(nextRetryQuery({ ...parsed, contentTerms: ['currently building', 'vientiane'] }), null);

    const sql = buildContentSearchSql(parsed, 'pg');
    assert.deepEqual(sql.params, ['%currently building%']);
    assert.doesNotMatch(sql.sql, /%building%/);

    const ranked = rankBusinesses([construction, currently], parsed);
    assert.deepEqual(ranked.map((row) => row.id), [9007]);
    assert.equal(ranked.some((row) => row.id === 9006), false);

    const wifiOnly = parseSearchQuery('do they have wifi?');
    assert.deepEqual(wifiOnly.contentTerms, ['wifi']);
    assert.deepEqual(rankBusinesses([construction, HIGHLAND_GARDEN, VANMAI_COFFEE], wifiOnly), []);
    assert.equal(buildAssistantLine({
        query: 'do they have wifi?',
        parsed: wifiOnly,
        results: []
    }), EMPTY_LINE);
});

test('named category match excludes school from hotels and bank from lawyer', () => {
    const school = {
        id: 1810,
        name: 'Vientiane International School',
        category: 'Education',
        description: 'An international school in Vientiane, good for families. Near hotels.',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const hotelParsed = parseSearchQuery('hotels in Vientiane good for families');
    assert.deepEqual(hotelParsed.contentTerms, ['hotels', 'vientiane']);
    assert.equal(nextRetryQuery(hotelParsed), null);
    const hotelRanked = rankBusinesses([school, SALANA_HOTEL, HOTEL_ASSOCIATION], hotelParsed);
    assert.equal(hotelRanked.some((row) => row.id === 1810), false);
    assert.ok(hotelRanked.some((row) => row.id === 486));

    const lawyerParsed = parseSearchQuery('lawyer in Vientiane');
    const bank = ANZ_LAO_BRANCH;
    const lawyer = {
        id: 150,
        name: 'DFDL (Lao) Sole Co. Ltd',
        category: 'Legal & Tax',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const ariya = {
        id: 1902,
        name: 'Ariya',
        category: 'Business Services',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const lawyerRanked = rankBusinesses([bank, ariya, lawyer], lawyerParsed);
    assert.equal(lawyerRanked.some((row) => row.id === 1708), false);
    assert.equal(lawyerRanked.some((row) => row.id === 1902), false);
    assert.deepEqual(lawyerRanked.map((row) => row.id), [150]);
    assert.equal(
        buildAssistantLine({ query: 'lawyer in Vientiane', parsed: lawyerParsed, results: lawyerRanked }),
        'Here are lawyer matches in Vientiane.'
    );
    assert.notEqual(
        buildAssistantLine({ query: 'lawyer in Vientiane', parsed: lawyerParsed, results: [bank] }),
        'Here are lawyer matches in Vientiane.'
    );
});

test('construction query excludes consulting/PPE unless the trade is on the row', () => {
    const industek = {
        id: 1903,
        name: 'IndusTek',
        category: 'Consulting',
        description: 'PPE and consulting for construction sites in Vientiane.',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const parsed = parseSearchQuery('construction companies in Vientiane');
    assert.deepEqual(parsed.contentTerms, ['construction', 'vientiane']);
    const ranked = rankBusinesses([industek, CONSTRUCTION_DOUBLE], parsed);
    assert.equal(ranked.some((row) => /industek/i.test(row.name)), false);
    assert.ok(ranked.some((row) => row.id === 2));
    assert.equal(rowMatchesNamedCategory(industek, namedCategoryConstraint(['construction'])), false);
    assert.equal(rowMatchesNamedCategory(CONSTRUCTION_DOUBLE, namedCategoryConstraint(['construction'])), true);
});

test('cheaper ones keeps Luang Prabang hotels; explicit city may switch', () => {
    assert.equal(
        reformulateWithHistory('cheaper ones', ['hotels in Luang Prabang']),
        'cheaper ones hotels luang prabang'
    );
    const parsed = parseSearchQuery('cheaper ones hotels luang prabang');
    assert.deepEqual(parsed.contentTerms, ['hotels', 'luang', 'prabang']);
    const champasak = {
        id: 1901,
        name: 'Champasak Palace Hotel',
        category: 'tourism',
        city: 'Champasak',
        country: 'LA',
        status: 'active'
    };
    const ranked = rankBusinesses([SALANA_HOTEL, VILLA_MALY_HOTEL, champasak], parsed);
    assert.ok(ranked.every((row) => /luang prabang/i.test(row.city)));
    assert.equal(ranked.some((row) => /vientiane|champasak/i.test(row.city)), false);

    assert.equal(
        reformulateWithHistory('in Vientiane only', ['restaurants in Luang Prabang']),
        'in Vientiane only restaurants'
    );
});

test('Vang Vieng stay does not promote Vientiane hotels from a description mention', () => {
    const parsed = parseSearchQuery('place to stay in Vang Vieng');
    assert.ok(parsed.contentTerms.includes('stay'));
    assert.ok(parsed.contentTerms.includes('vang'));
    assert.ok(parsed.contentTerms.includes('vieng'));
    assert.equal(nextRetryQuery(parsed), null);

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
    const vangViengHotel = {
        id: 9402,
        name: 'Amari Vang Vieng Hotel',
        category: 'tourism',
        description: 'A hotel in Vang Vieng.',
        address: 'Vang Vieng, Laos',
        city: 'Vang Vieng',
        country: 'LA',
        status: 'active'
    };

    const empty = rankBusinesses([vientianeHotel], parsed);
    assert.deepEqual(empty, []);
    assert.notEqual(
        buildAssistantLine({ query: 'place to stay in Vang Vieng', parsed, results: [vientianeHotel] }),
        'Here are stay matches in Vang Vieng.'
    );
    assert.equal(
        buildAssistantLine({ query: 'place to stay in Vang Vieng', parsed, results: [] }),
        EMPTY_LINE
    );

    const ranked = rankBusinesses([vientianeHotel, vangViengHotel], parsed);
    assert.deepEqual(ranked.map((row) => row.id), [9402]);
    assert.equal(
        buildAssistantLine({ query: 'place to stay in Vang Vieng', parsed, results: ranked }),
        'Here are stay matches in Vang Vieng.'
    );
    assert.deepEqual(
        dropMismatchedRequestedCity([vientianeHotel], parsed),
        []
    );
});

test('follow-up chips never repeat In Vientiane', () => {
    const lawyerChips = buildFollowUpChips({
        parsed: parseSearchQuery('lawyer'),
        results: [ANZ_LAO_BRANCH]
    });
    const vientianeChips = lawyerChips.filter((chip) => chip === 'In Vientiane?');
    assert.equal(vientianeChips.length, 1);
    assert.deepEqual(lawyerChips, uniqueChips(lawyerChips));

    const coffeeCity = buildFollowUpChips({
        parsed: parseSearchQuery('coffee in Vientiane'),
        results: [VANMAI_COFFEE]
    });
    assert.equal(coffeeCity.filter((chip) => chip === 'In Vientiane?').length, 0);
    assert.deepEqual(coffeeCity, uniqueChips(coffeeCity));
});

test('construction query excludes a Fitness/Gym name even when category says Construction', () => {
    const gym = {
        id: 9501,
        name: 'Vientiane Fitness',
        category: 'Construction',
        description: 'A gym. Description must not drive this.',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    const parsed = parseSearchQuery('construction companies in Vientiane');
    assert.equal(rowMatchesNamedCategory(gym, namedCategoryConstraint(['construction'])), false);
    const ranked = rankBusinesses([gym, CONSTRUCTION_DOUBLE], parsed);
    assert.equal(ranked.some((row) => /fitness|gym/i.test(row.name)), false);
    assert.ok(ranked.some((row) => row.id === 2));
});

