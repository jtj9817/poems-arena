<?php
/**
 * Manual Test: Phase 2 Generation Logic and Prompts
 * Generated: 2026-02-24
 * Purpose: Verify Phase 2 implementation for @sanctuary/ai-gen
 *
 * Note: This follows the laravel-manual-testing lifecycle pattern
 * (setup -> execution -> cleanup) adapted for a Bun/TypeScript workspace.
 */

declare(strict_types=1);

$testRunId = 'phase2_ai_gen_' . date('Y_m_d_His');
$rootDir = realpath(__DIR__ . '/..');
$packageDir = $rootDir . '/packages/ai-gen';
$logFile = $rootDir . "/logs/manual_tests/{$testRunId}.log";

if (!is_dir(dirname($logFile))) {
    mkdir(dirname($logFile), 0755, true);
}

function logInfo(string $message, array $context = []): void {
    global $logFile;

    $contextJson = empty($context) ? '' : json_encode($context, JSON_UNESCAPED_SLASHES);
    $line = '[' . date('Y-m-d H:i:s') . "] [INFO] {$message} {$contextJson}\n";
    file_put_contents($logFile, $line, FILE_APPEND);
    echo "[INFO] {$message}\n";
}

function logError(string $message, array $context = []): void {
    global $logFile;

    $contextJson = empty($context) ? '' : json_encode($context, JSON_UNESCAPED_SLASHES);
    $line = '[' . date('Y-m-d H:i:s') . "] [ERROR] {$message} {$contextJson}\n";
    file_put_contents($logFile, $line, FILE_APPEND);
    echo "[ERROR] {$message}\n";
}

function runCommand(string $command, string $workingDirectory): array {
    $fullCommand = 'cd ' . escapeshellarg($workingDirectory) . ' && ' . $command . ' 2>&1';
    $outputLines = [];
    $exitCode = 0;
    exec($fullCommand, $outputLines, $exitCode);

    return [
        'command' => $command,
        'exitCode' => $exitCode,
        'output' => implode("\n", $outputLines),
    ];
}

function assertFileExists(string $path, string $label): void {
    if (!file_exists($path)) {
        throw new RuntimeException("Missing required file: {$label} ({$path})");
    }
}

function assertContains(string $haystack, string $needle, string $errorMessage): void {
    if (strpos($haystack, $needle) === false) {
        throw new RuntimeException($errorMessage);
    }
}

function runAndAssertCommand(string $description, string $command, string $workingDirectory): void {
    logInfo($description, ['command' => $command]);
    $result = runCommand($command, $workingDirectory);

    logInfo('Command completed', [
        'command' => $command,
        'exitCode' => $result['exitCode'],
    ]);

    if ($result['output'] !== '') {
        logInfo('Command output', ['output' => $result['output']]);
    }

    if ($result['exitCode'] !== 0) {
        throw new RuntimeException("Command failed ({$result['exitCode']}): {$command}");
    }
}

