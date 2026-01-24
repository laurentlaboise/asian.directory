const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { dbOperations } = require('./database');

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
        const user = dbOperations.getUserByUsername(username);

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
app.get('/api/businesses', (req, res) => {
    try {
        const businesses = dbOperations.getAllBusinesses();
        res.json({ success: true, data: businesses });
    } catch (error) {
        console.error('Error fetching businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch businesses' });
    }
});

// Search businesses
app.get('/api/businesses/search', (req, res) => {
    try {
        const query = req.query.q || '';
        const results = dbOperations.searchBusinesses(query);
        res.json({ success: true, data: results, query });
    } catch (error) {
        console.error('Error searching businesses:', error);
        res.status(500).json({ success: false, error: 'Failed to search businesses' });
    }
});

// Add new business
app.post('/api/businesses', authenticateToken, (req, res) => {
    try {
        const business = req.body;
        
        // Basic validation
        if (!business.name || !business.category || !business.description || !business.address) {
            return res.status(400).json({ 
                success: false, 
                error: 'Missing required fields: name, category, description, address' 
            });
        }

        const businessId = dbOperations.addBusiness(business);
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

// Save conversation
app.post('/api/conversations', (req, res) => {
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

        const conversationId = dbOperations.saveConversation(userQuery, aiResponse, businessIds);
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
app.get('/api/conversations', (req, res) => {
    try {
        const conversations = dbOperations.getAllConversations();
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
    console.log(`  - POST /api/businesses (requires auth)`);
    console.log(`  - GET  /api/conversations`);
    console.log(`  - POST /api/conversations`);
});

module.exports = app;
