# Letter Playground (First Coding Test)

This is my first test in coding. A tiny p5.js tool to load a font, pick a single letter, and play with it: drag Bézier handles, apply width, height, slant, roundness, add randomness, and export. 
Still need to work on details

**Live site:** [https://sixtyjones.github.io/letter-playground 
**Repository:** https://github.com/sixtyjones/letter-playground

---

## Features
- Interactive anchor and handle editing
- Width, height, slant, roundness, and weight controls
- Seeded “Surprise Me” randomization
- Undo, redo, reset, fit to view
- Live preview around ~50 px, black fill
- Correct counters via even-odd fill
- Export SVG and PNG
- Upload custom TTF or OTF

## Quick Start
- Open the live site
  
## How To Use
- Optional, upload a `.ttf` or `.otf` font
- Type one character in the “Letter” field
- Drag anchors and control points in the left editor
- Adjust sliders to transform the glyph
- Use **Surprise Me** with a seed for repeatable randomness
- Export SVG for vector tools, PNG for quick sharing

## Keyboard Shortcuts
- **Z** undo
- **Y** redo
- **W** toggle wireframe
- **G** snap to grid
- **R** randomize (uses current seed)
- **F** fit to view
- **L** lock handles collinear

## Deploying With GitHub Pages
- Settings, Pages, Source: **Deploy from a branch**
- Branch: **main**, Folder: **/root**
- Wait a minute, your site publishes at  
  `https://YOUR-USERNAME.github.io/LETTER-PLAYGROUND`

## Tech
- p5.js and p5.dom
- opentype.js for font paths
- FileSaver.js for downloads
- Canvas 2D path fill with `fill('evenodd')` for counters

## Notes
- This is my first coding test. Expect rough edges.
- If the default CDN font fails, upload your own font with the file picker.

## License
- MIT. See `LICENSE`.
