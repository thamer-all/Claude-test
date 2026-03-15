/**
 * `codeprobe workflow [path]` — Detect and report on agentic workflow patterns.
 *
 * Scans for task tracking, self-improvement loops, plans, and AI tool configs.
 */

import { Command } from 'commander';
import { readFile, readdir, access } from 'node:fs/promises';
import { join, basename } from 'node:path';
import { setLogLevel } from '../utils/logger.js';

interface TaskStats {
  file: string;
  total: number;
  completed: number;
  pending: number;
  completionPct: number;
}

interface LessonsStats {
  file: string;
  count: number;
}

interface PlanStats {
  directory: string;
  files: string[];
}

interface AIToolConfig {
  tool: string;
  files: string[];
}

interface WorkflowReport {
  tasks: TaskStats[];
  lessons: LessonsStats[];
  plans: PlanStats[];
  aiTools: AIToolConfig[];
  score: number;
  maxScore: number;
  detected: string[];
  missing: string[];
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function dirEntries(path: string): Promise<string[]> {
  try {
    const entries = await readdir(path);
    return entries;
  } catch {
    return [];
  }
}

function parseCheckboxes(content: string): { total: number; completed: number; pending: number } {
  const lines = content.split('\n');
  let completed = 0;
  let pending = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (/^-\s*\[x\]/i.test(trimmed)) {
      completed++;
    } else if (/^-\s*\[\s\]/.test(trimmed)) {
      pending++;
    }
  }

  return { total: completed + pending, completed, pending };
}

function countLessons(content: string): number {
  const lines = content.split('\n');
  let count = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Count headings, numbered items, or bullet points as lesson entries
    if (/^#{1,4}\s+\S/.test(trimmed) && !/^#\s/.test(trimmed)) {
      // Sub-headings (##, ###, ####) count as lessons
      count++;
    } else if (/^\d+\.\s+\S/.test(trimmed)) {
      count++;
    } else if (/^-\s+\*\*/.test(trimmed)) {
      // Bold bullet points like "- **Lesson**:"
      count++;
    }
  }

  // If no structured entries found, count non-empty lines as a fallback
  if (count === 0) {
    count = lines.filter(l => l.trim().length > 0).length;
  }

  return count;
}

async function detectTasks(rootPath: string): Promise<TaskStats[]> {
  const results: TaskStats[] = [];

  const candidates = [
    'tasks/todo.md',
    'TODO.md',
    'todo.md',
    'tasks/TODO.md',
  ];

  for (const candidate of candidates) {
    const fullPath = join(rootPath, candidate);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      const { total, completed, pending } = parseCheckboxes(content);
      if (total > 0) {
        results.push({
          file: candidate,
          total,
          completed,
          pending,
          completionPct: Math.round((completed / total) * 100),
        });
      }
    }
  }

  // Also check for task files in tasks/ directory
  const tasksDir = join(rootPath, 'tasks');
  const taskFiles = await dirEntries(tasksDir);
  for (const file of taskFiles) {
    const lower = file.toLowerCase();
    if ((lower.endsWith('.md') || lower.endsWith('.txt')) && lower !== 'todo.md' && lower !== 'lessons.md') {
      const fullPath = join(tasksDir, file);
      const content = await readFile(fullPath, 'utf-8');
      const { total, completed, pending } = parseCheckboxes(content);
      if (total > 0) {
        results.push({
          file: `tasks/${file}`,
          total,
          completed,
          pending,
          completionPct: Math.round((completed / total) * 100),
        });
      }
    }
  }

  return results;
}

async function detectLessons(rootPath: string): Promise<LessonsStats[]> {
  const results: LessonsStats[] = [];

  const candidates = [
    'tasks/lessons.md',
    'LESSONS.md',
    'lessons.md',
    'tasks/LESSONS.md',
  ];

  for (const candidate of candidates) {
    const fullPath = join(rootPath, candidate);
    if (await fileExists(fullPath)) {
      const content = await readFile(fullPath, 'utf-8');
      const count = countLessons(content);
      if (count > 0) {
        results.push({ file: candidate, count });
      }
    }
  }

  return results;
}

async function detectPlans(rootPath: string): Promise<PlanStats[]> {
  const results: PlanStats[] = [];

  // Check for plan directories
  const planDirs = ['plans', 'docs/plans'];
  for (const dir of planDirs) {
    const fullPath = join(rootPath, dir);
    const entries = await dirEntries(fullPath);
    const planFiles = entries.filter(e => e.endsWith('.md') || e.endsWith('.txt') || e.endsWith('.yaml') || e.endsWith('.yml'));
    if (planFiles.length > 0) {
      results.push({ directory: `${dir}/`, files: planFiles });
    }
  }

  // Check for standalone plan files
  const standaloneFiles = ['PLAN.md', 'plan.md'];
  for (const file of standaloneFiles) {
    const fullPath = join(rootPath, file);
    if (await fileExists(fullPath)) {
      results.push({ directory: '.', files: [file] });
    }
  }

  return results;
}

async function detectAIToolConfigs(rootPath: string): Promise<AIToolConfig[]> {
  const results: AIToolConfig[] = [];

  const toolChecks: Array<{ tool: string; files: string[] }> = [
    { tool: 'Claude Code', files: ['CLAUDE.md', '.claude/settings.json', '.claude/settings.local.json'] },
    { tool: 'Cursor', files: ['.cursorrules', '.cursor/rules'] },
    { tool: 'Windsurf', files: ['.windsurfrules'] },
    { tool: 'Aider', files: ['.aider.conf.yml', '.aiderignore'] },
    { tool: 'GitHub Copilot', files: ['.github/copilot-instructions.md', '.copilot'] },
    { tool: 'Continue', files: ['.continue/config.json', '.continuerules'] },
    { tool: 'Cline', files: ['.clinerules', '.cline/settings.json'] },
    { tool: 'Codex', files: ['codex.md', 'AGENTS.md'] },
  ];

  for (const check of toolChecks) {
    const foundFiles: string[] = [];
    for (const file of check.files) {
      if (await fileExists(join(rootPath, file))) {
        foundFiles.push(file);
      }
    }
    if (foundFiles.length > 0) {
      results.push({ tool: check.tool, files: foundFiles });
    }
  }

  return results;
}

