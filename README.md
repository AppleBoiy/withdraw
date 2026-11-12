# Explainboard

A whiteboard for explaining technical work: hand-drawn canvas (tldraw) + text→diagram + slide-style presentation.

```bash
npm install
npm run dev        # http://localhost:5173
```

## Features

- **Infinite canvas** — everything tldraw does (draw, shapes, arrows, frames, images, Apple Pencil on iPad Safari). Boards auto-save in the browser (IndexedDB).
- **Text → diagram** (top-right button) — write a small text description, it is auto-laid-out (ELK) and added as editable shapes. Examples included: knowledge-graph extraction, chatbot architecture, deployment plan.
- **Present** — each top-level frame (press `F` to draw one) is a slide, ordered by rows then left→right. `→`/`Space` next, `←` back, `Esc` exit.

## Diagram syntax

```
## Frame title            new frame = new slide
direction: down           layout direction (right | down)
A -> B -> C               chain of edges
A -> B: label             labelled edge
A <-> B                   two-way edge
A ..> B                   dashed edge (async, optional, …)
Postgres: db              node kind: service, db, queue, llm, user, external, decision, data, entity
Postgres: db red          …plus an optional color
API: Public REST API      anything else after ":" becomes the display label
# comment
```

## License note

tldraw is free in development; deploying publicly needs a tldraw license key
(a free hobby/non-commercial one exists — check tldraw.dev for current terms).
Put it in `.env.local` as `VITE_TLDRAW_LICENSE_KEY=...`.

## Roadmap

- Step-by-step reveal inside a slide
- Animated data-flow dots along arrows
- Cloud/infra icon shape pack (AWS, GCP, K8s)
- Import knowledge-graph triples from CSV/JSON
- Mermaid import, export to PNG/PDF, share links
