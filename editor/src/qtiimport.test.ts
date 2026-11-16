// Tests for reading questions from a QTI file: QTI 1.2 (one file of items), 2.1 and 3.0 (a package with a file for each item), every kind that
// comes in, every kind that is left out and why, the feedback, the points, hostile files, and that what comes in becomes slides the real checker accepts.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { zipSync } from "../../player/src/unzip.ts";
import { Model } from "./model.ts";
import { describeRead } from "./questionimport.ts";
import { readQti, readXml } from "./qtiimport.ts";
import { newProjectFiles } from "./template.ts";

const enc = (s: string) => new TextEncoder().encode(s);
const repo = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

// ---- QTI 1.2, written the way a learning system writes it

const lid = (ident: string, labels: [string, string][], card = "Single") =>
  `<response_lid ident="${ident}" rcardinality="${card}"><render_choice shuffle="No">${labels.map(([i, t]) => `<response_label ident="${i}"><material><mattext texttype="text/plain">${t}</mattext></material></response_label>`).join("")}</render_choice></response_lid>`;
const stem = (html: string) => `<material><mattext texttype="text/html">${html.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}</mattext></material>`;
const meta = (kind: string, points: string) => `<itemmetadata><qtimetadata><qtimetadatafield><fieldlabel>question_type</fieldlabel><fieldentry>${kind}</fieldentry></qtimetadatafield><qtimetadatafield><fieldlabel>points_possible</fieldlabel><fieldentry>${points}</fieldentry></qtimetadatafield></qtimetadata></itemmetadata>`;
const award = (cond: string, pts = "100") => `<respcondition continue="No"><conditionvar>${cond}</conditionvar><setvar varname="SCORE" action="Set">${pts}</setvar></respcondition>`;
const outcomes = `<outcomes><decvar maxvalue="100" minvalue="0" varname="SCORE" vartype="Decimal"/></outcomes>`;

const QTI12 = `<?xml version="1.0" encoding="UTF-8"?>
<questestinterop xmlns="http://www.imsglobal.org/xsd/ims_qtiasiv1p2"><assessment ident="a1" title="Week 3"><section ident="root_section">
<item ident="q1" title="Planets">${meta("multiple_choice_question", "5")}
<presentation>${stem("<p>Which of these is a <b>planet</b>?</p>")}${lid("response1", [["a", "Mars"], ["b", "The Moon"], ["c", "The Sun"]])}</presentation>
<resprocessing>${outcomes}${award('<varequal respident="response1">a</varequal>')}</resprocessing></item>
<item ident="q2" title="Flowers">${meta("multiple_answers_question", "10")}
<presentation>${stem("<p>Pick the flowers</p>")}${lid("response1", [["a", "Rose"], ["b", "Granite"], ["c", "Tulip"]], "Multiple")}</presentation>
<resprocessing>${outcomes}${award('<and><varequal respident="response1">a</varequal><not><varequal respident="response1">b</varequal></not><varequal respident="response1">c</varequal></and>')}</resprocessing></item>
<item ident="q3" title="True or false">${meta("true_false_question", "1")}
<presentation>${stem("<p>A reply to everyone is always right.</p>")}${lid("response1", [["t", "True"], ["f", "False"]])}</presentation>
<resprocessing>${outcomes}${award('<varequal respident="response1">f</varequal>')}</resprocessing></item>
<item ident="q4" title="Short">${meta("short_answer_question", "2")}
<presentation>${stem("<p>The capital of France?</p>")}<response_str ident="response1" rcardinality="Single"><render_fib><response_label ident="answer1" rshuffle="No"/></render_fib></response_str></presentation>
<resprocessing>${outcomes}${award('<varequal respident="response1">Paris</varequal>')}${award('<varequal respident="response1">paris, france</varequal>')}</resprocessing></item>
<item ident="q5" title="Essay">${meta("essay_question", "20")}
<presentation>${stem("<p>Discuss.</p>")}<response_str ident="response1" rcardinality="Single"><render_fib><response_label ident="answer1" rshuffle="No"/></render_fib></response_str></presentation>
<resprocessing>${outcomes}<respcondition continue="No"><conditionvar><other/></conditionvar></respcondition></resprocessing></item>
<item ident="q6" title="Matching">${meta("matching_question", "4")}
<presentation>${stem("<p>Match them</p>")}${lid("response1", [["x", "A"]])}${lid("response2", [["x", "A"]])}</presentation>
<resprocessing>${outcomes}</resprocessing></item>
</section></assessment></questestinterop>`;

