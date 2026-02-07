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
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                address TEXT NOT NULL,
                country TEXT,
                city TEXT,
                website TEXT,
                phone TEXT,
                email TEXT,
                contact_person TEXT,
                socials JSONB DEFAULT '{}',
                keywords JSONB DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'pending',
                verification_status TEXT NOT NULL DEFAULT 'unverified',
                pipeline_stage TEXT NOT NULL DEFAULT 'new_lead',
                priority TEXT NOT NULL DEFAULT 'medium',
                source TEXT DEFAULT 'manual',
                notes TEXT,
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

        // Indexes for performance
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_pipeline ON businesses(pipeline_stage)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_created ON businesses(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_businesses_name_lower ON businesses(LOWER(name))`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key_id)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at)`);
        await client.query(`CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type)`);

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
        custom_fields: typeof business.custom_fields === 'string' ? JSON.parse(business.custom_fields) : (business.custom_fields || {})
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
            INSERT INTO businesses (name, category, description, address, country, city, website, phone, email, contact_person, socials, keywords, status, verification_status, pipeline_stage, priority, source, notes, custom_fields, assigned_to, is_featured, created_by)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
            RETURNING id
        `, [
            business.name, business.category, business.description, business.address,
            business.country || null, business.city || null,
            business.website || null, business.phone || null,
            business.email || null, business.contact_person || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || []),
            business.status || 'pending',
            business.verification_status || 'unverified',
            business.pipeline_stage || 'new_lead',
            business.priority || 'medium',
            business.source || 'manual',
            business.notes || null,
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
            SET name=$1, category=$2, description=$3, address=$4,
                country=$5, city=$6, website=$7, phone=$8, email=$9, contact_person=$10,
                socials=$11, keywords=$12, status=$13, verification_status=$14,
                pipeline_stage=$15, priority=$16, notes=$17, custom_fields=$18,
                assigned_to=$19, is_featured=$20, updated_at=NOW()
            WHERE id=$21
        `, [
            business.name, business.category, business.description, business.address,
            business.country || null, business.city || null,
            business.website || null, business.phone || null,
            business.email || null, business.contact_person || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || []),
            business.status || 'pending',
            business.verification_status || 'unverified',
            business.pipeline_stage || 'new_lead',
            business.priority || 'medium',
            business.notes || null,
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
            const headers = ['id','name','category','description','address','country','city','website','phone','email','status','pipeline_stage','created_at'];
            const rows = businesses.map(b => headers.map(h => {
                const val = b[h];
                if (val === null || val === undefined) return '';
                const str = String(val);
                return str.includes(',') || str.includes('"') || str.includes('\n') ? `"${str.replace(/"/g, '""')}"` : str;
            }).join(','));
            return headers.join(',') + '\n' + rows.join('\n');
        }
        return businesses;
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
