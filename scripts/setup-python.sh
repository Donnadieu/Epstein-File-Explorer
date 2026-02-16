#!/bin/bash
# Python Tools Environment Setup
# Installs dependencies for unredact and x-ray tools

set -e

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TOOLS_DIR="$PROJECT_ROOT/tools"
UNREDACT_DIR="$TOOLS_DIR/unredact-main"
XRAY_DIR="$TOOLS_DIR/x-ray-main"

echo "================================================"
echo "Python Tools Setup"
echo "================================================"

# Check Python
echo "Checking Python installation..."
if ! command -v python3 &> /dev/null; then
    echo "ERROR: Python 3 not found. Install Python 3.10+ and ensure it's in PATH."
    exit 1
fi

PYTHON_VERSION=$(python3 --version)
echo "Found: $PYTHON_VERSION"

# Install unredact dependencies
echo ""
echo "Installing unredact-main dependencies..."
pip install -q pdfplumber pymupdf pikepdf --user 2>/dev/null || pip install -q pdfplumber pymupdf pikepdf
echo "✓ unredact-main dependencies installed"

# Install x-ray dependencies (just the deps, not the package)
echo ""
echo "Installing x-ray-main dependencies..."
pip install -q 'PyMuPDF==1.24.14' 'requests>=2.26.0' --user 2>/dev/null || pip install -q 'PyMuPDF==1.24.14' 'requests>=2.26.0'
echo "✓ x-ray-main dependencies installed"

# Add tools to PYTHONPATH so they can be imported
export PYTHONPATH="$XRAY_DIR:$PYTHONPATH"

# Verify installations
echo ""
echo "Verifying installations..."

if python3 -c "import pdfplumber, fitz" 2>/dev/null; then
    echo "✓ unredact dependencies verified"
else
    echo "⚠ Could not verify unredact dependencies"
fi

if python3 -c "import sys; sys.path.insert(0, '$XRAY_DIR'); import xray; print('OK')" 2>/dev/null; then
    echo "✓ x-ray-main module verified"
else
    echo "⚠ Could not verify x-ray-main"
fi

echo ""
echo "================================================"
echo "Python tools ready!"
echo "================================================"
echo ""
echo "Note: Add PYTHONPATH export to your shell config:"
echo "  export PYTHONPATH=\"$XRAY_DIR:\$PYTHONPATH\""