test("a QTI 1.2 file gives each kind of question its words, answers, right answers and points", () => {
  const read = readQti(enc(QTI12), "week3.xml");
  assert.equal(read.rows, 6);
  assert.deepEqual(read.questions.map((q) => [q.type, q.question]), [
    ["mc", "Which of these is a planet?"],
    ["mr", "Pick the flowers"],
    ["tf", "A reply to everyone is always right."],
    ["short", "The capital of France?"],
    ["essay", "Discuss."],
  ]);
  const [mc, mr, tf, short, essay] = read.questions;
  assert.deepEqual([mc!.answers, mc!.correct, mc!.points], [["Mars", "The Moon", "The Sun"], [0], 5]);
  assert.deepEqual([mr!.answers, mr!.correct, mr!.points], [["Rose", "Granite", "Tulip"], [0, 2], 10]);
  assert.deepEqual([tf!.answers, tf!.correct], [["True", "False"], [1]]);
  assert.deepEqual([short!.answers, short!.points], [["Paris", "paris, france"], 2]);
  assert.deepEqual([essay!.answers, essay!.correct, essay!.points], [[], [], 20]);
  assert.match(describeRead(read), /5 questions can be added/);
});

test("a kind with no form in a table of questions is left out and named, and the rest still come in", () => {
  const read = readQti(enc(QTI12), "week3.xml");
  const left = read.problems.filter((p) => p.severity === "error");
  assert.equal(left.length, 1);
  assert.equal(left[0]!.row, 6, "the sixth item in the file");
  assert.match(left[0]!.message, /matching/);
});

test("QTI 1.2 feedback: the one tied to the right answer, the one for any other, and a general one for both", () => {
  const withFeedback = `<questestinterop><assessment><section>
<item ident="q1" title="x"><presentation>${stem("<p>Q?</p>")}${lid("r", [["a", "Yes"], ["b", "No"]])}</presentation>
<resprocessing>${outcomes}<respcondition continue="Yes"><conditionvar><varequal respident="r">a</varequal></conditionvar><displayfeedback feedbacktype="Response" linkrefid="a_fb"/></respcondition><respcondition continue="Yes"><conditionvar><varequal respident="r">b</varequal></conditionvar><displayfeedback feedbacktype="Response" linkrefid="b_fb"/></respcondition>${award('<varequal respident="r">a</varequal>')}</resprocessing>
<itemfeedback ident="a_fb"><flow_mat><material><mattext texttype="text/html">&lt;p&gt;Well done.&lt;/p&gt;</mattext></material></flow_mat></itemfeedback>
<itemfeedback ident="b_fb"><flow_mat><material><mattext texttype="text/plain">Think again.</mattext></material></flow_mat></itemfeedback></item>
<item ident="q2" title="y"><presentation>${stem("<p>Q2?</p>")}${lid("r", [["a", "Yes"], ["b", "No"]])}</presentation>
<resprocessing>${outcomes}${award('<varequal respident="r">b</varequal>')}</resprocessing>
<itemfeedback ident="correct_fb"><flow_mat><material><mattext texttype="text/plain">Right.</mattext></material></flow_mat></itemfeedback>
<itemfeedback ident="general_incorrect_fb"><flow_mat><material><mattext texttype="text/plain">Not this one.</mattext></material></flow_mat></itemfeedback>
<itemfeedback ident="general_fb"><flow_mat><material><mattext texttype="text/plain">Read on.</mattext></material></flow_mat></itemfeedback></item>
</section></assessment></questestinterop>`;
  const [one, two] = readQti(enc(withFeedback), "f.xml").questions;
  assert.deepEqual([one!.rightFeedback, one!.wrongFeedback], ["Well done.", "Think again."]);
  assert.deepEqual([two!.rightFeedback, two!.wrongFeedback], ["Right.", "Not this one."]);
});

