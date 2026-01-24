const Database = require('better-sqlite3');
const path = require('path');

// Initialize database
const db = new Database(path.join(__dirname, 'asian-directory.db'));

// Create tables
function initDatabase() {
    // Businesses table
    db.exec(`
        CREATE TABLE IF NOT EXISTS businesses (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            category TEXT NOT NULL,
            description TEXT NOT NULL,
            address TEXT NOT NULL,
            website TEXT,
            phone TEXT,
            socials TEXT,
            keywords TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);

    // Conversations table to store user queries and AI responses
    db.exec(`
        CREATE TABLE IF NOT EXISTS conversations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_query TEXT NOT NULL,
            ai_response TEXT NOT NULL,
            business_ids TEXT,
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
                website: "https://en.ichiran.com/shop/tokyo-shibuya/", 
                phone: "+81 3-5428-3444", 
                socials: JSON.stringify({ instagram: "ichiran_jp", x: "ICHIRANJAPAN" }), 
                keywords: JSON.stringify(["ramen", "noodle", "japanese", "food", "tokyo"]) 
            },
            { 
                name: "Gardens by the Bay", 
                category: "Attraction", 
                description: "Iconic nature park spanning 101 hectares, featuring the Supertree Grove and cooled conservatories.", 
                address: "Marina Gardens Dr, Singapore", 
                website: "https://www.gardensbythebay.com.sg", 
                phone: "+65 6420 6848", 
                socials: JSON.stringify({ instagram: "gardensbythebay", facebook: "gardensbythebay", tiktok: "gardensbythebay", youtube: "gardensbythebay" }), 
                keywords: JSON.stringify(["park", "nature", "tourist", "singapore", "flowers", "supertree"]) 
            },
            { 
                name: "Onion Cafe", 
                category: "Coffee Shop", 
                description: "A trendy, industrial-chic cafe in a renovated factory building, known for its specialty coffee and baked goods.", 
                address: "Seongsu-dong, Seoul, South Korea", 
                website: null, 
                phone: "+82 2-1644-1629", 
                socials: JSON.stringify({ instagram: "cafe.onion" }), 
                keywords: JSON.stringify(["coffee", "cafe", "bakery", "seoul", "korea", "trendy"]) 
            },
            { 
                name: "Chatuchak Weekend Market", 
                category: "Market", 
                description: "One of the world's largest outdoor markets, offering everything from clothing to street food.", 
                address: "Kamphaeng Phet 2 Rd, Bangkok, Thailand", 
                website: "http://www.chatuchakmarket.org/", 
                phone: null, 
                socials: JSON.stringify({ facebook: "ChatuchakMarket" }), 
                keywords: JSON.stringify(["market", "shopping", "food", "bangkok", "thailand", "souvenirs"]) 
            },
            { 
                name: "The Bombay Canteen", 
                category: "Restaurant", 
                description: "Celebrates Indian cuisine with a modern twist in a vibrant, retro-inspired setting.", 
                address: "Lower Parel, Mumbai, India", 
                website: "https://www.thebombaycanteen.com/", 
                phone: "+91 22 4966 6666", 
                socials: JSON.stringify({ instagram: "thebombaycanteen", facebook: "TheBombayCanteen", x: "TheBombayCanteen" }), 
                keywords: JSON.stringify(["indian", "food", "restaurant", "mumbai", "modern", "dinner"]) 
            }
        ];

        const insert = db.prepare(`
            INSERT INTO businesses (name, category, description, address, website, phone, socials, keywords)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);

        const insertMany = db.transaction((businesses) => {
            for (const business of businesses) {
                insert.run(
                    business.name,
                    business.category,
                    business.description,
                    business.address,
                    business.website,
                    business.phone,
                    business.socials,
                    business.keywords
                );
            }
        });

        insertMany(businesses);
        console.log('Initial data seeded successfully');
    }
}

// Database operations
const dbOperations = {
    // Get all businesses
    getAllBusinesses: () => {
        const stmt = db.prepare('SELECT * FROM businesses ORDER BY created_at DESC');
        const businesses = stmt.all();
        
        // Parse JSON fields
        return businesses.map(business => ({
            ...business,
            socials: business.socials ? JSON.parse(business.socials) : {},
            keywords: business.keywords ? JSON.parse(business.keywords) : []
        }));
    },

    // Search businesses
    searchBusinesses: (query) => {
        const searchTerms = query.toLowerCase().split(/\s+/).filter(term => term.length > 2);
        
        if (searchTerms.length === 0) {
            return [];
        }

        // Build SQL query with LIKE clauses for better performance
        const likeConditions = searchTerms.map(() => 
            '(LOWER(name) LIKE ? OR LOWER(category) LIKE ? OR LOWER(description) LIKE ? OR LOWER(address) LIKE ? OR LOWER(keywords) LIKE ?)'
        ).join(' OR ');
        
        const sql = `SELECT * FROM businesses WHERE ${likeConditions} ORDER BY created_at DESC`;
        
        // Flatten search terms for parameterized query
        const params = searchTerms.flatMap(term => {
            const likeTerm = `%${term}%`;
            return [likeTerm, likeTerm, likeTerm, likeTerm, likeTerm];
        });
        
        const stmt = db.prepare(sql);
        const businesses = stmt.all(...params);
        
        // Parse JSON fields
        return businesses.map(business => ({
            ...business,
            socials: business.socials ? JSON.parse(business.socials) : {},
            keywords: business.keywords ? JSON.parse(business.keywords) : []
        }));
    },

    // Add new business
    addBusiness: (business) => {
        const stmt = db.prepare(`
            INSERT INTO businesses (name, category, description, address, website, phone, socials, keywords)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `);
        
        const result = stmt.run(
            business.name,
            business.category,
            business.description,
            business.address,
            business.website || null,
            business.phone || null,
            JSON.stringify(business.socials || {}),
            JSON.stringify(business.keywords || [])
        );
        
        return result.lastInsertRowid;
    },

    // Save conversation
    saveConversation: (userQuery, aiResponse, businessIds) => {
        const stmt = db.prepare(`
            INSERT INTO conversations (user_query, ai_response, business_ids)
            VALUES (?, ?, ?)
        `);
        
        const result = stmt.run(
            userQuery,
            JSON.stringify(aiResponse),
            JSON.stringify(businessIds || [])
        );
        
        return result.lastInsertRowid;
    },

    // Get all conversations
    getAllConversations: () => {
        const stmt = db.prepare('SELECT * FROM conversations ORDER BY created_at DESC LIMIT 100');
        const conversations = stmt.all();
        
        return conversations.map(conv => ({
            ...conv,
            ai_response: JSON.parse(conv.ai_response),
            business_ids: JSON.parse(conv.business_ids)
        }));
    }
};

// Initialize database on load
initDatabase();
seedData();

module.exports = { db, dbOperations };
