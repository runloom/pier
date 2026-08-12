/**
 * Plugin configuration schema (settings UI contribution).
 * Kept separate from plugin.ts to stay under the 500-line file-size gate.
 */

import { z } from "zod";

const pluginConfigurationPropertyBaseSchema = z.object({
  default: z.union([z.string(), z.number(), z.boolean()]),
  description: z.string().min(1).optional(),
  enum: z.array(z.string().min(1)).min(1).optional(),
  enumDescriptions: z.array(z.string().min(1)).optional(),
  maximum: z.number().optional(),
  minimum: z.number().optional(),
  multiline: z.boolean().optional(),
  order: z.number().optional(),
  placeholder: z.string().min(1).optional(),
  resettable: z.boolean().optional(),
  type: z.enum(["string", "number", "boolean"]),
  /**
   * When set, the settings UI only shows this row if the sibling setting's
   * effective value equals `equals` (after schema defaulting).
   */
  visibleWhen: z
    .object({
      equals: z.union([z.string(), z.number(), z.boolean()]),
      key: z.string().min(1),
    })
    .optional(),
});

type PluginConfigurationPropertyCandidate = z.infer<
  typeof pluginConfigurationPropertyBaseSchema
>;
type PluginConfigurationPropertyIssuePath =
  | "default"
  | "enum"
  | "enumDescriptions"
  | "minimum"
  | "multiline"
  | "placeholder";
type AddConfigurationPropertyIssue = (
  path: PluginConfigurationPropertyIssuePath,
  message: string
) => void;

function validateConfigurationPropertyTypes(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (typeof property.default !== property.type) {
    addIssue("default", `default must match type "${property.type}"`);
  }
  if (property.enum && property.type !== "string") {
    addIssue("enum", 'enum is only allowed with type "string"');
  }
  if (property.multiline && property.type !== "string") {
    addIssue("multiline", 'multiline is only allowed with type "string"');
  }
  if (property.placeholder && property.type !== "string") {
    addIssue("placeholder", 'placeholder is only allowed with type "string"');
  }
  if (
    (property.minimum !== undefined || property.maximum !== undefined) &&
    property.type !== "number"
  ) {
    addIssue("minimum", 'minimum/maximum are only allowed with type "number"');
  }
}

function validateConfigurationPropertyEnum(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (
    property.enum &&
    typeof property.default === "string" &&
    !property.enum.includes(property.default)
  ) {
    addIssue("default", "default must be a member of enum");
  }
  if (property.enumDescriptions && !property.enum) {
    addIssue("enumDescriptions", "enumDescriptions requires enum");
  }
  if (
    property.enumDescriptions &&
    property.enum &&
    property.enumDescriptions.length !== property.enum.length
  ) {
    addIssue(
      "enumDescriptions",
      "enumDescriptions must have the same length as enum"
    );
  }
}

function validateConfigurationPropertyRange(
  property: PluginConfigurationPropertyCandidate,
  addIssue: AddConfigurationPropertyIssue
): void {
  if (
    property.minimum !== undefined &&
    property.maximum !== undefined &&
    property.minimum > property.maximum
  ) {
    addIssue("minimum", "minimum must not be greater than maximum");
  }
  if (
    property.type === "number" &&
    typeof property.default === "number" &&
    property.minimum !== undefined &&
    property.default < property.minimum
  ) {
    addIssue("default", "default must be greater than or equal to minimum");
  }
  if (
    property.type === "number" &&
    typeof property.default === "number" &&
    property.maximum !== undefined &&
    property.default > property.maximum
  ) {
    addIssue("default", "default must be less than or equal to maximum");
  }
}

export const pluginConfigurationPropertySchema =
  pluginConfigurationPropertyBaseSchema.superRefine((property, ctx) => {
    const addIssue: AddConfigurationPropertyIssue = (path, message) => {
      ctx.addIssue({ code: "custom", message, path: [path] });
    };
    validateConfigurationPropertyTypes(property, addIssue);
    validateConfigurationPropertyEnum(property, addIssue);
    validateConfigurationPropertyRange(property, addIssue);
  });
export type PluginConfigurationProperty = z.infer<
  typeof pluginConfigurationPropertySchema
>;

export const pluginConfigurationSchema = z.object({
  properties: z.record(z.string().min(1), pluginConfigurationPropertySchema),
  title: z.string().min(1).optional(),
});
export type PluginConfiguration = z.infer<typeof pluginConfigurationSchema>;
