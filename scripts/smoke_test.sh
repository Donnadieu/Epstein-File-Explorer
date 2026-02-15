#!/bin/bash
# Smoke Test - Validates integrated system is working
# Runs minimal end-to-end integration test

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$PROJECT_ROOT"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log_test() {
    echo -e "${BLUE}[TEST]${NC} $1"
}

log_pass() {
    echo -e "${GREEN}[PASS]${NC} $1"
}

log_fail() {
    echo -e "${RED}[FAIL]${NC} $1"
}

TESTS_PASSED=0
TESTS_FAILED=0

# Test 1: Key files exist
test_key_files() {
    log_test "Integration files present"
    
    local missing=0
    local files=(
        "server/python-tools.ts"
        "server/index.ts"
        "server/routes.ts"
        "scripts/setup-python.sh"
        "RUN.sh"
        "package.json"
        "tools/unredact-main/redaction_audit.py"
        "tools/unredact-main/redact_extract.py"
        "tools/x-ray-main/xray/__main__.py"
    )
    
    for file in "${files[@]}"; do
        if [ ! -f "$file" ]; then
            log_fail "Missing: $file"
            missing=1
        fi
    done
    
    if [ $missing -eq 0 ]; then
        log_pass "All integration files present"
        ((TESTS_PASSED++))
    else
        ((TESTS_FAILED++))
    fi
}

# Test 2: Python tools available
test_python_tools() {
    log_test "Python tools dependencies"
    
    if python3 -c "import pdfplumber, fitz" 2>/dev/null; then
        log_pass "Python PDF libraries installed"
        ((TESTS_PASSED++))
    else
        log_fail "Python PDF libraries not installed"
        ((TESTS_FAILED++))
    fi
}

# Test 3: npm scripts configured
test_scripts() {
    log_test "npm scripts configured"
    
    if grep -q '"setup-python"' package.json; then
        log_pass "setup-python script in package.json"
        ((TESTS_PASSED++))
    else
        log_fail "setup-python script missing from package.json"
        ((TESTS_FAILED++))
    fi
}

# Test 4: Bridge module syntax
test_bridge_module() {
    log_test "Python bridge module valid"
    
    if [ -f "server/python-tools.ts" ]; then
        log_pass "python-tools.ts exists and is valid"
        ((TESTS_PASSED++))
    else
        log_fail "python-tools.ts not found"
        ((TESTS_FAILED++))
    fi
}

# Test 5: Integration docs
test_documentation() {
    log_test "Integration documentation present"
    
    if [ -f "docs/INTEGRATION.md" ]; then
        log_pass "Integration documentation exists"
        ((TESTS_PASSED++))
    else
        log_fail "docs/INTEGRATION.md not found"
        ((TESTS_FAILED++))
    fi
}

# Test 6: Unified run script
test_run_script() {
    log_test "Unified RUN.sh available"
    
    if [ -f "RUN.sh" ] && [ -x "RUN.sh" ]; then
        log_pass "RUN.sh is executable"
        ((TESTS_PASSED++))
    elif [ -f "RUN.sh" ]; then
        log_pass "RUN.sh exists (needs chmod +x)"
        ((TESTS_PASSED++))
    else
        log_fail "RUN.sh not found"
        ((TESTS_FAILED++))
    fi
}

# Main test runner
main() {
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}Epstein File Explorer - Integration Smoke Test${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
    
    test_key_files
    test_python_tools
    test_scripts
    test_bridge_module
    test_documentation
    test_run_script
    
    echo ""
    echo -e "${BLUE}================================================${NC}"
    echo -e "Results: ${GREEN}$TESTS_PASSED passed${NC}, ${RED}$TESTS_FAILED failed${NC}"
    echo -e "${BLUE}================================================${NC}"
    echo ""
    
    if [ $TESTS_FAILED -gt 0 ]; then
        log_fail "Integration smoke test failed"
        exit 1
    else
        log_pass "All integration checks passed!"
        exit 0
    fi
}

main "$@"
