# Admin Login Feature - Deployment Guide

## Overview
This implementation adds a complete admin authentication system to the asian.directory project, allowing administrators to log in and manage business listings through a web interface.

## Features Implemented

### 1. Admin Login Link
- Small link added to the footer of all pages (home and chat mode)
- Text: "Admin Login"
- Located below the copyright notice
- Same font size as copyright text

### 2. Admin Login Page (`/admin-login.html`)
- Username and password fields
- Login functionality with JWT authentication
- Create new account option
- Form validation (client and server-side)
- Error/success messages
- Automatic redirect to dashboard on successful login

### 3. Admin Dashboard (`/admin-dashboard.html`)
- Protected page (requires authentication)
- Two main tabs:
  - **Add Business**: Form to add new businesses to the database
  - **Manage Businesses**: View all existing businesses

#### Add Business Form Fields:
- Business Name (required)
- Business Type/Category (required)
- Phone Number (optional)
- Location/Address (required)
- Description (required)
- Contact Person (optional)
- Website (optional)
- Keywords (comma-separated)
- Social Media Links (Instagram, Facebook, X/Twitter, LinkedIn)

### 4. Backend Authentication API

New endpoints added:
- `POST /api/auth/register` - Create new admin account
- `POST /api/auth/login` - Authenticate and get JWT token
- `GET /api/auth/verify` - Verify JWT token validity
- `POST /api/businesses` - Add new business (requires authentication)

## Security Features

✅ **Implemented:**
1. Password hashing with bcrypt (10 salt rounds)
2. JWT token authentication with 24-hour expiration
3. Authentication middleware for protected endpoints
4. Minimum password length validation (6 characters)
5. Client and server-side validation
6. Secure token storage in localStorage
7. Automatic token verification on page load

## Installation & Setup

### 1. Install Backend Dependencies
```bash
cd backend
npm install
```

This installs:
- `bcryptjs` - Password hashing
- `jsonwebtoken` - JWT token generation/verification
- Existing dependencies (express, cors, better-sqlite3)

### 2. Set Environment Variables (Production)
Create a `.env` file in the `backend` directory:
```
PORT=3000
JWT_SECRET=your-secure-random-string-here
```

**Important:** Generate a strong JWT secret for production:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 3. Start Backend Server
```bash
cd backend
npm start
```

### 4. Update Frontend Configuration (Production)
Update the API_BASE_URL in these files:
- `index.html`
- `admin-login.html`
- `admin-dashboard.html`

Change from:
```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

To your production URL:
```javascript
const API_BASE_URL = 'https://your-backend-domain.com/api';
```

## First Time Setup

### Create First Admin Account
1. Start the backend server
2. Navigate to `http://localhost:8080/admin-login.html`
3. Click "Create Account"
4. Enter username and password (minimum 6 characters)
5. Click "Create Account" button
6. Login with the new credentials

## Database Schema

### Users Table
```sql
CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

## Production Deployment Recommendations

### 1. Rate Limiting
Add rate limiting to prevent brute force attacks:
```bash
npm install express-rate-limit
```

Example implementation:
```javascript
const rateLimit = require('express-rate-limit');

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 5, // 5 requests per windowMs
    message: 'Too many login attempts, please try again later.'
});

app.post('/api/auth/login', authLimiter, async (req, res) => {
    // ... existing code
});
```

### 2. HTTPS
Always use HTTPS in production to protect credentials in transit.

### 3. CORS Configuration
Update CORS settings to only allow your frontend domain:
```javascript
app.use(cors({
    origin: 'https://your-frontend-domain.com'
}));
```

### 4. Database Backups
Regularly backup the SQLite database file:
```bash
cp backend/asian-directory.db backend/backups/asian-directory-$(date +%Y%m%d).db
```

### 5. Monitoring
Consider adding:
- Failed login attempt logging
- Authentication audit logs
- Database activity monitoring

## Testing Credentials (Development Only)

For development/testing, a default admin account is created:
- Username: `admin`
- Password: `admin123`

**Delete this account in production!**

## Troubleshooting

### Cannot login
1. Check backend server is running
2. Check browser console for errors
3. Verify API_BASE_URL is correct
4. Check network tab for API responses

### Token expired
- Tokens expire after 24 hours
- User will be automatically redirected to login page
- Simply login again to get a new token

### Password requirements
- Minimum 6 characters
- Both client and server validate this

### Port conflicts
If port 3000 is in use, change it:
```bash
PORT=3001 npm start
```

## Files Modified/Created

### New Files:
- `admin-login.html` - Login/registration page
- `admin-dashboard.html` - Admin dashboard
- `ADMIN_LOGIN_GUIDE.md` - This documentation

### Modified Files:
- `index.html` - Added admin login link to footer
- `backend/server.js` - Added authentication endpoints and middleware
- `backend/database.js` - Added users table and auth operations
- `backend/package.json` - Added bcryptjs and jsonwebtoken dependencies

## Support

For issues or questions:
1. Check this documentation
2. Review browser console for errors
3. Check backend server logs
4. Verify all environment variables are set correctly

## Future Enhancements

Potential improvements:
- Password reset functionality
- Multi-factor authentication (MFA)
- Role-based access control (admin, editor, viewer)
- Business edit/delete functionality
- Bulk import/export of businesses
- Activity logs and analytics dashboard
- Email notifications
- Account management (change password, etc.)
