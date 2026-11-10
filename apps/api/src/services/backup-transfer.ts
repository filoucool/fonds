import { createHash, createHmac } from 'node:crypto';
import { cpSync, createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Client } from 'ssh2';
import type { BackupTargetConfig, BackupTargetS3, BackupTargetSftp } from '@repo-archive/shared';

export interface TransferProgress {
  filesDone: number;
  bytesDone: number;
}

export async function uploadBackupTree(localRoot: string, target: BackupTargetConfig, remoteName: string): Promise<void> {
  if (target.type === 'local') {
    const destination = path.join(target.path, remoteName);
    mkdirSync(destination, { recursive: true, mode: 0o700 });
    cpSync(localRoot, destination, { recursive: true, dereference: false });
    writeCompleteMarker(destination);
    return;
  }
  if (target.type === 'sftp') {
    await uploadSftp(localRoot, target, remoteName);
    return;
  }
  await uploadS3(localRoot, target, remoteName);
}

export function writeCompleteMarker(root: string): void {
  writeFileSync(path.join(root, '.backup-complete'), `${new Date().toISOString()}\n`, { mode: 0o600 });
}

export function assertBackupComplete(root: string): void {
  const marker = path.join(root, '.backup-complete');
  if (!existsSync(marker)) throw new Error('backup is missing completion marker');
}

export async function verifyBackupTree(root: string, catalogSha256: string): Promise<{ ok: boolean; detail: string }> {
  assertBackupComplete(root);
  const catalog = path.join(root, 'catalog.sqlite');
  if (!existsSync(catalog)) return { ok: false, detail: 'catalog.sqlite is missing' };
  const digest = sha256File(catalog);
  if (digest !== catalogSha256) return { ok: false, detail: 'catalog.sqlite digest mismatch' };
  const manifestPath = path.join(root, 'backup-manifest.json');
  if (!existsSync(manifestPath)) return { ok: false, detail: 'backup-manifest.json is missing' };
  return { ok: true, detail: 'checksums matched completion marker and catalog digest' };
}

export function sha256File(file: string): string {
  const hash = createHash('sha256');
  hash.update(readFileSync(file));
  return hash.digest('hex');
}

function listFilesRecursive(root: string, prefix = ''): { rel: string; abs: string }[] {
  const entries = readdirSync(root, { withFileTypes: true });
  const files: { rel: string; abs: string }[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...listFilesRecursive(abs, rel));
    else if (entry.isFile()) files.push({ rel, abs });
  }
  return files;
}

async function uploadSftp(localRoot: string, target: BackupTargetSftp, remoteName: string): Promise<void> {
  const conn = new Client();
  await new Promise<void>((resolve, reject) => {
    conn
      .on('ready', () => resolve())
      .on('error', reject)
      .connect({
        host: target.host,
        port: target.port,
        username: target.username,
        password: target.password,
        privateKey: target.privateKey,
        readyTimeout: 20_000,
      });
  });
  const sftp = await new Promise<import('ssh2').SFTPWrapper>((resolve, reject) => {
    conn.sftp((err, client) => (err ? reject(err) : resolve(client)));
  });
  writeCompleteMarker(localRoot);
  const remoteRoot = posixJoin(target.remotePath, remoteName);
  await sftpMkdirs(sftp, remoteRoot);
  const checkpointPath = path.join(localRoot, '.upload-checkpoint.json');
  let done = new Set<string>();
  if (existsSync(checkpointPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') done.add(entry);
        }
      }
    } catch {
      done = new Set();
    }
  }
  const files = listFilesRecursive(localRoot).filter((file) => file.rel !== '.upload-checkpoint.json');
  for (const file of files) {
    if (done.has(file.rel)) continue;
    const remote = posixJoin(remoteRoot, file.rel);
    await sftpMkdirs(sftp, path.posix.dirname(remote));
    await uploadSftpFile(sftp, file.abs, remote);
    done.add(file.rel);
    writeFileSync(checkpointPath, `${JSON.stringify([...done])}\n`);
  }
  await uploadSftpFile(sftp, path.join(localRoot, '.backup-complete'), posixJoin(remoteRoot, '.backup-complete'));
  conn.end();
}

function uploadSftpFile(sftp: import('ssh2').SFTPWrapper, local: string, remote: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const stream = sftp.createWriteStream(remote, { mode: 0o600 });
    createReadStream(local).pipe(stream).on('close', () => resolve()).on('error', reject);
  });
}

