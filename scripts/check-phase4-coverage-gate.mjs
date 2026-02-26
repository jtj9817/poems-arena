#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const coverageTargets = [
  {
    name: '@sanctuary/api',
    packageDir: path.join(repoRoot, 'apps', 'api'),
    filter: '@sanctuary/api',
    moduleFile: 'src/routes/duels.ts',
    moduleMinCoverage: 85,
    packageMinCoverage: 80,
  },
  {
    name: '@sanctuary/ai-gen',
    packageDir: path.join(repoRoot, 'packages', 'ai-gen'),
    filter: '@sanctuary/ai-gen',
    moduleFile: 'src/duel-assembly.ts',
    moduleMinCoverage: 90,
    packageMinCoverage: 80,
  },
];

function runOrExit(command, args) {
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function toPercent(hit, found) {
  if (!Number.isFinite(found) || found <= 0) return 100;
  return (hit / found) * 100;
}

function parseLcov(lcovText) {
  const records = [];
  const chunks = lcovText.split('end_of_record');

  for (const rawChunk of chunks) {
    const chunk = rawChunk.trim();
    if (!chunk) continue;

    const record = {
      sf: '',
      fnf: 0,
      fnh: 0,
      lf: 0,
      lh: 0,
      brf: 0,
      brh: 0,
    };

    const lines = chunk.split('\n').map((line) => line.trim());
    for (const line of lines) {
      if (line.startsWith('SF:')) record.sf = line.slice(3);
      else if (line.startsWith('FNF:')) record.fnf = Number(line.slice(4)) || 0;
      else if (line.startsWith('FNH:')) record.fnh = Number(line.slice(4)) || 0;
      else if (line.startsWith('LF:')) record.lf = Number(line.slice(3)) || 0;
      else if (line.startsWith('LH:')) record.lh = Number(line.slice(3)) || 0;
      else if (line.startsWith('BRF:')) record.brf = Number(line.slice(4)) || 0;
      else if (line.startsWith('BRH:')) record.brh = Number(line.slice(4)) || 0;
    }

    if (record.sf) records.push(record);
  }

  return records;
}

function sumMetrics(records) {
  return records.reduce(
    (acc, record) => {
      acc.fnf += record.fnf;
      acc.fnh += record.fnh;
      acc.lf += record.lf;
      acc.lh += record.lh;
      acc.brf += record.brf;
      acc.brh += record.brh;
      return acc;
    },
    { fnf: 0, fnh: 0, lf: 0, lh: 0, brf: 0, brh: 0 },
  );
}

function coverageSummary(metrics) {
  return {
    functions: toPercent(metrics.fnh, metrics.fnf),
    lines: toPercent(metrics.lh, metrics.lf),
    branches: metrics.brf > 0 ? toPercent(metrics.brh, metrics.brf) : null,
  };
}

function formatPercent(value) {
  return value == null ? 'n/a' : `${value.toFixed(2)}%`;
}

function assertThreshold(failures, label, value, minimum) {
  if (value + Number.EPSILON < minimum) {
    failures.push(`${label} is ${value.toFixed(2)}% (required >= ${minimum}%)`);
  }
}

function normalizePath(filePath) {
  return filePath.replaceAll('\\', '/');
}

function getPackageSourceRecords(records) {
  return records.filter((record) => normalizePath(record.sf).startsWith('src/'));
}

function verifyTarget(target, failures, warnings) {
  const lcovPath = path.join(target.packageDir, 'coverage', 'lcov.info');
  if (!existsSync(lcovPath)) {
    failures.push(`${target.name}: missing coverage file at ${lcovPath}`);
    return;
  }

  const lcovText = readFileSync(lcovPath, 'utf8');
  const records = parseLcov(lcovText);
  const packageRecords = getPackageSourceRecords(records);
  const packageMetrics = sumMetrics(packageRecords);
  const packageCoverage = coverageSummary(packageMetrics);

  const moduleRecord = records.find((record) => normalizePath(record.sf) === target.moduleFile);

  if (!moduleRecord) {
    failures.push(`${target.name}: unable to find module coverage for ${target.moduleFile}`);
    return;
  }

  const moduleCoverage = coverageSummary(moduleRecord);
  const hasBranchCoverageData =
    packageCoverage.branches !== null && moduleCoverage.branches !== null;

  console.log(
    `[coverage] ${target.name} package src/ -> lines=${formatPercent(
      packageCoverage.lines,
    )}, functions=${formatPercent(packageCoverage.functions)}, branches=${formatPercent(
      packageCoverage.branches,
    )}`,
  );
  console.log(
    `[coverage] ${target.name} ${target.moduleFile} -> lines=${formatPercent(
      moduleCoverage.lines,
    )}, functions=${formatPercent(moduleCoverage.functions)}, branches=${formatPercent(
      moduleCoverage.branches,
    )}`,
  );

  assertThreshold(
    failures,
    `${target.name} package line coverage`,
    packageCoverage.lines,
    target.packageMinCoverage,
  );
  assertThreshold(
    failures,
    `${target.name} package function coverage`,
    packageCoverage.functions,
    target.packageMinCoverage,
  );
  assertThreshold(
    failures,
    `${target.name} module line coverage (${target.moduleFile})`,
    moduleCoverage.lines,
    target.moduleMinCoverage,
  );
  assertThreshold(
    failures,
    `${target.name} module function coverage (${target.moduleFile})`,
    moduleCoverage.functions,
    target.moduleMinCoverage,
  );

  if (hasBranchCoverageData) {
    assertThreshold(
      failures,
      `${target.name} package branch coverage`,
      packageCoverage.branches,
      target.packageMinCoverage,
    );
    assertThreshold(
      failures,
      `${target.name} module branch coverage (${target.moduleFile})`,
      moduleCoverage.branches,
      target.moduleMinCoverage,
    );
    return;
  }

  warnings.push(
    `${target.name}: Bun lcov did not include branch metrics; function coverage is enforced as the branch proxy.`,
  );
}

for (const target of coverageTargets) {
  rmSync(path.join(target.packageDir, 'coverage'), { force: true, recursive: true });
}

for (const target of coverageTargets) {
  runOrExit('pnpm', [
    '--filter',
    target.filter,
    'exec',
    'bun',
    'test',
    '--coverage',
    '--coverage-reporter=lcov',
    '--coverage-reporter=text',
    '--coverage-dir=coverage',
  ]);
}

const failures = [];
const warnings = [];
for (const target of coverageTargets) {
  verifyTarget(target, failures, warnings);
}

for (const warning of warnings) {
  console.warn(`[coverage][warning] ${warning}`);
}

if (failures.length > 0) {
  console.error('\n[coverage] Phase 4 coverage gate failed:');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('\n[coverage] Phase 4 coverage gate passed.');
