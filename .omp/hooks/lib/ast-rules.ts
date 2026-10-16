// @ts-expect-error — Node builtin, not project-compiled
import { execFileSync } from "node:child_process";
// @ts-expect-error — Node builtin, not project-compiled
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
// @ts-expect-error — Node builtin, not project-compiled
import { join } from "node:path";

/**
 * AST rule runner — shared by post hooks that validate code structure with
 * ast-grep rules (.omp/ast-grep/rules/*.yml).
 *
 * Each rule YAML is an ast-grep rule config. Two modes:
 *   - Negative rules (default): a match is a violation. Used for "must not
 *     look like this" checks (e.g. non-async service method).
 *   - Positive rules (`expect: present`): a match is the expected pattern;
 *     absence of any match is a violation. Used for "must contain this"
 *     checks (e.g. `Service(session)` constructor call).
 *
 * The runner returns one issue string per violation, prefixed with the rule id.
 */

export interface AstRuleResult {
  ruleId: string;
  file: string;
  line: number;
  text: string;
}

interface AstGrepMatch {
  file: string;
  range?: { start?: { line?: number } };
  text?: string;
  message?: string;
  ruleId?: string;
}

/**
 * Runs every rule in the given directory against the given paths.
 * Returns one issue per violation: `ruleId: message — file:line`.
 *
 * Silence is never a pass. These rules are the **only** owner of their
 * invariants (omp-ast-rules.md), so a missing binary or an unparsable rule is
 * reported as an issue: degrading quietly would turn `make verify` green while
 * nothing structural ran.
 */
export function runAstRules(rulesDir: string, paths: string[]): string[] {
  const scope = rulesDir.split(/[\\/]/).pop() ?? rulesDir;
  const astGrep = findAstGrep();
  if (astGrep === null) {
    return [
      `ast-grep/rules/${scope}/: ast-grep not found — the structural rules did not run. ` +
        "Install it (cd frontend && npm install) — these rules are the only check for " +
        "their invariants",
    ];
  }

  const issues: string[] = [];
  for (const ruleFile of readdirSync(rulesDir).filter((f: string) => f.endsWith(".yml"))) {
    const rulePath = join(rulesDir, ruleFile);
    let ruleContent: string | null = null;
    try {
      ruleContent = readFileSync(rulePath, "utf-8");
    } catch {
      issues.push(`ast-grep/rules/${scope}/${ruleFile}: unreadable — the rule did not run`);
      continue;
    }
    if (!ruleContent) {
      issues.push(`ast-grep/rules/${scope}/${ruleFile}: empty — the rule did not run`);
      continue;
    }

    const expectPresent = /^expect:\s*present\s*$/m.test(ruleContent);
    if (expectPresent) {
      // Positive rule: run per file so a violation in one file is not masked
      // by a compliant file in the same directory (e.g. batch/).
      for (const p of expandPaths(paths)) {
        const matches = runRule(astGrep, rulePath, [p]);
        if (matches === null) {
          issues.push(`ast-grep/rules/${scope}/${ruleFile}: ast-grep could not run this rule`);
          break;
        }
        if (matches.length === 0) {
          issues.push(`${ruleFile}: ${extractMessage(ruleContent)} — no match found in ${p}`);
        }
      }
    } else {
      // Negative rule: each match is a violation (single scan across paths).
      const matches = runRule(astGrep, rulePath, paths);
      if (matches === null) {
        issues.push(
          `ast-grep/rules/${scope}/${ruleFile}: ast-grep could not run this rule — fix the YAML ` +
            "(make check-ast-rules) instead of letting it pass silently",
        );
        continue;
      }
      for (const m of matches) {
        const line = m.range?.start?.line !== undefined ? m.range.start.line + 1 : 0;
        const text = (m.text ?? "").split("\n")[0].trim();
        issues.push(`${ruleFile}: ${m.message ?? extractMessage(ruleContent)} — ${m.file}:${line}${text ? ` (${text})` : ""}`);
      }
    }
  }
  return issues;
}

/**
 * Expands paths to individual files. Directories are walked recursively for
 * .py files (all rules are python-language). Used by expect-present rules so
 * each file is judged independently.
 *
 * A file path is passed through: probing it with readdirSync threw ENOTDIR and
 * crashed the calling hook — a hook that hands one module to an
 * `expect: present` rule is the normal case, not an edge case.
 */
function expandPaths(paths: string[]): string[] {
  const files: string[] = [];
  for (const p of paths) {
    if (!existsSync(p)) continue;
    if (!statSync(p).isDirectory()) {
      if (p.endsWith(".py")) files.push(p);
      continue;
    }
    // Directory: walk for .py files.
    const stack = [p];
    while (stack.length > 0) {
      const dir = stack.pop()!;
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.endsWith(".py") && entry.name !== "__init__.py") {
          files.push(full);
        }
      }
    }
  }
  return files;
}

function runRule(astGrep: string, rulePath: string, paths: string[]): AstGrepMatch[] | null {
  try {
    const out = execFileSync(astGrep, ["scan", "--rule", rulePath, ...paths, "--json", "--include-metadata"], {
      encoding: "utf-8",
      timeout: 15_000,
    });
    return JSON.parse(out) as AstGrepMatch[];
  } catch {
    return null; // rule parse error or ast-grep failure — skip silently
  }
}

function extractMessage(ruleContent: string): string {
  const m = ruleContent.match(/^message:\s*(.+)$/m);
  return m ? m[1].trim() : "ast-grep rule violation";
}

/**
 * Locates a *working* ast-grep: the frontend dev dependency first, then $PATH.
 * The candidate is probed with `--version`, because assuming $PATH resolves it
 * turns a missing binary into a per-rule "could not run this rule" — the right
 * failure with the wrong cause. Returns null when nothing runs.
 */
function findAstGrep(): string | null {
  const candidates = [
    join(process.cwd(), "frontend", "node_modules", ".bin", "ast-grep"),
    join(process.cwd(), "..", "frontend", "node_modules", ".bin", "ast-grep"),
    "ast-grep",
  ];
  for (const candidate of candidates) {
    if (candidate !== "ast-grep" && !existsSync(candidate)) continue;
    try {
      execFileSync(candidate, ["--version"], { stdio: "pipe", timeout: 5_000 });
      return candidate;
    } catch {
      continue;
    }
  }
  return null;
}
