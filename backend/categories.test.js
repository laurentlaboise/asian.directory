'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    mapListing,
    countMapped,
    pickClarifyChips,
    chipHasCoverage,
    TREE,
    PARENTS,
    flattenCategoryValue
} = require('./categories');
const { parseSearchQuery, scoreBusiness, rankBusinesses, buildContentSearchSql } = require('./search-query');
const { handleChatRequest, FOOD_CLARIFY_REPLY } = require('./chat');

const CAFE_BUSINESS_SERVICES = {
    id: 1,
    name: 'The Art House Cafe',
    category: 'Business Services',
    description: 'A public listing. Do not read amenities from this text.',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

const CONSTRUCTION_COMPANY = {
    id: 2,
    name: 'Mohona Construction Company Limited',
    category: 'Construction company',
    description: 'A construction company in Vientiane.',
    city: 'Vientiane',
    country: 'LA',
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

const KUALAO_RESTAURANT = {
    id: 3,
    name: 'Kualao Restaurant',
    category: 'tourism',
    description: 'Kualao Restaurant is a food and beverage in Vientiane.',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

const HOSPITALITY_JSON = {
    id: 4,
    name: 'Generic hospitality row',
    category: "['hospitality']",
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

const WESTERN_RESTAURANT = {
    id: 206,
    name: 'Highland Garden Restaurant Vientiane',
    category: 'western restaurant',
    description: 'A western restaurant. Description mentions nothing about sushi.',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

const VANMAI_COFFEE = {
    id: 1725,
    name: 'Vanmai Coffee Cooperative',
    category: 'Services',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

const SALANA_HOTEL = {
    id: 486,
    name: 'Salana Boutique Hotel',
    category: 'tourism',
    city: 'Vientiane',
    country: 'LA',
    status: 'active'
};

test('controlled tree has the Yellow Pages / consumer parents', () => {
    const ids = Object.keys(PARENTS);
    for (const id of [
        'food_drink', 'hotels_travel', 'shopping', 'health', 'beauty',
        'education', 'legal_professional', 'banks_finance', 'construction',
        'industry_agriculture', 'automotive', 'real_estate', 'transport',
        'technology', 'government_ngo', 'associations', 'entertainment', 'other'
    ]) {
        assert.ok(ids.includes(id), id);
        assert.ok(TREE[id].subs.length > 0, `${id} has subs`);
    }
});

test('Business Services + name Cafe maps to food_drink/cafe', () => {
    const mapped = mapListing(CAFE_BUSINESS_SERVICES);
    assert.equal(mapped.primary, 'food_drink');
    assert.equal(mapped.sub, 'cafe');
    assert.equal(mapped.label, 'Cafe');
    assert.equal(CAFE_BUSINESS_SERVICES.category, 'Business Services');
});

test('Construction company maps to construction', () => {
    const mapped = mapListing(CONSTRUCTION_COMPANY);
    assert.equal(mapped.primary, 'construction');
    assert.match(mapped.sub, /builder|contractor|engineering/);
});

test('DFDL Legal & Tax maps to legal_professional', () => {
    const mapped = mapListing(DFDL_LEGAL);
    assert.equal(mapped.primary, 'legal_professional');
    assert.equal(mapped.sub, 'lawyer');

    const fromName = mapListing({
        name: 'DFDL Legal & Tax',
        category: 'Business Services'
    });
    assert.equal(fromName.primary, 'legal_professional');
});

test('does not invent sushi/japanese/ramen when those tokens are absent', () => {
    for (const row of [CAFE_BUSINESS_SERVICES, CONSTRUCTION_COMPANY, DFDL_LEGAL, KUALAO_RESTAURANT, WESTERN_RESTAURANT]) {
        const mapped = mapListing(row);
        assert.notEqual(mapped.sub, 'sushi', row.name);
        assert.notEqual(mapped.sub, 'japanese', row.name);
        assert.notEqual(mapped.sub, 'ramen', row.name);
        assert.doesNotMatch(mapped.label, /sushi|japanese|ramen/i);
    }
    assert.equal(mapListing(WESTERN_RESTAURANT).sub, 'western');
    assert.equal(mapListing(KUALAO_RESTAURANT).primary, 'food_drink');
    assert.equal(mapListing(KUALAO_RESTAURANT).sub, 'restaurant');
});

test('JSON array category [\'hospitality\'] maps without inventing cuisine', () => {
    assert.deepEqual(flattenCategoryValue("['hospitality']"), ['hospitality']);
    const mapped = mapListing(HOSPITALITY_JSON);
    assert.equal(mapped.primary, 'hotels_travel');
    assert.notEqual(mapped.sub, 'sushi');
});

test('restaurants query aliases hit tourism rows whose name already says restaurant', () => {
    const parsed = parseSearchQuery('restaurants');
    const sql = buildContentSearchSql(parsed, 'pg');
    assert.ok(sql.params.some((value) => value.includes('restaurant')));
    assert.doesNotMatch(sql.sql, /\) OR \(/);

    assert.ok(scoreBusiness(KUALAO_RESTAURANT, parsed) >= 100);
    const ranked = rankBusinesses([CONSTRUCTION_COMPANY, KUALAO_RESTAURANT, HOSPITALITY_JSON], parsed);
    assert.equal(ranked[0].name, 'Kualao Restaurant');
    assert.equal(KUALAO_RESTAURANT.category, 'tourism');
});

test('consumer parent query boosts food_drink/hotels_travel/legal over industry', () => {
    const parsed = parseSearchQuery('restaurants');
    assert.ok(
        scoreBusiness(KUALAO_RESTAURANT, parsed) > scoreBusiness(CONSTRUCTION_COMPANY, parsed)
    );
    const hotelParsed = parseSearchQuery('hotels');
    assert.ok(scoreBusiness(SALANA_HOTEL, hotelParsed) > scoreBusiness(CONSTRUCTION_COMPANY, hotelParsed));
    const lawyerParsed = parseSearchQuery('lawyer');
    assert.ok(scoreBusiness(DFDL_LEGAL, lawyerParsed) > scoreBusiness(CONSTRUCTION_COMPANY, lawyerParsed));
});

test('sushi chip is absent when no sushi rows map or search', async () => {
    const mappedCounts = countMapped([
        CAFE_BUSINESS_SERVICES, CONSTRUCTION_COMPANY, DFDL_LEGAL, KUALAO_RESTAURANT, WESTERN_RESTAURANT
    ]);
    assert.equal(mappedCounts.sub.sushi || 0, 0);

    const chips = await pickClarifyChips('food', {
        mappedCounts,
        searchBusinesses: async (query) => (/sushi/i.test(query) ? [] : [VANMAI_COFFEE])
    });
    assert.ok(!chips.some((chip) => /sushi/i.test(chip)));
    assert.ok(
        await chipHasCoverage(
            { chip: 'Sushi?', terms: ['sushi'], keys: ['sushi'], requireMapped: true },
            { searchBusinesses: async () => [], mappedCounts }
        ) === false
    );
});

test('hungry chips stay food-domain; hello chips may include a non-food parent', async () => {
    const mappedCounts = countMapped([
        CAFE_BUSINESS_SERVICES, SALANA_HOTEL, DFDL_LEGAL, KUALAO_RESTAURANT
    ]);
    const hungry = await pickClarifyChips('food', { mappedCounts });
    assert.ok(hungry.includes('Coffee?') || hungry.includes('Restaurants?'));
    assert.ok(hungry.some((chip) => /Coffee|Restaurants|Lao food|Vientiane/i.test(chip)));
    assert.ok(!hungry.some((chip) => /Hotels|Travel|Lawyers|Banks|Construction/i.test(chip)));
    assert.ok(!hungry.some((chip) => /sushi/i.test(chip)));
    assert.ok(hungry.length <= 3);

    const hello = await pickClarifyChips('greeting', { mappedCounts });
    assert.ok(hello.some((chip) => /Hotels|Travel|Lawyers|Banks/i.test(chip)));
    assert.ok(!hello.some((chip) => /sushi/i.test(chip)));

    const laoRow = {
        id: 9,
        name: 'Lan Xang Kitchen',
        category: 'laotian restaurant',
        city: 'Vientiane',
        country: 'LA',
        status: 'active'
    };
    assert.equal(mapListing(laoRow).sub, 'lao');
    const withLao = await pickClarifyChips('food', {
        mappedCounts: countMapped([CAFE_BUSINESS_SERVICES, laoRow, SALANA_HOTEL])
    });
    assert.ok(withLao.includes('Lao food?'));
    assert.ok(!withLao.some((chip) => /Hotels|Lawyers|Banks|Construction/i.test(chip)));

    const probed = [];
    const result = await handleChatRequest({
        messages: [{ role: 'user', content: "I'm hungry" }],
        env: {},
        searchBusinesses: async (query) => {
            probed.push(query);
            if (/sushi/i.test(query)) return [];
            if (/coffee/i.test(query)) return [VANMAI_COFFEE];
            if (/restaurant/i.test(query)) return [KUALAO_RESTAURANT];
            if (/hotel/i.test(query)) return [SALANA_HOTEL];
            if (/lawyer|legal/i.test(query)) return [DFDL_LEGAL];
            return [];
        }
    });
    assert.equal(result.body.mode, 'clarify');
    assert.equal(result.body.reply, FOOD_CLARIFY_REPLY);
    assert.deepEqual(result.body.listings, []);
    assert.ok(probed.every((query) => !/\bhungry\b/i.test(query)));
    assert.ok(result.body.chips.includes('Coffee?'));
    assert.ok(!result.body.chips.some((chip) => /Hotels|Travel|Lawyers|Banks|Construction/i.test(chip)));
    assert.ok(!result.body.chips.includes('Sushi?'));
});
