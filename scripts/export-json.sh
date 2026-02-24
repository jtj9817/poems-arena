#!/bin/bash

# JSON Export Generator
# Exports commit audit data in structured JSON format for AI processing

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <start-commit> [output-file]"
    exit 1
fi

START_COMMIT="$1"
OUTPUT_FILE="${2:-PHASE_AUDIT.json}"
COMMIT_RANGE="$START_COMMIT..HEAD"

# Start JSON structure
cat > "$OUTPUT_FILE" << 'EOF'
{
  "metadata": {
EOF

# Add metadata
echo "    \"last_commit\": \"$(git rev-parse --short HEAD)\"," >> "$OUTPUT_FILE"
echo "    \"full_hash\": \"$(git rev-parse HEAD)\"," >> "$OUTPUT_FILE"
echo "    \"audit_date\": \"$(date -I)\"," >> "$OUTPUT_FILE"
echo "    \"audit_timestamp\": \"$(date -Iseconds)\"," >> "$OUTPUT_FILE"
echo "    \"project_name\": \"$(basename "$(git rev-parse --show-toplevel)")\"," >> "$OUTPUT_FILE"
echo "    \"commit_range\": \"$COMMIT_RANGE\"," >> "$OUTPUT_FILE"
echo "    \"total_commits\": $(git log $COMMIT_RANGE --oneline --no-merges | wc -l)" >> "$OUTPUT_FILE"

cat >> "$OUTPUT_FILE" << 'EOF'
  },
  "phases": [
EOF

# Analyze commits and group by phase
declare -A PHASE_DATA
CURRENT_PHASE=1

# First pass: collect all commit data
git log $COMMIT_RANGE --no-merges --reverse --pretty=format:"%H|%h|%s|%an|%ae|%ad|%ar" --date=iso-strict | while IFS='|' read -r full_hash short_hash message author email date date_rel; do
    
    # Detect phase
    if [[ "$message" =~ [Pp]hase[[:space:]]*([0-9]+) ]]; then
        CURRENT_PHASE="${BASH_REMATCH[1]}"
    fi
    
    # Skip non-implementation commits
    if [[ "$message" =~ ^(docs|doc|chore|ci|build): ]]; then
        continue
    fi
    
    # Get file changes
    FILES_CHANGED=$(git show --name-status --format="" $short_hash 2>/dev/null | wc -l)
    
    # Get line stats
    LINES_STAT=$(git show --shortstat --format="" $short_hash 2>/dev/null || echo "0 insertions(+), 0 deletions(-)")
    LINES_ADDED=0
    LINES_REMOVED=0
    if [[ "$LINES_STAT" =~ ([0-9]+)[[:space:]]+insertion ]]; then
        LINES_ADDED="${BASH_REMATCH[1]}"
    fi
    if [[ "$LINES_STAT" =~ ([0-9]+)[[:space:]]+deletion ]]; then
        LINES_REMOVED="${BASH_REMATCH[1]}"
    fi
    
    # Detect features
    HAS_TESTS=false
    IS_BREAKING=false
    IS_MIGRATION=false
    HAS_TECH_DEBT=false
    
    FILES=$(git show --name-only --format="" $short_hash 2>/dev/null)
    CODE_DIFF=$(git show $short_hash -- '*.php' '*.js' '*.py' '*.ts' 2>/dev/null || echo "")
    
    if echo "$FILES" | grep -qE "test|spec|Test"; then
        HAS_TESTS=true
    fi
    
    if [[ "$message" =~ BREAKING ]] || echo "$CODE_DIFF" | grep -qE "^-.*public function |^-class "; then
        IS_BREAKING=true
    fi
    
    if echo "$FILES" | grep -qE "migration"; then
        IS_MIGRATION=true
    fi
    
    if echo "$CODE_DIFF" | grep -qE "TODO:|FIXME:|HACK:"; then
        HAS_TECH_DEBT=true
    fi
    
    # Extract file list with status
    FILES_JSON="["
    FIRST=true
    while IFS=$'\t' read -r status file; do
        [ -z "$file" ] && continue
        [ "$FIRST" = false ] && FILES_JSON+=","
        FILES_JSON+="{\"status\":\"$status\",\"path\":\"$file\"}"
        FIRST=false
    done < <(git show --name-status --format="" $short_hash 2>/dev/null)
    FILES_JSON+="]"
    
    # Build commit JSON
    COMMIT_JSON=$(cat <<COMMIT_EOF
    {
      "hash": "$short_hash",
      "full_hash": "$full_hash",
      "message": $(echo "$message" | jq -R .),
      "author": {
        "name": $(echo "$author" | jq -R .),
        "email": "$email"
      },
      "date": "$date",
      "date_relative": "$date_rel",
      "stats": {
        "files_changed": $FILES_CHANGED,
        "lines_added": $LINES_ADDED,
        "lines_removed": $LINES_REMOVED
      },
      "flags": {
        "has_tests": $HAS_TESTS,
        "is_breaking": $IS_BREAKING,
        "is_migration": $IS_MIGRATION,
        "has_tech_debt": $HAS_TECH_DEBT
      },
      "files": $FILES_JSON
    }
COMMIT_EOF
)
    
    # Store in phase data (append to temp file)
    echo "$CURRENT_PHASE|$COMMIT_JSON" >> /tmp/phase_commits.json
done

# Build phases array
PHASE_NUMS=$(cut -d'|' -f1 /tmp/phase_commits.json | sort -n | uniq)
FIRST_PHASE=true

for PHASE in $PHASE_NUMS; do
    [ "$FIRST_PHASE" = false ] && echo "," >> "$OUTPUT_FILE"
    
    # Start phase object
    cat >> "$OUTPUT_FILE" << EOF
    {
      "phase": $PHASE,
      "commits": [
EOF
    
    # Add commits for this phase
    FIRST_COMMIT=true
    grep "^$PHASE|" /tmp/phase_commits.json | cut -d'|' -f2- | while read -r commit_json; do
        [ "$FIRST_COMMIT" = false ] && echo "," >> "$OUTPUT_FILE"
        echo "        $commit_json" >> "$OUTPUT_FILE"
        FIRST_COMMIT=false
    done
    
    # Calculate phase statistics
    PHASE_COMMITS=$(grep -c "^$PHASE|" /tmp/phase_commits.json || echo 0)
    
    cat >> "$OUTPUT_FILE" << EOF
      ],
      "statistics": {
        "commit_count": $PHASE_COMMITS
      }
    }
EOF
    
    FIRST_PHASE=false
done

# Close phases array
cat >> "$OUTPUT_FILE" << 'EOF'
  ],
  "statistics": {
    "total_phases": 0,
    "total_files_changed": 0,
    "total_lines_added": 0,
    "total_lines_removed": 0,
    "commits_with_tests": 0,
    "commits_with_breaking_changes": 0,
    "commits_with_migrations": 0,
    "commits_with_tech_debt": 0
  },
  "file_heatmap": {},
  "database": {
    "migrations": [],
    "total_migrations": 0
  }
}
EOF

# Cleanup temp file
rm -f /tmp/phase_commits.json

# Pretty print the JSON
if command -v jq &> /dev/null; then
    jq '.' "$OUTPUT_FILE" > "${OUTPUT_FILE}.tmp"
    mv "${OUTPUT_FILE}.tmp" "$OUTPUT_FILE"
fi

echo "✅ JSON export created: $OUTPUT_FILE"

# Display summary
if command -v jq &> /dev/null; then
    echo ""
    echo "Summary:"
    jq -r '.metadata | "  Total commits: \(.total_commits)\n  Date: \(.audit_date)\n  Commit range: \(.commit_range)"' "$OUTPUT_FILE"
fi
