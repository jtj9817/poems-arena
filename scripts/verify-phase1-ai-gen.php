<?php
/**
 * Manual Test: Phase 1 Setup packages/ai-gen Package
 * Generated: 2026-02-23
 * Purpose: Verify Phase 1 of AI Poem Generation Service
 * 
 * Note: Adapted the laravel-manual-testing skill structure 
 * to test a Node.js/Bun workspace package since this project 
 * does not use Laravel.
 */

$testRunId = 'test_' . date('Y_m_d_His');
$logFile = __DIR__ . "/../logs/manual_tests/{$testRunId}.log";

if (!is_dir(dirname($logFile))) {
    mkdir(dirname($logFile), 0755, true);
}

function logInfo($msg, $ctx = []) {
    global $logFile;
    $context = empty($ctx) ? '' : json_encode($ctx);
    $logMsg = "[" . date('Y-m-d H:i:s') . "] [INFO] {$msg} {$context}
";
    file_put_contents($logFile, $logMsg, FILE_APPEND);
    echo "[INFO] {$msg}
";
}

function logError($msg, $ctx = []) {
    global $logFile;
    $context = empty($ctx) ? '' : json_encode($ctx);
    $logMsg = "[" . date('Y-m-d H:i:s') . "] [ERROR] {$msg} {$context}
";
    file_put_contents($logFile, $logMsg, FILE_APPEND);
    echo "[ERROR] {$msg}
";
}

try {
    logInfo("=== Starting Manual Test: {$testRunId} ===");
    
    // === SETUP PHASE ===
    logInfo("Setting up test data and environment...");
    $packageDir = __DIR__ . '/../packages/ai-gen';
    $rootDir = __DIR__ . '/..';
    
    // === EXECUTION PHASE ===
    logInfo("Running Phase 1 verification tests...");
    
    // 1. Verify package.json
    logInfo("Checking for package.json...");
    if (!file_exists($packageDir . '/package.json')) {
        throw new \Exception("package.json not found in ai-gen package");
    }
    logInfo("package.json exists.");
    
    $packageJson = json_decode(file_get_contents($packageDir . '/package.json'), true);
    
    // 2. Verify Dependencies
    logInfo("Checking dependencies...");
    if (!isset($packageJson['dependencies']['@google/genai'])) {
        throw new \Exception("@google/genai dependency missing in package.json");
    }
    if (!isset($packageJson['dependencies']['p-limit'])) {
        throw new \Exception("p-limit dependency missing in package.json");
    }
    logInfo("Dependencies exist.", [
        '@google/genai' => $packageJson['dependencies']['@google/genai'] ?? 'N/A',
        'p-limit' => $packageJson['dependencies']['p-limit'] ?? 'N/A'
    ]);
    
    // 3. Verify tsconfig.json
    logInfo("Checking tsconfig.json...");
    if (!file_exists($packageDir . '/tsconfig.json')) {
        throw new \Exception("tsconfig.json not found in ai-gen package");
    }
    logInfo("tsconfig.json exists.");

    // 4. Verify Workspace Wiring
    logInfo("Testing workspace resolution...");
    $output = shell_exec("cd {$rootDir} && pnpm --filter @sanctuary/ai-gen exec pwd 2>&1");
    if (strpos(trim($output), 'packages/ai-gen') === false) {
        throw new \Exception("Workspace resolution failed: " . trim($output));
    }
    logInfo("Workspace resolution OK", ['output' => trim($output)]);
    
    // 5. Verify Test Runner
    logInfo("Testing test runner environment...");
    $testOutput = shell_exec("cd {$rootDir} && pnpm --filter @sanctuary/ai-gen test 2>&1");
    if (strpos($testOutput, 'pass') === false) {
        throw new \Exception("Test runner failed or no tests passed: " . trim($testOutput));
    }
    logInfo("Test runner executes successfully.", ['output' => trim($testOutput)]);
    
    logInfo("Tests completed successfully");
    
} catch (\Exception $e) {
    logError("Test failed", [
        'message' => $e->getMessage(),
        'file' => $e->getFile(),
        'line' => $e->getLine()
    ]);
    exit(1);
} finally {
    // === CLEANUP PHASE ===
    logInfo("Cleanup completed (No persistent state to revert for this phase)");
    logInfo("=== Test Run Finished ===");
    echo "
✓ Full logs at: {$logFile}
";
}
