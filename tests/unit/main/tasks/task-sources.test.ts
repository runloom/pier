import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectTaskCandidates } from "@main/services/tasks/task-sources.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

describe("task sources", () => {
  let projectRoot = "";
  let homeDir = "";

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "pier-task-sources-"));
    homeDir = await mkdtemp(join(tmpdir(), "pier-task-home-"));
  });

  afterEach(async () => {
    await rm(projectRoot, { force: true, recursive: true });
    await rm(homeDir, { force: true, recursive: true });
  });

  it("normalizes supported task sources into task candidates", async () => {
    await mkdir(join(projectRoot, ".vscode"));
    await mkdir(join(projectRoot, ".zed"));
    await mkdir(join(homeDir, ".config", "zed"), { recursive: true });
    await writeFile(
      join(projectRoot, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc --noEmit",
        },
      })
    );
    await writeFile(join(projectRoot, "pnpm-lock.yaml"), "lockfileVersion: 9");
    await writeFile(
      join(projectRoot, ".vscode", "tasks.json"),
      JSON.stringify({
        tasks: [
          {
            command: "pnpm lint",
            label: "lint",
            type: "shell",
          },
        ],
        version: "2.0.0",
      })
    );
    await writeFile(
      join(projectRoot, ".zed", "tasks.json"),
      JSON.stringify([
        {
          allow_concurrent_runs: true,
          command: "pnpm test",
          label: "test",
          tags: ["verify"],
        },
      ])
    );
    await writeFile(
      join(homeDir, ".config", "zed", "tasks.json"),
      JSON.stringify([{ command: "echo global", label: "global task" }])
    );
    await writeFile(
      join(projectRoot, "Cargo.toml"),
      '[package]\nname = "pier_native"\n'
    );
    await writeFile(join(projectRoot, "Makefile"), "serve:\n\tpython app.py\n");
    await writeFile(
      join(projectRoot, "pyproject.toml"),
      '[project.scripts]\npier-tool = "pier.cli:main"\n'
    );
    await writeFile(
      join(projectRoot, ".mise.toml"),
      '[tasks.dev]\nrun = "pnpm dev"\n'
    );
    await writeFile(join(projectRoot, "Justfile"), "fmt:\n    pnpm lint\n");
    await writeFile(
      join(projectRoot, "Taskfile.yml"),
      "tasks:\n  clean:\n    cmd: rm -rf out\n"
    );

    const result = await collectTaskCandidates({
      homeDir,
      projectRoot,
      recentTasks: [
        {
          command: "pnpm check",
          cwd: projectRoot,
          label: "pnpm check",
          source: "history",
        },
      ],
    });

    expect(result.errors).toEqual([]);
    expect(
      result.tasks.map((task) => [task.source, task.label, task.commandSpec])
    ).toEqual(
      expect.arrayContaining([
        [
          "package-script",
          "build",
          { command: "pnpm run build", kind: "shell" },
        ],
        ["vscode", "lint", { command: "pnpm lint", kind: "shell" }],
        ["zed", "test", { command: "pnpm test", kind: "shell" }],
        ["zed", "global task", { command: "echo global", kind: "shell" }],
        ["cargo", "cargo build", { command: "cargo build", kind: "shell" }],
        ["make", "serve", { command: "make serve", kind: "shell" }],
        ["pyproject", "pier-tool", { command: "pier-tool", kind: "shell" }],
        ["mise", "dev", { command: "mise run dev", kind: "shell" }],
        ["just", "fmt", { command: "just fmt", kind: "shell" }],
        ["taskfile", "clean", { command: "task clean", kind: "shell" }],
        ["history", "pnpm check", { command: "pnpm check", kind: "shell" }],
      ])
    );
  });

  it("collects deno.json(c) tasks including object-form tasks", async () => {
    await writeFile(
      join(projectRoot, "deno.jsonc"),
      `{
        // jsonc comment
        "tasks": {
          "dev": "deno run -A --watch main.ts",
          "check": { "command": "deno lint", "description": "Lint sources" }
        }
      }`
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(result.errors).toEqual([]);
    expect(
      result.tasks
        .filter((task) => task.source === "deno")
        .map((task) => [task.label, task.commandSpec, task.description])
    ).toEqual([
      [
        "dev",
        { command: "deno task dev", kind: "shell" },
        "deno run -A --watch main.ts",
      ],
      ["check", { command: "deno task check", kind: "shell" }, "Lint sources"],
    ]);
  });

  it("collects composer scripts and skips lifecycle event hooks", async () => {
    await writeFile(
      join(projectRoot, "composer.json"),
      JSON.stringify({
        scripts: {
          "post-install-cmd": "php artisan clear",
          test: ["phpunit", "phpstan analyse"],
        },
      })
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(result.errors).toEqual([]);
    expect(
      result.tasks
        .filter((task) => task.source === "composer")
        .map((task) => [task.label, task.commandSpec, task.description])
    ).toEqual([
      [
        "test",
        { command: "composer run-script test", kind: "shell" },
        "phpunit && phpstan analyse",
      ],
    ]);
  });

  it("collects cargo aliases from .cargo/config.toml", async () => {
    await writeFile(
      join(projectRoot, "Cargo.toml"),
      '[package]\nname = "demo"\n'
    );
    await mkdir(join(projectRoot, ".cargo"));
    await writeFile(
      join(projectRoot, ".cargo", "config.toml"),
      '[alias]\nlint = "clippy --all-targets"\n'
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(
      result.tasks
        .filter((task) => task.source === "cargo")
        .map((task) => task.label)
    ).toEqual([
      "cargo build",
      "cargo test",
      "cargo check",
      "cargo run",
      "cargo lint",
    ]);
  });

  it("keeps Taskfile parsing inside the tasks block and supports 4-space indent + namespaced names", async () => {
    await writeFile(
      join(projectRoot, "Taskfile.yml"),
      [
        "version: '3'",
        "tasks:",
        "    build:",
        "        cmds:",
        "            - go build",
        "    docs:publish:",
        "        cmds:",
        "            - mkdocs deploy",
        "vars:",
        "  GREETING: hello",
        "",
      ].join("\n")
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(
      result.tasks
        .filter((task) => task.source === "taskfile")
        .map((task) => task.label)
    ).toEqual(["build", "docs:publish"]);
  });

  it("excludes just assignments and [private] recipes", async () => {
    await writeFile(
      join(projectRoot, "Justfile"),
      [
        'set shell := ["bash", "-c"]',
        "alias b := build",
        "",
        "build:",
        "    cargo build",
        "",
        "[private]",
        "hidden-task:",
        "    echo hidden",
        "",
        "_helper:",
        "    echo helper",
        "",
      ].join("\n")
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(
      result.tasks
        .filter((task) => task.source === "just")
        .map((task) => task.label)
    ).toEqual(["build"]);
  });

  it("collects quoted mise task section names", async () => {
    await writeFile(
      join(projectRoot, ".mise.toml"),
      '[tasks."docs:build"]\nrun = "mkdocs build"\n\n[tasks.dev]\nrun = "pnpm dev"\n'
    );

    const result = await collectTaskCandidates({ homeDir, projectRoot });

    expect(
      result.tasks
        .filter((task) => task.source === "mise")
        .map((task) => task.label)
        .sort()
    ).toEqual(["dev", "docs:build"]);
  });
});
