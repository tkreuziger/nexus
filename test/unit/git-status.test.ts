import { describe, expect, test } from "bun:test";
import { parseStatus } from "../../src/projects/git.ts";

const HEADER = "# branch.oid 1111111111111111111111111111111111111111";

describe("parseStatus", () => {
  test("reads a clean branch with no upstream", () => {
    const status = parseStatus([HEADER, "# branch.head main"].join("\n"));
    expect(status).toEqual({ branch: "main", dirty: [], ahead: 0, behind: 0 });
  });

  test("reads ahead and behind counts", () => {
    const status = parseStatus([HEADER, "# branch.head main", "# branch.ab +2 -3"].join("\n"));
    expect(status.ahead).toBe(2);
    expect(status.behind).toBe(3);
  });

  test("collects modified and untracked paths", () => {
    const status = parseStatus(
      [
        HEADER,
        "# branch.head main",
        "1 .M N... 100644 100644 100644 aaa bbb src/app.ts",
        "? notes.txt",
      ].join("\n"),
    );
    expect(status.dirty).toEqual(["notes.txt", "src/app.ts"]);
  });

  test("reads the path from a renamed entry", () => {
    const status = parseStatus(
      [
        HEADER,
        "# branch.head main",
        "2 R. N... 100644 100644 100644 aaa bbb R100 old.ts\tnew.ts",
      ].join("\n"),
    );
    expect(status.dirty).toEqual(["old.ts\tnew.ts"]);
  });

  test("reports a detached head", () => {
    const status = parseStatus([HEADER, "# branch.head (detached)"].join("\n"));
    expect(status.branch).toBe("(detached)");
  });
});
