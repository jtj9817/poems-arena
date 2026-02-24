#!/bin/bash

# Cross-Phase Dependency Analyzer
# Identifies when later phases modify code from earlier phases

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <start-commit>"
    exit 1
fi

START_COMMIT="$1"
COMMIT_RANGE="$START_COMMIT..HEAD"

echo "# Cross-Phase Dependency Analysis"
echo ""

# First pass: build a map of which files were introduced in which commits
declare -A FILE_ORIGIN
declare -A COMMIT_PHASE

# Detect phases and track file origins
CURRENT_PHASE=1
git log $COMMIT_RANGE --no-merges --reverse --name-status --oneline | while read -r hash message rest; do
    # Detect phase from commit message
    if [[ "$message" =~ [Pp]hase[[:space:]]*([0-9]+) ]]; then
        CURRENT_PHASE="${BASH_REMATCH[1]}"
    fi
    
    # Track which phase this commit belongs to
    echo "$hash|$CURRENT_PHASE" >> /tmp/commit_phases.txt
    
    # Read file changes
    while IFS=$'\t' read -r status file; do
        if [ "$status" = "A" ]; then
            # File was added in this commit
            echo "$file|$hash|$CURRENT_PHASE" >> /tmp/file_origins.txt
        fi
    done < <(git show --name-status --format="" $hash 2>/dev/null)
done

# Second pass: detect when files are modified by later phases
echo "## Dependencies Detected"
echo ""

declare -A DEPS_FOUND

git log $COMMIT_RANGE --no-merges --reverse --name-status --oneline | while read -r hash message rest; do
    # Get phase for this commit
    CURRENT_PHASE=$(grep "^$hash|" /tmp/commit_phases.txt | cut -d'|' -f2)
    
    # Check modified files
    git show --name-status --format="" $hash 2>/dev/null | while IFS=$'\t' read -r status file; do
        if [ "$status" = "M" ]; then
            # File was modified - check if it originated in an earlier phase
            ORIGIN=$(grep "^$file|" /tmp/file_origins.txt | head -1)
            if [ -n "$ORIGIN" ]; then
                ORIGIN_HASH=$(echo "$ORIGIN" | cut -d'|' -f2)
                ORIGIN_PHASE=$(echo "$ORIGIN" | cut -d'|' -f3)
                
                # If modified in a later phase, record dependency
                if [ "$CURRENT_PHASE" -gt "$ORIGIN_PHASE" ] 2>/dev/null; then
                    DEP_KEY="$CURRENT_PHASE->$ORIGIN_PHASE"
                    
                    # Check if we've already reported this dependency
                    if ! grep -q "^$DEP_KEY|$file$" /tmp/deps_reported.txt 2>/dev/null; then
                        echo "### Phase $CURRENT_PHASE → Phase $ORIGIN_PHASE"
                        echo ""
                        echo "**Commit**: $hash"
                        echo "**Modified**: \`$file\`"
                        echo "**Originally from**: $ORIGIN_HASH (Phase $ORIGIN_PHASE)"
                        echo ""
                        
                        # Show what changed
                        echo "**Changes:**"
                        echo "\`\`\`diff"
                        git show $hash -- "$file" | head -50 || true
                        echo "\`\`\`"
                        echo ""
                        
                        echo "$DEP_KEY|$file" >> /tmp/deps_reported.txt
                    fi
                fi
            fi
        fi
    done
done

# Cleanup
rm -f /tmp/commit_phases.txt /tmp/file_origins.txt /tmp/deps_reported.txt

echo ""
echo "## Dependency Graph"
echo ""
echo "This shows which phases depend on code from previous phases:"
echo ""
echo "\`\`\`"
echo "Phase 1 (Foundation)"
echo "  ↓"
echo "Phase 2 (uses/modifies Phase 1 code)"
echo "  ↓"
echo "Phase 3 (uses/modifies Phase 1 & 2 code)"
echo "\`\`\`"
echo ""

echo "**Implications:**"
echo "- Changes to earlier phases may require updates to later phases"
echo "- Consider refactoring if too many back-references"
echo "- Document these dependencies in architecture docs"