test("a picture in a question is counted and said, and the words round it are kept", () => {
  const pic = `<questestinterop><assessment><section><item ident="q" title="p"><presentation>${stem('<p>Look at <img src="a.png" alt="a chart"/> and say.</p>')}${lid("r", [["a", "x"], ["b", "y"]])}</presentation><resprocessing>${outcomes}${award('<varequal respident="r">a</varequal>')}</resprocessing></item></section></assessment></questestinterop>`;
  const read = readQti(enc(pic), "p.xml");
  assert.equal(read.questions[0]!.question, "Look at and say.");
  assert.ok(read.notes!.some((n) => /picture/.test(n)), read.notes!.join(" | "));
});

// ---- QTI 2.1 and 3.0

const MANIFEST = `<manifest xmlns="http://www.imsglobal.org/xsd/imscp_v1p1"><resources>
<resource identifier="t" type="imsqti_test_xmlv2p1" href="assessmentTest.xml"><file href="assessmentTest.xml"/></resource>
<resource identifier="i2" type="imsqti_item_xmlv2p1" href="items/second.xml"><file href="items/second.xml"/></resource>
<resource identifier="i1" type="imsqti_item_xmlv2p1" href="items/first.xml"><file href="items/first.xml"/></resource>
</resources></manifest>`;
const item21 = (id: string, body: string, decl: string, extra = "") => `<?xml version="1.0"?><assessmentItem xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="${id}" title="${id}" adaptive="false" timeDependent="false">${decl}${extra}<itemBody>${body}</itemBody></assessmentItem>`;
const choice21 = item21("first",
  `<choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="1"><prompt>Which is the largest planet?</prompt><simpleChoice identifier="A">Mars</simpleChoice><simpleChoice identifier="B">Jupiter</simpleChoice><simpleChoice identifier="C">Venus</simpleChoice></choiceInteraction>`,
  `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier"><correctResponse><value>B</value></correctResponse></responseDeclaration>`,
  `<outcomeDeclaration identifier="MAXSCORE" cardinality="single" baseType="float"><defaultValue><value>3</value></defaultValue></outcomeDeclaration><modalFeedback outcomeIdentifier="FEEDBACK" identifier="correct" showHide="show"><p>Yes, Jupiter.</p></modalFeedback><modalFeedback outcomeIdentifier="FEEDBACK" identifier="incorrect" showHide="show"><p>Look at the sizes again.</p></modalFeedback>`);
const entry21 = item21("second",
  `<p>The capital of France is <textEntryInteraction responseIdentifier="RESPONSE" expectedLength="10"/>.</p>`,
  `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"><correctResponse><value>Paris</value></correctResponse><mapping defaultValue="0"><mapEntry mapKey="Paris" mappedValue="1"/><mapEntry mapKey="paris" mappedValue="1"/></mapping></responseDeclaration>`);
const multi21 = item21("third",
  `<choiceInteraction responseIdentifier="RESPONSE" shuffle="false" maxChoices="0"><prompt>Pick the even numbers.</prompt><simpleChoice identifier="a">2</simpleChoice><simpleChoice identifier="b">3</simpleChoice><simpleChoice identifier="c">4</simpleChoice></choiceInteraction>`,
  `<responseDeclaration identifier="RESPONSE" cardinality="multiple" baseType="identifier"><correctResponse><value>a</value><value>c</value></correctResponse></responseDeclaration>`);
