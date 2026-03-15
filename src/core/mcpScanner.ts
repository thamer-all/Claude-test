/**
 * MCP (Model Context Protocol) scanner.
 *
 * Detects MCP-related configuration files, server definitions,
 * and dependencies in a repository.
 */

import { join, basename, extname } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { MCPAsset } from '../types/agent.js';
import { walkDirectory, readTextFile, fileExists } from '../utils/fs.js';

/** Directories to skip during traversal. */
const SKIP_DIRS: Set<string> = new Set([
  'node_modules', '.git', 'dist', 'build', 'coverage',
  '__pycache__', '.next', '.nuxt', '.cache', '.turbo',
  '.parcel-cache', '.vscode', '.idea', 'vendor', 'tmp',
  '.tmp', '.terraform',
]);

/**
 * Safely parse a JSON file. Returns null on failure.
 */
async function readJsonFile(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const content = await readFile(filePath, 'utf-8');
    const parsed: unknown = JSON.parse(content);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Extract MCP server definitions from a parsed JSON config.
 */
function extractServers(
  data: Record<string, unknown>,
  filePath: string,
): MCPAsset[] {
  const assets: MCPAsset[] = [];

  // Check for "mcpServers" key (standard format)
  const serversKey = Object.keys(data).find(
    (k) => k === 'mcpServers' || k === 'mcp_servers',
  );

  if (serversKey) {
    const servers = data[serversKey];
    if (typeof servers === 'object' && servers !== null && !Array.isArray(servers)) {
      const serversObj = servers as Record<string, unknown>;

      for (const [name, config] of Object.entries(serversObj)) {
        let transport = 'unknown';
        if (typeof config === 'object' && config !== null) {
          const configObj = config as Record<string, unknown>;
          if (typeof configObj['transport'] === 'string') {
            transport = configObj['transport'];
          } else if (typeof configObj['command'] === 'string') {
            transport = 'stdio';
          } else if (typeof configObj['url'] === 'string') {
            transport = 'sse';
          }
        }

        assets.push({
          path: filePath,
          type: 'mcp-config',
          serverName: name,
          transport,
          description: `MCP server "${name}" (transport: ${transport})`,
        });
      }

      return assets;
    }
  }

  // If no servers found but file matches MCP naming, still report it
  return assets;
}

/**
 * Scan well-known MCP config file locations.
 */
async function scanKnownMcpFiles(rootPath: string): Promise<MCPAsset[]> {
  const assets: MCPAsset[] = [];

  const knownPaths = [
    join(rootPath, '.mcp.json'),
    join(rootPath, 'mcp.json'),
  ];

  for (const filePath of knownPaths) {
    if (!(await fileExists(filePath))) continue;

    const data = await readJsonFile(filePath);
    if (data) {
      const servers = extractServers(data, filePath);
      if (servers.length > 0) {
        assets.push(...servers);
      } else {
        assets.push({
          path: filePath,
          type: 'mcp-config',
          description: `MCP configuration file: ${basename(filePath)}`,
        });
      }
    } else {
      assets.push({
        path: filePath,
        type: 'mcp-config',
        description: `MCP configuration file (parse failed): ${basename(filePath)}`,
      });
    }
  }

  return assets;
}

/**
 * Scan .claude/ directory for MCP-related JSON files.
 */
async function scanClaudeMcpFiles(rootPath: string): Promise<MCPAsset[]> {
  const assets: MCPAsset[] = [];
  const claudeDir = join(rootPath, '.claude');

  try {
    const claudeStat = await stat(claudeDir);
    if (!claudeStat.isDirectory()) return assets;
  } catch {
    return assets;
  }

  const entries = await walkDirectory(claudeDir, { ignoreDirs: SKIP_DIRS });

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const fileName = basename(entry.path);

    if (fileName.startsWith('mcp') && fileName.endsWith('.json')) {
      const data = await readJsonFile(entry.path);
      if (data) {
        const servers = extractServers(data, entry.path);
        if (servers.length > 0) {
          assets.push(...servers);
        } else {
          assets.push({
            path: entry.path,
            type: 'mcp-config',
            description: `MCP configuration in .claude/: ${fileName}`,
          });
        }
      } else {
        assets.push({
          path: entry.path,
          type: 'mcp-config',
          description: `MCP configuration in .claude/ (parse failed): ${fileName}`,
        });
      }
    }
  }

  return assets;
}

