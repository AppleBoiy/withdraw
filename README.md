# Explainboard

A hand-drawn whiteboard for explaining technical work — knowledge-graph pipelines,
system architecture, data flow between services, deployment plans — built on
[Excalidraw](https://github.com/excalidraw/excalidraw) (MIT), styled in washi paper,
sumi ink and shu red.

```bash
npm install
npm run dev        # copies Excalidraw's fonts into public/, then http://localhost:5173
```

## Features

- **Hand-drawn canvas** — everything Excalidraw does: shapes, arrows, frames (`F`), images, Apple Pencil on iPad, export to PNG/SVG/.excalidraw. Boards auto-save in the browser (IndexedDB).
- **Icon gallery** (top-right **◎ icons**) — ~5,000 searchable icons: Lucide system icons (server, database, bot, queue…) and Simple Icons brand logos (Postgres, Kafka, Docker, Kubernetes, Neo4j…). Click to drop one in the middle of the screen, with an optional caption, in brand colors or ink. Recent icons are remembered.
- **Shape libraries** — Excalidraw's Library panel → *Browse libraries* installs community packs (AWS, GCP, Azure, K8s, system-design…). They're kept in the browser too.
- **Text → diagram** — describe a diagram in a few lines; it's auto-laid-out (ELK) as editable shapes inside frames.
- **Present** — each frame is a slide, ordered by rows then left→right. `→`/`Space` next, `←` back, `D` toggle flow, `Esc` exit.
- **Step-by-step reveal** — select elements and use **step − / +**; red badges show the step. Select a frame and press **auto** to reveal its contents in arrow order. While presenting, `→` reveals the next step before moving to the next slide.
- **Animated data flow** — **≋ flow** sends dots along every visible arrow (both ways for two-headed arrows; hollow and slower for dashed/async ones).

## How a board is kept

Boards live in this browser (IndexedDB), local-first, the way Excalidraw and tldraw keep local work:

- **Saved when something changes.** A write is scheduled only when an element's version or the view changes: 300 ms after the last change, and at least every 1.5 s while you keep drawing. A note at the bottom left says when it was last saved.
- **Nothing lost on refresh.** When the page is hidden or closed the board is written at once, with a synchronous copy in localStorage in case that write can't finish; on load the newer copy wins. Nothing is written until the stored board is back on the canvas, so an empty first render can't replace it.
- **Tabs merge, never overwrite.** Each element carries a version; a write keeps, element by element, the newer one (deletions are kept for a week so they win too). Other open tabs pick up a save at once (BroadcastChannel) and when they come back into view.
- **Earlier versions.** A snapshot at most every ten minutes of work, the last twenty kept: menu → *Earlier versions…*. Restoring can be undone.
- Pictures are stored once each, and the browser is asked to keep the storage (`navigator.storage.persist()`). Export (`.excalidraw`) is still the way to move a board to another browser.

## Diagram syntax

```
## Frame title            new frame = new slide
direction: down           layout direction (right | down)
A -> B -> C               chain of edges
A -> B: label             labelled edge
A <-> B                   two-way edge
A ..> B                   dashed edge (async, optional, …)
Postgres: db              node kind: service, db, queue, llm, user, external, decision, data, entity
Postgres: db green        …plus a color: ink grey red orange yellow green blue indigo violet
Postgres: db icon:postgresql   …plus any icon from the gallery (hover an icon to see its name)
API: Public REST API      anything else after ":" becomes the display label
---                       next reveal step: what follows appears on the next click
# comment
```

## Credits & licenses

- [Excalidraw](https://github.com/excalidraw/excalidraw) — MIT
- [Lucide](https://lucide.dev) icons — ISC
- [Simple Icons](https://simpleicons.org) — CC0; the logos themselves remain trademarks of their owners
- [ELK](https://eclipse.dev/elk/) via elkjs — EPL-2.0

## Roadmap

- Paste JSON triples → knowledge graph
- Read-only share link, PDF export of the slides
