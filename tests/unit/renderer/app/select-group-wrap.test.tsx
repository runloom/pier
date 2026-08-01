// @vitest-environment jsdom
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import { render } from "@testing-library/react";
import { beforeAll, describe, expect, it, vi } from "vitest";

beforeAll(() => {
  // Radix Select expects pointer-capture / scrollIntoView in real browsers.
  Element.prototype.scrollIntoView = vi.fn();
  Object.defineProperty(HTMLElement.prototype, "hasPointerCapture", {
    configurable: true,
    value: vi.fn(() => false),
  });
  Object.defineProperty(HTMLElement.prototype, "setPointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(HTMLElement.prototype, "releasePointerCapture", {
    configurable: true,
    value: vi.fn(),
  });
});

describe("SelectContent default SelectGroup wrap", () => {
  it("wraps bare SelectItem children in a select-group", () => {
    render(
      <Select defaultValue="comfortable" open>
        <SelectTrigger aria-label="Density">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="default">Default</SelectItem>
          <SelectItem value="comfortable">Comfortable</SelectItem>
          <SelectItem value="compact">Compact</SelectItem>
        </SelectContent>
      </Select>
    );

    const groups = document.querySelectorAll('[data-slot="select-group"]');
    expect(groups.length).toBe(1);
    expect(
      groups[0]?.querySelectorAll('[data-slot="select-item"]').length
    ).toBe(3);
  });

  it("does not double-wrap when SelectGroup is already present", () => {
    render(
      <Select defaultValue="a" open>
        <SelectTrigger aria-label="Letters">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            <SelectItem value="a">A</SelectItem>
          </SelectGroup>
          <SelectGroup>
            <SelectItem value="b">B</SelectItem>
          </SelectGroup>
        </SelectContent>
      </Select>
    );

    const groups = document.querySelectorAll('[data-slot="select-group"]');
    expect(groups).toHaveLength(2);
  });
});
