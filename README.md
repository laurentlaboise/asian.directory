# asian.directory
AI-driven business directory for Asia with database backend.

## Features

- 🤖 **AI-Powered Search**: Natural language search for businesses across Asia
- 💾 **Database Backend**: SQLite database for storing businesses and conversation history
- 🔄 **Real-time Updates**: Add businesses via API and see them immediately in search
- 📊 **Conversation Tracking**: Automatic logging of user queries and AI responses
- 🌏 **Asia-Focused**: Covering businesses across Japan, Korea, China, Singapore, Thailand, Vietnam, Malaysia, Indonesia, Philippines, India, and more

## Quick Start

### 1. Start Backend Server
```bash
cd backend
npm install
npm start
```

The backend API will be available at: **http://localhost:3000**

### 2. Serve Frontend
```bash
python3 -m http.server 8080
```

### 3. Open Browser
Navigate to `http://localhost:8080`

## Accessing the Backend

Once the backend is running, you can access it directly:

- **Health Check**: http://localhost:3000/api/health
- **All Businesses**: http://localhost:3000/api/businesses
- **Search**: http://localhost:3000/api/businesses/search?q=ramen

For complete API documentation and advanced usage, see [backend/README.md](backend/README.md)

For detailed setup instructions, see [SETUP.md](SETUP.md)

## Tech Stack

- **Frontend**: HTML, CSS (Tailwind), JavaScript
- **Backend**: Node.js, Express.js
- **Database**: SQLite3
- **API**: RESTful with CORS support

## API Documentation

See [backend/README.md](backend/README.md) for complete API documentation.

## Contributing

Contributions are welcome! Feel free to open issues or submit pull requests.
