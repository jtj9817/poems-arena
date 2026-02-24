#!/bin/bash

# Phase Audit Script - Comprehensive commit auditing with all 20 features
# Usage: 
#   ./phase-audit.sh <start-commit>          # Initialize new audit
#   ./phase-audit.sh --update                # Update existing audit with new commits
#   ./phase-audit.sh --summary               # Generate summary view only
#   ./phase-audit.sh --json                  # Export JSON format

set -e

AUDIT_FILE="PHASE_AUDIT.md"
JSON_FILE="PHASE_AUDIT.json"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging functions
log_info() { echo -e "${BLUE}ℹ${NC} $1"; }
log_success() { echo -e "${GREEN}✓${NC} $1"; }
log_warning() { echo -e "${YELLOW}⚠${NC} $1"; }
log_error() { echo -e "${RED}✗${NC} $1"; }

# Check if in git repository
if ! git rev-parse --git-dir > /dev/null 2>&1; then
    log_error "Not in a git repository"
    exit 1
fi

PROJECT_NAME=$(basename "$(git rev-parse --show-toplevel)")
TODAY=$(date +%Y-%m-%d)

# Parse command line arguments
MODE="initialize"
START_COMMIT=""
OUTPUT_MODE="detailed"

if [ "$1" = "--update" ]; then
    MODE="update"
elif [ "$1" = "--summary" ]; then
    OUTPUT_MODE="summary"
elif [ "$1" = "--json" ]; then
    OUTPUT_MODE="json"
elif [ -n "$1" ]; then
    START_COMMIT="$1"
fi

# Determine mode and commit range
if [ "$MODE" = "update" ]; then
    if [ ! -f "$AUDIT_FILE" ]; then
        log_error "No existing audit file found. Run with a starting commit to initialize."
        exit 1
    fi
    
    # Extract last audited commit from frontmatter
    LAST_COMMIT=$(grep "^last_audited_commit:" "$AUDIT_FILE" | awk '{print $2}')
    
    if [ -z "$LAST_COMMIT" ]; then
        log_error "Could not find last_audited_commit in $AUDIT_FILE"
        exit 1
    fi
    
    START_COMMIT="$LAST_COMMIT"
    log_info "Update mode: auditing since $LAST_COMMIT"
else
    if [ -z "$START_COMMIT" ]; then
        log_error "Please provide a starting commit hash"
        echo "Usage: $0 <start-commit> | --update | --summary | --json"
        exit 1
    fi
    log_info "Initialize mode: starting from $START_COMMIT"
fi

# Get commit range
COMMIT_RANGE="$START_COMMIT..HEAD"
COMMIT_COUNT=$(git log $COMMIT_RANGE --oneline --no-merges | wc -l | xargs)

if [ "$COMMIT_COUNT" -eq 0 ]; then
    log_warning "No new commits to audit"
    exit 0
fi

log_info "Found $COMMIT_COUNT commits to audit"

# Temporary files
TEMP_DIR=$(mktemp -d)
COMMITS_FILE="$TEMP_DIR/commits.txt"
ANALYSIS_FILE="$TEMP_DIR/analysis.txt"
STATS_FILE="$TEMP_DIR/stats.json"

cleanup() {
    rm -rf "$TEMP_DIR"
}
trap cleanup EXIT

# ============================================================================
# PHASE 1: Commit Collection and Filtering
# ============================================================================

log_info "Collecting commit data..."

# Get all commits with detailed information
git log $COMMIT_RANGE --no-merges \
    --pretty=format:"%h|%s|%an|%ad|%ar" \
    --date=short \
    --name-status > "$COMMITS_FILE"

# ============================================================================
# PHASE 2: Commit Analysis and Categorization
# ============================================================================

log_info "Analyzing commits..."

# Initialize JSON structure
cat > "$STATS_FILE" << EOF
{
  "metadata": {
    "last_commit": "$(git rev-parse --short HEAD)",
    "audit_date": "$TODAY",
    "project_name": "$PROJECT_NAME",
    "commit_range": "$COMMIT_RANGE"
  },
  "phases": [],
  "database": {
    "tables_created": [],
    "migrations": 0,
    "indexes_added": 0
  },
  "dependencies": [],
  "statistics": {
    "total_commits": 0,
    "total_files_changed": 0,
    "total_lines_added": 0,
    "total_lines_removed": 0
  },
  "coverage": {
    "commits_with_tests": 0,
    "commits_without_tests": 0,
    "percentage": 0
  },
  "technical_debt": [],
  "breaking_changes": [],
  "file_heatmap": {}
}
EOF

