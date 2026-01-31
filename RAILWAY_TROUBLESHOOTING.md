# Railway Troubleshooting: Root Directory Fix

## Issue: Railway Serving Frontend Instead of Backend API

### Symptoms
- Visiting `https://your-app.railway.app/api/health` returns HTML instead of JSON
- Backend API endpoints return the frontend homepage
- Railway is deploying the wrong part of the repository

### Root Cause
Railway is deploying from the repository root (which contains frontend files) instead of the `backend` directory where the Node.js API server is located.

---

## Solution: Configure Root Directory

### Method 1: Update Existing Deployment (Recommended)

1. **Go to Railway Dashboard**
   - Navigate to: https://railway.app
   - Find your project: `asian.directory` or similar

2. **Select Your Service**
   - Click on the service/deployment box

3. **Open Settings Tab**
   - Look for the "Settings" tab in the service view

4. **Configure Root Directory**
   - Find "Root Directory" or "Working Directory" setting
   - Change from: (empty) or `/`
   - Change to: `backend`
   - Click "Save" or "Update"

5. **Trigger Redeploy**
   - Railway should automatically redeploy
   - Or manually trigger: Click "Deployments" → "Trigger Deploy"

6. **Verify Deployment Logs**
   Look for these log entries:
   ```
   ✅ Installing dependencies...
   ✅ npm install
   ✅ added 150+ packages
   ✅ Database initialized successfully
   ✅ Asian Directory API server is running on port XXXX
   ```

7. **Test the API**
   ```bash
   curl https://asiandirectory-production-7ec4.up.railway.app/api/health
   ```
   
   Expected response:
   ```json
   {"status":"ok","message":"Asian Directory API is running"}
   ```

---

### Method 2: Fresh Deployment

If you can't find the Root Directory setting:

1. **Delete Current Deployment**
   - In Railway, go to project settings
   - Delete the current service

2. **Create New Deployment**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose: `laurentlaboise/asian.directory`
   - **IMPORTANT**: Set "Root Directory" to `backend` during setup
   - Add environment variables again:
     - `JWT_SECRET`
     - `ALLOWED_ORIGINS`
     - `NODE_ENV=production`

3. **Deploy and Test**

---

## Verification Checklist

After configuration:

- [ ] Deployment logs show "npm install" running
- [ ] Logs show "Database initialized successfully"
- [ ] Logs show "Asian Directory API server is running"
- [ ] `/api/health` returns JSON (not HTML)
- [ ] `/api/businesses` returns JSON array
- [ ] Environment variables are set correctly

---

## Common Mistakes

### ❌ Wrong Root Directory Values
- `` (empty) - deploys entire repo
- `/` - deploys entire repo
- `./backend` - incorrect syntax
- `backend/` - trailing slash may cause issues

### ✅ Correct Root Directory
- `backend` - exact value to use

---

## Expected vs Actual Responses

### When WRONG (Frontend Deployed):
```bash
$ curl https://your-app.railway.app/api/health
<!DOCTYPE html>
<html lang="en">
<head>
    <title>asian.directory - AI Business Search</title>
...
```

### When CORRECT (Backend Deployed):
```bash
$ curl https://your-app.railway.app/api/health
{"status":"ok","message":"Asian Directory API is running"}
```

---

## Additional Configuration

### Required Environment Variables

Once Root Directory is fixed, ensure these are set in Railway Variables tab:

```bash
JWT_SECRET=Lj7z5u1mlWNVaxl6WGU8eiGZfo4sHd6LSsp1+mKdt1E=
ALLOWED_ORIGINS=https://www.asian.directory,https://asian.directory
NODE_ENV=production
```

**Note**: PORT is automatically set by Railway, don't set it manually.

---

## Railway Dashboard Navigation

```
Railway Dashboard
└── Your Project (asian.directory)
    └── Service (click to enter)
        ├── Deployments (view logs, trigger redeploy)
        ├── Variables (environment variables)
        ├── Settings ⭐ (Root Directory setting here)
        ├── Metrics (performance data)
        └── Logs (real-time logs)
```

---

## Still Not Working?

### Check Deployment Logs

Look for error messages in logs:

1. **Module not found errors**
   - Ensure Root Directory is set to `backend`
   - Check that `backend/package.json` exists

2. **Port binding errors**
   - Remove any manually set PORT variable
   - Railway sets this automatically

3. **Database errors**
   - Check file permissions
   - Ensure `better-sqlite3` installed correctly

### Railway CLI Alternative

If web interface doesn't work, use Railway CLI:

```bash
# Install Railway CLI
npm i -g @railway/cli

# Login
railway login

# Link to project
railway link

# Set root directory
railway service root-directory backend

# Trigger deploy
railway up
```

---

## Success Indicators

When properly configured, you should see:

1. **Logs show Node.js startup**
   ```
   Database initialized successfully
   Asian Directory API server is running on port 3000
   ```

2. **Health endpoint works**
   ```bash
   curl https://your-app.railway.app/api/health
   # Returns JSON, not HTML
   ```

3. **All API endpoints respond**
   - `/api/health` ✅
   - `/api/businesses` ✅
   - `/api/businesses/search?q=test` ✅
   - `/api/auth/register` ✅
   - `/api/auth/login` ✅

---

## Next Steps After Fix

Once backend is properly deployed:

1. Update frontend files with production API URL
2. Test all functionality end-to-end
3. Set up monitoring (optional)
4. Configure database backups

---

## Related Files

- `backend/package.json` - Dependencies and start script
- `backend/server.js` - Express server entry point
- `backend/railway.json` - Railway configuration
- `backend/.env.example` - Environment variable template

---

**Last Updated**: January 30, 2026  
**Issue**: Railway Root Directory Configuration  
**Resolution Time**: ~5 minutes
