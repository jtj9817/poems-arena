#!/bin/bash

# Technical Debt Analyzer
# Scans commits for TODO, FIXME, HACK comments and generates a report

set -e

if [ -z "$1" ]; then
    echo "Usage: $0 <start-commit>"
    exit 1
fi

START_COMMIT="$1"
COMMIT_RANGE="$START_COMMIT..HEAD"

echo "# Technical Debt Report"
echo ""
echo "Analyzing commits from $START_COMMIT to HEAD"
echo ""

declare -A TODO_MAP
declare -A FIXME_MAP
declare -A HACK_MAP

# Scan each commit for technical debt markers
git log $COMMIT_RANGE --no-merges --oneline | while read -r hash message; do
    # Get the diff for code files only
    DIFF=$(git show $hash -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null || echo "")
    
    # Extract TODOs
    TODOS=$(echo "$DIFF" | grep -n "^+.*TODO:" || echo "")
    if [ -n "$TODOS" ]; then
        echo "## Commit: $hash - $message"
        echo ""
        echo "### TODOs Added"
        echo "\`\`\`"
        echo "$TODOS" | sed 's/^+//'
        echo "\`\`\`"
        echo ""
    fi
    
    # Extract FIXMEs
    FIXMES=$(echo "$DIFF" | grep -n "^+.*FIXME:" || echo "")
    if [ -n "$FIXMES" ]; then
        echo "### FIXMEs Added"
        echo "\`\`\`"
        echo "$FIXMES" | sed 's/^+//'
        echo "\`\`\`"
        echo ""
    fi
    
    # Extract HACKs
    HACKS=$(echo "$DIFF" | grep -n "^+.*HACK:" || echo "")
    if [ -n "$HACKS" ]; then
        echo "### HACKs Added"
        echo "\`\`\`"
        echo "$HACKS" | sed 's/^+//'
        echo "\`\`\`"
        echo ""
    fi
done

echo ""
echo "---"
echo ""
echo "## Current Technical Debt"
echo ""
echo "All unresolved markers in current codebase:"
echo ""

# Scan current codebase
echo "### TODOs"
git grep -n "TODO:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | head -20 || echo "None found"
echo ""

echo "### FIXMEs"
git grep -n "FIXME:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | head -20 || echo "None found"
echo ""

echo "### HACKs"
git grep -n "HACK:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | head -20 || echo "None found"
echo ""

# Count totals
TODO_COUNT=$(git grep "TODO:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | wc -l || echo 0)
FIXME_COUNT=$(git grep "FIXME:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | wc -l || echo 0)
HACK_COUNT=$(git grep "HACK:" -- '*.php' '*.js' '*.py' '*.ts' '*.java' '*.go' '*.rs' 2>/dev/null | wc -l || echo 0)

echo "## Summary"
echo ""
echo "- **TODOs**: $TODO_COUNT"
echo "- **FIXMEs**: $FIXME_COUNT"
echo "- **HACKs**: $HACK_COUNT"
echo "- **Total**: $((TODO_COUNT + FIXME_COUNT + HACK_COUNT))"
