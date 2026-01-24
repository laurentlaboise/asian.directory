const express = require('express');
const cors = require('cors');
const { dbOperations } = require('./database');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', message: 'Asian Directory API is running' });
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

// Get single business by ID
app.get('/api/businesses/:id', (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        const business = dbOperations.getBusinessById(businessId);
        
        if (business) {
            res.json({ success: true, data: business });
        } else {
            res.status(404).json({ success: false, error: 'Business not found' });
        }
    } catch (error) {
        console.error('Error fetching business:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch business' });
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
app.post('/api/businesses', (req, res) => {
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

// Update business
app.put('/api/businesses/:id', (req, res) => {
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

        const updated = dbOperations.updateBusiness(businessId, business);
        
        if (updated) {
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
app.delete('/api/businesses/:id', (req, res) => {
    try {
        const businessId = parseInt(req.params.id);
        const deleted = dbOperations.deleteBusiness(businessId);
        
        if (deleted) {
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
    console.log(`  - GET    /api/businesses`);
    console.log(`  - GET    /api/businesses/search?q=query`);
    console.log(`  - POST   /api/businesses`);
    console.log(`  - PUT    /api/businesses/:id`);
    console.log(`  - DELETE /api/businesses/:id`);
    console.log(`  - GET    /api/conversations`);
    console.log(`  - POST   /api/conversations`);
});

module.exports = app;
