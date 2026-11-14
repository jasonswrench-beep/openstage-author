# MCP: letting an AI assistant use OpenStage Author

MCP (the Model Context Protocol) is the way an AI assistant uses a program's tools. With it on, an assistant can build an
accessible course **while nobody is at the keyboard**: it makes a project, adds slides, text, pictures and questions, writes narration, checks
the course for problems, and publishes it as packages for an LMS. It changes courses with the editor's own code, so every change means exactly
what it means in the editor, with the same checks. The design follows the choices made for OpenExplainer's MCP server (2026-10-21): it runs with
no window, it is off until turned on, it can use one folder only, and everything it does is logged.

## Turning it on

MCP is **off** until you turn it on. In the editor choose **MCP access...** (in the **Tools** menu; no project needs to be open):

- Tick **Let an AI assistant use OpenStage Author** and choose **the folder it may use**, then press **Save**. An assistant can open, make, change
  and publish courses only inside this folder, and nowhere else on the computer. The settings are kept with the program's other settings
  (`settings.json` in the program's config folder), never in a project.
- The dialog gives the lines that connect an assistant, each with a **Copy** button: a block for Claude Desktop's `claude_desktop_config.json`, and
  a command for Claude Code. They name the program's own Node, the server and the settings file. If a narration voice is installed they also pass
  on what it needs, so the assistant can make audio.
- Turning access off stops an assistant that is already connected at its next request. Settings are read each time an assistant connects and
  before every call.

If access is off, a new connection is refused at the start with words that say how to turn it on.

## How it runs

The server is a small Node program with no window (`mcp/server.ts`; for the installed program it is the single file `mcp/openstage-mcp.mjs`, run
with the Node that comes with it). The assistant starts it and talks to it on standard input and output, one JSON line at a time: `initialize`,
`ping`, `tools/list` and `tools/call` (`mcp/src/protocol.ts`). Nothing but protocol is ever written to the output. Tool calls run one at a time. When
the assistant closes the line, the program ends.

Behind each tool is the editor's own `Model` (`editor/src/model.ts`), the code the editor's panels use, so an assistant cannot make a slide the
editor could not. The program's other tools (the problem check, the publisher, the narration tool, the translation tool and the review document) are
run as separate programs, exactly as the editor's buttons run them.

Do not edit the same project in the editor's window while an assistant is working on it. The two do not see each other's changes.

## The tools

Every change is saved as it is made, so there is no save step; `undo` takes back the last change. Every tool checks everything first, so a call
that cannot be done says why in plain words and changes nothing. Slides are named by number (counting from 1, as a number or as text), id or name.

| Group | Tools |
| --- | --- |
| Projects | `list_projects`, `create_project` (a new project with a title slide), `open_project` |
| Reading | `get_course` (title, language, slides, variables), `get_slide` (every object with its id, words, place, alt text, timing and narration), `list_layouts`, `list_voices`, `get_narration` (every narration, its voice, and whether its audio is made) |
| Slides | `add_slide` (from a layout), `rename_slide`, `move_slide`, `duplicate_slide`, `delete_slide` (needs `confirm: true`), `set_slide` (moving on by itself, hiding Back and Next, background) |
| Objects | `add_object` (text, button, shape, table, scrolling text, results, certificate; on a layer if asked), `set_text` (with paragraph or heading level), `set_list`, `set_object` (name, alt text, decorative, place and size), `delete_object` (needs `confirm: true`), `add_picture` (copies a picture from the folder into the project), `set_table_cell` |
| Interactions | `add_interaction` (click and reveal, accordion, flip cards, tabs, steps, carousel, glossary, timeline, process circle, pyramids, circle matrix, labeled graphic: give each item its title and words), `set_item`, `add_item`, `delete_item` (needs `confirm: true`), `set_interaction` (orientation, several open, guided, name), `narrate_items` |
| Scenarios and cast | `add_scenario` (a whole branching scenario from a description: situations, lines, choices that lead to other situations, what choices change, meters), `get_cast`, `add_character`, `set_character`, `delete_character` (needs `confirm: true`) |
| Variables, layers and rules | `add_variable`, `set_variable`, `delete_variable` (needs `confirm: true`), `add_layer`, `rename_layer`, `delete_layer` (needs `confirm: true`), `get_rules`, `add_rule` (when an object is pressed, a slide starts and so on: go to a slide, show or hide a layer, set or add to a variable, play media, change a look, only if variables have values), `delete_rule` |
| Theme | `list_themes`, `set_theme` |
| Narration | `set_narration` (the words, voice, language and speed), `make_audio` (with the installed narration voice) |
| Timing | `set_timing` (appear after a delay, with its narration, or at a press of Show next item; how long it stays), `set_animation` (the effect as it arrives or leaves) |
| Questions | `add_questions` (multiple choice, multiple response, true or false, short answer, essay, choose a word and keyboard shortcut, a slide for each, with feedback and points; a passage or a shortcut is refused in the editor's own words, by question number) |
| Undo | `undo`, `redo` |
| Check and make | `check_course` (the problem check), `publish_course` (SCORM 1.2, SCORM 2004, xAPI, web files, the Word copy, and an MP4 with captions if asked), `export_review_document`, `export_translation`, `import_translation` |

Everything made goes inside the folder: published courses in `Published courses`, translation files in `Translations`, and a translated course as
a new project beside the others.

Choices the tools make for you, which you can reverse in the editor afterwards:

- A scenario's lines are **spoken** unless `spoken: false`, in their person's voice if they have one, so a learner who cannot read the screen can
  follow. Interaction items are **not** given narration unless `narrate: true` (or `narrate_items`), because the words of a tab are often read in
  place; the answer says which.
- A text's alt text follows its first words, as the layouts do, unless one was written.
- A rule on a button is always both a mouse click and a key press, as the editor writes it. A rule that comes out different from what was asked
  (a value of the wrong kind, a condition that does not suit the variable) is taken back whole, and the reason is said.
- A scenario with a situation no choice can reach is refused, because the checker would name it as a dead page.

## Safety, because nobody is watching

- **Off until turned on**, and one folder. Every name an assistant gives is resolved first, and one that leaves the folder is refused, by `..`,
  by a full path, by another drive or a network share, by a name Windows treats specially (`CON`, `name.txt:stream`), or by a link inside the
  folder that points out of it (`mcp/src/files.ts`, with tests for each). Project names are plain words only.
- **A log** of every call: `OpenStage MCP log.txt` in the folder, with when, which tool, done or refused, and the first line of the reply. What
  was written on a slide is not in it. A log that cannot be written never stops a tool.
- **Deleting asks twice**: `delete_slide` and `delete_object` do nothing without `confirm: true`, and `undo` takes the last one back.
- **Accessibility stays required.** A picture added without alt text is said to need it, `check_course` reports every missing description and
  other problem as the editor's Problems list does, and a course with errors is not published.
- **No keys.** The server never reads the stock-library or AI service keys in the settings file, and has no tool that uses a service on the
  internet. (Publishing can make audio with the installed voice, which runs on this computer.)
- **Not built on purpose:** it does not record the screen, open the editor's window, or change the editor's settings.

## Trying it

Double-click **`TEST MCP SERVER.bat`**. It starts the real server and talks to it as an assistant does (`mcp/test/`): refused while access is
off; a course built in a scratch folder; the check, the publisher, the Word copy and a translation round trip as real files; every attempt to
reach outside the folder refused; the log; nothing but protocol on the output; the program ending when the line closes; and the single bundled
file the installer ships. The server was also tried with the official MCP client library (`@modelcontextprotocol/sdk`), which accepted all the
tools' descriptions and used the tools.

## What it does not do yet

- It cannot yet change **a theme's own colours and fonts** (it chooses among the built-in themes), give an **interaction's item a picture**, edit a
  scenario part by part afterwards (it builds one whole, and an assistant can delete it and make it again), set **looks** (a button's hover and
  pressed states), **groups**, **locks**, an input's **survey** questions, **question banks**, or **audio descriptions** of a video. They are in the
  editor. Slides, text, pictures, tables, interactions, scenarios, the cast, variables, layers, rules, questions, narration and timing are covered.
- It cannot **see** a slide, only read its facts. A way to look at a slide as a picture would need the video maker's browser step; it is not built.
- It works on **one project at a time** per connection, and it needs the narration voice installed, and Node, for `make_audio`.
- It has not been connected to Claude Desktop or Claude Code by a person (`TESTING-TODO.md`).
