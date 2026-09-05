import { renameSync, writeFileSync } from "node:fs";

const outputPath = process.argv[2];
const state = { background: null, foreground: null, scheme: null, reports: [] };
let pending = "";

function save() {
  writeFileSync(`${outputPath}.tmp`, JSON.stringify(state));
  renameSync(`${outputPath}.tmp`, outputPath);
}

function queryColors() {
  process.stdout.write("\u001b]10;?\u0007\u001b]11;?\u0007");
}

process.stdin.setRawMode(true);
process.stdin.setEncoding("utf8");
save();
process.stdin.on("data", (data) => {
  pending += data;
  const replies =
    // biome-ignore lint/suspicious/noControlCharactersInRegex: Parse actual OSC and DSR terminal replies.
    /\u001b\]1([01]);rgb:([\da-f]+)\/([\da-f]+)\/([\da-f]+)(?:\u0007|\u001b\\)|\u001b\[\?997;([12])n/gi;
  let consumed = 0;
  for (const match of pending.matchAll(replies)) {
    consumed = match.index + match[0].length;
    if (match[5]) {
      state.scheme = match[5] === "1" ? "dark" : "light";
      state.reports.push(state.scheme);
      queryColors();
    } else {
      const color = match
        .slice(2, 5)
        .map((hex) => {
          const channel = Math.round(
            (Number.parseInt(hex, 16) * 255) / (16 ** hex.length - 1)
          );
          return channel.toString(16).padStart(2, "0");
        })
        .join("");
      state[match[1] === "0" ? "foreground" : "background"] = `#${color}`;
    }
    save();
  }
  pending = pending.slice(consumed);
});
process.stdout.write("\u001b[?2031h\u001b[?996n");
queryColors();
