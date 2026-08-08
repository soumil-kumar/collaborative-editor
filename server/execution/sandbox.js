const Docker = require('dockerode');
const { Writable } = require('stream');
const { v4: uuidv4 } = require('uuid');
const os = require('os');
const path = require('path');
const fs = require('fs');

const docker = new Docker();

const LANGUAGE_CONFIG = {
  python: {
    image: 'collab-python',
    fileExt: '.py',
    cmd: (filename) => ['python3', filename],
  },
  javascript: {
    image: 'collab-node',
    fileExt: '.js',
    cmd: (filename) => ['node', filename],
  },
  cpp: {
    image: 'collab-cpp',
    fileExt: '.cpp',
    // Compile then run: sh -c "g++ -o /tmp/prog /code/file.cpp && /tmp/prog"
    cmd: (filename) => ['sh', '-c', `g++ -o /tmp/prog ${filename} && /tmp/prog`],
  },
  go: {
    image: 'collab-go',
    fileExt: '.go',
    cmd: (filename) => ['go', 'run', filename],
  },
};

const RESOURCE_LIMITS = {
  Memory: 50 * 1024 * 1024,   // 50 MB
  MemorySwap: 50 * 1024 * 1024, // No swap
  NanoCpus: 1e9,                // 1 CPU
  PidsLimit: 64,                // Prevent fork bombs
};

const EXECUTION_TIMEOUT_MS = 5000; // 5 seconds

/**
 * Run user code in an isolated Docker container.
 * Returns { stdout, stderr, exitCode, executionTime }.
 */
async function runCode(language, code) {
  const config = LANGUAGE_CONFIG[language];
  if (!config) throw new Error(`Unsupported language: ${language}`);

  // Write code to a temp file on the host to mount into the container
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'collab-'));
  const codeFile = path.join(tmpDir, `main${config.fileExt}`);
  fs.writeFileSync(codeFile, code, 'utf8');

  const containerCodePath = `/code/main${config.fileExt}`;
  const startTime = Date.now();

  let container;
  try {
    container = await docker.createContainer({
      Image: config.image,
      Cmd: config.cmd(containerCodePath),
      AttachStdout: true,
      AttachStderr: true,
      NetworkDisabled: true, // No network access
      HostConfig: {
        ...RESOURCE_LIMITS,
        ReadonlyRootfs: false, // cpp needs to write /tmp/prog
        Binds: [`${tmpDir}:/code:ro`], // Mount code dir read-only
        AutoRemove: true,
      },
    });

    await container.start();

    // Collect output with timeout
    let stdout = '';
    let stderr = '';

    const outputStream = new Writable({
      write(chunk, encoding, callback) {
        const data = chunk.toString();
        // Docker multiplexed stream: first 8 bytes are header
        // stream type byte: 1 = stdout, 2 = stderr
        callback();
      },
    });

    const logStream = await container.logs({
      follow: true,
      stdout: true,
      stderr: true,
    });

    await new Promise((resolve, reject) => {
      const timeout = setTimeout(async () => {
        try { await container.kill(); } catch {}
        stderr += '\n[Execution timed out after 5 seconds]';
        resolve();
      }, EXECUTION_TIMEOUT_MS);

      docker.modem.demuxStream(logStream, 
        { write: (chunk) => { stdout += chunk.toString(); } },
        { write: (chunk) => { stderr += chunk.toString(); } }
      );

      logStream.on('end', () => {
        clearTimeout(timeout);
        resolve();
      });
      logStream.on('error', (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    // Get exit code
    let exitCode = 0;
    try {
      const info = await container.inspect();
      exitCode = info.State.ExitCode;
    } catch {
      // Container already removed (AutoRemove)
    }

    const executionTime = Date.now() - startTime;
    return { stdout: stdout.trim(), stderr: stderr.trim(), exitCode, executionTime };

  } finally {
    // Cleanup temp dir
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { runCode };
