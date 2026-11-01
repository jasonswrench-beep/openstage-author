"""A Word document for reviewers, made from a project.

    python review_doc.py PROJECT_DIR OUT.docx [--json]

A colleague or an accessibility reviewer wants to read a course and write on it, not click through it. The document has, for
every slide, what is on it in the order a screen reader reads it: the words, the alt text of each picture, the narration script,
the questions with their right answers marked, and the items of each interaction. At the front are the problems the checker
found. It does not list rules, timing or animation: those are how the course behaves, and a reviewer sees them by trying it.

The file is a Word 2007 or later document written directly with the standard library, so there is nothing to install. It uses real
heading styles (so Word's navigation pane works), real tables with a header row that repeats, a document title and a language.
The same project always gives the same bytes (the dates come from the project, not the clock), so a republish changes the file only
if the course changed.
"""

import datetime
import html
import json
import pathlib
import re
import sys
import zipfile
from html.parser import HTMLParser

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))  # -I mode drops the script folder
import validate  # noqa: E402
from quiztext import canonical_shortcut, read_passage  # noqa: E402

# ---------------------------------------------------------------- text

_INVALID_XML = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\ud800-\udfff￾￿]")


def clean(text):
    """Text Word can hold: no control characters, which XML 1.0 forbids even as escapes."""
    return _INVALID_XML.sub("", str(text))


def esc(text):
    return html.escape(clean(text), quote=False)


def esc_attr(text):
    return html.escape(clean(text), quote=True)


