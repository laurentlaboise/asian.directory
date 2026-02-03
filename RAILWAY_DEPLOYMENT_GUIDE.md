# 🚂 Railway Deployment Guide for asian.directory Backend

**Generated:** January 30, 2026  
**Status:** Ready to Deploy

---

## 📋 Pre-Deployment Checklist

✅ Railway configuration exists (`backend/railway.json`)  
✅ Package.json has start script  
✅ JWT secret generated securely  
✅ Backend code is production-ready  

---

## 🎯 Step-by-Step Deployment Instructions

### **Step 1: Sign Up / Log In to Railway**

1. Go to **https://railway.app**
2. Click **"Start a New Project"** or **"Login"** if you have an account
3. Sign up using GitHub (recommended for auto-deployment)

---

### **Step 2: Create New Project**

1. Click **"New Project"**
2. Select **"Deploy from GitHub repo"**
3. Authorize Railway to access your GitHub account
4. Select repository: **`laurentlaboise/asian.directory`**

---

### **Step 3: Configure Deployment**

#### Option A: If Railway Auto-Detects Node.js
- Railway should automatically detect the Node.js project
- It will use the `railway.json` configuration

#### Option B: Manual Configuration
If auto-detection doesn't work:

1. **Build Command:** Leave empty (npm install runs automatically)
2. **Start Command:** `npm start`
3. **Root Directory:** Set to `backend` (IMPORTANT!)

---

### **Step 4: Set Environment Variables** 🔐

**CRITICAL:** You must set these environment variables in Railway:

1. Go to your project in Railway
2. Click on **"Variables"** tab
3. Add the following variables:

| Variable Name | Value | Required? |
|---------------|-------|-----------|
| `JWT_SECRET` | `Lj7z5u1mlWNVaxl6WGU8eiGZfo4sHd6LSsp1+mKdt1E=` | ✅ YES |
| `PORT` | (Leave empty - Railway sets this automatically) | ❌ NO |
| `NODE_ENV` | `production` | ⚠️ Recommended |
| `ALLOWED_ORIGINS` | `https://www.asian.directory,https://asian.directory` | ⚠️ Recommended |

**⚠️ IMPORTANT:** 
- Copy the JWT_SECRET exactly as shown above
- Or generate a new one with: `openssl rand -base64 32`
- **NEVER commit this secret to Git!**

---

### **Step 5: Deploy**

1. Click **"Deploy"** button
2. Wait for deployment to complete (2-5 minutes)
3. Railway will show deployment logs

**What to look for in logs:**
```
✅ Installing dependencies...
✅ Starting server...
✅ Database initialized successfully
✅ Asian Directory API server is running on port XXXX
```

---

### **Step 6: Get Your Backend URL**

1. After successful deployment, Railway will provide a URL
2. It will look like: `https://asian-directory-production.up.railway.app`
3. Or: `https://asian-directory-production-XXXX.up.railway.app`

**Copy this URL!** You'll need it for the next step.

---

### **Step 7: Test Your Backend**

Test the health endpoint:

```bash
curl https://YOUR-RAILWAY-URL.railway.app/api/health
```

**Expected Response:**
```json
{
  "status": "ok",
  "message": "Asian Directory API is running"
}
```

If you see this, **your backend is live!** 🎉

---

### **Step 8: Update Frontend URLs**

Once you have your Railway URL, you need to update the frontend files.

**I will do this for you automatically after you provide the Railway URL.**

Files that need updating:
- `index.html`
- `admin-login.html`
- `admin-dashboard.html`
- `test-api.html`

---

## 🔧 Railway Configuration Details

### **Current Configuration** (`backend/railway.json`)

```json
{
  "$schema": "https://railway.app/railway.schema.json",
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

### **Nixpacks Configuration** (`backend/nixpacks.toml`)

This project uses Nixpacks v1.38.0+ for building. The configuration explicitly specifies:

```toml
[phases.setup]
nixPkgs = ['nodejs_18', 'npm-9_x']

[phases.install]
cmds = ['npm ci']

