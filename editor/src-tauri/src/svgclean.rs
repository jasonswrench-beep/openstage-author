// SPDX-License-Identifier: Apache-2.0
//! Cleaning an SVG picture before it is kept in a project.
//!
//! An SVG file is a document, not only a picture: it can carry a script, handlers that run when it is shown or clicked, a piece of a web page
//! (foreignObject), animations that change a link into a script, and references that fetch things from elsewhere. Shown in a course with an
//! img element none of that runs, but a learner can open the picture's own address in the LMS, and then it would run there. So every SVG that
//! comes into a project through the editor is rebuilt from what is known to be only drawing: a list of the drawing elements and, on them,
//! every attribute except handlers, outside links and outside references. Anything else is left out, with what is inside it. A file that is not
//! well-formed XML with an svg element at the top is refused.

use quick_xml::events::{BytesStart, Event};
use quick_xml::Reader;

/// Elements that only draw. Everything else is left out with its content, except `a`, whose content is kept without the link.
const DRAWING: &[&str] = &[
    "svg", "g", "defs", "symbol", "use", "title", "desc", "switch", "view", "path", "rect", "circle", "ellipse", "line", "polyline", "polygon", "text",
    "tspan", "textPath", "linearGradient", "radialGradient", "stop", "clipPath", "mask", "pattern", "marker", "image", "style", "filter", "feBlend",
    "feColorMatrix", "feComponentTransfer", "feComposite", "feConvolveMatrix", "feDiffuseLighting", "feDisplacementMap", "feDistantLight",
    "feDropShadow", "feFlood", "feFuncA", "feFuncB", "feFuncG", "feFuncR", "feGaussianBlur", "feMerge", "feMergeNode", "feMorphology", "feOffset",
    "fePointLight", "feSpecularLighting", "feSpotLight", "feTile", "feTurbulence",
];
const SVG_NS: &str = "http://www.w3.org/2000/svg";
const XLINK_NS: &str = "http://www.w3.org/1999/xlink";

/// The five entities XML itself defines, and numeric character references, are the only ones kept: a DOCTYPE's own are not read.
fn known_entity(name: &str) -> bool {
    matches!(name, "amp" | "lt" | "gt" | "quot" | "apos")
        || name.strip_prefix("#x").is_some_and(|h| !h.is_empty() && h.chars().all(|c| c.is_ascii_hexdigit()))
        || name.strip_prefix('#').is_some_and(|d| !d.is_empty() && d.chars().all(|c| c.is_ascii_digit()))
}

/// An attribute's value with its references turned into characters, or None if it uses one that is not known.
fn unescape(raw: &str) -> Option<String> {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(at) = rest.find('&') {
        out.push_str(&rest[..at]);
        let end = rest[at..].find(';')? + at;
        let name = &rest[at + 1..end];
        let ch = match name {
            "amp" => '&',
            "lt" => '<',
            "gt" => '>',
            "quot" => '"',
            "apos" => '\'',
            _ if name.starts_with("#x") => char::from_u32(u32::from_str_radix(&name[2..], 16).ok()?)?,
            _ if name.starts_with('#') => char::from_u32(name[1..].parse().ok()?)?,
            _ => return None,
        };
        out.push(ch);
        rest = &rest[end + 1..];
    }
    out.push_str(rest);
    Some(out)
}

