import { createHash, generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { Server } from 'ssh2';
import type { AuthService } from './auth';
import type { GitAccessService } from './git-access';
import type { SettingsService } from './settings';
import { gitReceivePack, gitUploadPack } from '@fonds/git-exec';

export class GitSshService {
  private server: Server | null = null;

  constructor(
    private readonly dataDir: string,
    private readonly gitAccess: GitAccessService,
    private readonly auth: AuthService,
    private readonly settings: SettingsService,
  ) {}

  hostKeyPath(): string {
    return path.join(this.dataDir, 'app', 'ssh', 'host_key');
  }

  start(): void {
    const settings = this.settings.get().gitAccess;
    if (!settings.sshEnabled) return;
    const hostKey = this.ensureHostKey();
    const server = new Server({ hostKeys: [hostKey] }, (client) => {
      let keyFingerprint: string | null = null;
      client.on('authentication', (context) => {
        if (context.method === 'publickey' && context.key && context.signature) {
          const fingerprint = sshKeyFingerprint(context.key.data);
          const match = this.auth.findSshKeyByFingerprint(fingerprint);
          if (match) {
            keyFingerprint = match.id;
            this.auth.touchSshKey(match.id);
            context.accept();
            return;
          }
        }
        if (!this.auth.requiresAuth() && context.method === 'none') {
          context.accept();
          return;
        }
        context.reject();
      });
      client.on('ready', () => {
        client.on('session', (accept) => {
          const session = accept();
          session.on('exec', (acceptExec, _reject, info) => {
            const stream = acceptExec();
            const command = info.command.trim();
            void this.handleCommand(command, stream, keyFingerprint);
          });
        });
      });
    });
    server.listen(settings.sshPort, '0.0.0.0', () => {
      console.log(`Git SSH listening on port ${settings.sshPort}`);
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      if (!this.server) return resolve();
      this.server.close(() => resolve());
    });
    this.server = null;
  }

  private ensureHostKey(): Buffer {
    const file = this.hostKeyPath();
    mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    if (!existsSync(file)) {
      const { privateKey } = generateKeyPairSync('ed25519');
      writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });
    }
    return readFileSync(file);
  }

  private async handleCommand(command: string, stream: NodeJS.WritableStream & { stderr: { write: (chunk: string) => void } }, _keyId: string | null): Promise<void> {
    const match = /^git-(upload-pack|receive-pack) '([^']+)'$/.exec(command);
    if (!match) {
      stream.stderr.write('fatal: only git upload-pack and receive-pack are allowed\n');
      stream.end();
      return;
    }
    const subcommand = match[1];
    const repoPath = match[2];
    try {
      const parsed = this.gitAccess.parseSshRepository(repoPath);
      if (subcommand === 'receive-pack' && parsed.target.readOnly) {
        stream.stderr.write('fatal: archives are read-only\n');
        stream.end();
        return;
      }
      const output =
        subcommand === 'upload-pack'
          ? await gitUploadPack({ gitDir: parsed.target.gitDir, advertise: !command.includes('--stateless-rpc'), timeoutMs: 3_600_000 })
          : await gitReceivePack({ gitDir: parsed.target.gitDir, timeoutMs: 3_600_000 });
      stream.write(output);
      stream.end();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'git command failed';
      stream.stderr.write(`fatal: ${message}\n`);
      stream.end();
    }
  }
}

function sshKeyFingerprint(data: Buffer): string {
  const digest = createHash('sha256').update(data).digest('base64');
  return `SHA256:${digest.replace(/=+$/, '')}`;
}
