// OpenStage Author accessibility audit. A developer tool: it is not part of the editor and is not packaged.
// Run the dev server (node dev-server.mjs 5173), open the editor with ?dir=<a project folder>, then in the browser console:
//   await import("/__audit.js")        defines window.__audit(), __crawl(), __frameAt(), __overflow(), __dialogOverflow()
//   window.__audit()                   what is wrong with the screen as it is now
//   await window.__crawl()             visits every slide and object of the open project and gathers the distinct findings
// See docs/accessibility-audit.md for what it checks and what it cannot.
// Run in the page. Defines window.__audit(scope) which returns a list of {rule, where, detail}.
// Checks what a screen reader would be given: names, roles, structure, references, focus, target sizes and contrast.
(() => {
  const VALID_ROLES = new Set("alert alertdialog application article banner button cell checkbox columnheader combobox complementary contentinfo definition dialog directory document feed figure form generic grid gridcell group heading img link list listbox listitem log main marquee math menu menubar menuitem menuitemcheckbox menuitemradio navigation none note option presentation progressbar radio radiogroup region row rowgroup rowheader scrollbar search searchbox separator slider spinbutton status switch tab table tablist tabpanel term textbox timer toolbar tooltip tree treegrid treeitem".split(" "));
  const NAME_FROM_CONTENT = new Set(["button", "link", "tab", "option", "menuitem", "checkbox", "radio", "switch", "heading", "cell", "columnheader", "rowheader", "treeitem", "menuitemcheckbox", "menuitemradio"]);
  const IMPLICIT = (el) => {
    const t = el.tagName.toLowerCase();
    if (el.getAttribute("role")) return el.getAttribute("role").split(" ")[0];
    if (t === "button") return "button";
    if (t === "a" && el.hasAttribute("href")) return "link";
    if (t === "select") return el.multiple || el.size > 1 ? "listbox" : "combobox";
    if (t === "textarea") return "textbox";
    if (t === "input") {
      const ty = (el.type || "text").toLowerCase();
      return { checkbox: "checkbox", radio: "radio", range: "slider", number: "spinbutton", button: "button", submit: "button", reset: "button", color: "", file: "", search: "searchbox" }[ty] ?? "textbox";
    }
    if (/^h[1-6]$/.test(t)) return "heading";
    if (t === "ul" || t === "ol") return "list";
    if (t === "li") return "listitem";
    if (t === "nav") return "navigation";
    if (t === "main") return "main";
    if (t === "aside") return "complementary";
    if (t === "header") return "banner";
    if (t === "footer") return "contentinfo";
    if (t === "dialog") return "dialog";
    if (t === "img") return el.getAttribute("alt") === "" ? "presentation" : "img";
    if (t === "section") return el.hasAttribute("aria-label") || el.hasAttribute("aria-labelledby") ? "region" : "";
    if (t === "fieldset") return "group";
    return "";
  };
  const hiddenByStyle = (el) => {
    for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.display === "none" || cs.visibility === "hidden" || e.hidden || e.getAttribute("aria-hidden") === "true" || e.inert) return true;
    }
    return false;
  };
  const visible = (el) => !hiddenByStyle(el) && (el.getClientRects().length > 0);
  const sr = (el) => el.classList.contains("sr-only");
  const textOf = (el) => {
    let s = "";
    for (const n of el.childNodes) {
      if (n.nodeType === 3) s += n.textContent;
      else if (n.nodeType === 1) {
        if (n.getAttribute("aria-hidden") === "true" || getComputedStyle(n).display === "none") continue;
        if (n.tagName === "IMG") s += n.getAttribute("alt") ?? "";
        else if (n.tagName === "SVG" || n.tagName === "svg") s += n.getAttribute("aria-label") ?? "";
        else s += textOf(n);
      }
    }
    return s.replace(/\s+/g, " ").trim();
  };
  const accName = (el) => {
    const lb = el.getAttribute("aria-labelledby");
    if (lb) {
      const t = lb.split(/\s+/).map((id) => document.getElementById(id)).filter(Boolean).map((e) => textOf(e)).join(" ").trim();
      if (t) return t;
    }
    const al = el.getAttribute("aria-label");
    if (al && al.trim()) return al.trim();
    if (el.labels && el.labels.length) {
      const t = [...el.labels].map((l) => textOf(l)).join(" ").trim();
      if (t) return t;
    }
    if (el.tagName === "INPUT" && ["button", "submit", "reset"].includes(el.type)) return el.value || "";
    if (el.tagName === "IMG") return el.getAttribute("alt") ?? "";
    const role = IMPLICIT(el);
    if (NAME_FROM_CONTENT.has(role) || el.tagName === "SUMMARY") {
      const t = textOf(el);
      if (t) return t;
    }
    if (el.tagName === "FIELDSET") { const lg = el.querySelector(":scope > legend"); if (lg) return textOf(lg); }
    return (el.getAttribute("title") || "").trim();
  };
  const lum = (r, g, b) => { const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const parse = (c) => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const blend = (top, back) => ({ r: top.r * top.a + back.r * (1 - top.a), g: top.g * top.a + back.g * (1 - top.a), b: top.b * top.a + back.b * (1 - top.a), a: 1 });
  const bgOf = (el) => {
    const stack = [];
    for (let e = el; e; e = e.parentElement) {
      const cs = getComputedStyle(e);
      if (cs.backgroundImage !== "none") return null; // a picture or gradient: not judged here
      const c = parse(cs.backgroundColor);
      if (c && c.a > 0) { stack.push(c); if (c.a === 1) break; }
    }
    let base = { r: 255, g: 255, b: 255, a: 1 };
    for (let i = stack.length - 1; i >= 0; i--) base = blend(stack[i], base);
    return base;
  };
  const ratio = (a, b) => { const l1 = lum(a.r, a.g, a.b), l2 = lum(b.r, b.g, b.b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const sel = (el) => {
    const t = el.tagName.toLowerCase();
    const id = el.id ? `#${el.id}` : "";
    const key = el.dataset && el.dataset.key ? `[${el.dataset.key}]` : "";
    const cls = el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 2).join(".") : "";
    const nm = (accName(el) || textOf(el) || "").slice(0, 40);
    return `${t}${id}${cls}${key}${nm ? ` "${nm}"` : ""}`;
  };

  window.__audit = (scopeSel) => {
    const root = scopeSel ? document.querySelector(scopeSel) : document.body;
    const out = [];
    const add = (rule, el, detail) => out.push({ rule, where: sel(el), detail: detail || "" });
    const all = [...root.querySelectorAll("*")];

    // ids
    const ids = {};
    for (const el of document.querySelectorAll("[id]")) ids[el.id] = (ids[el.id] || 0) + 1;
    for (const [id, n] of Object.entries(ids)) if (n > 1) out.push({ rule: "duplicate-id", where: `#${id}`, detail: `${n} elements` });

    for (const el of all) {
      const role = IMPLICIT(el);
      const explicit = el.getAttribute("role");
      if (explicit) for (const r of explicit.split(/\s+/)) if (!VALID_ROLES.has(r)) add("invalid-role", el, r);
      for (const attr of ["aria-labelledby", "aria-describedby", "aria-controls", "aria-owns", "aria-activedescendant"]) {
        const v = el.getAttribute(attr);
        if (v) for (const id of v.split(/\s+/)) if (!document.getElementById(id)) add("dangling-reference", el, `${attr}=${id}`);
      }
      if (el.hasAttribute("tabindex") && Number(el.getAttribute("tabindex")) > 0) add("positive-tabindex", el, el.getAttribute("tabindex"));
      if (!visible(el)) {
        continue;
      }
      const focusable = el.matches("a[href], button, input:not([type=hidden]), select, textarea, summary, [tabindex], [contenteditable=true]") && !el.disabled && el.getAttribute("tabindex") !== "-1";
      const isControl = focusable || ["button", "link", "tab", "checkbox", "radio", "slider", "switch", "combobox", "textbox", "option", "menuitem", "spinbutton", "searchbox", "listbox"].includes(role);
      if (isControl && el.tagName !== "OPTION") {
        const nm = accName(el);
        if (!nm) add("no-accessible-name", el);
        // Label in name (WCAG 2.5.3): the words that can be seen must be in the name. Not for a select box or a list box: the words
        // they show are a value chosen or the entries of the list, never their label, and comparing them with the name flagged every
        // select named "Kind of question" that showed "All kinds" (found on OpenAssess, 2026-11-11).
        const vis = textOf(el);
        const words = (t) => t.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
        const showsValue = el.tagName === "SELECT" || role === "listbox" || role === "combobox";
        if (vis && !showsValue && role !== "group" && explicit !== "slider" && el.getAttribute("aria-label") && !words(el.getAttribute("aria-label")).includes(words(vis).slice(0, 24))) add("label-not-in-name", el, `visible "${vis.slice(0, 40)}" vs name "${el.getAttribute("aria-label").slice(0, 60)}"`);
        const r = el.getBoundingClientRect();
        if ((r.width < 24 || r.height < 24) && !sr(el) && el.type !== "hidden") add("target-too-small", el, `${Math.round(r.width)}x${Math.round(r.height)}`);
      }
      if (/^h[1-6]$/.test(el.tagName.toLowerCase()) && !textOf(el)) add("empty-heading", el);
      if (el.tagName === "IMG" && !el.hasAttribute("alt") && el.getAttribute("role") !== "presentation") add("img-no-alt", el);
      if (el.tagName === "svg" && !el.getAttribute("aria-hidden") && !el.getAttribute("aria-label") && !el.getAttribute("role") && !el.closest("[aria-hidden=true]") && !el.querySelector("title")) add("svg-unnamed-not-hidden", el);
      if (el.getAttribute("aria-hidden") === "true" && el.matches("a[href], button, input, select, textarea, [tabindex]") ) add("focusable-aria-hidden", el);
      if (el.getAttribute("aria-hidden") === "true" && el.querySelector("a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex='-1'])")) add("aria-hidden-contains-focusable", el);
      if (el.hasAttribute("aria-pressed") && role !== "button") add("aria-pressed-on-non-button", el, role);
      if (el.hasAttribute("aria-selected") && !["tab", "option", "gridcell", "row", "treeitem", "columnheader", "rowheader"].includes(role)) add("aria-selected-on-wrong-role", el, role);
      if (el.getAttribute("role") === "list" && el.tagName === "UL") { /* redundant, fine */ }
      if ((role === "list") && ![...el.children].every((c) => IMPLICIT(c) === "listitem" || c.tagName === "SCRIPT" || c.tagName === "TEMPLATE")) add("list-child-not-listitem", el);
      if (role === "listitem" && el.tagName !== "LI" && !el.parentElement?.closest("[role=list], ul, ol")) add("listitem-outside-list", el);
      if (role === "slider") {
        for (const a of ["aria-valuenow", "aria-valuemin", "aria-valuemax"]) if (!el.hasAttribute(a)) add("slider-missing-" + a, el);
        if (!el.hasAttribute("aria-valuetext")) add("slider-no-valuetext", el, "optional, but a time in seconds reads better than a bare number");
      }
      if (el.tagName === "INPUT" && el.type === "checkbox" && el.getAttribute("role") === "switch") { /* fine */ }
      if (el.matches("input[type=text], input[type=number], textarea, select") && !accName(el)) { /* already reported */ }
      if (el.tagName === "DIALOG" && el.open && !el.getAttribute("aria-labelledby") && !el.getAttribute("aria-label")) add("dialog-unnamed", el);
      if (el.tagName === "TABLE") {
        if (!el.querySelector("th")) add("table-no-headers", el);
        if (!el.querySelector("caption") && !el.getAttribute("aria-label") && !el.getAttribute("aria-labelledby")) add("table-no-name", el);
      }
      if (el.tagName === "TH" && !el.hasAttribute("scope") && !el.closest("thead")) add("th-no-scope", el);

      // contrast of the text this element draws itself
      const own = [...el.childNodes].filter((n) => n.nodeType === 3 && n.textContent.trim());
      if (own.length && !sr(el)) {
        const cs = getComputedStyle(el);
        const fg = parse(cs.color);
        const bg = bgOf(el);
        if (fg && bg) {
          const f = fg.a < 1 ? blend(fg, bg) : fg;
          const size = parseFloat(cs.fontSize);
          const bold = parseInt(cs.fontWeight, 10) >= 700;
          const large = size >= 24 || (bold && size >= 18.66);
          const need = large ? 3 : 4.5;
          const r = ratio(f, bg);
          const disabled = el.disabled || el.closest("[aria-disabled=true], :disabled");
          if (r < need && !disabled) add("text-contrast", el, `${r.toFixed(2)}:1 needs ${need}:1 (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`);
          else if (r < need && disabled) add("text-contrast-disabled-control", el, `${r.toFixed(2)}:1 (exempt: inactive control)`);
          if (size < 12) add("small-text", el, `${size}px`);
        }
      }
    }
    // landmarks
    const lms = [...root.querySelectorAll("header, nav, main, aside, footer, section[aria-label], section[aria-labelledby], [role=banner], [role=navigation], [role=main], [role=complementary], [role=contentinfo], [role=region], form")].filter(visible);
    const seen = {};
    for (const l of lms) {
      const key = IMPLICIT(l) + "|" + accName(l);
      seen[key] = (seen[key] || 0) + 1;
      if (["navigation", "complementary", "region"].includes(IMPLICIT(l)) && !accName(l)) add("landmark-unnamed", l, IMPLICIT(l));
    }
    for (const [k, n] of Object.entries(seen)) if (n > 1) out.push({ rule: "landmark-duplicate", where: k, detail: `${n}` });
    // headings
    const hs = [...root.querySelectorAll("h1,h2,h3,h4,h5,h6,[role=heading]")].filter(visible);
    let prev = 0;
    for (const hd of hs) {
      const lv = hd.getAttribute("aria-level") ? Number(hd.getAttribute("aria-level")) : /^h(\d)$/i.test(hd.tagName) ? Number(hd.tagName[1]) : 2;
      if (prev && lv > prev + 1) add("heading-skip", hd, `${prev} to ${lv}`);
      prev = lv;
    }
    return out;
  };
  window.__headings = () => [...document.querySelectorAll("h1,h2,h3,h4,h5,h6")].filter(visible).map((h) => `${h.tagName} ${textOf(h)}`);
  window.__landmarks = () => [...document.querySelectorAll("header, nav, main, aside, footer, section[aria-label], section[aria-labelledby], [role=region], dialog[open]")].filter((e) => !hiddenByStyle(e) || e.tagName === "DIALOG").map((l) => `${IMPLICIT(l) || l.tagName} "${accName(l)}"`);
  return "audit defined";
})()

