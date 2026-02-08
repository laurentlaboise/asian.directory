const { Pool } = require('pg');
const crypto = require('crypto');

// ---------------------------------------------------------------------------
// PostgreSQL connection pool
// ---------------------------------------------------------------------------
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 10000
});

pool.on('error', (err) => {
    console.error('Unexpected PostgreSQL pool error:', err);
});

// ---------------------------------------------------------------------------
// Connection with retry (Railway PG may not be ready on first attempt)
// ---------------------------------------------------------------------------
async function connectWithRetry(maxRetries = 5) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            const client = await pool.connect();
            const res = await client.query('SELECT NOW()');
            client.release();
            console.log(`PostgreSQL connected (attempt ${attempt}): ${res.rows[0].now}`);
            return;
        } catch (err) {
            console.error(`PostgreSQL connection attempt ${attempt}/${maxRetries} failed:`, err.message);
            if (attempt === maxRetries) {
                throw new Error(`Could not connect to PostgreSQL after ${maxRetries} attempts: ${err.message}`);
            }
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 16000);
            console.log(`Retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
}

// ---------------------------------------------------------------------------
// Create all tables and indexes
// ---------------------------------------------------------------------------
async function initDatabase() {
    await connectWithRetry();

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                email TEXT,
                password TEXT,
                role TEXT NOT NULL DEFAULT 'viewer',
                display_name TEXT,
                avatar_url TEXT,
                oauth_provider TEXT,
                oauth_id TEXT,
                is_active BOOLEAN NOT NULL DEFAULT true,
                last_login TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Unique index on email that allows multiple NULLs
        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
            ON users (email) WHERE email IS NOT NULL
        `);

        // Businesses table
        await client.query(`
            CREATE TABLE IF NOT EXISTS businesses (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                business_type TEXT,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                address TEXT NOT NULL,
                country TEXT,
                state_province TEXT,
                city TEXT,
                postal_code TEXT,
                latitude DOUBLE PRECISION,
                longitude DOUBLE PRECISION,
                google_place_id TEXT,
                website TEXT,
                phone TEXT,
                alt_phone TEXT,
                email TEXT,
                contact_person TEXT,
                contact_person_title TEXT,
                business_hours JSONB,
                primary_language TEXT,
                year_established INTEGER,
                employee_count TEXT,
                socials JSONB DEFAULT '{}',
                keywords JSONB DEFAULT '[]',
                meta_description TEXT,
                target_audience JSONB DEFAULT '[]',
                special_offerings JSONB DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                verification_status TEXT NOT NULL DEFAULT 'unverified',
                pipeline_stage TEXT NOT NULL DEFAULT 'new_lead',
                priority TEXT NOT NULL DEFAULT 'medium',
                source TEXT DEFAULT 'manual',
                notes TEXT,
                verification_notes TEXT,
                custom_fields JSONB DEFAULT '{}',
                assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
                rating REAL DEFAULT 0,
                review_count INTEGER DEFAULT 0,
                is_featured BOOLEAN DEFAULT false,
                last_contacted TIMESTAMPTZ,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Add new columns to existing businesses table if they don't exist (migration)
        const migrationColumns = [
            ['business_type', 'TEXT'],
            ['state_province', 'TEXT'],
            ['postal_code', 'TEXT'],
            ['latitude', 'DOUBLE PRECISION'],
            ['longitude', 'DOUBLE PRECISION'],
            ['google_place_id', 'TEXT'],
            ['alt_phone', 'TEXT'],
            ['contact_person_title', 'TEXT'],
            ['business_hours', 'JSONB'],
            ['primary_language', 'TEXT'],
            ['year_established', 'INTEGER'],
            ['employee_count', 'TEXT'],
            ['meta_description', 'TEXT'],
            ['target_audience', 'JSONB DEFAULT \'[]\''],
            ['special_offerings', 'JSONB DEFAULT \'[]\''],
            ['verification_notes', 'TEXT']
        ];
        for (const [col, type] of migrationColumns) {
            await client.query(`
                DO $$ BEGIN
                    ALTER TABLE businesses ADD COLUMN ${col} ${type};
                EXCEPTION WHEN duplicate_column THEN NULL;
                END $$
            `);
        }

        // Conversations table
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user_query TEXT NOT NULL,
                ai_response JSONB NOT NULL,
                business_ids JSONB,
                session_id TEXT,
                ip_address TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // API Keys table
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_keys (
                id SERIAL PRIMARY KEY,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                key_hash TEXT UNIQUE NOT NULL,
                key_prefix TEXT NOT NULL,
                name TEXT NOT NULL,
                permissions JSONB NOT NULL DEFAULT '["read"]',
                rate_limit INTEGER NOT NULL DEFAULT 100,
                is_active BOOLEAN NOT NULL DEFAULT true,
                last_used TIMESTAMPTZ,
                expires_at TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // API usage tracking
        await client.query(`
            CREATE TABLE IF NOT EXISTS api_usage (
                id SERIAL PRIMARY KEY,
                api_key_id INTEGER NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
                endpoint TEXT NOT NULL,
                method TEXT NOT NULL,
                status_code INTEGER,
                response_time_ms INTEGER,
                ip_address TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Audit log
        await client.query(`
            CREATE TABLE IF NOT EXISTS audit_log (
                id SERIAL PRIMARY KEY,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                action TEXT NOT NULL,
                entity_type TEXT NOT NULL,
                entity_id INTEGER,
                old_values JSONB,
                new_values JSONB,
                ip_address TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Communications
        await client.query(`
            CREATE TABLE IF NOT EXISTS communications (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                type TEXT NOT NULL DEFAULT 'note',
                subject TEXT,
                content TEXT NOT NULL,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Tags
        await client.query(`
            CREATE TABLE IF NOT EXISTS tags (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT '#6B7280',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        await client.query(`
            CREATE TABLE IF NOT EXISTS business_tags (
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (business_id, tag_id)
            )
        `);

        // Analytics events
        await client.query(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id SERIAL PRIMARY KEY,
                event_type TEXT NOT NULL,
                event_data JSONB,
                session_id TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // CRM Activities – activity tracking for deals/leads
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_activities (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                type TEXT NOT NULL DEFAULT 'note',
                title TEXT NOT NULL,
                description TEXT,
                due_date TIMESTAMPTZ,
                completed_at TIMESTAMPTZ,
                priority TEXT DEFAULT 'medium',
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // CRM Automation Rules – IFTTT-style automation rules
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_automation_rules (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                description TEXT,
                trigger_type TEXT NOT NULL,
                trigger_config JSONB NOT NULL DEFAULT '{}',
                action_type TEXT NOT NULL,
                action_config JSONB NOT NULL DEFAULT '{}',
                is_active BOOLEAN DEFAULT true,
                run_count INTEGER DEFAULT 0,
                last_run_at TIMESTAMPTZ,
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // CRM Automation Log – automation execution history
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_automation_log (
                id SERIAL PRIMARY KEY,
                rule_id INTEGER NOT NULL REFERENCES crm_automation_rules(id) ON DELETE CASCADE,
                business_id INTEGER REFERENCES businesses(id) ON DELETE SET NULL,
                trigger_data JSONB,
                action_result JSONB,
                status TEXT NOT NULL DEFAULT 'success',
                error_message TEXT,
                executed_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // CRM Win Scores – predictive win scoring history
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_win_scores (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                score INTEGER NOT NULL DEFAULT 50,
                factors JSONB NOT NULL DEFAULT '{}',
                calculated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // CRM Territories – territory/region management
        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_territories (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                description TEXT,
                countries JSONB DEFAULT '[]',
                assigned_users JSONB DEFAULT '[]',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);

        // Indexes for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_pipeline ON businesses(pipeline_stage)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_created ON businesses(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_name_lower ON businesses(LOWER(name))`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_geo ON businesses(latitude, longitude) WHERE latitude IS NOT NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_activities_business ON crm_activities(business_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_activities_user ON crm_activities(user_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_activities_due ON crm_activities(due_date) WHERE completed_at IS NULL`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_activities_type ON crm_activities(type)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_log_rule ON crm_automation_log(rule_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_automation_log_executed ON crm_automation_log(executed_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_win_scores_business ON crm_win_scores(business_id)`);

        await client.query('COMMIT');
        console.log('PostgreSQL tables and indexes created successfully');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Database initialization error:', error);
        throw error;
    } finally {
        client.release();
    }
}

// ---------------------------------------------------------------------------
// Seed initial data
// ---------------------------------------------------------------------------
async function seedData() {
    const result = await pool.query('SELECT COUNT(*)::int as count FROM businesses');
    if (result.rows[0].count > 0) return;

    console.log('Seeding initial business data...');

    const businesses = [
        {
            name: "Ichiran Ramen",
            category: "Restaurant",
            description: "Famous for its classic Tonkotsu ramen with customizable solo dining booths. A must-try for any ramen lover.",
            address: "Shibuya, Tokyo, Japan",
            country: "Japan",
            city: "Tokyo",
            website: "https://en.ichiran.com/shop/tokyo-shibuya/",
            phone: "+81 3-5428-3444",
            socials: { instagram: "ichiran_jp", x: "ICHIRANJAPAN" },
            keywords: ["ramen", "noodle", "japanese", "food", "tokyo"]
        },
        {
            name: "Gardens by the Bay",
            category: "Attraction",
            description: "Iconic nature park spanning 101 hectares, featuring the Supertree Grove and cooled conservatories.",
            address: "Marina Gardens Dr, Singapore",
            country: "Singapore",
            city: "Singapore",
            website: "https://www.gardensbythebay.com.sg",
            phone: "+65 6420 6848",
            socials: { instagram: "gardensbythebay", facebook: "gardensbythebay", tiktok: "gardensbythebay", youtube: "gardensbythebay" },
            keywords: ["park", "nature", "tourist", "singapore", "flowers", "supertree"]
        },
        {
            name: "Onion Cafe",
            category: "Coffee Shop",
            description: "A trendy, industrial-chic cafe in a renovated factory building, known for its specialty coffee and baked goods.",
            address: "Seongsu-dong, Seoul, South Korea",
            country: "South Korea",
            city: "Seoul",
            website: null,
            phone: "+82 2-1644-1629",
            socials: { instagram: "cafe.onion" },
            keywords: ["coffee", "cafe", "bakery", "seoul", "korea", "trendy"]
        },
        {
            name: "Chatuchak Weekend Market",
            category: "Market",
            description: "One of the world's largest outdoor markets, offering everything from clothing to street food.",
            address: "Kamphaeng Phet 2 Rd, Bangkok, Thailand",
            country: "Thailand",
            city: "Bangkok",
            website: "http://www.chatuchakmarket.org/",
            phone: null,
            socials: { facebook: "ChatuchakMarket" },
            keywords: ["market", "shopping", "food", "bangkok", "thailand", "souvenirs"]
        },
        {
            name: "The Bombay Canteen",
            category: "Restaurant",
            description: "Celebrates Indian cuisine with a modern twist in a vibrant, retro-inspired setting.",
            address: "Lower Parel, Mumbai, India",
            country: "India",
            city: "Mumbai",
            website: "https://www.thebombaycanteen.com/",
            phone: "+91 22 4966 6666",
            socials: { instagram: "thebombaycanteen", facebook: "TheBombayCanteen", x: "TheBombayCanteen" },
            keywords: ["indian", "food", "restaurant", "mumbai", "modern", "dinner"]
        }
    ];

    for (const b of businesses) {
        await pool.query(`
            INSERT INTO businesses (name, category, description, address, country, city, website, phone, socials, keywords, status, verification_status, pipeline_stage)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'active', 'verified', 'active_listing')
        `, [
            b.name, b.category, b.description, b.address, b.country, b.city,
            b.website, b.phone, JSON.stringify(b.socials), JSON.stringify(b.keywords)
        ]);
    }

    console.log('Initial data seeded successfully');
}

// ---------------------------------------------------------------------------
// Normalize JSONB fields (PG returns objects, not strings)
// ---------------------------------------------------------------------------
function parseBusiness(business) {
    if (!business) return null;
    return {
        ...business,
        socials: typeof business.socials === 'string' ? JSON.parse(business.socials) : (business.socials || {}),
        keywords: typeof business.keywords === 'string' ? JSON.parse(business.keywords) : (business.keywords || []),
        custom_fields: typeof business.custom_fields === 'string' ? JSON.parse(business.custom_fields) : (business.custom_fields || {}),
        business_hours: typeof business.business_hours === 'string' ? JSON.parse(business.business_hours) : (business.business_hours || null),
        target_audience: typeof business.target_audience === 'string' ? JSON.parse(business.target_audience) : (business.target_audience || []),
        special_offerings: typeof business.special_offerings === 'string' ? JSON.parse(business.special_offerings) : (business.special_offerings || [])
    };
}

function parseJsonField(val) {
    if (val === null || val === undefined) return val;
    return typeof val === 'string' ? JSON.parse(val) : val;
}

// ---------------------------------------------------------------------------
// Database operations
// ---------------------------------------------------------------------------
const dbOperations = {
    // ==================== BUSINESS OPERATIONS ====================
    getAllBusinesses: async (filters = {}) => {
        let sql = 'SELECT * FROM businesses WHERE 1=1';
        const params = [];
        let idx = 1;

        if (filters.status)              { sql += ` AND status = $${idx++}`;              params.push(filters.status); }
        if (filters.category)            { sql += ` AND category = $${idx++}`;            params.push(filters.category); }
        if (filters.country)             { sql += ` AND country = $${idx++}`;             params.push(filters.country); }
        if (filters.pipeline_stage)      { sql += ` AND pipeline_stage = $${idx++}`;      params.push(filters.pipeline_stage); }
        if (filters.verification_status) { sql += ` AND verification_status = $${idx++}`; params.push(filters.verification_status); }
        if (filters.assigned_to)         { sql += ` AND assigned_to = $${idx++}`;         params.push(filters.assigned_to); }
        if (filters.priority)            { sql += ` AND priority = $${idx++}`;            params.push(filters.priority); }

        sql += ' ORDER BY created_at DESC';

        if (filters.limit)  { sql += ` LIMIT $${idx++}`;  params.push(filters.limit); }
        if (filters.offset) { sql += ` OFFSET $${idx++}`; params.push(filters.offset); }

        const result = await pool.query(sql, params);
        return result.rows.map(parseBusiness);
    },

    searchBusinesses: async (query) => {
        const terms = query.toLowerCase().split(/\s+/).filter(t => t.length > 2);
        if (terms.length === 0) return [];

        const conditions = terms.map((_, i) => {
            const p = i + 1;
            return `(
                LOWER(name) LIKE $${p}
                OR LOWER(category) LIKE $${p}
                OR LOWER(description) LIKE $${p}
                OR LOWER(address) LIKE $${p}
                OR LOWER(keywords::text) LIKE $${p}
                OR LOWER(COALESCE(country,'')) LIKE $${p}
                OR LOWER(COALESCE(city,'')) LIKE $${p}
            )`;
        }).join(' OR ');

        const sql = `SELECT * FROM businesses WHERE status = 'active' AND (${conditions}) ORDER BY is_featured DESC, created_at DESC`;
        const params = terms.map(t => `%${t}%`);

        const result = await pool.query(sql, params);
        return result.rows.map(parseBusiness);
    },

    getBusinessById: async (id) => {
        const result = await pool.query('SELECT * FROM businesses WHERE id = $1', [id]);
        return result.rows.length > 0 ? parseBusiness(result.rows[0]) : null;
    },

    addBusiness: async (business) => {
        const result = await pool.query(`
            INSERT INTO businesses (name, business_type, category, description, address, country, state_province, city, postal_code, latitude, longitude, google_place_id, website, phone, alt_phone, email, contact_person, contact_person_title, business_hours, primary_language, year_established, employee_count, socials, keywords, meta_description, target_audience, special_offerings, status, verification_status, pipeline_stage, priority, source, notes, verification_notes, custom_fields, assigned_to, is_featured, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38)
            RETURNING id
        `, [
            business.name, business.business_type || null,
            business.category, business.description, business.address,
            business.country || null, business.state_province || null,
            business.city || null, business.postal_code || null,
            business.latitude || null, business.longitude || null,
            business.google_place_id || null,
            business.website || null, business.phone || null, business.alt_phone || null,
            business.email || null, business.contact_person || null,
            business.contact_person_title || null,
            business.business_hours ? JSON.stringify(business.business_hours) : null,
            business.primary_language || null,
            business.year_established || null, business.employee_count || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || []),
            business.meta_description || null,
            JSON.stringify(business.target_audience || []),
            JSON.stringify(business.special_offerings || []),
            business.status || 'pending',
            business.verification_status || 'unverified',
            business.pipeline_stage || 'new_lead',
            business.priority || 'medium',
            business.source || 'manual',
            business.notes || null,
            business.verification_notes || null,
            JSON.stringify(business.custom_fields || {}),
            business.assigned_to || null,
            business.is_featured || false,
            business.created_by || null
        ]);
        return result.rows[0].id;
    },

    updateBusiness: async (id, business) => {
        const result = await pool.query(`
            UPDATE businesses
            SET name=$1, business_type=$2, category=$3, description=$4, address=$5,
                country=$6, state_province=$7, city=$8, postal_code=$9,
                latitude=$10, longitude=$11, google_place_id=$12,
                website=$13, phone=$14, alt_phone=$15, email=$16,
                contact_person=$17, contact_person_title=$18,
                business_hours=$19, primary_language=$20,
                year_established=$21, employee_count=$22,
                socials=$23, keywords=$24,
                meta_description=$25, target_audience=$26, special_offerings=$27,
                status=$28, verification_status=$29,
                pipeline_stage=$30, priority=$31,
                notes=$32, verification_notes=$33,
                custom_fields=$34, assigned_to=$35, is_featured=$36,
                updated_at=NOW()
            WHERE id=$37
        `, [
            business.name, business.business_type || null,
            business.category, business.description, business.address,
            business.country || null, business.state_province || null,
            business.city || null, business.postal_code || null,
            business.latitude || null, business.longitude || null,
            business.google_place_id || null,
            business.website || null, business.phone || null, business.alt_phone || null,
            business.email || null, business.contact_person || null,
            business.contact_person_title || null,
            business.business_hours ? JSON.stringify(business.business_hours) : null,
            business.primary_language || null,
            business.year_established || null, business.employee_count || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || []),
            business.meta_description || null,
            JSON.stringify(business.target_audience || []),
            JSON.stringify(business.special_offerings || []),
            business.status || 'pending',
            business.verification_status || 'unverified',
            business.pipeline_stage || 'new_lead',
            business.priority || 'medium',
            business.notes || null,
            business.verification_notes || null,
            JSON.stringify(business.custom_fields || {}),
            business.assigned_to || null,
            business.is_featured || false,
            id
        ]);
        return result.rowCount > 0;
    },

    updateBusinessField: async (id, field, value) => {
        const allowed = ['status', 'verification_status', 'pipeline_stage', 'priority', 'assigned_to', 'is_featured', 'last_contacted', 'notes'];
        if (!allowed.includes(field)) {
            throw new Error(`Field ${field} is not allowed for partial update`);
        }
        const result = await pool.query(`UPDATE businesses SET ${field} = $1, updated_at = NOW() WHERE id = $2`, [value, id]);
        return result.rowCount > 0;
    },

    deleteBusiness: async (id) => {
        const result = await pool.query('DELETE FROM businesses WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    getBusinessStats: async () => {
        const total = (await pool.query('SELECT COUNT(*)::int as count FROM businesses')).rows[0].count;
        const byStatus = (await pool.query('SELECT status, COUNT(*)::int as count FROM businesses GROUP BY status')).rows;
        const byCategory = (await pool.query('SELECT category, COUNT(*)::int as count FROM businesses GROUP BY category ORDER BY count DESC LIMIT 10')).rows;
        const byCountry = (await pool.query('SELECT country, COUNT(*)::int as count FROM businesses WHERE country IS NOT NULL GROUP BY country ORDER BY count DESC')).rows;
        const byPipeline = (await pool.query('SELECT pipeline_stage, COUNT(*)::int as count FROM businesses GROUP BY pipeline_stage')).rows;
        const byPriority = (await pool.query('SELECT priority, COUNT(*)::int as count FROM businesses GROUP BY priority')).rows;
        const recentlyAdded = (await pool.query("SELECT COUNT(*)::int as count FROM businesses WHERE created_at >= NOW() - INTERVAL '7 days'")).rows[0].count;
        const featured = (await pool.query('SELECT COUNT(*)::int as count FROM businesses WHERE is_featured = true')).rows[0].count;
        return { total, byStatus, byCategory, byCountry, byPipeline, byPriority, recentlyAdded, featured };
    },

    bulkUpdatePipeline: async (ids, pipeline_stage) => {
        const placeholders = ids.map((_, i) => `$${i + 2}`).join(',');
        const result = await pool.query(
            `UPDATE businesses SET pipeline_stage = $1, updated_at = NOW() WHERE id IN (${placeholders})`,
            [pipeline_stage, ...ids]
        );
        return result.rowCount;
    },

    getCategories: async () => {
        const result = await pool.query('SELECT DISTINCT category FROM businesses ORDER BY category');
        return result.rows.map(r => r.category);
    },

    getCountries: async () => {
        const result = await pool.query('SELECT DISTINCT country FROM businesses WHERE country IS NOT NULL ORDER BY country');
        return result.rows.map(r => r.country);
    },

    // ==================== CONVERSATION OPERATIONS ====================
    saveConversation: async (userQuery, aiResponse, businessIds, sessionId, ipAddress) => {
        const result = await pool.query(`
            INSERT INTO conversations (user_query, ai_response, business_ids, session_id, ip_address)
            VALUES ($1, $2, $3, $4, $5) RETURNING id
        `, [userQuery, JSON.stringify(aiResponse), JSON.stringify(businessIds || []), sessionId || null, ipAddress || null]);
        return result.rows[0].id;
    },

    getAllConversations: async (limit = 100, offset = 0) => {
        const result = await pool.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT $1 OFFSET $2', [limit, offset]);
        return result.rows.map(c => ({
            ...c,
            ai_response: parseJsonField(c.ai_response),
            business_ids: parseJsonField(c.business_ids)
        }));
    },

    getConversationStats: async () => {
        const total = (await pool.query('SELECT COUNT(*)::int as count FROM conversations')).rows[0].count;
        const today = (await pool.query("SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= CURRENT_DATE")).rows[0].count;
        const thisWeek = (await pool.query("SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= NOW() - INTERVAL '7 days'")).rows[0].count;
        return { total, today, thisWeek };
    },

    // ==================== USER OPERATIONS ====================
    getUserCount: async () => {
        const result = await pool.query('SELECT COUNT(*)::int as count FROM users');
        return result.rows[0].count;
    },

    getAdminCount: async () => {
        const result = await pool.query("SELECT COUNT(*)::int as count FROM users WHERE role = 'admin'");
        return result.rows[0].count;
    },

    promoteToAdmin: async (userId) => {
        await pool.query("UPDATE users SET role = 'admin' WHERE id = $1", [userId]);
    },

    createUser: async (username, hashedPassword, email, role = 'viewer', displayName = null) => {
        try {
            const result = await pool.query(`
                INSERT INTO users (username, password, email, role, display_name)
                VALUES ($1, $2, $3, $4, $5) RETURNING id
            `, [username, hashedPassword, email || null, role, displayName || username]);
            return result.rows[0].id;
        } catch (error) {
            if (error.code === '23505') throw new Error('Username already exists');
            throw error;
        }
    },

    createOAuthUser: async (provider, oauthId, email, displayName, avatarUrl) => {
        const username = `${provider}_${oauthId}`;
        await pool.query(`
            INSERT INTO users (username, email, oauth_provider, oauth_id, display_name, avatar_url, role)
            VALUES ($1, $2, $3, $4, $5, $6, 'viewer')
            ON CONFLICT(username) DO UPDATE SET
                last_login = NOW(),
                display_name = EXCLUDED.display_name,
                avatar_url = EXCLUDED.avatar_url
        `, [username, email, provider, oauthId, displayName, avatarUrl]);
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0];
    },

    getUserByUsername: async (username) => {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0] || null;
    },

    getUserById: async (id) => {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0] || null;
    },

    getUserByEmail: async (email) => {
        const result = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
        return result.rows[0] || null;
    },

    getUserByOAuth: async (provider, oauthId) => {
        const result = await pool.query('SELECT * FROM users WHERE oauth_provider = $1 AND oauth_id = $2', [provider, oauthId]);
        return result.rows[0] || null;
    },

    getAllUsers: async () => {
        const result = await pool.query('SELECT id, username, email, role, display_name, avatar_url, oauth_provider, is_active, last_login, created_at FROM users ORDER BY created_at DESC');
        return result.rows;
    },

    updateUserRole: async (id, role) => {
        const result = await pool.query('UPDATE users SET role = $1, updated_at = NOW() WHERE id = $2', [role, id]);
        return result.rowCount > 0;
    },

    updateUserLogin: async (id) => {
        const result = await pool.query('UPDATE users SET last_login = NOW() WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    toggleUserActive: async (id, isActive) => {
        const result = await pool.query('UPDATE users SET is_active = $1, updated_at = NOW() WHERE id = $2', [isActive, id]);
        return result.rowCount > 0;
    },

    // ==================== API KEY OPERATIONS ====================
    createApiKey: async (userId, name, permissions = ['read'], rateLimit = 100, expiresAt = null) => {
        const rawKey = `ad_${crypto.randomBytes(32).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.substring(0, 10);
        const result = await pool.query(`
            INSERT INTO api_keys (user_id, key_hash, key_prefix, name, permissions, rate_limit, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id
        `, [userId, keyHash, keyPrefix, name, JSON.stringify(permissions), rateLimit, expiresAt]);
        return { id: result.rows[0].id, key: rawKey, prefix: keyPrefix };
    },

    validateApiKey: async (rawKey) => {
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const result = await pool.query(`
            SELECT ak.*, u.username, u.role
            FROM api_keys ak JOIN users u ON ak.user_id = u.id
            WHERE ak.key_hash = $1 AND ak.is_active = true
            AND (ak.expires_at IS NULL OR ak.expires_at > NOW())
        `, [keyHash]);
        const key = result.rows[0];
        if (key) {
            await pool.query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [key.id]);
            key.permissions = parseJsonField(key.permissions);
        }
        return key || null;
    },

    getApiKeysByUser: async (userId) => {
        const result = await pool.query(
            'SELECT id, key_prefix, name, permissions, rate_limit, is_active, last_used, expires_at, created_at FROM api_keys WHERE user_id = $1 ORDER BY created_at DESC',
            [userId]
        );
        return result.rows.map(k => ({ ...k, permissions: parseJsonField(k.permissions) }));
    },

    getAllApiKeys: async () => {
        const result = await pool.query(`
            SELECT ak.id, ak.key_prefix, ak.name, ak.permissions, ak.rate_limit, ak.is_active, ak.last_used, ak.expires_at, ak.created_at, u.username
            FROM api_keys ak JOIN users u ON ak.user_id = u.id ORDER BY ak.created_at DESC
        `);
        return result.rows.map(k => ({ ...k, permissions: parseJsonField(k.permissions) }));
    },

    revokeApiKey: async (id) => {
        const result = await pool.query('UPDATE api_keys SET is_active = false WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    logApiUsage: async (apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress) => {
        await pool.query(
            'INSERT INTO api_usage (api_key_id, endpoint, method, status_code, response_time_ms, ip_address) VALUES ($1,$2,$3,$4,$5,$6)',
            [apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress]
        );
    },

    getApiUsageStats: async (apiKeyId, days = 30) => {
        const usage = (await pool.query(`
            SELECT DATE(created_at) as date, COUNT(*)::int as requests, ROUND(AVG(response_time_ms)) as avg_response_time
            FROM api_usage
            WHERE api_key_id = $1 AND created_at >= NOW() - make_interval(days => $2)
            GROUP BY DATE(created_at) ORDER BY date DESC
        `, [apiKeyId, days])).rows;

        const total = (await pool.query('SELECT COUNT(*)::int as count FROM api_usage WHERE api_key_id = $1', [apiKeyId])).rows[0].count;

        const byEndpoint = (await pool.query(`
            SELECT endpoint, method, COUNT(*)::int as count
            FROM api_usage WHERE api_key_id = $1
            GROUP BY endpoint, method ORDER BY count DESC LIMIT 10
        `, [apiKeyId])).rows;

        return { usage, total, byEndpoint };
    },

    // ==================== AUDIT LOG OPERATIONS ====================
    addAuditLog: async (userId, action, entityType, entityId, oldValues, newValues, ipAddress) => {
        await pool.query(
            'INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7)',
            [userId, action, entityType, entityId,
             oldValues ? JSON.stringify(oldValues) : null,
             newValues ? JSON.stringify(newValues) : null,
             ipAddress]
        );
    },

    getAuditLog: async (limit = 50, offset = 0, entityType = null) => {
        let sql = 'SELECT al.*, u.username, u.display_name FROM audit_log al LEFT JOIN users u ON al.user_id = u.id WHERE 1=1';
        const params = [];
        let idx = 1;

        if (entityType) { sql += ` AND al.entity_type = $${idx++}`; params.push(entityType); }
        sql += ` ORDER BY al.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
        params.push(limit, offset);

        const result = await pool.query(sql, params);
        return result.rows.map(log => ({
            ...log,
            old_values: parseJsonField(log.old_values),
            new_values: parseJsonField(log.new_values)
        }));
    },

    // ==================== COMMUNICATION OPERATIONS ====================
    addCommunication: async (businessId, userId, type, subject, content) => {
        const result = await pool.query(
            'INSERT INTO communications (business_id, user_id, type, subject, content) VALUES ($1,$2,$3,$4,$5) RETURNING id',
            [businessId, userId, type, subject || null, content]
        );
        return result.rows[0].id;
    },

    getCommunications: async (businessId) => {
        const result = await pool.query(`
            SELECT c.*, u.username, u.display_name FROM communications c
            JOIN users u ON c.user_id = u.id WHERE c.business_id = $1 ORDER BY c.created_at DESC
        `, [businessId]);
        return result.rows;
    },

    // ==================== TAG OPERATIONS ====================
    createTag: async (name, color) => {
        const result = await pool.query(
            'INSERT INTO tags (name, color) VALUES ($1, $2) ON CONFLICT(name) DO NOTHING RETURNING id',
            [name, color || '#6B7280']
        );
        if (result.rows.length > 0) return result.rows[0].id;
        const existing = await pool.query('SELECT id FROM tags WHERE name = $1', [name]);
        return existing.rows[0].id;
    },

    getAllTags: async () => {
        return (await pool.query('SELECT * FROM tags ORDER BY name')).rows;
    },

    addBusinessTag: async (businessId, tagId) => {
        await pool.query('INSERT INTO business_tags (business_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [businessId, tagId]);
    },

    removeBusinessTag: async (businessId, tagId) => {
        await pool.query('DELETE FROM business_tags WHERE business_id = $1 AND tag_id = $2', [businessId, tagId]);
    },

    getBusinessTags: async (businessId) => {
        return (await pool.query(`
            SELECT t.* FROM tags t JOIN business_tags bt ON t.id = bt.tag_id WHERE bt.business_id = $1 ORDER BY t.name
        `, [businessId])).rows;
    },

    // ==================== ANALYTICS OPERATIONS ====================
    trackEvent: async (eventType, eventData, sessionId, ipAddress, userAgent) => {
        await pool.query(
            'INSERT INTO analytics_events (event_type, event_data, session_id, ip_address, user_agent) VALUES ($1,$2,$3,$4,$5)',
            [eventType, eventData ? JSON.stringify(eventData) : null, sessionId, ipAddress, userAgent]
        );
    },

    getAnalyticsSummary: async (days = 30) => {
        const searchCount = (await pool.query(
            "SELECT COUNT(*)::int as count FROM conversations WHERE created_at >= NOW() - make_interval(days => $1)", [days]
        )).rows[0].count;

        const pageViews = (await pool.query(
            "SELECT COUNT(*)::int as count FROM analytics_events WHERE event_type = 'page_view' AND created_at >= NOW() - make_interval(days => $1)", [days]
        )).rows[0].count;

        const dailySearches = (await pool.query(
            "SELECT DATE(created_at) as date, COUNT(*)::int as count FROM conversations WHERE created_at >= NOW() - make_interval(days => $1) GROUP BY DATE(created_at) ORDER BY date", [days]
        )).rows;

        const topSearches = (await pool.query(
            "SELECT user_query, COUNT(*)::int as count FROM conversations WHERE created_at >= NOW() - make_interval(days => $1) GROUP BY LOWER(user_query), user_query ORDER BY count DESC LIMIT 10", [days]
        )).rows;

        return { searchCount, pageViews, dailySearches, topSearches };
    },

    getDashboardStats: async () => {
        const businessStats = await dbOperations.getBusinessStats();
        const conversationStats = await dbOperations.getConversationStats();
        const userCount = (await pool.query('SELECT COUNT(*)::int as count FROM users')).rows[0].count;
        const apiKeyCount = (await pool.query('SELECT COUNT(*)::int as count FROM api_keys WHERE is_active = true')).rows[0].count;
        const recentAudit = (await pool.query("SELECT COUNT(*)::int as count FROM audit_log WHERE created_at >= NOW() - INTERVAL '24 hours'")).rows[0].count;

        return {
            businesses: businessStats,
            conversations: conversationStats,
            users: { total: userCount },
            apiKeys: { active: apiKeyCount },
            recentActivity: recentAudit
        };
    },

    // ==================== EXPORT OPERATIONS ====================
    exportBusinesses: async (format = 'json', filters = {}) => {
        const businesses = await dbOperations.getAllBusinesses(filters);
        if (format === 'csv') {
            const headers = ['id','name','business_type','category','description','address','country','state_province','city','postal_code','website','phone','alt_phone','email','contact_person','contact_person_title','primary_language','year_established','employee_count','status','pipeline_stage','priority','source','created_at'];
            const rows = businesses.map(b => headers.map(h => {
                const val = b[h];
                if (val === null || val === undefined) return '';
                const str = String(val);
                return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(','));
            return headers.join(',') + '\n' + rows.join('\n');
        }
        return businesses;
    },

    // ==================== CRM ADVANCED OPERATIONS ====================

    // --- Activities ---
    createActivity: async (activity) => {
        const result = await pool.query(`
            INSERT INTO crm_activities (business_id, user_id, type, title, description, due_date, priority, metadata)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        `, [activity.business_id, activity.user_id, activity.type || 'note', activity.title,
            activity.description || null, activity.due_date || null, activity.priority || 'medium',
            JSON.stringify(activity.metadata || {})]);
        return result.rows[0];
    },

    getActivities: async (filters = {}) => {
        let sql = 'SELECT a.*, u.username, u.display_name, b.name as business_name FROM crm_activities a LEFT JOIN users u ON a.user_id = u.id LEFT JOIN businesses b ON a.business_id = b.id WHERE 1=1';
        const params = [];
        let idx = 1;
        if (filters.business_id) { sql += ` AND a.business_id = $${idx++}`; params.push(filters.business_id); }
        if (filters.user_id) { sql += ` AND a.user_id = $${idx++}`; params.push(filters.user_id); }
        if (filters.type) { sql += ` AND a.type = $${idx++}`; params.push(filters.type); }
        if (filters.pending) { sql += ' AND a.completed_at IS NULL'; }
        if (filters.overdue) { sql += ' AND a.due_date < NOW() AND a.completed_at IS NULL'; }
        sql += ' ORDER BY COALESCE(a.due_date, a.created_at) ASC';
        if (filters.limit) { sql += ` LIMIT $${idx++}`; params.push(filters.limit); }
        const result = await pool.query(sql, params);
        return result.rows;
    },

    completeActivity: async (id) => {
        const result = await pool.query('UPDATE crm_activities SET completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *', [id]);
        return result.rows[0] || null;
    },

    deleteActivity: async (id) => {
        const result = await pool.query('DELETE FROM crm_activities WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    getActivityStats: async () => {
        const total = (await pool.query('SELECT COUNT(*)::int as count FROM crm_activities')).rows[0].count;
        const pending = (await pool.query('SELECT COUNT(*)::int as count FROM crm_activities WHERE completed_at IS NULL')).rows[0].count;
        const overdue = (await pool.query('SELECT COUNT(*)::int as count FROM crm_activities WHERE due_date < NOW() AND completed_at IS NULL')).rows[0].count;
        const completedToday = (await pool.query("SELECT COUNT(*)::int as count FROM crm_activities WHERE completed_at >= CURRENT_DATE")).rows[0].count;
        const byType = (await pool.query('SELECT type, COUNT(*)::int as count FROM crm_activities GROUP BY type ORDER BY count DESC')).rows;
        return { total, pending, overdue, completedToday, byType };
    },

    // --- Automation Rules ---
    createAutomationRule: async (rule) => {
        const result = await pool.query(`
            INSERT INTO crm_automation_rules (name, description, trigger_type, trigger_config, action_type, action_config, is_active, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *
        `, [rule.name, rule.description || null, rule.trigger_type, JSON.stringify(rule.trigger_config || {}),
            rule.action_type, JSON.stringify(rule.action_config || {}), rule.is_active !== false, rule.created_by || null]);
        return result.rows[0];
    },

    getAutomationRules: async () => {
        const result = await pool.query('SELECT r.*, u.username as created_by_name FROM crm_automation_rules r LEFT JOIN users u ON r.created_by = u.id ORDER BY r.created_at DESC');
        return result.rows;
    },

    updateAutomationRule: async (id, updates) => {
        const result = await pool.query(`
            UPDATE crm_automation_rules SET name = COALESCE($1, name), description = COALESCE($2, description),
            trigger_type = COALESCE($3, trigger_type), trigger_config = COALESCE($4, trigger_config),
            action_type = COALESCE($5, action_type), action_config = COALESCE($6, action_config),
            is_active = COALESCE($7, is_active), updated_at = NOW() WHERE id = $8 RETURNING *
        `, [updates.name, updates.description, updates.trigger_type,
            updates.trigger_config ? JSON.stringify(updates.trigger_config) : null,
            updates.action_type, updates.action_config ? JSON.stringify(updates.action_config) : null,
            updates.is_active, id]);
        return result.rows[0] || null;
    },

    toggleAutomationRule: async (id, isActive) => {
        const result = await pool.query('UPDATE crm_automation_rules SET is_active = $1, updated_at = NOW() WHERE id = $2 RETURNING *', [isActive, id]);
        return result.rows[0] || null;
    },

    deleteAutomationRule: async (id) => {
        const result = await pool.query('DELETE FROM crm_automation_rules WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    logAutomationExecution: async (ruleId, businessId, triggerData, actionResult, status, errorMessage) => {
        await pool.query(`INSERT INTO crm_automation_log (rule_id, business_id, trigger_data, action_result, status, error_message) VALUES ($1,$2,$3,$4,$5,$6)`,
            [ruleId, businessId, JSON.stringify(triggerData || {}), JSON.stringify(actionResult || {}), status, errorMessage || null]);
        await pool.query('UPDATE crm_automation_rules SET run_count = run_count + 1, last_run_at = NOW() WHERE id = $1', [ruleId]);
    },

    getAutomationLog: async (ruleId = null, limit = 50) => {
        let sql = 'SELECT l.*, r.name as rule_name, b.name as business_name FROM crm_automation_log l LEFT JOIN crm_automation_rules r ON l.rule_id = r.id LEFT JOIN businesses b ON l.business_id = b.id';
        const params = [];
        let idx = 1;
        if (ruleId) { sql += ` WHERE l.rule_id = $${idx++}`; params.push(ruleId); }
        sql += ` ORDER BY l.executed_at DESC LIMIT $${idx++}`;
        params.push(limit);
        return (await pool.query(sql, params)).rows;
    },

    // --- Win Scores (Predictive) ---
    calculateWinScore: async (businessId) => {
        // Get business data
        const biz = (await pool.query('SELECT * FROM businesses WHERE id = $1', [businessId])).rows[0];
        if (!biz) return null;

        // Get activity count and recency
        const activityData = (await pool.query(`
            SELECT COUNT(*)::int as total_activities,
                   COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END)::int as recent_activities,
                   MAX(created_at) as last_activity
            FROM crm_activities WHERE business_id = $1
        `, [businessId])).rows[0];

        // Get communication count
        const commData = (await pool.query('SELECT COUNT(*)::int as count FROM communications WHERE business_id = $1', [businessId])).rows[0];

        // Calculate score based on factors
        let score = 50; // base score
        const factors = {};

        // Pipeline stage factor (+/- 20)
        const stageScores = { new_lead: -10, contacted: 0, in_review: 10, verified: 15, active_listing: 20, inactive: -20 };
        const stageFactor = stageScores[biz.pipeline_stage] || 0;
        score += stageFactor;
        factors.pipeline_stage = { value: biz.pipeline_stage, impact: stageFactor };

        // Activity recency factor (+/- 15)
        const activityFactor = activityData.recent_activities > 3 ? 15 : activityData.recent_activities > 0 ? 5 : -10;
        score += activityFactor;
        factors.recent_activity = { value: activityData.recent_activities, impact: activityFactor };

        // Communication factor (+/- 10)
        const commFactor = commData.count > 5 ? 10 : commData.count > 0 ? 5 : -5;
        score += commFactor;
        factors.communications = { value: commData.count, impact: commFactor };

        // Data completeness factor (+/- 10)
        const fields = [biz.email, biz.phone, biz.website, biz.contact_person, biz.country, biz.city, biz.business_type, biz.description];
        const completeness = fields.filter(f => f).length / fields.length;
        const completenessFactor = Math.round((completeness - 0.5) * 20);
        score += completenessFactor;
        factors.data_completeness = { value: Math.round(completeness * 100) + '%', impact: completenessFactor };

        // Priority factor (+/- 5)
        const priorityFactor = biz.priority === 'high' ? 5 : biz.priority === 'low' ? -5 : 0;
        score += priorityFactor;
        factors.priority = { value: biz.priority, impact: priorityFactor };

        // Clamp to 0-100
        score = Math.max(0, Math.min(100, score));

        // Save score
        await pool.query('INSERT INTO crm_win_scores (business_id, score, factors) VALUES ($1, $2, $3)', [businessId, score, JSON.stringify(factors)]);

        return { score, factors, calculated_at: new Date().toISOString() };
    },

    getWinScores: async (businessId = null) => {
        if (businessId) {
            const result = await pool.query('SELECT * FROM crm_win_scores WHERE business_id = $1 ORDER BY calculated_at DESC LIMIT 1', [businessId]);
            return result.rows[0] || null;
        }
        // Get latest score per business
        const result = await pool.query(`
            SELECT DISTINCT ON (ws.business_id) ws.*, b.name as business_name, b.pipeline_stage, b.priority
            FROM crm_win_scores ws JOIN businesses b ON ws.business_id = b.id
            ORDER BY ws.business_id, ws.calculated_at DESC
        `);
        return result.rows;
    },

    // --- Territories ---
    createTerritory: async (territory) => {
        const result = await pool.query(`
            INSERT INTO crm_territories (name, description, countries, assigned_users)
            VALUES ($1,$2,$3,$4) RETURNING *
        `, [territory.name, territory.description || null, JSON.stringify(territory.countries || []), JSON.stringify(territory.assigned_users || [])]);
        return result.rows[0];
    },

    getTerritories: async () => {
        return (await pool.query('SELECT * FROM crm_territories ORDER BY name')).rows;
    },

    updateTerritory: async (id, updates) => {
        const result = await pool.query(`
            UPDATE crm_territories SET name = COALESCE($1, name), description = COALESCE($2, description),
            countries = COALESCE($3, countries), assigned_users = COALESCE($4, assigned_users) WHERE id = $5 RETURNING *
        `, [updates.name, updates.description, updates.countries ? JSON.stringify(updates.countries) : null,
            updates.assigned_users ? JSON.stringify(updates.assigned_users) : null, id]);
        return result.rows[0] || null;
    },

    deleteTerritory: async (id) => {
        const result = await pool.query('DELETE FROM crm_territories WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    // --- Stagnation Detection ---
    getStagnantDeals: async (thresholdDays = 7) => {
        const result = await pool.query(`
            SELECT b.*,
                EXTRACT(DAY FROM NOW() - b.updated_at)::int as days_stagnant,
                (SELECT MAX(a.created_at) FROM crm_activities a WHERE a.business_id = b.id) as last_activity_date,
                (SELECT COUNT(*)::int FROM crm_activities a WHERE a.business_id = b.id AND a.completed_at IS NULL) as pending_activities
            FROM businesses b
            WHERE b.status != 'inactive'
            AND b.pipeline_stage NOT IN ('active_listing', 'inactive')
            AND b.updated_at < NOW() - make_interval(days => $1)
            ORDER BY b.updated_at ASC
        `, [thresholdDays]);
        return result.rows.map(parseBusiness);
    },

    // --- Pipeline Forecast ---
    getPipelineForecast: async () => {
        // Get pipeline distribution with win scores
        const pipeline = (await pool.query(`
            SELECT b.pipeline_stage, COUNT(*)::int as count,
                COALESCE(AVG(ws.score), 50)::int as avg_score
            FROM businesses b
            LEFT JOIN LATERAL (
                SELECT score FROM crm_win_scores WHERE business_id = b.id ORDER BY calculated_at DESC LIMIT 1
            ) ws ON true
            WHERE b.status != 'inactive'
            GROUP BY b.pipeline_stage
        `)).rows;

        // Stage conversion rates (how many moved forward in last 30 days)
        const stageOrder = ['new_lead', 'contacted', 'in_review', 'verified', 'active_listing'];

        // Activity velocity
        const velocity = (await pool.query(`
            SELECT
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '7 days' THEN 1 END)::int as this_week,
                COUNT(CASE WHEN created_at >= NOW() - INTERVAL '14 days' AND created_at < NOW() - INTERVAL '7 days' THEN 1 END)::int as last_week
            FROM crm_activities
        `)).rows[0];

        return { pipeline, velocity, stageOrder };
    },

    // --- Enhanced Dashboard Stats ---
    getCrmDashboardStats: async () => {
        const activityStats = await dbOperations.getActivityStats();
        const stagnantDeals = await dbOperations.getStagnantDeals(7);
        const forecast = await dbOperations.getPipelineForecast();
        const automationRules = (await pool.query('SELECT COUNT(*)::int as total, COUNT(CASE WHEN is_active THEN 1 END)::int as active FROM crm_automation_rules')).rows[0];
        const recentAutomations = (await pool.query("SELECT COUNT(*)::int as count FROM crm_automation_log WHERE executed_at >= NOW() - INTERVAL '24 hours'")).rows[0].count;

        return {
            activities: activityStats,
            stagnant: { count: stagnantDeals.length, deals: stagnantDeals.slice(0, 10) },
            forecast,
            automations: { ...automationRules, recentExecutions: recentAutomations }
        };
    }
};

// ---------------------------------------------------------------------------
// Exported: dbReady is a promise that resolves when tables exist
// ---------------------------------------------------------------------------
const dbReady = initDatabase()
    .then(() => seedData())
    .then(() => console.log('PostgreSQL database ready'))
    .catch(err => {
        console.error('FATAL: Database initialization failed:', err);
        process.exit(1);
    });

module.exports = { pool, dbOperations, dbReady };
