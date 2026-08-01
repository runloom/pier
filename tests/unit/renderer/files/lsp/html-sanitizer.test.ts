import { describe, expect, it } from "vitest";
import { sanitizeFilesLspHtml } from "../../../../../src/plugins/builtin/files/renderer/lsp/html-sanitizer.ts";

function sanitize(html: string): HTMLDivElement {
  const root = document.createElement("div");
  root.innerHTML = sanitizeFilesLspHtml(html);
  return root;
}

describe("sanitizeFilesLspHtml", () => {
  it.each([
    ["paragraph", "<p>Paragraph</p>", "p", "Paragraph"],
    ["top-level heading", "<h1>Heading one</h1>", "h1", "Heading one"],
    ["line break", "<p>Before<br>After</p>", "p > br", ""],
    ["lowest-level heading", "<h6>Heading six</h6>", "h6", "Heading six"],
    ["unordered list", "<ul><li>Item</li></ul>", "ul > li", "Item"],
    ["ordered list", "<ol><li>Item</li></ol>", "ol > li", "Item"],
    ["quotation", "<blockquote>Quoted</blockquote>", "blockquote", "Quoted"],
    [
      "preformatted code",
      "<pre><code>const value = 1;</code></pre>",
      "pre > code",
      "const value = 1;",
    ],
    [
      "strong emphasis",
      "<p><strong>Strong</strong></p>",
      "p > strong",
      "Strong",
    ],
    ["emphasis", "<p><em>Emphasis</em></p>", "p > em", "Emphasis"],
    ["deletion", "<p><del>Deleted</del></p>", "p > del", "Deleted"],
    [
      "table heading",
      "<table><thead><tr><th>Key</th></tr></thead></table>",
      "table > thead > tr > th",
      "Key",
    ],
    [
      "table body",
      "<table><tbody><tr><td>Value</td></tr></tbody></table>",
      "table > tbody > tr > td",
      "Value",
    ],
    [
      "syntax span",
      '<pre><code><span class="tok-keyword">const</span></code></pre>',
      "pre > code > span",
      "const",
    ],
  ])("preserves approved %s formatting", (_name, html, selector, text) => {
    const root = sanitize(html);

    expect(root.querySelector(selector)?.textContent).toBe(text);
  });

  it("preserves CodeMirror StyleModule highlight classes and multi tok-* classes", () => {
    const root = sanitize(
      '<pre><code><span class="ͼs">export</span> <span class="tok-propertyName tok-definition">foo</span></code></pre>'
    );
    const spans = root.querySelectorAll("pre > code > span");
    expect(spans).toHaveLength(2);
    expect(spans.item(0)?.getAttribute("class")).toBe("ͼs");
    expect(spans.item(1)?.getAttribute("class")).toBe(
      "tok-propertyName tok-definition"
    );
  });

  it.each([
    [
      "script",
      '<script>globalThis.__lspScriptSecret = "script-secret"</script>',
    ],
    ["style", "<style>.style-secret { color: red }</style>"],
    ["iframe", '<iframe src="https://example.com">iframe-secret</iframe>'],
    ["object", '<object data="https://example.com">object-secret</object>'],
    ["embed", '<embed src="https://example.com">'],
    ["form", '<form action="https://example.com"><p>form text</p></form>'],
    ["input", '<input value="input-secret">'],
    ["button", '<button type="submit">button text</button>'],
    ["template", "<template><p>template-secret</p></template>"],
    ["svg", '<svg><a href="https://example.com">svg text</a></svg>'],
    ["math", "<math><mi>math text</mi></math>"],
  ])("removes the forbidden <%s> element", (tag, html) => {
    const root = sanitize(html);

    expect(root.querySelector(tag)).toBeNull();
  });

  it("removes executable or inert hidden content rather than exposing it as documentation", () => {
    const result = sanitizeFilesLspHtml(`
      <script>script-secret</script>
      <style>style-secret</style>
      <template><p>template-secret</p></template>
      <p>visible documentation</p>
    `);

    expect(result).toContain("visible documentation");
    expect(result).not.toContain("script-secret");
    expect(result).not.toContain("style-secret");
    expect(result).not.toContain("template-secret");
  });

  it.each([
    ["div", "<div>division text</div>"],
    ["section", "<section>section text</section>"],
    ["img", '<img src="https://example.com/tracker.png" alt="tracker">'],
    ["video", '<video src="https://example.com/video.mp4">video text</video>'],
  ])("does not retain unapproved <%s> presentation markup", (tag, html) => {
    expect(sanitize(html).querySelector(tag)).toBeNull();
  });

  it("removes event, style, data, and unnecessary accessibility attributes", () => {
    const root = sanitize(`
      <p
        onclick="alert(1)"
        onmouseover="alert(2)"
        style="position: fixed"
        data-server-payload="secret"
        aria-label="spoofed label"
        aria-describedby="spoofed-description"
        aria-hidden="true"
      >Documentation</p>
    `);
    const paragraph = root.querySelector("p");

    expect(paragraph).not.toBeNull();
    for (const attribute of [
      "onclick",
      "onmouseover",
      "style",
      "data-server-payload",
      "aria-label",
      "aria-describedby",
      "aria-hidden",
    ]) {
      expect(paragraph?.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it("keeps only controlled tok-* syntax classes", () => {
    const root = sanitize(`
      <pre><code class="language-typescript tok-keyword arbitrary tok-variableName">const value</code></pre>
      <span class="cm-tooltip tok-string server-class tok-number">text</span>
      <span class="server-only">plain</span>
    `);
    const code = root.querySelector("code");
    const spans = root.querySelectorAll("span");

    expect(code?.getAttribute("class")).toBe("tok-keyword tok-variableName");
    expect(spans[0]?.getAttribute("class")).toBe("tok-string tok-number");
    expect(spans[1]?.hasAttribute("class")).toBe(false);
  });

  it.each([
    [
      "https://EXAMPLE.com:443/a/../docs?query=ok#intro",
      "https://example.com/docs?query=ok#intro",
    ],
    ["https://例え.テスト/guide", "https://xn--r8jz45g.xn--zckzah/guide"],
  ])("keeps a credential-free HTTPS link as canonical href and rel: %s", (href, canonicalHref) => {
    const root = sanitize(
      `<a href="${href}" class="server-link" onclick="alert(1)" style="color:red" data-id="1" aria-label="spoofed">Documentation</a>`
    );
    const anchor = root.querySelector("a");

    expect(anchor?.textContent).toBe("Documentation");
    expect(anchor?.getAttribute("href")).toBe(canonicalHref);
    expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer");
    for (const attribute of [
      "class",
      "onclick",
      "style",
      "data-id",
      "aria-label",
    ]) {
      expect(anchor?.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it.each([
    ["plain HTTP", "http://example.com/docs"],
    ["mail", "mailto:docs@example.com"],
    ["fragment", "#documentation"],
    ["relative", "../documentation"],
    ["protocol-relative", "//example.com/documentation"],
    ["JavaScript", "javascript:alert(1)"],
    ["data", "data:text/html;base64,PHNjcmlwdD4="],
    ["file", "file:///etc/passwd"],
    ["blob", "blob:https://example.com/8f00f5c0"],
    ["FTP", "ftp://example.com/documentation"],
    ["username credential", "https://user@example.com/private"],
    ["password credential", "https://:secret@example.com/private"],
  ])("unwraps a forbidden %s link as text", (_name, href) => {
    const root = sanitize(
      `<p>Before <a href="${href}">link text</a> after</p>`
    );

    expect(root.querySelector("a")).toBeNull();
    expect(root.textContent?.replace(/\s+/g, " ").trim()).toBe(
      "Before link text after"
    );
  });

  it("turns unsafe anchor descendants into plain text", () => {
    const root = sanitize(
      '<a href="http://example.com"><strong>Unsafe</strong> <em>link</em></a>'
    );

    expect(root.innerHTML).toBe("Unsafe link");
    expect(root.querySelector("a, strong, em")).toBeNull();
  });
});
