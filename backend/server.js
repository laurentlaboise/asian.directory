const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const https = require('https');
const http = require('http');
const path = require('path');
const crypto = require('crypto');
const packageJson = require('./package.json');

// ---------------------------------------------------------------------------
// Database auto-detection: PostgreSQL when DATABASE_URL is set, else SQLite
// ---------------------------------------------------------------------------
const USE_POSTGRES = !!process.env.DATABASE_URL;
const dbModule = require(USE_POSTGRES ? './database-postgres' : './database');
const { dbOperations, dbReady } = dbModule;

if (!dbOperations) {
    console.error('FATAL: No database available. Set DATABASE_URL for PostgreSQL or install better-sqlite3 for local SQLite.');
    process.exit(1);
}
console.log(`Using database: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-please-change-in-production-use-env-variable';
const CSRF_SECRET = process.env.CSRF_SECRET || 'csrf-dev-secret-change-in-production';

// OAuth configuration
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_CALLBACK_URL = process.env.GOOGLE_CALLBACK_URL || 'http://localhost:3000/api/auth/google/callback';

const FACEBOOK_APP_ID = process.env.FACEBOOK_APP_ID;
const FACEBOOK_APP_SECRET = process.env.FACEBOOK_APP_SECRET;
const FACEBOOK_CALLBACK_URL = process.env.FACEBOOK_CALLBACK_URL || 'http://localhost:3000/api/auth/facebook/callback';

// CORS origins
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : [
        'http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080',
        'https://asian.directory', 'https://www.asian.directory',
        'https://asiandirectory-production-7ec4.up.railway.app'
      ];

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------

// Helmet -- security headers
app.use(helmet({
    contentSecurityPolicy: false,       // allow inline scripts for the SPA frontend
    crossOriginEmbedderPolicy: false    // allow embedding from various origins
}));

// CORS
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (curl, server-to-server, mobile apps)
        if (!origin) return callback(null, true);
        if (ALLOWED_ORIGINS.indexOf(origin) !== -1 || ALLOWED_ORIGINS.includes('*')) {
            return callback(null, true);
        }
        callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-CSRF-Token']
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookies (needed for CSRF + OAuth state)
app.use(cookieParser());

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 500,                   // 500 requests per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests, please try again later' }
});

const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 30,                    // 30 auth attempts per window
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many authentication attempts, please try again later' }
});

const apiKeyLimiter = rateLimit({
    windowMs: 60 * 1000,       // 1 minute
    max: 60,                    // 60 requests per minute for public API
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.headers['x-api-key'] || req.ip,
    message: { success: false, error: 'API rate limit exceeded' }
});

app.use('/api/', generalLimiter);

// ---------------------------------------------------------------------------
// CSRF protection for cookie/session-based routes
// ---------------------------------------------------------------------------
// Generate a CSRF token for clients that need it (cookie-based sessions).
// The token is sent via a cookie and must be returned in the X-CSRF-Token header.
function generateCsrfToken() {
    return crypto.randomBytes(32).toString('hex');
}

function csrfProtection(req, res, next) {
    // Skip for GET/HEAD/OPTIONS (safe methods)
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
        return next();
    }
    // Skip for Bearer-token-authenticated API requests (not cookie-based)
    if (req.headers.authorization && req.headers.authorization.startsWith('Bearer ')) {
        return next();
    }
    // Skip for API-key-authenticated requests
    if (req.headers['x-api-key']) {
        return next();
    }
    // Skip for auth endpoints (stateless JWT, not cookie-session based)
    if (req.path.startsWith('/auth/') || req.path.startsWith('/api/auth/')) {
        return next();
    }
    // Skip for public endpoints that don't require session auth
    if (req.path === '/analytics/event' || req.path === '/api/analytics/event' ||
        req.path === '/conversations' || req.path === '/api/conversations' ||
        req.path.startsWith('/public/') || req.path.startsWith('/api/public/')) {
        return next();
    }

    const cookieToken = req.cookies && req.cookies._csrf;
    const headerToken = req.headers['x-csrf-token'];

    if (!cookieToken || !headerToken || cookieToken !== headerToken) {
        return res.status(403).json({ success: false, error: 'Invalid or missing CSRF token' });
    }
    next();
}

// Endpoint to retrieve a fresh CSRF token (sets cookie + returns token in body)
app.get('/api/csrf-token', (req, res) => {
    const token = generateCsrfToken();
    res.cookie('_csrf', token, {
        httpOnly: true,
        sameSite: 'strict',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 3600000  // 1 hour
    });
    res.json({ success: true, csrfToken: token });
});

// Apply CSRF protection to all /api/ mutating requests
app.use('/api/', csrfProtection);

// ---------------------------------------------------------------------------
// Request logging
// ---------------------------------------------------------------------------
app.use((req, res, next) => {
    const start = Date.now();
    const originalEnd = res.end;
    res.end = function (...args) {
        const duration = Date.now() - start;
        const logLine = `${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms`;
        if (res.statusCode >= 400) {
            console.error(logLine);
        } else {
            console.log(logLine);
        }
        originalEnd.apply(res, args);
    };
    next();
});

// ---------------------------------------------------------------------------
// Static files -- serve frontend from parent directory
// ---------------------------------------------------------------------------
app.use(express.static(path.join(__dirname, '..'), {
    extensions: ['html'],
    index: 'index.html'
}));

// ---------------------------------------------------------------------------
// Authentication middleware
// ---------------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
        return res.status(401).json({ success: false, error: 'Access token required' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ success: false, error: 'Invalid or expired token' });
        }
        req.user = user;
        next();
    });
};

// Optional auth -- attach user if token present, but don't block
const optionalAuth = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];
    if (token) {
        jwt.verify(token, JWT_SECRET, (err, user) => {
            if (!err) req.user = user;
            next();
        });
    } else {
        next();
    }
};

// Role-based access control
const requireRole = (...roles) => {
    return (req, res, next) => {
        if (!req.user) {
            return res.status(401).json({ success: false, error: 'Authentication required' });
        }
        if (!roles.includes(req.user.role)) {
            return res.status(403).json({
                success: false,
                error: `Access denied. Required role: ${roles.join(' or ')}`
            });
        }
        next();
    };
};

// API key authentication for public API (/api/v1/*)
const authenticateApiKey = async (req, res, next) => {
    const apiKey = req.headers['x-api-key'] || req.query.api_key;

    if (!apiKey) {
        return res.status(401).json({
            success: false,
            error: 'API key required. Pass it via X-API-Key header or api_key query parameter'
        });
    }

    try {
        const keyData = await dbOperations.validateApiKey(apiKey);
        if (!keyData) {
            return res.status(401).json({ success: false, error: 'Invalid or expired API key' });
        }

        req.apiKey = keyData;
        req.apiKeyStartTime = Date.now();

        // Log usage after response completes
        res.on('finish', async () => {
            try {
                const responseTime = Date.now() - req.apiKeyStartTime;
                await dbOperations.logApiUsage(
                    keyData.id,
                    req.originalUrl,
                    req.method,
                    res.statusCode,
                    responseTime,
                    req.ip
                );
            } catch (logErr) {
                console.error('Failed to log API usage:', logErr);
            }
        });

        next();
    } catch (error) {
        console.error('API key validation error:', error);
        res.status(500).json({ success: false, error: 'API key validation failed' });
    }
};

// ---------------------------------------------------------------------------
// Helper: make an HTTPS/HTTP request (returns Promise)
// ---------------------------------------------------------------------------
function httpRequest(url, options = {}) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const transport = parsedUrl.protocol === 'https:' ? https : http;
        const reqOptions = {
            hostname: parsedUrl.hostname,
            port: parsedUrl.port,
            path: parsedUrl.pathname + parsedUrl.search,
            method: options.method || 'GET',
            headers: options.headers || {}
        };

        const req = transport.request(reqOptions, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                try {
                    resolve({ statusCode: res.statusCode, data: JSON.parse(data) });
                } catch {
                    resolve({ statusCode: res.statusCode, data });
                }
            });
        });

        req.on('error', reject);

        if (options.body) {
            req.write(typeof options.body === 'string' ? options.body : JSON.stringify(options.body));
        }

        req.end();
    });
}

// Helper: generate JWT for a user object
function signToken(user) {
    return jwt.sign(
        { id: user.id, username: user.username, role: user.role || 'viewer' },
        JWT_SECRET,
        { expiresIn: '24h' }
    );
}

// ===========================================================================================
//  ROUTES
// ===========================================================================================

// ---------------------------------------------------------------------------
// Root -- API information
// ---------------------------------------------------------------------------
// API info endpoint (moved from / to /api to avoid shadowing static index.html)
app.get('/api', (req, res) => {
    res.json({
        name: packageJson.name,
        version: packageJson.version,
        status: 'running',
        endpoints: {
            health: '/api/health',
            auth: {
                register: 'POST /api/auth/register',
                login: 'POST /api/auth/login',
                verify: 'GET /api/auth/verify',
                google: 'GET /api/auth/google',
                facebook: 'GET /api/auth/facebook'
            },
            businesses: {
                list: 'GET /api/businesses',
                search: 'GET /api/businesses/search?q=query',
                get: 'GET /api/businesses/:id',
                create: 'POST /api/businesses (requires auth)',
                update: 'PUT /api/businesses/:id (requires auth)',
                patch: 'PATCH /api/businesses/:id (requires auth)',
                delete: 'DELETE /api/businesses/:id (requires auth)',
                stats: 'GET /api/businesses/stats (requires auth)',
                export: 'GET /api/businesses/export?format=json|csv (requires auth)',
                categories: 'GET /api/businesses/categories',
                countries: 'GET /api/businesses/countries',
                bulkPipeline: 'POST /api/businesses/bulk-pipeline (requires auth, admin/editor)'
            },
            conversations: {
                list: 'GET /api/conversations',
                create: 'POST /api/conversations'
            },
            crm: {
                dashboard: 'GET /api/crm/dashboard (requires auth, admin/editor)',
                pipeline: 'GET /api/crm/pipeline (requires auth)',
                analytics: 'GET /api/crm/analytics?days=30 (requires auth, admin)',
                auditLog: 'GET /api/crm/audit-log (requires auth, admin)',
                communications: 'POST /api/crm/communications (requires auth)',
                communicationHistory: 'GET /api/crm/communications/:businessId (requires auth)'
            },
            users: {
                list: 'GET /api/users (requires auth, admin)',
                updateRole: 'PATCH /api/users/:id/role (requires auth, admin)',
                toggleActive: 'PATCH /api/users/:id/active (requires auth, admin)'
            },
            apiKeys: {
                create: 'POST /api/keys (requires auth)',
                list: 'GET /api/keys (requires auth)',
                listAll: 'GET /api/keys/all (requires auth, admin)',
                revoke: 'DELETE /api/keys/:id (requires auth)',
                usage: 'GET /api/keys/:id/usage (requires auth)'
            },
            tags: {
                create: 'POST /api/tags (requires auth)',
                list: 'GET /api/tags (requires auth)',
                addToBusiness: 'POST /api/tags/business/:businessId (requires auth)',
                removeFromBusiness: 'DELETE /api/tags/business/:businessId/:tagId (requires auth)'
            },
            analytics: {
                trackEvent: 'POST /api/analytics/event'
            },
            publicApi: {
                businesses: 'GET /api/v1/businesses (requires API key)',
                search: 'GET /api/v1/businesses/search (requires API key)',
                get: 'GET /api/v1/businesses/:id (requires API key)'
            }
        }
    });
});

// Favicon handler
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get('/api/health', (req, res) => {
    res.json({
        status: 'ok',
        message: 'Asian Directory API is running',
        database: USE_POSTGRES ? 'postgresql' : 'sqlite',
        timestamp: new Date().toISOString()
    });
});

// ===========================================================================================
//  AUTH ROUTES
// ===========================================================================================

// Register
app.post('/api/auth/register', authLimiter, async (req, res) => {
    try {
        const { username, password, email } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        if (password.length < 6) {
            return res.status(400).json({
                success: false,
                error: 'Password must be at least 6 characters long'
            });
        }

        const hashedPassword = await bcrypt.hash(password, 10);

        // First user gets admin role automatically
        const userCount = await dbOperations.getUserCount ? await dbOperations.getUserCount() : null;
        const role = (userCount === 0) ? 'admin' : 'viewer';

        const userId = await dbOperations.createUser(username, hashedPassword, email || null, role, username);

        const token = jwt.sign(
            { id: userId, username, role },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'User created successfully',
            userId,
            token,
            user: { id: userId, username, role }
        });
    } catch (error) {
        console.error('Error creating user:', error);
        if (error.message === 'Username already exists') {
            res.status(400).json({ success: false, error: error.message });
        } else {
            res.status(500).json({ success: false, error: 'Failed to create user' });
        }
    }
});

// Login
app.post('/api/auth/login', authLimiter, async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                success: false,
                error: 'Username and password are required'
            });
        }

        const user = await dbOperations.getUserByUsername(username);

        if (!user) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        if (user.is_active === false || user.is_active === 0) {
            return res.status(403).json({
                success: false,
                error: 'Account is deactivated. Contact an administrator.'
            });
        }

        const isValidPassword = await bcrypt.compare(password, user.password);
        if (!isValidPassword) {
            return res.status(401).json({
                success: false,
                error: 'Invalid username or password'
            });
        }

        // Update last login
        await dbOperations.updateUserLogin(user.id);

        // Auto-promote to admin if no admin exists yet
        let role = user.role;
        if (role !== 'admin' && dbOperations.getAdminCount) {
            try {
                const adminCount = await dbOperations.getAdminCount();
                if (adminCount === 0) {
                    await dbOperations.promoteToAdmin(user.id);
                    role = 'admin';
                    console.log(`Auto-promoted user ${user.username} to admin (no admins existed)`);
                }
            } catch (e) { console.error('Admin check failed:', e.message); }
        }

        const tokenUser = { ...user, role };
        const token = signToken(tokenUser);

        res.json({
            success: true,
            token,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role,
                display_name: user.display_name,
                avatar_url: user.avatar_url
            }
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, async (req, res) => {
    try {
        const user = await dbOperations.getUserById(req.user.id);
        if (!user) {
            return res.status(404).json({ success: false, error: 'User not found' });
        }
        res.json({
            success: true,
            user: {
                id: user.id,
                username: user.username,
                email: user.email,
                role: user.role,
                display_name: user.display_name,
                avatar_url: user.avatar_url
            }
        });
    } catch (error) {
        console.error('Error verifying token:', error);
        res.status(500).json({ success: false, error: 'Verification failed' });
    }
});

// ---------------------------------------------------------------------------
// Google OAuth
// ---------------------------------------------------------------------------
app.get('/api/auth/google', (req, res) => {
    if (!GOOGLE_CLIENT_ID) {
        return res.status(501).json({ success: false, error: 'Google OAuth not configured' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 600000  // 10 minutes
    });

    const params = new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        redirect_uri: GOOGLE_CALLBACK_URL,
        response_type: 'code',
        scope: 'openid email profile',
        state,
        access_type: 'offline',
        prompt: 'consent'
    });

    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
});

app.get('/api/auth/google/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        const savedState = req.cookies && req.cookies.oauth_state;

        if (!code) {
            return res.status(400).json({ success: false, error: 'Authorization code missing' });
        }

        if (!state || state !== savedState) {
            return res.status(403).json({ success: false, error: 'Invalid OAuth state' });
        }
        res.clearCookie('oauth_state');

        // Exchange code for tokens
        const tokenBody = new URLSearchParams({
            code,
            client_id: GOOGLE_CLIENT_ID,
            client_secret: GOOGLE_CLIENT_SECRET,
            redirect_uri: GOOGLE_CALLBACK_URL,
            grant_type: 'authorization_code'
        }).toString();

        const tokenResponse = await httpRequest('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenBody
        });

        if (tokenResponse.statusCode !== 200 || !tokenResponse.data.access_token) {
            console.error('Google token exchange failed:', tokenResponse.data);
            return res.status(401).json({ success: false, error: 'Google authentication failed' });
        }

        // Fetch user info
        const userInfoResponse = await httpRequest(
            `https://www.googleapis.com/oauth2/v2/userinfo?access_token=${tokenResponse.data.access_token}`
        );

        if (userInfoResponse.statusCode !== 200) {
            return res.status(401).json({ success: false, error: 'Failed to fetch Google user info' });
        }

        const googleUser = userInfoResponse.data;

        // Create or update user in our database
        const user = await dbOperations.createOAuthUser(
            'google',
            googleUser.id,
            googleUser.email,
            googleUser.name || googleUser.email,
            googleUser.picture
        );

        await dbOperations.updateUserLogin(user.id);
        const jwtToken = signToken(user);

        // Redirect back to the frontend with the token
        const frontendUrl = ALLOWED_ORIGINS[0] || 'http://localhost:3000';
        res.redirect(`${frontendUrl}?token=${jwtToken}&auth=google`);
    } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.status(500).json({ success: false, error: 'Google OAuth failed' });
    }
});

