/**
 * MenuTemplate 的 zod 校验 — renderer → main IPC 的安全边界. 任何不符 schema 的
 * template 直接拒绝, 不调 Menu.popup. 限制见 MENU_LIMITS.
 */
import {
  ALLOWED_ROLES,
  MENU_LIMITS,
  type MenuItem,
  type MenuTemplate,
} from "@shared/contracts/menu.ts";
import { z } from "zod";

const labelSchema = z.string().min(1).max(MENU_LIMITS.labelMaxLength);
const idSchema = z.string().min(1).max(MENU_LIMITS.idMaxLength);
const acceleratorSchema = z
  .string()
  .max(MENU_LIMITS.acceleratorMaxLength)
  .optional();

const separatorSchema = z.object({ type: z.literal("separator") });

const roleSchema = z.object({
  type: z.literal("role"),
  role: z.enum([...ALLOWED_ROLES] as [string, ...string[]]),
  label: labelSchema.optional(),
  enabled: z.boolean().optional(),
});

const actionSchema = z.object({
  type: z.literal("action"),
  id: idSchema,
  label: labelSchema,
  accelerator: acceleratorSchema,
  enabled: z.boolean().optional(),
});

/**
 * 递归 submenu — 深度限制走显式递归层数. zod recursive lazy 不能直接限深, 用工厂函数
 * 按层 build (depth=0 为叶子层, 不允许再 submenu).
 */
function makeItemSchema(depth: number): z.ZodType<MenuItem> {
  if (depth <= 0) {
    return z.union([
      separatorSchema,
      roleSchema,
      actionSchema,
    ]) as z.ZodType<MenuItem>;
  }
  const submenuSchema = z.object({
    type: z.literal("submenu"),
    label: labelSchema,
    enabled: z.boolean().optional(),
    submenu: z
      .array(makeItemSchema(depth - 1))
      .max(MENU_LIMITS.itemsPerLevelMax),
  });
  return z.union([
    separatorSchema,
    roleSchema,
    actionSchema,
    submenuSchema,
  ]) as z.ZodType<MenuItem>;
}

export const MenuTemplateSchema: z.ZodType<MenuTemplate> = z
  .array(makeItemSchema(MENU_LIMITS.submenuMaxDepth))
  .max(MENU_LIMITS.topLevelMax);
