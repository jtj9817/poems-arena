#!/bin/bash

# Breaking Changes Detector
# Identifies commits that introduce breaking changes

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <start-commit>"
    exit 1
fi

START_COMMIT="$1"
COMMIT_RANGE="$START_COMMIT..HEAD"

RED='\033[0;31m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "# Breaking Changes Report"
echo ""
echo "Analyzing commits from $START_COMMIT to HEAD for breaking changes"
echo ""

BREAKING_COUNT=0

git log $COMMIT_RANGE --no-merges --oneline | while read -r hash message; do
    IS_BREAKING=false
    REASONS=()
    
    # Check commit message for BREAKING indicator
    if [[ "$message" =~ BREAKING|breaking: ]]; then
        IS_BREAKING=true
        REASONS+=("Commit message indicates breaking change")
    fi
    
    # Get diff for analysis
    DIFF=$(git show $hash --name-status 2>/dev/null || echo "")
    CODE_DIFF=$(git show $hash -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null || echo "")
    
    # Check for deleted files
    DELETED_FILES=$(echo "$DIFF" | grep "^D" || echo "")
    if [ -n "$DELETED_FILES" ]; then
        IS_BREAKING=true
        REASONS+=("Deleted files: $(echo "$DELETED_FILES" | wc -l) files removed")
    fi
    
    # Check for removed classes
    if echo "$CODE_DIFF" | grep -q "^-class "; then
        IS_BREAKING=true
        REASONS+=("Class deletion detected")
    fi
    
    # Check for removed methods (public)
    if echo "$CODE_DIFF" | grep -qE "^-.*public function "; then
        IS_BREAKING=true
        REASONS+=("Public method removal detected")
    fi
    
    # Check for method signature changes
    SIGNATURE_CHANGES=$(echo "$CODE_DIFF" | grep -E "^[-+].*function " | sed 's/^[+-]//' | sort | uniq -u || echo "")
    if [ -n "$SIGNATURE_CHANGES" ]; then
        IS_BREAKING=true
        REASONS+=("Method signature changes detected")
    fi
    
    # Check for database schema deletions
    if echo "$DIFF" | grep -qE "migration.*php" && echo "$CODE_DIFF" | grep -qE "dropColumn|drop\("; then
        IS_BREAKING=true
        REASONS+=("Database schema deletions (dropColumn/drop)")
    fi
    
    # Check for renamed files that might break imports
    RENAMED_FILES=$(echo "$DIFF" | grep "^R" || echo "")
    if [ -n "$RENAMED_FILES" ]; then
        IS_BREAKING=true
        REASONS+=("Files renamed: may break imports/references")
    fi
    
    # Report if breaking
    if [ "$IS_BREAKING" = true ]; then
        echo "## ⚠️  $hash - $message"
        echo ""
        echo "**Breaking Change Indicators:**"
        for reason in "${REASONS[@]}"; do
            echo "- $reason"
        done
        echo ""
        
        # Show deleted files
        if [ -n "$DELETED_FILES" ]; then
            echo "**Deleted Files:**"
            echo "\`\`\`"
            echo "$DELETED_FILES"
            echo "\`\`\`"
            echo ""
        fi
        
        # Show renamed files
        if [ -n "$RENAMED_FILES" ]; then
            echo "**Renamed Files:**"
            echo "\`\`\`"
            echo "$RENAMED_FILES"
            echo "\`\`\`"
            echo ""
        fi
        
        echo "**Migration Guide Required:** Yes"
        echo ""
        echo "---"
        echo ""
        
        BREAKING_COUNT=$((BREAKING_COUNT + 1))
    fi
done

if [ $BREAKING_COUNT -eq 0 ]; then
    echo "✅ No breaking changes detected"
else
    echo "## Summary"
    echo ""
    echo -e "${RED}⚠️  Found $BREAKING_COUNT commits with breaking changes${NC}"
    echo ""
    echo "**Action Required:**"
    echo "- Update documentation with migration guides"
    echo "- Notify users of breaking changes"
    echo "- Consider version bump (major version)"
fi