// Visit every slide and every object of the open project, audit each state, and gather the distinct findings.
window.__crawl = async () => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const found = {};
  const record = (ctx, list) => {
    for (const v of list) {
      if (v.where.startsWith('div.canvas-wrap')) continue;
      const k = v.rule + '|' + v.where.replace(/ ".*"$/, '').replace(/[0-9]+/g, 'N') + '|' + v.detail.replace(/[0-9.]+/g, '#').slice(0, 60);
      (found[k] = found[k] || { rule: v.rule, where: v.where, detail: v.detail, n: 0, first: ctx }).n++;
    }
  };
  // The Properties panel shows one tab at a time (Content, Style, Behaviour), with its sections folded, and the audit only sees what shows,
  // so each tab is visited with every section opened.
  const openSections = async () => {
    for (const b of [...document.querySelectorAll('.props-tabpanel:not([hidden]) .props-section-toggle[aria-expanded="false"]')]) b.click();
    await wait(40);
  };
  const everyTab = async (ctx) => {
    const tabs = [...document.querySelectorAll('.props [role=tab]')];
    if (tabs.length === 0) { await openSections(); record(ctx, window.__audit()); return; }
    for (const t of tabs) {
      t.click();
      await openSections();
      record(ctx + ' ' + t.textContent, window.__audit());
    }
  };
  const slides = [...document.querySelectorAll('button.item[data-key^="slide:"]')].map((b) => b.dataset.key);
  const types = {};
  for (const key of slides) {
    document.querySelector(`button.item[data-key="${key}"]`).click();
    await wait(120);
    await everyTab(key);
    for (const ok of [...document.querySelectorAll('button.item[data-key^="object:"]')].map((b) => b.dataset.key)) {
      document.querySelector(`button.item[data-key="${ok}"]`).click();
      await wait(90);
      const id = document.querySelector('.props-body .identity')?.textContent || '';
      types[id.split(',')[0]] = (types[id.split(',')[0]] || 0) + 1;
      await everyTab(key + '/' + ok + ' ' + id);
    }
  }
  return { slides: slides.length, types, found: Object.values(found) };
};

