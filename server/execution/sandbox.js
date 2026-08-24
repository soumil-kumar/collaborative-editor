const Docker = require('dockerode');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

const docker = new Docker();

/**
 * Each language config defines:
 *  - image      : Docker image name
 *  - fileExt    : source file extension
 *  - cmd(codeFile, stdinFile) : returns the Cmd array for docker.createContainer
 *
 * Every command is wrapped in `sh -c "... < stdinFile"` so that user-provided
 * stdin is piped in cleanly without needing Docker's attach/hijack API.
 * An empty stdin.txt (zero bytes) gives programs an immediate EOF on their first
 * read, which is identical to pressing Ctrl-D in a terminal — safe for programs
 * that don't read stdin at all, and correct for those that do.
 */
const LANGUAGE_CONFIG = {
  python: {
    image: 'collab-python',
    fileExt: '.py',
    cmd: (codeFile, stdinFile) => [
      'sh', '-c', `python3 -u ${codeFile} < ${stdinFile}`,
    ],
  },
  javascript: {
    image: 'collab-node',
    fileExt: '.js',
    cmd: (codeFile, stdinFile) => [
      'sh', '-c', `node ${codeFile} < ${stdinFile}`,
    ],
  },
  cpp: {
    image: 'collab-cpp',
    fileExt: '.cpp',
    // -std=c++17 -O2 MUST match the PCH build flags in Dockerfile.cpp
    cmd: (codeFile, stdinFile) => [
      'sh', '-c',
      `g++ -std=c++17 -O2 -o /tmp/prog ${codeFile} && /tmp/prog < ${stdinFile}`,
    ],
    // g++'s cc1plus needs significantly more RAM than 50 MB during compilation.
    // 256 MB is safe even for programs that include <bits/stdc++.h>.
    resourceLimits: {
      Memory: 256 * 1024 * 1024,
      MemorySwap: 256 * 1024 * 1024,
      NanoCpus: 1e9,
      PidsLimit: 64,
    },
  },
  go: {
    image: 'collab-go',
    fileExt: '.go',
    cmd: (codeFile, stdinFile) => [
      'sh', '-c', `go run ${codeFile} < ${stdinFile}`,
    ],
  },
};

// Default resource limits used for all languages unless overridden per-language.
const DEFAULT_RESOURCE_LIMITS = {
  Memory: 50 * 1024 * 1024,      // 50 MB
  MemorySwap: 50 * 1024 * 1024,  // No swap (MemorySwap === Memory disables it)
  NanoCpus: 1e9,                  // 1 CPU core
  PidsLimit: 64,                  // Prevent fork bombs
};

const EXECUTION_TIMEOUT_MS = 5000; // 5 seconds

/**
 * Run user code in an isolated Docker container.
 */
async function runWithDocker(language, code, stdin = '') {
  const config = LANGUAGE_CONFIG[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
  const codeFile = path.join(tmpDir, `main${config.fileExt}`);
  fs.writeFileSync(codeFile, code, 'utf8');

  const stdinFile = path.join(tmpDir, 'stdin.txt');
  fs.writeFileSync(stdinFile, stdin, 'utf8');

  const containerCodePath = `/code/main${config.fileExt}`;
  const containerStdinPath = '/code/stdin.txt';
  const startTime = Date.now();

  const limits = config.resourceLimits || DEFAULT_RESOURCE_LIMITS;

  let container;
  try {
    container = await docker.createContainer({
      Image: config.image,
      Cmd: config.cmd(containerCodePath, containerStdinPath),
      AttachStdout: true,
      AttachStderr: true,
      NetworkDisabled: true, // No outbound network access
      HostConfig: {
        ...limits,
        ReadonlyRootfs: false, // C++ needs to write /tmp/prog
        Binds: [`${tmpDir}:/code:ro`], // Mount code + stdin dir read-only
        AutoRemove: true,
      },
    });

    await container.start();

    let stdout = '';
    let stderr = '';

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        try { await container.kill(); } catch { /* already gone */ }
        stderr += '\n[Execution timed out after 5 seconds]';
        resolve();
      }, EXECUTION_TIMEOUT_MS);

      docker.modem.demuxStream(
        logStream,
        { write: (chunk) => { stdout += chunk.toString(); } },
        { write: (chunk) => { stderr += chunk.toString(); } },
      );

      logStream.on('end', () => { clearTimeout(timeout); resolve(); });
      logStream.on('error', (err) => { clearTimeout(timeout); reject(err); });
    });

    let exitCode = 0;
    try {
      const info = await container.inspect();
      exitCode = info.State.ExitCode;
    } catch {
      // AutoRemove already cleaned it up — exit code unavailable, default to 0
    }

    const executionTime = Date.now() - startTime;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, executionTime };

  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  }
}