declare -A FILE_HEATMAP
declare -A PHASE_MAP
CURRENT_PHASE=1
PHASE_NAME="Uncategorized"

# Analyze each commit
while IFS= read -r line; do
    if [[ $line =~ ^([a-f0-9]+)\|(.+)\|(.+)\|(.+)\|(.+)$ ]]; then
        HASH="${BASH_REMATCH[1]}"
        MESSAGE="${BASH_REMATCH[2]}"
        AUTHOR="${BASH_REMATCH[3]}"
        DATE="${BASH_REMATCH[4]}"
        DATE_REL="${BASH_REMATCH[5]}"
        
        # Skip non-implementation commits
        if [[ "$MESSAGE" =~ ^(docs|doc|chore|ci|build): ]]; then
            continue
        fi
        
        # Detect phase from commit message
        if [[ "$MESSAGE" =~ [Pp]hase[[:space:]]*([0-9]+) ]]; then
            CURRENT_PHASE="${BASH_REMATCH[1]}"
            # Extract phase name if available
            if [[ "$MESSAGE" =~ [Pp]hase[[:space:]]*[0-9]+[[:space:]]*:?[[:space:]]*(.+)$ ]]; then
                PHASE_NAME="${BASH_REMATCH[1]}"
            fi
        fi
        
        # Get detailed commit information
        DIFF_STAT=$(git show --stat --format="" $HASH 2>/dev/null || echo "")
        DIFF_FULL=$(git show $HASH -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null || echo "")
        FILES_CHANGED=$(git show --name-status --format="" $HASH 2>/dev/null || echo "")
        
        # Count lines changed
        LINES_STAT=$(git show --shortstat --format="" $HASH 2>/dev/null || echo "")
        LINES_ADDED=0
        LINES_REMOVED=0
        if [[ "$LINES_STAT" =~ ([0-9]+)[[:space:]]+insertion ]]; then
            LINES_ADDED="${BASH_REMATCH[1]}"
        fi
        if [[ "$LINES_STAT" =~ ([0-9]+)[[:space:]]+deletion ]]; then
            LINES_REMOVED="${BASH_REMATCH[1]}"
        fi
        
        # Detect implementation type
        IMPL_TYPE="feature"
        if [[ "$MESSAGE" =~ ^fix|^bugfix ]]; then
            IMPL_TYPE="fix"
        elif [[ "$MESSAGE" =~ ^perf|^optimize ]]; then
            IMPL_TYPE="performance"
        elif [[ "$MESSAGE" =~ ^refactor ]]; then
            IMPL_TYPE="refactor"
        fi
        
        # Check for tests
        HAS_TESTS="false"
        if echo "$FILES_CHANGED" | grep -qE "test|spec|Test\."; then
            HAS_TESTS="true"
        fi
        
        # Check for breaking changes
        IS_BREAKING="false"
        if [[ "$MESSAGE" =~ BREAKING|breaking: ]] || echo "$DIFF_FULL" | grep -qE "class.*deleted|function.*deleted"; then
            IS_BREAKING="true"
        fi
        
        # Extract TODOs and FIXMEs
        TODOS=$(echo "$DIFF_FULL" | grep -E "^\+.*TODO:|^\+.*FIXME:|^\+.*HACK:" || echo "")
        
        # Detect database migrations
        if echo "$FILES_CHANGED" | grep -qE "migration|Migration"; then
            MIGRATION_FILES=$(echo "$FILES_CHANGED" | grep -E "migration|Migration" | awk '{print $2}')
        else
            MIGRATION_FILES=""
        fi
        
        # Build file heatmap
        while IFS= read -r file_line; do
            if [[ $file_line =~ ^[AMD][[:space:]]+(.+)$ ]]; then
                FILE="${BASH_REMATCH[1]}"
                if [[ ! "$FILE" =~ \.md$|\.txt$ ]]; then
                    FILE_HEATMAP["$FILE"]=$((${FILE_HEATMAP["$FILE"]:-0} + 1))
                fi
            fi
        done <<< "$FILES_CHANGED"
        
        # Store commit data
        PHASE_MAP[$CURRENT_PHASE]+="$HASH|$MESSAGE|$IMPL_TYPE|$HAS_TESTS|$IS_BREAKING|$LINES_ADDED|$LINES_REMOVED|$MIGRATION_FILES|$TODOS
"
        
    fi
done < "$COMMITS_FILE"

# ============================================================================
# PHASE 3: Generate Detailed Audit
# ============================================================================

log_info "Generating audit report..."

