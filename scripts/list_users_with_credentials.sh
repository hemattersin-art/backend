#!/bin/bash

# Quick script to list all users and check for duplicates
# Using provided credentials

EMAIL="newadmin@test.com"
PASSWORD="admin123"
API_BASE_URL="${API_BASE_URL:-http://localhost:5001/api}"

echo "=========================================="
echo "Listing All Users and Checking Duplicates"
echo "=========================================="
echo ""

# Step 1: Login to get JWT token
echo "Step 1: Logging in..."
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

# Step 2: Fetch all users
echo "Step 2: Fetching all users..."
echo ""

USERS_RESPONSE=$(curl -s -X GET "${API_BASE_URL}/admin/users?page=1&limit=1000&role=client" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json")

# Check if request was successful
SUCCESS=$(echo "$USERS_RESPONSE" | jq -r '.success // false')

if [ "$SUCCESS" != "true" ]; then
  echo "❌ Error fetching users:"
  echo "$USERS_RESPONSE" | jq .
  exit 1
fi

# Extract data
TOTAL=$(echo "$USERS_RESPONSE" | jq -r '.data.pagination.total // 0')
USERS=$(echo "$USERS_RESPONSE" | jq -c '.data.users // []')
USER_COUNT=$(echo "$USERS" | jq 'length')

echo "✅ Successfully fetched $USER_COUNT users (Total: $TOTAL)"
echo ""

# Save to file
OUTPUT_FILE="all_users_$(date +%Y%m%d_%H%M%S).json"
echo "$USERS_RESPONSE" | jq '.' > "$OUTPUT_FILE"
echo "💾 Full response saved to: $OUTPUT_FILE"
echo ""

# Step 3: Check for duplicates
echo "Step 3: Checking for duplicates..."
echo ""

# Check for duplicate emails
DUPLICATE_EMAILS=$(echo "$USERS" | jq -r 'group_by(.email) | .[] | select(length > 1) | {email: .[0].email, count: length, ids: [.[].id]}')

if [ -z "$DUPLICATE_EMAILS" ] || [ "$DUPLICATE_EMAILS" == "[]" ]; then
  echo "✅ No duplicate emails found"
else
  echo "⚠️  Found duplicate emails:"
  echo "$DUPLICATE_EMAILS" | jq -r '.[] | "   Email: \(.email) (Count: \(.count))\n   IDs: \(.ids | join(", "))"'
fi

echo ""

# Check for duplicate IDs
DUPLICATE_IDS=$(echo "$USERS" | jq -r 'group_by(.id) | .[] | select(length > 1) | {id: .[0].id, count: length}')

if [ -z "$DUPLICATE_IDS" ] || [ "$DUPLICATE_IDS" == "[]" ]; then
  echo "✅ No duplicate IDs found"
else
  echo "⚠️  Found duplicate IDs:"
  echo "$DUPLICATE_IDS" | jq -r '.[] | "   ID: \(.id) (Count: \(.count))"'
fi

echo ""

# Summary
echo "=========================================="
echo "Summary"
echo "=========================================="
echo "Total users (from pagination): $TOTAL"
echo "Users fetched: $USER_COUNT"
echo "Unique emails: $(echo "$USERS" | jq -r '.[].email' | sort -u | wc -l | tr -d ' ')"
echo "Unique IDs: $(echo "$USERS" | jq -r '.[].id' | sort -u | wc -l | tr -d ' ')"
echo ""

# List all users (first 10)
echo "First 10 users:"
echo "$USERS" | jq -r '.[0:10][] | "   - \(.email) (ID: \(.id), Name: \(.name // "N/A"))"'
echo ""

echo "✅ Done! Check $OUTPUT_FILE for full details."