/**
 * Fallback runner using local host process when Docker daemon is not accessible
 * (e.g., standard free cloud host instances).
 */
async function runLocalProcess(language, code, stdin = '') {
  const config = LANGUAGE_CONFIG[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-local-'));
  const codeFile = path.join(tmpDir, `main${config.fileExt}`);
  fs.writeFileSync(codeFile, code, 'utf8');

  const startTime = Date.now();

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const setupProc = (p) => {
      if (!p) return;
      const timeout = setTimeout(() => {
        timedOut = true;
        try { p.kill('SIGKILL'); } catch { /* ignore */ }
        stderr += '\n[Execution timed out after 5 seconds]';
      }, EXECUTION_TIMEOUT_MS);

      if (stdin) {
        p.stdin.write(stdin);
      }
      p.stdin.end();

      p.stdout.on('data', (d) => { stdout += d.toString(); });
      p.stderr.on('data', (d) => { stderr += d.toString(); });

      p.on('error', (err) => {
        clearTimeout(timeout);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        resolve({ stdout: '', stderr: `Runtime error: ${err.message}`, exitCode: 1, executionTime: Date.now() - startTime });
      });

      p.on('close', (code) => {
        clearTimeout(timeout);
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: timedOut ? -1 : (code || 0), executionTime: Date.now() - startTime });
      });
    };

    if (language === 'python') {
      const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
      const proc = spawn(pythonCmd, ['-u', codeFile], { cwd: tmpDir });
      setupProc(proc);
    } else if (language === 'javascript') {
      const proc = spawn('node', [codeFile], { cwd: tmpDir });
      setupProc(proc);
    } else if (language === 'cpp') {
      const exeName = process.platform === 'win32' ? 'prog.exe' : './prog';
      const compile = spawn('g++', ['-std=c++17', '-O2', '-o', exeName, codeFile], { cwd: tmpDir });
      compile.stderr.on('data', (d) => { stderr += d.toString(); });
      compile.on('close', (code) => {
        if (code !== 0) {
          try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
          return resolve({ stdout: '', stderr: stderr.trim() || 'Compilation failed', exitCode: code || 1, executionTime: Date.now() - startTime });
        }
        const runProg = spawn(path.join(tmpDir, exeName), [], { cwd: tmpDir });
        setupProc(runProg);
      });
      compile.on('error', (err) => {
        try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
        resolve({ stdout: '', stderr: `g++ compiler not found: ${err.message}`, exitCode: 1, executionTime: Date.now() - startTime });
      });
    } else if (language === 'go') {
      const proc = spawn('go', ['run', codeFile], { cwd: tmpDir });
      setupProc(proc);
    } else {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
      resolve({ stdout: '', stderr: `Unsupported language: ${language}`, exitCode: 1, executionTime: 0 });
    }
  });
}

/**
 * Execute user code. Uses Docker if available, otherwise falls back to local runner.
 */
async function runCode(language, code, stdin = '') {
  try {
    return await runWithDocker(language, code, stdin);
  } catch (dockerErr) {
    return await runLocalProcess(language, code, stdin);
  }
}

module.exports = { runCode };