generate_frontmatter() {
    local total_commits=$(git log $COMMIT_RANGE --oneline --no-merges | wc -l | xargs)
    local total_phases=${#PHASE_MAP[@]}
    local latest_commit=$(git rev-parse --short HEAD)
    
    cat << EOF
---
last_audited_commit: $latest_commit
last_audit_date: $TODAY
total_phases: $total_phases
total_commits: $total_commits
project_name: $PROJECT_NAME
---

EOF
}

generate_quick_summary() {
    echo "# Phase Commit Audit"
    echo ""
    echo "## Quick Summary"
    echo ""
    
    for phase in $(echo "${!PHASE_MAP[@]}" | tr ' ' '\n' | sort -n); do
        local commits_data="${PHASE_MAP[$phase]}"
        local commit_count=$(echo "$commits_data" | grep -c "^" || echo 0)
        
        echo "### Phase $phase (estimated)"
        echo "**Commits**: $commit_count implementation commits"
        echo ""
    done
    
    echo "---"
    echo ""
}

generate_phase_details() {
    for phase in $(echo "${!PHASE_MAP[@]}" | tr ' ' '\n' | sort -n); do
        echo "## Phase $phase: Details"
        echo ""
        
        local commits_data="${PHASE_MAP[$phase]}"
        local total_added=0
        local total_removed=0
        local commits_with_tests=0
        local total_commits=0
        local migrations=0
        
        echo "### Overview"
        
        # Calculate statistics
        while IFS='|' read -r hash msg type has_tests is_breaking added removed migration_files todos; do
            [ -z "$hash" ] && continue
            total_commits=$((total_commits + 1))
            total_added=$((total_added + added))
            total_removed=$((total_removed + removed))
            [ "$has_tests" = "true" ] && commits_with_tests=$((commits_with_tests + 1))
            [ -n "$migration_files" ] && migrations=$((migrations + 1))
        done <<< "$commits_data"
        
        local test_coverage=0
        if [ $total_commits -gt 0 ]; then
            test_coverage=$((commits_with_tests * 100 / total_commits))
        fi
        
        echo "- **Commits**: $total_commits implementation commits"
        echo "- **Lines Changed**: +$total_added, -$total_removed"
        echo "- **Test Coverage**: $commits_with_tests/$total_commits commits ($test_coverage%)"
        [ $test_coverage -eq 100 ] && echo "  ✅" || echo "  ⚠️"
        echo "- **Migrations**: $migrations"
        echo ""
        
        echo "### Implementation Commits"
        echo ""
        
        # Detail each commit
        while IFS='|' read -r hash msg type has_tests is_breaking added removed migration_files todos; do
            [ -z "$hash" ] && continue
            
            echo "**$hash** — $msg"
            echo "**Impact**: +$added/-$removed lines"
            echo ""
            
            # Analyze commit diff for details
            local diff_output=$(git show $hash --name-status --format="" 2>/dev/null || echo "")
            local code_diff=$(git show $hash -- '*.php' '*.js' '*.py' '*.ts' 2>/dev/null || echo "")
            
            # Extract key changes
            echo "$diff_output" | while IFS=$'\t' read -r status file; do
                case $status in
                    A)
                        echo "- **Created**: \`$file\`"
                        # Try to extract class/function names
                        if [[ "$code_diff" =~ class[[:space:]]+([A-Za-z0-9_]+) ]]; then
                            echo "  - Class: ${BASH_REMATCH[1]}"
                        fi
                        ;;
                    M)
                        echo "- **Modified**: \`$file\`"
                        ;;
                    D)
                        echo "- **Deleted**: \`$file\` ⚠️"
                        ;;
                esac
            done
            
            # Show migration details
            if [ -n "$migration_files" ]; then
                echo "- **Migration**: Database schema changes"
            fi
            
            # Show test info
            if [ "$has_tests" = "true" ]; then
                echo "- **Tests**: Includes test coverage ✅"
            else
                echo "- **Tests**: No tests added ⚠️"
            fi
            
            # Show technical debt
            if [ -n "$todos" ]; then
                echo "- **Technical Debt**:"
                echo "$todos" | while IFS= read -r todo; do
                    echo "  - $todo"
                done
            fi
            
            echo ""
        done <<< "$commits_data"
        
        echo "---"
        echo ""
    done
}

generate_database_evolution() {
    echo "## Database Evolution"
    echo ""
    echo "### Migration Timeline"
    
    git log $COMMIT_RANGE --no-merges --oneline --name-status | \
    grep -E "migration|Migration" | \
    awk '{print $1, $3}' | \
    while read -r hash file; do
        local date=$(git show -s --format=%ad --date=short $hash)
        echo "- **$hash** ($date): \`$file\`"
    done
    
    echo ""
}