class _Blocks(HTMLParser):
    """The paragraphs, headings and list items of a text object's HTML, as (kind, text) pairs. The kinds are h1 to h6, p, li and quote."""

    BLOCK = {"p", "h1", "h2", "h3", "h4", "h5", "h6", "li", "blockquote", "div", "tr"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.blocks = []
        self._kind = "p"
        self._text = []
        self._href = []

    def _flush(self):
        text = re.sub(r"[ \t\r\f\v]+", " ", "".join(self._text)).strip(" \n")
        text = re.sub(r" *\n *", "\n", text)
        if text:
            self.blocks.append((self._kind, text))
        self._text = []

    def handle_starttag(self, tag, attrs):
        if tag in self.BLOCK:
            self._flush()
            self._kind = {"blockquote": "quote"}.get(tag, tag)
        elif tag == "br":
            self._text.append("\n")
        elif tag == "a":
            self._href.append(dict(attrs).get("href", ""))

    def handle_endtag(self, tag):
        if tag in self.BLOCK:
            self._flush()
            self._kind = "p"
        elif tag == "a" and self._href:
            href = self._href.pop()
            # A reviewer should see where a link goes, since it is not visible in the words.
            if href and not href.startswith("#"):
                self._text.append(f" ({href})")

    def handle_data(self, data):
        self._text.append(data)


def blocks_of(markup):
    parser = _Blocks()
    parser.feed(markup or "")
    parser.close()
    parser._flush()
    return parser.blocks


def plain(markup):
    """Text with no tags, paragraphs separated by a blank line."""
    return "\n\n".join(t for _, t in blocks_of(markup))


# ---------------------------------------------------------------- the Word package

W_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PAGE_W, MARGIN = 12240, 1440
TEXT_W = PAGE_W - 2 * MARGIN  # 9360 twips, six and a half inches


class Doc:
    """Builds the body of a document, one paragraph or table at a time."""

    def __init__(self):
        self.body = []

    # runs and paragraphs
    @staticmethod
    def run(text, bold=False, italic=False):
        text = clean(text)
        props = ("<w:b/><w:bCs/>" if bold else "") + ("<w:i/><w:iCs/>" if italic else "")
        out = []
        for i, line in enumerate(text.split("\n")):
            if i:
                out.append(f"<w:r>{('<w:rPr>' + props + '</w:rPr>') if props else ''}<w:br/></w:r>")
            if line:
                out.append(f'<w:r>{("<w:rPr>" + props + "</w:rPr>") if props else ""}<w:t xml:space="preserve">{esc(line)}</w:t></w:r>')
        return "".join(out)

    def _runs(self, parts):
        if isinstance(parts, str):
            parts = [parts]
        xml = []
        for part in parts:
            if isinstance(part, str):
                xml.append(self.run(part))
            else:
                text, kind = part
                xml.append(self.run(text, bold="b" in kind, italic="i" in kind))
        return "".join(xml)

    def para(self, parts, style=None, keep_next=False, bullet=False):
        ppr = ""
        if style:
            ppr += f'<w:pStyle w:val="{style}"/>'
        if keep_next:
            ppr += "<w:keepNext/>"
        if bullet:
            ppr += '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>'
        self.body.append(f"<w:p>{('<w:pPr>' + ppr + '</w:pPr>') if ppr else ''}{self._runs(parts)}</w:p>")

    def heading(self, level, text):
        self.para(text, style=f"Heading{level}")

    def table(self, header, rows, widths, caption):
        """A real table. The first row is a header row that repeats on each page, and a screen reader reads each cell with its header."""
        grid = "".join(f'<w:gridCol w:w="{w}"/>' for w in widths)
        look = '<w:tblLook w:val="0420" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/>'
        out = [
            "<w:tbl><w:tblPr>"
            f'<w:tblStyle w:val="TableGrid"/><w:tblW w:w="{sum(widths)}" w:type="dxa"/><w:tblLayout w:type="fixed"/>{look}'
            f'<w:tblCaption w:val="{esc_attr(caption)}"/>'
            f"</w:tblPr><w:tblGrid>{grid}</w:tblGrid>"
        ]

        def cell(text, width, bold):
            paragraphs = "".join(f'<w:p><w:pPr><w:pStyle w:val="TableText"/></w:pPr>{self.run(line, bold=bold)}</w:p>' for line in (clean(text).split("\n\n") or [""]))
            return f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/></w:tcPr>{paragraphs}</w:tc>'

        if header:
            out.append('<w:tr><w:trPr><w:cantSplit/><w:tblHeader/></w:trPr>' + "".join(cell(h, w, True) for h, w in zip(header, widths)) + "</w:tr>")
        for row in rows:
            out.append("<w:tr><w:trPr><w:cantSplit/></w:trPr>" + "".join(cell(c, w, False) for c, w in zip(row, widths)) + "</w:tr>")
        out.append("</w:tbl>")
        self.body.append("".join(out))
        # A table must be followed by a paragraph, or Word has nowhere to put the cursor.
        self.para("", style="AfterTable")

    def document_xml(self):
        sect = (
            f'<w:sectPr><w:pgSz w:w="{PAGE_W}" w:h="15840"/>'
            f'<w:pgMar w:top="{MARGIN}" w:right="{MARGIN}" w:bottom="{MARGIN}" w:left="{MARGIN}" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr>'
        )
        return f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="{W_NS}"><w:body>{"".join(self.body)}{sect}</w:body></w:document>'


def _style(style_id, name, based_on="Normal", next_style=None, ppr="", rpr="", q_format=True, kind="paragraph"):
    return (
        f'<w:style w:type="{kind}" w:styleId="{style_id}"><w:name w:val="{name}"/>'
        + (f'<w:basedOn w:val="{based_on}"/>' if based_on else "")
        + (f'<w:next w:val="{next_style}"/>' if next_style else "")
        + ("<w:qFormat/>" if q_format else "")
        + (f"<w:pPr>{ppr}</w:pPr>" if ppr else "")
        + (f"<w:rPr>{rpr}</w:rPr>" if rpr else "")
        + "</w:style>"
    )


def styles_xml(language):
    lang = esc_attr(language)
    heading = lambda n, size, before: _style(  # noqa: E731
        f"Heading{n}", f"heading {n}", next_style="Normal",
        ppr=f'<w:keepNext/><w:keepLines/><w:spacing w:before="{before}" w:after="120"/><w:outlineLvl w:val="{n - 1}"/>',
        rpr=f'<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri"/><w:b/><w:bCs/><w:color w:val="1F2D3D"/><w:sz w:val="{size}"/><w:szCs w:val="{size}"/>',
    )
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        f'<w:styles xmlns:w="{W_NS}"><w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/>'
        f'<w:lang w:val="{lang}" w:eastAsia="{lang}" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>'
        '<w:style w:type="character" w:default="1" w:styleId="DefaultParagraphFont"><w:name w:val="Default Paragraph Font"/><w:uiPriority w:val="1"/><w:semiHidden/><w:unhideWhenUsed/></w:style>'
        '<w:style w:type="table" w:default="1" w:styleId="TableNormal"><w:name w:val="Normal Table"/><w:uiPriority w:val="99"/><w:semiHidden/><w:unhideWhenUsed/>'
        '<w:tblPr><w:tblInd w:w="0" w:type="dxa"/><w:tblCellMar><w:top w:w="0" w:type="dxa"/><w:left w:w="108" w:type="dxa"/><w:bottom w:w="0" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>'
        + _style("Title", "Title", next_style="Subtitle", ppr='<w:spacing w:before="0" w:after="120"/>',
                 rpr='<w:b/><w:bCs/><w:color w:val="1F2D3D"/><w:sz w:val="52"/><w:szCs w:val="52"/>')
        + _style("Subtitle", "Subtitle", next_style="Normal", ppr='<w:spacing w:after="240"/>', rpr='<w:color w:val="3D4654"/><w:sz w:val="28"/><w:szCs w:val="28"/>')
        + heading(1, 34, 360) + heading(2, 28, 300) + heading(3, 24, 200)
        + _style("ListBullet", "List Bullet", ppr='<w:numPr><w:numId w:val="1"/></w:numPr><w:spacing w:after="60"/><w:contextualSpacing/>')
        + _style("ObjectLabel", "Object Label", next_style="Normal", ppr='<w:keepNext/><w:spacing w:before="200" w:after="40"/>',
                 rpr='<w:b/><w:bCs/><w:color w:val="1D3F8F"/><w:sz w:val="22"/><w:szCs w:val="22"/>')
        + _style("Detail", "Detail", ppr='<w:spacing w:after="60"/><w:ind w:left="360"/>')
        + _style("Choice", "Choice", ppr='<w:spacing w:after="40"/><w:ind w:left="720" w:hanging="360"/>')
        + _style("TableText", "Table Text", ppr='<w:spacing w:before="40" w:after="40"/>', rpr='<w:sz w:val="20"/><w:szCs w:val="20"/>')
        + _style("AfterTable", "After Table", ppr='<w:spacing w:before="0" w:after="60"/>', rpr='<w:sz w:val="8"/><w:szCs w:val="8"/>', q_format=False)
        + '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:basedOn w:val="TableNormal"/><w:uiPriority w:val="39"/>'
        '<w:tblPr><w:tblBorders>'
        + "".join(f'<w:{side} w:val="single" w:sz="4" w:space="0" w:color="5B6472"/>' for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
        + "</w:tblBorders></w:tblPr></w:style></w:styles>"
    )


NUMBERING_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<w:numbering xmlns:w="{W_NS}"><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>'
    '<w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="bullet"/><w:lvlText w:val="•"/><w:lvlJc w:val="left"/>'
    '<w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum>'
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>'
)

