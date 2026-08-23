'use strict';

/**
 * Controlled directory taxonomy (Thailand Yellow Pages + consumer dirs).
 *
 * Mapping layer only: no new SQL columns, no DB rewrites, no invented
 * listings. mapListing() reads existing category text (including JSON
 * arrays like ['hospitality']) and obvious NAME tokens (cafe, hotel,
 * bank, lawyer, school). Description is never used to invent amenities
 * or cuisine (sushi/japanese/ramen stay unmapped until those tokens exist).
 */

const PARENTS = {
    food_drink: { label: 'Food & Drink' },
    hotels_travel: { label: 'Hotels & Travel' },
    shopping: { label: 'Shopping' },
    health: { label: 'Health' },
    beauty: { label: 'Beauty' },
    education: { label: 'Education' },
    legal_professional: { label: 'Legal & Professional' },
    banks_finance: { label: 'Banks & Finance' },
    construction: { label: 'Construction' },
    industry_agriculture: { label: 'Industry & Agriculture' },
    automotive: { label: 'Automotive' },
    real_estate: { label: 'Real Estate' },
    transport: { label: 'Transport' },
    technology: { label: 'Technology' },
    government_ngo: { label: 'Government & NGO' },
    associations: { label: 'Associations' },
    entertainment: { label: 'Entertainment' },
    other: { label: 'Other' }
};

const SUBS = {
    cafe: { primary: 'food_drink', label: 'Cafe' },
    restaurant: { primary: 'food_drink', label: 'Restaurant' },
    bar: { primary: 'food_drink', label: 'Bar' },
    bakery: { primary: 'food_drink', label: 'Bakery' },
    supermarket: { primary: 'food_drink', label: 'Supermarket' },
    food: { primary: 'food_drink', label: 'Food & Drink' },
    sushi: { primary: 'food_drink', label: 'Sushi' },
    japanese: { primary: 'food_drink', label: 'Japanese' },
    ramen: { primary: 'food_drink', label: 'Ramen' },
    chinese: { primary: 'food_drink', label: 'Chinese' },
    french: { primary: 'food_drink', label: 'French' },
    lao: { primary: 'food_drink', label: 'Lao' },
    thai: { primary: 'food_drink', label: 'Thai' },
    western: { primary: 'food_drink', label: 'Western' },
    hotel: { primary: 'hotels_travel', label: 'Hotel' },
    hostel: { primary: 'hotels_travel', label: 'Hostel' },
    lodge: { primary: 'hotels_travel', label: 'Lodge' },
    travel_agency: { primary: 'hotels_travel', label: 'Travel Agency' },
    hospitality: { primary: 'hotels_travel', label: 'Hospitality' },
    attraction: { primary: 'hotels_travel', label: 'Attraction' },
    shop: { primary: 'shopping', label: 'Shop' },
    market: { primary: 'shopping', label: 'Market' },
    bookstore: { primary: 'shopping', label: 'Bookstore' },
    clothing: { primary: 'shopping', label: 'Clothing' },
    jewelry: { primary: 'shopping', label: 'Jewelry' },
    furniture: { primary: 'shopping', label: 'Furniture' },
    electronics: { primary: 'shopping', label: 'Electronics' },
    clinic: { primary: 'health', label: 'Clinic' },
    hospital: { primary: 'health', label: 'Hospital' },
    pharmacy: { primary: 'health', label: 'Pharmacy' },
    veterinary: { primary: 'health', label: 'Veterinary' },
    fitness: { primary: 'health', label: 'Fitness' },
    salon: { primary: 'beauty', label: 'Salon' },
    spa: { primary: 'beauty', label: 'Spa' },
    barber: { primary: 'beauty', label: 'Barber' },
    school: { primary: 'education', label: 'School' },
    training: { primary: 'education', label: 'Training' },
    language_school: { primary: 'education', label: 'Language School' },
    lawyer: { primary: 'legal_professional', label: 'Lawyer' },
    consulting: { primary: 'legal_professional', label: 'Consulting' },
    accounting: { primary: 'legal_professional', label: 'Accounting' },
    bank: { primary: 'banks_finance', label: 'Bank' },
    insurance: { primary: 'banks_finance', label: 'Insurance' },
    microfinance: { primary: 'banks_finance', label: 'Microfinance' },
    leasing: { primary: 'banks_finance', label: 'Leasing' },
    securities: { primary: 'banks_finance', label: 'Securities' },
    pawnshop: { primary: 'banks_finance', label: 'Pawnshop' },
    builder: { primary: 'construction', label: 'Builder' },
    contractor: { primary: 'construction', label: 'Contractor' },
    engineering: { primary: 'construction', label: 'Engineering' },
    building_materials: { primary: 'construction', label: 'Building Materials' },
    factory: { primary: 'industry_agriculture', label: 'Factory' },
    farm: { primary: 'industry_agriculture', label: 'Farm' },
    mining: { primary: 'industry_agriculture', label: 'Mining' },
    garment: { primary: 'industry_agriculture', label: 'Garment' },
    import_export: { primary: 'industry_agriculture', label: 'Import & Export' },
    manufacture: { primary: 'industry_agriculture', label: 'Manufacture' },
    car_dealer: { primary: 'automotive', label: 'Car Dealer' },
    auto_repair: { primary: 'automotive', label: 'Auto Repair' },
    motorcycle: { primary: 'automotive', label: 'Motorcycle' },
    agency: { primary: 'real_estate', label: 'Real Estate Agency' },
    developer: { primary: 'real_estate', label: 'Developer' },
    rental: { primary: 'real_estate', label: 'Rental' },
    logistics: { primary: 'transport', label: 'Logistics' },
    freight: { primary: 'transport', label: 'Freight' },
    relocation: { primary: 'transport', label: 'Relocation' },
    software: { primary: 'technology', label: 'Software' },
    telecom: { primary: 'technology', label: 'Telecom' },
    it_services: { primary: 'technology', label: 'IT Services' },
    government: { primary: 'government_ngo', label: 'Government' },
    ngo: { primary: 'government_ngo', label: 'NGO' },
    association: { primary: 'associations', label: 'Association' },
    chamber: { primary: 'associations', label: 'Chamber of Commerce' },
    entertainment: { primary: 'entertainment', label: 'Entertainment' },
    business_services: { primary: 'other', label: 'Business Services' },
    services: { primary: 'other', label: 'Services' },
    other: { primary: 'other', label: 'Other' }
};

