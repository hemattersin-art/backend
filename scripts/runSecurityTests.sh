#!/bin/bash

# Security Test Execution Script
# Runs comprehensive security tests against the API

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

echo -e "${CYAN}============================================================${NC}"
echo -e "${CYAN}Security Test Suite Execution${NC}"
echo -e "${CYAN}============================================================${NC}\n"

# Check if backend URL is set
if [ -z "$BACKEND_URL" ]; then
    echo -e "${YELLOW}Warning: BACKEND_URL not set, using default: http://localhost:5001${NC}"
    export BACKEND_URL="http://localhost:5001"
fi

# Check if Node.js is available
if ! command -v node &> /dev/null; then
    echo -e "${RED}Error: Node.js is not installed${NC}"
    exit 1
fi

# Check if axios is installed
if ! node -e "require('axios')" 2>/dev/null; then
    echo -e "${YELLOW}Installing axios...${NC}"
    npm install axios --no-save
fi

echo -e "${BLUE}Running security test suite...${NC}\n"

# Run the test suite
node backend/scripts/securityTestSuite.js

TEST_EXIT_CODE=$?

if [ $TEST_EXIT_CODE -eq 0 ]; then
    echo -e "\n${GREEN}✓ All automated tests passed${NC}"
else
    echo -e "\n${RED}✗ Some tests failed${NC}"
    echo -e "${YELLOW}Review the output above for details${NC}"
fi

echo -e "\n${CYAN}============================================================${NC}"
echo -e "${CYAN}Note: Some tests require manual execution${NC}"
echo -e "${CYAN}See SECURITY_TEST_MATRIX.md for full test scenarios${NC}"
echo -e "${CYAN}============================================================${NC}\n"

exit $TEST_EXIT_CODE

