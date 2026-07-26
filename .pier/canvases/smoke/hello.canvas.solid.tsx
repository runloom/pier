import { createSignal } from "solid-js";
import h from "solid-js/h";
import { render } from "solid-js/web";

/**
 * Solid canvas sample — open in files preview.
 *
 * `pier/canvas` is React-only. Use host shell classes (`pier-c-*`) for Frame /
 * Stack / Text / Badge / Button visual parity with the React smoke sample.
 *
 * Uses solid-js/h (explicit) so automatic JSX runtime resolve stays simple.
 * Requires: solid-js
 */
function App() {
  const [count, setCount] = createSignal(0);
  return h(
    "div",
    { class: "pier-c-frame" },
    h(
      "div",
      { class: "pier-c-stack" },
      h("h2", { class: "pier-c-text pier-c-text--title" }, "Smoke"),
      h(
        "p",
        { class: "pier-c-text pier-c-text--secondary" },
        "Solid pipeline ok. Shell classes track host design tokens; import project Solid components under the path fence."
      ),
      h(
        "div",
        { class: "pier-c-row" },
        h(
          "span",
          { class: "pier-c-badge pier-c-badge--neutral" },
          "solid · shell"
        ),
        h(
          "button",
          {
            class: "pier-c-button",
            type: "button",
            onClick: () => setCount((n) => n + 1),
          },
          () => `Count ${count()}`
        )
      )
    )
  );
}

export function mount(el: HTMLElement): () => void {
  return render(() => App(), el);
}

export default App;
