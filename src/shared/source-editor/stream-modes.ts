import { simpleMode } from "@codemirror/legacy-modes/mode/simple-mode";

/**
 * Compact GraphQL stream parser (no maintained `@codemirror/lang-graphql`
 * in the L0 set). Keywords + strings + comments cover the reading path.
 */
export const graphqlMode = simpleMode({
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /"""/, token: "string", next: "triple" },
    { regex: /"(?:[^\\"]|\\.)*"/, token: "string" },
    {
      regex:
        /\b(?:query|mutation|subscription|fragment|on|type|interface|union|enum|input|scalar|schema|extend|implements|directive|repeatable|true|false|null)\b/,
      token: "keyword",
    },
    { regex: /\$[A-Za-z_]\w*/, token: "variableName" },
    { regex: /@[A-Za-z_]\w*/, token: "meta" },
    { regex: /\b\d+(?:\.\d+)?\b/, token: "number" },
    { regex: /[{}()[\]]/, token: "bracket" },
    { regex: /[A-Za-z_]\w*/, token: "variableName" },
  ],
  triple: [
    { regex: /"""/, token: "string", next: "start" },
    { regex: /"/, token: "string" },
    { regex: /[^"]+/, token: "string" },
  ],
});

/**
 * Compact HCL / Terraform stream parser (no L0 `@codemirror/lang-hcl`).
 * Covers blocks, strings, comments, and `${}` interpolations.
 */
export const hclMode = simpleMode({
  start: [
    { regex: /#.*/, token: "comment" },
    { regex: /\/\/.*/, token: "comment" },
    { regex: /\/\*/, token: "comment", next: "blockComment" },
    { regex: /"/, token: "string", next: "str" },
    { regex: /\$\{/, token: "meta", push: "interp" },
    {
      regex:
        /\b(?:resource|data|module|variable|output|provider|locals|terraform|backend|required_providers|required_version|for_each|count|depends_on|lifecycle|provisioner|dynamic|true|false|null)\b/,
      token: "keyword",
    },
    { regex: /\b\d+(?:\.\d+)?\b/, token: "number" },
    { regex: /[{}()[\]]/, token: "bracket" },
    { regex: /[A-Za-z_][\w-]*/, token: "variableName" },
  ],
  str: [
    { regex: /\\./, token: "string" },
    { regex: /\$\{/, token: "meta", push: "interp" },
    { regex: /"/, token: "string", next: "start" },
    { regex: /[^"\\$]+/, token: "string" },
    { regex: /\$/, token: "string" },
  ],
  interp: [
    { regex: /\}/, token: "meta", pop: true },
    { regex: /\{/, token: "bracket", push: "interp" },
    { regex: /[^}{]+/, token: "variableName" },
  ],
  blockComment: [
    { regex: /\*\//, token: "comment", next: "start" },
    { regex: /./, token: "comment" },
  ],
});
