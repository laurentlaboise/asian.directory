#!/bin/bash

# asian.directory - Status Check Script
# Run this script to diagnose connection and DNS issues
#
# Usage:
#   chmod +x check-status.sh   # Make executable (first time only)
#   ./check-status.sh          # Run the diagnostic

echo "========================================"
echo "  asian.directory Status Check"
echo "  $(date)"
echo "========================================"
echo ""

# Configuration
BACKEND_URL="csxbygix.up.railway.app"
BACKEND_HEALTH="https://${BACKEND_URL}/api/health"
FRONTEND_DOMAIN="www.asian.directory"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print status
print_status() {
    if [ "$1" = "ok" ]; then
        echo -e "${GREEN}✓${NC} $2"
    elif [ "$1" = "warn" ]; then
        echo -e "${YELLOW}⚠${NC} $2"
    else
        echo -e "${RED}✗${NC} $2"
    fi
}

echo "1. Checking DNS Resolution..."
echo "----------------------------"

# Check backend DNS
if nslookup "$BACKEND_URL" > /dev/null 2>&1; then
    print_status "ok" "Backend DNS ($BACKEND_URL) resolves correctly"
else
    print_status "fail" "Backend DNS ($BACKEND_URL) cannot be resolved"
    echo "   This may indicate Railway platform issues."
    echo "   Check: https://status.railway.com/"
fi

# Check frontend DNS
if nslookup "$FRONTEND_DOMAIN" > /dev/null 2>&1; then
    print_status "ok" "Frontend DNS ($FRONTEND_DOMAIN) resolves correctly"
else
    print_status "warn" "Frontend DNS ($FRONTEND_DOMAIN) cannot be resolved"
    echo "   Check your domain registrar's DNS settings."
fi

echo ""
echo "2. Checking Backend API..."
echo "----------------------------"

# Check backend health endpoint
HTTP_CODE=$(curl -s -o /tmp/backend_response.txt -w "%{http_code}" --max-time 10 "$BACKEND_HEALTH" 2>/dev/null)
RESPONSE=$(cat /tmp/backend_response.txt 2>/dev/null)
CURL_EXIT=$?

if [ $CURL_EXIT -eq 6 ]; then
    print_status "fail" "Cannot reach backend (DNS resolution failed)"
    echo "   Railway may be experiencing platform issues."
    echo "   Check: https://status.railway.com/"
elif [ $CURL_EXIT -eq 28 ]; then
    print_status "fail" "Backend connection timed out"
    echo "   The server may be down or unreachable."
elif [ "$HTTP_CODE" = "200" ] && echo "$RESPONSE" | grep -q '"status":"ok"'; then
    print_status "ok" "Backend API is healthy"
    echo "   Response: $RESPONSE"
elif echo "$RESPONSE" | grep -iq "DOCTYPE html"; then
    print_status "fail" "Backend returns HTML instead of JSON (HTTP $HTTP_CODE)"
    echo "   This indicates Railway is serving frontend files."
    echo "   Fix: Set Root Directory to 'backend' in Railway settings."
elif [ "$HTTP_CODE" = "000" ]; then
    print_status "fail" "Cannot connect to backend"
    echo "   Network or DNS issues detected."
else
    print_status "fail" "Backend API returned unexpected response (HTTP $HTTP_CODE)"
    echo "   Response: $RESPONSE"
fi

echo ""
echo "3. Checking Frontend (GitHub Pages)..."
echo "----------------------------"

# Check frontend
FRONTEND_RESPONSE=$(curl -s --max-time 10 -I "https://$FRONTEND_DOMAIN" 2>&1)
if echo "$FRONTEND_RESPONSE" | grep -q "200 OK"; then
    print_status "ok" "Frontend is accessible"
elif echo "$FRONTEND_RESPONSE" | grep -q "Could not resolve"; then
    print_status "fail" "Cannot reach frontend (DNS resolution failed)"
    echo "   Check your DNS configuration."
else
    print_status "warn" "Frontend may have issues"
    echo "   Response: $(echo "$FRONTEND_RESPONSE" | head -1)"
fi

echo ""
echo "========================================"
echo "  Quick Actions"
echo "========================================"
echo ""
echo "If backend is unreachable due to Railway issues:"
echo "  1. Check Railway status: https://status.railway.com/"
echo "  2. Run backend locally: cd backend && npm install && npm start"
echo ""
echo "If frontend DNS is failing:"
echo "  1. Check DNS settings at your registrar"
echo "  2. Use: https://www.whatsmydns.net/"
echo ""
echo "Documentation:"
echo "  - RAILWAY_TROUBLESHOOTING.md"
echo "  - DNS_SETUP.md"
echo "========================================"