fn escape(text: &str) -> String {
    text.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

/// A picture inside the SVG itself, as a data address of an ordinary picture type.
fn embedded_picture(value: &str) -> bool {
    let v = value.trim();
    ["data:image/png;base64,", "data:image/jpeg;base64,", "data:image/gif;base64,", "data:image/webp;base64,"].iter().any(|p| {
        v.len() > p.len() && v[..p.len()].eq_ignore_ascii_case(p) && v[p.len()..].bytes().all(|b| b.is_ascii_alphanumeric() || b"+/=".contains(&b) || b.is_ascii_whitespace())
    })
}

/// Whether CSS (a style element, or a style attribute) only styles: no import, no script address, and every url() points inside the picture.
fn css_is_safe(css: &str) -> bool {
    let lower = css.to_ascii_lowercase();
    if ["@import", "javascript:", "vbscript:", "expression(", "behavior", "-moz-binding", "\\"].iter().any(|bad| lower.contains(bad)) {
        return false;
    }
    let mut rest = lower.as_str();
    while let Some(at) = rest.find("url(") {
        let inner = rest[at + 4..].trim_start().trim_start_matches(['"', '\'']);
        if !inner.starts_with('#') {
            return false;
        }
        rest = &rest[at + 4..];
    }
    true
}

/// The attributes of a kept element that are kept, as `name="value"`, already escaped.
fn kept_attributes(e: &BytesStart, element: &str) -> Result<Vec<(String, String)>, String> {
    let mut kept = Vec::new();
    for attr in e.attributes() {
        let attr = attr.map_err(|_| "An attribute in it could not be read.".to_string())?;
        let name = attr.key.as_ref().to_string();
        let lower = name.to_ascii_lowercase();
        let Some(value) = unescape(&attr.value) else { continue };
        let value_lower = value.to_ascii_lowercase();
        let allowed = if lower.starts_with("on") {
            false
        } else if lower == "xmlns" {
            value == SVG_NS
        } else if lower == "xmlns:xlink" {
            value == XLINK_NS
        } else if lower == "href" || lower == "xlink:href" {
            value.trim_start().starts_with('#') || (element == "image" && embedded_picture(&value))
        } else if name.contains(':') {
            matches!(lower.as_str(), "xml:space" | "xml:lang")
        } else if lower == "style" {
            css_is_safe(&value)
        } else {
            !value_lower.contains("javascript:") && !value_lower.contains("vbscript:") && !value_lower.contains("data:") && (!value_lower.contains("url(") || css_is_safe(&value))
        };
        if allowed {
            kept.push((name, escape(&value)));
        }
    }
    Ok(kept)
}

fn open_tag(out: &mut String, name: &str, attributes: &[(String, String)], empty: bool) {
    out.push('<');
    out.push_str(name);
    for (k, v) in attributes {
        out.push(' ');
        out.push_str(k);
        out.push_str("=\"");
        out.push_str(v);
        out.push('"');
    }
    out.push_str(if empty { "/>" } else { ">" });
}

/// What became of an element that was opened: written, left out with what is inside it, or left out with what is inside it kept.
#[derive(Clone, Copy, PartialEq)]
enum Kept {
    Written,
    Dropped,
    Unwrapped,
}

/// The SVG rebuilt from its drawing only (see the module's description), or why it cannot be.
pub fn clean_svg(bytes: &[u8]) -> Result<Vec<u8>, String> {
    let text = std::str::from_utf8(bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes)).map_err(|_| "It is not written in UTF-8, the way SVG files usually are.".to_string())?;
    let mut reader = Reader::from_str(text);
    reader.config_mut().trim_text(false);
    reader.config_mut().check_end_names = true;
    let mut out = String::with_capacity(text.len());
    let mut stack: Vec<(String, Kept)> = Vec::new();
    let mut dropping = 0usize; // how many dropped elements we are inside
    let mut style_text: Option<String> = None;
    let mut seen_root = false;
    loop {
        let event = reader.read_event().map_err(|e| format!("It is not well-formed XML ({e})."))?;
        match event {
            Event::Start(ref e) | Event::Empty(ref e) => {
                let empty = matches!(event, Event::Empty(_));
                let name = e.name().as_ref().to_string();
                let kind = if dropping > 0 {
                    Kept::Dropped
                } else if !seen_root {
                    if name != "svg" {
                        return Err("It does not start with an svg element.".into());
                    }
                    Kept::Written
                } else if DRAWING.contains(&name.as_str()) {
                    Kept::Written
                } else if name == "a" {
                    Kept::Unwrapped
                } else {
                    Kept::Dropped
                };
                seen_root = true;
                match kind {
                    Kept::Written => {
                        let attributes = kept_attributes(e, &name)?;
                        if name == "style" && !empty {
                            open_tag(&mut out, &name, &attributes, false);
                            style_text = Some(String::new());
                        } else {
                            open_tag(&mut out, &name, &attributes, empty);
                        }
                    }
                    Kept::Dropped if !empty => dropping += 1,
                    _ => {}
                }
                if !empty {
                    stack.push((name, kind));
                }
            }
            Event::End(_) => {
                let (name, kind) = stack.pop().ok_or("It closes an element it never opened.")?;
                match kind {
                    Kept::Dropped => dropping = dropping.saturating_sub(1),
                    Kept::Unwrapped => {}
                    Kept::Written => {
                        if let Some(css) = style_text.take().filter(|_| name == "style") {
                            if css_is_safe(&css) {
                                out.push_str(&escape(&css));
                            }
                        }
                        out.push_str("</");
                        out.push_str(&name);
                        out.push('>');
                    }
                }
            }
            Event::Text(t) if dropping == 0 => match style_text.as_mut() {
                Some(css) => css.push_str(&t),
                None => out.push_str(&escape(&t)),
            },
            Event::CData(c) if dropping == 0 => {
                let inner = c.into_inner().into_owned();
                match style_text.as_mut() {
                    Some(css) => css.push_str(&inner),
                    None => out.push_str(&escape(&inner)),
                }
            }
            Event::GeneralRef(r) if dropping == 0 => {
                let name: &str = &r;
                if known_entity(name) {
                    let written = format!("&{name};");
                    match style_text.as_mut() {
                        Some(css) => css.push_str(&unescape(&written).unwrap_or_default()),
                        None => out.push_str(&written),
                    }
                }
            }
            Event::Eof => break,
            // Comments, processing instructions, the XML declaration and any DOCTYPE (with its entities) are left out.
            _ => {}
        }
    }
    if !seen_root {
        return Err("It has no svg element.".into());
    }
    if !stack.is_empty() {
        return Err("It ends before all of its elements are closed.".into());
    }
    Ok(out.into_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn clean(s: &str) -> String {
        String::from_utf8(clean_svg(s.as_bytes()).unwrap()).unwrap()
    }

    #[test]
    fn a_drawing_comes_through_as_it_was() {
        let svg = r##"<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 10 10"><defs><linearGradient id="g"><stop offset="0" stop-color="#fff"/></linearGradient></defs><g fill="url(#g)"><rect x="1" y="1" width="8" height="8"/><use xlink:href="#g"/><text x="1" y="5">A &amp; B</text></g></svg>"##;
        assert_eq!(clean(svg), svg);
    }

    #[test]
    fn scripts_handlers_foreign_content_and_animations_are_left_out() {
        let out = clean(r#"<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><rect onclick="alert(3)" width="5"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml"><iframe src="x"/></div></foreignObject><a href="javascript:alert(4)"><circle r="2"/><set attributeName="href" to="javascript:alert(5)"/><animate attributeName="href" values="javascript:alert(6)"/></a></svg>"#);
        assert_eq!(out, r#"<svg xmlns="http://www.w3.org/2000/svg"><rect width="5"/><circle r="2"/></svg>"#);
        for bad in ["alert", "script", "onload", "onclick", "foreignObject", "iframe", "javascript", "<set", "<animate", "<a "] {
            assert!(!out.contains(bad), "{bad} in {out}");
        }
    }

    #[test]
    fn only_links_inside_the_picture_and_embedded_pictures_are_kept() {
        let out = clean(r##"<svg xmlns="http://www.w3.org/2000/svg"><use href="https://example.org/x.svg#a"/><use href="#a"/><image href="https://example.org/track.png"/><image href="data:image/png;base64,iVBORw0KGgo="/><image href="data:image/svg+xml;base64,PHN2Zz4="/><feImage href="https://example.org/x"/><rect fill="url(https://example.org/p)" stroke="url(#ok)"/></svg>"##);
        assert_eq!(out, r##"<svg xmlns="http://www.w3.org/2000/svg"><use/><use href="#a"/><image/><image href="data:image/png;base64,iVBORw0KGgo="/><image/><rect stroke="url(#ok)"/></svg>"##);
    }

    #[test]
    fn a_style_sheet_that_imports_or_reaches_outside_is_emptied_and_a_safe_one_is_kept() {
        assert_eq!(clean(r#"<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style></svg>"#), r#"<svg xmlns="http://www.w3.org/2000/svg"><style>.a{fill:red}</style></svg>"#);
        assert_eq!(clean(r#"<svg xmlns="http://www.w3.org/2000/svg"><style><![CDATA[@import url(https://example.org/x.css); .a{fill:red}]]></style></svg>"#), r#"<svg xmlns="http://www.w3.org/2000/svg"><style></style></svg>"#);
        assert_eq!(clean(r#"<svg xmlns="http://www.w3.org/2000/svg"><rect style="fill:url(https://example.org/x)"/><rect style="fill:red"/></svg>"#), r#"<svg xmlns="http://www.w3.org/2000/svg"><rect/><rect style="fill:red"/></svg>"#);
    }

    #[test]
    fn editor_extras_a_doctype_and_comments_are_left_out() {
        let out = clean(r#"<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x SYSTEM "file:///c:/windows/win.ini">]><!-- made by hand --><svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" inkscape:version="1"><metadata>rdf</metadata><inkscape:grid/><text>&x;&#65;</text></svg>"#);
        assert_eq!(out, r#"<svg xmlns="http://www.w3.org/2000/svg"><text>&#65;</text></svg>"#);
    }

    #[test]
    fn what_is_not_an_svg_picture_is_refused() {
        for bad in ["", "not xml", "<html><script>alert(1)</script></html>", "<svg><g></svg>", "<svg>", "<svg></svg></svg>"] {
            assert!(clean_svg(bad.as_bytes()).is_err(), "{bad}");
        }
        assert!(clean_svg(&[0xff, 0xfe, b'<', 0]).is_err(), "not UTF-8");
        assert!(clean_svg(b"\xef\xbb\xbf<svg xmlns=\"http://www.w3.org/2000/svg\"/>").is_ok(), "a byte order mark is fine");
    }
}
