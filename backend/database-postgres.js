const { Pool } = require('pg');

// PostgreSQL connection
const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Test connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('PostgreSQL connection error:', err);
    } else {
        console.log('PostgreSQL connection successful');
    }
});

// Initialize database tables
async function initDatabase() {
    const client = await pool.connect();
    
    try {
        // Businesses table
        await client.query(`
            CREATE TABLE IF NOT EXISTS businesses (
                id SERIAL PRIMARY KEY,
                name TEXT NOT NULL,
                category TEXT NOT NULL,
                description TEXT NOT NULL,
                address TEXT NOT NULL,
                website TEXT,
                phone TEXT,
                socials JSONB,
                keywords JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Conversations table
        await client.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id SERIAL PRIMARY KEY,
                user_query TEXT NOT NULL,
                ai_response JSONB NOT NULL,
                business_ids JSONB,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Users table
        await client.query(`
            CREATE TABLE IF NOT EXISTS users (
                id SERIAL PRIMARY KEY,
                username TEXT UNIQUE NOT NULL,
                password TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for better performance
        await client.query(`
            CREATE INDEX IF NOT EXISTS idx_businesses_name ON businesses(name);
            CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category);
            CREATE INDEX IF NOT EXISTS idx_businesses_created_at ON businesses(created_at);
            CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
        `);

        console.log('Database initialized successfully');
    } catch (error) {
        console.error('Database initialization error:', error);
        throw error;
    } finally {
        client.release();
    }
}

// Seed initial data
async function seedData() {
    const client = await pool.connect();
    
    try {
        const result = await client.query('SELECT COUNT(*) as count FROM businesses');
        const count = parseInt(result.rows[0].count);
        
        if (count === 0) {
            console.log('Seeding initial business data...');
            
            const businesses = [
                { 
                    name: "Ichiran Ramen", 
                    category: "Restaurant", 
                    description: "Famous for its classic Tonkotsu ramen with customizable solo dining booths. A must-try for any ramen lover.", 
                    address: "Shibuya, Tokyo, Japan", 
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
                    website: "https://www.thebombaycanteen.com/", 
                    phone: "+91 22 4966 6666", 
                    socials: { instagram: "thebombaycanteen", facebook: "TheBombayCanteen", x: "TheBombayCanteen" }, 
                    keywords: ["indian", "food", "restaurant", "mumbai", "modern", "dinner"] 
                }
            ];

            for (const business of businesses) {
                await client.query(`
                    INSERT INTO businesses (name, category, description, address, website, phone, socials, keywords)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
                `, [
                    business.name,
                    business.category,
                    business.description,
                    business.address,
                    business.website,
                    business.phone,
                    JSON.stringify(business.socials),
                    JSON.stringify(business.keywords)
                ]);
            }

            console.log('Initial data seeded successfully');
        }
    } catch (error) {
        console.error('Seeding error:', error);
    } finally {
        client.release();
    }
}

// Database operations
const dbOperations = {
    // Get all businesses
    getAllBusinesses: async () => {
        const result = await pool.query('SELECT * FROM businesses ORDER BY created_at DESC');
        return result.rows.map(business => ({
            ...business,
            socials: typeof business.socials === 'string' ? JSON.parse(business.socials) : business.socials,
            keywords: typeof business.keywords === 'string' ? JSON.parse(business.keywords) : business.keywords
        }));
    },

    // Search businesses
    searchBusinesses: async (query) => {
        const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
        
        if (searchTerms.length === 0) {
            return [];
        }

        // Build SQL query with ILIKE for case-insensitive search
        const conditions = searchTerms.map((_, index) => {
            const paramIndex = index + 1;
            return `(LOWER(name) LIKE $${paramIndex} OR LOWER(category) LIKE $${paramIndex} OR LOWER(description) LIKE $${paramIndex} OR LOWER(address) LIKE $${paramIndex} OR LOWER(keywords::text) LIKE $${paramIndex})`;
        }).join(' OR ');
        
        const sql = `SELECT * FROM businesses WHERE ${conditions} ORDER BY created_at DESC`;
        const params = searchTerms.map(term => `%${term}%`);
        
        const result = await pool.query(sql, params);
        
        return result.rows.map(business => ({
            ...business,
            socials: typeof business.socials === 'string' ? JSON.parse(business.socials) : business.socials,
            keywords: typeof business.keywords === 'string' ? JSON.parse(business.keywords) : business.keywords
        }));
    },

    // Get business by ID
    getBusinessById: async (id) => {
        const result = await pool.query('SELECT * FROM businesses WHERE id = $1', [id]);
        
        if (result.rows.length === 0) return null;
        
        const business = result.rows[0];
        return {
            ...business,
            socials: typeof business.socials === 'string' ? JSON.parse(business.socials) : business.socials,
            keywords: typeof business.keywords === 'string' ? JSON.parse(business.keywords) : business.keywords
        };
    },

    // Add new business
    addBusiness: async (business) => {
        const result = await pool.query(`
            INSERT INTO businesses (name, category, description, address, website, phone, socials, keywords)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            RETURNING id
        `, [
            business.name,
            business.category,
            business.description,
            business.address,
            business.website || null,
            business.phone || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || [])
        ]);
        
        return result.rows[0].id;
    },

    // Update business
    updateBusiness: async (id, business) => {
        const result = await pool.query(`
            UPDATE businesses 
            SET name = $1, category = $2, description = $3, address = $4, 
                website = $5, phone = $6, socials = $7, keywords = $8
            WHERE id = $9
        `, [
            business.name,
            business.category,
            business.description,
            business.address,
            business.website || null,
            business.phone || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || []),
            id
        ]);
        
        return result.rowCount > 0;
    },

    // Delete business
    deleteBusiness: async (id) => {
        const result = await pool.query('DELETE FROM businesses WHERE id = $1', [id]);
        return result.rowCount > 0;
    },

    // Save conversation
    saveConversation: async (userQuery, aiResponse, businessIds) => {
        const result = await pool.query(`
            INSERT INTO conversations (user_query, ai_response, business_ids)
            VALUES ($1, $2, $3)
            RETURNING id
        `, [
            userQuery,
            JSON.stringify(aiResponse),
            JSON.stringify(businessIds || [])
        ]);
        
        return result.rows[0].id;
    },

    // Get all conversations
    getAllConversations: async () => {
        const result = await pool.query('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 100');
        
        return result.rows.map(conv => ({
            ...conv,
            ai_response: typeof conv.ai_response === 'string' ? JSON.parse(conv.ai_response) : conv.ai_response,
            business_ids: typeof conv.business_ids === 'string' ? JSON.parse(conv.business_ids) : conv.business_ids
        }));
    },

    // User authentication operations
    createUser: async (username, hashedPassword) => {
        try {
            const result = await pool.query(`
                INSERT INTO users (username, password)
                VALUES ($1, $2)
                RETURNING id
            `, [username, hashedPassword]);
            
            return result.rows[0].id;
        } catch (error) {
            if (error.code === '23505') { // Unique violation
                throw new Error('Username already exists');
            }
            throw error;
        }
    },

    getUserByUsername: async (username) => {
        const result = await pool.query('SELECT * FROM users WHERE username = $1', [username]);
        return result.rows[0] || null;
    },

    getUserById: async (id) => {
        const result = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
        return result.rows[0] || null;
    }
};

// Initialize database on load
initDatabase()
    .then(() => seedData())
    .catch(err => console.error('Database initialization failed:', err));

module.exports = { pool, dbOperations };
