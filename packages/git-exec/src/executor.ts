import { spawn } from 'node:child_process';
import { UrlRejectedError } from '@repo-archive/shared';

export interface GitRunOptions {
  gitDir?: string;
  cwd?: string;
  timeoutMs?: number;
  signal?: AbortSignal;
  input?: string;
  allowFileProtocol?: boolean;
  gitBinary?: string;
  auth?: { username: string; token: string };
  onStderr?: (chunk: string) => void;
}

export interface GitResult {
  stdout: string;
  stderr: string;
  code: number;
}

export class GitCommandError extends Error {
  readonly category = 'git';
  readonly code: number;
  readonly stderr: string;
  readonly args: string[];

  constructor(message: string, code: number, stderr: string, args: string[]) {
    super(message);
    this.name = 'GitCommandError';
    this.code = code;
    this.stderr = stderr;
    this.args = args;
  }
}

const SUBCOMMANDS = [
  'init',
  'fetch',
  'ls-remote',
  'update-ref',
  'for-each-ref',
  'config',
  'cat-file',
  'rev-parse',
  'fsck',
  'bundle',
  'gc',
  'symbolic-ref',
  'ls-tree',
  'log',
  'remote',
  'hash-object',
  'rev-list',
  'show-ref',
  'check-ref-format',
];

export function safetyArgs(subcommand: string): string[] {
  const args = [
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'core.fsmonitor=',
    '-c',
    'credential.helper=',
    '-c',
    'fetch.recurseSubmodules=false',
    '-c',
    'submodule.recurse=false',
    '-c',
    'filter.lfs.smudge=',
    '-c',
    'filter.lfs.process=',
    '-c',
    'filter.lfs.clean=',
    '-c',
    'filter.lfs.required=false',
    '-c',
    'http.followRedirects=false',
    '-c',
    'protocol.ext.allow=never',
    '-c',
    'safe.directory=*',
    '-c',
    `alias.${subcommand}=`,
  ];
  return args;
}

export function buildGitInvocation(userArgs: string[], options: GitRunOptions): string[] {
  for (const arg of userArgs) {
    if (arg.includes('\0') || arg.includes('\n') || arg.includes('\r')) {
      throw new UrlRejectedError('git argument contains control characters');
    }
  }
  const subcommand = userArgs.find((arg) => !arg.startsWith('-'));
  if (!subcommand || !SUBCOMMANDS.includes(subcommand)) {
    throw new UrlRejectedError('git subcommand is not allowed');
  }
  const prefix: string[] = [];
  if (options.gitDir) prefix.push(`--git-dir=${options.gitDir}`);
  const filePolicy = options.allowFileProtocol ? 'always' : 'never';
  return [...prefix, ...safetyArgs(subcommand), '-c', `protocol.file.allow=${filePolicy}`, ...userArgs];
}

export async function runGit(userArgs: string[], options: GitRunOptions = {}): Promise<GitResult> {
  const args = buildGitInvocation(userArgs, options);
  const timeoutMs = options.timeoutMs ?? 60_000;
  return await new Promise((resolve, reject) => {
    const child = spawn(options.gitBinary ?? 'git', args, {
      cwd: options.cwd,
      env: gitEnv(options),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stderrBytes = 0;
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const timer = setTimeout(() => {
      killChild(child);
      fail(new GitCommandError('git command timed out', 124, Buffer.concat(stderr).toString('utf8'), args));
    }, timeoutMs);
    const onAbort = () => {
      killChild(child);
      fail(new GitCommandError('git command cancelled', 130, Buffer.concat(stderr).toString('utf8'), args));
    };
    if (options.signal) {
      if (options.signal.aborted) onAbort();
      else options.signal.addEventListener('abort', onAbort, { once: true });
    }
    child.stdout.on('data', (chunk: Buffer) => {
      stdout.push(chunk);
      if (Buffer.concat(stdout).byteLength > 64 * 1024 * 1024) {
        killChild(child);
        fail(new GitCommandError('git output exceeded the limit', 1, 'stdout limit', args));
      }
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength;
      if (stderrBytes < 1024 * 1024) stderr.push(chunk);
      options.onStderr?.(chunk.toString('utf8'));
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      fail(error);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      if (settled) return;
      settled = true;
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code !== 0) {
        reject(new GitCommandError(err.trim() || `git exited ${code}`, code ?? 1, err, args));
        return;
      }
      resolve({ stdout: out, stderr: err, code: 0 });
    });
    if (options.input !== undefined) child.stdin.end(options.input);
    else child.stdin.end();
  });
}

export function killChild(child: { pid?: number; kill: (signal?: NodeJS.Signals) => boolean }): void {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, 'SIGKILL');
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      // The process already exited.
    }
  }
}

function gitEnv(options: GitRunOptions): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    PATH: process.env.PATH,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_TERMINAL_PROMPT: '0',
    GIT_LFS_SKIP_SMUDGE: '1',
    GIT_ALLOW_PROTOCOL: options.allowFileProtocol ? 'https:http:ssh:git:file' : 'https:http:ssh:git',
    GIT_SSH_COMMAND: 'ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -F /dev/null',
    LC_ALL: 'C',
  };
  if (options.auth) {
    env.GIT_ASKPASS = askpassPath();
    env.ARCHIVER_GIT_USERNAME = options.auth.username;
    env.ARCHIVER_GIT_TOKEN = options.auth.token;
  } else {
    env.GIT_ASKPASS = 'true';
  }
  return env;
}

function askpassPath(): string {
  return process.env.ARCHIVER_ASKPASS ?? '/usr/local/bin/archiver-askpass';
}

export function isOid(value: string): boolean {
  return /^[0-9a-f]{40}$/.test(value) || /^[0-9a-f]{64}$/.test(value);
}

export function isValidRefName(ref: string): boolean {
  if (!ref.startsWith('refs/')) return false;
  if (ref.length > 1024 || ref.includes('//') || ref.endsWith('/') || ref.includes('..')) return false;
  if (ref.endsWith('.lock') || ref.includes('@{')) return false;
  if (/[\u0000-\u0020\u007f~^:?*[\\]/.test(ref)) return false;
  return ref.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && part !== '@');
}
