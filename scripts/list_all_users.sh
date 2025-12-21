#!/bin/bash

# Script to list all users and check for duplicates
# Usage: ./list_all_users.sh [email] [password]

# Configuration
EMAIL="${1:-admin@example.com}"
PASSWORD="${2:-your_password}"
API_BASE_URL="${API_BASE_URL:-http://localhost:5001/api}"

echo "=========================================="
echo "Listing All Users and Checking Duplicates"
echo "=========================================="
echo ""

# Step 1: Login to get JWT token
echo "Step 1: Logging in to get JWT token..."
LOGIN_RESPONSE=$(curl -s -X POST "${API_BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}")

TOKEN=$(echo "$LOGIN_RESPONSE" | jq -r '.data.token // .token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Error: Failed to get token. Login response:"
  echo "$LOGIN_RESPONSE" | jq .
  exit 1
fi

echo "✅ Successfully obtained token"
echo ""

# Step 2: Fetch all users (with high limit to get all at once)
echo "Step 2: Fetching all users..."
echo ""

# First, get the total count
TOTAL_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/admin/users?page=1&limit=1&role=client" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

TOTAL_COUNT=$(echo "$TOTAL_RESPONSE" | jq -r '.data.pagination.total // 0')

if [ "$TOTAL_COUNT" == "0" ] || [ -z "$TOTAL_COUNT" ]; then
  echo "⚠️  Could not determine total count, fetching with limit 1000..."
  LIMIT=1000
else
  LIMIT=$((TOTAL_COUNT + 100))  # Add buffer to ensure we get all
  echo "📊 Total users found: $TOTAL_COUNT"
  echo "📥 Fetching all users with limit: $LIMIT"
fi

echo ""

# Fetch all users
USERS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/admin/users?page=1&limit=${LIMIT}&role=client" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# Check if request was successful
SUCCESS=$(echo "$USERS_RESPONSE" | jq -r '.success // false')

if [ "$SUCCESS" != "true" ]; then
  echo "❌ Error fetching users:"
  echo "$USERS_RESPONSE" | jq .
  exit 1
fi

# Extract users array
USERS=$(echo "$USERS_RESPONSE" | jq -c '.data.users // []')
USER_COUNT=$(echo "$USERS" | jq 'length')

echo "✅ Successfully fetched $USER_COUNT users"
echo ""

# Step 3: Check for duplicates
echo "Step 3: Checking for duplicates..."
echo ""

# Save users to temporary file for analysis
TEMP_FILE=$(mktemp)
echo "$USERS" | jq '.' > "$TEMP_FILE"

# Check for duplicate emails
echo "📧 Checking for duplicate emails..."
DUPLICATE_EMAILS=$(echo "$USERS" | jq -r '.[].email' | sort | uniq -d)

if [ -z "$DUPLICATE_EMAILS" ]; then
  echo "✅ No duplicate emails found"
else
  echo "⚠️  Found duplicate emails:"
  echo "$DUPLICATE_EMAILS" | while read -r email; do
    echo "   - $email"
    echo "$USERS" | jq -r ".[] | select(.email == \"$email\") | \"      ID: \(.id), Name: \(.name // \"N/A\"), Created: \(.created_at // \"N/A\")\""
  done
fi

echo ""

# Check for duplicate IDs
echo "🆔 Checking for duplicate IDs..."
DUPLICATE_IDS=$(echo "$USERS" | jq -r '.[].id' | sort | uniq -d)

if [ -z "$DUPLICATE_IDS" ]; then
  echo "✅ No duplicate IDs found"
else
  echo "⚠️  Found duplicate IDs:"
  echo "$DUPLICATE_IDS" | while read -r id; do
    echo "   - $id"
    echo "$USERS" | jq -r ".[] | select(.id == \"$id\") | \"      Email: \(.email), Name: \(.name // \"N/A\")\""
  done
fi

echo ""

# Check for users with same email but different IDs (potential duplicates)
echo "🔍 Checking for users with same email but different IDs..."
EMAIL_TO_IDS=$(echo "$USERS" | jq -r 'group_by(.email) | .[] | select(length > 1) | {email: .[0].email, ids: [.[].id]}')

if [ -z "$EMAIL_TO_IDS" ] || [ "$EMAIL_TO_IDS" == "[]" ]; then
  echo "✅ No users with same email but different IDs found"
else
  echo "⚠️  Found users with same email but different IDs:"
  echo "$EMAIL_TO_IDS" | jq -r '.[] | "   Email: \(.email)\n   IDs: \(.ids | join(", "))"'
fi

echo ""

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Total users fetched: $USER_COUNT"
echo "Unique emails: $(echo "$USERS" | jq -r '.[].email' | sort -u | wc -l | tr -d ' ')"
echo "Unique IDs: $(echo "$USERS" | jq -r '.[].id' | sort -u | wc -l | tr -d ' ')"
echo ""

# Save full user list to file
OUTPUT_FILE="all_users_$(date +%Y%m%d_%H%M%S).json"
echo "$USERS_RESPONSE" | jq '.' > "$OUTPUT_FILE"
echo "💾 Full user list saved to: $OUTPUT_FILE"
echo ""

# Cleanup
rm -f "$TEMP_FILE"

echo "✅ Done!"