SETTINGS_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    f'<w:settings xmlns:w="{W_NS}"><w:defaultTabStop w:val="720"/><w:characterSpacingControl w:val="doNotCompress"/>'
    '<w:compat><w:compatSetting w:name="compatibilityMode" w:uri="http://schemas.microsoft.com/office/word" w:val="15"/></w:compat></w:settings>'
)

CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>'
    '<Override PartName="/word/settings.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.settings+xml"/>'
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
    "</Types>"
)

ROOT_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
    "</Relationships>"
)

DOC_RELS = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>'
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/settings" Target="settings.xml"/>'
    "</Relationships>"
)

APP_XML = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
    '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OpenStage Author</Application></Properties>'
)


def core_xml(title, author, language, when):
    return (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" '
        'xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
        f"<dc:title>{esc(title)}</dc:title><dc:creator>{esc(author)}</dc:creator><dc:language>{esc(language)}</dc:language>"
        f'<dcterms:created xsi:type="dcterms:W3CDTF">{when}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">{when}</dcterms:modified>'
        "</cp:coreProperties>"
    )


def package(doc, title, author, language, when):
    """The finished file as bytes. Every part is written with the same fixed time, so the same document is always the same bytes."""
    parts = [
        ("[Content_Types].xml", CONTENT_TYPES), ("_rels/.rels", ROOT_RELS), ("word/document.xml", doc.document_xml()),
        ("word/_rels/document.xml.rels", DOC_RELS), ("word/styles.xml", styles_xml(language)), ("word/numbering.xml", NUMBERING_XML),
        ("word/settings.xml", SETTINGS_XML), ("docProps/core.xml", core_xml(title, author, language, when)), ("docProps/app.xml", APP_XML),
    ]
    import io

    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as z:
        for name, text in parts:
            info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            z.writestr(info, text.encode("utf-8"))
    return buffer.getvalue()


# ---------------------------------------------------------------- what a course says