try {
    logInfo("=== Starting Manual Test: {$testRunId} ===");

    // === SETUP PHASE ===
    logInfo('Phase 1: Setup');

    if ($rootDir === false) {
        throw new RuntimeException('Unable to resolve repository root path.');
    }

    assertFileExists($packageDir . '/package.json', 'ai-gen package.json');
    assertFileExists($packageDir . '/src/prompt-builder.ts', 'prompt-builder implementation');
    assertFileExists($packageDir . '/src/gemini-client.ts', 'gemini-client implementation');
    assertFileExists($packageDir . '/src/verification-agent.ts', 'verification-agent implementation');
    assertFileExists($packageDir . '/prompts/system-instructions.md', 'system instructions markdown');
    assertFileExists($packageDir . '/src/prompt-builder.test.ts', 'prompt-builder tests');
    assertFileExists($packageDir . '/src/gemini-client.test.ts', 'gemini-client tests');
    assertFileExists($packageDir . '/src/verification-agent.test.ts', 'verification-agent tests');

    logInfo('Phase 1 setup checks passed');

    // === EXECUTION PHASE ===
    logInfo('Phase 2: Execution');

    runAndAssertCommand(
        'Run prompt builder tests',
        'CI=true pnpm --filter @sanctuary/ai-gen test -- src/prompt-builder.test.ts',
        $rootDir,
    );
    runAndAssertCommand(
        'Run Gemini client tests',
        'CI=true pnpm --filter @sanctuary/ai-gen test -- src/gemini-client.test.ts',
        $rootDir,
    );
    runAndAssertCommand(
        'Run verification agent tests',
        'CI=true pnpm --filter @sanctuary/ai-gen test -- src/verification-agent.test.ts',
        $rootDir,
    );

    $promptBuilder = file_get_contents($packageDir . '/src/prompt-builder.ts');
    if ($promptBuilder === false) {
        throw new RuntimeException('Unable to read prompt-builder.ts');
    }

    assertContains(
        $promptBuilder,
        'const TOLERANCE_PERCENT = 20;',
        'Prompt builder is missing ±20% tolerance constant.',
    );
    assertContains(
        $promptBuilder,
        'Respond ONLY with valid JSON',
        'Prompt builder is missing JSON-mode instruction.',
    );
    assertContains(
        $promptBuilder,
        '../prompts/system-instructions.md',
        'Prompt builder is missing custom system instruction markdown loading.',
    );
    logInfo('Prompt builder source checks passed');

    $systemInstructions = file_get_contents($packageDir . '/prompts/system-instructions.md');
    if ($systemInstructions === false) {
        throw new RuntimeException('Unable to read system-instructions.md');
    }

    assertContains(
        $systemInstructions,
        'You are a creative poet',
        'System instruction markdown is missing persona guidance.',
    );
    assertContains(
        $systemInstructions,
        'Return ONLY valid JSON',
        'System instruction markdown is missing JSON output requirement.',
    );
    logInfo('System instruction markdown checks passed');

    $geminiClient = file_get_contents($packageDir . '/src/gemini-client.ts');
    if ($geminiClient === false) {
        throw new RuntimeException('Unable to read gemini-client.ts');
    }

    assertContains(
        $geminiClient,
        "const DEFAULT_MODEL = 'gemini-3-flash-preview';",
        'Gemini client default model is not gemini-3-flash-preview.',
    );
    assertContains(
        $geminiClient,
        "responseMimeType: 'application/json'",
        'Gemini client is missing JSON mode responseMimeType.',
    );
    assertContains(
        $geminiClient,
        'responseSchema: POEM_RESPONSE_SCHEMA',
        'Gemini client is missing response schema configuration.',
    );
    assertContains(
        $geminiClient,
        'systemInstruction: config.systemInstructions',
        'Gemini client is missing systemInstruction wiring.',
    );
    assertContains(
        $geminiClient,
        'if (config.thinkingConfig)',
        'Gemini client is missing thinkingConfig support.',
    );
    logInfo('Gemini client source checks passed');

    $verificationAgent = file_get_contents($packageDir . '/src/verification-agent.ts');
    if ($verificationAgent === false) {
        throw new RuntimeException('Unable to read verification-agent.ts');
    }

    assertContains(
        $verificationAgent,
        "const VERIFICATION_MODEL = 'gemini-3-flash-preview';",
        'Verification agent default model is not gemini-3-flash-preview.',
    );
    assertContains(
        $verificationAgent,
        "responseMimeType: 'application/json'",
        'Verification agent is missing JSON mode responseMimeType.',
    );
    assertContains(
        $verificationAgent,
        'responseSchema: VERIFICATION_SCHEMA',
        'Verification agent is missing response schema configuration.',
    );
    assertContains(
        $verificationAgent,
        'systemInstruction: VERIFICATION_SYSTEM_INSTRUCTION',
        'Verification agent is missing systemInstruction wiring.',
    );
    assertContains(
        $verificationAgent,
        'Title: ${poem.title}',
        'Verification agent prompt is missing poem title context.',
    );
    assertContains(
        $verificationAgent,
        '${poem.content}',
        'Verification agent prompt is missing poem content context.',
    );
    logInfo('Verification agent source checks passed');

    logInfo('Phase 2 execution checks completed successfully');
} catch (Throwable $error) {
    logError('Manual verification failed', [
        'message' => $error->getMessage(),
        'file' => $error->getFile(),
        'line' => $error->getLine(),
        'trace' => $error->getTraceAsString(),
    ]);
    exit(1);
} finally {
    // === CLEANUP PHASE ===
    logInfo('Phase 3: Cleanup');
    logInfo('No persistent test data created; cleanup complete');
    logInfo("=== Test Run Finished: {$testRunId} ===");
    echo "\n✓ Full logs at: {$logFile}\n";
}
