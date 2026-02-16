#!/bin/bash
# Unified Project Launcher
# Single entrypoint to set up and run the complete integrated system:
# - Node.js/TypeScript backend (Express server)
# - React frontend (Vite dev server / production static)
# - Python tools (PDF analysis: redaction audit, x-ray detection, text extraction)
#
# Usage:
#   ./RUN.sh dev         - Start development environment
#   ./RUN.sh build       - Build for production
#   ./RUN.sh start       - Start production build
#   ./RUN.sh check       - Run TypeScript check

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

# Color output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

log_section() {
    echo -e "${BLUE}================================================${NC}"
    echo -e "${BLUE}$1${NC}"
    echo -e "${BLUE}================================================${NC}"
}

log_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

log_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

log_error() {
    echo -e "${RED}✗ $1${NC}"
}

# Verify environment prerequisites
check_prerequisites() {
    log_section "Checking Prerequisites"
    
    local missing=0
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        log_error "Node.js not found"
        missing=1
    else
        NODE_VERSION=$(node --version)
        log_success "Node.js $NODE_VERSION"
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        log_error "npm not found"
        missing=1
    else
        NPM_VERSION=$(npm --version)
        log_success "npm $NPM_VERSION"
    fi
    
    # Check Python
    if ! command -v python3 &> /dev/null; then
        log_error "Python 3 not found"
        missing=1
    else
        PYTHON_VERSION=$(python3 --version)
        log_success "$PYTHON_VERSION"
    fi
    
    # Check Docker (for development database)
    if ! command -v docker &> /dev/null; then
        log_warning "Docker not found - development database will not be available"
        log_warning "Install Docker to run: docker compose up -d"
    else
        DOCKER_VERSION=$(docker --version)
        log_success "$DOCKER_VERSION"
    fi
    
    if [ $missing -eq 1 ]; then
        log_error "Missing prerequisites. Please install Node.js 20+ and Python 3.12+"
        exit 1
    fi
    
    # Make scripts executable
    chmod +x scripts/setup-python.sh scripts/smoke_test.sh 2>/dev/null || true
}

# Start database with Docker Compose
setup_database() {
    log_section "Setting up Database"
    
    # Check if DATABASE_URL is already set
    if [ -n "$DATABASE_URL" ]; then
        log_success "Using existing DATABASE_URL"
        return
    fi
    
    # Try to use Docker Compose
    if command -v docker &> /dev/null && (command -v docker-compose &> /dev/null || command -v docker compose &> /dev/null); then
        echo "Starting PostgreSQL container..."
        docker compose up -d postgres
        
        # Wait for database to be ready
        echo "Waiting for database to be ready..."
        local max_attempts=30
        local attempt=0
        while [ $attempt -lt $max_attempts ]; do
            if docker compose exec -T postgres pg_isready -U epstein &> /dev/null; then
                log_success "Database is ready"
                export DATABASE_URL="postgresql://epstein:password@localhost:5432/epstein_db"
                return
            fi
            attempt=$((attempt + 1))
            sleep 1
        done
        
        log_error "Database failed to start within 30 seconds"
        log_error "Check logs with: docker compose logs postgres"
        exit 1
    fi
    
    # Try to load from .env.local
    if [ -f ".env.local" ]; then
        log_success "Loading DATABASE_URL from .env.local"
        export $(cat .env.local | grep -v '#' | xargs)
        return
    fi
    
    # Check if PostgreSQL is installed locally
    if command -v psql &> /dev/null; then
        log_warning "PostgreSQL found but no DATABASE_URL set"
        log_warning "Please provide DATABASE_URL environment variable or create .env.local"
        exit 1
    fi
    
    # No database available
    log_error "No database available"
    echo ""
    echo -e "${YELLOW}To fix this, choose one option:${NC}"
    echo ""
    echo "  Option 1: Install Docker (RECOMMENDED)"
    echo "    Install from: https://docs.docker.com/get-docker/"
    echo "    Then run: $0 dev"
    echo ""
    echo "  Option 2: Use existing PostgreSQL"
    echo "    Set environment variable: export DATABASE_URL='postgresql://user:pass@localhost:5432/dbname'"
    echo "    Then run: $0 dev"
    echo ""
    echo "  Option 3: Create .env.local file"
    echo "    Create .env.local with: DATABASE_URL=postgresql://user:pass@localhost:5432/dbname"
    echo "    Then run: $0 dev"
    echo ""
    exit 1
}

# Install Node dependencies
setup_node() {
    log_section "Setting up Node.js Environment"
    
    if [ -d "node_modules" ]; then
        log_success "Node modules already installed (skipping npm install)"
        return
    fi
    
    echo "Running npm install..."
    npm install
    log_success "Node dependencies installed"
}

# Install Python dependencies
setup_python() {
    log_section "Setting up Python Tools"
    
    echo "Executing Python setup script..."
    bash scripts/setup-python.sh
    log_success "Python tools installed"
}

# Verify type safety
typecheck() {
    log_section "TypeScript Type Check"
    npm run check
    log_success "Type check passed"
}

# Show usage
show_usage() {
    echo -e "${BLUE}Usage: $0 {dev|build|start|check|help}${NC}"
    echo ""
    echo "Commands:"
    echo "  dev              - Start development server (watch mode)"
    echo "  build            - Production build"
    echo "  start            - Run production build"
    echo "  check            - TypeScript type check only"
    echo "  help             - Show this message"
    echo ""
}

# Main entry point
main() {
    local cmd="${1:-help}"
    
    case "$cmd" in
        dev)
            check_prerequisites
            setup_database
            setup_node
            setup_python
            log_section "Starting Development Server"
            echo -e "${BLUE}Backend: http://localhost:5000${NC}"
            echo -e "${BLUE}Frontend wired via Vite dev server${NC}"
            echo -e "${BLUE}Python tools: File system API at /api/tools/*${NC}"
            echo -e "${BLUE}Database: ${DATABASE_URL}${NC}"
            echo ""
            # Load environment from .env.local if not already set
            if [ -f ".env.local" ] && [ -z "$DATABASE_URL" ]; then
                # Safely load environment variables
                if [ -f .env.local ]; then
                  set -a
                  source <(grep -v '^#' .env.local | grep -v '^$')
                  set +a
                fi
            fi
            npm run dev
            ;;
        
        build)
            check_prerequisites
            setup_node
            setup_python
            typecheck
            log_section "Building for Production"
            npm run build
            log_success "Build complete"
            echo ""
            echo "Next step: $0 start"
            ;;
        
        start)
            log_section "Starting Production Server"
            log_warning "Ensure 'npm run build' was completed first"
            echo ""
            npm run start
            ;;
        
        check)
            log_section "Type Checking"
            typecheck
            ;;
        
        *)
            show_usage
            ;;
    esac
}

main "$@"
