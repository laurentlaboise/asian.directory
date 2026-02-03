const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const packageJson = require('./package.json');

// Auto-detect database: PostgreSQL if DATABASE_URL exists, else SQLite
const USE_POSTGRES = !!process.env.DATABASE_URL;
const { dbOperations } = require(USE_POSTGRES ? './database-postgres' : './database');

console.log(`Using database: ${USE_POSTGRES ? 'PostgreSQL' : 'SQLite'}`);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-key-please-change-in-production-use-env-variable';

// Middleware
app.use(cors());
app.use(express.json());

// Authentication middleware
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

// Root route - API information
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
                verify: 'GET /api/auth/verify'
            },
            businesses: {
                list: 'GET /api/businesses',
                search: 'GET /api/businesses/search?q=query',
                get: 'GET /api/businesses/:id',
                create: 'POST /api/businesses (requires auth)',
                update: 'PUT /api/businesses/:id (requires auth)',
                delete: 'DELETE /api/businesses/:id (requires auth)'
            },
            conversations: {
                list: 'GET /api/conversations',
                create: 'POST /api/conversations'
            }
        }
    });
});

// Favicon handler - return empty response to prevent 404
app.get('/favicon.ico', (req, res) => {
    res.status(204).end();
});

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Asian Directory API is running' });
});

// Authentication endpoints
// Register new user
// TODO: Add rate limiting to prevent brute force attacks (e.g., using express-rate-limit)
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password } = req.body;

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

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const userId = dbOperations.createUser(username, hashedPassword);

        res.json({ 
            success: true, 
            message: 'User created successfully',
            userId 
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
// TODO: Add rate limiting to prevent brute force attacks (e.g., using express-rate-limit)
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({ 
                success: false, 
                error: 'Username and password are required' 
            });
        }

        // Get user from database
        const user = await dbOperations.getUserByUsername(username);

        if (!user) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        // Verify password
        const isValidPassword = await bcrypt.compare(password, user.password);

        if (!isValidPassword) {
            return res.status(401).json({ 
                success: false, 
                error: 'Invalid username or password' 
            });
        }

        // Generate JWT token
        const token = jwt.sign(
            { id: user.id, username: user.username },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({ 
            success: true, 
            token,
            user: { id: user.id, username: user.username }
        });
    } catch (error) {
        console.error('Error during login:', error);
        res.status(500).json({ success: false, error: 'Login failed' });
    }
});

// Verify token
app.get('/api/auth/verify', authenticateToken, (req, res) => {
    res.json({ 
        success: true, 
        user: { id: req.user.id, username: req.user.username }
    });
});

// Get all businesses
app.get('/api/businesses', async (req, res) => {
    try {
        const businesses = await dbOperations.getAllBusinesses();
        res.json({ success: true, data: businesses });
    } catch (error) {
        console.error('Error fetching businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch businesses' });
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

// Get single business by ID
app.get('/api/businesses/:id', async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        const business = await dbOperations.getBusinessById(businessId);
        
        if (!business) {
            return res.status(404).json({ 
                success: false, 
                error: 'Business not found' 
            });
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
        
        // Basic validation
        if (!business.name || !business.category || !business.description || !business.address) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: name, category, description, address' 
            });
        }

        const businessId = await dbOperations.addBusiness(business);
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

// Update business
app.put('/api/businesses/:id', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        const business = req.body;
        
        // Basic validation
        if (!business.name || !business.category || !business.description || !business.address) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: name, category, description, address' 
            });
        }
        
        const success = await dbOperations.updateBusiness(businessId, business);
        
        if (success) {
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

// Delete business
app.delete('/api/businesses/:id', authenticateToken, async (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        const success = await dbOperations.deleteBusiness(businessId);
        
        if (success) {
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

// Save conversation
app.post('/api/conversations', async (req, res) => {
    try {
        const { userQuery, aiResponse, businessIds } = req.body;
        
        if (!userQuery || !aiResponse) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: userQuery, aiResponse' 
            });
        }

        // Validate that aiResponse is an array
        if (!Array.isArray(aiResponse)) {
            return res.status(400).json({ 
                success: false, 
                error: 'aiResponse must be an array' 
            });
        }

        // Validate that businessIds is an array if provided
        if (businessIds !== undefined && !Array.isArray(businessIds)) {
            return res.status(400).json({ 
                success: false, 
                error: 'businessIds must be an array' 
            });
        }

        const conversationId = await dbOperations.saveConversation(userQuery, aiResponse, businessIds);
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

// Get conversation history
app.get('/api/conversations', async (req, res) => {
    try {
        const conversations = await dbOperations.getAllConversations();
        res.json({ success: true, data: conversations });
    } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch conversations' });
    }
});

// Start server
app.listen(PORT, () => {
    console.log(`Asian Directory API server is running on port ${PORT}`);
    console.log(`Health check: http://localhost:${PORT}/api/health`);
    console.log(`API endpoints:`);
    console.log(`  - POST /api/auth/register`);
    console.log(`  - POST /api/auth/login`);
    console.log(`  - GET  /api/auth/verify`);
    console.log(`  - GET  /api/businesses`);
    console.log(`  - GET  /api/businesses/search?q=query`);
    console.log(`  - GET  /api/businesses/:id`);
    console.log(`  - POST /api/businesses (requires auth)`);
    console.log(`  - PUT  /api/businesses/:id (requires auth)`);
    console.log(`  - DELETE /api/businesses/:id (requires auth)`);
    console.log(`  - GET  /api/conversations`);
    console.log(`  - POST /api/conversations`);
});

module.exports = app;
