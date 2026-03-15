/**
 * Tests for the contract extractor engine.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { writeFile, mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { extractContracts, analyzeDependents, diffContracts } from '../contractExtractor.js';
import type { ContractSnapshot } from '../contractExtractor.js';

const TEST_DIR = join(process.cwd(), '.test-contracts-fixture');

beforeAll(async () => {
  await mkdir(join(TEST_DIR, 'src'), { recursive: true });

  // Create test files
  await writeFile(join(TEST_DIR, 'src', 'types.ts'), `
export interface User {
  id: string;
  name: string;
}

export type UserRole = 'admin' | 'user';

export enum Status {
  Active,
  Inactive,
}
`);

  await writeFile(join(TEST_DIR, 'src', 'utils.ts'), `
import { User } from './types.js';

export function formatUser(user: User): string {
  return user.name;
}

export const MAX_RETRIES = 3;
`);

  await writeFile(join(TEST_DIR, 'src', 'service.ts'), `
import { formatUser } from './utils.js';
import type { User, UserRole } from './types.js';

export class UserService {
  getUser(id: string): User {
    return { id, name: 'test' };
  }
}

export async function createUser(name: string): Promise<User> {
  return { id: '1', name };
}
`);

  await writeFile(join(TEST_DIR, 'src', 'routes.ts'), `
import express from 'express';
import { UserService } from './service.js';

const router = express.Router();

router.get('/users', (req, res) => {
  res.json([]);
});

router.post('/users', (req, res) => {
  res.json({});
});

router.delete('/users/:id', (req, res) => {
  res.json({});
});
`);
});

afterAll(async () => {
  await rm(TEST_DIR, { recursive: true, force: true });
});

describe('extractContracts', () => {
  it('extracts exported symbols', async () => {
    const result = await extractContracts(TEST_DIR);

    const names = result.exports.map(e => e.name);
    expect(names).toContain('User');
    expect(names).toContain('UserRole');
    expect(names).toContain('Status');
    expect(names).toContain('formatUser');
    expect(names).toContain('MAX_RETRIES');
    expect(names).toContain('UserService');
    expect(names).toContain('createUser');
  });

  it('classifies export kinds correctly', async () => {
    const result = await extractContracts(TEST_DIR);

    const byName = new Map(result.exports.map(e => [e.name, e]));
    expect(byName.get('User')?.kind).toBe('interface');
    expect(byName.get('UserRole')?.kind).toBe('type');
    expect(byName.get('Status')?.kind).toBe('enum');
    expect(byName.get('formatUser')?.kind).toBe('function');
    expect(byName.get('MAX_RETRIES')?.kind).toBe('const');
    expect(byName.get('UserService')?.kind).toBe('class');
  });

  it('extracts import relationships', async () => {
    const result = await extractContracts(TEST_DIR);

    // utils.ts imports from types.ts
    const utilsImport = result.imports.find(i =>
      i.source.includes('utils') && i.target.includes('types'),
    );
    expect(utilsImport).toBeDefined();
    expect(utilsImport!.symbols).toContain('User');

    // service.ts imports from utils.ts
    const serviceUtilsImport = result.imports.find(i =>
      i.source.includes('service') && i.target.includes('utils'),
    );
    expect(serviceUtilsImport).toBeDefined();
  });

  it('extracts API routes', async () => {
    const result = await extractContracts(TEST_DIR);

    expect(result.routes.length).toBe(3);
    const methods = result.routes.map(r => r.method);
    expect(methods).toContain('GET');
    expect(methods).toContain('POST');
    expect(methods).toContain('DELETE');
  });

  it('reports file count', async () => {
    const result = await extractContracts(TEST_DIR);
    expect(result.fileCount).toBe(4);
  });
});

describe('analyzeDependents', () => {
  it('finds dependents of a file', async () => {
    const contracts = await extractContracts(TEST_DIR);
    const info = analyzeDependents('src/types', contracts);

    // Both utils.ts and service.ts import from types.ts
    expect(info.dependents.length).toBeGreaterThanOrEqual(2);
  });

  it('assigns risk level based on dependents', async () => {
    const contracts = await extractContracts(TEST_DIR);
    const info = analyzeDependents('src/types', contracts);

    // types.ts has 2+ dependents — should be at least MEDIUM
    expect(['MEDIUM', 'HIGH', 'CRITICAL']).toContain(info.riskLevel);
  });

  it('returns LOW risk for files with no dependents', async () => {
    const contracts = await extractContracts(TEST_DIR);
    const info = analyzeDependents('src/routes', contracts);

    // routes.ts is a leaf — nothing imports it
    expect(info.riskLevel).toBe('LOW');
  });
});

describe('diffContracts', () => {
  it('detects added exports', () => {
    const before: ContractSnapshot = {
      exports: [{ name: 'foo', kind: 'function', file: 'a.ts', line: 1 }],
      imports: [],
      routes: [],
      fileCount: 1,
      timestamp: 1000,
    };
    const after: ContractSnapshot = {
      exports: [
        { name: 'foo', kind: 'function', file: 'a.ts', line: 1 },
        { name: 'bar', kind: 'function', file: 'a.ts', line: 5 },
      ],
      imports: [],
      routes: [],
      fileCount: 1,
      timestamp: 2000,
    };

    const diff = diffContracts(before, after);
    expect(diff.addedExports.length).toBe(1);
    expect(diff.addedExports[0]!.name).toBe('bar');
    expect(diff.removedExports.length).toBe(0);
  });

  it('detects removed exports', () => {
    const before: ContractSnapshot = {
      exports: [
        { name: 'foo', kind: 'function', file: 'a.ts', line: 1 },
        { name: 'bar', kind: 'function', file: 'a.ts', line: 5 },
      ],
      imports: [],
      routes: [],
      fileCount: 1,
      timestamp: 1000,
    };
    const after: ContractSnapshot = {
      exports: [{ name: 'foo', kind: 'function', file: 'a.ts', line: 1 }],
      imports: [],
      routes: [],
      fileCount: 1,
      timestamp: 2000,
    };

    const diff = diffContracts(before, after);
    expect(diff.removedExports.length).toBe(1);
    expect(diff.removedExports[0]!.name).toBe('bar');
  });

  it('detects removed routes', () => {
    const before: ContractSnapshot = {
      exports: [],
      imports: [],
      routes: [{ method: 'GET', path: '/users', file: 'a.ts', line: 1 }],
      fileCount: 1,
      timestamp: 1000,
    };
    const after: ContractSnapshot = {
      exports: [],
      imports: [],
      routes: [],
      fileCount: 1,
      timestamp: 2000,
    };

    const diff = diffContracts(before, after);
    expect(diff.removedRoutes.length).toBe(1);
  });
});
