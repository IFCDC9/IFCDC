#!/usr/bin/env bash
# Deploy Mission Control Phase 10 + housing crash fix to GitHub + verify Render.
# Run from: Apps/IMPERIAL-FOUNDATION-CDC
set -euo pipefail

cd "$(dirname "$0")/.."
BASE="${IFCDC_BASE_URL:-https://ifcdc-hq-wst6.onrender.com}"
TARGET="$(git rev-parse --short HEAD)"

echo ""
echo "══════════════════════════════════════════════════════"
echo "  IFCDC — Deploy Mission Control (local → GitHub → Render)"
echo "══════════════════════════════════════════════════════"
echo ""
echo "Local HEAD:  $TARGET"
echo "GitHub main: $(git ls-remote origin refs/heads/main | awk '{print substr($1,1,7)}' || echo '?')"
echo ""

AHEAD="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [[ "$AHEAD" -eq 0 ]]; then
  echo "✓ Local is in sync with origin/main"
else
  echo "⚠ $AHEAD commits NOT on GitHub — Mission Control is in these commits"
  echo ""
  echo "Pushing to GitHub..."
  git push origin main
  echo ""
  echo "✓ Push complete. GitHub main: $(git ls-remote origin refs/heads/main | awk '{print substr($1,1,7)}')"
fi

echo ""
echo "── Next: Render Dashboard ──"
echo "1. ifcdc-hq → Clear build cache"
echo "2. Manual Deploy → commit $TARGET"
echo "3. Build: npm ci --include=dev && node script/render-build.mjs"
echo ""
echo "Waiting for Render (up to 30 min)..."
export IFCDC_BASE_URL="$BASE"
export IFCDC_EXPECT_COMMIT="$TARGET"
node script/deploy-wait-verify.mjs
