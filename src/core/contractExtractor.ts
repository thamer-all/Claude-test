/**
 * Contract extractor — parse TypeScript/JavaScript files to extract
 * exported symbols, import relationships, and API route patterns.
 *
 * Uses regex-based parsing for zero-dependency operation.
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, relative, extname, dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface ExportedSymbol {
  name: string;
  kind: 'function' | 'class' | 'interface' | 'type' | 'const' | 'enum' | 'variable';
  signature?: string;
  file: string;
  line: number;
}

export interface ImportRelation {
  source: string;       // file that imports
  target: string;       // file being imported (resolved relative path)
  symbols: string[];    // named imports, or ['*'] for star, ['default'] for default
}

export interface ApiRoute {
  method: string;       // GET, POST, PUT, DELETE, PATCH
  path: string;         // route path pattern
  file: string;
  line: number;
}

export interface ContractSnapshot {
  exports: ExportedSymbol[];
  imports: ImportRelation[];
  routes: ApiRoute[];
  fileCount: number;
  timestamp: number;
}

export interface ContractDiff {
  addedExports: ExportedSymbol[];
  removedExports: ExportedSymbol[];
  changedExports: Array<{ before: ExportedSymbol; after: ExportedSymbol }>;
  addedImports: ImportRelation[];
  removedImports: ImportRelation[];
  addedRoutes: ApiRoute[];
  removedRoutes: ApiRoute[];
}

// ---------------------------------------------------------------------------
// Skip directories
// ---------------------------------------------------------------------------

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.next', '.nuxt', '.cache', '.turbo',
  '.parcel-cache', 'vendor', 'tmp', '.tmp',
]);

const CODE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
]);

// ---------------------------------------------------------------------------
// File collection
// ---------------------------------------------------------------------------

async function collectFiles(rootPath: string): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) {
          await walk(fullPath);
        }
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (CODE_EXTENSIONS.has(ext)) {
          files.push(fullPath);
        }
      }
    }
  }

  await walk(rootPath);
  return files;
}

// ---------------------------------------------------------------------------
// Export extraction
// ---------------------------------------------------------------------------

const EXPORT_PATTERNS: Array<{
  regex: RegExp;
  kind: ExportedSymbol['kind'];
  nameGroup: number;
  sigGroup?: number;
}> = [
  // export function foo(args): ReturnType
  { regex: /^export\s+(?:async\s+)?function\s+(\w+)\s*(\([^)]*\)[^{]*)/m, kind: 'function', nameGroup: 1, sigGroup: 2 },
  // export class Foo
  { regex: /^export\s+(?:abstract\s+)?class\s+(\w+)/m, kind: 'class', nameGroup: 1 },
  // export interface Foo
  { regex: /^export\s+interface\s+(\w+)/m, kind: 'interface', nameGroup: 1 },
  // export type Foo
  { regex: /^export\s+type\s+(\w+)/m, kind: 'type', nameGroup: 1 },
  // export enum Foo
  { regex: /^export\s+enum\s+(\w+)/m, kind: 'enum', nameGroup: 1 },
  // export const foo
  { regex: /^export\s+const\s+(\w+)/m, kind: 'const', nameGroup: 1 },
  // export let/var foo
  { regex: /^export\s+(?:let|var)\s+(\w+)/m, kind: 'variable', nameGroup: 1 },
];

function extractExports(content: string, filePath: string): ExportedSymbol[] {
  const symbols: ExportedSymbol[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    // Skip comment lines
    if (line.trimStart().startsWith('//') || line.trimStart().startsWith('*')) continue;

    for (const pattern of EXPORT_PATTERNS) {
      const match = pattern.regex.exec(line);
      if (match) {
        const name = match[pattern.nameGroup]!;
        // Skip duplicates (same name in same file)
        if (!symbols.some(s => s.name === name && s.file === filePath)) {
          symbols.push({
            name,
            kind: pattern.kind,
            signature: pattern.sigGroup ? match[pattern.sigGroup]?.trim() : undefined,
            file: filePath,
            line: i + 1,
          });
        }
        break;
      }
    }
  }

  return symbols;
}

// ---------------------------------------------------------------------------
// Import extraction
// ---------------------------------------------------------------------------

const IMPORT_PATTERNS: Array<{ regex: RegExp; kind: 'named' | 'star' | 'default' }> = [
  // import { a, b } from './foo'
  { regex: /import\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g, kind: 'named' },
  // import type { a } from './foo'
  { regex: /import\s+type\s+\{([^}]+)\}\s+from\s+['"]([^'"]+)['"]/g, kind: 'named' },
  // import * as foo from './foo'
  { regex: /import\s+\*\s+as\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, kind: 'star' },
  // import foo from './foo'
  { regex: /import\s+(\w+)\s+from\s+['"]([^'"]+)['"]/g, kind: 'default' },
];

function extractImports(content: string, filePath: string, rootPath: string): ImportRelation[] {
  const relations: ImportRelation[] = [];
  const sourceRel = relative(rootPath, filePath);

  for (const pattern of IMPORT_PATTERNS) {
    // Reset regex state
    const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
    let match;
    while ((match = regex.exec(content)) !== null) {
      const symbolsPart = match[1]!;
      const importPath = match[2]!;

      // Only track relative imports (project files)
      if (!importPath.startsWith('.')) continue;

      // Resolve the import path relative to the importing file
      const importDir = dirname(filePath);
      let resolvedPath = resolve(importDir, importPath);

      // Strip .js extension (TypeScript convention)
      if (resolvedPath.endsWith('.js')) {
        resolvedPath = resolvedPath.slice(0, -3) + '.ts';
      }

      const targetRel = relative(rootPath, resolvedPath);

      // Parse symbol names based on import kind
      let symbols: string[];
      if (pattern.kind === 'named') {
        symbols = symbolsPart.split(',').map(s => s.trim().split(/\s+as\s+/)[0]!.trim()).filter(Boolean);
      } else if (pattern.kind === 'star') {
        symbols = ['*'];
      } else {
        // Default import — skip if captured word is 'type' (that's import type { ... })
        if (symbolsPart === 'type') continue;
        symbols = [symbolsPart];
      }

      // Avoid duplicate import relations
      const existing = relations.find(r => r.source === sourceRel && r.target === targetRel);
      if (existing) {
        for (const sym of symbols) {
          if (!existing.symbols.includes(sym)) {
            existing.symbols.push(sym);
          }
        }
      } else {
        relations.push({ source: sourceRel, target: targetRel, symbols });
      }
    }
  }

  return relations;
}

// ---------------------------------------------------------------------------
// API route extraction
// ---------------------------------------------------------------------------

const ROUTE_PATTERNS = [
  // Express-style: app.get('/path', ...) or router.post('/path', ...)
  /(?:app|router)\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi,
  // NestJS decorators: @Get('/path'), @Post('/path')
  /@(Get|Post|Put|Delete|Patch)\s*\(\s*['"]([^'"]*)['"]\s*\)/gi,
  // Fastify: fastify.get('/path', ...)
  /fastify\.(get|post|put|delete|patch)\s*\(\s*['"]([^'"]+)['"]/gi,
];

function extractRoutes(content: string, filePath: string): ApiRoute[] {
  const routes: ApiRoute[] = [];
  const lines = content.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    for (const pattern of ROUTE_PATTERNS) {
      const regex = new RegExp(pattern.source, pattern.flags);
      let match;
      while ((match = regex.exec(line)) !== null) {
        routes.push({
          method: match[1]!.toUpperCase(),
          path: match[2] ?? '/',
          file: filePath,
          line: i + 1,
        });
      }
    }
  }

  return routes;
}

// ---------------------------------------------------------------------------
// Dependents analysis (who depends on a given file)
// ---------------------------------------------------------------------------

export interface DependencyInfo {
  file: string;
  dependents: Array<{ file: string; symbols: string[] }>;
  exportedSymbols: ExportedSymbol[];
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
}

export function analyzeDependents(
  targetFile: string,
  snapshot: ContractSnapshot,
): DependencyInfo {
  // Normalize the target to match import targets
  const normalizedTarget = targetFile
    .replace(/\.ts$/, '')
    .replace(/\.tsx$/, '')
    .replace(/\.js$/, '')
    .replace(/\.jsx$/, '');

  const dependents: Array<{ file: string; symbols: string[] }> = [];

  for (const imp of snapshot.imports) {
    const normalizedImpTarget = imp.target
      .replace(/\.ts$/, '')
      .replace(/\.tsx$/, '')
      .replace(/\.js$/, '')
      .replace(/\.jsx$/, '');

    if (normalizedImpTarget === normalizedTarget) {
      dependents.push({ file: imp.source, symbols: imp.symbols });
    }
  }

  const exportedSymbols = snapshot.exports.filter(e => {
    const normalizedExport = e.file
      .replace(/\.ts$/, '')
      .replace(/\.tsx$/, '')
      .replace(/\.js$/, '')
      .replace(/\.jsx$/, '');
    return normalizedExport === normalizedTarget;
  });

  // Risk assessment
  const depCount = dependents.length;
  const totalUsages = dependents.reduce((sum, d) => sum + d.symbols.length, 0);

  let riskLevel: DependencyInfo['riskLevel'];
  if (depCount >= 10 || totalUsages >= 20) {
    riskLevel = 'CRITICAL';
  } else if (depCount >= 5 || totalUsages >= 10) {
    riskLevel = 'HIGH';
  } else if (depCount >= 2 || totalUsages >= 4) {
    riskLevel = 'MEDIUM';
  } else {
    riskLevel = 'LOW';
  }

  return { file: targetFile, dependents, exportedSymbols, riskLevel };
}

// ---------------------------------------------------------------------------
// Diff contracts
// ---------------------------------------------------------------------------

export function diffContracts(before: ContractSnapshot, after: ContractSnapshot): ContractDiff {
  // Exports
  const beforeExportKeys = new Set(before.exports.map(e => `${e.file}:${e.name}`));
  const afterExportKeys = new Set(after.exports.map(e => `${e.file}:${e.name}`));

  const addedExports = after.exports.filter(e => !beforeExportKeys.has(`${e.file}:${e.name}`));
  const removedExports = before.exports.filter(e => !afterExportKeys.has(`${e.file}:${e.name}`));

  // Detect changed signatures
  const changedExports: ContractDiff['changedExports'] = [];
  for (const afterExport of after.exports) {
    const key = `${afterExport.file}:${afterExport.name}`;
    if (beforeExportKeys.has(key)) {
      const beforeExport = before.exports.find(e => `${e.file}:${e.name}` === key)!;
      if (beforeExport.signature !== afterExport.signature || beforeExport.kind !== afterExport.kind) {
        changedExports.push({ before: beforeExport, after: afterExport });
      }
    }
  }

  // Imports
  const beforeImportKeys = new Set(before.imports.map(i => `${i.source}->${i.target}`));
  const afterImportKeys = new Set(after.imports.map(i => `${i.source}->${i.target}`));

  const addedImports = after.imports.filter(i => !beforeImportKeys.has(`${i.source}->${i.target}`));
  const removedImports = before.imports.filter(i => !afterImportKeys.has(`${i.source}->${i.target}`));

  // Routes
  const beforeRouteKeys = new Set(before.routes.map(r => `${r.method}:${r.path}`));
  const afterRouteKeys = new Set(after.routes.map(r => `${r.method}:${r.path}`));

  const addedRoutes = after.routes.filter(r => !beforeRouteKeys.has(`${r.method}:${r.path}`));
  const removedRoutes = before.routes.filter(r => !afterRouteKeys.has(`${r.method}:${r.path}`));

  return {
    addedExports,
    removedExports,
    changedExports,
    addedImports,
    removedImports,
    addedRoutes,
    removedRoutes,
  };
}

// ---------------------------------------------------------------------------
// Main extraction
// ---------------------------------------------------------------------------

/**
 * Extract all contracts from a codebase.
 */
export async function extractContracts(rootPath: string): Promise<ContractSnapshot> {
  const files = await collectFiles(rootPath);
  const allExports: ExportedSymbol[] = [];
  const allImports: ImportRelation[] = [];
  const allRoutes: ApiRoute[] = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
    } catch {
      continue;
    }

    const relPath = relative(rootPath, filePath);

    const exports = extractExports(content, relPath);
    allExports.push(...exports);

    const imports = extractImports(content, filePath, rootPath);
    allImports.push(...imports);

    const routes = extractRoutes(content, relPath);
    allRoutes.push(...routes);
  }

  return {
    exports: allExports,
    imports: allImports,
    routes: allRoutes,
    fileCount: files.length,
    timestamp: Date.now(),
  };
}
