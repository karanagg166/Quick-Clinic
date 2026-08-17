import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 85: Dependency Policy & Clean Lockfile Test Suite', () => {
  const rootDir = process.cwd();

  it('85.1 Ensures no accidental foreign package manager lockfiles exist', () => {
    const forbiddenLockfiles = ['package-lock.json', 'yarn.lock', 'bun.lockb'];
    for (const lockfile of forbiddenLockfiles) {
      const rootExists = fs.existsSync(path.join(rootDir, lockfile));
      const socketExists = fs.existsSync(path.join(rootDir, 'socket-server', lockfile));
      expect(rootExists, `Found forbidden root lockfile: ${lockfile}`).toBe(false);
      expect(socketExists, `Found forbidden socket lockfile: ${lockfile}`).toBe(false);
    }
  });

  it('85.2 Validates independent root and socket-server package configurations', () => {
    const rootPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf-8'));
    const socketPkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'socket-server', 'package.json'), 'utf-8'));

    expect(rootPkg.dependencies).toBeDefined();
    expect(rootPkg.dependencies.next).toBeDefined();
    expect(rootPkg.dependencies['@prisma/client']).toBeDefined();

    expect(socketPkg.dependencies).toBeDefined();
    expect(socketPkg.dependencies['socket.io']).toBeDefined();
  });
});