// ---------------------------------------------------------------------------
// Facebook OAuth
// ---------------------------------------------------------------------------
app.get('/api/auth/facebook', (req, res) => {
    if (!FACEBOOK_APP_ID) {
        return res.status(501).json({ success: false, error: 'Facebook OAuth not configured' });
    }

    const state = crypto.randomBytes(16).toString('hex');
    res.cookie('oauth_state', state, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 600000
    });

    const params = new URLSearchParams({
        client_id: FACEBOOK_APP_ID,
        redirect_uri: FACEBOOK_CALLBACK_URL,
        state,
        scope: 'email,public_profile',
        response_type: 'code'
    });

    res.redirect(`https://www.facebook.com/v18.0/dialog/oauth?${params.toString()}`);
});

app.get('/api/auth/facebook/callback', async (req, res) => {
    try {
        const { code, state } = req.query;
        const savedState = req.cookies && req.cookies.oauth_state;

        if (!code) {
            return res.status(400).json({ success: false, error: 'Authorization code missing' });
        }

        if (!state || state !== savedState) {
            return res.status(403).json({ success: false, error: 'Invalid OAuth state' });
        }
        res.clearCookie('oauth_state');

        // Exchange code for access token
        const tokenParams = new URLSearchParams({
            client_id: FACEBOOK_APP_ID,
            client_secret: FACEBOOK_APP_SECRET,
            redirect_uri: FACEBOOK_CALLBACK_URL,
            code
        });

        const tokenResponse = await httpRequest(
            `https://graph.facebook.com/v18.0/oauth/access_token?${tokenParams.toString()}`
        );

        if (tokenResponse.statusCode !== 200 || !tokenResponse.data.access_token) {
            console.error('Facebook token exchange failed:', tokenResponse.data);
            return res.status(401).json({ success: false, error: 'Facebook authentication failed' });
        }

        // Fetch user info
        const userInfoResponse = await httpRequest(
            `https://graph.facebook.com/v18.0/me?fields=id,name,email,picture.type(large)&access_token=${tokenResponse.data.access_token}`
        );

        if (userInfoResponse.statusCode !== 200) {
            return res.status(401).json({ success: false, error: 'Failed to fetch Facebook user info' });
        }

        const fbUser = userInfoResponse.data;

        const user = await dbOperations.createOAuthUser(
            'facebook',
            fbUser.id,
            fbUser.email || null,
            fbUser.name,
            fbUser.picture && fbUser.picture.data ? fbUser.picture.data.url : null
        );

        await dbOperations.updateUserLogin(user.id);
        const jwtToken = signToken(user);

        const frontendUrl = ALLOWED_ORIGINS[0] || 'http://localhost:3000';
        res.redirect(`${frontendUrl}?token=${jwtToken}&auth=facebook`);
    } catch (error) {
        console.error('Facebook OAuth callback error:', error);
        res.status(500).json({ success: false, error: 'Facebook OAuth failed' });
    }
});

