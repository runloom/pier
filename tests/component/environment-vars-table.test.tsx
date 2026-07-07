import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n/index.ts";
import {
  createEnvVarRow,
  EnvironmentVarsTable,
  type EnvVarRow,
  envRecordsEqual,
  envToRows,
  rowsToEnv,
} from "@/pages/settings/components/environment-vars-table.tsx";

const ADD_VARIABLE_LABEL = /add variable/i;
const REMOVE_LABEL = /remove/i;

describe("EnvironmentVarsTable", () => {
  beforeAll(async () => {
    await initI18n();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("renders one row per env entry and always shows a trailing add button", () => {
    const rows = [
      createEnvVarRow("NODE_ENV", "development"),
      createEnvVarRow("PORT", "3000"),
    ];
    const onChange = vi.fn();

    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);

    const keyInputs = screen.getAllByPlaceholderText("KEY");
    expect(keyInputs).toHaveLength(2);
    expect(keyInputs[0]).toHaveValue("NODE_ENV");
    expect(keyInputs[1]).toHaveValue("PORT");

    const valueInputs = screen.getAllByPlaceholderText("value");
    expect(valueInputs).toHaveLength(2);
    expect(valueInputs[0]).toHaveValue("development");
    expect(valueInputs[1]).toHaveValue("3000");

    const addButton = screen.getByRole("button", { name: ADD_VARIABLE_LABEL });
    expect(addButton).toBeInTheDocument();
  });

  it("emits new rows array when adding a variable", () => {
    const rows = [createEnvVarRow("A", "1")];
    const onChange = vi.fn();

    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);

    fireEvent.click(screen.getByRole("button", { name: ADD_VARIABLE_LABEL }));

    expect(onChange).toHaveBeenCalledOnce();
    const emitted = onChange.mock.calls[0]?.[0] as EnvVarRow[];
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.key).toBe("A");
    expect(emitted[1]?.key).toBe("");
    expect(emitted[1]?.value).toBe("");
  });

  it("emits new rows array when deleting a row", () => {
    const rows = [
      createEnvVarRow("A", "1"),
      createEnvVarRow("B", "2"),
      createEnvVarRow("C", "3"),
    ];
    const onChange = vi.fn();

    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);

    const removeButtons = screen.getAllByRole("button", { name: REMOVE_LABEL });
    expect(removeButtons).toHaveLength(3);

    if (!removeButtons[1]) {
      throw new Error("expected at least two remove buttons");
    }
    fireEvent.click(removeButtons[1]);

    expect(onChange).toHaveBeenCalledOnce();
    const emitted = onChange.mock.calls[0]?.[0] as EnvVarRow[];
    expect(emitted).toHaveLength(2);
    expect(emitted[0]?.key).toBe("A");
    expect(emitted[1]?.key).toBe("C");
  });

  it("emits new rows array when editing key or value", () => {
    const rows = [createEnvVarRow("OLD", "val")];
    const onChange = vi.fn();

    render(<EnvironmentVarsTable onChange={onChange} rows={rows} />);

    const keyInput = screen.getByPlaceholderText("KEY");
    fireEvent.change(keyInput, { target: { value: "NEW_KEY" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emittedKey = onChange.mock.calls[0]?.[0] as EnvVarRow[];
    expect(emittedKey[0]?.key).toBe("NEW_KEY");
    expect(emittedKey[0]?.value).toBe("val");

    onChange.mockClear();
    const valueInput = screen.getByPlaceholderText("value");
    fireEvent.change(valueInput, { target: { value: "new_val" } });

    expect(onChange).toHaveBeenCalledTimes(1);
    const emittedVal = onChange.mock.calls[0]?.[0] as EnvVarRow[];
    expect(emittedVal[0]?.key).toBe("OLD");
    expect(emittedVal[0]?.value).toBe("new_val");
  });

  it("rowsToEnv drops rows with empty keys after trimming", () => {
    const rows = [
      createEnvVarRow("VALID", "ok"),
      createEnvVarRow("  ", "ignored"),
      createEnvVarRow("", "also-ignored"),
      createEnvVarRow("ALSO_VALID", "yep"),
    ];

    const env = rowsToEnv(rows);

    expect(env).toEqual({ ALSO_VALID: "yep", VALID: "ok" });
  });

  it("envRecordsEqual is order insensitive", () => {
    const a = { B: "2", A: "1" };
    const b = { A: "1", B: "2" };
    expect(envRecordsEqual(a, b)).toBe(true);

    const c = { A: "1", B: "2" };
    const d = { A: "1", B: "999" };
    expect(envRecordsEqual(c, d)).toBe(false);

    const e = { A: "1" };
    const f = { A: "1", B: "2" };
    expect(envRecordsEqual(e, f)).toBe(false);

    expect(envRecordsEqual({}, {})).toBe(true);
  });
});

describe("envToRows", () => {
  it("returns one empty row for an empty env record", () => {
    const rows = envToRows({});
    expect(rows).toHaveLength(1);
    expect(rows[0]?.key).toBe("");
    expect(rows[0]?.value).toBe("");
  });

  it("creates one row per entry", () => {
    const rows = envToRows({ A: "1", B: "2" });
    expect(rows).toHaveLength(2);
    const keys = rows.map((r) => r.key).sort();
    expect(keys).toEqual(["A", "B"]);
  });
});
