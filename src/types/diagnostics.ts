/**
 * Diagnostic, lint, security, and improvement suggestion types.
 */

export interface DiagnosticCheck {
  name: string;
  status: 'pass' | 'warn' | 'fail';
  message: string;
  details?: string;
}

export interface LintWarning {
  file: string;
  rule: string;
  severity: 'error' | 'warning' | 'info';
  message: string;
  line?: number;
}

export interface SecurityFinding {
  file: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium' | 'low';
  message: string;
  line?: number;
  snippet?: string;
}

export interface ImprovementSuggestion {
  category: string;
  priority: 'high' | 'medium' | 'low';
  message: string;
  details?: string;
}
