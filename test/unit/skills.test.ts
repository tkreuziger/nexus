import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { loadSessionSkills, skillsAgentDir, skillsExtraDirs } from "../../src/harness/skills.ts";

const roots: string[] = [];

/** A fresh directory holding `agent/` and `work/`, removed with the test's other roots. */
function fixture(): { root: string; agentDir: string; work: string } {
  const root = mkdtempSync(join(tmpdir(), "nexus-skills-"));
  roots.push(root);
  const agentDir = join(root, "agent");
  const work = join(root, "work");
  mkdirSync(agentDir, { recursive: true });
  mkdirSync(work, { recursive: true });
  return { root, agentDir, work };
}

/** Write a skill the way Pi and the Agent Skills standard expect it. */
function writeSkill(
  dir: string,
  name: string | undefined,
  description: string | undefined,
): string {
  mkdirSync(dir, { recursive: true });
  const frontmatter = [
    ...(name === undefined ? [] : [`name: ${name}`]),
    ...(description === undefined ? [] : [`description: ${description}`]),
  ].join("\n");
  const file = join(dir, "SKILL.md");
  writeFileSync(file, `---\n${frontmatter}\n---\n\n# ${name ?? "unnamed"}\n\nBody.\n`);
  return file;
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("skill discovery", () => {
  test("loads a nested SKILL.md and a root markdown file from the agent directory", () => {
    const { agentDir, work } = fixture();
    writeSkill(join(agentDir, "skills", "alpha"), "alpha", "Alpha skill.");
    writeFileSync(
      join(agentDir, "skills", "beta.md"),
      "---\nname: beta\ndescription: Beta skill.\n---\n\nBeta body.\n",
    );

    const { skills, diagnostics } = loadSessionSkills({ cwd: work, agentDir, extraDirs: [] });

    expect(skills.map((skill) => skill.name).sort()).toEqual(["alpha", "beta"]);
    expect(diagnostics).toEqual([]);
  });

  test("loads project skills from the worktree and the extra roots", () => {
    const { root, agentDir, work } = fixture();
    writeSkill(join(work, ".pi", "skills", "project-skill"), "project-skill", "From the worktree.");
    writeSkill(join(root, "shared", "shared-skill"), "shared-skill", "From an extra root.");

    const { skills } = loadSessionSkills({
      cwd: work,
      agentDir,
      extraDirs: [join(root, "shared")],
    });

    expect(skills.map((skill) => skill.name).sort()).toEqual(["project-skill", "shared-skill"]);
  });

  test("renders Pi's available_skills block with absolute locations", () => {
    const { agentDir, work } = fixture();
    const file = writeSkill(join(agentDir, "skills", "alpha"), "alpha", "Alpha skill.");

    const { prompt } = loadSessionSkills({ cwd: work, agentDir, extraDirs: [] });

    expect(prompt).toContain("<available_skills>");
    expect(prompt).toContain("<name>alpha</name>");
    expect(prompt).toContain("<description>Alpha skill.</description>");
    expect(prompt).toContain(`<location>${file}</location>`);
  });

  test("has no prompt when nothing is discoverable", () => {
    const { agentDir, work } = fixture();

    const { skills, prompt } = loadSessionSkills({ cwd: work, agentDir, extraDirs: [] });

    expect(skills).toEqual([]);
    expect(prompt).toBeUndefined();
  });

  test("reports a malformed skill instead of loading it", () => {
    const { agentDir, work } = fixture();
    const file = writeSkill(join(agentDir, "skills", "gamma"), "Gamma_Bad", undefined);

    const { skills, diagnostics } = loadSessionSkills({ cwd: work, agentDir, extraDirs: [] });

    expect(skills).toEqual([]);
    expect(new Set(diagnostics.map((diagnostic) => diagnostic.path))).toEqual(new Set([file]));
  });
});

describe("skill roots", () => {
  test("defaults the global root to Pi's agent directory", () => {
    expect(skillsAgentDir({})).toBe(join(homedir(), ".pi", "agent"));
  });

  test("honours PI_CODING_AGENT_DIR, expanding a leading tilde", () => {
    expect(skillsAgentDir({ PI_CODING_AGENT_DIR: "/srv/pi" })).toBe("/srv/pi");
    expect(skillsAgentDir({ PI_CODING_AGENT_DIR: "~/pi-agent" })).toBe(join(homedir(), "pi-agent"));
  });

  test("takes NEXUS_SKILLS_DIR entries and the project .agents directory, skipping missing ones", () => {
    const { root, work } = fixture();
    const present = join(root, "configured");
    mkdirSync(present, { recursive: true });
    mkdirSync(join(work, ".agents", "skills"), { recursive: true });

    const dirs = skillsExtraDirs(work, {
      NEXUS_SKILLS_DIR: `${present}:${join(root, "absent")}`,
    });

    expect(dirs).toEqual([present, join(work, ".agents", "skills")]);
    expect(existsSync(join(root, "absent"))).toBe(false);
  });
});
