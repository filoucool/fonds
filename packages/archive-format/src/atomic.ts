import { randomUUID } from 'node:crypto';
import { mkdir, open, rename } from 'node:fs/promises';
import path from 'node:path';

export async function atomicWriteFile(filePath: string, data: string | Buffer): Promise<void> {
  const directory = path.dirname(filePath);
  await mkdir(directory, { recursive: true });
  const temporary = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  const handle = await open(temporary, 'w', 0o644);
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, filePath);
  try {
    const dirHandle = await open(directory, 'r');
    try {
      await dirHandle.sync();
    } finally {
      await dirHandle.close();
    }
  } catch {
    // Directory fsync is not available on every filesystem.
  }
}
