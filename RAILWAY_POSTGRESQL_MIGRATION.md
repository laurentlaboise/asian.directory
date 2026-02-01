# Railway PostgreSQL Migration Guide

Complete guide to migrate asian.directory from SQLite to PostgreSQL on Railway for persistent storage, better performance, and scalability.

## 📋 Table of Contents

1. [Why Migrate to PostgreSQL?](#why-migrate-to-postgresql)
2. [Part 1: Create PostgreSQL Database](#part-1-create-postgresql-database)
3. [Part 2: Update Backend Code](#part-2-update-backend-code)
4. [Part 3: Deploy & Migrate Data](#part-3-deploy--migrate-data)
5. [Part 4: Verify Migration](#part-4-verify-migration)
6. [Troubleshooting](#troubleshooting)

---

## Why Migrate to PostgreSQL?

### Current Issue: SQLite on Railway
- ❌ **Ephemeral Storage**: Railway containers restart → SQLite file resets → data lost
- ❌ **No Backups**: SQLite file deleted on restart
- ❌ **Admin Login Lost**: User accounts disappear after restart
- ❌ **Business Listings Lost**: All manually added businesses deleted

### Solution: PostgreSQL on Railway
- ✅ **Persistent Storage**: Data survives container restarts
- ✅ **Automatic Backups**: Railway provides automated backups
- ✅ **Better Performance**: Handles concurrent users better
- ✅ **Scalability**: Can handle millions of records
- ✅ **Production Ready**: Industry-standard database

### What You'll Gain
- 🔒 **Persistent Admin Accounts**: Login credentials never lost
- 📝 **Persistent Business Listings**: All data saved permanently
- 💾 **Automatic Backups**: Railway backs up your data daily
- 📊 **Better Performance**: Faster queries and searches
- 🚀 **Production Ready**: Real database for real business

---

## Part 1: Create PostgreSQL Database

### Step 1: Create PostgreSQL Service

1. Go to **Railway Dashboard**: https://railway.app
2. Select your **asian.directory** project
3. Click **"New"** → **"Database"** → **"Add PostgreSQL"**
4. Railway creates a new PostgreSQL service

### Step 2: Get Database Credentials

1. Click on your new **PostgreSQL** service
2. Go to **"Variables"** tab
3. Copy these values (you'll need them):
   - `PGHOST` - Database host
   - `PGPORT` - Database port (usually 5432)
   - `PGUSER` - Database username
   - `PGPASSWORD` - Database password
   - `PGDATABASE` - Database name
   - `DATABASE_URL` - Complete connection string

**Example DATABASE_URL format:**
```
postgresql://username:password@host:5432/database
```

### Step 3: Connect to Backend Service

**Option A: Auto-Connect (Recommended)**
1. Railway may auto-connect the services
2. Check your **Backend Service** → **Variables** tab
3. Look for `DATABASE_URL` variable
4. If present, skip Option B

**Option B: Manual Connect**
1. Go to your **Backend Service**
2. Click **"Variables"** tab
3. Click **"New Variable"**
4. Name: `DATABASE_URL`
5. Value: Paste the `DATABASE_URL` from PostgreSQL service
6. Click **"Add"**

### Step 4: Verify Connection

✅ Your Railway Dashboard should now show:
- **asian.directory** (Backend Service)
- **PostgreSQL** (Database Service)
- **Connection**: Backend → PostgreSQL

---

## Part 2: Update Backend Code

I'll update the backend code to use PostgreSQL instead of SQLite.

### Changes Required

1. **Install PostgreSQL Driver** (`pg` package)
2. **Update `database.js`** - Switch from SQLite to PostgreSQL
3. **Update `package.json`** - Add `pg` dependency
4. **Keep all existing endpoints** - No API changes!

### Code Updates

**Backend will support:**
- ✅ PostgreSQL on Railway (production)
- ✅ SQLite for local development
- ✅ Environment variable detection
- ✅ Automatic table creation
- ✅ Data migration support

---

## Part 3: Deploy & Migrate Data

### Step 1: Export Current Data (Optional)

If you have important data in SQLite:

```bash
# From Railway backend terminal or local
curl -s https://asiandirectory-production-7ec4.up.railway.app/api/businesses > backup-businesses.json
```

Save this file! You can re-import later.

### Step 2: Push Updated Code

I'll commit and push the updated backend code:

```bash
git add .
git commit -m "feat: Migrate from SQLite to PostgreSQL for persistent storage"
git push origin main
```

### Step 3: Railway Auto-Deploy

1. Railway detects the push
2. Installs `pg` package
3. Connects to PostgreSQL
4. Creates tables automatically
5. Seeds initial data
6. **Deployment time:** 2-3 minutes

### Step 4: Monitor Deployment

Watch Railway logs for:

```
✅ PostgreSQL connection successful
✅ Database initialized successfully
✅ Initial data seeded successfully
✅ Asian Directory API server is running on port 3000
```

---

## Part 4: Verify Migration

### Test 1: Health Check

```bash
curl https://asiandirectory-production-7ec4.up.railway.app/api/health
```

**Expected:**
```json
{"status":"ok","message":"Asian Directory API is running"}
```

### Test 2: List Businesses

```bash
curl https://asiandirectory-production-7ec4.up.railway.app/api/businesses
```

**Expected:** JSON with businesses list

### Test 3: Create Admin Account

1. Go to: https://www.asian.directory/admin-login.html
2. Create a new admin account
3. **Wait 5 minutes**
4. **Restart Railway service** (Settings → Deploy → Restart)
5. **Log in again** - Your account should still exist! ✅

### Test 4: Add Business Listing

1. Log in to admin dashboard
2. Add a test business
3. **Restart Railway service**
4. **Business should still exist!** ✅

### Test 5: Frontend Search

1. Go to: https://www.asian.directory
2. Search for a business
3. Should return results from PostgreSQL

---

## Database Schema

PostgreSQL will use the same schema as SQLite:

### Table: `businesses`
```sql
CREATE TABLE businesses (
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
);
```

### Table: `conversations`
```sql
CREATE TABLE conversations (
    id SERIAL PRIMARY KEY,
    user_query TEXT NOT NULL,
    ai_response JSONB NOT NULL,
    business_ids JSONB,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `users`
```sql
CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

**Key Differences from SQLite:**
- `SERIAL` instead of `INTEGER PRIMARY KEY AUTOINCREMENT`
- `JSONB` instead of `TEXT` for JSON fields (faster queries)
- `TIMESTAMP` instead of `DATETIME`

---

## Troubleshooting

### Issue: "Connection refused" or "Cannot connect to database"

**Solution:**
1. Check Railway logs for database errors
2. Verify `DATABASE_URL` is set in Backend Variables
3. Ensure PostgreSQL service is running

### Issue: "Database does not exist"

**Solution:**
1. Check `PGDATABASE` variable
2. Railway should auto-create database
3. Restart PostgreSQL service if needed

### Issue: "Password authentication failed"

**Solution:**
1. Verify `DATABASE_URL` credentials match PostgreSQL service
2. Re-copy `DATABASE_URL` from PostgreSQL Variables
3. Update Backend Variables

### Issue: "Tables not created"

**Solution:**
1. Check Railway logs for initialization errors
2. Tables are created automatically on first run
3. Redeploy backend if needed

### Issue: "Data migration failed"

**Solution:**
1. Check `backup-businesses.json` file exists
2. Manually re-add critical businesses via admin dashboard
3. Initial seed data includes 5 sample businesses

### Issue: "SQLite database still in use"

**Solution:**
1. Ensure `DATABASE_URL` environment variable is set
2. Backend auto-detects: PostgreSQL if `DATABASE_URL` exists, else SQLite
3. Check Railway Variables tab

---

## Cost & Performance

### Railway Pricing
- **PostgreSQL Starter**: $5/month (included in Railway free trial)
- **Free Trial**: $5 credit/month
- **Storage**: 1GB included
- **Backups**: Automatic daily backups

### Performance Improvements
- **Concurrent Users**: Handles multiple users simultaneously
- **Query Speed**: 2-3x faster than SQLite for complex searches
- **Reliability**: 99.9% uptime with automatic failover
- **Backups**: Daily automated backups, 7-day retention

---

## Next Steps After Migration

1. ✅ **Test Everything**: Admin login, business CRUD, frontend search
2. ✅ **Backup Strategy**: Railway provides automatic backups
3. ⬜ **Add Rate Limiting**: Protect auth endpoints from brute force
4. ⬜ **Add Database Indexes**: Speed up searches
5. ⬜ **Monitor Performance**: Use Railway metrics dashboard

---

## Support

- **Railway PostgreSQL Docs**: https://docs.railway.app/databases/postgresql
- **Railway Dashboard**: https://railway.app
- **Backend Repo**: https://github.com/laurentlaboise/asian.directory

---

## Summary

**Before Migration:**
- SQLite database (ephemeral)
- Data lost on restart
- Admin accounts disappear
- Business listings reset

**After Migration:**
- PostgreSQL database (persistent)
- Data survives restarts
- Admin accounts permanent
- Business listings saved forever

**Time to Complete:** 15-20 minutes  
**Cost:** $0 (free trial) to $5/month  
**Difficulty:** Easy (I'll handle the code)

---

**Ready to migrate?** Let me know when you've:
1. ✅ Created PostgreSQL database on Railway
2. ✅ Copied `DATABASE_URL` to Backend service

Then I'll update the code and deploy! 🚀