const order21 = item21("fourth", `<orderInteraction responseIdentifier="RESPONSE" shuffle="true"><prompt>Put in order</prompt><simpleChoice identifier="a">1</simpleChoice><simpleChoice identifier="b">2</simpleChoice></orderInteraction>`, `<responseDeclaration identifier="RESPONSE" cardinality="ordered" baseType="identifier"/>`);
const essay21 = item21("fifth", `<extendedTextInteraction responseIdentifier="RESPONSE"><prompt>Explain your view.</prompt></extendedTextInteraction>`, `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="string"/>`);

test("a QTI 2.1 package is read in the order its manifest lists the files, and the other kinds come in too", () => {
  const zip = zipSync({
    "imsmanifest.xml": enc(MANIFEST),
    "assessmentTest.xml": enc('<assessmentTest xmlns="http://www.imsglobal.org/xsd/imsqti_v2p1" identifier="t" title="T"/>'),
    "items/first.xml": enc(choice21), "items/second.xml": enc(entry21), "items/third.xml": enc(multi21), "items/fourth.xml": enc(order21), "items/fifth.xml": enc(essay21),
  });
  const read = readQti(zip, "package.zip");
  // The manifest names second then first; the third, fourth and fifth are in no resource and follow in the order of their names (fifth, fourth, third).
  assert.deepEqual(read.questions.map((q) => q.type), ["short", "mc", "essay", "mr"]);
  const [short, mc, essay, mr] = read.questions;
  assert.equal(short!.question, "The capital of France is ____ .");
  assert.deepEqual(short!.answers, ["Paris", "paris"]);
  assert.deepEqual([mc!.question, mc!.answers, mc!.correct, mc!.points, mc!.rightFeedback, mc!.wrongFeedback], ["Which is the largest planet?", ["Mars", "Jupiter", "Venus"], [1], 3, "Yes, Jupiter.", "Look at the sizes again."]);
  assert.deepEqual([mr!.answers, mr!.correct], [["2", "3", "4"], [0, 2]]);
  assert.equal(essay!.question, "Explain your view.");
  const left = read.problems.filter((p) => p.severity === "error");
  assert.equal(left.length, 1);
  assert.match(left[0]!.message, /putting in order/);
});

test("QTI 3.0 names (qti-assessment-item, qti-choice-interaction) are read the same way", () => {
  const item30 = `<?xml version="1.0"?><qti-assessment-item xmlns="http://www.imsglobal.org/xsd/imsqti_v3p0" identifier="i" title="i" adaptive="false" time-dependent="false">
<qti-response-declaration identifier="RESPONSE" cardinality="single" base-type="identifier"><qti-correct-response><qti-value>t</qti-value></qti-correct-response></qti-response-declaration>
<qti-item-body><qti-choice-interaction response-identifier="RESPONSE" shuffle="false" max-choices="1"><qti-prompt>The sea is salty.</qti-prompt><qti-simple-choice identifier="t">True</qti-simple-choice><qti-simple-choice identifier="f">False</qti-simple-choice></qti-choice-interaction></qti-item-body></qti-assessment-item>`;
  const read = readQti(enc(item30), "i.xml");
  assert.deepEqual(read.questions.map((q) => [q.type, q.question, q.answers, q.correct]), [["tf", "The sea is salty.", ["True", "False"], [0]]]);
});

test("a question whose right answer cannot be read, or with no words, is left out and says so", () => {
  const noKey = item21("k", `<choiceInteraction responseIdentifier="RESPONSE" maxChoices="1"><prompt>Pick</prompt><simpleChoice identifier="A">x</simpleChoice><simpleChoice identifier="B">y</simpleChoice></choiceInteraction>`, `<responseDeclaration identifier="RESPONSE" cardinality="single" baseType="identifier"/>`);
  const read = readQti(enc(noKey), "k.xml");
  assert.equal(read.questions.length, 0);
  assert.match(read.problems[0]!.message, /right answer is not stated/);
  assert.match(describeRead(read), /No question could be read/);
});

// ---- the file as a whole

