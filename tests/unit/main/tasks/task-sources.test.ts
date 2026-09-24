import { chmod, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveTaskListPathEnv } from "@main/services/tasks/command-path.ts";
import { collectTaskCandidates } from "@main/services/tasks/sources.ts";
import { executableOnPath } from "@main/services/tasks/utils.ts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

function collect(
  options: Parameters<typeof collectTaskCandidates>[0]
): ReturnType<typeof collectTaskCandidates> {
  return collectTaskCandidates({
    commandExists: () => true,
    ...options,
  });
}

describe("task sources", () => {
  let projectRootPath = "";

  beforeEach(async () => {
    projectRootPath = await mkdtemp(join(tmpdir(), "pier-task-sources-"));
  });

  afterEach(async () => {
    await rm(projectRootPath, { force: true, recursive: true });
  });

  it("normalizes supported task sources into task candidates", async () => {
    await mkdir(join(projectRootPath, ".vscode"));
    await mkdir(join(projectRootPath, ".zed"));
    await writeFile(
      join(projectRootPath, "package.json"),
      JSON.stringify({
        scripts: {
          build: "tsc --noEmit",
        },
      })
    );
    await writeFile(
      join(projectRootPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9"
    );
    await writeFile(
      join(projectRootPath, ".vscode", "tasks.json"),
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
      join(projectRootPath, ".zed", "tasks.json"),
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
      join(projectRootPath, "Cargo.toml"),
      '[package]\nname = "pier_native"\n'
    );
    await writeFile(
      join(projectRootPath, "Makefile"),
      "serve:\n\tpython app.py\n"
    );
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      '[project.scripts]\npier-tool = "pier.cli:main"\n'
    );
    await writeFile(
      join(projectRootPath, ".mise.toml"),
      '[tasks.dev]\nrun = "pnpm dev"\n'
    );
    await writeFile(join(projectRootPath, "Justfile"), "fmt:\n    pnpm lint\n");
    await writeFile(
      join(projectRootPath, "Taskfile.yml"),
      "tasks:\n  clean:\n    cmd: rm -rf out\n"
    );

    const result = await collect({
      projectRootPath,
      recentTasks: [
        {
          command: "pnpm check",
          cwd: projectRootPath,
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
        ["cargo", "cargo build", { command: "cargo build", kind: "shell" }],
        ["make", "serve", { command: "make serve", kind: "shell" }],
        ["pyproject", "pier-tool", { command: "pier-tool", kind: "shell" }],
        ["mise", "dev", { command: "mise run dev", kind: "shell" }],
        ["just", "fmt", { command: "just fmt", kind: "shell" }],
        ["taskfile", "clean", { command: "task clean", kind: "shell" }],
        ["history", "pnpm check", { command: "pnpm check", kind: "shell" }],
      ])
    );
    expect(result.tasks.map((task) => task.label)).not.toContain("test");
    expect(
      result.tasks.map((task) =>
        task.commandSpec.kind === "shell" ? task.commandSpec.command : ""
      )
    ).not.toContain("pnpm test");
  });

  it("collects deno.json(c) tasks including object-form tasks", async () => {
    await writeFile(
      join(projectRootPath, "deno.jsonc"),
      `{
        // jsonc comment
        "tasks": {
          "dev": "deno run -A --watch main.ts",
          "check": { "command": "deno lint", "description": "Lint sources" }
        }
      }`
    );

    const result = await collect({
      projectRootPath,
    });

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
      join(projectRootPath, "composer.json"),
      JSON.stringify({
        scripts: {
          "post-install-cmd": "php artisan clear",
          test: ["phpunit", "phpstan analyse"],
        },
      })
    );

    const result = await collect({
      projectRootPath,
    });

    expect(result.errors).toEqual([]);
    expect(
      result.tasks
        .filter((task) => task.source === "composer")
        .map((task) => [task.label, task.commandSpec, task.description])
    ).toEqual([
      ["install", { command: "composer install", kind: "shell" }, undefined],
      [
        "test",
        { command: "composer run-script test", kind: "shell" },
        "phpunit && phpstan analyse",
      ],
    ]);
  });

  it("collects cargo aliases from .cargo/config.toml", async () => {
    await writeFile(
      join(projectRootPath, "Cargo.toml"),
      '[package]\nname = "demo"\n'
    );
    await mkdir(join(projectRootPath, ".cargo"));
    await writeFile(
      join(projectRootPath, ".cargo", "config.toml"),
      '[alias]\nlint = "clippy --all-targets"\n'
    );

    const result = await collect({
      projectRootPath,
    });

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
      join(projectRootPath, "Taskfile.yml"),
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

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "taskfile")
        .map((task) => task.label)
    ).toEqual(["build", "docs:publish"]);
  });

  it("excludes just assignments and [private] recipes", async () => {
    await writeFile(
      join(projectRootPath, "Justfile"),
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

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "just")
        .map((task) => task.label)
    ).toEqual(["build"]);
  });

  it("collects quoted mise task section names", async () => {
    await writeFile(
      join(projectRootPath, ".mise.toml"),
      '[tasks."docs:build"]\nrun = "mkdocs build"\n\n[tasks.dev]\nrun = "pnpm dev"\n'
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "mise")
        .map((task) => task.label)
        .sort()
    ).toEqual(["dev", "docs:build", "install", "trust"]);
  });

  it("collects flutter pubspec builtins and skips commented sdk lines", async () => {
    await writeFile(
      join(projectRootPath, "pubspec.yaml"),
      [
        "name: demo",
        "dependencies:",
        "  flutter:",
        "    sdk: flutter",
        "dev_dependencies:",
        "  build_runner: ^2.4.0",
        "#    sdk: flutter",
      ].join("\n")
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "pubspec")
        .map((task) => [task.label, task.commandSpec, task.tags])
    ).toEqual([
      [
        "flutter pub get",
        { command: "flutter pub get", kind: "shell" },
        ["flutter"],
      ],
      ["flutter run", { command: "flutter run", kind: "shell" }, ["flutter"]],
      ["flutter test", { command: "flutter test", kind: "shell" }, ["flutter"]],
      [
        "flutter analyze",
        { command: "flutter analyze", kind: "shell" },
        ["flutter"],
      ],
      [
        "dart format .",
        { command: "dart format .", kind: "shell" },
        ["flutter"],
      ],
      [
        "dart run build_runner build --delete-conflicting-outputs",
        {
          command: "dart run build_runner build --delete-conflicting-outputs",
          kind: "shell",
        },
        ["dart"],
      ],
    ]);
  });

  it("uses fvm prefixes when .fvmrc exists for a dart pubspec", async () => {
    await writeFile(
      join(projectRootPath, "pubspec.yaml"),
      "name: cli\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n"
    );
    await writeFile(
      join(projectRootPath, ".fvmrc"),
      '{ "flutter": "3.24.0" }\n'
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "pubspec")
        .map((task) => task.label)
    ).toEqual([
      "fvm dart pub get",
      "fvm dart test",
      "fvm dart analyze",
      "fvm dart format .",
    ]);
  });

  it("collects go builtins from go.work without go.mod", async () => {
    await writeFile(join(projectRootPath, "go.work"), "go 1.22\n");

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "go")
        .map((task) => task.label)
    ).toEqual(["go build", "go test ./...", "go vet ./...", "go run ."]);
  });

  it("uses the maven wrapper and settings.gradle as a gradle root", async () => {
    await writeFile(join(projectRootPath, "pom.xml"), "<project></project>\n");
    await writeFile(join(projectRootPath, "mvnw"), "#!/bin/sh\n");
    await writeFile(
      join(projectRootPath, "settings.gradle.kts"),
      'rootProject.name = "demo"\n'
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "maven")
        .map((task) => [task.label, task.commandSpec])
    ).toEqual([
      ["./mvnw test", { command: "./mvnw test", kind: "shell" }],
      ["./mvnw package", { command: "./mvnw package", kind: "shell" }],
    ]);
    expect(
      result.tasks
        .filter((task) => task.source === "gradle")
        .map((task) => task.label)
    ).toEqual(["gradle test", "gradle build"]);
  });

  it("collects go / gradle wrapper / mix / dotnet toolchain builtins", async () => {
    await writeFile(
      join(projectRootPath, "go.mod"),
      "module example.com/app\n"
    );
    await writeFile(join(projectRootPath, "build.gradle"), "plugins {}\n");
    await writeFile(join(projectRootPath, "gradlew"), "#!/bin/sh\n");
    await writeFile(
      join(projectRootPath, "mix.exs"),
      "defmodule Demo.MixProject do\nend\n"
    );
    await writeFile(
      join(projectRootPath, "Demo.csproj"),
      "<Project></Project>\n"
    );
    await writeFile(join(projectRootPath, "pom.xml"), "<project></project>\n");
    await writeFile(
      join(projectRootPath, "Package.swift"),
      "// swift-tools-version: 5.9\n"
    );
    await writeFile(
      join(projectRootPath, "build.zig"),
      'const std = @import("std");\n'
    );
    await writeFile(join(projectRootPath, "build.sbt"), 'name := "demo"\n');

    const result = await collect({
      projectRootPath,
    });

    const bySource = Object.fromEntries(
      ["go", "gradle", "mix", "dotnet", "maven", "swiftpm", "zig", "sbt"].map(
        (source) => [
          source,
          result.tasks
            .filter((task) => task.source === source)
            .map((task) => task.label),
        ]
      )
    );

    expect(bySource).toEqual({
      dotnet: ["dotnet build", "dotnet test"],
      go: ["go build", "go test ./...", "go vet ./...", "go run ."],
      gradle: ["./gradlew test", "./gradlew build"],
      maven: ["mvn test", "mvn package"],
      mix: ["mix deps.get", "mix compile", "mix test"],
      sbt: ["sbt compile", "sbt test"],
      swiftpm: ["swift build", "swift test"],
      zig: ["zig build", "zig build test"],
    });
  });

  it("collects cmake configure, build, and test from CMakeLists.txt", async () => {
    await writeFile(
      join(projectRootPath, "CMakeLists.txt"),
      "cmake_minimum_required(VERSION 3.20)\n"
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "cmake")
        .map((task) => [task.label, task.commandSpec])
    ).toEqual([
      [
        "cmake -S . -B build",
        { command: "cmake -S . -B build", kind: "shell" },
      ],
      [
        "cmake --build build",
        { command: "cmake --build build", kind: "shell" },
      ],
      [
        "ctest --test-dir build",
        { command: "ctest --test-dir build", kind: "shell" },
      ],
    ]);
  });

  it("adds pytest and ruff builtins from pyproject.toml", async () => {
    await mkdir(join(projectRootPath, "tests"));
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      ["[project]", 'name = "demo"', "[tool.ruff]", "line-length = 88"].join(
        "\n"
      )
    );

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "pyproject")
        .map((task) => task.label)
    ).toEqual(["python -m pytest", "ruff check .", "ruff format ."]);
  });

  it("uses uv run for pytest when uv.lock is present", async () => {
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      "[tool.pytest.ini_options]\naddopts = '-q'\n"
    );
    await writeFile(join(projectRootPath, "uv.lock"), "version = 1\n");

    const result = await collect({
      projectRootPath,
    });

    expect(
      result.tasks
        .filter((task) => task.source === "pyproject")
        .map((task) => task.label)
    ).toEqual(["uv sync", "uv run pytest"]);
  });

  it("adds poetry install when the project uses poetry", async () => {
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      '[tool.poetry]\nname = "demo"\n'
    );

    const result = await collect({ projectRootPath });

    expect(
      result.tasks
        .filter((task) => task.source === "pyproject")
        .map((task) => task.label)
    ).toEqual(["poetry install"]);
  });

  it("adds package-manager install and keeps it beside scripts", async () => {
    await writeFile(
      join(projectRootPath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } })
    );
    await writeFile(join(projectRootPath, "yarn.lock"), "");

    const result = await collect({ projectRootPath });

    expect(
      result.tasks
        .filter((task) => task.source === "package-script")
        .map((task) => [task.label, task.commandSpec])
    ).toEqual([
      ["install", { command: "yarn install", kind: "shell" }],
      ["dev", { command: "yarn run dev", kind: "shell" }],
    ]);
  });

  it("uses the full install command when a script is already named install", async () => {
    await writeFile(
      join(projectRootPath, "package.json"),
      JSON.stringify({ scripts: { install: "node scripts/install.js" } })
    );

    const result = await collect({ projectRootPath });

    expect(
      result.tasks
        .filter((task) => task.source === "package-script")
        .map((task) => [task.label, task.commandSpec.command])
    ).toEqual([
      ["npm install", "npm install"],
      ["install", "npm run install"],
    ]);
  });

  it("lists mise trust and install even when the config has no tasks", async () => {
    await writeFile(
      join(projectRootPath, "mise.toml"),
      '[tools]\nnode = "22"\n'
    );

    const result = await collect({ projectRootPath });

    expect(
      result.tasks
        .filter((task) => task.source === "mise")
        .map((task) => [task.label, task.commandSpec.command])
    ).toEqual([
      ["trust", "mise trust"],
      ["install", "mise install"],
    ]);
  });

  it("drops setup commands and toolchain builtins whose executable is missing", async () => {
    await writeFile(
      join(projectRootPath, "package.json"),
      JSON.stringify({ scripts: { dev: "vite" } })
    );
    await writeFile(
      join(projectRootPath, "pnpm-lock.yaml"),
      "lockfileVersion: 9\n"
    );
    await writeFile(
      join(projectRootPath, "mise.toml"),
      '[tasks.dev]\nrun = "vite"\n'
    );
    await writeFile(
      join(projectRootPath, "go.mod"),
      "module example.com/app\n"
    );
    await writeFile(
      join(projectRootPath, "CMakeLists.txt"),
      "cmake_minimum_required(VERSION 3.20)\n"
    );
    await writeFile(join(projectRootPath, "pom.xml"), "<project></project>\n");
    await writeFile(join(projectRootPath, "mvnw"), "#!/bin/sh\n");
    await writeFile(
      join(projectRootPath, "Cargo.toml"),
      '[package]\nname = "demo"\n'
    );
    await mkdir(join(projectRootPath, ".cargo"));
    await writeFile(
      join(projectRootPath, ".cargo", "config.toml"),
      '[alias]\nlint = "clippy"\n'
    );

    const result = await collect({
      commandExists: (name) => name === "cmake",
      projectRootPath,
    });
    const labels = (source: string) =>
      result.tasks
        .filter((task) => task.source === source)
        .map((task) => task.label);

    expect(labels("package-script")).toEqual(["dev"]);
    expect(labels("mise")).toEqual(["dev"]);
    expect(labels("go")).toEqual([]);
    expect(labels("cargo")).toEqual([]);
    expect(labels("cmake")).toEqual([
      "cmake -S . -B build",
      "cmake --build build",
    ]);
    expect(labels("maven")).toEqual(["./mvnw test", "./mvnw package"]);
  });

  it("resolves an executable file from the given PATH", async () => {
    const bin = join(projectRootPath, "mise");
    await writeFile(bin, "");
    if (process.platform === "win32") {
      expect(executableOnPath("mise", projectRootPath)).toBe(true);
    } else {
      expect(executableOnPath("mise", projectRootPath)).toBe(false);
      await chmod(bin, 0o755);
      expect(executableOnPath("mise", projectRootPath)).toBe(true);
    }
    expect(executableOnPath("missing-bin", projectRootPath)).toBe(false);
  });

  it("keeps windows maven and gradle wrappers that are not on PATH", async () => {
    await writeFile(join(projectRootPath, "pom.xml"), "<project></project>\n");
    await writeFile(join(projectRootPath, "mvnw.cmd"), "@echo off\n");
    await writeFile(join(projectRootPath, "build.gradle"), "");
    await writeFile(join(projectRootPath, "gradlew.bat"), "@echo off\n");

    const result = await collectTaskCandidates({ projectRootPath });
    const labels = (source: string) =>
      result.tasks
        .filter((task) => task.source === source)
        .map((task) => task.label);

    expect(labels("maven")).toEqual(["mvnw.cmd test", "mvnw.cmd package"]);
    expect(labels("gradle")).toEqual(["gradlew.bat test", "gradlew.bat build"]);
  });

  it("does not let a pyproject script share the uv sync id", async () => {
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      '[project.scripts]\nsetup-sync = "demo:main"\n'
    );
    await writeFile(join(projectRootPath, "uv.lock"), "version = 1\n");

    const result = await collect({ projectRootPath });
    const tasks = result.tasks.filter((task) => task.source === "pyproject");

    expect(tasks.map((task) => task.label)).toEqual(["uv sync", "setup-sync"]);
    expect(tasks.map((task) => task.id)).toEqual([
      "pyproject:setup:sync",
      "pyproject:setup-sync",
    ]);
    expect(tasks.map((task) => task.commandSpec.command)).toEqual([
      "uv sync",
      "setup-sync",
    ]);
  });

  it("detects uv and poetry setup commands beyond a single lockfile", async () => {
    await writeFile(
      join(projectRootPath, "pyproject.toml"),
      [
        "[build-system]",
        'build-backend = "poetry.core.masonry.api"',
        "[ tool.uv ]",
        "package = true",
      ].join("\n")
    );

    const result = await collect({ projectRootPath });

    expect(
      result.tasks
        .filter((task) => task.source === "pyproject")
        .map((task) => task.label)
    ).toEqual(["uv sync", "poetry install"]);
  });

  it("uses the project shell PATH when the dump succeeded", async () => {
    const pathEnv = await resolveTaskListPathEnv(
      {
        resolve: async () => ({
          diagnostics: {
            cacheHit: true,
            pathChanged: true,
            shellEnvStatus: "cached",
            source: "task",
          },
          env: { PATH: "/project/bin" },
          shellEnv: { PATH: "/project/bin" },
        }),
      },
      projectRootPath
    );
    expect(pathEnv).toBe("/project/bin");
  });

  it("falls back to the host PATH when the project shell dump did not run", async () => {
    const pathEnv = await resolveTaskListPathEnv(
      {
        resolve: async () => ({
          diagnostics: {
            cacheHit: false,
            pathChanged: false,
            shellEnvStatus: "skipped",
            skipReason: "windows",
            source: "task",
          },
          env: { PATH: "/stale" },
          shellEnv: {},
        }),
      },
      projectRootPath
    );
    expect(pathEnv).toBeUndefined();
  });
});