// ===========================================================================================
//  BUSINESS ROUTES
// ===========================================================================================

// Public: categories list
app.get('/api/businesses/categories', async (req, res) => {
    try {
        const categories = await dbOperations.getCategories();
        res.json({ success: true, data: categories });
    } catch (error) {
        console.error('Error fetching categories:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch categories' });
    }
});

// Public: countries list
app.get('/api/businesses/countries', async (req, res) => {
    try {
        const countries = await dbOperations.getCountries();
        res.json({ success: true, data: countries });
    } catch (error) {
        console.error('Error fetching countries:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch countries' });
    }
});

// Auth: business stats
app.get('/api/businesses/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await dbOperations.getBusinessStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching business stats:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch business stats' });
    }
});

// Auth: export businesses
app.get('/api/businesses/export', authenticateToken, async (req, res) => {
    try {
        const format = req.query.format || 'json';
        if (!['json', 'csv'].includes(format)) {
            return res.status(400).json({ success: false, error: 'Format must be json or csv' });
        }

        const filters = {};
        if (req.query.status) filters.status = req.query.status;
        if (req.query.category) filters.category = req.query.category;
        if (req.query.country) filters.country = req.query.country;

        const data = await dbOperations.exportBusinesses(format, filters);

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', 'attachment; filename=businesses.csv');
            return res.send(data);
        }

        res.json({ success: true, data, count: data.length });
    } catch (error) {
        console.error('Error exporting businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to export businesses' });
    }
});

// Search businesses
app.get('/api/businesses/search', async (req, res) => {
    try {
        const query = req.query.q || '';
        const results = await dbOperations.searchBusinesses(query);
        res.json({ success: true, data: results, query });
    } catch (error) {
        console.error('Error searching businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to search businesses' });
    }
});

// Auth + admin/editor: bulk pipeline update
app.post('/api/businesses/bulk-pipeline', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        const { ids, pipeline_stage } = req.body;

        if (!Array.isArray(ids) || ids.length === 0) {
            return res.status(400).json({ success: false, error: 'ids must be a non-empty array' });
        }

        const validStages = ['new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'active_listing', 'on_hold', 'lost', 'churned'];
        if (!validStages.includes(pipeline_stage)) {
            return res.status(400).json({
                success: false,
                error: `Invalid pipeline stage. Valid stages: ${validStages.join(', ')}`
            });
        }

        const updated = await dbOperations.bulkUpdatePipeline(ids, pipeline_stage);

        // Audit log
        await dbOperations.addAuditLog(
            req.user.id, 'bulk_update_pipeline', 'business', null,
            null, { ids, pipeline_stage }, req.ip
        );

        res.json({ success: true, message: `${updated} businesses updated`, updated });
    } catch (error) {
        console.error('Error bulk updating pipeline:', error);
        res.status(500).json({ success: false, error: 'Failed to bulk update pipeline' });
    }
});

// Auth + admin/editor: bulk import businesses (from spreadsheet upload in admin dashboard)
app.post('/api/businesses/bulk-import', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        const { businesses, skip_duplicates = true } = req.body;

        if (!Array.isArray(businesses) || businesses.length === 0) {
            return res.status(400).json({ success: false, error: 'businesses must be a non-empty array' });
        }
        if (businesses.length > 1000) {
            return res.status(400).json({ success: false, error: 'Maximum 1000 businesses per import batch' });
        }

        // Build duplicate lookup (name + city, case-insensitive) from existing records
        const existing = await dbOperations.getAllBusinesses({});
        const dupKey = (name, city) => `${String(name || '').trim().toLowerCase()}|${String(city || '').trim().toLowerCase()}`;
        const seen = new Set(existing.map(b => dupKey(b.name, b.city)));

        const VALID_STATUS = ['active', 'pending', 'inactive'];
        const VALID_STAGES = ['new_lead', 'contacted', 'in_review', 'verified', 'active_listing', 'inactive',
                              'qualified', 'proposal', 'negotiation', 'on_hold', 'lost', 'churned'];
        const VALID_PRIORITY = ['low', 'medium', 'high'];
        const normEnum = (value, valid, fallback) => {
            const v = String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
            return valid.includes(v) ? v : fallback;
        };
        const toArray = (v) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean)
            : String(v || '').split(',').map(x => x.trim()).filter(Boolean);

        const results = [];
        let created = 0, skipped = 0, failed = 0;

        for (let i = 0; i < businesses.length; i++) {
            const raw = businesses[i] || {};
            const rowNum = raw._row || i + 1;
            const name = String(raw.name || '').trim();

            const missing = ['name', 'category', 'description', 'address']
                .filter(f => !String(raw[f] || '').trim());
            if (missing.length > 0) {
                failed++;
                results.push({ row: rowNum, name, status: 'failed', error: `Missing required fields: ${missing.join(', ')}` });
                continue;
            }

            const key = dupKey(name, raw.city);
            if (skip_duplicates && seen.has(key)) {
                skipped++;
                results.push({ row: rowNum, name, status: 'skipped', error: 'Duplicate (same name and city already exists)' });
                continue;
            }

            const year = parseInt(raw.year_established);
            const business = {
                name,
                business_type: String(raw.business_type || '').trim() || null,
                category: String(raw.category).trim(),
                description: String(raw.description).trim(),
                address: String(raw.address).trim(),
                country: String(raw.country || '').trim() || null,
                state_province: String(raw.state_province || '').trim() || null,
                city: String(raw.city || '').trim() || null,
                postal_code: String(raw.postal_code || '').trim() || null,
                website: String(raw.website || '').trim() || null,
                phone: String(raw.phone || '').trim() || null,
                alt_phone: String(raw.alt_phone || '').trim() || null,
                email: String(raw.email || '').trim() || null,
                contact_person: String(raw.contact_person || '').trim() || null,
                contact_person_title: String(raw.contact_person_title || '').trim() || null,
                business_hours: raw.business_hours || null,
                primary_language: String(raw.primary_language || '').trim() || null,
                year_established: (!isNaN(year) && year >= 1800 && year <= 2100) ? year : null,
                employee_count: String(raw.employee_count || '').trim() || null,
                socials: (raw.socials && typeof raw.socials === 'object') ? raw.socials : {},
                keywords: toArray(raw.keywords),
                meta_description: String(raw.meta_description || '').trim() || null,
                target_audience: toArray(raw.target_audience),
                special_offerings: toArray(raw.special_offerings),
                status: normEnum(raw.status, VALID_STATUS, 'pending'),
                pipeline_stage: normEnum(raw.pipeline_stage, VALID_STAGES, 'new_lead'),
                priority: normEnum(raw.priority, VALID_PRIORITY, 'medium'),
                source: String(raw.source || '').trim() || 'import',
                verification_notes: String(raw.verification_notes || '').trim() || null,
                notes: String(raw.notes || '').trim() || null,
                created_by: req.user.id
            };

            try {
                const id = await dbOperations.addBusiness(business);
                seen.add(key);
                created++;
                results.push({ row: rowNum, name, status: 'created', id });
            } catch (err) {
                failed++;
                console.error(`Bulk import row ${rowNum} failed:`, err.message);
                results.push({ row: rowNum, name, status: 'failed', error: err.message });
            }
        }

        await dbOperations.addAuditLog(
            req.user.id, 'bulk_import', 'business', null,
            null, { total: businesses.length, created, skipped, failed }, req.ip
        );

        res.json({ success: true, summary: { total: businesses.length, created, skipped, failed }, results });
    } catch (error) {
        console.error('Error bulk importing businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to bulk import businesses' });
    }
});

// Get all businesses (with optional filters)
app.get('/api/businesses', async (req, res) => {
    try {
        const filters = {};
        if (req.query.status) filters.status = req.query.status;
        if (req.query.category) filters.category = req.query.category;
        if (req.query.country) filters.country = req.query.country;
        if (req.query.pipeline_stage) filters.pipeline_stage = req.query.pipeline_stage;
        if (req.query.verification_status) filters.verification_status = req.query.verification_status;
        if (req.query.assigned_to) filters.assigned_to = req.query.assigned_to;
        if (req.query.priority) filters.priority = req.query.priority;
        if (req.query.limit) filters.limit = parseInt(req.query.limit);
        if (req.query.offset) filters.offset = parseInt(req.query.offset);

        const businesses = await dbOperations.getAllBusinesses(filters);
        res.json({ success: true, data: businesses });
    } catch (error) {
        console.error('Error fetching businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch businesses' });
    }
});

// Get single business by ID
app.get('/api/businesses/:id', async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const business = await dbOperations.getBusinessById(businessId);

        if (!business) {
            return res.status(404).json({
                success: false,
                error: 'Business not found'
            });
        }

        // Also fetch tags for this business
        try {
            const tags = await dbOperations.getBusinessTags(businessId);
            business.tags = tags;
        } catch {
            business.tags = [];
        }

        res.json({ success: true, data: business });
    } catch (error) {
        console.error('Error fetching business:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch business' });
    }
});