test("a file that is not QTI, an empty file and a damaged zip each say what is wrong", () => {
  assert.match(readQti(enc("<html><body>hi</body></html>"), "a.xml").problems[0]!.message, /not a QTI file/);
  assert.match(readQti(enc(""), "a.xml").problems[0]!.message, /not well-formed|not a QTI/);
  assert.match(readQti(new Uint8Array([0x50, 0x4b, 3, 4, 1, 2, 3]), "a.zip").problems[0]!.message, /zip/);
  assert.match(readQti(zipSync({ "readme.txt": enc("hello") }), "a.zip").problems[0]!.message, /No QTI questions were found/);
});

test("a file with a document type that defines entities reads no entity: nothing outside the file can come in", () => {
  const evil = `<?xml version="1.0"?><!DOCTYPE x [<!ENTITY secret SYSTEM "file:///C:/Windows/win.ini"><!ENTITY big "AAAA">]><questestinterop><assessment><section><item ident="q" title="t"><presentation>${stem("<p>Say &secret; and &big;</p>")}${lid("r", [["a", "x"], ["b", "y"]])}</presentation><resprocessing>${outcomes}${award('<varequal respident="r">a</varequal>')}</resprocessing></item></section></assessment></questestinterop>`;
  const read = readQti(enc(evil), "e.xml");
  assert.equal(read.questions.length, 1);
  assert.doesNotMatch(read.questions[0]!.question, /\[extensions\]|fonts|AAAA/i);
});

test("the reader refuses what could freeze the editor: mismatched tags, too deep, too many elements", () => {
  assert.throws(() => readXml("<a><b></a>"), /does not match|not closed/);
  assert.throws(() => readXml("<a>" + "<b>".repeat(200) + "x" + "</b>".repeat(200) + "</a>"), /nested too deeply/);
  assert.throws(() => readXml("<a>" + "<b/>".repeat(400_001) + "</a>"), /too many elements/);
  assert.throws(() => readXml("<a/><b/>"), /more than one root/);
  assert.equal(readXml('<a:x xmlns:a="u" a:y-z="1"><![CDATA[1 < 2]]></a:x>').kids[0], "1 < 2");
});

test("more than 200 questions in a file are refused with the reason", () => {
  const item = `<item ident="q" title="t"><presentation>${stem("<p>Q?</p>")}${lid("r", [["a", "x"], ["b", "y"]])}</presentation><resprocessing>${outcomes}${award('<varequal respident="r">a</varequal>')}</resprocessing></item>`;
  const items = Array.from({ length: 201 }, (_, i) => item.replace("<p>Q?</p>", `&lt;p&gt;Q${i}?&lt;/p&gt;`.replace(/&lt;/g, "<").replace(/&gt;/g, ">"))).join("");
  const read = readQti(enc(`<questestinterop><assessment><section>${items}</section></assessment></questestinterop>`), "big.xml");
  assert.equal(read.questions.length, 0);
  assert.match(read.problems.at(-1)!.message, /at most 200/);
});

// ---- from the file to slides the real checker accepts

test("what a QTI file gives becomes slides the real checker accepts", () => {
  const files = newProjectFiles({ title: "T", author: "", language: "en-US", today: "2026-11-16" });
  const m = new Model({ dir: "D:/x", project: files[0]!.text, theme: files[1]!.text, slides: [{ id: "slide-001", text: files[2]!.text }] });
  m.selectSlide(m.slides[0]!.id);
  const read = readQti(enc(QTI12), "week3.xml");
  assert.ok(m.addQuestionSlides(read.questions, { bank: null, shuffleAnswers: false }));
  assert.equal(m.slides.length, 1 + read.questions.length);

  const dir = mkdtempSync(path.join(os.tmpdir(), "osqti-"));
  try {
    mkdirSync(path.join(dir, "slides"));
    for (const f of m.allFiles()) writeFileSync(path.join(dir, f.path), f.text);
    const run = spawnSync(process.env["OPENSTAGE_PYTHON"] ?? "python", [path.join(repo, "tools", "validate.py"), dir, "--json"], { encoding: "utf8" });
    const found = JSON.parse(run.stdout) as { severity: string; rule: string; message: string }[];
    assert.deepEqual(found.filter((f) => f.severity === "error"), []);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
