import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import {
  formatSkillsForPrompt,
  loadSkills,
  type ResourceDiagnostic,
  type Skill,
} from "@earendil-works/pi-coding-agent";
import { defineExtension, type Extension, section } from "@earendil-works/pi-durable";

/**
 * Skills are Pi's on-demand capability packages: a directory with a `SKILL.md` whose frontmatter
 * carries a `name` and a `description`. Pi lists the descriptions in the system prompt and the model
 * loads a skill's body with `read` when the task matches, so discovery is the only thing a harness
 * has to do — the tooling is already there.
 *
 * Pi Durable ships no discovery, and its registry is where a section belongs, so this module asks Pi's
 * own loader (`@earendil-works/pi-coding-agent`, the CLI) for the skills and installs one untagged
 * prompt section with the result. Same loader, same validation, same directory layout as `pi`.
 */

/** Pi's own override for its agent config directory; `<agentDir>/skills` is the global root. */
const AGENT_DIR_ENV = "PI_CODING_AGENT_DIR";

/** Extra skill roots, `:`-separated. Pi has no equivalent variable; this is a Nexus addition. */
const EXTRA_DIRS_ENV = "NEXUS_SKILLS_DIR";

/** `~` is not a shell, so a configured path has to expand it the way Pi's own config does. */
function expandTilde(path: string): string {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? resolve(homedir(), path.slice(2)) : resolve(path);
}

/** The global skills directory, `<agentDir>/skills`: `~/.pi/agent/skills` unless overridden. */
export function skillsAgentDir(env: Record<string, string | undefined> = process.env): string {
  const configured = env[AGENT_DIR_ENV];
  return configured === undefined || configured === ""
    ? join(homedir(), ".pi", "agent")
    : expandTilde(configured);
}

/**
 * Roots outside Pi's defaults: the shared `.agents/skills` convention (global and per project) and
 * anything named in `NEXUS_SKILLS_DIR`. Only existing directories, because Pi warns per missing path
 * and a warning nobody can act on is noise.
 */
export function skillsExtraDirs(
  cwd: string,
  env: Record<string, string | undefined> = process.env,
): string[] {
  const configured = (env[EXTRA_DIRS_ENV] ?? "")
    .split(":")
    .filter((entry) => entry.trim() !== "")
    .map(expandTilde);
  return [
    ...configured,
    join(homedir(), ".agents", "skills"),
    join(cwd, ".agents", "skills"),
  ].filter(existsSync);
}

export interface SessionSkills {
  skills: Skill[];
  diagnostics: ResourceDiagnostic[];
  /** Pi's `<available_skills>` block, or `undefined` when there is nothing to advertise. */
  prompt: string | undefined;
}

export interface SessionSkillsInput {
  /** The conversation's worktree; `.pi/skills` and `.agents/skills` below it are project roots. */
  cwd: string;
  agentDir?: string;
  extraDirs?: readonly string[];
  env?: Record<string, string | undefined>;
}

/** Discover this session's skills and render the prompt block Pi would render. */
export function loadSessionSkills(input: SessionSkillsInput): SessionSkills {
  const env = input.env ?? process.env;
  const result = loadSkills({
    cwd: input.cwd,
    agentDir: input.agentDir ?? skillsAgentDir(env),
    skillPaths: [...(input.extraDirs ?? skillsExtraDirs(input.cwd, env))],
    includeDefaults: true,
  });
  return {
    skills: result.skills,
    diagnostics: result.diagnostics,
    prompt: result.skills.length === 0 ? undefined : formatSkillsForPrompt(result.skills),
  };
}

/** Warnings already logged. A section renders before every request; the same warning is not news. */
const reported = new Set<string>();

function reportDiagnostics(diagnostics: readonly ResourceDiagnostic[]): void {
  for (const diagnostic of diagnostics) {
    const path = diagnostic.path ?? "";
    const key = `${path}:${diagnostic.message}`;
    if (reported.has(key)) continue;
    reported.add(key);
    console.error(`nexus: skill warning: ${diagnostic.message} (${path})`);
  }
}

/**
 * The `skills` extension. Rendered before every request rather than fixed at spawn, so a skill added
 * to a root mid-session is advertised on the next turn. Untagged, because Pi's block supplies its own
 * preamble and `<available_skills>` element.
 */
export function createSkillsExtension(): Extension {
  return defineExtension({
    name: "skills",
    sections: [
      section(
        "skills",
        (input) => {
          const cwd = input.agent.cwd;
          if (cwd === undefined) return undefined;
          const { diagnostics, prompt } = loadSessionSkills({ cwd });
          reportDiagnostics(diagnostics);
          return prompt;
        },
        { tag: false },
      ),
    ],
  });
}
