# Phase Audit Scripts

Automated commit auditing and analysis tools.

## Main Scripts

### phase-audit.sh

The main audit script that generates and maintains PHASE_AUDIT.md

**Usage:**

```bash
# Initialize new audit
./scripts/phase-audit.sh <start-commit>

# Update existing audit with new commits
./scripts/phase-audit.sh --update

# Generate summary view only
./scripts/phase-audit.sh --summary

# Export JSON format
./scripts/phase-audit.sh --json
```

### analyze-tech-debt.sh

Scans commits for TODO, FIXME, HACK comments

**Usage:**

```bash
./scripts/analyze-tech-debt.sh <start-commit>
```

### detect-breaking-changes.sh

Identifies commits with breaking changes

**Usage:**

```bash
./scripts/detect-breaking-changes.sh <start-commit>
```

### analyze-dependencies.sh

Analyzes cross-phase dependencies

**Usage:**

```bash
./scripts/analyze-dependencies.sh <start-commit>
```

### export-json.sh

Exports audit data in JSON format for AI processing

**Usage:**

```bash
./scripts/export-json.sh <start-commit> [output-file]
```

## Git Hooks

### post-commit

Automatically updates PHASE_AUDIT.md after each commit

- Skip with [skip-audit] in commit message
- Only runs if PHASE_AUDIT.md exists

### pre-push

Warns if PHASE_AUDIT.md is not current before pushing

- Prompts to update or continue anyway

## Workflow

1. Initialize audit at start of project:

   ```bash
   ./scripts/phase-audit.sh <initial-commit>
   ```

2. Commit normally - audit updates automatically via post-commit hook

3. Review audit before pushing - pre-push hook checks currency

4. Generate analysis reports as needed:

   ```bash
   ./scripts/analyze-tech-debt.sh <start-commit>
   ./scripts/detect-breaking-changes.sh <start-commit>
   ```

5. Export JSON for AI agent context:
   ```bash
   ./scripts/export-json.sh <start-commit>
   ```

## Files Generated

- `PHASE_AUDIT.md` - Main audit document (tracked in git)
- `PHASE_AUDIT.json` - JSON export (optional, can add to .gitignore)
- `PHASE_AUDIT.md.backup` - Backup before updates

## Tips

- Commit PHASE_AUDIT.md to track project evolution
- Use phase numbers in commit messages for auto-grouping
- Add [skip-audit] to meta commits (docs, chores)
- Run full audit after completing each phase
- Use JSON export to provide context to AI agents