const TREE = Object.fromEntries(
    Object.entries(PARENTS).map(([id, parent]) => [id, {
        id,
        label: parent.label,
        subs: Object.entries(SUBS)
            .filter(([, sub]) => sub.primary === id)
            .map(([subId, sub]) => ({ id: subId, label: sub.label }))
    }])
);

const CONSUMER_PARENTS = new Set(['food_drink', 'hotels_travel', 'legal_professional']);
const INDUSTRY_PARENTS = new Set(['industry_agriculture', 'construction']);

const QUERY_PARENTS = {
    coffee: 'food_drink',
    cafe: 'food_drink',
    cafes: 'food_drink',
    restaurant: 'food_drink',
    restaurants: 'food_drink',
    food: 'food_drink',
    eat: 'food_drink',
    bar: 'food_drink',
    bakery: 'food_drink',
    sushi: 'food_drink',
    japanese: 'food_drink',
    ramen: 'food_drink',
    hotel: 'hotels_travel',
    hotels: 'hotels_travel',
    hostel: 'hotels_travel',
    travel: 'hotels_travel',
    lawyer: 'legal_professional',
    lawyers: 'legal_professional',
    legal: 'legal_professional'
};

// Plurals and listing-text synonyms. Do not expand hospitality/tourism here —
// that would dump the catalog. "restaurants" must still require restaurant/cafe
// tokens already present on the row (name or category).
const QUERY_ALIASES = {
    restaurants: ['restaurants', 'restaurant'],
    restaurant: ['restaurant'],
    cafes: ['cafes', 'cafe'],
    cafe: ['cafe'],
    hotels: ['hotels', 'hotel'],
    hotel: ['hotel'],
    lawyers: ['lawyers', 'lawyer', 'legal'],
    lawyer: ['lawyer', 'legal'],
    banks: ['banks', 'bank', 'banking'],
    schools: ['schools', 'school']
};

