/**
 * 无信息量输入的判定。命中即整条丢弃（标题保持占位），等下一条 prompt 再试。
 *
 * 正则以 `*_SOURCE` 字符串导出：安装期的 hook 内联脚本从这里插值取表，
 * 不得手抄。表变了两边同时变。
 */

/** 寒暄与无内容承接语。 */
export const GREETING_ONLY_SOURCE =
  "^(?:hi|hello|hey|yo|sup|ok|okay|yes|no|thanks|thank you|thx|go on|continue|" +
  "你好|您好|嗨|哈喽|在吗|在么|继续|好的|好|行|谢谢|辛苦了|收到)[!?？。，.\\s]*$";

/** 纯标点 / 符号噪声（含中文间隔点等）。 */
export const TRIVIAL_TITLE_SOURCE =
  "^[\\s·•‧・\\-–—_|/\\\\.,;:!?'\"“”‘’`~()\\[\\]{}<>@#$%^&*+=]+$";

/** slash 命令（`/clear`、`/compact` 等），不是任务描述。 */
export const SLASH_COMMAND_SOURCE = "^/[a-z][a-z0-9:_-]*(?:\\s|$)";

/** 直接粘贴的报错栈：以 `XxxError:` 开头，或含 `at fn (file:line:col)` 帧。 */
export const STACK_TRACE_SOURCE =
  "(?:^\\w*(?:Error|Exception):)|(?:^|\\s)at\\s+\\S.*\\(.+:\\d+:\\d+\\)";

/** 整条就是一个路径。 */
export const BARE_PATH_SOURCE = "^(?:[.~]?/)?(?:[\\w.@-]+/)+[\\w.@-]+$";

/** 整条就是一个 URL。 */
export const BARE_URL_SOURCE = "^[a-z][a-z0-9+.-]*://\\S+$";

const GREETING_ONLY = new RegExp(GREETING_ONLY_SOURCE, "i");
const TRIVIAL_TITLE = new RegExp(TRIVIAL_TITLE_SOURCE, "u");
const SLASH_COMMAND = new RegExp(SLASH_COMMAND_SOURCE);
const STACK_TRACE = new RegExp(STACK_TRACE_SOURCE);
const BARE_PATH = new RegExp(BARE_PATH_SOURCE);
const BARE_URL = new RegExp(BARE_URL_SOURCE, "i");

/** 已 strip 过标记的文本是否不足以作标题。 */
export function isNoiseTitleInput(text: string): boolean {
  if (!text) {
    return true;
  }
  if ([...text].length < 2) {
    return true;
  }
  return (
    GREETING_ONLY.test(text) ||
    TRIVIAL_TITLE.test(text) ||
    SLASH_COMMAND.test(text) ||
    STACK_TRACE.test(text) ||
    BARE_PATH.test(text) ||
    BARE_URL.test(text)
  );
}
