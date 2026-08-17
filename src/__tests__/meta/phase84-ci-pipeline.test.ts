import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 84: CI Pipeline Configuration & Development Scripts Test Suite', () => {
  const pkgPath = path.resolve(process.cwd(), 'package.json');

  it('84.1 package.json contains all required verification and build scripts', () => {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.build).toBeDefined();
    expect(pkg.scripts.lint).toBeDefined();
    expect(pkg.scripts['type-check']).toBeDefined();
    expect(pkg.scripts.test).toBeDefined();
  });

  it('84.2 Validates repository pinning and engine configurations', () => {
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    expect(pkg.name).toBe('quick-clinic');
    expect(pkg.packageManager).toContain('pnpm');
  });
});