// More specific rules first. Live catalog strings from GET /categories 2026-08-23.
const CATEGORY_RULES = [
    { re: /\bsushi\b/, sub: 'sushi' },
    { re: /\bramen\b/, sub: 'ramen' },
    { re: /\bjapanese\b/, sub: 'japanese' },
    { re: /\bchinese\b/, sub: 'chinese' },
    { re: /\bfrench\b/, sub: 'french' },
    { re: /\blaotian\b/, sub: 'lao' },
    { re: /\bthai\b/, sub: 'thai' },
    { re: /\bwestern\b/, sub: 'western' },
    { re: /\b(coffee\s+shop|cafes?|café)\b/i, sub: 'cafe' },
    { re: /\brestaurants?\b/, sub: 'restaurant' },
    { re: /\b(cocktail\s+bar|bars?)\b/, sub: 'bar' },
    { re: /\bbakery\b/, sub: 'bakery' },
    { re: /\bsupermarket\b/, sub: 'supermarket' },
    { re: /\bfood\s*[&and]+\s*beverages?\b/, sub: 'food' },
    { re: /\b(youth\s+)?hostels?\b/, sub: 'hostel' },
    { re: /\b(hotels?|resorts?)\b/, sub: 'hotel' },
    { re: /\blodges?\b/, sub: 'lodge' },
    { re: /\btravel\b/, sub: 'travel_agency' },
    { re: /\bhospitality\b/, sub: 'hospitality' },
    { re: /\btourism\b/, sub: 'hospitality' },
    { re: /\b(law\s+firm|legal)\b/, sub: 'lawyer' },
    { re: /\bengineering\s+consultant\b/, sub: 'engineering' },
    { re: /\bconsult(ing|ant)\b/, sub: 'consulting' },
    { re: /\b(chamber of commerce)\b/, sub: 'chamber' },
    { re: /\bassociations?\b/, sub: 'association' },
    { re: /\bbusiness\s+group\b/, sub: 'association' },
    { re: /\bmicrofinance\b/, sub: 'microfinance' },
    { re: /\bpawnshop\b/, sub: 'pawnshop' },
    { re: /\bsecurities\b/, sub: 'securities' },
    { re: /\bleasing\b/, sub: 'leasing' },
    { re: /\binsurance\b/, sub: 'insurance' },
    { re: /\b(banks?|banking|finance)\b/, sub: 'bank' },
    { re: /\b(english\s+language\s+school|language\s+school)\b/, sub: 'language_school' },
    { re: /\btraining\b/, sub: 'training' },
    { re: /\b(education|schools?)\b/, sub: 'school' },
    { re: /\bbarber\b/, sub: 'barber' },
    { re: /\b(beauty|massage)\b/, sub: 'salon' },
    { re: /\b(veterinar)/, sub: 'veterinary' },
    { re: /\bfitness\b/, sub: 'fitness' },
    { re: /\b(pharmaceutical|healthcare|clinic|hospital)\b/, sub: 'clinic' },
    { re: /\b(book\s+store|bookstore)\b/, sub: 'bookstore' },
    { re: /\b(clothing|fashion|textiles|handicraft)\b/, sub: 'clothing' },
    { re: /\bjewel/, sub: 'jewelry' },
    { re: /\bfurniture\b/, sub: 'furniture' },
    { re: /\b(department\s+store|computer\s+store|hardware\s+store|pet\s+store|copy\s+shop)\b/, sub: 'shop' },
    { re: /\bconsumer\s+goods\b/, sub: 'shop' },
    { re: /\b(car\s+dealer|automobile|automotive)\b/, sub: 'car_dealer' },
    { re: /\b(auto\s+repair|motorcycle)\b/, sub: 'auto_repair' },
    { re: /\b(real\s+estate\s+developer|developer)\b/, sub: 'developer' },
    { re: /\b(real\s+estate\s+rental|rental\s+agency)\b/, sub: 'rental' },
    { re: /\b(real\s+estate|property)\b/, sub: 'agency' },
    { re: /\b(freight|forwarding)\b/, sub: 'freight' },
    { re: /\b(logistics|transportation)\b/, sub: 'logistics' },
    { re: /\brelocation\b/, sub: 'relocation' },
    { re: /\b(software|digital,\s+technology|technology\s*[&and]+\s*it|technology\s*&\s*it)\b/, sub: 'software' },
    { re: /\b(telecom|telecommunications)\b/, sub: 'telecom' },
    { re: /\b(computer\s+support|digital)\b/, sub: 'it_services' },
    { re: /\b(non-governmental|ngo)\b/, sub: 'ngo' },
    { re: /\bgovernment\b/, sub: 'government' },
    { re: /\b(building\s+materials)\b/, sub: 'building_materials' },
    { re: /\b(home\s+builder|custom\s+home|building\s+firm|builder)\b/, sub: 'builder' },
    { re: /\b(general\s+contractor|contractor|scaffolding)\b/, sub: 'contractor' },
    { re: /\b(engineering|electrical)\b/, sub: 'engineering' },
    { re: /\bconstruction\b/, sub: 'contractor' },
    { re: /\b(agriculture|agroforestry|agric)\b/, sub: 'farm' },
    { re: /\bmining\b/, sub: 'mining' },
    { re: /\bgarment\b/, sub: 'garment' },
    { re: /\b(import|importer|export)\b/, sub: 'import_export' },
    { re: /\b(manufacture|manufacturing|factory|heavy\s+industry|machineries|petroleum|energy)\b/, sub: 'manufacture' },
    { re: /\b(advertising|marketing|media)\b/, sub: 'consulting' },
    { re: /\barchitecture\b/, sub: 'engineering' },
    { re: /\bbusiness\s+services\b/, sub: 'business_services' },
    { re: /\b(trading\s+and\s+service|distribution\s*[&and]+\s*services|repair\s+services|services)\b/, sub: 'services' }
];

