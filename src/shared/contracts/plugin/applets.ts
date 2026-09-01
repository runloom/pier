import { z } from "zod";

const relativePosixAppletEntrySchema = z
  .string()
  .min(1)
  .refine((value) => !value.startsWith("/"), {
    message: "applet entry must not be absolute",
  })
  .refine((value) => !/^[a-zA-Z]:/.test(value), {
    message: "applet entry must not include a drive letter",
  })
  .refine(
    (value) =>
      value
        .split("/")
        .every((segment) => segment !== ".." && segment.length > 0),
    { message: "applet entry must be a POSIX-relative path without `..`" }
  );

export const pluginAppletContributionSchema = z.object({
  deprecated: z.boolean().optional(),
  description: z.string().min(1).optional(),
  entry: relativePosixAppletEntrySchema,
  id: z.string().min(1),
  propsSchema: z.record(z.string(), z.unknown()).optional(),
  title: z.string().min(1).optional(),
});
export type PluginAppletContribution = z.infer<
  typeof pluginAppletContributionSchema
>;
