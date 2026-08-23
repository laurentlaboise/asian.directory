'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
    extractTokens,
    tokensToAdd,
    offeringsToAdd,
    applyCopyTokensToRow,
    planCopyTokenUpdates,
    BLOCKED
} = require('./copy-tokens');

test('description "Chinese construction developer" tags chinese, construction, developer', () => {
    const tokens = extractTokens({
        name: 'Example Co',
        category: 'Services',
        description: 'Chinese construction developer'
    });
    assert.deepEqual([...tokens].sort(), ['chinese', 'construction', 'developer']);
    assert.ok(!tokens.includes('best'));
    assert.ok(!tokens.includes('wifi'));
});

test('cafe description with no wifi word does not get a wifi tag', () => {
    const tokens = extractTokens({
        name: 'Comma Coffee',
        category: 'cafe',
        description: 'A cozy neighborhood cafe in Vientiane. Great for a date night vibe.'
    });
    assert.ok(tokens.includes('cafe'));
    assert.ok(!tokens.includes('wifi'));
    assert.ok(!tokens.includes('wi-fi'));
    assert.ok(!tokens.includes('working'));
    assert.ok(!tokens.includes('laptop'));
    assert.ok(!tokens.includes('quiet'));
    assert.ok(!tokens.includes('family'));
});

test('"best" is never tagged, even when the word appears', () => {
    const tokens = extractTokens({
        name: 'Best Western-style Cafe',
        category: 'verified restaurant',
        description: 'The best #1 top-rated cafe. Also french pastry.'
    });
    assert.ok(!tokens.includes('best'));
    assert.ok(!tokens.includes('#1'));
    assert.ok(!tokens.includes('verified'));
    assert.ok(!tokens.includes('top-rated'));
    for (const blocked of BLOCKED) {
        assert.ok(!tokens.includes(blocked), blocked);
    }
    assert.ok(tokens.includes('cafe'));
    assert.ok(tokens.includes('restaurant'));
    assert.ok(tokens.includes('french'));
});

test('only copies exact amenity/activity words; currently building is a phrase', () => {
    const buildingOnly = extractTokens({
        name: 'Mohona Construction Company Limited',
        category: 'construction',
        description: 'A construction company in Vientiane.'
    });
    assert.ok(buildingOnly.includes('construction'));
    assert.ok(!buildingOnly.includes('currently building'));
    assert.ok(!buildingOnly.includes('building'));

    const phrase = extractTokens({
        name: 'Site notice',
        category: 'construction',
        description: 'Currently building a hotel with parking and wifi.'
    });
    assert.ok(phrase.includes('currently building'));
    assert.ok(phrase.includes('building'));
    assert.ok(phrase.includes('hotel'));
    assert.ok(phrase.includes('parking'));
    assert.ok(phrase.includes('wifi'));
    assert.ok(phrase.includes('construction'));
});

test('writes new tokens into keywords; offerings only for offering words', () => {
    const row = {
        id: 9,
        name: 'Lao Legal Travel',
        category: 'lawyer',
        description: 'Lao lawyer and travel desk. Family office. Wifi available.',
        keywords: ['lawyer'],
        special_offerings: []
    };
    const added = tokensToAdd(row);
    assert.ok(added.includes('lao'));
    assert.ok(added.includes('travel'));
    assert.ok(added.includes('family'));
    assert.ok(added.includes('wifi'));
    assert.ok(!added.includes('lawyer'));

    const offerings = offeringsToAdd(row);
    assert.ok(offerings.includes('wifi'));
    assert.ok(offerings.includes('travel'));
    assert.ok(offerings.includes('lawyer'));
    assert.ok(!offerings.includes('lao'));
    assert.ok(!offerings.includes('family'));

    const applied = applyCopyTokensToRow(row);
    assert.ok(applied.keywords.includes('lawyer'));
    assert.ok(applied.keywords.includes('wifi'));
    assert.ok(applied.special_offerings.includes('wifi'));
    assert.ok(!applied.special_offerings.includes('lao'));

    const plan = planCopyTokenUpdates([row, { id: 10, name: 'Plain', category: 'Other', description: 'A public listing.' }]);
    assert.equal(plan.length, 1);
    assert.equal(plan[0].id, 9);
});

test('does not tag wifi from no / not / without wifi or no wi-fi', () => {
    const negated = [
        'Cafe with no wifi.',
        'Not wifi. Just coffee.',
        'Seats without wifi.',
        'No wi-fi in the rooms.'
    ];
    for (const description of negated) {
        const tokens = extractTokens({
            name: 'Catalog cafe',
            category: 'cafe',
            description
        });
        assert.ok(!tokens.includes('wifi'), description);
        assert.ok(!tokens.includes('wi-fi'), description);
    }

    const mixed = extractTokens({
        name: 'Catalog cafe',
        category: 'cafe',
        description: 'No wifi upstairs. Free wifi in the lobby.'
    });
    assert.ok(mixed.includes('wifi'));
});

test('does not tag working from working capital', () => {
    const tokens = extractTokens({
        name: 'Catalog bank desk',
        category: 'Banking',
        description: 'Advice on working capital for local firms.'
    });
    assert.ok(!tokens.includes('working'));

    const positive = extractTokens({
        name: 'Catalog cafe',
        category: 'cafe',
        description: 'Tables for working. Wifi available.'
    });
    assert.ok(positive.includes('working'));
    assert.ok(positive.includes('wifi'));
});

test('Remy guard: never copy email, phone, or contact into keywords', () => {
    const tokens = extractTokens({
        name: 'Yuni Coffee Company, Ltd.',
        category: 'Business Services',
        description: 'Contact email: sales@yunicoffeeco.com Phone +856 20 5551234',
        email: 'hidden@example.com',
        phone: '+856 20 0000',
        alt_phone: '+856 20 1111',
        contact_person: 'Remy'
    });
    const blob = tokens.join(' ');
    assert.ok(!tokens.includes('email'));
    assert.ok(!tokens.includes('phone'));
    assert.ok(!tokens.includes('contact'));
    assert.ok(!tokens.includes('remy'));
    assert.doesNotMatch(blob, /@|yunicoffeeco|hidden@example/);
    assert.doesNotMatch(blob, /\+856|5551234|0000|1111/);
    assert.ok(tokens.every((token) => !/@/.test(token)));
});

test('Remy guard: never infer wifi from working or laptop', () => {
    const tokens = extractTokens({
        name: 'Catalog cafe',
        category: 'cafe',
        description: 'Tables for working. Bring a laptop.'
    });
    assert.ok(tokens.includes('cafe'));
    assert.ok(tokens.includes('working'));
    assert.ok(tokens.includes('laptop'));
    assert.ok(!tokens.includes('wifi'));
    assert.ok(!tokens.includes('wi-fi'));
});

test('does not invent sushi or wifi from adjacent vibe words', () => {
    const tokens = extractTokens({
        name: 'Highland Garden Restaurant Vientiane',
        category: 'western restaurant',
        description: 'A public listing. Raw fish plate. Laptop-friendly atmosphere.'
    });
    assert.ok(tokens.includes('western'));
    assert.ok(tokens.includes('restaurant'));
    assert.ok(!tokens.includes('sushi'));
    assert.ok(!tokens.includes('japanese'));
    assert.ok(!tokens.includes('ramen'));
    assert.ok(!tokens.includes('wifi'));
    assert.ok(!tokens.includes('laptop'));
});
