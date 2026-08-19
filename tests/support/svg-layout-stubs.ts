/** jsdom has no SVG layout. Mermaid measures labels via getBBox / client rects. */
export function installSvgLayoutStubs(): void {
  const box = {
    bottom: 40,
    height: 40,
    left: 0,
    right: 160,
    toJSON() {
      return this;
    },
    top: 0,
    width: 160,
    x: 0,
    y: 0,
  };
  const matrix = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
    inverse() {
      return matrix;
    },
    multiply() {
      return matrix;
    },
  };
  const define = (target: object, name: string, value: unknown) => {
    try {
      Object.defineProperty(target, name, {
        configurable: true,
        value,
      });
    } catch {
      // jsdom may already expose a non-configurable native stub.
    }
  };
  define(SVGElement.prototype, "getBBox", () => box);
  define(SVGElement.prototype, "getCTM", () => matrix);
  define(SVGElement.prototype, "getScreenCTM", () => matrix);
  const graphics = (
    globalThis as typeof globalThis & {
      SVGGraphicsElement?: { prototype: SVGGraphicsElement };
    }
  ).SVGGraphicsElement;
  if (graphics) {
    define(graphics.prototype, "getBBox", () => box);
    define(graphics.prototype, "getCTM", () => matrix);
    define(graphics.prototype, "getScreenCTM", () => matrix);
  }
  const textProto = (
    globalThis as typeof globalThis & {
      SVGTextContentElement?: { prototype: SVGTextContentElement };
    }
  ).SVGTextContentElement;
  if (textProto) {
    Object.defineProperty(textProto.prototype, "getComputedTextLength", {
      configurable: true,
      value() {
        return ((this as SVGTextContentElement).textContent?.length ?? 0) * 8;
      },
    });
  }
  const original = HTMLElement.prototype.getBoundingClientRect;
  HTMLElement.prototype.getBoundingClientRect =
    function getBoundingClientRect() {
      const width = Number.parseFloat(this.style.width) || 160;
      const height =
        Number.parseFloat(this.style.height) ||
        Number.parseFloat(this.style.minHeight) ||
        40;
      if (
        this.hasAttribute("data-pier-slot") ||
        this.querySelector("[data-pier-slot]")
      ) {
        return {
          bottom: height,
          height,
          left: 0,
          right: width,
          toJSON() {
            return this;
          },
          top: 0,
          width,
          x: 0,
          y: 0,
        } as DOMRect;
      }
      return original.call(this);
    };
}