// Cuisine tokens may appear on name or category. Never assign these
// unless the token is already on the row.
const CUISINE_TOKEN_RULES = [
    { re: /\bsushi\b/, sub: 'sushi' },
    { re: /\bramen\b/, sub: 'ramen' },
    { re: /\bjapanese\b/, sub: 'japanese' },
    { re: /\bchinese\b/, sub: 'chinese' },
    { re: /\bfrench\b/, sub: 'french' },
    { re: /\bthai\b/, sub: 'thai' },
    { re: /\bwestern\b/, sub: 'western' }
];

// Name-only tokens. "coffee" alone is not cafe (Yuni Coffee / factories).
const NAME_TOKEN_RULES = [
    { re: /\bsushi\b/, sub: 'sushi' },
    { re: /\bramen\b/, sub: 'ramen' },
    { re: /\bjapanese\b/, sub: 'japanese' },
    { re: /\b(coffee\s+shop|coffee\s+house|cafes?|café)\b/i, sub: 'cafe' },
    { re: /\brestaurants?\b/, sub: 'restaurant' },
    { re: /\b(youth\s+)?hostels?\b/, sub: 'hostel' },
    { re: /\b(hotels?|resorts?)\b/, sub: 'hotel' },
    { re: /\blodges?\b/, sub: 'lodge' },
    { re: /\b(law\s+firm|lawyers?|attorney)\b/, sub: 'lawyer' },
    { re: /\blegal\b/, sub: 'lawyer' },
    { re: /\bbanks?\b/, sub: 'bank' },
    { re: /\bschools?\b/, sub: 'school' },
    { re: /\bfactory\b/, sub: 'factory' }
];

function decodeMojibake(value) {
    if (typeof value !== 'string' || !value) return value;
    if (!/Ã.|àº|à»/.test(value)) return value;
    try {
        const decoded = Buffer.from(value, 'latin1').toString('utf8');
        if (!decoded || decoded.includes('\uFFFD')) return value;
        return decoded;
    } catch {
        return value;
    }
}

function nodeFromSub(sub) {
    const meta = SUBS[sub] || SUBS.other;
    return { primary: meta.primary, sub, label: meta.label };
}