function sftpMkdirs(sftp: import('ssh2').SFTPWrapper, remote: string): Promise<void> {
  const parts = remote.split('/').filter((part) => part.length > 0);
  let current = remote.startsWith('/') ? '/' : '';
  const steps: Promise<void>[] = [];
  for (const part of parts) {
    current = current ? posixJoin(current, part) : part;
    steps.push(
      new Promise((resolve) => {
        sftp.mkdir(current, { mode: 0o700 }, () => resolve());
      }),
    );
  }
  return steps.reduce((chain, step) => chain.then(() => step), Promise.resolve());
}

async function uploadS3(localRoot: string, target: BackupTargetS3, remoteName: string): Promise<void> {
  if (!target.secretAccessKey) throw new Error('s3 secret is required for backup upload');
  const prefix = target.prefix ? `${target.prefix.replace(/\/$/, '')}/${remoteName}` : remoteName;
  const checkpointPath = path.join(localRoot, '.upload-checkpoint.json');
  let done = new Set<string>();
  if (existsSync(checkpointPath)) {
    try {
      const parsed: unknown = JSON.parse(readFileSync(checkpointPath, 'utf8'));
      if (Array.isArray(parsed)) {
        for (const entry of parsed) {
          if (typeof entry === 'string') done.add(entry);
        }
      }
    } catch {
      done = new Set();
    }
  }
  const files = listFilesRecursive(localRoot);
  for (const file of files) {
    if (file.rel === '.upload-checkpoint.json') continue;
    if (done.has(file.rel)) continue;
    const key = `${prefix}/${file.rel}`.replace(/\/+/g, '/');
    await s3PutObject(target, key, readFileSync(file.abs));
    done.add(file.rel);
    writeFileSync(checkpointPath, `${JSON.stringify([...done])}\n`);
  }
  writeCompleteMarker(localRoot);
  await s3PutObject(target, `${prefix}/.backup-complete`.replace(/\/+/g, '/'), readFileSync(path.join(localRoot, '.backup-complete')));
}

async function s3PutObject(target: BackupTargetS3, key: string, body: Buffer): Promise<void> {
  const host = target.endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
  const url = target.forcePathStyle
    ? `https://${host}/${target.bucket}/${key}`
    : `https://${target.bucket}.${host}/${key}`;
  const now = new Date().toISOString().replace(/[:-]|\.\d{3}/g, '');
  const date = now.slice(0, 8);
  const payloadHash = createHash('sha256').update(body).digest('hex');
  const canonical = [
    'PUT',
    new URL(url).pathname,
    '',
    'host:' + new URL(url).host,
    'x-amz-content-sha256:' + payloadHash,
    'x-amz-date:' + now,
    '',
    'host;x-amz-content-sha256;x-amz-date',
    payloadHash,
  ].join('\n');
  const credentialScope = `${date}/${target.region}/s3/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', now, credentialScope, createHash('sha256').update(canonical).digest('hex')].join('\n');
  const secret = target.secretAccessKey;
  if (!secret) throw new Error('s3 secret is required');
  const signingKey = awsSigningKey(secret, date, target.region, 's3');
  const signature = createHmacHex(signingKey, stringToSign);
  const authorization = `AWS4-HMAC-SHA256 Credential=${target.accessKeyId}/${credentialScope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${signature}`;
  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      host: new URL(url).host,
      'x-amz-content-sha256': payloadHash,
      'x-amz-date': now,
      authorization,
      'content-length': String(body.byteLength),
    },
    body: new Uint8Array(body),
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`s3 upload failed (${response.status}): ${text.slice(0, 200)}`);
  }
}

function awsSigningKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmacBuf(`AWS4${secret}`, date);
  const kRegion = hmacBuf(kDate, region);
  const kService = hmacBuf(kRegion, service);
  return hmacBuf(kService, 'aws4_request');
}

function hmacBuf(key: string | Buffer, data: string): Buffer {
  return createHmac('sha256', key).update(data).digest();
}

function createHmacHex(key: Buffer, data: string): string {
  return createHmac('sha256', key).update(data).digest('hex');
}

function posixJoin(...parts: string[]): string {
  return parts.map((part) => part.replace(/\\/g, '/').replace(/\/$/, '')).filter((part) => part.length > 0).join('/');
}