[start]
cmd = 'npm start'
```

This ensures consistent builds with Node.js 18 and npm 9.x.

### **Dependencies** (Automatically Installed)

```json
{
  "express": "^4.18.2",
  "cors": "^2.8.5",
  "better-sqlite3": "^11.7.0",
  "bcryptjs": "^2.4.3",
  "jsonwebtoken": "^9.0.2"
}
```

---

## 📊 What Gets Deployed

```
backend/
├── server.js          → Express API server
├── database.js        → SQLite operations
├── package.json       → Dependencies
├── railway.json       → Railway config
└── asian-directory.db → Created automatically on first run
```

---

## 🔐 Security Notes

### **Environment Variables Set:**

1. **JWT_SECRET** - Strong 32-byte secret for token signing
2. **ALLOWED_ORIGINS** - CORS restricted to your domain only
3. **NODE_ENV** - Production mode enabled

### **What This Protects Against:**

✅ JWT token forgery (with strong secret)  
✅ Unauthorized API access from other domains  
✅ Development error messages in production  

### **Still Need to Add (Next Steps):**

⚠️ Rate limiting on auth endpoints  
⚠️ Input validation/sanitization  
⚠️ HTTPS enforcement (Railway does this automatically)  

---

## 🐛 Troubleshooting

### **Problem: Deployment Failed**

**Check:**
1. Build logs in Railway dashboard
2. Ensure `backend` directory is selected as root
3. Verify all dependencies in package.json

**Common Issues:**
- `better-sqlite3` native module build fails
  - Solution: Railway should handle this automatically with Nixpacks
- Port binding errors
  - Solution: Ensure you're NOT setting PORT manually (Railway sets it)

### **Problem: Database Not Initializing**

**Check logs for:**
```
Database initialized successfully
```

If missing, the database.js initialization failed.

### **Problem: Can't Connect to Backend**

**Verify:**
1. Backend URL is correct (check Railway dashboard)
2. Health endpoint works: `/api/health`
3. CORS settings allow your frontend domain

### **Problem: Authentication Not Working**

**Check:**
1. JWT_SECRET environment variable is set
2. JWT_SECRET matches what's in Railway variables
3. Token is being sent in Authorization header

---

## 📈 Monitoring Your Deployment

### **Railway Dashboard Features:**

1. **Metrics Tab**
   - CPU usage
   - Memory usage
   - Network traffic

2. **Logs Tab**
   - Real-time application logs
   - Error messages
   - Request logs

3. **Deployments Tab**
   - Deployment history
   - Rollback capability
   - Build logs

### **Recommended Monitoring:**

After deployment, monitor:
- Response times
- Error rates
- Database size
- Memory usage

---

## 💰 Railway Pricing

**Free Trial:**
- $5 free credit for new accounts
- No credit card required initially

**Usage-Based Pricing:**
- ~$5-10/month for small apps
- Scales with usage

**Your Estimated Cost:**
- With current traffic: **$0-5/month**
- As site grows: **$5-15/month**

---

## 🔄 Auto-Deployment

Railway is now configured for **automatic deployments**:

- Every push to `main` branch triggers new deployment
- Railway pulls latest code from GitHub
- Builds and deploys automatically
- Zero downtime deployments

**To disable auto-deployment:**
1. Go to Railway project settings
2. Find "Deployments" section
3. Toggle off "Auto Deploy"

---

## 📝 Post-Deployment Checklist

After successful deployment:

- [ ] Health endpoint returns 200 OK
- [ ] Test user registration: `POST /api/auth/register`
- [ ] Test login: `POST /api/auth/login`
- [ ] Test business search: `GET /api/businesses/search?q=ramen`
- [ ] Frontend connects successfully
- [ ] Admin dashboard works
- [ ] Database persists data across deployments

---

## 🎯 Next Steps After Deployment

1. **Update Frontend URLs** (I'll help with this)
2. **Test All Endpoints** from frontend
3. **Create Admin Account** in production
4. **Add Rate Limiting** (security improvement)
5. **Set Up Database Backups** (critical)
6. **Add Monitoring** (Sentry, UptimeRobot)

---

## 🆘 Need Help?

If you encounter any issues during deployment:

1. **Check Railway Logs:**
   - Click on your deployment
   - Go to "Logs" tab
   - Look for error messages

2. **Common Error Messages:**
   ```
   Error: Cannot find module 'better-sqlite3'
   → Solution: Railway will rebuild, wait for completion
   
   Error: EADDRINUSE
   → Solution: Don't set PORT manually
   
   Error: JWT_SECRET not defined
   → Solution: Add JWT_SECRET environment variable
   ```

3. **Railway Documentation:**
   - https://docs.railway.app/
   - https://docs.railway.app/deploy/deployments

---

## ✅ Deployment Complete!

Once you see this message in Railway logs:

```
Asian Directory API server is running on port XXXX
Health check: http://localhost:XXXX/api/health
```

**Your backend is LIVE!** 🎉

**Provide me with your Railway URL and I'll update all frontend files immediately.**

---

**Generated JWT Secret (Keep Secure):**
```
Lj7z5u1mlWNVaxl6WGU8eiGZfo4sHd6LSsp1+mKdt1E=
```

**NEVER share this secret publicly or commit it to Git!**
