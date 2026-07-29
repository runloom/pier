import { z } from "zod";
import { MAX_AGENT_SESSION_TITLE_LENGTH } from "./constants.ts";

/** 产品会话标题值：长度按 Unicode code point 计算，不按 UTF-16 code unit。 */
export const agentSessionTitleValueSchema = z
  .string()
  .min(1)
  .refine(
    (value) => Array.from(value).length <= MAX_AGENT_SESSION_TITLE_LENGTH,
    `Agent session title must be at most ${MAX_AGENT_SESSION_TITLE_LENGTH} code points`
  );
