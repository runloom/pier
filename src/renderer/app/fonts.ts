const BUNDLED_FONT_STYLE_ID = "pier-bundled-font-faces";

const MONO_FONT_UNICODE_RANGE = [
  "U+0020-007F",
  "U+00A0-00FF",
  "U+0100-017F",
  "U+2000-206F",
  "U+2190-21FF",
  "U+2500-259F",
  "U+25A0-25FF",
  "U+2600-26FF",
  "U+2700-27BF",
  "U+E000-F8FF",
  "U+F0000-F0FFF",
].join(", ");

const BUNDLED_FONT_FACE_CSS = `
@font-face {
  font-family: "HarmonyOS Sans SC";
  font-style: normal;
  font-weight: 300;
  font-display: swap;
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Light.ttf") format("truetype");
}

@font-face {
  font-family: "HarmonyOS Sans SC";
  font-style: normal;
  font-weight: 400;
  font-display: swap;
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Regular.ttf") format("truetype");
}

@font-face {
  font-family: "HarmonyOS Sans SC";
  font-style: normal;
  font-weight: 500;
  font-display: swap;
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Medium.ttf") format("truetype");
}

@font-face {
  font-family: "HarmonyOS Sans SC";
  font-style: normal;
  font-weight: 600 700;
  font-display: swap;
  src: url("pier-asset://fonts/HarmonyOS_Sans_SC_Bold.ttf") format("truetype");
}

@font-face {
  font-family: "JetBrainsMono Nerd Font Mono";
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Regular.ttf") format("truetype");
  unicode-range: ${MONO_FONT_UNICODE_RANGE};
}

@font-face {
  font-family: "JetBrainsMono Nerd Font Mono";
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Bold.ttf") format("truetype");
  unicode-range: ${MONO_FONT_UNICODE_RANGE};
}

@font-face {
  font-family: "JetBrainsMono Nerd Font Mono";
  font-style: italic;
  font-weight: 400;
  font-display: block;
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-Italic.ttf") format("truetype");
  unicode-range: ${MONO_FONT_UNICODE_RANGE};
}

@font-face {
  font-family: "JetBrainsMono Nerd Font Mono";
  font-style: italic;
  font-weight: 700;
  font-display: block;
  src: url("pier-asset://fonts/JetBrainsMonoNerdFontMono-BoldItalic.ttf") format("truetype");
  unicode-range: ${MONO_FONT_UNICODE_RANGE};
}
`;

export function installBundledFontFaces(): void {
  if (document.getElementById(BUNDLED_FONT_STYLE_ID)) {
    return;
  }
  const style = document.createElement("style");
  style.id = BUNDLED_FONT_STYLE_ID;
  style.textContent = BUNDLED_FONT_FACE_CSS;
  document.head.append(style);
}