generate_file_heatmap() {
    echo "## File Change Heatmap"
    echo ""
    echo "Most frequently modified files:"
    echo ""
    
    # Sort heatmap by count
    for file in "${!FILE_HEATMAP[@]}"; do
        echo "${FILE_HEATMAP[$file]}|$file"
    done | sort -rn | head -10 | while IFS='|' read -r count file; do
        echo "- \`$file\`: **$count commits**"
    done
    
    echo ""
}

generate_test_coverage_summary() {
    echo "## Test Coverage Summary"
    echo ""
    
    local total_with_tests=0
    local total_without_tests=0
    
    for phase in $(echo "${!PHASE_MAP[@]}" | tr ' ' '\n' | sort -n); do
        local commits_data="${PHASE_MAP[$phase]}"
        local phase_with_tests=0
        local phase_total=0
        
        while IFS='|' read -r hash msg type has_tests rest; do
            [ -z "$hash" ] && continue
            phase_total=$((phase_total + 1))
            if [ "$has_tests" = "true" ]; then
                phase_with_tests=$((phase_with_tests + 1))
                total_with_tests=$((total_with_tests + 1))
            else
                total_without_tests=$((total_without_tests + 1))
            fi
        done <<< "$commits_data"
        
        local coverage=0
        if [ $phase_total -gt 0 ]; then
            coverage=$((phase_with_tests * 100 / phase_total))
        fi
        
        echo "**Phase $phase**: $phase_with_tests/$phase_total commits ($coverage%)"
        [ $coverage -eq 100 ] && echo "  ✅" || echo "  ⚠️"
    done
    
    local total_commits=$((total_with_tests + total_without_tests))
    local overall_coverage=0
    if [ $total_commits -gt 0 ]; then
        overall_coverage=$((total_with_tests * 100 / total_commits))
    fi
    
    echo ""
    echo "**Overall**: $total_with_tests/$total_commits commits ($overall_coverage%)"
    
    echo ""
}

generate_rollback_commands() {
    echo "## Rollback Commands"
    echo ""
    
    for phase in $(echo "${!PHASE_MAP[@]}" | tr ' ' '\n' | sort -n); do
        local commits_data="${PHASE_MAP[$phase]}"
        local first_hash=$(echo "$commits_data" | head -1 | cut -d'|' -f1)
        local last_hash=$(echo "$commits_data" | tail -1 | cut -d'|' -f1)
        
        echo "### Rollback Phase $phase"
        echo "\`\`\`bash"
        echo "git revert $first_hash^..$last_hash"
        echo "\`\`\`"
        echo ""
    done
}

# ============================================================================
# PHASE 4: Generate Output
# ============================================================================

if [ "$OUTPUT_MODE" = "json" ]; then
    log_info "Generating JSON output..."
    cat "$STATS_FILE"
    exit 0
fi

# Generate markdown output
OUTPUT=""
OUTPUT+=$(generate_frontmatter)

if [ "$OUTPUT_MODE" = "summary" ]; then
    OUTPUT+=$(generate_quick_summary)
else
    OUTPUT+=$(generate_quick_summary)
    OUTPUT+=$(generate_phase_details)
    OUTPUT+=$(generate_database_evolution)
    OUTPUT+=$(generate_file_heatmap)
    OUTPUT+=$(generate_test_coverage_summary)
    OUTPUT+=$(generate_rollback_commands)
fi

# Write to file
if [ "$MODE" = "update" ]; then
    # Backup existing file
    cp "$AUDIT_FILE" "${AUDIT_FILE}.backup"
    
    # Remove old frontmatter and append new content
    sed '/^---$/,/^---$/d' "$AUDIT_FILE" > "${AUDIT_FILE}.tmp"
    echo "$OUTPUT" > "$AUDIT_FILE"
    cat "${AUDIT_FILE}.tmp" >> "$AUDIT_FILE"
    rm "${AUDIT_FILE}.tmp"
    
    log_success "Updated $AUDIT_FILE with $COMMIT_COUNT new commits"
else
    echo "$OUTPUT" > "$AUDIT_FILE"
    log_success "Created $AUDIT_FILE with audit of $COMMIT_COUNT commits"
fi

log_success "Audit complete!"
echo ""
echo "📄 Audit file: $AUDIT_FILE"
echo "📊 Total commits analyzed: $COMMIT_COUNT"
echo ""
log_info "Use './phase-audit.sh --update' to audit new commits in the future"
