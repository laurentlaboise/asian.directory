# DNS Setup Guide for asian.directory

## 🚨 Current DNS Configuration Issue

Your current DNS configuration has **conflicting records** that will cause problems:

### ❌ Problems Identified:

1. **Conflicting Apex Domain (@) Records:**
   - You have 4 **A Records** pointing to GitHub Pages (185.199.108.153, etc.)
   - You have a **CNAME Record** pointing to Railway (csxbygix.up.railway.app)
   - **DNS does not allow both A and CNAME records for the same domain (@)**

2. **Redundant URL Redirect:**
   - URL Redirect from @ to http://www.asian.directory/
   - This conflicts with the CNAME and A records

3. **Architecture Confusion:**
   - Your frontend is hosted on **GitHub Pages**
   - Your backend API is hosted on **Railway**
   - Your DNS is trying to serve both from the apex domain

---

## ✅ Recommended DNS Configuration

Based on your setup (frontend on GitHub Pages, backend on Railway), here's the **correct** configuration:

### **For GitHub Pages + Railway (Frontend + Backend)**

| Type | Host | Value | TTL | Purpose |
|------|------|-------|-----|---------|
| **A Record** | @ | 185.199.108.153 | Automatic | GitHub Pages IP #1 |
| **A Record** | @ | 185.199.109.153 | Automatic | GitHub Pages IP #2 |
| **A Record** | @ | 185.199.110.153 | Automatic | GitHub Pages IP #3 |
| **A Record** | @ | 185.199.111.153 | Automatic | GitHub Pages IP #4 |
| **CNAME Record** | www | laurentlaboise.github.io. | Automatic | WWW subdomain to GitHub Pages |
| **TXT Record** | _github-pages-challenge-laurentlaboise | e7fe5a7a6f422e908b474829995997 | Automatic | GitHub Pages verification |

### **Records to REMOVE:**

- ❌ **CNAME Record** for @ pointing to csxbygix.up.railway.app (conflicts with A records)
- ❌ **URL Redirect Record** from @ to http://www.asian.directory/ (not needed with A records)

---

## 📋 Why This Configuration Works

### **Frontend (GitHub Pages):**
- **asian.directory** → Served via A records pointing to GitHub Pages
- **www.asian.directory** → Served via CNAME pointing to GitHub Pages
- Both domains serve the same HTML/CSS/JS files

