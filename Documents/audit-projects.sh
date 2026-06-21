#!/usr/bin/env bash
# IFCDC Project Audit Script
set -uo pipefail

IFCDC_ROOT="/Users/fahrealallah/Development/IFCDC"
REPORT_DIR="$IFCDC_ROOT/Documents"
REPORT_FILE="$REPORT_DIR/DEPENDENCY-REPORT.md"
TIMESTAMP=$(date -u +"%Y-%m-%d %H:%M:%S UTC")

PROJECTS=(
  "Imperial Foundation CDC|$IFCDC_ROOT/Apps/IMPERIAL-FOUNDATION-CDC"
  "CryptoCoin IFCDC|$IFCDC_ROOT/Apps/CRYPTOCOIN-IFCDC/CryptoCoinIFCDC"
  "Swift-Ware|$IFCDC_ROOT/Apps/IFCDC-SWIFT-WARE/Swift-Ware"
  "Tapis|$IFCDC_ROOT/Apps/IFCDC-TAPIS/Tapis-Init"
  "Inclusive Community|$IFCDC_ROOT/Apps/INCLUSIVE-COMMUNITY-IFCDC/InclusiveCommunity"
  "IFCDC Music App|$IFCDC_ROOT/Apps/IFCDC-MUSIC-APP/IFCDC-MUSUC-APP"
  "IFCDC Shared Libraries|$IFCDC_ROOT/Libraries/ifcdc-packages"
)

HEALTHY=()
BROKEN=()
ATTENTION=()

mkdir -p "$REPORT_DIR"

{
  echo "# IFCDC Dependency Report"
  echo ""
  echo "Generated: $TIMESTAMP"
  echo ""
  echo "## Summary"
  echo ""
} > "$REPORT_FILE"

