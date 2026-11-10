import { spawn } from 'node:child_process';

export interface PackStreamOptions {
  gitDir: string;
  gitBinary?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  input?: Buffer;
  advertise?: boolean;
}

function gitEnv(gitDir: string): NodeJS.ProcessEnv {
  return {
    ...process.env,
    GIT_DIR: gitDir,
    GIT_ALLOW_PROTOCOL: 'file',
    GIT_TERMINAL_PROMPT: '0',
  };
}

function spawnPack(args: string[], options: PackStreamOptions): Promise<{ stdout: Buffer; stderr: string; code: number }> {
  const git = options.gitBinary ?? 'git';
  const base = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'credential.helper=',
    '-c',
    'safe.directory=*',
    '-c',
    'uploadpack.allowfilter=0',
    '-c',
    'uploadpack.allowReachableSHA1InWant=0',
  ];
  return new Promise((resolve, reject) => {
    const child = spawn(git, [...base, ...args], {
      cwd: options.gitDir,
      env: gitEnv(options.gitDir),
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: string[] = [];
    const timer =
      options.timeoutMs && options.timeoutMs > 0
        ? setTimeout(() => {
            child.kill('SIGKILL');
          }, options.timeoutMs)
        : null;
    const onAbort = () => child.kill('SIGTERM');
    options.signal?.addEventListener('abort', onAbort, { once: true });
    child.stdout.on('data', (chunk: Buffer) => stdoutChunks.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderrChunks.push(chunk.toString('utf8')));
    child.on('error', (error) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      reject(error);
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      resolve({ stdout: Buffer.concat(stdoutChunks), stderr: stderrChunks.join(''), code: code ?? 1 });
    });
    if (options.input) child.stdin.write(options.input);
    child.stdin.end();
  });
}

export async function gitUploadPack(options: PackStreamOptions): Promise<Buffer> {
  const args = options.advertise
    ? ['upload-pack', '--stateless-rpc', '--advertise-refs', '.']
    : ['upload-pack', '--stateless-rpc', '.'];
  const result = await spawnPack(args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'git upload-pack failed');
  return result.stdout;
}

export async function gitReceivePack(options: PackStreamOptions): Promise<Buffer> {
  const args = options.advertise
    ? ['receive-pack', '--stateless-rpc', '--advertise-refs', '.']
    : ['receive-pack', '--stateless-rpc', '.'];
  const result = await spawnPack(args, options);
  if (result.code !== 0) throw new Error(result.stderr.trim() || 'git receive-pack failed');
  return result.stdout;
}

export function pktLine(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8');
  const header = (body.length + 4).toString(16).padStart(4, '0');
  return Buffer.concat([Buffer.from(header, 'ascii'), body]);
}

export function serviceAdvertisement(service: 'git-upload-pack' | 'git-receive-pack', body: Buffer): Buffer {
  const prefix = pktLine(`# service=${service}\n`);
  const flush = Buffer.from('0000', 'ascii');
  return Buffer.concat([prefix, flush, body]);
}
