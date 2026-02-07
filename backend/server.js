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
const { dbOperations } = require(USE_POSTGRES ? './database-postgres' : './database');
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
    : ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:8080'];

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
app.get('/', (req, res) => {
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
        const userId = await dbOperations.createUser(username, hashedPassword, email || null, 'viewer', username);

        const token = jwt.sign(
            { id: userId, username, role: 'viewer' },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            success: true,
            message: 'User created successfully',
            userId,
            token,
            user: { id: userId, username, role: 'viewer' }
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

        const token = signToken(user);

        res.json({
            success: true,
            token,
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
app.get('/api/crm/dashboard', authenticateToken, requireRole('admin', 'editor'), async (req, res) => {
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
        const stages = ['new_lead', 'contacted', 'qualified', 'proposal', 'negotiation', 'active_listing', 'on_hold', 'lost', 'churned'];
        const pipeline = {};

        for (const stage of stages) {
            const businesses = await dbOperations.getAllBusinesses({ pipeline_stage: stage, limit: 50 });
            pipeline[stage] = {
                count: businesses.length,
                businesses
            };
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
// Start server (only when run directly, not when imported for testing)
// ---------------------------------------------------------------------------
if (require.main === module) {
    app.listen(PORT, () => {
        console.log(`Asian Directory API server is running on port ${PORT}`);
        console.log(`Health check: http://localhost:${PORT}/api/health`);
        console.log(`Database: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);
        console.log('');
        console.log('API endpoints:');
        console.log('  Auth:');
        console.log('    POST /api/auth/register');
        console.log('    POST /api/auth/login');
        console.log('    GET  /api/auth/verify');
        console.log('    GET  /api/auth/google');
        console.log('    GET  /api/auth/facebook');
        console.log('  Businesses:');
        console.log('    GET    /api/businesses');
        console.log('    GET    /api/businesses/search?q=query');
        console.log('    GET    /api/businesses/categories');
        console.log('    GET    /api/businesses/countries');
        console.log('    GET    /api/businesses/stats (auth)');
        console.log('    GET    /api/businesses/export?format=json|csv (auth)');
        console.log('    GET    /api/businesses/:id');
        console.log('    POST   /api/businesses (auth)');
        console.log('    PUT    /api/businesses/:id (auth)');
        console.log('    PATCH  /api/businesses/:id (auth)');
        console.log('    DELETE /api/businesses/:id (auth)');
        console.log('    POST   /api/businesses/bulk-pipeline (auth, admin/editor)');
        console.log('  CRM:');
        console.log('    GET  /api/crm/dashboard (auth, admin/editor)');
        console.log('    GET  /api/crm/pipeline (auth)');
        console.log('    GET  /api/crm/analytics?days=30 (auth, admin)');
        console.log('    GET  /api/crm/audit-log (auth, admin)');
        console.log('    POST /api/crm/communications (auth)');
        console.log('    GET  /api/crm/communications/:businessId (auth)');
        console.log('  Users:');
        console.log('    GET   /api/users (auth, admin)');
        console.log('    PATCH /api/users/:id/role (auth, admin)');
        console.log('    PATCH /api/users/:id/active (auth, admin)');
        console.log('  API Keys:');
        console.log('    POST   /api/keys (auth)');
        console.log('    GET    /api/keys (auth)');
        console.log('    GET    /api/keys/all (auth, admin)');
        console.log('    DELETE /api/keys/:id (auth)');
        console.log('    GET    /api/keys/:id/usage (auth)');
        console.log('  Tags:');
        console.log('    POST   /api/tags (auth)');
        console.log('    GET    /api/tags (auth)');
        console.log('    POST   /api/tags/business/:businessId (auth)');
        console.log('    DELETE /api/tags/business/:businessId/:tagId (auth)');
        console.log('  Analytics:');
        console.log('    POST /api/analytics/event');
        console.log('  Conversations:');
        console.log('    GET  /api/conversations');
        console.log('    POST /api/conversations');
        console.log('  Public API (v1, requires API key):');
        console.log('    GET /api/v1/businesses');
        console.log('    GET /api/v1/businesses/search?q=query');
        console.log('    GET /api/v1/businesses/:id');
    });
}

// Export for testing
module.exports = app;
