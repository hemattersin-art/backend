#!/bin/bash

# Simple curl command to list all users
# First, login and get token, then fetch users

# Replace with your admin credentials
EMAIL="admin@example.com"
PASSWORD="your_password"
API_BASE_URL="http://localhost:5001/api"

echo "Step 1: Logging in..."
TOKEN=$(curl -s -X POST "${API_BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" | \
  jq -r '.data.token // .token')

if [ "$TOKEN" == "null" ] || [ -z "$TOKEN" ]; then
  echo "❌ Failed to get token"
  exit 1
fi

echo "✅ Token obtained"
echo ""
echo "Step 2: Fetching all users (with high limit)..."
echo ""

# Fetch all users with a high limit
curl -X GET "${API_BASE_URL}/admin/users?page=1&limit=1000&role=client" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | \
  jq '{
    total: .data.pagination.total,
    users_count: (.data.users | length),
    users: .data.users | map({
      id: .id,
      email: .email,
      name: .name,
      role: .role,
      created_at: .created_at
    }),
    duplicate_emails: [.data.users | group_by(.email) | .[] | select(length > 1) | {email: .[0].email, count: length, ids: [.[].id]}] | .[],
    duplicate_ids: [.data.users | group_by(.id) | .[] | select(length > 1) | {id: .[0].id, count: length}] | .[]
  }'