function computeScore(report: WorkflowReport): { score: number; detected: string[]; missing: string[] } {
  const categories = [
    { name: 'task tracking', present: report.tasks.length > 0 },
    { name: 'lessons', present: report.lessons.length > 0 },
    { name: 'plans', present: report.plans.length > 0 },
    { name: 'AI config', present: report.aiTools.length > 0 },
    { name: 'CI integration', present: false }, // Would need .github/workflows check
  ];

  // Check for CI integration
  const ciCategory = categories.find(c => c.name === 'CI integration');
  if (ciCategory) {
    // Will be set externally if detected
  }

  const detected = categories.filter(c => c.present).map(c => c.name);
  const missing = categories.filter(c => !c.present).map(c => c.name);
  const score = detected.length;

  return { score, detected, missing };
}

export async function analyzeWorkflow(rootPath: string): Promise<WorkflowReport> {
  const [tasks, lessons, plans, aiTools] = await Promise.all([
    detectTasks(rootPath),
    detectLessons(rootPath),
    detectPlans(rootPath),
    detectAIToolConfigs(rootPath),
  ]);

  const report: WorkflowReport = {
    tasks,
    lessons,
    plans,
    aiTools,
    score: 0,
    maxScore: 5,
    detected: [],
    missing: [],
  };

  // Check CI integration
  const ciFiles = ['.github/workflows', '.gitlab-ci.yml', 'Jenkinsfile', '.circleci/config.yml'];
  for (const ciFile of ciFiles) {
    if (await fileExists(join(rootPath, ciFile))) {
      report.maxScore = 5;
      // Mark CI as detected by adjusting score calculation
      const { score, detected, missing } = computeScore(report);
      report.score = score + 1;
      report.detected = [...detected, 'CI integration'];
      report.missing = missing.filter(m => m !== 'CI integration');
      return report;
    }
  }

  const { score, detected, missing } = computeScore(report);
  report.score = score;
  report.detected = detected;
  report.missing = missing;

  return report;
}

export function registerWorkflowCommand(program: Command): void {
  program
    .command('workflow')
    .argument('[path]', 'Path to analyze', '.')
    .description('Detect and report on agentic workflow patterns (tasks, lessons, plans, AI tools)')
    .option('--json', 'Output as JSON')
    .action(async (path: string, options: { json?: boolean }) => {
      if (options.json) {
        setLogLevel('silent');
      }

      const rootPath = join(process.cwd(), path);
      const report = await analyzeWorkflow(rootPath);

      if (options.json) {
        console.log(JSON.stringify(report, null, 2));
        return;
      }

      const chalk = (await import('chalk')).default;

      console.log(chalk.bold('\nAgentic Workflow Analysis\n'));

      // Task Tracking
      console.log(chalk.bold('  Task Tracking'));
      if (report.tasks.length > 0) {
        for (const task of report.tasks) {
          const pctColor = task.completionPct >= 75 ? chalk.green : task.completionPct >= 50 ? chalk.yellow : chalk.red;
          console.log(
            `    ${basename(task.file)}: ${task.total} tasks (${task.completed} complete, ${task.pending} pending) — ${pctColor(`${task.completionPct}%`)}`
          );
        }
      } else {
        console.log(chalk.dim('    No task tracking files found'));
      }
      console.log('');

      // Self-Improvement
      console.log(chalk.bold('  Self-Improvement'));
      if (report.lessons.length > 0) {
        for (const lesson of report.lessons) {
          console.log(`    ${lesson.file}: ${lesson.count} lessons captured`);
        }
      } else {
        console.log(chalk.dim('    No lessons files found'));
      }
      console.log('');

      // Plans
      console.log(chalk.bold('  Plans'));
      if (report.plans.length > 0) {
        for (const plan of report.plans) {
          console.log(`    ${plan.directory}: ${plan.files.length} plan file${plan.files.length !== 1 ? 's' : ''}`);
          for (const file of plan.files) {
            console.log(chalk.dim(`      - ${file}`));
          }
        }
      } else {
        console.log(chalk.dim('    No plan files found'));
      }
      console.log('');

      // AI Tool Configs
      console.log(chalk.bold('  AI Tool Configs'));
      if (report.aiTools.length > 0) {
        for (const tool of report.aiTools) {
          console.log(`    ${tool.tool}: ${tool.files.join(', ')}`);
        }
      } else {
        console.log(chalk.dim('    No AI tool configurations found'));
      }
      console.log('');

      // Workflow Score
      const scoreColor = report.score >= 4 ? chalk.green : report.score >= 2 ? chalk.yellow : chalk.red;
      const detectedStr = report.detected.length > 0 ? report.detected.join(', ') : 'none';
      const missingStr = report.missing.length > 0 ? `missing: ${report.missing.join(', ')}` : 'all detected';

      console.log(
        chalk.bold('  Workflow Score: ') +
        scoreColor(`${report.score}/${report.maxScore}`) +
        ` (${detectedStr}; ${missingStr})`
      );
      console.log('');
    });
}
