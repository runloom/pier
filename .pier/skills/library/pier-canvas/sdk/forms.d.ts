import type {
  ButtonHTMLAttributes,
  ComponentType,
  InputHTMLAttributes,
  LabelHTMLAttributes,
  ReactNode,
  TextareaHTMLAttributes,
} from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  size?:
    | "default"
    | "icon"
    | "icon-lg"
    | "icon-sm"
    | "icon-xs"
    | "lg"
    | "sm"
    | "status-bar"
    | "xs";
  tone?: "default" | "muted";
  variant?:
    | "default"
    | "destructive"
    | "ghost"
    | "link"
    | "outline"
    | "secondary";
}

export type InputProps = InputHTMLAttributes<HTMLInputElement>;
export type TextareaProps = TextareaHTMLAttributes<HTMLTextAreaElement>;
export type LabelProps = LabelHTMLAttributes<HTMLLabelElement>;
export type CheckedState = boolean | "indeterminate";

export interface CheckboxProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "defaultChecked"> {
  checked?: CheckedState;
  defaultChecked?: CheckedState;
  onCheckedChange?: (checked: CheckedState) => void;
  required?: boolean;
}

export interface SwitchProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "defaultChecked"> {
  checked?: boolean;
  defaultChecked?: boolean;
  onCheckedChange?: (checked: boolean) => void;
  required?: boolean;
  size?: "default" | "sm";
}

export interface SliderProps {
  "aria-label"?: string;
  className?: string;
  defaultValue?: number[];
  disabled?: boolean;
  max?: number;
  min?: number;
  onValueChange?: (value: number[]) => void;
  onValueCommit?: (value: number[]) => void;
  orientation?: "horizontal" | "vertical";
  step?: number;
  value?: number[];
}

export interface RadioGroupProps {
  children?: ReactNode;
  className?: string;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  onValueChange?: (value: string) => void;
  orientation?: "horizontal" | "vertical";
  required?: boolean;
  value?: string;
}

export interface RadioGroupItemProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  value: string;
}

export interface SelectProps {
  children?: ReactNode;
  defaultOpen?: boolean;
  defaultValue?: string;
  disabled?: boolean;
  name?: string;
  onOpenChange?: (open: boolean) => void;
  onValueChange?: (value: string) => void;
  open?: boolean;
  required?: boolean;
  value?: string;
}

export interface SelectTriggerProps
  extends ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean;
  size?: "default" | "sm";
}

export interface SelectItemProps {
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
  textValue?: string;
  value: string;
}

export interface FormCompositionProps {
  children?: ReactNode;
  className?: string;
  [prop: string]: unknown;
}

export interface ToggleProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  defaultPressed?: boolean;
  onPressedChange?: (pressed: boolean) => void;
  pressed?: boolean;
  size?: "default" | "lg" | "sm";
  variant?: "default" | "outline";
}

export interface ToggleGroupProps extends FormCompositionProps {
  defaultValue?: string | string[];
  disabled?: boolean;
  onValueChange?: (value: string | string[]) => void;
  orientation?: "horizontal" | "vertical";
  spacing?: number;
  type: "multiple" | "single";
  value?: string | string[];
}

export interface ToggleGroupItemProps extends ToggleProps {
  value: string;
}

export const Button: ComponentType<ButtonProps>;
export const Checkbox: ComponentType<CheckboxProps>;
export const Input: ComponentType<InputProps>;
export const Label: ComponentType<LabelProps>;
export const RadioGroup: ComponentType<RadioGroupProps>;
export const RadioGroupItem: ComponentType<RadioGroupItemProps>;
export const Select: ComponentType<SelectProps>;
export const SelectContent: ComponentType<FormCompositionProps>;
export const SelectGroup: ComponentType<FormCompositionProps>;
export const SelectItem: ComponentType<SelectItemProps>;
export const SelectLabel: ComponentType<FormCompositionProps>;
export const SelectScrollDownButton: ComponentType<FormCompositionProps>;
export const SelectScrollUpButton: ComponentType<FormCompositionProps>;
export const SelectSeparator: ComponentType<FormCompositionProps>;
export const SelectTrigger: ComponentType<SelectTriggerProps>;
export const SelectValue: ComponentType<FormCompositionProps>;
export const Slider: ComponentType<SliderProps>;
export const Switch: ComponentType<SwitchProps>;
export const Textarea: ComponentType<TextareaProps>;
export const Toggle: ComponentType<ToggleProps>;
export const ToggleGroup: ComponentType<ToggleGroupProps>;
export const ToggleGroupItem: ComponentType<ToggleGroupItemProps>;
