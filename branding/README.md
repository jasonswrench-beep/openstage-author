# The OpenStage icon

`OpenStage.svg` is the official icon of the project (the "Open Frame" icon, supplied by Jason S. Wrench on 2026-10-22): an open stage arch, drawn curtains and a curved platform in lilac, on a navy rounded tile that is transparent outside its corners. It is plain editable vector artwork with no text, fonts or pictures in it.

| | |
| --- | --- |
| Navy tile | `#102037` to `#0B172A`, corner radius 164 of 1024 |
| Lilac symbol | `#B18FFC` to `#A17CEF` |

`OpenStage-1024.png` is the same drawing as a 1024 by 1024 picture with a transparent background.

The program's own icon files (`editor/src-tauri/icons`: the `.ico` of the program and the installer, the `.icns`, and the square pictures) are made from it. To change the icon, replace `OpenStage.svg` here and run:

```
node tools/svg_to_png.mjs branding/OpenStage.svg branding/OpenStage-1024.png 1024
cd editor
npx tauri icon ../branding/OpenStage-1024.png -o <a new folder>
```

then copy from that folder the files that `editor/src-tauri/icons` already has (leave out its `android` and `ios` folders). `tools/svg_to_png.mjs` draws the SVG in headless Microsoft Edge, so it needs Edge and Node.