function flattenCategoryValue(value) {
    if (value == null) return [];
    if (Array.isArray(value)) return value.flatMap(flattenCategoryValue);
    const text = decodeMojibake(String(value)).trim();
    if (!text) return [];
    if (text.startsWith('[')) {
        const normalized = text.replace(/'/g, '"');
        try {
            const parsed = JSON.parse(normalized);
            if (Array.isArray(parsed)) return parsed.flatMap(flattenCategoryValue);
        } catch {
            return [text.replace(/[\[\]"']/g, ' ').replace(/\s+/g, ' ').trim()];
        }
    }
    return [text];
}

function categoryHay(row) {
    return [
        ...flattenCategoryValue(row && row.category),
        ...flattenCategoryValue(row && row.business_type)
    ].join(' ').toLowerCase();
}

function nameHay(row) {
    return String(decodeMojibake((row && row.name) || '')).toLowerCase();
}

function hasAssociationSignal(text) {
    return /\bassociations?\b|\bchamber of commerce\b/.test(String(text || '').toLowerCase());
}

function firstRuleMatch(text, rules) {
    const hay = String(text || '');
    if (!hay) return null;
    for (const rule of rules) {
        if (rule.re.test(hay)) return rule.sub;
    }
    return null;
}

/**
 * Map one listing from existing category text + obvious name tokens only.
 * Never invents sushi/japanese/ramen when those tokens are absent.
 */
function mapListing(row) {
    try {
        const name = nameHay(row);
        const category = categoryHay(row);
        const face = `${name} ${category}`.trim();

        if (hasAssociationSignal(face)) {
            return nodeFromSub('association');
        }

        const fromCuisine = firstRuleMatch(face, CUISINE_TOKEN_RULES);
        if (fromCuisine) return nodeFromSub(fromCuisine);

        const fromName = firstRuleMatch(name, NAME_TOKEN_RULES);
        if (fromName) return nodeFromSub(fromName);

        const fromCategory = firstRuleMatch(category, CATEGORY_RULES);
        if (fromCategory) return nodeFromSub(fromCategory);

        return nodeFromSub('other');
    } catch {
        return nodeFromSub('other');
    }
}

function attachTaxonomy(business) {
    if (!business || typeof business !== 'object') return business;
    return { ...business, taxonomy: mapListing(business) };
}

function termAliases(term) {
    const key = String(term || '').toLowerCase();
    if (!key) return [];
    return QUERY_ALIASES[key] || [key];
}

function queryConsumerParents(parsed) {
    const parents = new Set();
    for (const term of (parsed && parsed.contentTerms) || []) {
        const parent = QUERY_PARENTS[String(term).toLowerCase()];
        if (parent && CONSUMER_PARENTS.has(parent)) parents.add(parent);
    }
    return parents;
}

function countMapped(rows) {
    const primary = Object.create(null);
    const sub = Object.create(null);
    for (const row of rows || []) {
        const mapped = mapListing(row);
        primary[mapped.primary] = (primary[mapped.primary] || 0) + 1;
        sub[mapped.sub] = (sub[mapped.sub] || 0) + 1;
    }
    return { primary, sub };
}

function mappedCountFor(keys, mappedCounts) {
    if (!mappedCounts) return 0;
    let n = 0;
    for (const key of keys || []) {
        n += (mappedCounts.primary && mappedCounts.primary[key]) || 0;
        n += (mappedCounts.sub && mappedCounts.sub[key]) || 0;
    }
    return n;
}

const CHIP_BUCKETS = {
    food: [
        { chip: 'Coffee?', terms: ['coffee'], keys: ['cafe', 'food_drink'] },
        { chip: 'Restaurants?', terms: ['restaurant'], keys: ['restaurant'] },
        { chip: 'Lao food?', terms: ['lao food', 'laotian'], keys: ['lao'], requireMapped: true }
    ],
    stay: [
        { chip: 'Hotels?', terms: ['hotel'], keys: ['hotel', 'hotels_travel'] },
        { chip: 'Travel?', terms: ['travel'], keys: ['travel_agency'] }
    ],
    professional: [
        { chip: 'Lawyers?', terms: ['lawyer'], keys: ['lawyer', 'legal_professional'] },
        { chip: 'Banks?', terms: ['bank'], keys: ['bank', 'banks_finance'] }
    ]
};

const NON_FOOD_CLARIFY_CHIP = /^(Hotels|Travel|Lawyers|Banks|Construction)\?$/i;

const SUSHI_CHIP = {
    chip: 'Sushi?',
    terms: ['sushi'],
    keys: ['sushi'],
    requireMapped: true
};

const LOCATION_CHIP = 'Vientiane?';
const INTENT_CHIP = 'Eat?';

function chipCoverageQuery(chip) {
    return String(chip || '').replace(/[?？]/g, '').trim().toLowerCase();
}

function rowMapsToChip(row, def) {
    const mapped = mapListing(row);
    return (def.keys || []).includes(mapped.sub) || (def.keys || []).includes(mapped.primary);
}

async function chipHasCoverage(def, { searchBusinesses, mappedCounts } = {}) {
    if (mappedCountFor(def.keys, mappedCounts) > 0) return true;

    if (typeof searchBusinesses !== 'function') return false;

    for (const term of def.terms || []) {
        try {
            const rows = await Promise.resolve(searchBusinesses(term));
            if (!Array.isArray(rows) || !rows.length) continue;
            if (def.requireMapped) {
                if (rows.some((row) => rowMapsToChip(row, def))) return true;
                continue;
            }
            return true;
        } catch {
            // Coverage probes must not fail the request.
        }
    }
    return false;
}

function uniqueChips(list) {
    const out = [];
    for (const chip of list || []) {
        if (chip && !out.includes(chip)) out.push(chip);
    }
    return out;
}

/**
 * Up to 3 coverage-backed chips.
 * Food-intent (hungry / eat / food): food-domain + city only. Never Hotels?,
 * Lawyers?, Banks?, or Construction?. Sushi? / Lao food? only with coverage.
 * Greeting and general need keep a broader food / stay / professional mix.
 */
async function pickClarifyChips(kind, opts = {}) {
    const seen = new Set();

    const take = async (def) => {
        if (!def || seen.has(def.chip)) return null;
        if (await chipHasCoverage(def, opts)) {
            seen.add(def.chip);
            return def.chip;
        }
        return null;
    };

    if (kind === 'food') {
        const chips = [];
        for (const def of [...CHIP_BUCKETS.food, SUSHI_CHIP]) {
            if (chips.length >= 3) break;
            const chip = await take(def);
            if (chip) chips.push(chip);
        }
        if (chips.length < 3 && !chips.includes(LOCATION_CHIP)) chips.push(LOCATION_CHIP);
        if (!chips.length) chips.push('Coffee?', LOCATION_CHIP);
        return uniqueChips(chips)
            .filter((chip) => !NON_FOOD_CLARIFY_CHIP.test(chip))
            .slice(0, 3);
    }

    const food = await take(CHIP_BUCKETS.food[0]) || await take(CHIP_BUCKETS.food[1]);
    const stay = await take(CHIP_BUCKETS.stay[0]) || await take(CHIP_BUCKETS.stay[1]);
    const professional = await take(CHIP_BUCKETS.professional[0]) || await take(CHIP_BUCKETS.professional[1]);

    let chips = [food, stay, professional].filter(Boolean);

    if (kind === 'greeting') {
        chips = uniqueChips([INTENT_CHIP, food, stay || professional, LOCATION_CHIP]);
    } else if (chips.length < 3) {
        for (const def of [
            ...CHIP_BUCKETS.food,
            ...CHIP_BUCKETS.stay,
            ...CHIP_BUCKETS.professional
        ]) {
            if (chips.length >= 3) break;
            const chip = await take(def);
            if (chip && !chips.includes(chip)) chips.push(chip);
        }
        if (chips.length < 3 && !chips.includes(LOCATION_CHIP)) chips.push(LOCATION_CHIP);
    }

    if (!chips.length) {
        chips = kind === 'greeting'
            ? [INTENT_CHIP, 'Coffee?', LOCATION_CHIP]
            : ['Coffee?', 'Hotels?', LOCATION_CHIP];
    }

    return chips.slice(0, 3);
}

module.exports = {
    PARENTS,
    SUBS,
    TREE,
    CONSUMER_PARENTS,
    INDUSTRY_PARENTS,
    QUERY_ALIASES,
    QUERY_PARENTS,
    CHIP_BUCKETS,
    SUSHI_CHIP,
    LOCATION_CHIP,
    NON_FOOD_CLARIFY_CHIP,
    mapListing,
    attachTaxonomy,
    termAliases,
    queryConsumerParents,
    countMapped,
    mappedCountFor,
    chipCoverageQuery,
    chipHasCoverage,
    pickClarifyChips,
    flattenCategoryValue
};