// Add new business
app.post('/api/businesses', authenticateToken, async (req, res) => {
    try {
        const business = req.body;

        if (!business.name || !business.category || !business.description || !business.address) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name, category, description, address'
            });
        }

        business.created_by = req.user.id;
        const businessId = await dbOperations.addBusiness(business);

        // Audit log
        await dbOperations.addAuditLog(
            req.user.id, 'create', 'business', businessId,
            null, { name: business.name, category: business.category }, req.ip
        );

        res.json({
            success: true,
            message: 'Business added successfully',
            id: businessId
        });
    } catch (error) {
        console.error('Error adding business:', error);
        res.status(500).json({ success: false, error: 'Failed to add business' });
    }
});

// Full update business
app.put('/api/businesses/:id', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const business = req.body;

        if (!business.name || !business.category || !business.description || !business.address) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: name, category, description, address'
            });
        }

        // Capture old values for audit
        const oldBusiness = await dbOperations.getBusinessById(businessId);

        const success = await dbOperations.updateBusiness(businessId, business);

        if (success) {
            // Audit log
            await dbOperations.addAuditLog(
                req.user.id, 'update', 'business', businessId,
                oldBusiness ? { name: oldBusiness.name, status: oldBusiness.status } : null,
                { name: business.name, status: business.status },
                req.ip
            );

            res.json({
                success: true,
                message: 'Business updated successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Business not found'
            });
        }
    } catch (error) {
        console.error('Error updating business:', error);
        res.status(500).json({ success: false, error: 'Failed to update business' });
    }
});

// Partial update (PATCH)
app.patch('/api/businesses/:id', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const updates = req.body;
        if (!updates || Object.keys(updates).length === 0) {
            return res.status(400).json({ success: false, error: 'No fields to update' });
        }

        const oldBusiness = await dbOperations.getBusinessById(businessId);
        if (!oldBusiness) {
            return res.status(404).json({ success: false, error: 'Business not found' });
        }

        let updated = false;
        const updatedFields = {};

        for (const [field, value] of Object.entries(updates)) {
            try {
                const result = await dbOperations.updateBusinessField(businessId, field, value);
                if (result) {
                    updated = true;
                    updatedFields[field] = value;
                }
            } catch (fieldError) {
                // If the field is not allowed, skip it and collect errors
                if (fieldError.message && fieldError.message.includes('not allowed')) {
                    continue;
                }
                throw fieldError;
            }
        }

        if (updated) {
            // Audit log
            const oldValues = {};
            for (const field of Object.keys(updatedFields)) {
                oldValues[field] = oldBusiness[field];
            }

            await dbOperations.addAuditLog(
                req.user.id, 'partial_update', 'business', businessId,
                oldValues, updatedFields, req.ip
            );

            res.json({ success: true, message: 'Business updated successfully', updated: updatedFields });
        } else {
            res.status(400).json({ success: false, error: 'No valid fields were updated' });
        }
    } catch (error) {
        console.error('Error patching business:', error);
        res.status(500).json({ success: false, error: 'Failed to update business' });
    }
});

// Delete business
app.delete('/api/businesses/:id', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const oldBusiness = await dbOperations.getBusinessById(businessId);
        const success = await dbOperations.deleteBusiness(businessId);

        if (success) {
            // Audit log
            await dbOperations.addAuditLog(
                req.user.id, 'delete', 'business', businessId,
                oldBusiness ? { name: oldBusiness.name } : null, null, req.ip
            );

            res.json({
                success: true,
                message: 'Business deleted successfully'
            });
        } else {
            res.status(404).json({
                success: false,
                error: 'Business not found'
            });
        }
    } catch (error) {
        console.error('Error deleting business:', error);
        res.status(500).json({ success: false, error: 'Failed to delete business' });
    }
});

// ===========================================================================================
//  CONVERSATION ROUTES
// ===========================================================================================

app.post('/api/conversations', async (req, res) => {
    try {
        const { userQuery, aiResponse, businessIds } = req.body;

        if (!userQuery || !aiResponse) {
            return res.status(400).json({
                success: false,
                error: 'Missing required fields: userQuery, aiResponse'
            });
        }

        if (!Array.isArray(aiResponse)) {
            return res.status(400).json({
                success: false,
                error: 'aiResponse must be an array'
            });
        }

        if (businessIds !== undefined && !Array.isArray(businessIds)) {
            return res.status(400).json({
                success: false,
                error: 'businessIds must be an array'
            });
        }

        const sessionId = req.cookies && req.cookies.session_id;
        const conversationId = await dbOperations.saveConversation(
            userQuery, aiResponse, businessIds, sessionId, req.ip
        );

        res.json({
            success: true,
            message: 'Conversation saved successfully',
            id: conversationId
        });
    } catch (error) {
        console.error('Error saving conversation:', error);
        res.status(500).json({ success: false, error: 'Failed to save conversation' });
    }
});

app.get('/api/conversations', async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 100;
        const offset = parseInt(req.query.offset) || 0;
        const conversations = await dbOperations.getAllConversations(limit, offset);
        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }
});

// ===========================================================================================
//  CRM ROUTES
// ===========================================================================================

// Dashboard stats
app.get('/api/crm/dashboard', authenticateToken, async (req, res) => {
    try {
        const stats = await dbOperations.getDashboardStats();
        res.json({ success: true, data: stats });
    } catch (error) {
        console.error('Error fetching dashboard stats:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch dashboard stats' });
    }
});

// Pipeline view (businesses grouped by pipeline stage)
app.get('/api/crm/pipeline', authenticateToken, async (req, res) => {
    try {
        const stages = ['new_lead', 'contacted', 'in_review', 'verified', 'active_listing', 'inactive'];
        const pipeline = {};

        for (const stage of stages) {
            pipeline[stage] = await dbOperations.getAllBusinesses({ pipeline_stage: stage, limit: 50 });
        }

        res.json({ success: true, data: pipeline });
    } catch (error) {
        console.error('Error fetching pipeline:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch pipeline' });
    }
});

// Analytics (admin only)
app.get('/api/crm/analytics', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 30;
        const analytics = await dbOperations.getAnalyticsSummary(days);
        res.json({ success: true, data: analytics });
    } catch (error) {
        console.error('Error fetching analytics:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch analytics' });
    }
});

// Audit log (admin only)
app.get('/api/crm/audit-log', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const limit = parseInt(req.query.limit) || 50;
        const offset = parseInt(req.query.offset) || 0;
        const entityType = req.query.type || null;
        const logs = await dbOperations.getAuditLog(limit, offset, entityType);
        res.json({ success: true, data: logs });
    } catch (error) {
        console.error('Error fetching audit log:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch audit log' });
    }
});

// CRM Communications
app.post('/api/crm/communications', authenticateToken, async (req, res) => {
    try {
        const { businessId, type, subject, content } = req.body;

        if (!businessId || !content) {
            return res.status(400).json({
                success: false,
                error: 'businessId and content are required'
            });
        }

        const validTypes = ['note', 'email', 'phone', 'meeting', 'other'];
        const commType = validTypes.includes(type) ? type : 'note';

        const commId = await dbOperations.addCommunication(
            businessId, req.user.id, commType, subject, content
        );

        // Update last_contacted on the business
        try {
            await dbOperations.updateBusinessField(businessId, 'last_contacted', new Date().toISOString());
        } catch {
            // Non-critical, continue
        }

        // Audit log
        await dbOperations.addAuditLog(
            req.user.id, 'create', 'communication', commId,
            null, { businessId, type: commType }, req.ip
        );

        res.json({ success: true, message: 'Communication logged', id: commId });
    } catch (error) {
        console.error('Error adding communication:', error);
        res.status(500).json({ success: false, error: 'Failed to add communication' });
    }
});

app.get('/api/crm/communications/:businessId', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.businessId);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const communications = await dbOperations.getCommunications(businessId);
        res.json({ success: true, data: communications });
    } catch (error) {
        console.error('Error fetching communications:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch communications' });
    }
});

