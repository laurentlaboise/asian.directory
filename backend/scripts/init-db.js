#!/usr/bin/env node
/**
 * Standalone Database Initialization Script
 *
 * Usage:
 *   DATABASE_URL="postgresql://user:pass@host:port/db" node scripts/init-db.js
 *
 * This script:
 *   1. Connects to the PostgreSQL database specified by DATABASE_URL
 *   2. Creates all required tables (if they don't exist)
 *   3. Runs column migrations (adds any missing columns)
 *   4. Creates performance indexes
 *   5. Seeds sample data (if database is empty)
 *   6. Reports table status
 *
 * Safe to run multiple times — uses IF NOT EXISTS everywhere.
 *
 * Railway Usage:
 *   railway run node scripts/init-db.js
 *   OR set DATABASE_URL env variable and run directly.
 */

const { Pool } = require('pg');

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
    console.error('ERROR: DATABASE_URL environment variable is not set.');
    console.error('');
    console.error('Usage:');
    console.error('  DATABASE_URL="postgresql://user:pass@host:port/db" node scripts/init-db.js');
    console.error('');
    console.error('Railway usage:');
    console.error('  railway run node scripts/init-db.js');
    process.exit(1);
}

// Mask password in output
const maskedUrl = DATABASE_URL.replace(/:([^@]+)@/, ':****@');
console.log(`\nConnecting to: ${maskedUrl}\n`);

const pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000
});

