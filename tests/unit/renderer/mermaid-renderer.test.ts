import { describe, expect, it, vi } from "vitest";
import { renderMermaidInWorker } from "@/lib/plugins/mermaid-render.worker.ts";
import { createMermaidRenderer } from "@/lib/plugins/mermaid-renderer.ts";

class FakeWorker {
  static instances: FakeWorker[] = [];
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    FakeWorker.instances.push(this);
  }
}

function setup() {
  FakeWorker.instances = [];
  const renderer = createMermaidRenderer({
    createWorker: () => new FakeWorker(),
    timeoutMs: 2000,
  });
  return renderer;
}

describe("Mermaid renderer", () => {
  it("renders in a dedicated worker and caches successful SVGs", async () => {
    const renderer = setup();
    const first = renderer.render("graph TD;A-->B");
    const worker = FakeWorker.instances[0];
    expect(worker?.postMessage).toHaveBeenCalledWith({
      source: "graph TD;A-->B",
    });
    worker?.onmessage?.(
      new MessageEvent("message", {
        data: { ok: true, svg: "<svg><path /></svg>" },
      })
    );
    await expect(first).resolves.toEqual({
      ok: true,
      svg: "<svg><path /></svg>",
    });

    await expect(renderer.render("graph TD;A-->B")).resolves.toEqual({
      ok: true,
      svg: "<svg><path /></svg>",
    });
    expect(FakeWorker.instances).toHaveLength(1);
  });

  it("rejects oversized sources and unsafe worker output", async () => {
    const renderer = setup();
    await expect(renderer.render("x".repeat(160_001))).resolves.toEqual({
      ok: false,
      reason: "too-large",
    });

    const result = renderer.render("graph TD;A-->B");
    FakeWorker.instances[0]?.onmessage?.(
      new MessageEvent("message", {
        data: { ok: true, svg: "<svg><script>alert(1)</script></svg>" },
      })
    );
    await expect(result).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });
  });

  it("terminates a render after two seconds", async () => {
    vi.useFakeTimers();
    try {
      const renderer = setup();
      const result = renderer.render("graph TD;A-->B");
      await vi.advanceTimersByTimeAsync(2000);
      await expect(result).resolves.toEqual({ ok: false, reason: "timeout" });
      expect(FakeWorker.instances[0]?.terminate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it("accepts dangerous words as text but rejects active URL attributes", async () => {
    const renderer = setup();
    const safe = renderer.render("graph TD;A-->B");
    FakeWorker.instances[0]?.onmessage?.(
      new MessageEvent("message", {
        data: { ok: true, svg: "<svg><text>javascript: onload=</text></svg>" },
      })
    );
    await expect(safe).resolves.toMatchObject({ ok: true });

    const unsafe = renderer.render("graph TD;B-->C");
    FakeWorker.instances[1]?.onmessage?.(
      new MessageEvent("message", {
        data: {
          ok: true,
          svg: '<svg><a href="https://example.com"><text>x</text></a></svg>',
        },
      })
    );
    await expect(unsafe).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });

    const escapedCss = renderer.render("graph TD;C-->D");
    FakeWorker.instances[2]?.onmessage?.(
      new MessageEvent("message", {
        data: {
          ok: true,
          svg: '<svg><rect fill="u\\72l(https://example.com/paint.svg#p)" /></svg>',
        },
      })
    );
    await expect(escapedCss).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });
  });

  it("maps synchronous worker failures to structured results", async () => {
    const constructionFailure = createMermaidRenderer({
      createWorker: () => {
        throw new Error("blocked");
      },
    });
    await expect(constructionFailure.render("graph TD;A-->B")).resolves.toEqual(
      {
        ok: false,
        reason: "render-failed",
      }
    );

    const worker = new FakeWorker();
    worker.postMessage.mockImplementation(() => {
      throw new Error("closed");
    });
    const postFailure = createMermaidRenderer({
      createWorker: () => worker,
    });
    await expect(postFailure.render("graph TD;A-->B")).resolves.toEqual({
      ok: false,
      reason: "render-failed",
    });
    expect(worker.terminate).toHaveBeenCalledOnce();
  });

  it("renders a flowchart through the real worker renderer", async () => {
    const svg = renderMermaidInWorker({ source: "graph TD;A-->B" });
    expect(svg).toContain("<svg");
    expect(svg).not.toContain("foreignObject");
    expect(svg).not.toContain("--accent:var(--action-accent)");
    // Host --border is too faint for node strokes / edges; theme must derive from fg/bg.
    expect(svg).not.toContain("--line:var(--border)");
    // Arrowheads use --accent; must match --line (not host near-white --accent).
    expect(svg).toContain(
      "--accent:color-mix(in srgb, var(--foreground) 45%, var(--background))"
    );
    expect(svg).toContain(
      "--line:color-mix(in srgb, var(--foreground) 45%, var(--background))"
    );
    expect(svg).toContain("--border:color-mix(in srgb, var(--foreground)");
    expect(svg).toContain("--surface:color-mix(in srgb, var(--foreground)");
    expect(svg).toContain('fill="var(--_arrow)"');
    expect(svg).toContain('stroke="var(--_line)"');

    const classSvg = renderMermaidInWorker({
      source: "classDiagram;class A {;+int x;+f();};class B;A --> B",
    });
    expect(classSvg).toContain(">x</tspan>");
    expect(classSvg).toContain(">int</tspan>");
    expect(classSvg).toContain("f()");

    const edgeLabelSvg = renderMermaidInWorker({
      source: "graph TD;A-->|ready; retry|B",
    });
    expect(edgeLabelSvg).toContain("ready; retry");

    const commentSvg = renderMermaidInWorker({
      source: "graph TD;%% hidden;A-->B\nC-->D",
    });
    expect(commentSvg).not.toContain('data-id="A"');
    expect(commentSvg).toContain('data-id="C"');

    const erSvg = renderMermaidInWorker({
      source: "erDiagram\nCUSTOMER ||--o{ ORDER : places",
    });
    expect(erSvg).toContain('class="er-relationship"');

    const inheritanceSvg = renderMermaidInWorker({
      source: "classDiagram;Animal <|-- Dog;Dog --> Food",
    });
    expect(inheritanceSvg.match(/class="class-relationship"/gu)).toHaveLength(
      2
    );

    const sequenceSvg = renderMermaidInWorker({
      source:
        "sequenceDiagram;participant Alice;participant Bob;Alice-->>Bob: reply",
    });
    expect(sequenceSvg).toContain("reply");

    const literalArrowSvg = renderMermaidInWorker({
      source: 'graph TD;A["C-->D"]-->B',
    });
    expect(literalArrowSvg).toContain(">C--&gt;D</text>");

    const leadingCommentSvg = renderMermaidInWorker({
      source: "%% model\nclassDiagram;class A {;+int x;}",
    });
    expect(leadingCommentSvg).toContain(">x</tspan>");

    const bidirectionalSvg = renderMermaidInWorker({
      source: "graph TD;A<-.->B",
    });
    expect(bidirectionalSvg).toContain('data-id="B"');
    expect(bidirectionalSvg).toContain("stroke-dasharray");

    const punctuationLabelSvg = renderMermaidInWorker({
      source: "graph TD;A[Retry (later]-->B;B-->C",
    });
    expect(punctuationLabelSvg).toContain('data-id="C"');

    const percentLabelSvg = renderMermaidInWorker({
      source: "graph TD;A-->|load 50%%; retry|B;B-->C",
    });
    expect(percentLabelSvg).toContain("load 50%%; retry");
    expect(percentLabelSvg).toContain('data-id="C"');

    const textEdgeSvg = renderMermaidInWorker({
      source: "graph TD;A -- retry(later --> B;B-->C",
    });
    expect(textEdgeSvg).toContain("retry(later");
    expect(textEdgeSvg).toContain('data-id="C"');

    const contractionSvg = renderMermaidInWorker({
      source:
        "sequenceDiagram;participant A;participant B;A->>B: James' request;B-->>A: done",
    });
    expect(contractionSvg).toContain("James' request");
    expect(contractionSvg).toContain("done");

    const sequencePunctuationSvg = renderMermaidInWorker({
      source:
        "sequenceDiagram;participant A;participant B;A->>B: retry (later;B-->>A: done",
    });
    expect(sequencePunctuationSvg).toContain("retry (later");
    expect(sequencePunctuationSvg).toContain("done");

    const taskRunFlowSvg = renderMermaidInWorker({
      source: [
        "flowchart LR",
        "A[renderer Run Task] --> B[解析显式动作与展示意图]",
        "B --> C[main 解析 executionKind 和并发策略]",
        "C --> D[main 创建或返回 TaskRun]",
        "D --> E[main 广播带版本的 TaskRunsSnapshot]",
        "E --> F{executionKind}",
        "F -- process --> G{renderer 有明确 default + auto-follow}",
        "G -- 是 --> H[native adapter 静默绑定]",
        "G -- 否 --> I[仅更新应用会话级入口]",
        "F -- pty --> J[复用或创建任务终端]",
        "H --> K[提交 selectedRunId 与 generation]",
        "K --> L[从最新快照投影标签]",
        "I --> L",
        "J --> L",
      ].join("\n"),
    });
    expect(taskRunFlowSvg).toContain('data-id="L"');
    expect(taskRunFlowSvg).toContain("auto-follow");

    const renderer = setup();
    const sanitizedResult = renderer.render("graph TD;A-->B");
    FakeWorker.instances[0]?.onmessage?.(
      new MessageEvent("message", { data: { ok: true, svg } })
    );
    const sanitized = await sanitizedResult;
    expect(sanitized).toMatchObject({ ok: true });
    if (sanitized.ok) {
      expect(sanitized.svg).not.toContain("fonts.googleapis.com");
      expect(sanitized.svg).toContain("font-family:var(--font-sans)");
    }
  });
});