// ---- Narrow-window checks: load the editor in an iframe of a given width and look for sideways overflow.
window.__frameAt = async (width, height = 900) => {
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  document.getElementById('probeframe')?.remove();
  const f = document.createElement('iframe');
  f.id = 'probeframe'; f.style.cssText = `position:fixed;left:0;top:0;width:${width}px;height:${height}px;z-index:99999;background:#fff;border:0`;
  f.src = location.href; document.body.append(f);
  await new Promise((r) => (f.onload = r)); await wait(400);
  f.contentDocument.getElementById('welcome-open').click();
  await wait(1300);
  return f;
};
window.__overflow = (f) => {
  const d = f.contentDocument, w = f.contentWindow, de = d.documentElement;
  const over = [...d.querySelectorAll('body *')].filter((e) => { if (!e.getClientRects().length || e.closest('.os-stage')) return false; const r = e.getBoundingClientRect(); return r.right > w.innerWidth + 1 || r.left < -1; }).slice(0, 6).map((e) => e.tagName.toLowerCase() + '.' + (e.className || '') + (e.id ? '#' + e.id : ''));
  return { sw: de.scrollWidth, iw: w.innerWidth, hscroll: de.scrollWidth > w.innerWidth + 1, over };
};
window.__dialogOverflow = (f) => {
  const d = f.contentDocument, dlg = d.querySelector('dialog[open]'); if (!dlg) return 'no dialog';
  const dr = dlg.getBoundingClientRect();
  const clipped = [...dlg.querySelectorAll('*')].filter((e) => { if (!e.getClientRects().length || e.closest('.tm-scroll')) return false; const cs = f.contentWindow.getComputedStyle(e); if (cs.position === 'fixed') return false; const r = e.getBoundingClientRect(); return r.right > dr.right + 1 || r.left < dr.left - 1; });
  return { dialogW: Math.round(dr.width), hscrollInside: dlg.scrollWidth > dlg.clientWidth + 1, clipped: clipped.slice(0, 5).map((e) => e.tagName.toLowerCase() + '.' + (e.className || e.id || '') + ' R' + Math.round(e.getBoundingClientRect().right - dr.right)) };
};
