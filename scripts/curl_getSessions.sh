#!/bin/bash

# Script to get upcoming sessions using curl
# Usage: ./curl_getSessions.sh <email> <password> [API_URL]
# Example: ./curl_getSessions.sh abhishekravi063@gmail.com yourpassword

EMAIL="${1:-abhishekravi063@gmail.com}"
PASSWORD="${2}"
API_URL="${3:-http://localhost:5001}"

if [ -z "$PASSWORD" ]; then
  echo "Usage: $0 <email> <password> [API_URL]"
  echo "Example: $0 abhishekravi063@gmail.com yourpassword"
  echo ""
  echo "Note: For security, you can also set password via environment variable:"
  echo "  PASSWORD=yourpassword $0 $EMAIL"
  exit 1
fi

echo "🔐 Step 1: Logging in to get authentication token..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 1: Login to get JWT token
LOGIN_RESPONSE=$(curl -s -X POST "${API_URL}/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{
    \"email\": \"${EMAIL}\",
    \"password\": \"${PASSWORD}\"
  }")

# Extract token from response
TOKEN=$(echo $LOGIN_RESPONSE | grep -o '"token":"[^"]*' | cut -d'"' -f4)

if [ -z "$TOKEN" ]; then
  echo "❌ Login failed!"
  echo "Response: $LOGIN_RESPONSE"
  exit 1
fi

echo "✅ Login successful!"
echo "Token: ${TOKEN:0:20}..."
echo ""

echo "📅 Step 2: Fetching upcoming sessions..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Step 2: Get sessions (without status filter to get all, then filter for upcoming)
curl -s -X GET "${API_URL}/api/clients/sessions?page=1&limit=50" \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" | jq '.'

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "💡 Tip: Install 'jq' for better JSON formatting: brew install jq (macOS) or apt-get install jq (Linux)"

