#!/bin/bash

# Script to start both backend and frontend servers for asian.directory
# Usage: ./start-servers.sh

echo "🚀 Starting asian.directory servers..."
echo ""

# Check if backend dependencies are installed
if [ ! -d "backend/node_modules" ]; then
    echo "📦 Installing backend dependencies..."
    cd backend && npm install && cd ..
    echo ""
fi

# Start backend server in background
echo "🔧 Starting backend API server on port 3000..."
cd backend && node server.js &
BACKEND_PID=$!
cd ..

# Wait for backend to start
sleep 2

# Check if backend is running
if curl -s http://localhost:3000/api/health > /dev/null; then
    echo "✅ Backend API server is running at http://localhost:3000"
else
    echo "❌ Backend server failed to start"
    exit 1
fi

echo ""
echo "🌐 Starting frontend server on port 8080..."
python3 -m http.server 8080 &
FRONTEND_PID=$!

# Wait for frontend to start
sleep 1

echo "✅ Frontend server is running at http://localhost:8080"
echo ""
echo "=================================="
echo "✨ Servers are ready!"
echo "=================================="
echo ""
echo "📝 Access points:"
echo "  - Homepage:       http://localhost:8080"
echo "  - Admin Login:    http://localhost:8080/admin-login.html"
echo "  - Admin Dashboard: http://localhost:8080/admin-dashboard.html"
echo "  - Backend API:    http://localhost:3000/api"
echo ""
echo "🛑 To stop servers:"
echo "  kill $BACKEND_PID $FRONTEND_PID"
echo ""
echo "Press Ctrl+C to stop all servers"
echo ""

# Wait for Ctrl+C
trap "echo ''; echo '🛑 Stopping servers...'; kill $BACKEND_PID $FRONTEND_PID; exit" INT
wait
