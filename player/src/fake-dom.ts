// A very small stand-in for the parts of a page that the question builders use, so a question can be built, answered and locked in a test with no browser.
// Events are fired by hand. Only what questions.ts asks of an element is here: add to it when a builder asks for more.

export interface FakeEvent {
  type: string;
  key: string;
  code: string;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  defaultPrevented: boolean;
  propagationStopped: boolean;
  preventDefault(): void;
  stopPropagation(): void;
}

type Listener = (e: FakeEvent) => void;

export class FakeEl {
  tag: string;
  className = "";
  attrs = new Map<string, string>();
  kids: FakeEl[] = [];
  listeners = new Map<string, Listener[]>();
  checked = false;
  disabled = false;
  readOnly = false;
  data = "";
  private own = "";

  constructor(tag: string) { this.tag = tag; }

  get id(): string { return this.attrs.get("id") ?? ""; }
  set id(v: string) { this.attrs.set("id", v); }

  get classList() {
    const list = (): string[] => this.className.split(/\s+/).filter(Boolean);
    return {
      add: (c: string): void => { if (!list().includes(c)) this.className = [...list(), c].join(" "); },
      remove: (c: string): void => { this.className = list().filter((x) => x !== c).join(" "); },
      contains: (c: string): boolean => list().includes(c),
      toggle: (c: string, force?: boolean): boolean => {
        const on = force ?? !list().includes(c);
        this.className = (on ? [...list().filter((x) => x !== c), c] : list().filter((x) => x !== c)).join(" ");
        return on;
      },
    };
  }

  get textContent(): string { return this.tag === "#text" ? this.data : this.kids.map((k) => k.textContent).join(""); }
  set textContent(v: string) {
    if (this.tag === "#text") { this.data = v; return; }
    this.kids = [];
    if (v !== "") { const t = new FakeEl("#text"); t.data = v; this.kids.push(t); }
  }

  // A drop-down holds only a value that is one of its options, or nothing, as a page's does.
  get value(): string { return this.own; }
  set value(v: string) {
    this.own = this.tag === "select" && !this.kids.some((k) => k.tag === "option" && k.attrs.get("value") === v) ? "" : v;
  }

  setAttribute(k: string, v: string): void { this.attrs.set(k, v); if (k === "value" && this.tag !== "select") this.own = v; }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string): boolean { return this.attrs.has(k); }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  append(...k: (FakeEl | string)[]): void { for (const x of k) this.appendChild(typeof x === "string" ? text(x) : x); }
  appendChild(k: FakeEl): FakeEl { this.kids.push(k); return k; }

  addEventListener(type: string, fn: Listener): void { (this.listeners.get(type) ?? this.listeners.set(type, []).get(type)!).push(fn); }

  /** Fire an event at this element, as the page would, and give it back to see what it was told to do. */
  fire(type: string, init: Partial<Pick<FakeEvent, "key" | "code" | "ctrlKey" | "altKey" | "shiftKey" | "metaKey">> = {}): FakeEvent {
    const e: FakeEvent = {
      type, key: "", code: "", ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init,
      defaultPrevented: false, propagationStopped: false,
      preventDefault() { e.defaultPrevented = true; },
      stopPropagation() { e.propagationStopped = true; },
    };
    for (const fn of this.listeners.get(type) ?? []) fn(e);
    return e;
  }

  /** Every element below this one, this one first, that the test accepts. */
  all(test: (e: FakeEl) => boolean = () => true): FakeEl[] {
    return [...(test(this) ? [this] : []), ...this.kids.flatMap((k) => k.all(test))];
  }
  byClass(cls: string): FakeEl[] { return this.all((e) => e.classList.contains(cls)); }
  byTag(tag: string): FakeEl[] { return this.all((e) => e.tag === tag); }
}

function text(data: string): FakeEl {
  const e = new FakeEl("#text");
  e.data = data;
  return e;
}

export const fakeDoc = {
  createElement: (tag: string): FakeEl => new FakeEl(tag),
  createTextNode: (data: string): FakeEl => text(data),
};

export const asDoc = (): Document => fakeDoc as unknown as Document;
