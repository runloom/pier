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
});

describe("resolvePermissionMode", () => {
  it("空参数 = manual（出厂默认）", () => {
    expect(resolvePermissionMode({})).toBe("manual");
  });
  it("全部填标准 yolo flag = yolo", () => {
    expect(resolvePermissionMode(applyPermissionMode("yolo", {}))).toBe("yolo");
  });
  it("某 agent 自定义参数 = mixed", () => {
    const args = applyPermissionMode("yolo", {});
    args.claude = "--custom";
    expect(resolvePermissionMode(args)).toBe("mixed");
  });
});

describe("applyPermissionMode", () => {
  it("yolo 给每个 yolo agent 填标准 flag", () => {
    const args = applyPermissionMode("yolo", {});
    expect(args.claude).toBe(YOLO_FLAGS.claude);
    expect(args.gemini).toBe("--yolo");
  });
  it("manual 清空标准 flag", () => {
    const manual = applyPermissionMode(
      "manual",
      applyPermissionMode("yolo", {})
    );
    expect(manual.claude).toBeUndefined();
  });
  it("保留用户自定义参数（yolo 和 manual 都不动）", () => {
    expect(applyPermissionMode("yolo", { claude: "--mine" }).claude).toBe(
      "--mine"
    );
    expect(applyPermissionMode("manual", { claude: "--mine" }).claude).toBe(
      "--mine"
    );
  });
});
