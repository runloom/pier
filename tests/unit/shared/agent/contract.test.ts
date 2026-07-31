import {
  agentKindSchema,
  applyPermissionMode,
  resolvePermissionMode,
  YOLO_FLAGS,
} from "@shared/contracts/agent.ts";
import { describe, expect, it } from "vitest";

describe("agentKindSchema", () => {
  it("接受内置 agent id，拒绝未知", () => {
    expect(agentKindSchema.parse("claude")).toBe("claude");
    expect(() => agentKindSchema.parse("nope")).toThrow();
  });
  it("含补全的 agent", () => {
    expect(agentKindSchema.parse("qwen-code")).toBe("qwen-code");
    expect(agentKindSchema.parse("goose")).toBe("goose");
    expect(agentKindSchema.parse("openclaude")).toBe("openclaude");
  });
  it("不含 claude-agent-teams", () => {
    expect(() => agentKindSchema.parse("claude-agent-teams")).toThrow();
  });
});

describe("resolvePermissionMode（flag + env 并联）", () => {
  it("空参数 = manual（出厂默认）", () => {
    expect(resolvePermissionMode({}, {})).toBe("manual");
  });
  it("全部填标准 yolo = yolo", () => {
    const { args, env } = applyPermissionMode("yolo", {}, {});
    expect(resolvePermissionMode(args, env)).toBe("yolo");
  });
  it("某 agent 自定义参数 = mixed", () => {
    const { args, env } = applyPermissionMode("yolo", {}, {});
    args.claude = "--custom";
    expect(resolvePermissionMode(args, env)).toBe("mixed");
  });
  it("仅 qwen-code 多 token flag、余空 → mixed（多 token 参与判定）", () => {
    expect(
      resolvePermissionMode({ "qwen-code": "--approval-mode yolo" }, {})
    ).toBe("mixed");
  });
  it("仅 goose env yolo、flag 全空 → mixed（env 参与判定）", () => {
    expect(resolvePermissionMode({}, { goose: { GOOSE_MODE: "auto" } })).toBe(
      "mixed"
    );
  });
});

describe("applyPermissionMode（返回 args + env）", () => {
  it("yolo 给每个 flag agent 填标准 flag（含多 token，整串不拆分）", () => {
    const { args } = applyPermissionMode("yolo", {}, {});
    expect(args.claude).toBe(YOLO_FLAGS.claude);
    expect(args.gemini).toBe("--yolo");
    expect(args["qwen-code"]).toBe("--approval-mode yolo");
    expect(args.continue).toBe('--allow "*"');
    expect(args.grok).toBe("--permission-mode bypassPermissions");
  });
  it("yolo 给 goose 写 env，manual 清除", () => {
    const on = applyPermissionMode("yolo", {}, {});
    expect(on.env.goose?.GOOSE_MODE).toBe("auto");
    const off = applyPermissionMode("manual", on.args, on.env);
    expect(off.env.goose?.GOOSE_MODE).toBeUndefined();
  });
  it("manual 清空标准 flag", () => {
    const on = applyPermissionMode("yolo", {}, {});
    const off = applyPermissionMode("manual", on.args, on.env);
    expect(off.args.claude).toBeUndefined();
  });
  it("yolo 追加标准 flag，manual 只移除标准 flag 并保留用户自定义参数", () => {
    expect(
      applyPermissionMode("yolo", { claude: "--mine" }, {}).args.claude
    ).toBe("--mine --dangerously-skip-permissions");
    expect(
      applyPermissionMode(
        "manual",
        { claude: "--mine --dangerously-skip-permissions" },
        {}
      ).args.claude
    ).toBe("--mine");
  });
});
