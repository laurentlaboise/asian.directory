#!/bin/bash

# Update Frontend URLs Script
# This script updates all frontend files with the production backend URL

# Check if Railway URL is provided
if [ -z "$1" ]; then
    echo "❌ Error: Railway URL not provided"
    echo ""
    echo "Usage: ./update-frontend-urls.sh https://your-backend.railway.app"
    echo ""
    echo "Example:"
    echo "./update-frontend-urls.sh https://asian-directory-production.up.railway.app"
    exit 1
fi

RAILWAY_URL="$1"
API_URL="${RAILWAY_URL}/api"

echo "🔄 Updating frontend files with backend URL..."
echo "Backend URL: $RAILWAY_URL"
echo "API URL: $API_URL"
echo ""

# Function to update file
update_file() {
    local file=$1
    echo "📝 Updating $file..."
    
    # Backup original file
    cp "$file" "${file}.backup"
    
    # Update the API_BASE_URL
    if grep -q "API_BASE_URL.*localhost:3000" "$file"; then
        sed -i "s|const API_BASE_URL = 'http://localhost:3000/api'|const API_BASE_URL = '$API_URL'|g" "$file"
        echo "   ✅ Updated: localhost:3000 → $RAILWAY_URL"
    elif grep -q "API_BASE_URL" "$file"; then
        sed -i "s|const API_BASE_URL = '[^']*'|const API_BASE_URL = '$API_URL'|g" "$file"
        echo "   ✅ Updated API_BASE_URL"
    else
        echo "   ⚠️  No API_BASE_URL found in $file"
    fi
}

# Update all HTML files
FILES=("index.html" "admin-login.html" "admin-dashboard.html" "test-api.html")

for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        update_file "$file"
    else
        echo "   ⚠️  File not found: $file"
    fi
    echo ""
done

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "✅ All files updated!"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "📋 Files modified:"
for file in "${FILES[@]}"; do
    if [ -f "$file" ]; then
        echo "   - $file"
    fi
done
echo ""
echo "💾 Backup files created (.backup extension)"
echo ""
echo "🔍 Next steps:"
echo "1. Review changes: git diff"
echo "2. Commit: git add . && git commit -m 'feat: Update frontend to use production backend'"
echo "3. Push: git push origin main"
echo ""
echo "🧪 Test the connection:"
echo "   Visit: https://www.asian.directory"
echo "   Try searching for a business"
echo ""
