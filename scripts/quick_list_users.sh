#!/bin/bash

# Quick one-liner to list all users with duplicate check
EMAIL="newadmin@test.com"
PASSWORD="admin123"
API_BASE_URL="http://localhost:5001/api"

TOKEN=$(curl -s -X POST "${API_BASE_URL}/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${EMAIL}\",\"password\":\"${PASSWORD}\"}" | \
  jq -r '.data.token // .token')

curl -s -X GET "${API_BASE_URL}/admin/users?page=1&limit=1000&role=client" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" | \
  jq '{
    total: .data.pagination.total,
    users_fetched: (.data.users | length),
    duplicate_emails: [.data.users | group_by(.email) | .[] | select(length > 1) | {email: .[0].email, count: length, ids: [.[].id]}] | if length > 0 then . else "None" end,
    duplicate_ids: [.data.users | group_by(.id) | .[] | select(length > 1) | {id: .[0].id, count: length}] | if length > 0 then . else "None" end
  }'