LABELS = {
    "text": "Text", "scrollingText": "Scrolling text", "image": "Picture", "shape": "Shape", "button": "Button", "hotspot": "Hotspot", "video": "Video",
    "audio": "Audio", "quizQuestion": "Question", "interaction": "Interaction", "table": "Table", "input": "Input", "embed": "Embedded video",
    "results": "Results box", "certificate": "Certificate", "download": "File to download", "scenario": "Scenario", "icon": "Icon", "timer": "Timer",
}
QUESTION_TYPES = {
    "multipleChoice": "multiple choice", "multipleResponse": "multiple response", "shortAnswer": "short answer", "numeric": "number",
    "fillBlanks": "fill in the blanks", "matching": "matching", "sequencing": "sequencing", "hotspot": "choose an area of a picture",
    "essay": "essay", "whichWord": "choose a word of a passage", "shortcut": "keyboard shortcut",
}
INTERACTION_KINDS = {
    "clickReveal": "click and reveal", "flipCards": "flip cards", "tabs": "tabs", "accordion": "accordion", "carousel": "content carousel", "steps": "step process",
    "timeline": "timeline", "processCircle": "process circle", "glossary": "glossary", "pyramidStack": "pyramid stack", "pyramidMatrix": "pyramid matrix",
    "circleMatrix": "circle matrix", "labeledGraphic": "labeled graphic",
}
NEEDS_ALT = {"image", "icon", "video", "audio", "shape", "hotspot"}


def letter(i):
    return chr(ord("A") + i) if i < 26 else str(i + 1)


def reading_order(objects):
    """The order a screen reader reads them: objects with a tab order first, by that order, then the rest as they come. The same rule as the player's."""
    tabbed = sorted((o for o in objects if (o["accessibility"].get("tabOrder") or 0) >= 1), key=lambda o: o["accessibility"]["tabOrder"])
    rest = [o for o in objects if (o["accessibility"].get("tabOrder") or 0) < 1]
    return tabbed + rest