/**
 * Scan files for MCP-related content patterns.
 */
async function scanForMcpContent(rootPath: string): Promise<MCPAsset[]> {
  const assets: MCPAsset[] = [];
  const mcpPatterns = [
    /["']?mcpServers["']?\s*:/,
    /["']?mcp_servers["']?\s*:/,
  ];
  const mcpReferencePatterns = [
    /ModelContextProtocol/,
    /@modelcontextprotocol/,
  ];

  const textExtensions = new Set([
    '.json', '.yaml', '.yml', '.toml',
    '.ts', '.js', '.mjs', '.cjs',
    '.md', '.txt', '.cfg', '.conf',
  ]);

  const entries = await walkDirectory(rootPath, { ignoreDirs: SKIP_DIRS });

  for (const entry of entries) {
    if (!entry.isFile) continue;
    const ext = extname(entry.path).toLowerCase();
    if (!textExtensions.has(ext)) continue;

    // Skip files we already check via specific scanners
    const fileName = basename(entry.path);
    if (fileName === '.mcp.json' || fileName === 'mcp.json') continue;
    if (fileName === 'package.json') continue;

    const relativeToClaude = entry.path.includes('.claude/') || entry.path.includes('.claude\\');
    if (relativeToClaude && fileName.startsWith('mcp') && fileName.endsWith('.json')) {
      continue;
    }

    const content = await readTextFile(entry.path);
    if (!content) continue;

    // Check for server config patterns
    for (const pattern of mcpPatterns) {
      if (pattern.test(content)) {
        assets.push({
          path: entry.path,
          type: 'mcp-related',
          description: `File contains MCP server configuration pattern.`,
        });
        break;
      }
    }

    // Check for MCP reference patterns (only if not already matched)
    if (!assets.some((a) => a.path === entry.path)) {
      for (const pattern of mcpReferencePatterns) {
        if (pattern.test(content)) {
          assets.push({
            path: entry.path,
            type: 'mcp-related',
            description: `File references Model Context Protocol.`,
          });
          break;
        }
      }
    }
  }

  return assets;
}

/**
 * Scan package.json for MCP-related dependencies.
 */
async function scanPackageJsonMcp(rootPath: string): Promise<MCPAsset[]> {
  const assets: MCPAsset[] = [];
  const pkgPath = join(rootPath, 'package.json');
  const data = await readJsonFile(pkgPath);

  if (!data) return assets;

  const depSections = ['dependencies', 'devDependencies', 'peerDependencies'];
  const mcpDepPatterns = [/mcp/, /model-context-protocol/, /modelcontextprotocol/];

  for (const section of depSections) {
    const deps = data[section];
    if (typeof deps !== 'object' || deps === null) continue;

    const depsObj = deps as Record<string, unknown>;
    for (const [name, version] of Object.entries(depsObj)) {
      const isMcp = mcpDepPatterns.some((p) => p.test(name.toLowerCase()));
      if (isMcp && typeof version === 'string') {
        assets.push({
          path: pkgPath,
          type: 'mcp-server',
          serverName: name,
          description: `MCP-related dependency: ${name}@${version} (in ${section})`,
        });
      }
    }
  }

  return assets;
}

/**
 * Scan a repository for MCP-related files and configurations.
 *
 * Detects:
 * - .mcp.json, mcp.json root config files
 * - .claude/mcp*.json config files
 * - Files containing "mcpServers" or "mcp_servers" patterns
 * - package.json MCP-related dependencies
 * - Files referencing "ModelContextProtocol" or "@modelcontextprotocol"
 *
 * @param rootPath  Absolute path to the repository root.
 * @returns         Array of detected MCP assets.
 */
export async function scanForMCP(rootPath: string): Promise<MCPAsset[]> {
  // Verify root exists
  try {
    const rootStat = await stat(rootPath);
    if (!rootStat.isDirectory()) return [];
  } catch {
    return [];
  }

  const results = await Promise.all([
    scanKnownMcpFiles(rootPath),
    scanClaudeMcpFiles(rootPath),
    scanPackageJsonMcp(rootPath),
    scanForMcpContent(rootPath),
  ]);

  const allAssets = results.flat();

  // Deduplicate by path + type + serverName
  const seen = new Set<string>();
  const deduped: MCPAsset[] = [];

  for (const asset of allAssets) {
    const key = `${asset.path}:${asset.type}:${asset.serverName ?? ''}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(asset);
    }
  }

  return deduped;
}
