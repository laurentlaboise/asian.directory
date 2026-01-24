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

- **PUT** `/api/businesses/:id`
  - Update an existing business
  - Body (JSON): Same structure as POST
  - Response: `{ "success": true, "message": "Business updated successfully" }`

- **DELETE** `/api/businesses/:id`
  - Delete a business by ID
  - Response: `{ "success": true, "message": "Business deleted successfully" }`

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
