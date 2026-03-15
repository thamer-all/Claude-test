/**
 * Skill file validator.
 *
 * Validates Markdown skill files that use YAML frontmatter for
 * metadata. Checks for required fields, valid frontmatter syntax,
 * and reasonable content structure.
 */

import { readFile, stat, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import yaml from 'js-yaml';

export interface SkillValidationResult {
  path: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  metadata?: {
    name?: string;
    description?: string;
    hasFrontmatter: boolean;
  };
}

/** Minimum content length (excluding frontmatter) for a meaningful skill. */
const MIN_BODY_LENGTH = 10;

/** Maximum reasonable content length (very large skills are suspicious). */
const MAX_BODY_LENGTH = 50000;

/**
 * Extract YAML frontmatter from a Markdown string.
 *
 * Frontmatter is delimited by `---` on the first line and a closing
 * `---`. Returns the frontmatter text and the remaining body, or
 * null if no valid frontmatter is found.
 */
function extractFrontmatter(
  content: string,
): { frontmatter: string; body: string } | null {
  const trimmed = content.trimStart();

  if (!trimmed.startsWith('---')) {
    return null;
  }

  // Find closing delimiter (skip the first line)
  const afterOpening = trimmed.indexOf('\n');
  if (afterOpening === -1) return null;

  const rest = trimmed.slice(afterOpening + 1);
  const closingIndex = rest.indexOf('\n---');

  if (closingIndex === -1) {
    // Check if the entire remaining content ends with ---
    if (rest.trimEnd().endsWith('---')) {
      const lastDash = rest.lastIndexOf('---');
      return {
        frontmatter: rest.slice(0, lastDash).trim(),
        body: '',
      };
    }
    return null;
  }

  const frontmatter = rest.slice(0, closingIndex).trim();
  const body = rest.slice(closingIndex + 4).trim(); // +4 for '\n---'

  return { frontmatter, body };
}

/**
 * Validate a single skill file.
 *
 * Checks:
 * - File exists and is readable
 * - Valid YAML frontmatter with `name` and `description` fields
 * - Non-empty body content
 * - Reasonable content length
 *
 * @param filePath  Absolute path to a .md skill file.
 * @returns         Validation result with errors and warnings.
 */
export async function validateSkill(
  filePath: string,
): Promise<SkillValidationResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check file exists and is readable
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch {
    return {
      path: filePath,
      valid: false,
      errors: [`Cannot read file: ${filePath}`],
      warnings: [],
    };
  }

  // Check for empty file
  if (!content.trim()) {
    return {
      path: filePath,
      valid: false,
      errors: ['File is empty.'],
      warnings: [],
      metadata: { hasFrontmatter: false },
    };
  }

  // Extract frontmatter
  const extracted = extractFrontmatter(content);

  if (!extracted) {
    errors.push(
      'No valid YAML frontmatter found. Skill files should start with --- delimited YAML metadata.',
    );
    return {
      path: filePath,
      valid: false,
      errors,
      warnings,
      metadata: { hasFrontmatter: false },
    };
  }

  // Parse YAML frontmatter
  let frontmatterData: Record<string, unknown>;
  try {
    const parsed = yaml.load(extracted.frontmatter);
    if (parsed === null || parsed === undefined || typeof parsed !== 'object') {
      errors.push('Frontmatter is empty or not a valid YAML object.');
      return {
        path: filePath,
        valid: false,
        errors,
        warnings,
        metadata: { hasFrontmatter: true },
      };
    }
    frontmatterData = parsed as Record<string, unknown>;
  } catch (e) {
    const errorMsg = e instanceof Error ? e.message : String(e);
    errors.push(`Invalid YAML in frontmatter: ${errorMsg}`);
    return {
      path: filePath,
      valid: false,
      errors,
      warnings,
      metadata: { hasFrontmatter: true },
    };
  }

  // Extract metadata
  const name = typeof frontmatterData['name'] === 'string'
    ? frontmatterData['name']
    : undefined;
  const description = typeof frontmatterData['description'] === 'string'
    ? frontmatterData['description']
    : undefined;

  // Validate required fields
  if (!name) {
    errors.push('Missing required "name" field in frontmatter.');
  } else if (name.trim().length === 0) {
    errors.push('"name" field in frontmatter is empty.');
  }

  if (!description) {
    warnings.push('Missing "description" field in frontmatter. A description helps with discoverability.');
  } else if (description.trim().length === 0) {
    warnings.push('"description" field in frontmatter is empty.');
  }

  // Validate body content
  const body = extracted.body;

  if (!body || body.trim().length === 0) {
    errors.push('Skill body is empty. Add instructions or content after the frontmatter.');
  } else if (body.trim().length < MIN_BODY_LENGTH) {
    warnings.push(
      `Skill body is very short (${body.trim().length} chars). Consider adding more detailed instructions.`,
    );
  }

  if (body && body.length > MAX_BODY_LENGTH) {
    warnings.push(
      `Skill body is very large (${body.length} chars). Consider splitting into smaller, focused skills.`,
    );
  }

  const valid = errors.length === 0;

  return {
    path: filePath,
    valid,
    errors,
    warnings,
    metadata: {
      name,
      description,
      hasFrontmatter: true,
    },
  };
}

/**
 * Validate all skill files in a directory.
 *
 * Looks for `.md` files in the given directory (non-recursively).
 *
 * @param dirPath  Absolute path to a directory containing skill files.
 * @returns        Array of validation results, one per skill file.
 */
export async function validateSkills(
  dirPath: string,
): Promise<SkillValidationResult[]> {
  // Verify directory exists
  try {
    const dirStat = await stat(dirPath);
    if (!dirStat.isDirectory()) {
      return [
        {
          path: dirPath,
          valid: false,
          errors: [`"${dirPath}" is not a directory.`],
          warnings: [],
        },
      ];
    }
  } catch {
    return [
      {
        path: dirPath,
        valid: false,
        errors: [`Directory "${dirPath}" does not exist or is not accessible.`],
        warnings: [],
      },
    ];
  }

  let entries: string[];
  try {
    entries = await readdir(dirPath);
  } catch {
    return [
      {
        path: dirPath,
        valid: false,
        errors: [`Cannot read directory: ${dirPath}`],
        warnings: [],
      },
    ];
  }

  const results: SkillValidationResult[] = [];

  for (const entry of entries) {
    const ext = extname(entry).toLowerCase();
    if (ext !== '.md') continue;

    const fullPath = join(dirPath, entry);

    try {
      const entryStat = await stat(fullPath);
      if (!entryStat.isFile()) continue;
    } catch {
      continue;
    }

    const result = await validateSkill(fullPath);
    results.push(result);
  }

  return results;
}