for entry in "${PROJECTS[@]}"; do
  NAME="${entry%%|*}"
  PATH_DIR="${entry##*|}"
  
  echo "=== Auditing: $NAME ==="
  
  {
    echo "---"
    echo ""
    echo "## $NAME"
    echo ""
    echo "**Path:** \`$PATH_DIR\`"
    echo ""
  } >> "$REPORT_FILE"

  if [ ! -d "$PATH_DIR" ]; then
    echo "  MISSING DIRECTORY"
    BROKEN+=("$NAME: directory missing")
    echo "**Status:** BROKEN — directory missing" >> "$REPORT_FILE"
    continue
  fi

  if [ ! -f "$PATH_DIR/package.json" ]; then
    echo "  NO package.json"
    BROKEN+=("$NAME: no package.json")
    echo "**Status:** BROKEN — no package.json" >> "$REPORT_FILE"
    continue
  fi

  # Folder integrity
  INTEGRITY="OK"
  for required in package.json; do
    if [ ! -f "$PATH_DIR/$required" ]; then
      INTEGRITY="MISSING: $required"
    fi
  done
  echo "  Integrity: $INTEGRITY"
  echo "- **Folder integrity:** $INTEGRITY" >> "$REPORT_FILE"

  # Git status
  if [ -d "$PATH_DIR/.git" ]; then
    echo "- **Git:** Initialized" >> "$REPORT_FILE"
  else
    echo "- **Git:** Not initialized" >> "$REPORT_FILE"
    ATTENTION+=("$NAME: no git repo")
  fi

  # README
  if [ -f "$PATH_DIR/README.md" ]; then
    echo "- **README:** Present" >> "$REPORT_FILE"
  else
    echo "- **README:** Missing" >> "$REPORT_FILE"
    ATTENTION+=("$NAME: missing README")
  fi

  # npm install
  echo "  Installing dependencies..."
  cd "$PATH_DIR"
  INSTALL_OUT=$(npm install 2>&1) || true
  if echo "$INSTALL_OUT" | grep -qi "error"; then
    echo "  INSTALL: ERRORS"
    echo "- **npm install:** Errors detected" >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    echo "$INSTALL_OUT" | tail -20 >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    BROKEN+=("$NAME: npm install errors")
  else
    echo "  INSTALL: OK"
    echo "- **npm install:** Success" >> "$REPORT_FILE"
  fi

  # npm audit
  echo "  Running security audit..."
  AUDIT_OUT=$(npm audit --json 2>/dev/null || echo '{"metadata":{"vulnerabilities":{"total":0}}}')
  VULN_TOTAL=$(echo "$AUDIT_OUT" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{const j=JSON.parse(d);console.log(j.metadata?.vulnerabilities?.total??'unknown')}catch{console.log('unknown')}})" 2>/dev/null || echo "unknown")
  echo "- **Security vulnerabilities:** $VULN_TOTAL" >> "$REPORT_FILE"
  if [ "$VULN_TOTAL" != "0" ] && [ "$VULN_TOTAL" != "unknown" ]; then
    ATTENTION+=("$NAME: $VULN_TOTAL security vulnerabilities")
  fi

  # TypeScript check
  echo "  Running type check..."
  if npm run check --if-present 2>/dev/null; then
    echo "  CHECK: OK"
    echo "- **TypeScript check:** Passed" >> "$REPORT_FILE"
  else
    CHECK_OUT=$(npm run check 2>&1 || true)
    if echo "$CHECK_OUT" | grep -qi "error"; then
      echo "  CHECK: ERRORS"
      echo "- **TypeScript check:** Failed" >> "$REPORT_FILE"
      echo '```' >> "$REPORT_FILE"
      echo "$CHECK_OUT" | tail -15 >> "$REPORT_FILE"
      echo '```' >> "$REPORT_FILE"
      ATTENTION+=("$NAME: TypeScript errors")
    else
      echo "- **TypeScript check:** Skipped or passed" >> "$REPORT_FILE"
    fi
  fi

  # Build test
  echo "  Running build..."
  BUILD_OUT=$(npm run build 2>&1 || true)
  if echo "$BUILD_OUT" | grep -qiE "error|failed|ERR!"; then
    echo "  BUILD: FAILED"
    echo "- **Build:** Failed" >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    echo "$BUILD_OUT" | tail -20 >> "$REPORT_FILE"
    echo '```' >> "$REPORT_FILE"
    ATTENTION+=("$NAME: build failed")
  else
    echo "  BUILD: OK"
    echo "- **Build:** Success" >> "$REPORT_FILE"
    HEALTHY+=("$NAME")
  fi

  # Outdated packages
  echo "  Checking outdated packages..."
  OUTDATED=$(npm outdated --json 2>/dev/null || echo "{}")
  OUTDATED_COUNT=$(echo "$OUTDATED" | node -e "let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>{try{console.log(Object.keys(JSON.parse(d)).length)}catch{console.log(0)}})" 2>/dev/null || echo "0")
  echo "- **Outdated packages:** $OUTDATED_COUNT" >> "$REPORT_FILE"

  echo "" >> "$REPORT_FILE"
done

# Summary section
{
  echo "## Healthy Projects"
  echo ""
  if [ ${#HEALTHY[@]} -eq 0 ]; then echo "None yet"; else for p in "${HEALTHY[@]}"; do echo "- $p"; done; fi
  echo ""
  echo "## Projects Requiring Attention"
  echo ""
  if [ ${#ATTENTION[@]} -eq 0 ]; then echo "None"; else for p in "${ATTENTION[@]}"; do echo "- $p"; done; fi
  echo ""
  echo "## Broken Projects"
  echo ""
  if [ ${#BROKEN[@]} -eq 0 ]; then echo "None"; else for p in "${BROKEN[@]}"; do echo "- $p"; done; fi
} >> "$REPORT_FILE"

echo ""
echo "Report written to $REPORT_FILE"
echo "Healthy: ${#HEALTHY[@]}, Attention: ${#ATTENTION[@]}, Broken: ${#BROKEN[@]}"
