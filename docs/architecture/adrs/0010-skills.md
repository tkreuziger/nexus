# ADR-10: Skills are Pi's, loaded through the Pi client package

Sessions had no way to give an agent reusable, on-demand instructions. Pi has a convention for exactly that — a directory with a `SKILL.md` whose frontmatter carries a `name` and a `description` — and `INPUT.md` says nothing about it.

## Context

A skill is progressive disclosure: only the name and description stay in the system prompt, and the model reads the body when a task matches. Nothing about that requires a new tool — `read` is already in `CodingTools` — so discovery and one prompt section is the whole feature.

Two questions had to be settled:

1. **Who discovers skills?** Pi Durable has no skills module. Its registry does have prompt sections (`defineExtension` + `section`), which is where an advertisement belongs, and its default extension selection is "everything installed", so an installed section applies to every conversation without touching stored agent state. The client package (`@earendil-works/pi-coding-agent`) owns the loader: `loadSkills`, `loadSkillsForDir`, and `formatSkillsForPrompt` are exported from its package root.
2. **Reuse or reimplement?** The loader is ~400 lines of `node:fs` plus validation: recursive `SKILL.md` discovery that stops at a skill root, root `.md` files only in Pi's own roots, ignore files, symlink dedupe by canonical path, name-collision precedence, and the warning set. Reimplementing it would drift from `pi` on exactly the cases that make shared skill directories work.

## Decision

Depend on `@earendil-works/pi-coding-agent`, pinned exactly at `1.1.0` like the other `@earendil-works` packages, and call its exported `loadSkills` and `formatSkillsForPrompt` from a `skills` extension that the harness installs next to `CodingTools`.

The roots are Pi's, so a skill installed for the CLI is visible to a session: `<agentDir>/skills` (`~/.pi/agent/skills`, movable with `PI_CODING_AGENT_DIR`) and `<cwd>/.pi/skills` come from `includeDefaults`; `~/.agents/skills`, `<cwd>/.agents/skills`, and anything in `NEXUS_SKILLS_DIR` are passed as explicit paths, existing ones only. The section renders before every request, so discovery re-runs per turn instead of being frozen into the conversation's stored `instructions`.

## Consequences

- The prompt block, the validation, and the directory layout cannot diverge from `pi`'s — a fix upstream arrives with a version bump.
- `pi-coding-agent` is a CLI/TUI package: 23 MB unpacked, ~120 transitive packages, and one to two seconds of module evaluation per harness process, because the public entry point is the only import the package's `exports` allow (a deep import of `dist/core/skills.js` measures 0.19 s, but it is not contract). The harness pays it once per session process, next to Pi Durable's own startup.
- `@earendil-works/pi-coding-agent@1.1.0` depends on `pi-ai ^1.1.0`, `chord ^1.1.0`, and `pi-agent-core ^1.1.0`, so it resolves against the versions already pinned here rather than adding a second copy of any of them.
- A skill is untrusted instruction content by nature: it can tell the model to run anything. The README says so, and a project's committed skills are only as safe as the repository.
- Project skills are read from the session's worktree, so they follow the branch the session was created from rather than the registered checkout.

## Related

- `README.md` — "Skills"
- `src/harness/skills.ts` — loader, roots, and the extension
- `docs/architecture/pi-durable-api.md` — the Pi Durable surface this builds on
