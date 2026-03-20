#!/usr/bin/env bash
# =============================================================================
# LORCANA SIM — SETUP SCRIPT
# Run this once after cloning the repo.
# Usage: ./setup.sh
# =============================================================================

set -e  # Exit immediately on any error

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

log()    { echo -e "${GREEN}✓${NC} $1"; }
warn()   { echo -e "${YELLOW}⚠${NC}  $1"; }
error()  { echo -e "${RED}✗${NC} $1"; exit 1; }
header() { echo -e "\n${YELLOW}▶ $1${NC}"; }

# -----------------------------------------------------------------------------
# 1. Check Node.js
# -----------------------------------------------------------------------------
header "Checking Node.js"

if ! command -v node &> /dev/null; then
  error "Node.js is not installed. Please install Node.js >= 20 from https://nodejs.org and re-run this script."
fi

NODE_VERSION=$(node -e "process.exit(parseInt(process.version.slice(1)) < 20 ? 1 : 0)" 2>/dev/null && echo "ok" || echo "old")
if [ "$NODE_VERSION" = "old" ]; then
  error "Node.js >= 20 is required. You have $(node --version). Please upgrade from https://nodejs.org"
fi

log "Node.js $(node --version) found"

# -----------------------------------------------------------------------------
# 2. Install pnpm if missing
# -----------------------------------------------------------------------------
header "Checking pnpm"

if ! command -v pnpm &> /dev/null; then
  warn "pnpm not found — installing globally via npm..."
  npm install -g pnpm
  log "pnpm installed: $(pnpm --version)"
else
  log "pnpm $(pnpm --version) found"
fi

# -----------------------------------------------------------------------------
# 3. Install dependencies
# -----------------------------------------------------------------------------
header "Installing dependencies"

pnpm install
log "All packages installed into node_modules (local to this repo)"

# -----------------------------------------------------------------------------
# 4. Run engine tests
# -----------------------------------------------------------------------------
header "Running engine tests"

pnpm test

log "All tests passed"

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Setup complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Start the dev server:   pnpm dev"
echo "  Run tests:               pnpm test"
echo "  Run tests (watch mode):  pnpm test:watch"
echo "  Type-check everything:   pnpm typecheck"
echo ""
