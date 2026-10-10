import type { Database } from "bun:sqlite";
import { beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runGit } from "../../src/projects/git.ts";
import { registerProject, requireProject } from "../../src/projects/registry.ts";
import { openStore } from "../../src/store/db.ts";
import type { ProjectId, UserId } from "../../src/types.ts";

const ownerId = "owner-1" as UserId;
let db: Database;
let base: string;

const makeRepo = async (name: string): Promise<string> => {
  const path = join(base, name);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "README.md"), "# hi\n");
  await runGit(["init", "-b", "main"], path);
  await runGit(["add", "."], path);
  await runGit(
    ["-c", "user.email=t@example.com", "-c", "user.name=T", "commit", "-m", "init"],
    path,
  );
  return path;
};

beforeEach(() => {
  db = openStore(":memory:");
  db.query(
    "INSERT INTO users (id, handle, token_id, token_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(ownerId, "tristan", "tid", "hash", new Date().toISOString());
  base = mkdtempSync(join(tmpdir(), "nexus-registry-"));
});

describe("registerProject", () => {
  test("registers a git repository folder", async () => {
    const path = await makeRepo("alpha");
    const project = await registerProject(db, ownerId, { path });
    expect(project.path).toBe(path);
    expect(project.ownerId).toBe(ownerId);
    expect(project.assignedAuthMethodId).toBeNull();
    expect(project.defaultModel).toBeNull();
  });

  test("defaults the display name to the folder name", async () => {
    const path = await makeRepo("beta");
    const project = await registerProject(db, ownerId, { path });
    expect(project.name).toBe(basename(path));
  });

  test("honours an explicit display name", async () => {
    const path = await makeRepo("gamma");
    const project = await registerProject(db, ownerId, { path, name: "Gamma Project" });
    expect(project.name).toBe("Gamma Project");
  });

  test("resolves a relative path to an absolute one", async () => {
    const path = await makeRepo("delta");
    const project = await registerProject(db, ownerId, { path: join(path, ".") });
    expect(project.path).toBe(path);
  });

  test("rejects a duplicate path with 409", async () => {
    const path = await makeRepo("epsilon");
    await registerProject(db, ownerId, { path });
    await expect(registerProject(db, ownerId, { path })).rejects.toMatchObject({ status: 409 });
  });

  test("rejects a non-git folder with 422", async () => {
    const path = join(base, "plain");
    mkdirSync(path, { recursive: true });
    await expect(registerProject(db, ownerId, { path })).rejects.toMatchObject({ status: 422 });
  });

  test("rejects a subdirectory of a repository with 422", async () => {
    const path = await makeRepo("zeta");
    const nested = join(path, "src");
    mkdirSync(nested, { recursive: true });
    await expect(registerProject(db, ownerId, { path: nested })).rejects.toMatchObject({
      status: 422,
    });
  });

  test("rejects a missing path with 422", async () => {
    await expect(registerProject(db, ownerId, { path: join(base, "ghost") })).rejects.toMatchObject(
      {
        status: 422,
      },
    );
  });

  test("rejects a file with 422", async () => {
    const file = join(base, "a-file.txt");
    writeFileSync(file, "x");
    await expect(registerProject(db, ownerId, { path: file })).rejects.toMatchObject({
      status: 422,
    });
  });
});

describe("requireProject", () => {
  test("returns the project for its owner", async () => {
    const path = await makeRepo("eta");
    const project = await registerProject(db, ownerId, { path });
    expect(requireProject(db, project.id, ownerId).id).toBe(project.id);
  });

  test("hides another user's project behind 404", async () => {
    const path = await makeRepo("theta");
    const project = await registerProject(db, ownerId, { path });
    expect(() => requireProject(db, project.id, "someone-else" as UserId)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });

  test("404s an unknown id", () => {
    expect(() => requireProject(db, "nope" as ProjectId, ownerId)).toThrow(
      expect.objectContaining({ status: 404 }),
    );
  });
});
