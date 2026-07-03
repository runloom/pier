import {
  AiFieldDescription,
  type TextFn,
} from "@plugins/builtin/git/renderer/worktree-create-form.tsx";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

const PREFIX_COPY = /with prefix|prefix feature\//;

const text: TextFn = (_key, values, fallback) =>
  Object.entries(values ?? {}).reduce(
    (message, [key, value]) => message.replaceAll(`{{${key}}}`, String(value)),
    fallback
  );

describe("AiFieldDescription", () => {
  it("does not mention branch prefixes in the smart generation hint", () => {
    render(
      <AiFieldDescription
        agentLabel="Claude"
        aiConfigured={true}
        rootPath="/repo.worktree"
        statusLoading={false}
        text={text}
      />
    );

    expect(
      screen.getByText(
        "Default agent (Claude) will generate a branch name from the task description and create an isolated worktree under /repo.worktree."
      )
    ).toBeInTheDocument();
    expect(screen.queryByText(PREFIX_COPY)).not.toBeInTheDocument();
  });
});
