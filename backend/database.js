const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

// Initialize database
const db = new Database(path.join(__dirname, 'asian-directory.db'));
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

// Create tables
function initDatabase() {
    // Users table with roles and OAuth support
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            email TEXT UNIQUE,
            password TEXT,
            role TEXT NOT NULL DEFAULT 'viewer',
            display_name TEXT,
            avatar_url TEXT,
            oauth_provider TEXT,
            oauth_id TEXT,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_login DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Businesses table with CRM fields
    db.exec(`
        CREATE TABLE IF NOT EXISTS businesses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
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
            socials TEXT,
            keywords TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            verification_status TEXT NOT NULL DEFAULT 'unverified',
            pipeline_stage TEXT NOT NULL DEFAULT 'new_lead',
            priority TEXT NOT NULL DEFAULT 'medium',
            source TEXT DEFAULT 'manual',
            notes TEXT,
            custom_fields TEXT,
            assigned_to INTEGER,
            rating REAL DEFAULT 0,
            review_count INTEGER DEFAULT 0,
            is_featured INTEGER DEFAULT 0,
            last_contacted DATETIME,
            created_by INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (assigned_to) REFERENCES users(id),
            FOREIGN KEY (created_by) REFERENCES users(id)
        )
    `);

    // Conversations table
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_query TEXT NOT NULL,
            ai_response TEXT NOT NULL,
            business_ids TEXT,
            session_id TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // API Keys table
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_keys (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL,
            key_hash TEXT UNIQUE NOT NULL,
            key_prefix TEXT NOT NULL,
            name TEXT NOT NULL,
            permissions TEXT NOT NULL DEFAULT '["read"]',
            rate_limit INTEGER NOT NULL DEFAULT 100,
            is_active INTEGER NOT NULL DEFAULT 1,
            last_used DATETIME,
            expires_at DATETIME,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
        )
    `);

    // API usage tracking
    db.exec(`
        CREATE TABLE IF NOT EXISTS api_usage (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            api_key_id INTEGER NOT NULL,
            endpoint TEXT NOT NULL,
            method TEXT NOT NULL,
            status_code INTEGER,
            response_time_ms INTEGER,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (api_key_id) REFERENCES api_keys(id) ON DELETE CASCADE
        )
    `);

    // Audit log
    db.exec(`
        CREATE TABLE IF NOT EXISTS audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER,
            action TEXT NOT NULL,
            entity_type TEXT NOT NULL,
            entity_id INTEGER,
            old_values TEXT,
            new_values TEXT,
            ip_address TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Communication history for CRM
    db.exec(`
        CREATE TABLE IF NOT EXISTS communications (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            business_id INTEGER NOT NULL,
            user_id INTEGER NOT NULL,
            type TEXT NOT NULL DEFAULT 'note',
            subject TEXT,
            content TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    // Tags for businesses
    db.exec(`
        CREATE TABLE IF NOT EXISTS tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT UNIQUE NOT NULL,
            color TEXT DEFAULT '#6B7280',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    db.exec(`
        CREATE TABLE IF NOT EXISTS business_tags (
            business_id INTEGER NOT NULL,
            tag_id INTEGER NOT NULL,
            PRIMARY KEY (business_id, tag_id),
            FOREIGN KEY (business_id) REFERENCES businesses(id) ON DELETE CASCADE,
            FOREIGN KEY (tag_id) REFERENCES tags(id) ON DELETE CASCADE
        )
    `);

    // Analytics events
    db.exec(`
        CREATE TABLE IF NOT EXISTS analytics_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            event_type TEXT NOT NULL,
            event_data TEXT,
            session_id TEXT,
            ip_address TEXT,
            user_agent TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    console.log('Database initialized successfully');
}

// Seed initial data
function seedData() {
    const count = db.prepare('SELECT COUNT(*) as count FROM businesses').get();

    if (count.count === 0) {
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
                socials: JSON.stringify({ instagram: "ichiran_jp", x: "ICHIRANJAPAN" }),
                keywords: JSON.stringify(["ramen", "noodle", "japanese", "food", "tokyo"]),
                status: "active",
                verification_status: "verified",
                pipeline_stage: "active_listing"
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
                socials: JSON.stringify({ instagram: "gardensbythebay", facebook: "gardensbythebay", tiktok: "gardensbythebay", youtube: "gardensbythebay" }),
                keywords: JSON.stringify(["park", "nature", "tourist", "singapore", "flowers", "supertree"]),
                status: "active",
                verification_status: "verified",
                pipeline_stage: "active_listing"
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
                socials: JSON.stringify({ instagram: "cafe.onion" }),
                keywords: JSON.stringify(["coffee", "cafe", "bakery", "seoul", "korea", "trendy"]),
                status: "active",
                verification_status: "verified",
                pipeline_stage: "active_listing"
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
                socials: JSON.stringify({ facebook: "ChatuchakMarket" }),
                keywords: JSON.stringify(["market", "shopping", "food", "bangkok", "thailand", "souvenirs"]),
                status: "active",
                verification_status: "verified",
                pipeline_stage: "active_listing"
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
                socials: JSON.stringify({ instagram: "thebombaycanteen", facebook: "TheBombayCanteen", x: "TheBombayCanteen" }),
                keywords: JSON.stringify(["indian", "food", "restaurant", "mumbai", "modern", "dinner"]),
                status: "active",
                verification_status: "verified",
                pipeline_stage: "active_listing"
            }
        ];

        const insert = db.prepare(`
            INSERT INTO businesses (name, category, description, address, country, city, website, phone, socials, keywords, status, verification_status, pipeline_stage)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((businesses) => {
            for (const b of businesses) {
                insert.run(
                    b.name, b.category, b.description, b.address, b.country, b.city,
                    b.website, b.phone, b.socials, b.keywords,
                    b.status, b.verification_status, b.pipeline_stage
                );
            }
        });

        insertMany(businesses);
        console.log('Initial data seeded successfully');
    }
}

// Helper to parse JSON fields
function parseBusiness(business) {
    if (!business) return null;
    return {
        ...business,
        socials: business.socials ? JSON.parse(business.socials) : {},
        keywords: business.keywords ? JSON.parse(business.keywords) : [],
        custom_fields: business.custom_fields ? JSON.parse(business.custom_fields) : {},
        is_featured: !!business.is_featured,
        is_active: business.is_active !== undefined ? !!business.is_active : true
    };
}

// Database operations
const dbOperations = {
    // ==================== BUSINESS OPERATIONS ====================
    getAllBusinesses: (filters = {}) => {
        let sql = 'SELECT * FROM businesses WHERE 1=1';
        const params = [];

        if (filters.status) {
            sql += ' AND status = ?';
            params.push(filters.status);
        }
        if (filters.category) {
            sql += ' AND category = ?';
            params.push(filters.category);
        }
        if (filters.country) {
            sql += ' AND country = ?';
            params.push(filters.country);
        }
        if (filters.pipeline_stage) {
            sql += ' AND pipeline_stage = ?';
            params.push(filters.pipeline_stage);
        }
        if (filters.verification_status) {
            sql += ' AND verification_status = ?';
            params.push(filters.verification_status);
        }
        if (filters.assigned_to) {
            sql += ' AND assigned_to = ?';
            params.push(filters.assigned_to);
        }
        if (filters.priority) {
            sql += ' AND priority = ?';
            params.push(filters.priority);
        }

        sql += ' ORDER BY created_at DESC';

        if (filters.limit) {
            sql += ' LIMIT ?';
            params.push(filters.limit);
        }
        if (filters.offset) {
            sql += ' OFFSET ?';
            params.push(filters.offset);
        }

        const stmt = db.prepare(sql);
        const businesses = stmt.all(...params);
        return businesses.map(parseBusiness);
    },

    searchBusinesses: (query) => {
        const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);

        if (searchTerms.length === 0) {
            return [];
        }

        const likeConditions = searchTerms.map(() =>
            '(LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(description) LIKE ? OR LOWER(address) LIKE ? OR LOWER(keywords) LIKE ? OR LOWER(country) LIKE ? OR LOWER(city) LIKE ?)'
        ).join(' OR ');

        const sql = `SELECT * FROM businesses WHERE status = 'active' AND (${likeConditions}) ORDER BY is_featured DESC, created_at DESC`;

        const params = searchTerms.flatMap(term => {
            const likeTerm = `%${term}%`;
            return [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm, likeTerm];
        });

        const stmt = db.prepare(sql);
        const businesses = stmt.all(...params);
        return businesses.map(parseBusiness);
    },

    getBusinessById: (id) => {
        const stmt = db.prepare('SELECT * FROM businesses WHERE id = ?');
        return parseBusiness(stmt.get(id));
    },

    addBusiness: (business) => {
        const stmt = db.prepare(`
            INSERT INTO businesses (name, category, description, address, country, city, website, phone, email, contact_person, socials, keywords, status, verification_status, pipeline_stage, priority, source, notes, custom_fields, assigned_to, is_featured, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
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
            business.is_featured ? 1 : 0,
            business.created_by || null
        );

        return result.lastInsertRowid;
    },

    updateBusiness: (id, business) => {
        const stmt = db.prepare(`
            UPDATE businesses
            SET name = ?, category = ?, description = ?, address = ?,
                country = ?, city = ?,
                website = ?, phone = ?, email = ?, contact_person = ?,
                socials = ?, keywords = ?,
                status = ?, verification_status = ?, pipeline_stage = ?,
                priority = ?, notes = ?, custom_fields = ?,
                assigned_to = ?, is_featured = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
        `);

        const result = stmt.run(
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
            business.is_featured ? 1 : 0,
            id
        );

        return result.changes > 0;
    },

    updateBusinessField: (id, field, value) => {
        const allowedFields = ['status', 'verification_status', 'pipeline_stage', 'priority', 'assigned_to', 'is_featured', 'last_contacted', 'notes'];
        if (!allowedFields.includes(field)) {
            throw new Error(`Field ${field} is not allowed for partial update`);
        }
        const stmt = db.prepare(`UPDATE businesses SET ${field} = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`);
        const result = stmt.run(value, id);
        return result.changes > 0;
    },

    deleteBusiness: (id) => {
        const stmt = db.prepare('DELETE FROM businesses WHERE id = ?');
        const result = stmt.run(id);
        return result.changes > 0;
    },

    getBusinessStats: () => {
        const total = db.prepare('SELECT COUNT(*) as count FROM businesses').get().count;
        const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM businesses GROUP BY status').all();
        const byCategory = db.prepare('SELECT category, COUNT(*) as count FROM businesses GROUP BY category ORDER BY count DESC LIMIT 10').all();
        const byCountry = db.prepare('SELECT country, COUNT(*) as count FROM businesses WHERE country IS NOT NULL GROUP BY country ORDER BY count DESC').all();
        const byPipeline = db.prepare('SELECT pipeline_stage, COUNT(*) as count FROM businesses GROUP BY pipeline_stage').all();
        const byPriority = db.prepare('SELECT priority, COUNT(*) as count FROM businesses GROUP BY priority').all();
        const recentlyAdded = db.prepare('SELECT COUNT(*) as count FROM businesses WHERE created_at >= datetime("now", "-7 days")').get().count;
        const featured = db.prepare('SELECT COUNT(*) as count FROM businesses WHERE is_featured = 1').get().count;

        return { total, byStatus, byCategory, byCountry, byPipeline, byPriority, recentlyAdded, featured };
    },

    bulkUpdatePipeline: (ids, pipeline_stage) => {
        const placeholders = ids.map(() => '?').join(',');
        const stmt = db.prepare(`UPDATE businesses SET pipeline_stage = ?, updated_at = CURRENT_TIMESTAMP WHERE id IN (${placeholders})`);
        const result = stmt.run(pipeline_stage, ...ids);
        return result.changes;
    },

    getCategories: () => {
        return db.prepare('SELECT DISTINCT category FROM businesses ORDER BY category').all().map(r => r.category);
    },

    getCountries: () => {
        return db.prepare('SELECT DISTINCT country FROM businesses WHERE country IS NOT NULL ORDER BY country').all().map(r => r.country);
    },

    // ==================== CONVERSATION OPERATIONS ====================
    saveConversation: (userQuery, aiResponse, businessIds, sessionId, ipAddress) => {
        const stmt = db.prepare(`
            INSERT INTO conversations (user_query, ai_response, business_ids, session_id, ip_address)
            VALUES (?, ?, ?, ?, ?)
        `);

        const result = stmt.run(
            userQuery,
            JSON.stringify(aiResponse),
            JSON.stringify(businessIds || []),
            sessionId || null,
            ipAddress || null
        );

        return result.lastInsertRowid;
    },

    getAllConversations: (limit = 100, offset = 0) => {
        const stmt = db.prepare('SELECT * FROM conversations ORDER BY created_at DESC LIMIT ? OFFSET ?');
        const conversations = stmt.all(limit, offset);

        return conversations.map(conv => ({
            ...conv,
            ai_response: JSON.parse(conv.ai_response),
            business_ids: JSON.parse(conv.business_ids)
        }));
    },

    getConversationStats: () => {
        const total = db.prepare('SELECT COUNT(*) as count FROM conversations').get().count;
        const today = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at >= date("now")').get().count;
        const thisWeek = db.prepare('SELECT COUNT(*) as count FROM conversations WHERE created_at >= date("now", "-7 days")').get().count;
        return { total, today, thisWeek };
    },

    // ==================== USER OPERATIONS ====================
    createUser: (username, hashedPassword, email, role = 'viewer', displayName = null) => {
        const stmt = db.prepare(`
            INSERT INTO users (username, password, email, role, display_name)
            VALUES (?, ?, ?, ?, ?)
        `);

        try {
            const result = stmt.run(username, hashedPassword, email || null, role, displayName || username);
            return result.lastInsertRowid;
        } catch (error) {
            if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
                throw new Error('Username already exists');
            }
            throw error;
        }
    },

    createOAuthUser: (provider, oauthId, email, displayName, avatarUrl) => {
        const username = `${provider}_${oauthId}`;
        const stmt = db.prepare(`
            INSERT INTO users (username, email, oauth_provider, oauth_id, display_name, avatar_url, role)
            VALUES (?, ?, ?, ?, ?, ?, 'viewer')
            ON CONFLICT(username) DO UPDATE SET
                last_login = CURRENT_TIMESTAMP,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url
        `);

        const result = stmt.run(username, email, provider, oauthId, displayName, avatarUrl);
        // Return the user
        return db.prepare('SELECT * FROM users WHERE username = ?').get(username);
    },

    getUserByUsername: (username) => {
        const stmt = db.prepare('SELECT * FROM users WHERE username = ?');
        return stmt.get(username);
    },

    getUserById: (id) => {
        const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
        return stmt.get(id);
    },

    getUserByEmail: (email) => {
        const stmt = db.prepare('SELECT * FROM users WHERE email = ?');
        return stmt.get(email);
    },

    getUserByOAuth: (provider, oauthId) => {
        const stmt = db.prepare('SELECT * FROM users WHERE oauth_provider = ? AND oauth_id = ?');
        return stmt.get(provider, oauthId);
    },

    getAllUsers: () => {
        const stmt = db.prepare('SELECT id, username, email, role, display_name, avatar_url, oauth_provider, is_active, last_login, created_at FROM users ORDER BY created_at DESC');
        return stmt.all();
    },

    updateUserRole: (id, role) => {
        const stmt = db.prepare('UPDATE users SET role = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(role, id).changes > 0;
    },

    updateUserLogin: (id) => {
        const stmt = db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(id).changes > 0;
    },

    toggleUserActive: (id, isActive) => {
        const stmt = db.prepare('UPDATE users SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?');
        return stmt.run(isActive ? 1 : 0, id).changes > 0;
    },

    // ==================== API KEY OPERATIONS ====================
    createApiKey: (userId, name, permissions = ['read'], rateLimit = 100, expiresAt = null) => {
        const rawKey = `ad_${crypto.randomBytes(32).toString('hex')}`;
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const keyPrefix = rawKey.substring(0, 10);

        const stmt = db.prepare(`
            INSERT INTO api_keys (user_id, key_hash, key_prefix, name, permissions, rate_limit, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        const result = stmt.run(userId, keyHash, keyPrefix, name, JSON.stringify(permissions), rateLimit, expiresAt);
        return { id: result.lastInsertRowid, key: rawKey, prefix: keyPrefix };
    },

    validateApiKey: (rawKey) => {
        const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
        const stmt = db.prepare(`
            SELECT ak.*, u.username, u.role
            FROM api_keys ak
            JOIN users u ON ak.user_id = u.id
            WHERE ak.key_hash = ? AND ak.is_active = 1
            AND (ak.expires_at IS NULL OR ak.expires_at > datetime('now'))
        `);
        const key = stmt.get(keyHash);
        if (key) {
            db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(key.id);
            key.permissions = JSON.parse(key.permissions);
        }
        return key;
    },

    getApiKeysByUser: (userId) => {
        const stmt = db.prepare('SELECT id, key_prefix, name, permissions, rate_limit, is_active, last_used, expires_at, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at DESC');
        return stmt.all(userId).map(k => ({ ...k, permissions: JSON.parse(k.permissions) }));
    },

    getAllApiKeys: () => {
        const stmt = db.prepare(`
            SELECT ak.id, ak.key_prefix, ak.name, ak.permissions, ak.rate_limit, ak.is_active, ak.last_used, ak.expires_at, ak.created_at, u.username
            FROM api_keys ak JOIN users u ON ak.user_id = u.id
            ORDER BY ak.created_at DESC
        `);
        return stmt.all().map(k => ({ ...k, permissions: JSON.parse(k.permissions) }));
    },

    revokeApiKey: (id) => {
        const stmt = db.prepare('UPDATE api_keys SET is_active = 0 WHERE id = ?');
        return stmt.run(id).changes > 0;
    },

    logApiUsage: (apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress) => {
        const stmt = db.prepare(`
            INSERT INTO api_usage (api_key_id, endpoint, method, status_code, response_time_ms, ip_address)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(apiKeyId, endpoint, method, statusCode, responseTimeMs, ipAddress);
    },

    getApiUsageStats: (apiKeyId, days = 30) => {
        const usage = db.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as requests, AVG(response_time_ms) as avg_response_time
            FROM api_usage
            WHERE api_key_id = ? AND created_at >= datetime('now', '-' || ? || ' days')
            GROUP BY DATE(created_at)
            ORDER BY date DESC
        `).all(apiKeyId, days);

        const total = db.prepare('SELECT COUNT(*) as count FROM api_usage WHERE api_key_id = ?').get(apiKeyId).count;
        const byEndpoint = db.prepare(`
            SELECT endpoint, method, COUNT(*) as count
            FROM api_usage WHERE api_key_id = ?
            GROUP BY endpoint, method ORDER BY count DESC LIMIT 10
        `).all(apiKeyId);

        return { usage, total, byEndpoint };
    },

    // ==================== AUDIT LOG OPERATIONS ====================
    addAuditLog: (userId, action, entityType, entityId, oldValues, newValues, ipAddress) => {
        const stmt = db.prepare(`
            INSERT INTO audit_log (user_id, action, entity_type, entity_id, old_values, new_values, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        return stmt.run(
            userId, action, entityType, entityId,
            oldValues ? JSON.stringify(oldValues) : null,
            newValues ? JSON.stringify(newValues) : null,
            ipAddress
        );
    },

    getAuditLog: (limit = 50, offset = 0, entityType = null) => {
        let sql = `
            SELECT al.*, u.username, u.display_name
            FROM audit_log al
            LEFT JOIN users u ON al.user_id = u.id
            WHERE 1=1
        `;
        const params = [];

        if (entityType) {
            sql += ' AND al.entity_type = ?';
            params.push(entityType);
        }

        sql += ' ORDER BY al.created_at DESC LIMIT ? OFFSET ?';
        params.push(limit, offset);

        return db.prepare(sql).all(...params).map(log => ({
            ...log,
            old_values: log.old_values ? JSON.parse(log.old_values) : null,
            new_values: log.new_values ? JSON.parse(log.new_values) : null
        }));
    },

    // ==================== COMMUNICATION OPERATIONS ====================
    addCommunication: (businessId, userId, type, subject, content) => {
        const stmt = db.prepare(`
            INSERT INTO communications (business_id, user_id, type, subject, content)
            VALUES (?, ?, ?, ?, ?)
        `);
        const result = stmt.run(businessId, userId, type, subject || null, content);
        return result.lastInsertRowid;
    },

    getCommunications: (businessId) => {
        const stmt = db.prepare(`
            SELECT c.*, u.username, u.display_name
            FROM communications c
            JOIN users u ON c.user_id = u.id
            WHERE c.business_id = ?
            ORDER BY c.created_at DESC
        `);
        return stmt.all(businessId);
    },

    // ==================== TAG OPERATIONS ====================
    createTag: (name, color) => {
        const stmt = db.prepare('INSERT OR IGNORE INTO tags (name, color) VALUES (?, ?)');
        const result = stmt.run(name, color || '#6B7280');
        return result.lastInsertRowid || db.prepare('SELECT id FROM tags WHERE name = ?').get(name).id;
    },

    getAllTags: () => {
        return db.prepare('SELECT * FROM tags ORDER BY name').all();
    },

    addBusinessTag: (businessId, tagId) => {
        db.prepare('INSERT OR IGNORE INTO business_tags (business_id, tag_id) VALUES (?, ?)').run(businessId, tagId);
    },

    removeBusinessTag: (businessId, tagId) => {
        db.prepare('DELETE FROM business_tags WHERE business_id = ? AND tag_id = ?').run(businessId, tagId);
    },

    getBusinessTags: (businessId) => {
        return db.prepare(`
            SELECT t.* FROM tags t
            JOIN business_tags bt ON t.id = bt.tag_id
            WHERE bt.business_id = ?
            ORDER BY t.name
        `).all(businessId);
    },

    // ==================== ANALYTICS OPERATIONS ====================
    trackEvent: (eventType, eventData, sessionId, ipAddress, userAgent) => {
        const stmt = db.prepare(`
            INSERT INTO analytics_events (event_type, event_data, session_id, ip_address, user_agent)
            VALUES (?, ?, ?, ?, ?)
        `);
        return stmt.run(eventType, eventData ? JSON.stringify(eventData) : null, sessionId, ipAddress, userAgent);
    },

    getAnalyticsSummary: (days = 30) => {
        const searchCount = db.prepare(`
            SELECT COUNT(*) as count FROM conversations WHERE created_at >= datetime('now', '-' || ? || ' days')
        `).get(days).count;

        const pageViews = db.prepare(`
            SELECT COUNT(*) as count FROM analytics_events WHERE event_type = 'page_view' AND created_at >= datetime('now', '-' || ? || ' days')
        `).get(days).count;

        const dailySearches = db.prepare(`
            SELECT DATE(created_at) as date, COUNT(*) as count
            FROM conversations
            WHERE created_at >= datetime('now', '-' || ? || ' days')
            GROUP BY DATE(created_at)
            ORDER BY date
        `).all(days);

        const topSearches = db.prepare(`
            SELECT user_query, COUNT(*) as count
            FROM conversations
            WHERE created_at >= datetime('now', '-' || ? || ' days')
            GROUP BY LOWER(user_query)
            ORDER BY count DESC
            LIMIT 10
        `).all(days);

        return { searchCount, pageViews, dailySearches, topSearches };
    },

    getDashboardStats: () => {
        const businessStats = dbOperations.getBusinessStats();
        const conversationStats = dbOperations.getConversationStats();
        const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        const apiKeyCount = db.prepare('SELECT COUNT(*) as count FROM api_keys WHERE is_active = 1').get().count;
        const recentAudit = db.prepare('SELECT COUNT(*) as count FROM audit_log WHERE created_at >= datetime("now", "-24 hours")').get().count;

        return {
            businesses: businessStats,
            conversations: conversationStats,
            users: { total: userCount },
            apiKeys: { active: apiKeyCount },
            recentActivity: recentAudit
        };
    },

    // ==================== EXPORT OPERATIONS ====================
    exportBusinesses: (format = 'json', filters = {}) => {
        const businesses = dbOperations.getAllBusinesses(filters);
        if (format === 'csv') {
            const headers = ['id', 'name', 'category', 'description', 'address', 'country', 'city', 'website', 'phone', 'email', 'status', 'pipeline_stage', 'created_at'];
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

// Initialize database on load
initDatabase();
seedData();

module.exports = { db, dbOperations };