async function run() {
    let client;
    try {
        // Test connection
        client = await pool.connect();
        const timeRes = await client.query('SELECT NOW() as now, current_database() as db, version() as ver');
        console.log(`Connected to database: ${timeRes.rows[0].db}`);
        console.log(`Server time: ${timeRes.rows[0].now}`);
        console.log(`PostgreSQL version: ${timeRes.rows[0].ver.split(',')[0]}`);
        console.log('');

        await client.query('BEGIN');

        // ============================================================
        // 1. CREATE TABLES
        // ============================================================
        console.log('--- Creating tables ---');

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
        console.log('  [OK] users');

        await client.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_unique
            ON users (email) WHERE email IS NOT NULL
        `);

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
        console.log('  [OK] businesses');

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
        console.log('  [OK] conversations');

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
        console.log('  [OK] api_keys');

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
        console.log('  [OK] api_usage');

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
        console.log('  [OK] audit_log');

        await client.query(`
            CREATE TABLE IF NOT EXISTS communications (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                type TEXT NOT NULL DEFAULT 'note',
                subject TEXT,
                content TEXT,
                metadata JSONB DEFAULT '{}',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('  [OK] communications');

        await client.query(`
            CREATE TABLE IF NOT EXISTS tags (
                id SERIAL PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                color TEXT DEFAULT '#6B7280',
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('  [OK] tags');

        await client.query(`
            CREATE TABLE IF NOT EXISTS business_tags (
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
                PRIMARY KEY (business_id, tag_id)
            )
        `);
        console.log('  [OK] business_tags');

        await client.query(`
            CREATE TABLE IF NOT EXISTS analytics_events (
                id SERIAL PRIMARY KEY,
                event_type TEXT NOT NULL,
                event_data JSONB DEFAULT '{}',
                session_id TEXT,
                ip_address TEXT,
                user_agent TEXT,
                created_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('  [OK] analytics_events');

        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_activities (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
                type TEXT NOT NULL DEFAULT 'task',
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
        console.log('  [OK] crm_activities');

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
                created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
                run_count INTEGER DEFAULT 0,
                last_run TIMESTAMPTZ,
                created_at TIMESTAMPTZ DEFAULT NOW(),
                updated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('  [OK] crm_automation_rules');

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
        console.log('  [OK] crm_automation_log');

        await client.query(`
            CREATE TABLE IF NOT EXISTS crm_win_scores (
                id SERIAL PRIMARY KEY,
                business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
                score INTEGER NOT NULL DEFAULT 50,
                factors JSONB NOT NULL DEFAULT '{}',
                calculated_at TIMESTAMPTZ DEFAULT NOW()
            )
        `);
        console.log('  [OK] crm_win_scores');

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
        console.log('  [OK] crm_territories');

        // ============================================================
        // 2. MIGRATIONS (add missing columns to existing tables)
        // ============================================================
        console.log('\n--- Running migrations ---');

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
            ['target_audience', "JSONB DEFAULT '[]'"],
            ['special_offerings', "JSONB DEFAULT '[]'"],
            ['verification_notes', 'TEXT']
        ];

        for (const [col, type] of migrationColumns) {
            try {
                await client.query(`
                    DO $$ BEGIN
                        ALTER TABLE businesses ADD COLUMN ${col} ${type};
                    EXCEPTION WHEN duplicate_column THEN NULL;
                    END $$
                `);
            } catch (e) {
                // Ignore - column already exists
            }
        }
        console.log(`  [OK] ${migrationColumns.length} column migrations checked`);

        // ============================================================
        // 3. INDEXES
        // ============================================================
        console.log('\n--- Creating indexes ---');

        const indexes = [
            'CREATE INDEX IF NOT EXISTS idx_businesses_status ON businesses(status)',
            'CREATE INDEX IF NOT EXISTS idx_businesses_category ON businesses(category)',
            'CREATE INDEX IF NOT EXISTS idx_businesses_country ON businesses(country)',
            'CREATE INDEX IF NOT EXISTS idx_businesses_pipeline ON businesses(pipeline_stage)',
            'CREATE INDEX IF NOT EXISTS idx_businesses_created ON businesses(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_businesses_name_lower ON businesses(LOWER(name))',
            'CREATE INDEX IF NOT EXISTS idx_businesses_geo ON businesses(latitude, longitude) WHERE latitude IS NOT NULL',
            'CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)',
            'CREATE INDEX IF NOT EXISTS idx_api_usage_key ON api_usage(api_key_id)',
            'CREATE INDEX IF NOT EXISTS idx_api_usage_created ON api_usage(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_conversations_created ON conversations(created_at)',
            'CREATE INDEX IF NOT EXISTS idx_analytics_type ON analytics_events(event_type)',
            'CREATE INDEX IF NOT EXISTS idx_activities_business ON crm_activities(business_id)',
            'CREATE INDEX IF NOT EXISTS idx_activities_user ON crm_activities(user_id)',
            'CREATE INDEX IF NOT EXISTS idx_activities_due ON crm_activities(due_date) WHERE completed_at IS NULL',
            'CREATE INDEX IF NOT EXISTS idx_activities_type ON crm_activities(type)',
            'CREATE INDEX IF NOT EXISTS idx_automation_log_rule ON crm_automation_log(rule_id)',
            'CREATE INDEX IF NOT EXISTS idx_automation_log_executed ON crm_automation_log(executed_at)',
            'CREATE INDEX IF NOT EXISTS idx_win_scores_business ON crm_win_scores(business_id)'
        ];

        for (const idx of indexes) {
            await client.query(idx);
        }
        console.log(`  [OK] ${indexes.length} indexes created/verified`);

        await client.query('COMMIT');

        // ============================================================
        // 4. SEED DATA (if empty)
        // ============================================================
        const countRes = await pool.query('SELECT COUNT(*)::int as count FROM businesses');
        const bizCount = countRes.rows[0].count;

        if (bizCount === 0) {
            console.log('\n--- Seeding sample data ---');

            const crypto = require('crypto');

            // Create admin user
            const bcrypt = require('bcryptjs');
            const adminPassword = await bcrypt.hash('admin123', 10);
            await pool.query(`
                INSERT INTO users (username, email, password, role, display_name)
                VALUES ('admin', 'admin@asian.directory', $1, 'admin', 'Administrator')
                ON CONFLICT (username) DO NOTHING
            `, [adminPassword]);
            console.log('  [OK] Admin user created (username: admin, password: admin123)');

            // Seed businesses
            const businesses = [
                {
                    name: 'Ichiran Ramen', category: 'Restaurant', business_type: 'Restaurant',
                    description: 'Famous for its classic Tonkotsu ramen with customizable solo dining booths.',
                    address: 'Shibuya, Tokyo, Japan', country: 'Japan', city: 'Tokyo',
                    website: 'https://en.ichiran.com', phone: '+81 3-5428-3444',
                    latitude: 35.6614, longitude: 139.7005,
                    socials: { instagram: 'ichiran_jp', x: 'ICHIRANJAPAN' },
                    keywords: ['ramen', 'noodle', 'japanese', 'food', 'tokyo']
                },
                {
                    name: 'Gardens by the Bay', category: 'Attraction', business_type: 'Attraction',
                    description: 'Iconic nature park spanning 101 hectares with the Supertree Grove and cooled conservatories.',
                    address: 'Marina Gardens Dr, Singapore', country: 'Singapore', city: 'Singapore',
                    website: 'https://www.gardensbythebay.com.sg', phone: '+65 6420 6848',
                    latitude: 1.2816, longitude: 103.8636,
                    socials: { instagram: 'gardensbythebay', facebook: 'gardensbythebay' },
                    keywords: ['park', 'nature', 'tourist', 'singapore', 'supertree']
                },
                {
                    name: 'Cafe Onion', category: 'Coffee Shop', business_type: 'Coffee Shop',
                    description: 'Trendy industrial-chic cafe in a renovated factory, known for specialty coffee and baked goods.',
                    address: 'Seongsu-dong, Seoul, South Korea', country: 'South Korea', city: 'Seoul',
                    phone: '+82 2-1644-1629',
                    latitude: 37.5445, longitude: 127.0560,
                    socials: { instagram: 'cafe.onion' },
                    keywords: ['coffee', 'cafe', 'bakery', 'seoul', 'korea']
                },
                {
                    name: 'Chatuchak Weekend Market', category: 'Market', business_type: 'Market',
                    description: 'One of the world\'s largest outdoor markets with 15,000+ stalls.',
                    address: 'Kamphaeng Phet 2 Rd, Bangkok, Thailand', country: 'Thailand', city: 'Bangkok',
                    website: 'http://www.chatuchakmarket.org/',
                    latitude: 13.7999, longitude: 100.5506,
                    socials: { instagram: 'chatuchakmarket', facebook: 'chatuchak' },
                    keywords: ['market', 'shopping', 'bangkok', 'thailand', 'street food']
                },
                {
                    name: 'Taj Mahal Palace Hotel', category: 'Hotel', business_type: 'Hotel',
                    description: 'Iconic luxury hotel overlooking the Gateway of India, opened in 1903.',
                    address: 'Apollo Bandar, Colaba, Mumbai, India', country: 'India', city: 'Mumbai',
                    website: 'https://www.tajhotels.com/', phone: '+91 22-6665-3366',
                    latitude: 18.9217, longitude: 72.8332,
                    socials: { instagram: 'tajhotels', facebook: 'TajHotels' },
                    keywords: ['hotel', 'luxury', 'mumbai', 'india', 'heritage']
                }
            ];

            for (const b of businesses) {
                await pool.query(`
                    INSERT INTO businesses (name, business_type, category, description, address, country, city, website, phone, latitude, longitude, socials, keywords, status, pipeline_stage)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, 'active', 'active_listing')
                `, [
                    b.name, b.business_type, b.category, b.description, b.address,
                    b.country, b.city, b.website || null, b.phone || null,
                    b.latitude || null, b.longitude || null,
                    JSON.stringify(b.socials || {}), JSON.stringify(b.keywords || [])
                ]);
                console.log(`  [OK] Seeded: ${b.name}`);
            }
        } else {
            console.log(`\n--- Skipping seed: ${bizCount} businesses already exist ---`);
        }

        // ============================================================
        // 5. REPORT TABLE STATUS
        // ============================================================
        console.log('\n--- Table Status ---');
        const tablesRes = await pool.query(`
            SELECT tablename,
                   pg_size_pretty(pg_total_relation_size(quote_ident(tablename))) as size
            FROM pg_tables
            WHERE schemaname = 'public'
            ORDER BY tablename
        `);

        for (const t of tablesRes.rows) {
            const countRes = await pool.query(`SELECT COUNT(*)::int as c FROM ${t.tablename}`);
            console.log(`  ${t.tablename}: ${countRes.rows[0].c} rows (${t.size})`);
        }

        console.log('\nDatabase initialization complete!\n');

    } catch (error) {
        console.error('\nFATAL ERROR:', error.message);
        if (client) {
            try { await client.query('ROLLBACK'); } catch (e) { /* ignore */ }
        }
        process.exit(1);
    } finally {
        if (client) client.release();
        await pool.end();
    }
}

run();
