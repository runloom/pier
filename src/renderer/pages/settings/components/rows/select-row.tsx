import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
} from "@pier/ui/field.tsx";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@pier/ui/select.tsx";
import type { ReactNode } from "react";

interface SelectRowOption {
  label: string;
  value: string;
}

export interface SelectRowProps<V extends string> {
  description?: ReactNode;
  groupedContent?: ReactNode;
  id: string;
  label: string;
  onChange: (next: V) => void;
  options: readonly SelectRowOption[];
  triggerWidth?: string;
  value: V;
}

export function SelectRow<V extends string>({
  id,
  label,
  options,
  description,
  triggerWidth = "w-[140px]",
  value,
  onChange,
  groupedContent,
}: SelectRowProps<V>) {
  return (
    <Field className="!items-center" orientation="horizontal">
      <FieldContent>
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
        {description && <FieldDescription>{description}</FieldDescription>}
      </FieldContent>
      <Select onValueChange={(v) => onChange(v as V)} value={value}>
        <SelectTrigger className={triggerWidth} id={id}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {groupedContent ?? (
            <SelectGroup>
              {options.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectGroup>
          )}
        </SelectContent>
      </Select>
    </Field>
  );
}
