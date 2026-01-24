# Quick Start Guide - Admin Authentication

This guide will help you quickly start the asian.directory website with admin authentication enabled.

## Prerequisites

- Node.js (v14 or higher)
- Python 3 (for serving static files)

## Quick Start (Recommended)

Run the startup script:

```bash
./start-servers.sh
```

This will:
1. Install backend dependencies (if needed)
2. Start the backend API server on port 3000
3. Start the frontend server on port 8080

## Manual Start

### Step 1: Start Backend Server

```bash
cd backend
npm install
node server.js
```

The backend API will be available at `http://localhost:3000`

### Step 2: Start Frontend Server

Open a new terminal:

```bash
python3 -m http.server 8080
```

The frontend will be available at `http://localhost:8080`

## Access Points

- **Homepage**: http://localhost:8080
- **Admin Login**: http://localhost:8080/admin-login.html
- **Admin Dashboard**: http://localhost:8080/admin-dashboard.html (requires login)
- **Backend API**: http://localhost:3000/api

## Creating Your First Admin Account

1. Navigate to http://localhost:8080/admin-login.html
2. Click "Create Account"
3. Enter a username and password (minimum 6 characters)
4. Click "Create Account"
5. Login with your new credentials

## Features

### Admin Login Page
- Username/password authentication
- JWT token-based sessions (24-hour expiration)
- Account creation functionality
- Automatic redirect to dashboard on successful login

### Admin Dashboard
- **Add Business**: Form to add new businesses to the directory
- **Manage Businesses**: View all businesses in the database
- Token verification on page load
- Logout functionality

### Backend API
- `POST /api/auth/register` - Create new admin account
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/verify` - Verify JWT token
- `POST /api/businesses` - Add new business (requires authentication)
- `GET /api/businesses` - Get all businesses
- `GET /api/businesses/search?q=query` - Search businesses

## Testing the Connection

You can verify the servers are connected by:

1. **Test Backend Health**:
   ```bash
   curl http://localhost:3000/api/health
   ```
   Should return: `{"status":"ok","message":"Asian Directory API is running"}`

2. **Create an Account via API**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","password":"test123"}'
   ```

3. **Login via API**:
   ```bash
   curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"testuser","password":"test123"}'
   ```

## Security Notes

- Passwords are hashed using bcrypt with 10 salt rounds
- JWT tokens expire after 24 hours
- The default JWT secret is for development only - set `JWT_SECRET` environment variable in production
- Always use HTTPS in production

## Troubleshooting

### Port Already in Use

If port 3000 or 8080 is already in use:

- Backend: Set PORT environment variable: `PORT=3001 node server.js`
- Frontend: Use different port: `python3 -m http.server 8081`

### Cannot Connect to Backend

1. Verify backend is running: `curl http://localhost:3000/api/health`
2. Check console for errors
3. Verify `API_BASE_URL` in HTML files matches your backend URL

### Database Issues

To reset the database:
```bash
rm backend/asian-directory.db
# Restart backend server - it will recreate the database
```

## Production Deployment

For production deployment, see [ADMIN_LOGIN_GUIDE.md](ADMIN_LOGIN_GUIDE.md) for detailed instructions on:
- Setting environment variables
- Configuring CORS
- Using HTTPS
- Rate limiting
- Database backups

## Support

For more information, see:
- [ADMIN_LOGIN_GUIDE.md](ADMIN_LOGIN_GUIDE.md) - Complete deployment guide
- [SETUP.md](SETUP.md) - General setup instructions
- [backend/README.md](backend/README.md) - API documentation