class Writer:
    def __init__(self, project, slides, findings):
        self.project = project
        self.slides = slides
        self.findings = findings
        self.doc = Doc()
        self.people = {p["id"]: p.get("name", p["id"]) for p in project.get("characters", []) if isinstance(p, dict) and "id" in p}

    # small pieces
    def line(self, label, text, bold_label=True):
        self.doc.para([(f"{label}: ", "b" if bold_label else ""), text], style="Detail")

    def note(self, text):
        self.doc.para(text, style="Detail")

    def text_blocks(self, markup, style="Detail"):
        for kind, text in blocks_of(markup):
            if kind.startswith("h") and len(kind) == 2:
                self.doc.para([(f"Heading {kind[1]}: ", "b"), text], style=style)
            elif kind == "li":
                self.doc.para(text, bullet=True)
            elif kind == "quote":
                self.doc.para([(text, "i")], style=style)
            else:
                self.doc.para(text, style=style)

    def narration(self, narration, label="Narration"):
        if isinstance(narration, dict) and str(narration.get("script", "")).strip():
            voice = narration.get("voice")
            self.doc.para([(f"{label}{f' ({voice})' if voice else ''}: ", "b"), str(narration["script"]).strip()], style="Detail")

    def alt(self, obj, label="Alt text"):
        a = obj["accessibility"]
        if a.get("decorative"):
            self.note("Decorative: a screen reader skips it.")
        elif str(a.get("altText", "")).strip():
            self.line(label, a["altText"])
        elif obj["type"] in NEEDS_ALT:
            self.doc.para([(f"{label}: ", "b"), ("MISSING", "b"), (". A screen reader has nothing to say for it.", "")], style="Detail")

    def picture(self, image, label="Picture"):
        if not image:
            return
        if image.get("decorative"):
            self.note(f"{label}: {pathlib.PurePosixPath(image['src']).name}. Decorative: a screen reader skips it.")
        elif str(image.get("alt", "")).strip():
            self.note(f"{label}: {pathlib.PurePosixPath(image['src']).name}. Alt text: {image['alt']}")
        else:
            self.doc.para([(f"{label}: {pathlib.PurePosixPath(image['src']).name}. Alt text: ", ""), ("MISSING", "b")], style="Detail")

    def who(self, speaker):
        if speaker is None:
            return "Narrator"
        if speaker == "you":
            return "You (the learner's character)"
        return self.people.get(speaker, speaker)

    # one object
    def label_for(self, obj):
        kind = LABELS.get(obj["type"], obj["type"])
        c = obj["content"]
        extra = ""
        if obj["type"] == "quizQuestion":
            s = c.get("scoring", {})
            extra = f" ({QUESTION_TYPES.get(c.get('questionType'), c.get('questionType'))}, {s.get('points', 0)} points, {s.get('attemptsAllowed', 1)} {'try' if s.get('attemptsAllowed', 1) == 1 else 'tries'})"
        elif obj["type"] == "interaction":
            extra = f" ({INTERACTION_KINDS.get(c.get('kind'), c.get('kind'))})"
        elif obj["type"] == "input":
            extra = f" ({c.get('kind')})"
        name = obj.get("name", "")
        named = f": {name}" if name and name.lower() != kind.lower() and obj["type"] in ("image", "button", "video", "audio", "download", "interaction", "scenario", "table", "input") else ""
        return f"{kind}{named}{extra}"

    def object(self, obj, layer_names):
        self.doc.para(self.label_for(obj), style="ObjectLabel")
        getattr(self, f"o_{obj['type']}", self.o_other)(obj, layer_names)
        self.narration(obj.get("narration"))

    def o_other(self, obj, layer_names):
        self.alt(obj)

    def o_text(self, obj, layer_names):
        self.text_blocks(obj["content"].get("html", ""))

    o_scrollingText = o_text

    def o_image(self, obj, layer_names):
        self.alt(obj)
        if obj["content"].get("enlargeable"):
            self.note("Learners can enlarge this picture.")

    def o_shape(self, obj, layer_names):
        self.alt(obj)

    def o_icon(self, obj, layer_names):
        self.alt(obj)

    def o_button(self, obj, layer_names):
        self.line("Label", obj["content"].get("label", ""))

    def o_hotspot(self, obj, layer_names):
        self.alt(obj, "Name")

    def o_video(self, obj, layer_names):
        c = obj["content"]
        self.line("File", pathlib.PurePosixPath(c.get("src", "")).name)
        self.alt(obj)
        self.line("Captions", pathlib.PurePosixPath(c["captions"]).name if c.get("captions") else "none")
        if str(c.get("transcript", "")).strip():
            self.line("Transcript", c["transcript"].strip())

    o_audio = o_video

    def o_embed(self, obj, layer_names):
        c = obj["content"]
        self.line("Video", f"{c.get('provider', '')} {c.get('id', '')}".strip())
        self.line("Author says it has captions", "yes" if c.get("captionsConfirmed") else "no")
        if str(c.get("transcript", "")).strip():
            self.line("Transcript", c["transcript"].strip())

    def o_download(self, obj, layer_names):
        c = obj["content"]
        self.line("Link text", c.get("title", ""))
        self.line("Description", c.get("description", ""))
        self.line("File", pathlib.PurePosixPath(c.get("src", "")).name)
        self.line("Author says it is accessible", "yes" if c.get("accessibleConfirmed") else "no")

    def o_timer(self, obj, layer_names):
        c = obj["content"]
        self.line("Label", c.get("label", ""))
        self.line("Time", f"{c.get('seconds', 0)} seconds")

    def o_results(self, obj, layer_names):
        c = obj["content"]
        self.line("Heading", c.get("heading", ""))
        self.line("If the learner passes", c.get("passMessage", ""))
        self.line("If the learner does not pass", c.get("failMessage", ""))
        self.line("Shows each question", "yes" if c.get("review") else "no")

    def o_certificate(self, obj, layer_names):
        c = obj["content"]
        for key, label in (("title", "Title"), ("statement", "Statement"), ("achievement", "Achievement"), ("issuedBy", "Issued by")):
            if str(c.get(key, "")).strip():
                self.line(label, c[key])

    def o_table(self, obj, layer_names):
        c = obj["content"]
        rows = c.get("rows") or []
        if str(c.get("caption", "")).strip():
            self.line("Caption", c["caption"])
        if not rows:
            return
        width = max(len(r) for r in rows)
        widths = [TEXT_W // width] * width
        widths[-1] += TEXT_W - sum(widths)
        padded = [list(r) + [""] * (width - len(r)) for r in rows]
        if c.get("headerRow"):
            self.doc.table(padded[0], padded[1:], widths, c.get("caption") or obj.get("name") or "Table")
        else:
            self.doc.table(None, padded, widths, c.get("caption") or obj.get("name") or "Table")
            self.note("This table has no header row.")

    def o_interaction(self, obj, layer_names):
        c = obj["content"]
        self.alt(obj, "Name for a screen reader")
        if c.get("graphic"):
            self.picture(c["graphic"], "Main picture")
        if c.get("guided"):
            self.note("Guided: the learner can step through the markers in order with Previous and Next.")
        for i, item in enumerate(c.get("items", [])):
            self.doc.para([(f"Item {i + 1}: {item['title']}", "b")], style="Detail", keep_next=True)
            if c.get("kind") == "labeledGraphic" and item.get("x") is not None:
                self.note(f"Marker {i + 1} is {item['x']} percent across and {item['y']} percent down the picture.")
            self.text_blocks(item.get("body", ""))
            self.picture(item.get("image"))
            self.narration(item.get("narration"), "Narration for this item")

    def o_input(self, obj, layer_names):
        c = obj["content"]
        self.line("Prompt", c.get("prompt", ""))
        kind = c.get("kind")
        if c.get("options"):
            for i, o in enumerate(c["options"]):
                self.doc.para(f"{letter(i)}. {o['label']}", style="Choice")
        if c.get("items"):
            for i, o in enumerate(c["items"]):
                self.doc.para(f"{letter(i)}. {o['label']} (a tick box)", style="Choice")
        if kind == "likert":
            self.line("Scale", ", ".join(c.get("scale", [])))
            for i, r in enumerate(c.get("rows", [])):
                self.doc.para(f"{i + 1}. {r['label']}", style="Choice")
        elif kind == "semantic":
            self.line("Points", f"{c.get('points')} between the two words")
            for i, r in enumerate(c.get("rows", [])):
                self.doc.para(f"{i + 1}. {r['label']} to {r.get('right', '')}", style="Choice")
        elif kind in ("slider", "dial"):
            unit = c.get("unit", "")
            self.line("Scale", f"{c.get('min')} to {c.get('max')} in steps of {c.get('step')}{(' ' + unit) if unit else ''}")
            if c.get("startLabel") or c.get("endLabel"):
                self.line("Ends", f"{c.get('startLabel', '')} to {c.get('endLabel', '')}")
        elif kind == "text":
            self.line("Box", f"{c.get('lines', 1)} line{'s' if c.get('lines', 1) != 1 else ''}, up to {c.get('maxLength', 200)} characters")
            if str(c.get("hint", "")).strip():
                self.line("Hint", c["hint"])
        elif kind == "character":
            self.line("Choose between", ", ".join(self.people.get(p, p) for p in c.get("characters", [])))
        self.line("Answers go to the LMS", "yes" if c.get("report") else "no")

    def o_scenario(self, obj, layer_names):
        c = obj["content"]
        titles = {n["id"]: n["title"] for n in c.get("nodes", [])}
        self.alt(obj, "Name for a screen reader")
        for m in c.get("meters", []):
            self.line("Meter", f"{m['label']} ({m['min']} to {m['max']})")
        for n in c.get("nodes", []):
            ending = " (an ending)" if not n.get("choices") else ""
            self.doc.para([(f"Situation: {n['title']}{ending}", "b")], style="Detail", keep_next=True)
            if str(n.get("prompt", "")).strip():
                self.note(f"Question: {n['prompt']}")
            for ln in n.get("lines", []):
                self.doc.para([(f"{self.who(ln.get('speaker'))}: ", "b"), ln.get("text", "")], style="Detail")
                self.narration(ln.get("narration"))
            for ch in n.get("choices", []):
                self.doc.para([("Choice: ", "b"), f"{ch['label']} (leads to {titles.get(ch['next'], ch['next'])})"], style="Choice")
                for ln in ch.get("response", []):
                    self.doc.para([(f"{self.who(ln.get('speaker'))}: ", "b"), ln.get("text", "")], style="Choice")
        if str(c.get("reflection", "")).strip():
            self.line("Reflection", c["reflection"])

    def o_quizQuestion(self, obj, layer_names):
        c = obj["content"]
        t = c.get("questionType")
        # A question has no wording of its own: the words a learner reads are on the text next to it. Its alt text is the name a screen reader gives the group.
        self.alt(obj, "Name for a screen reader")
        right = " (correct answer)"
        if t in ("multipleChoice", "multipleResponse"):
            for i, ch in enumerate(c.get("choices", [])):
                self.doc.para([(f"{letter(i)}. {ch['label']}", ""), (right, "b") if ch.get("correct") else ("", "")], style="Choice")
            if c.get("shuffle"):
                self.note("The choices are shown in a different order to each learner.")
        elif t == "shortAnswer":
            self.line("Accepted answers", "; ".join(c.get("answers", [])) + (" (capitals matter)" if c.get("caseSensitive") else ""))
        elif t == "numeric":
            lo, hi = c.get("min"), c.get("max")
            self.line("Right answer", str(lo) if lo == hi else f"any number from {lo} to {hi}")
        elif t == "fillBlanks":
            self.line("Sentence", c.get("text", ""))
            for b in c.get("blanks", []):
                self.line(f"Blank {b['id']}", "; ".join(b.get("answers", [])))
            if c.get("wordBank"):
                self.line("Words offered", ", ".join(c["wordBank"]))
        elif t == "matching":
            for i, p in enumerate(c.get("pairs", [])):
                self.doc.para([(f"{i + 1}. {p['premise']} matches ", ""), (p["match"], "b")], style="Choice")
            if c.get("extras"):
                self.line("Extra wrong options", "; ".join(c["extras"]))
        elif t == "sequencing":
            self.note("The right order is:")
            for i, it in enumerate(c.get("items", [])):
                self.doc.para(f"{i + 1}. {it['text']}", style="Choice")
        elif t == "hotspot":
            self.picture(c.get("image"), "Picture")
            for r in c.get("regions", []):
                self.doc.para([(f"{r['label']}", ""), (right, "b") if r.get("correct") else ("", "")], style="Choice")
        elif t == "essay":
            minimum = c.get("minWords", 0)
            self.line("Answer", "Written by the learner and not marked: it counts as answered" + (f" from {minimum} words." if minimum > 1 else " once something is written."))
        elif t == "whichWord":
            read = read_passage(c.get("passage", ""))
            runs = []
            for piece in read["pieces"]:
                if piece[0] == "word" and read["words"][int(piece[2][1:]) - 1][1]:
                    runs.append((piece[1], "b"))
                else:
                    runs.append(piece[1])
            self.doc.para(runs, style="Choice")
            self.note("The learner chooses one word. The right word is in bold.")
        elif t == "shortcut":
            self.line("Right shortcuts", "; ".join(canonical_shortcut(k) or k for k in c.get("keys", [])))
        fb = c.get("feedback", {})
        for key, words in (("correct", "after a right answer"), ("incorrect", "after a wrong answer")):
            if fb.get(key):
                self.line(f"Shown {words}", layer_names.get(fb[key], fb[key]))

    # layers and slides
    def layer_notes(self, slide):
        """Why each layer other than the base one is shown: a question's feedback, or a rule on an object."""
        names = {layer["id"]: layer["name"] for layer in [slide["baseLayer"]] + slide["layers"]}
        why = {layer["id"]: [] for layer in slide["layers"]}
        for layer in [slide["baseLayer"]] + slide["layers"]:
            for o in layer["objects"]:
                if o["type"] == "quizQuestion":
                    for key, words in (("correct", "a right answer"), ("incorrect", "a wrong answer")):
                        target = o["content"].get("feedback", {}).get(key)
                        if target in why:
                            why[target].append(f"{words} to a question")
                for t in o.get("triggers", []):
                    if t.get("action") == "showLayer" and t.get("target") in why:
                        note = f"a rule on '{o.get('name') or o['id']}'"
                        if note not in why[t["target"]]:
                            why[t["target"]].append(note)
        return names, why

    def slide(self, number, slide):
        self.doc.heading(2, f"Slide {number}: {slide['name']}")
        facts = []
        if slide.get("hideNavigation"):
            facts.append("The course's Back and Next are hidden here.")
        if slide.get("duration"):
            facts.append(f"The slide moves on by itself after {slide['duration'] / 1000:g} seconds.")
        if facts:
            self.note(" ".join(facts))
        names, why = self.layer_notes(slide)
        layers = [(slide["baseLayer"], False)] + [(layer, True) for layer in slide["layers"]]
        for layer, extra in layers:
            if extra:
                self.doc.heading(3, f"Layer: {layer['name']}")
                if why[layer["id"]]:
                    self.note("Shown after " + "; ".join(why[layer["id"]]) + ".")
                else:
                    self.note("Nothing shows this layer yet.")
            if not layer["objects"]:
                self.note("Nothing on this layer." if extra else "Nothing on this slide.")
            for obj in reading_order(layer["objects"]):
                self.object(obj, names)

    def problems(self):
        d = self.doc
        d.heading(1, "Problems the checker found")
        errors = [f for f in self.findings if f.severity == "error"]
        warnings = [f for f in self.findings if f.severity != "error"]
        if not self.findings:
            d.para("The checker found no problems.")
            return
        d.para(f"The checker found {len(errors)} {'error' if len(errors) == 1 else 'errors'} and {len(warnings)} {'warning' if len(warnings) == 1 else 'warnings'}. "
               "Errors stop a course being published; warnings do not.")
        labels = {s["id"]: f"Slide {i + 1}: {s['name']}" for i, s in enumerate(self.slides)}
        rows = []
        for f in sorted(self.findings, key=lambda f: (f.severity != "error", f.file, f.object_id, f.rule)):
            stem = pathlib.PurePosixPath(f.file).stem
            where = labels.get(stem, f.file)
            if f.object_id and f.object_id != "-":
                where += f" ({f.object_id})"
            rows.append(["Error" if f.severity == "error" else "Warning", where, f.message, f.detail])
        d.table(["Kind", "Where", "Problem", "Detail"], rows, [900, 2300, 2900, 3260], "Problems the checker found")

    def build(self):
        meta = self.project["meta"]
        d = self.doc
        d.para(meta["title"], style="Title")
        d.para("Review document", style="Subtitle")
        d.para(f"Author: {meta.get('author') or 'not given'}. Language: {meta['language']}. Last changed: {meta['modified']}. "
               f"{len(self.slides)} {'slide' if len(self.slides) == 1 else 'slides'}.")
        d.heading(1, "How to read this document")
        d.para("Every slide is a Heading 2, and a layer that appears on a slide is a Heading 3, so Word's navigation pane lists them. What is on a slide is listed in the "
               "order a screen reader reads it. Alt text is what a screen reader says for a picture; MISSING marks a picture that has none. Narration is the script that is "
               "spoken. A right answer to a question is marked (correct answer). Rules, timing and animation are not listed: they are how the course behaves, and the "
               "way to review them is to try the course.")
        self.problems()
        d.heading(1, "Slides")
        for number, slide in enumerate(self.slides, start=1):
            self.slide(number, slide)
        return d


# ---------------------------------------------------------------- the project on disk

def load_slides(project_dir, project):
    """The slides in the order the course plays them, each once."""
    ids = []
    for scene in project["scenes"]:
        for sid in scene["slides"]:
            if sid not in ids:
                ids.append(sid)
    slides = []
    for sid in ids:
        path = project_dir / "slides" / f"{sid}.json"
        if not path.is_file():
            raise ValueError(f"The course plays slide {sid}, but slides/{sid}.json is not in the project")
        slides.append(json.loads(path.read_text(encoding="utf-8")))
    return slides


def make(project_dir):
    """The review document for the project in `project_dir`, as bytes, and a short account of what it holds."""
    project_dir = pathlib.Path(project_dir)
    project = json.loads((project_dir / "project.json").read_text(encoding="utf-8"))
    slides = load_slides(project_dir, project)
    findings = validate.validate_project(project_dir)
    doc = Writer(project, slides, findings).build()
    meta = project["meta"]
    try:
        when = datetime.date.fromisoformat(meta["modified"]).isoformat() + "T00:00:00Z"
    except ValueError:
        when = "1980-01-01T00:00:00Z"
    data = package(doc, meta["title"], meta.get("author", ""), meta["language"], when)
    return data, {
        "slides": len(slides),
        "errors": sum(1 for f in findings if f.severity == "error"),
        "warnings": sum(1 for f in findings if f.severity != "error"),
    }


def main(argv):
    # Scripts, alt text and names can be in any language, and a Windows pipe or console is not UTF-8 unless asked: what is printed (the JSON the editor
    # and the publisher read, the progress and the messages) is made UTF-8 so a course in Japanese does not stop the tool.
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            stream.reconfigure(encoding="utf-8")
    args = [a for a in argv if not a.startswith("--")]
    as_json = "--json" in argv
    if len(args) != 2:
        print("Usage: python review_doc.py PROJECT_DIR OUT.docx [--json]", file=sys.stderr)
        return 2
    try:
        data, summary = make(args[0])
        out = pathlib.Path(args[1])
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(data)
    except (OSError, KeyError, ValueError) as err:
        message = f"The review document could not be made: {err}"
        print(json.dumps({"ok": False, "message": message}) if as_json else message, file=sys.stderr if not as_json else sys.stdout)
        return 1
    if as_json:
        print(json.dumps({"ok": True, "path": str(out), **summary}))
    else:
        print(f"Review document: {out} ({summary['slides']} slides; {summary['errors']} errors and {summary['warnings']} warnings listed)")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
