# Asian Directory Backend API

Backend server with database support for the asian.directory AI-driven business search.

## Features

- **Database Storage**: SQLite database for storing businesses and conversation history
- **RESTful API**: Express.js backend with CORS support
- **AI Conversation Tracking**: Store user queries and AI responses for analytics and improvement

## Prerequisites

- Node.js (v14 or higher)
- npm or yarn

## Installation

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. (Optional) Create a `.env` file based on `.env.example`:
   ```bash
   cp .env.example .env
   ```

## Running the Server

Start the server:
```bash
npm start
```

The API server will start on `http://localhost:3000` (or the port specified in your `.env` file).

## Accessing the Backend

Once the server is running, you can access it in several ways:

### 1. Web Browser

Open your browser and navigate to any of these URLs:

- **Health Check**: http://localhost:3000/api/health
  - Verify the server is running
  
- **View All Businesses**: http://localhost:3000/api/businesses
  - See all businesses in JSON format
  
- **Search Businesses**: http://localhost:3000/api/businesses/search?q=ramen
  - Search for businesses (replace "ramen" with your search term)
  
- **View Conversations**: http://localhost:3000/api/conversations
  - See conversation history

### 2. Command Line (curl)

```bash
# Check if backend is running
curl http://localhost:3000/api/health

# Get all businesses
curl http://localhost:3000/api/businesses

# Search for businesses
curl "http://localhost:3000/api/businesses/search?q=ramen"

# Add a new business
curl -X POST http://localhost:3000/api/businesses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Sample Restaurant",
    "category": "Restaurant",
    "description": "A great place to eat",
    "address": "123 Main St, Tokyo",
    "website": "https://example.com",
    "phone": "+81-3-1234-5678",
    "socials": {"instagram": "sample_restaurant"},
    "keywords": ["restaurant", "food", "tokyo"]
  }'
```

### 3. API Testing Tools

Use tools like **Postman**, **Insomnia**, or **Thunder Client** (VS Code extension):
- Set the base URL to: `http://localhost:3000`
- Add endpoints like `/api/health`, `/api/businesses`, etc.
- For POST requests, set Content-Type to `application/json`

### 4. From Your Frontend Application

The frontend at `http://localhost:8080` automatically connects to the backend. If you need to change the backend URL, update the `API_BASE_URL` in `index.html`:

```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

### Verifying Backend Access

After starting the server, verify it's working:

```bash
# Quick verification
curl http://localhost:3000/api/health

# Expected output:
# {"status":"ok","message":"Asian Directory API is running"}
```

If you see the JSON response above, your backend is working correctly!

### Accessing the Database Directly

To view or query the SQLite database directly:

```bash
# Install sqlite3 if not already installed
# On macOS: brew install sqlite3
# On Ubuntu: sudo apt-get install sqlite3

# Open the database
sqlite3 backend/asian-directory.db

# Example queries:
sqlite> SELECT * FROM businesses;
sqlite> SELECT * FROM conversations ORDER BY created_at DESC LIMIT 10;
sqlite> .schema businesses
sqlite> .quit
```

Or use a GUI tool like:
- **DB Browser for SQLite** (https://sqlitebrowser.org/)
- **TablePlus** (https://tableplus.com/)
- **DBeaver** (https://dbeaver.io/)

### Troubleshooting Access

**Problem: Cannot connect to backend**
- Check if the server is running: `curl http://localhost:3000/api/health`
- Verify the port is not in use by another application
- Check for error messages in the terminal where you ran `npm start`

**Problem: "Connection refused" or "ECONNREFUSED"**
- Make sure you started the backend: `cd backend && npm start`
- Check that you're using the correct port (default is 3000)

**Problem: CORS errors in browser**
- CORS is enabled by default for all origins
- If you need to restrict origins, set `ALLOWED_ORIGINS` in your `.env` file

**Problem: 404 Not Found**
- Ensure you're using the correct URL format: `http://localhost:3000/api/...`
- Note the `/api` prefix is required for all endpoints

## API Endpoints

### Health Check
- **GET** `/api/health`
  - Check if the API is running
  - Response: `{ "status": "ok", "message": "Asian Directory API is running" }`

### Businesses

- **GET** `/api/businesses`
  - Get all businesses from the database
  - Response: `{ "success": true, "data": [...] }`

- **GET** `/api/businesses/search?q=query`
  - Search businesses by keywords
  - Query parameter: `q` - search query
  - Response: `{ "success": true, "data": [...], "query": "..." }`

- **POST** `/api/businesses`
  - Add a new business to the database
  - Body (JSON):
    ```json
    {
      "name": "Business Name",
      "category": "Restaurant",
      "description": "Business description",
      "address": "Full address",
      "website": "https://example.com",
      "phone": "+81 3-1234-5678",
      "socials": {
        "instagram": "username",
        "facebook": "username"
      },
      "keywords": ["keyword1", "keyword2"]
    }
    ```
  - Response: `{ "success": true, "id": 123 }`

### Conversations

- **GET** `/api/conversations`
  - Get conversation history (last 100)
  - Response: `{ "success": true, "data": [...] }`

- **POST** `/api/conversations`
  - Save a conversation
  - Body (JSON):
    ```json
    {
      "userQuery": "Find ramen in Tokyo",
      "aiResponse": [...],
      "businessIds": [1, 2, 3]
    }
    ```
  - Response: `{ "success": true, "id": 456 }`

## Database

The backend uses SQLite for data storage. The database file (`asian-directory.db`) is automatically created when you first run the server.

### Database Schema

**businesses table:**
- id (INTEGER PRIMARY KEY)
- name (TEXT)
- category (TEXT)
- description (TEXT)
- address (TEXT)
- website (TEXT)
- phone (TEXT)
- socials (TEXT - JSON)
- keywords (TEXT - JSON array)
- created_at (DATETIME)

**conversations table:**
- id (INTEGER PRIMARY KEY)
- user_query (TEXT)
- ai_response (TEXT - JSON)
- business_ids (TEXT - JSON array)
- created_at (DATETIME)

## Initial Data

The database is automatically seeded with sample businesses when first initialized:
- Ichiran Ramen (Tokyo)
- Gardens by the Bay (Singapore)
- Onion Cafe (Seoul)
- Chatuchak Weekend Market (Bangkok)
- The Bombay Canteen (Mumbai)

## CORS Configuration

By default, CORS is enabled for all origins. To restrict origins in production, set the `ALLOWED_ORIGINS` environment variable.

## Development

The server uses simple Node.js with Express. Any changes to the code require a restart of the server.

## Tech Stack

- **Node.js** - Runtime environment
- **Express.js** - Web framework
- **better-sqlite3** - Database driver
- **cors** - CORS middleware

## Quick Reference

### Backend URLs (when running locally)
- Backend API: `http://localhost:3000`
- Health Check: `http://localhost:3000/api/health`
- All Businesses: `http://localhost:3000/api/businesses`
- Search: `http://localhost:3000/api/businesses/search?q=<query>`
- Conversations: `http://localhost:3000/api/conversations`

### Database Location
- File: `backend/asian-directory.db`
- Access via SQLite CLI or GUI tools

### Environment Variables
- `PORT` - Server port (default: 3000)
- `ALLOWED_ORIGINS` - CORS allowed origins (default: all)
