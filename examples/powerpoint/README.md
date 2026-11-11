# PowerPoint example

Two small presentations to try **PowerPoint slides...** in the editor's **File** menu, made from nothing (no Office, no one's work), so they need no credit.

| File | What it is |
| --- | --- |
| `Introduction to Communication.pptx` | Five slides: a title slide with a picture behind it, a list with two levels, a picture with alt text and a link, a table, and a filled shape with a group. |
| `Introduction to Communication (edited).pptx` | The same presentation after someone edited it: a bullet added, the picture changed, a table cell changed, the words in the shape changed, and a sixth slide, "Questions?". |

**To try it.** Open `examples\minimal.osproj` (or make a new project), choose **PowerPoint**, and bring in the first file. Then add something of your own to a slide (describe the picture in your own words, add a rule). Choose **PowerPoint** again, choose the edited file, and look at what it offers: your own words stay, and the presentation's changes come forward.

`make-example-decks.ts` makes both files again: `node examples/powerpoint/make-example-decks.ts examples/powerpoint`.