### **Backend (Railway):**
- **csxbygix.up.railway.app** → Backend API remains on Railway
- Frontend makes API calls to Railway URL
- No DNS configuration needed for backend (uses Railway's domain)

---

## 🔧 Step-by-Step Configuration

### **Step 1: Remove Conflicting Records**

In your DNS provider (Namecheap, GoDaddy, Cloudflare, etc.):

1. **Delete** the CNAME Record: `@ → csxbygix.up.railway.app`
2. **Delete** the URL Redirect: `@ → http://www.asian.directory/`

### **Step 2: Keep These Records**

Make sure these records exist (they're correct):

- ✅ A Records for @ pointing to all 4 GitHub Pages IPs
- ✅ CNAME Record for www pointing to laurentlaboise.github.io
- ✅ TXT Record for GitHub Pages verification

### **Step 3: Verify CNAME File in Repository**

The CNAME file should contain:
```
www.asian.directory
```

Or if you want the apex domain as primary:
```
asian.directory
```

**Current CNAME file:** `www.asian.directory` ✅ (This is correct)

### **Step 4: Wait for DNS Propagation**

- DNS changes take **15 minutes to 48 hours** to propagate worldwide
- Use https://www.whatsmydns.net/ to check propagation
- Test both:
  - http://asian.directory
  - http://www.asian.directory

### **Step 5: Verify GitHub Pages**

1. Go to your repository on GitHub
2. Settings → Pages
3. Ensure:
   - Source: Deploy from branch `main` or `master`
   - Custom domain: `www.asian.directory` or `asian.directory`
   - ✅ "Enforce HTTPS" should be checked (after DNS propagates)

---

## 🌐 How Requests Flow

### **For Frontend (asian.directory or www.asian.directory):**

```
User Browser
    ↓
asian.directory (via A records) or www.asian.directory (via CNAME)
    ↓
GitHub Pages (185.199.108.153 - 185.199.111.153)
    ↓
Serves index.html, CSS, JavaScript
```

### **For Backend API Calls:**

```
Frontend JavaScript
    ↓
fetch('https://csxbygix.up.railway.app/api/businesses')
    ↓
Railway Backend Server
    ↓
Returns JSON data
```

---

## 🐛 Troubleshooting

### **Issue: DNS_PROBE_FINISHED_NXDOMAIN**

**Cause:** DNS records not configured correctly or not propagated yet

**Solution:**
1. Verify A records are pointing to all 4 GitHub Pages IPs
2. Wait for DNS propagation (up to 48 hours)
3. Clear browser cache: `Ctrl+Shift+Delete`
4. Flush DNS cache:
   - Windows: `ipconfig /flushdns`
   - Mac: `sudo killall -HUP mDNSResponder`
   - Linux: `sudo systemd-resolve --flush-caches`

### **Issue: Site works on www but not on apex domain**

**Cause:** Missing A records or CNAME misconfiguration

**Solution:**
1. Ensure all 4 A records exist for @
2. Remove any CNAME records for @
3. Update CNAME file in repository

### **Issue: Certificate error (Not Secure)**

**Cause:** HTTPS not enabled on GitHub Pages or DNS not propagated

**Solution:**
1. Wait for DNS to fully propagate (24-48 hours)
2. Go to GitHub repository Settings → Pages
3. Check "Enforce HTTPS" (option appears after DNS propagates)
4. Wait 5-10 minutes for certificate to provision

### **Issue: 404 error on GitHub Pages**

**Cause:** CNAME file mismatch or repository not published

**Solution:**
1. Verify CNAME file matches your domain
2. Check GitHub Pages settings are correct
3. Ensure branch has been deployed

### **Issue: API calls failing (CORS errors)**

**Cause:** Backend not configured with correct CORS origins

**Solution:**
1. Update Railway environment variable:
   ```
   ALLOWED_ORIGINS=https://asian.directory,https://www.asian.directory
   ```
2. Redeploy backend on Railway
3. Verify backend health: https://csxbygix.up.railway.app/api/health

---

## 📊 DNS Record Validation

Use these tools to verify your DNS configuration:

1. **DNS Checker:** https://www.whatsmydns.net/
   - Enter: `asian.directory`
   - Check A records show GitHub Pages IPs

2. **DNS Lookup:**
   ```bash
   # Check A records
   nslookup asian.directory
   
   # Check CNAME records
   nslookup www.asian.directory
   ```

3. **Expected Results:**
   ```
   # For asian.directory (A records)
   asian.directory    A    185.199.108.153
   asian.directory    A    185.199.109.153
   asian.directory    A    185.199.110.153
   asian.directory    A    185.199.111.153
   
   # For www.asian.directory (CNAME)
   www.asian.directory    CNAME    laurentlaboise.github.io
   ```

---

## 🔐 Security Checklist

After DNS is configured:

- [ ] HTTPS is enforced on GitHub Pages
- [ ] Certificate is valid for both asian.directory and www.asian.directory
- [ ] Railway backend uses HTTPS (csxbygix.up.railway.app)
- [ ] CORS is properly configured on backend
- [ ] No mixed content warnings (HTTP/HTTPS)

---

## 📝 Summary

**Your DNS configuration has a conflict.** You cannot have both:
- A Records for @ (apex domain)
- CNAME Record for @ (apex domain)

**Solution:**
1. **Keep:** A Records + CNAME for www (GitHub Pages frontend)
2. **Remove:** CNAME @ → Railway (backend uses its own Railway domain)
3. **Remove:** URL Redirect (not needed)

**After fixing:**
- Frontend: asian.directory + www.asian.directory (GitHub Pages)
- Backend: csxbygix.up.railway.app (Railway)
- Everything works correctly! ✅

---

## 🆘 Still Having Issues?

If you're still experiencing problems after following this guide:

1. Share your DNS provider name (Namecheap, GoDaddy, Cloudflare, etc.)
2. Wait at least 24 hours for DNS propagation
3. Check DNS propagation status: https://www.whatsmydns.net/
4. Verify GitHub Pages deployment status
5. Test backend directly: https://csxbygix.up.railway.app/api/health

---

## ⚠️ Railway Platform Status

**As of February 3, 2026:** Railway is experiencing platform-wide issues including DNS resolution problems.

### Check Railway Status:
- Official: https://status.railway.com/
- StatusGator: https://statusgator.com/services/railway
- IsDown: https://isdown.app/status/railway

If the backend (`csxbygix.up.railway.app`) is unreachable, this may be due to Railway platform issues, not your DNS configuration.

### Diagnostic Steps:

1. Check Railway status page first
2. Test backend health: `curl https://csxbygix.up.railway.app/api/health`
3. If DNS resolution fails, wait for Railway platform recovery
4. For immediate development, run backend locally:
   ```bash
   cd backend && npm install && npm start
   ```

---

**Last Updated:** February 3, 2026  
**Status:** DNS configuration documented; Railway platform experiencing DNS issues
