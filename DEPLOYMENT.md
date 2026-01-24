# Deploying asian.directory Backend

The frontend is hosted on GitHub Pages, but the backend needs to be deployed separately.

## Quick Deploy Options

### Option 1: Railway (Recommended - Free Tier Available)

1. **Sign up at [Railway.app](https://railway.app)**

2. **Deploy from GitHub:**
   - Click "New Project"
   - Select "Deploy from GitHub repo"
   - Choose this repository
   - Select the `backend` folder
   - Railway will auto-detect Node.js and deploy

3. **Get your backend URL:**
   - After deployment, Railway provides a URL like: `https://your-app.railway.app`
   - Copy this URL

4. **Update the frontend:**
   - Edit `index.html`, `admin-login.html`, and `admin-dashboard.html`
   - Find the line: `API_BASE_URL = 'https://your-backend-url.railway.app/api';`
   - Replace with your actual Railway URL: `https://your-app.railway.app/api`

5. **Commit and push:**
   ```bash
   git add .
   git commit -m "Add production backend URL"
   git push
   ```

### Option 2: Render.com (Free Tier Available)

1. **Sign up at [Render.com](https://render.com)**

2. **Create New Web Service:**
   - Connect your GitHub repo
   - Root Directory: `backend`
   - Environment: `Node`
   - Build Command: `npm install`
   - Start Command: `npm start`

3. **Get your backend URL** (e.g., `https://your-app.onrender.com`)

4. **Update frontend** (same as Railway step 4-5)

### Option 3: Heroku

1. **Install Heroku CLI and login**
   ```bash
   heroku login
   ```

2. **Create app and deploy:**
   ```bash
   cd backend
   heroku create your-app-name
   git push heroku main
   ```

3. **Get URL** from Heroku dashboard and update frontend

## Environment Variables

Set these on your hosting platform:

- `PORT` - Usually auto-set by the platform
- `JWT_SECRET` - Set a strong secret key for production (e.g., `openssl rand -base64 32`)

## After Deployment

1. Test the backend: `https://your-backend-url/api/health`
   - Should return: `{"status":"ok","message":"Asian Directory API is running"}`

2. Update all frontend files with your backend URL

3. Commit and push changes to GitHub

4. Your live site at https://www.asian.directory will now work!

## Quick Test

After deploying, test registration:
```bash
curl -X POST https://your-backend-url/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"test123"}'
```

Should return: `{"success":true,"message":"User created successfully","userId":1}`
