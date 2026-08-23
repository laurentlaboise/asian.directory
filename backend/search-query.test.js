'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    parseSearchQuery,
    rankBusinesses,
    buildContentSearchSql,
    scoreBusiness
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
