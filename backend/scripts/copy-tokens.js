#!/usr/bin/env node
'use strict';

/**
 * One-shot copy-token backfill.
 *
 * Reads name / category / description, copies exact allow-listed tokens
 * into existing keywords JSONB (and special_offerings only when the
 * token is already an offering word). No new SQL columns.
 *
 * Usage:
 *   DATABASE_URL=... node backend/scripts/copy-tokens.js
 *   DATABASE_URL=... node backend/scripts/copy-tokens.js --apply
 *
 * Dry-run by default. Pass --apply to write. Do not run --apply in CI.
 */

const { Pool } = require('pg');
const { planCopyTokenUpdates } = require('../copy-tokens');

function parseArgs(argv) {
    const args = argv.slice(2);
    return {
        apply: args.includes('--apply'),
        help: args.includes('--help') || args.includes('-h')
    };
}

function printHelp() {
    console.log(`Copy exact allow-listed tokens into keywords JSONB.

Usage:
  DATABASE_URL=... node backend/scripts/copy-tokens.js
  DATABASE_URL=... node backend/scripts/copy-tokens.js --apply

Dry-run by default. --apply writes only new keywords / offering words.
Do not run --apply in CI.`);
}

async function loadRows(pool) {
    const result = await pool.query(`
        SELECT id, name, category, description, keywords, special_offerings
        FROM businesses
        ORDER BY id ASC
    `);
    return result.rows;
}

async function applyUpdates(pool, updates) {
    let written = 0;
    for (const update of updates) {
        await pool.query(
            `UPDATE businesses
             SET keywords = $1::jsonb,
                 special_offerings = $2::jsonb,
                 updated_at = NOW()
             WHERE id = $3`,
            [
                JSON.stringify(update.keywords),
                JSON.stringify(update.special_offerings),
                update.id
            ]
        );
        written += 1;
    }
    return written;
}

function summarize(updates, apply) {
    const label = apply ? 'apply' : 'dry-run';
    for (const update of updates) {
        const keywords = update.addedKeywords.join(', ') || '(none)';
        const offerings = update.addedOfferings.join(', ') || '(none)';
        console.log(`[${label}] id=${update.id} name=${update.name || ''} +keywords: ${keywords} +offerings: ${offerings}`);
    }
    if (!updates.length) {
        console.log(`[${label}] no new copy tokens`);
        return;
    }
    if (apply) {
        console.log(`updated ${updates.length} rows`);
    } else {
        console.log(`Would update ${updates.length} rows. Re-run with --apply to write.`);
    }
}

async function main() {
    const opts = parseArgs(process.argv);
    if (opts.help) {
        printHelp();
        return 0;
    }

    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('DATABASE_URL is required');
        return 1;
    }

    const pool = new Pool({
        connectionString: databaseUrl,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
    });

    try {
        const rows = await loadRows(pool);
        const updates = planCopyTokenUpdates(rows);
        if (opts.apply) {
            await applyUpdates(pool, updates);
        }
        summarize(updates, opts.apply);
        return 0;
    } finally {
        await pool.end();
    }
}

if (require.main === module) {
    main().then((code) => {
        process.exitCode = code;
    }).catch((err) => {
        console.error(err && err.message ? err.message : err);
        process.exitCode = 1;
    });
}

module.exports = { parseArgs, main };
