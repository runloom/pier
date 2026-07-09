import { z } from "zod";
import {
  type ProjectPreferences,
  projectPreferencesSchema,
} from "./preferences.ts";

type DefaultRemovableSchema = z.ZodType & {
  removeDefault?: () => z.ZodType;
};

function removePreferencePatchDefault(schema: z.ZodType): z.ZodType {
  const removable = schema as DefaultRemovableSchema;
  return removable.removeDefault?.() ?? schema;
}

const projectPreferencesPatchShape = Object.fromEntries(
  Object.entries(projectPreferencesSchema.shape).map(([key, schema]) => [
    key,
    removePreferencePatchDefault(schema).optional(),
  ])
) as z.ZodRawShape;

export type ProjectPreferencesPatch = Partial<ProjectPreferences>;

export const projectPreferencesPatchSchema: z.ZodType<ProjectPreferencesPatch> =
  z.object(projectPreferencesPatchShape);