// ==================== CRM ACTIVITIES ====================
// Create an activity
app.post('/api/crm/activities', authenticateToken, async (req, res) => {
    try {
        const activity = await dbOperations.createActivity({
            ...req.body,
            user_id: req.user.id
        });
        res.json({ success: true, data: activity });
    } catch (e) {
        console.error('Create activity error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get activities with filters
app.get('/api/crm/activities', authenticateToken, async (req, res) => {
    try {
        const filters = {
            business_id: req.query.business_id ? parseInt(req.query.business_id) : null,
            user_id: req.query.user_id ? parseInt(req.query.user_id) : null,
            type: req.query.type || null,
            pending: req.query.pending === 'true',
            overdue: req.query.overdue === 'true',
            limit: req.query.limit ? parseInt(req.query.limit) : 100
        };
        // Remove null filters
        Object.keys(filters).forEach(k => { if (filters[k] === null || filters[k] === false) delete filters[k]; });
        const activities = await dbOperations.getActivities(filters);
        res.json({ success: true, data: activities });
    } catch (e) {
        console.error('Get activities error:', e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// Complete an activity
app.patch('/api/crm/activities/:id/complete', authenticateToken, async (req, res) => {
    try {
        const activity = await dbOperations.completeActivity(parseInt(req.params.id));
        if (!activity) return res.status(404).json({ success: false, error: 'Activity not found' });
        res.json({ success: true, data: activity });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete an activity
app.delete('/api/crm/activities/:id', authenticateToken, async (req, res) => {
    try {
        const deleted = await dbOperations.deleteActivity(parseInt(req.params.id));
        res.json({ success: deleted, message: deleted ? 'Activity deleted' : 'Activity not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Activity stats
app.get('/api/crm/activities/stats', authenticateToken, async (req, res) => {
    try {
        const stats = await dbOperations.getActivityStats();
        res.json({ success: true, data: stats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== CRM AUTOMATION RULES ====================
// Create automation rule
app.post('/api/crm/automations', authenticateToken, async (req, res) => {
    try {
        const rule = await dbOperations.createAutomationRule({
            ...req.body,
            created_by: req.user.id
        });
        res.json({ success: true, data: rule });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get all automation rules
app.get('/api/crm/automations', authenticateToken, async (req, res) => {
    try {
        const rules = await dbOperations.getAutomationRules();
        res.json({ success: true, data: rules });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Update automation rule
app.put('/api/crm/automations/:id', authenticateToken, async (req, res) => {
    try {
        const rule = await dbOperations.updateAutomationRule(parseInt(req.params.id), req.body);
        if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
        res.json({ success: true, data: rule });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Toggle automation rule active/inactive
app.patch('/api/crm/automations/:id/toggle', authenticateToken, async (req, res) => {
    try {
        const rule = await dbOperations.toggleAutomationRule(parseInt(req.params.id), req.body.is_active);
        if (!rule) return res.status(404).json({ success: false, error: 'Rule not found' });
        res.json({ success: true, data: rule });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Delete automation rule
app.delete('/api/crm/automations/:id', authenticateToken, async (req, res) => {
    try {
        const deleted = await dbOperations.deleteAutomationRule(parseInt(req.params.id));
        res.json({ success: deleted, message: deleted ? 'Rule deleted' : 'Rule not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get automation execution log
app.get('/api/crm/automations/log', authenticateToken, async (req, res) => {
    try {
        const ruleId = req.query.rule_id ? parseInt(req.query.rule_id) : null;
        const limit = req.query.limit ? parseInt(req.query.limit) : 50;
        const log = await dbOperations.getAutomationLog(ruleId, limit);
        res.json({ success: true, data: log });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== CRM PREDICTIVE / WIN SCORES ====================
// Calculate win score for a business
app.post('/api/crm/win-score/:businessId', authenticateToken, async (req, res) => {
    try {
        const score = await dbOperations.calculateWinScore(parseInt(req.params.businessId));
        if (!score) return res.status(404).json({ success: false, error: 'Business not found' });
        res.json({ success: true, data: score });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get win scores (all or for specific business)
app.get('/api/crm/win-scores', authenticateToken, async (req, res) => {
    try {
        const businessId = req.query.business_id ? parseInt(req.query.business_id) : null;
        const scores = await dbOperations.getWinScores(businessId);
        res.json({ success: true, data: scores });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== CRM TERRITORIES ====================
app.post('/api/crm/territories', authenticateToken, async (req, res) => {
    try {
        const territory = await dbOperations.createTerritory(req.body);
        res.json({ success: true, data: territory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.get('/api/crm/territories', authenticateToken, async (req, res) => {
    try {
        const territories = await dbOperations.getTerritories();
        res.json({ success: true, data: territories });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.put('/api/crm/territories/:id', authenticateToken, async (req, res) => {
    try {
        const territory = await dbOperations.updateTerritory(parseInt(req.params.id), req.body);
        if (!territory) return res.status(404).json({ success: false, error: 'Territory not found' });
        res.json({ success: true, data: territory });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

app.delete('/api/crm/territories/:id', authenticateToken, async (req, res) => {
    try {
        const deleted = await dbOperations.deleteTerritory(parseInt(req.params.id));
        res.json({ success: deleted, message: deleted ? 'Deleted' : 'Not found' });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ==================== CRM STAGNATION & FORECAST ====================
// Get stagnant deals
app.get('/api/crm/stagnant', authenticateToken, async (req, res) => {
    try {
        const days = parseInt(req.query.days) || 7;
        const deals = await dbOperations.getStagnantDeals(days);
        res.json({ success: true, data: deals });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Get pipeline forecast
app.get('/api/crm/forecast', authenticateToken, async (req, res) => {
    try {
        const forecast = await dbOperations.getPipelineForecast();
        res.json({ success: true, data: forecast });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// Enhanced CRM dashboard stats
app.get('/api/crm/dashboard/advanced', authenticateToken, async (req, res) => {
    try {
        const stats = await dbOperations.getCrmDashboardStats();
        res.json({ success: true, data: stats });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

// ===========================================================================================
//  USER MANAGEMENT ROUTES (admin only)
// ===========================================================================================

app.get('/api/users', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const users = await dbOperations.getAllUsers();
        res.json({ success: true, data: users });
    } catch (error) {
        console.error('Error fetching users:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch users' });
    }
});

app.patch('/api/users/:id/role', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        const { role } = req.body;
        const validRoles = ['admin', 'editor', 'viewer'];
        if (!validRoles.includes(role)) {
            return res.status(400).json({
                success: false,
                error: `Invalid role. Valid roles: ${validRoles.join(', ')}`
            });
        }

        // Prevent self-demotion
        if (userId === req.user.id && role !== 'admin') {
            return res.status(400).json({
                success: false,
                error: 'Cannot change your own role'
            });
        }

        const oldUser = await dbOperations.getUserById(userId);
        const success = await dbOperations.updateUserRole(userId, role);

        if (success) {
            await dbOperations.addAuditLog(
                req.user.id, 'update_role', 'user', userId,
                { role: oldUser ? oldUser.role : null }, { role }, req.ip
            );
            res.json({ success: true, message: `User role updated to ${role}` });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        console.error('Error updating user role:', error);
        res.status(500).json({ success: false, error: 'Failed to update user role' });
    }
});

app.patch('/api/users/:id/active', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const userId = parseInt(req.params.id);
        if (isNaN(userId)) {
            return res.status(400).json({ success: false, error: 'Invalid user ID' });
        }

        const { active } = req.body;
        if (typeof active !== 'boolean') {
            return res.status(400).json({ success: false, error: 'active must be a boolean' });
        }

        // Prevent self-deactivation
        if (userId === req.user.id && !active) {
            return res.status(400).json({
                success: false,
                error: 'Cannot deactivate your own account'
            });
        }

        const success = await dbOperations.toggleUserActive(userId, active);

        if (success) {
            await dbOperations.addAuditLog(
                req.user.id, active ? 'activate_user' : 'deactivate_user', 'user', userId,
                null, { active }, req.ip
            );
            res.json({ success: true, message: `User ${active ? 'activated' : 'deactivated'}` });
        } else {
            res.status(404).json({ success: false, error: 'User not found' });
        }
    } catch (error) {
        console.error('Error toggling user active:', error);
        res.status(500).json({ success: false, error: 'Failed to update user status' });
    }
});

// ===========================================================================================
//  API KEY ROUTES
// ===========================================================================================

app.post('/api/keys', authenticateToken, async (req, res) => {
    try {
        const { name, permissions, rate_limit, expires_at } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'API key name is required' });
        }

        const keyData = await dbOperations.createApiKey(
            req.user.id,
            name,
            permissions || ['read'],
            rate_limit || 100,
            expires_at || null
        );

        await dbOperations.addAuditLog(
            req.user.id, 'create', 'api_key', keyData.id,
            null, { name, prefix: keyData.prefix }, req.ip
        );

        res.json({
            success: true,
            message: 'API key created. Store the key securely -- it will not be shown again.',
            data: keyData
        });
    } catch (error) {
        console.error('Error creating API key:', error);
        res.status(500).json({ success: false, error: 'Failed to create API key' });
    }
});

app.get('/api/keys', authenticateToken, async (req, res) => {
    try {
        const keys = await dbOperations.getApiKeysByUser(req.user.id);
        res.json({ success: true, data: keys });
    } catch (error) {
        console.error('Error fetching API keys:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch API keys' });
    }
});

app.get('/api/keys/all', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const keys = await dbOperations.getAllApiKeys();
        res.json({ success: true, data: keys });
    } catch (error) {
        console.error('Error fetching all API keys:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch API keys' });
    }
});

app.delete('/api/keys/:id', authenticateToken, async (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        if (isNaN(keyId)) {
            return res.status(400).json({ success: false, error: 'Invalid key ID' });
        }

        const success = await dbOperations.revokeApiKey(keyId);

        if (success) {
            await dbOperations.addAuditLog(
                req.user.id, 'revoke', 'api_key', keyId,
                null, null, req.ip
            );
            res.json({ success: true, message: 'API key revoked' });
        } else {
            res.status(404).json({ success: false, error: 'API key not found' });
        }
    } catch (error) {
        console.error('Error revoking API key:', error);
        res.status(500).json({ success: false, error: 'Failed to revoke API key' });
    }
});

app.get('/api/keys/:id/usage', authenticateToken, async (req, res) => {
    try {
        const keyId = parseInt(req.params.id);
        if (isNaN(keyId)) {
            return res.status(400).json({ success: false, error: 'Invalid key ID' });
        }

        const days = parseInt(req.query.days) || 30;
        const usage = await dbOperations.getApiUsageStats(keyId, days);
        res.json({ success: true, data: usage });
    } catch (error) {
        console.error('Error fetching API key usage:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch API key usage' });
    }
});

// ===========================================================================================
//  TAG ROUTES
// ===========================================================================================

app.post('/api/tags', authenticateToken, async (req, res) => {
    try {
        const { name, color } = req.body;

        if (!name) {
            return res.status(400).json({ success: false, error: 'Tag name is required' });
        }

        const tagId = await dbOperations.createTag(name, color);
        res.json({ success: true, data: { id: tagId, name, color: color || '#6B7280' } });
    } catch (error) {
        console.error('Error creating tag:', error);
        res.status(500).json({ success: false, error: 'Failed to create tag' });
    }
});

app.get('/api/tags', authenticateToken, async (req, res) => {
    try {
        const tags = await dbOperations.getAllTags();
        res.json({ success: true, data: tags });
    } catch (error) {
        console.error('Error fetching tags:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch tags' });
    }
});

app.post('/api/tags/business/:businessId', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.businessId);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const { tagId } = req.body;
        if (!tagId) {
            return res.status(400).json({ success: false, error: 'tagId is required' });
        }

        await dbOperations.addBusinessTag(businessId, tagId);
        res.json({ success: true, message: 'Tag added to business' });
    } catch (error) {
        console.error('Error adding tag to business:', error);
        res.status(500).json({ success: false, error: 'Failed to add tag to business' });
    }
});

app.delete('/api/tags/business/:businessId/:tagId', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.businessId);
        const tagId = parseInt(req.params.tagId);

        if (isNaN(businessId) || isNaN(tagId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID or tag ID' });
        }

        await dbOperations.removeBusinessTag(businessId, tagId);
        res.json({ success: true, message: 'Tag removed from business' });
    } catch (error) {
        console.error('Error removing tag from business:', error);
        res.status(500).json({ success: false, error: 'Failed to remove tag from business' });
    }
});

// ===========================================================================================
//  ANALYTICS EVENT TRACKING (public)
// ===========================================================================================

app.post('/api/analytics/event', async (req, res) => {
    try {
        const { event_type, event_data, session_id } = req.body;

        if (!event_type) {
            return res.status(400).json({ success: false, error: 'event_type is required' });
        }

        await dbOperations.trackEvent(
            event_type,
            event_data || null,
            session_id || null,
            req.ip,
            req.headers['user-agent'] || null
        );

        res.json({ success: true, message: 'Event tracked' });
    } catch (error) {
        console.error('Error tracking event:', error);
        res.status(500).json({ success: false, error: 'Failed to track event' });
    }
});

// ===========================================================================================
//  PUBLIC API v1 (API key authenticated)
// ===========================================================================================

app.get('/api/v1/businesses', apiKeyLimiter, authenticateApiKey, async (req, res) => {
    try {
        const filters = {};
        if (req.query.status) filters.status = req.query.status;
        if (req.query.category) filters.category = req.query.category;
        if (req.query.country) filters.country = req.query.country;
        if (req.query.limit) filters.limit = Math.min(parseInt(req.query.limit) || 50, 200);
        if (req.query.offset) filters.offset = parseInt(req.query.offset) || 0;

        // Default to active businesses for public API
        if (!filters.status) filters.status = 'active';

        const businesses = await dbOperations.getAllBusinesses(filters);
        res.json({
            success: true,
            data: businesses,
            count: businesses.length,
            api_version: 'v1'
        });
    } catch (error) {
        console.error('Public API error (businesses):', error);
        res.status(500).json({ success: false, error: 'Failed to fetch businesses' });
    }
});

app.get('/api/v1/businesses/search', apiKeyLimiter, authenticateApiKey, async (req, res) => {
    try {
        const query = req.query.q || '';
        if (!query.trim()) {
            return res.status(400).json({ success: false, error: 'Search query (q) is required' });
        }

        const results = await dbOperations.searchBusinesses(query);
        res.json({
            success: true,
            data: results,
            query,
            count: results.length,
            api_version: 'v1'
        });
    } catch (error) {
        console.error('Public API error (search):', error);
        res.status(500).json({ success: false, error: 'Failed to search businesses' });
    }
});

app.get('/api/v1/businesses/:id', apiKeyLimiter, authenticateApiKey, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        if (isNaN(businessId)) {
            return res.status(400).json({ success: false, error: 'Invalid business ID' });
        }

        const business = await dbOperations.getBusinessById(businessId);
        if (!business) {
            return res.status(404).json({ success: false, error: 'Business not found' });
        }

        res.json({
            success: true,
            data: business,
            api_version: 'v1'
        });
    } catch (error) {
        console.error('Public API error (business by id):', error);
        res.status(500).json({ success: false, error: 'Failed to fetch business' });
    }
});

// ---------------------------------------------------------------------------
// Google integration: OAuth connect, Business Profile, Maps lead generation
// ---------------------------------------------------------------------------
// Env vars: GOOGLE_CLIENT_ID + GOOGLE_CLIENT_SECRET (OAuth / Business Profile),
// GOOGLE_MAPS_API_KEY (Places API), GOOGLE_OAUTH_REDIRECT_URI (optional override)
const GOOGLE_OAUTH_SCOPES = 'https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email';

function googleOauthConfigured() {
    return !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
}

function googleRedirectUri(req) {
    if (process.env.GOOGLE_OAUTH_REDIRECT_URI) return process.env.GOOGLE_OAUTH_REDIRECT_URI;
    const proto = req.headers['x-forwarded-proto'] || req.protocol;
    return `${proto}://${req.get('host')}/api/google/oauth/callback`;
}

// Returns a fresh access token for a stored connection, refreshing when expired
async function getGoogleAccessToken(conn) {
    const expiresAt = conn.token_expires_at ? new Date(conn.token_expires_at).getTime() : 0;
    if (conn.access_token && expiresAt - Date.now() > 60 * 1000) {
        return conn.access_token;
    }
    const resp = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            client_id: process.env.GOOGLE_CLIENT_ID,
            client_secret: process.env.GOOGLE_CLIENT_SECRET,
            refresh_token: conn.refresh_token,
            grant_type: 'refresh_token'
        })
    });
    const data = await resp.json();
    if (!resp.ok || !data.access_token) {
        throw new Error(`Google token refresh failed: ${data.error_description || data.error || resp.status}`);
    }
    const newExpiry = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    await dbOperations.updateGoogleAccessToken(conn.id, data.access_token, newExpiry);
    return data.access_token;
}

// Collect google_place_id values already present, for duplicate detection
async function getImportedPlaceIds() {
    const existing = await dbOperations.getAllBusinesses({});
    const placeIds = new Set();
    const nameCity = new Set();
    for (const b of existing) {
        const cf = b.custom_fields || {};
        if (cf.google_place_id) placeIds.add(cf.google_place_id);
        nameCity.add(`${String(b.name || '').trim().toLowerCase()}|${String(b.city || '').trim().toLowerCase()}`);
    }
    return { placeIds, nameCity };
}

// Config status for the admin panel
app.get('/api/google/config', authenticateToken, requireRole('admin', 'editor'), (req, res) => {
    res.json({
        success: true,
        maps_configured: !!process.env.GOOGLE_MAPS_API_KEY,
        oauth_configured: googleOauthConfigured(),
        redirect_uri: googleRedirectUri(req)
    });
});

// Step 1 of OAuth: hand the frontend a Google consent URL
app.get('/api/google/oauth/url', authenticateToken, requireRole('admin', 'editor'), (req, res) => {
    if (!googleOauthConfigured()) {
        return res.status(400).json({
            success: false,
            error: 'Google OAuth is not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables.'
        });
    }
    const state = jwt.sign({ uid: req.user.id, purpose: 'google_oauth' }, JWT_SECRET, { expiresIn: '10m' });
    const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({
        client_id: process.env.GOOGLE_CLIENT_ID,
        redirect_uri: googleRedirectUri(req),
        response_type: 'code',
        scope: GOOGLE_OAUTH_SCOPES,
        access_type: 'offline',
        prompt: 'consent',
        state
    });
    res.json({ success: true, url });
});

// Step 2 of OAuth: Google redirects here; validated via the signed state param
app.get('/api/google/oauth/callback', async (req, res) => {
    const respond = (ok, message) => {
        res.status(ok ? 200 : 400).send(`<!DOCTYPE html><html><body style="font-family:sans-serif;text-align:center;padding-top:4rem">
            <h2>${ok ? 'Google account connected' : 'Connection failed'}</h2>
            <p>${message}</p><p>You can close this window.</p>
            <script>if(window.opener){window.opener.postMessage({type:'google-oauth',ok:${ok}},'*');setTimeout(()=>window.close(),1500);}</script>
            </body></html>`);
    };
    try {
        const { code, state, error } = req.query;
        if (error) return respond(false, `Google returned: ${error}`);
        if (!code || !state) return respond(false, 'Missing authorization code or state.');

        let statePayload;
        try {
            statePayload = jwt.verify(state, JWT_SECRET);
        } catch {
            return respond(false, 'Invalid or expired state token. Please retry from the admin panel.');
        }
        if (statePayload.purpose !== 'google_oauth') return respond(false, 'Invalid state token.');

        const tokenResp = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
                code,
                client_id: process.env.GOOGLE_CLIENT_ID,
                client_secret: process.env.GOOGLE_CLIENT_SECRET,
                redirect_uri: googleRedirectUri(req),
                grant_type: 'authorization_code'
            })
        });
        const tokens = await tokenResp.json();
        if (!tokenResp.ok || !tokens.access_token) {
            return respond(false, `Token exchange failed: ${tokens.error_description || tokens.error || tokenResp.status}`);
        }
        if (!tokens.refresh_token) {
            return respond(false, 'Google did not return a refresh token. Remove this app under myaccount.google.com &rarr; Security &rarr; Third-party access, then connect again.');
        }

        const userResp = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${tokens.access_token}` }
        });
        const userinfo = await userResp.json();
        if (!userinfo.email) return respond(false, 'Could not read the Google account email.');

        const connId = await dbOperations.saveGoogleConnection({
            google_email: userinfo.email,
            refresh_token: tokens.refresh_token,
            access_token: tokens.access_token,
            token_expires_at: new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString(),
            scopes: tokens.scope || GOOGLE_OAUTH_SCOPES,
            connected_by: statePayload.uid
        });
        await dbOperations.addAuditLog(statePayload.uid, 'google_connect', 'google_connection', connId,
            null, { email: userinfo.email }, req.ip);
        respond(true, `Connected as ${userinfo.email}.`);
    } catch (err) {
        console.error('Google OAuth callback error:', err);
        respond(false, 'Unexpected error during Google connection.');
    }
});

app.get('/api/google/connections', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        const connections = await dbOperations.listGoogleConnections();
        res.json({ success: true, data: connections });
    } catch (error) {
        console.error('Error listing Google connections:', error);
        res.status(500).json({ success: false, error: 'Failed to list Google connections' });
    }
});

app.delete('/api/google/connections/:id', authenticateToken, requireRole('admin'), async (req, res) => {
    try {
        const id = parseInt(req.params.id);
        const conn = await dbOperations.getGoogleConnection(id);
        if (!conn) return res.status(404).json({ success: false, error: 'Connection not found' });

        // Best-effort revocation at Google; deletion proceeds regardless
        try {
            await fetch('https://oauth2.googleapis.com/revoke', {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ token: conn.refresh_token })
            });
        } catch (e) {
            console.warn('Google token revocation failed:', e.message);
        }
        await dbOperations.deleteGoogleConnection(id);
        await dbOperations.addAuditLog(req.user.id, 'google_disconnect', 'google_connection', id,
            { email: conn.google_email }, null, req.ip);
        res.json({ success: true, message: `Disconnected ${conn.google_email}` });
    } catch (error) {
        console.error('Error deleting Google connection:', error);
        res.status(500).json({ success: false, error: 'Failed to disconnect Google account' });
    }
});

// List Business Profile locations across the connected account
app.get('/api/google/business/locations', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        const conn = await dbOperations.getGoogleConnection(parseInt(req.query.connection_id));
        if (!conn) return res.status(404).json({ success: false, error: 'Google connection not found' });

        const token = await getGoogleAccessToken(conn);
        const authHeaders = { Authorization: `Bearer ${token}` };

        const acctResp = await fetch('https://mybusinessaccountmanagement.googleapis.com/v1/accounts', { headers: authHeaders });
        const acctData = await acctResp.json();
        if (!acctResp.ok) {
            const msg = acctData.error?.message || `HTTP ${acctResp.status}`;
            return res.status(502).json({
                success: false,
                error: `Google Business Profile API error: ${msg}. Note: this API requires approved access — request it at developers.google.com/my-business (Business Profile APIs are quota-gated by Google).`
            });
        }

        const { placeIds } = await getImportedPlaceIds();
        const locations = [];
        const readMask = 'name,title,storefrontAddress,phoneNumbers,websiteUri,categories,metadata';
        for (const account of (acctData.accounts || []).slice(0, 10)) {
            let pageToken = '';
            do {
                const url = `https://mybusinessbusinessinformation.googleapis.com/v1/${account.name}/locations?readMask=${encodeURIComponent(readMask)}&pageSize=100${pageToken ? `&pageToken=${pageToken}` : ''}`;
                const locResp = await fetch(url, { headers: authHeaders });
                const locData = await locResp.json();
                if (!locResp.ok) {
                    console.error('Locations fetch failed for', account.name, locData.error?.message);
                    break;
                }
                for (const loc of (locData.locations || [])) {
                    const addr = loc.storefrontAddress || {};
                    const placeId = loc.metadata?.placeId || null;
                    locations.push({
                        account: account.accountName || account.name,
                        google_name: loc.name,
                        name: loc.title,
                        address: [...(addr.addressLines || []), addr.locality, addr.administrativeArea].filter(Boolean).join(', '),
                        city: addr.locality || null,
                        country: addr.regionCode || null,
                        postal_code: addr.postalCode || null,
                        phone: loc.phoneNumbers?.primaryPhone || null,
                        website: loc.websiteUri || null,
                        category: loc.categories?.primaryCategory?.displayName || null,
                        place_id: placeId,
                        maps_url: loc.metadata?.mapsUri || null,
                        already_imported: !!(placeId && placeIds.has(placeId))
                    });
                }
                pageToken = locData.nextPageToken || '';
            } while (pageToken);
        }
        res.json({ success: true, data: locations, accounts: (acctData.accounts || []).length });
    } catch (error) {
        console.error('Error fetching Business Profile locations:', error);
        res.status(500).json({ success: false, error: error.message || 'Failed to fetch Business Profile locations' });
    }
});

// Search Google Maps (Places API New) for lead generation
app.post('/api/google/maps/search', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        if (!process.env.GOOGLE_MAPS_API_KEY) {
            return res.status(400).json({
                success: false,
                error: 'Google Maps is not configured. Set the GOOGLE_MAPS_API_KEY environment variable (Places API New must be enabled on the key).'
            });
        }
        const query = String(req.body.query || '').trim();
        if (!query) return res.status(400).json({ success: false, error: 'query is required, e.g. "coffee shops in Vientiane"' });
        const maxResults = Math.min(Math.max(parseInt(req.body.max_results) || 20, 1), 20);

        const resp = await fetch('https://places.googleapis.com/v1/places:searchText', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-Goog-Api-Key': process.env.GOOGLE_MAPS_API_KEY,
                'X-Goog-FieldMask': [
                    'places.id', 'places.displayName', 'places.formattedAddress', 'places.addressComponents',
                    'places.internationalPhoneNumber', 'places.websiteUri', 'places.rating', 'places.userRatingCount',
                    'places.googleMapsUri', 'places.primaryTypeDisplayName', 'places.businessStatus', 'places.location'
                ].join(',')
            },
            body: JSON.stringify({ textQuery: query, pageSize: maxResults })
        });
        const data = await resp.json();
        if (!resp.ok) {
            const msg = data.error?.message || `HTTP ${resp.status}`;
            return res.status(502).json({ success: false, error: `Google Places API error: ${msg}` });
        }

        const { placeIds, nameCity } = await getImportedPlaceIds();
        const component = (place, type) =>
            (place.addressComponents || []).find(c => (c.types || []).includes(type))?.longText || null;

        const results = (data.places || []).map(p => {
            const city = component(p, 'locality') || component(p, 'administrative_area_level_1');
            const name = p.displayName?.text || '';
            return {
                place_id: p.id,
                name,
                address: p.formattedAddress || null,
                city,
                country: component(p, 'country'),
                phone: p.internationalPhoneNumber || null,
                website: p.websiteUri || null,
                rating: p.rating || null,
                review_count: p.userRatingCount || 0,
                maps_url: p.googleMapsUri || null,
                category: p.primaryTypeDisplayName?.text || null,
                business_status: p.businessStatus || null,
                lat: p.location?.latitude ?? null,
                lng: p.location?.longitude ?? null,
                already_imported: placeIds.has(p.id) ||
                    nameCity.has(`${name.trim().toLowerCase()}|${String(city || '').trim().toLowerCase()}`)
            };
        });
        res.json({ success: true, data: results, query });
    } catch (error) {
        console.error('Error searching Google Maps:', error);
        res.status(500).json({ success: false, error: 'Failed to search Google Maps' });
    }
});

// Import selected Google leads (from Maps search or Business Profile) as businesses
app.post('/api/google/import-leads', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
    try {
        const { leads, source = 'google_maps', defaults = {} } = req.body;
        if (!Array.isArray(leads) || leads.length === 0) {
            return res.status(400).json({ success: false, error: 'leads must be a non-empty array' });
        }
        if (leads.length > 100) {
            return res.status(400).json({ success: false, error: 'Maximum 100 leads per import' });
        }
        const validSource = ['google_maps', 'google_business'].includes(source) ? source : 'google_maps';
        const { placeIds, nameCity } = await getImportedPlaceIds();

        const results = [];
        let created = 0, skipped = 0, failed = 0;
        for (const lead of leads) {
            const name = String(lead.name || '').trim();
            if (!name) { failed++; results.push({ name: '(empty)', status: 'failed', error: 'Missing name' }); continue; }

            const key = `${name.toLowerCase()}|${String(lead.city || '').trim().toLowerCase()}`;
            if ((lead.place_id && placeIds.has(lead.place_id)) || nameCity.has(key)) {
                skipped++;
                results.push({ name, status: 'skipped', error: 'Already in the directory' });
                continue;
            }

            const category = String(defaults.category || lead.category || 'Uncategorized').trim();
            const descriptionParts = [
                `${name} is a ${category.toLowerCase()} located at ${lead.address || 'an unknown address'}.`,
                lead.rating ? `Rated ${lead.rating}/5 from ${lead.review_count || 0} Google reviews.` : null,
                'Details imported from Google — verify and enrich before publishing.'
            ].filter(Boolean);

            try {
                const id = await dbOperations.addBusiness({
                    name,
                    business_type: defaults.business_type || lead.category || null,
                    category,
                    description: String(defaults.description || descriptionParts.join(' ')),
                    address: String(lead.address || 'Address pending verification'),
                    country: lead.country || defaults.country || null,
                    city: lead.city || defaults.city || null,
                    postal_code: lead.postal_code || null,
                    phone: lead.phone || null,
                    website: lead.website || null,
                    keywords: [category, lead.city].filter(Boolean),
                    socials: {},
                    status: 'pending',
                    pipeline_stage: 'new_lead',
                    priority: defaults.priority || 'medium',
                    source: validSource,
                    notes: `Imported from ${validSource === 'google_maps' ? 'Google Maps' : 'Google Business Profile'} by ${req.user.username}`,
                    custom_fields: {
                        google_place_id: lead.place_id || null,
                        google_maps_url: lead.maps_url || null,
                        google_rating: lead.rating || null,
                        google_review_count: lead.review_count || 0,
                        google_business_name: lead.google_name || null
                    },
                    created_by: req.user.id
                });
                if (lead.place_id) placeIds.add(lead.place_id);
                nameCity.add(key);
                created++;
                results.push({ name, status: 'created', id });
            } catch (err) {
                failed++;
                console.error('Lead import failed:', name, err.message);
                results.push({ name, status: 'failed', error: err.message });
            }
        }

        await dbOperations.addAuditLog(req.user.id, 'google_import_leads', 'business', null,
            null, { source: validSource, total: leads.length, created, skipped, failed }, req.ip);
        res.json({ success: true, summary: { total: leads.length, created, skipped, failed }, results });
    } catch (error) {
        console.error('Error importing Google leads:', error);
        res.status(500).json({ success: false, error: 'Failed to import leads' });
    }
});

// ---------------------------------------------------------------------------
// Ad copy generator: Google Ads RSA + Facebook copy from a listing
// ---------------------------------------------------------------------------
app.post('/api/ads/generate', authenticateToken, async (req, res) => {
    try {
        let biz = req.body.business;
        if (req.body.business_id) {
            biz = await dbOperations.getBusinessById(parseInt(req.body.business_id));
            if (!biz) return res.status(404).json({ success: false, error: 'Business not found' });
        }
        if (!biz || !biz.name) return res.status(400).json({ success: false, error: 'Provide business_id or a business object with at least a name' });

        const name = String(biz.name).trim();
        const category = String(biz.category || biz.business_type || 'Business').trim();
        const city = String(biz.city || '').trim();
        const country = String(biz.country || '').trim();
        const place = city || country;
        const offerings = Array.isArray(biz.special_offerings) ? biz.special_offerings : [];
        const keywords = Array.isArray(biz.keywords) ? biz.keywords : [];
        const rating = biz.custom_fields?.google_rating;
        const cap = (s, n) => (s.length <= n ? s : null);

        // Google responsive search ads: headlines max 30 chars, descriptions max 90
        const headlineCandidates = [
            name,
            place ? `${category} in ${place}` : category,
            place ? `Best ${category} — ${place}` : `Best ${category}`,
            `Visit ${name}`,
            rating ? `Rated ${rating}★ on Google` : null,
            `Top ${category} Near You`,
            keywords[0] ? `${keywords[0]} & More` : null,
            offerings.includes('Delivery') ? 'Delivery Available' : null,
            offerings.includes('Reservations') ? 'Book a Table Today' : null,
            offerings.includes('Online Orders') ? 'Order Online Now' : null,
            'Discover Asia’s Best'
        ].filter(Boolean).map(h => cap(h.trim(), 30)).filter(Boolean);
        const headlines = [...new Set(headlineCandidates)].slice(0, 10);

        const firstSentence = String(biz.description || '').split(/(?<=[.!?])\s+/)[0] || '';
        const offeringsLine = offerings.length ? `${offerings.slice(0, 4).join(', ')} — all at ${name}.` : null;
        const descriptionCandidates = [
            firstSentence,
            offeringsLine,
            place ? `Looking for ${category.toLowerCase()} in ${place}? ${name} has you covered.` : null,
            rating ? `${rating}/5 stars from ${biz.custom_fields?.google_review_count || 'many'} happy customers. See why.` : null,
            `Find ${name} on asian.directory — Asia’s AI-powered business directory.`
        ].filter(Boolean).map(d => cap(d.trim(), 90)).filter(Boolean);
        const descriptions = [...new Set(descriptionCandidates)].slice(0, 4);

        // Facebook/Instagram: primary text ~125 chars, headline ~40
        const fbPrimary = cap(
            `${firstSentence || `${name} — ${category}${place ? ' in ' + place : ''}.`}`.trim(), 125
        ) || `${name} — ${category}${place ? ' in ' + place : ''}.`.slice(0, 125);

        res.json({
            success: true,
            data: {
                google_ads: {
                    headlines,
                    descriptions,
                    final_url: biz.website || `https://asian.directory/?biz=${encodeURIComponent(name)}`,
                    path: [category.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 15), city.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 15)].filter(Boolean)
                },
                facebook: {
                    primary_text: fbPrimary,
                    headline: cap(place ? `${category} in ${place}` : category, 40) || category.slice(0, 40),
                    description: cap(`Visit ${name} today`, 30),
                    cta: biz.website ? 'LEARN_MORE' : 'GET_DIRECTIONS'
                },
                suggested_google_keywords: [...new Set([
                    `${category.toLowerCase()}${place ? ' ' + place.toLowerCase() : ''}`,
                    `best ${category.toLowerCase()}${place ? ' in ' + place.toLowerCase() : ''}`,
                    name.toLowerCase(),
                    ...keywords.map(k => String(k).toLowerCase())
                ])].slice(0, 10)
            }
        });
    } catch (error) {
        console.error('Error generating ad copy:', error);
        res.status(500).json({ success: false, error: 'Failed to generate ad copy' });
    }
});

// ---------------------------------------------------------------------------
// Public endpoints: no account required (rate-limited, CSRF-exempt)
// ---------------------------------------------------------------------------
const publicSubmitLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    message: { success: false, error: 'Too many submissions from this address. Please try again later.' },
    standardHeaders: true,
    legacyHeaders: false
});

// Public business submission from the website (lands as a pending lead)
app.post('/api/public/business-submissions', publicSubmitLimiter, async (req, res) => {
    try {
        const b = req.body || {};
        // Honeypot field: real users never fill "company_website"
        if (b.company_website) return res.json({ success: true, message: 'Thank you for your submission!' });

        const required = { name: 100, category: 100, description: 2000, address: 200 };
        const missing = Object.keys(required).filter(f => !String(b[f] || '').trim());
        if (missing.length) {
            return res.status(400).json({ success: false, error: `Missing required fields: ${missing.join(', ')}` });
        }
        for (const [field, maxLen] of Object.entries({ ...required, city: 100, country: 100, email: 200, phone: 40, website: 500 })) {
            if (b[field] && String(b[field]).length > maxLen) {
                return res.status(400).json({ success: false, error: `${field} is too long (max ${maxLen} characters)` });
            }
        }

        const id = await dbOperations.addBusiness({
            name: String(b.name).trim(),
            category: String(b.category).trim(),
            description: String(b.description).trim(),
            address: String(b.address).trim(),
            city: String(b.city || '').trim() || null,
            country: String(b.country || '').trim() || null,
            email: String(b.email || '').trim() || null,
            phone: String(b.phone || '').trim() || null,
            website: String(b.website || '').trim() || null,
            contact_person: String(b.contact_person || '').trim() || null,
            socials: {},
            keywords: [],
            status: 'pending',
            pipeline_stage: 'new_lead',
            priority: 'medium',
            source: 'user_submission',
            notes: 'Submitted via public website form'
        });
        await dbOperations.addAuditLog(null, 'public_submission', 'business', id, null, { name: b.name }, req.ip);
        res.json({ success: true, message: 'Thank you! Your business has been submitted and will appear after review.' });
    } catch (error) {
        console.error('Error handling public submission:', error);
        res.status(500).json({ success: false, error: 'Failed to submit. Please try again later.' });
    }
});

// ===========================================================================================
//  CATCH-ALL: serve index.html for SPA client-side routing (must be last)
// ===========================================================================================

app.get('*', (req, res, next) => {
    // Only serve HTML for non-API requests
    if (req.path.startsWith('/api/')) {
        return res.status(404).json({ success: false, error: 'Endpoint not found' });
    }

    const indexPath = path.join(__dirname, '..', 'index.html');
    res.sendFile(indexPath, (err) => {
        if (err) {
            // If index.html doesn't exist, return 404
            res.status(404).json({ success: false, error: 'Not found' });
        }
    });
});

// ---------------------------------------------------------------------------
// Global error handler
// ---------------------------------------------------------------------------
app.use((err, req, res, _next) => {
    console.error('Unhandled error:', err);

    // CORS error
    if (err.message && err.message.includes('CORS')) {
        return res.status(403).json({ success: false, error: 'Not allowed by CORS' });
    }

    // JSON parse error
    if (err.type === 'entity.parse.failed') {
        return res.status(400).json({ success: false, error: 'Invalid JSON in request body' });
    }

    // Payload too large
    if (err.type === 'entity.too.large') {
        return res.status(413).json({ success: false, error: 'Request body too large' });
    }

    res.status(err.status || 500).json({
        success: false,
        error: process.env.NODE_ENV === 'production'
            ? 'Internal server error'
            : err.message || 'Internal server error'
    });
});

// ---------------------------------------------------------------------------
// Start server: wait for database to be ready, THEN listen
// ---------------------------------------------------------------------------
async function startServer() {
    try {
        console.log('Waiting for database to be ready...');
        await dbReady;
        console.log('Database ready. Starting HTTP server...');

        app.listen(PORT, '0.0.0.0', () => {
            console.log(`Asian Directory API running on port ${PORT}`);
            console.log(`Health: http://localhost:${PORT}/api/health`);
            console.log(`Database: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);
        });
    } catch (err) {
        console.error('FATAL: Failed to start server:', err);
        process.exit(1);
    }
}

if (require.main === module) {
    startServer();
}

// Export for testing
module.exports = app;
