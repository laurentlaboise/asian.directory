# Running the Asian Directory with Database Backend

This guide will help you set up and run the asian.directory website with the backend database.

## Quick Start

### 1. Start the Backend Server

```bash
cd backend
npm install
npm start
```

The API server will start on `http://localhost:3000`

You should see:
```
Database initialized successfully
Asian Directory API server is running on port 3000
```

### 2. Serve the Frontend

Open a new terminal and run:

```bash
# From the project root
python3 -m http.server 8080
```

Or use any other static file server of your choice.

### 3. Configure the API URL (if needed)

If your backend is running on a different port or host, update the `API_BASE_URL` in `index.html`:

```javascript
const API_BASE_URL = 'http://localhost:3000/api';
```

### 4. Open in Browser

Navigate to `http://localhost:8080` in your web browser.

## Features

### AI-Powered Search
- Type any query about Asian businesses
- The AI searches the database and returns relevant results
- All searches are stored in the database for analytics

### Automatic Conversation Tracking
- Every user query and AI response is automatically saved
- View conversation history via the API: `GET /api/conversations`

### Add New Businesses
- Use the API to add new businesses programmatically
- New businesses immediately appear in search results

Example:
```bash
curl -X POST http://localhost:3000/api/businesses \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Your Business Name",
    "category": "Restaurant",
    "description": "Business description",
    "address": "Full address",
    "website": "https://example.com",
    "phone": "+1234567890",
    "socials": {
      "instagram": "username"
    },
    "keywords": ["keyword1", "keyword2"]
  }'
```

## Architecture

```
┌─────────────┐          ┌─────────────┐          ┌──────────────┐
│             │          │             │          │              │
│  Frontend   │  HTTP    │   Backend   │  SQLite  │   Database   │
│  (HTML/JS)  ├─────────>│  (Node.js)  ├─────────>│  (SQLite3)   │
│             │          │   Express   │          │              │
└─────────────┘          └─────────────┘          └──────────────┘
```

### Frontend
- Static HTML/CSS/JavaScript
- Calls backend API for data
- Falls back to local search if API unavailable

### Backend
- Node.js + Express REST API
- CORS enabled for cross-origin requests
- SQLite database for persistence

### Database
- SQLite (file-based, no separate server needed)
- Two tables: `businesses` and `conversations`
- Automatically initialized on first run
- Pre-seeded with sample data

## API Endpoints

See [backend/README.md](backend/README.md) for complete API documentation.

## Troubleshooting

### Frontend can't connect to backend
- Ensure the backend server is running (`npm start` in backend directory)
- Check that the API_BASE_URL in index.html matches your backend address
- Verify CORS is enabled (it is by default)
- Check browser console for error messages

### Database errors
- Delete `backend/asian-directory.db` and restart the server to reset the database
- Check file permissions in the backend directory

### Port already in use
- Change the PORT in backend/.env file
- Or set PORT environment variable: `PORT=3001 npm start`

## Production Deployment

For production deployment:

1. **Frontend**: Deploy to any static hosting (GitHub Pages, Netlify, Vercel, etc.)
2. **Backend**: Deploy to a Node.js hosting service (Heroku, Railway, Render, etc.)
3. **Update API_BASE_URL**: Change the API_BASE_URL in index.html to your production backend URL
4. **Environment Variables**: Set appropriate CORS origins for security

## Development

### Adding New Features
- Backend code is in `backend/server.js` and `backend/database.js`
- Frontend code is in `index.html` (inline JavaScript)
- Database schema is defined in `backend/database.js`

### Viewing Database Contents
Use any SQLite browser or CLI:
```bash
sqlite3 backend/asian-directory.db "SELECT * FROM businesses;"
sqlite3 backend/asian-directory.db "SELECT * FROM conversations;"
```

## Support

For issues or questions, please open an issue on the GitHub repository.
