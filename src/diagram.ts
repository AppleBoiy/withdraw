/**
 * Text → diagram.
 *
 * A tiny line-based language that covers architecture diagrams, data-flow
 * pipelines and knowledge-graph triples with one syntax:
 *
 *   ## Ingestion pipeline          start a new frame (= one presentation slide)
 *   direction: down                layout direction for this frame (right | down)
 *   Postgres: db                   declare a node's kind and/or color
 *   Raw text -> Chunker -> LLM     chain of edges
 *   LLM -> Postgres: store triples edge with a label
 *   API <-> Cache                  bidirectional edge
 *   Worker ..> Metrics: async      dashed edge
 *   ---                            next reveal step: what follows appears on the next click
 *   # comment
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import {
  createShapeId,
  toRichText,
  type Editor,
  type TLDefaultColorStyle,
  type TLShapeId,
} from 'tldraw'

type Geo = 'rectangle' | 'ellipse' | 'oval' | 'diamond' | 'cloud' | 'hexagon' | 'rhombus' | 'trapezoid'

interface NodeDef {
  label: string
  geo: Geo
  color: TLDefaultColorStyle
  /** Step of the first edge that uses this node (undefined until one does). */
  step?: number
  /** Step at which the node was first mentioned at all. */
  declStep: number
}

interface EdgeDef {
  from: string
  to: string
  label: string
  bidirectional: boolean
  dashed: boolean
  step: number
}

export interface Section {
  title: string
  /** Current reveal step while parsing. */
  step: number
  direction: 'RIGHT' | 'DOWN'
  nodes: Map<string, NodeDef>
  edges: EdgeDef[]
}

/** Node kinds: a keyword maps to a shape and a default color. */
const KINDS: Record<string, { geo: Geo; color: TLDefaultColorStyle }> = {
  service: { geo: 'rectangle', color: 'black' },
  box: { geo: 'rectangle', color: 'black' },
  db: { geo: 'ellipse', color: 'green' },
  database: { geo: 'ellipse', color: 'green' },
  store: { geo: 'ellipse', color: 'green' },
  queue: { geo: 'rhombus', color: 'orange' },
  topic: { geo: 'rhombus', color: 'orange' },
  llm: { geo: 'hexagon', color: 'violet' },
  model: { geo: 'hexagon', color: 'violet' },
  user: { geo: 'oval', color: 'blue' },
  client: { geo: 'oval', color: 'blue' },
  external: { geo: 'cloud', color: 'grey' },
  cloud: { geo: 'cloud', color: 'grey' },
  decision: { geo: 'diamond', color: 'yellow' },
  data: { geo: 'trapezoid', color: 'light-blue' },
  doc: { geo: 'trapezoid', color: 'light-blue' },
  entity: { geo: 'ellipse', color: 'light-violet' },
}

const COLORS = new Set<TLDefaultColorStyle>([
  'black', 'grey', 'light-violet', 'violet', 'blue', 'light-blue', 'yellow',
  'orange', 'green', 'light-green', 'light-red', 'red', 'white',
])

const ARROW = /\s*(<->|\.\.>|->)\s*/

function newSection(title: string): Section {
  return { title, step: 0, direction: 'RIGHT', nodes: new Map(), edges: [] }
}

function ensureNode(section: Section, name: string): NodeDef {
  let node = section.nodes.get(name)
  if (!node) {
    node = { label: name, ...KINDS.service, declStep: section.step }
    section.nodes.set(name, node)
  }
  return node
}

function applyStyle(node: NodeDef, words: string[]): boolean {
  let matched = false
  let colorSet = false
  for (const w of words) {
    const word = w.toLowerCase()
    if (KINDS[word]) {
      node.geo = KINDS[word].geo
      if (!colorSet) node.color = KINDS[word].color
      matched = true
    } else if (COLORS.has(word as TLDefaultColorStyle)) {
      node.color = word as TLDefaultColorStyle
      colorSet = true
      matched = true
    }
  }
  return matched
}

export function parseDiagram(source: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  const section = () => (current ??= (sections.push(newSection('Diagram')), sections[sections.length - 1]))

  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') && !line.startsWith('##')) continue

    const heading = line.match(/^(?:##\s*|frame:\s*)(.+)$/i)
    if (heading) {
      current = newSection(heading[1].trim())
      sections.push(current)
      continue
    }

    if (/^-{3,}$/.test(line)) {
      section().step++
      continue
    }

    const dir = line.match(/^direction:\s*(right|down|lr|td)\s*$/i)
    if (dir) {
      section().direction = /right|lr/i.test(dir[1]) ? 'RIGHT' : 'DOWN'
      continue
    }

    if (ARROW.test(line)) {
      // Label is whatever follows the last ':' of the final segment.
      const parts = line.split(ARROW)
      let label = ''
      const last = parts[parts.length - 1]
      const colon = last.lastIndexOf(':')
      if (colon !== -1) {
        label = last.slice(colon + 1).trim()
        parts[parts.length - 1] = last.slice(0, colon).trim()
      }
      for (let i = 0; i + 2 < parts.length; i += 2) {
        const from = parts[i].trim()
        const op = parts[i + 1]
        const to = parts[i + 2].trim()
        if (!from || !to) continue
        const sec = section()
        for (const n of [ensureNode(sec, from), ensureNode(sec, to)]) n.step ??= sec.step
        sec.edges.push({
          from,
          to,
          label: i + 3 === parts.length ? label : '',
          bidirectional: op === '<->',
          dashed: op === '..>',
          step: sec.step,
        })
      }
      continue
    }

    const decl = line.match(/^(.+?)\s*:\s*(.+)$/)
    if (decl) {
      const node = ensureNode(section(), decl[1].trim())
      if (applyStyle(node, decl[2].split(/[\s,]+/))) continue
      // Not a style: treat "Name: Display label" as a label override.
      node.label = decl[2].trim()
      continue
    }

    ensureNode(section(), line)
  }

  return sections.filter((s) => s.nodes.size > 0)
}

const elk = new ELK()
const FRAME_PAD = 90
const FRAME_GAP = 240

function nodeSize(label: string) {
  const longest = Math.max(...label.split('\n').map((l) => l.length))
  return { w: Math.max(160, longest * 13 + 60), h: 90 }
}

/** Parse `source`, lay it out with ELK and add it to the canvas as frames. */
export async function insertDiagram(editor: Editor, source: string): Promise<number> {
  const sections = parseDiagram(source)
  if (sections.length === 0) return 0

  const pageBounds = editor.getCurrentPageBounds()
  let cursorX = pageBounds ? pageBounds.maxX + FRAME_GAP : 0
  const originY = pageBounds ? pageBounds.minY : 0
  const createdFrames: TLShapeId[] = []

  for (const sec of sections) {
    const names = [...sec.nodes.keys()]
    const longestLabel = Math.max(0, ...sec.edges.map((e) => e.label.length))
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': sec.direction,
        'elk.spacing.nodeNode': '70',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.max(120, longestLabel * 11 + 80)),
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
      },
      children: names.map((name, i) => ({ id: `n${i}`, ...toWH(nodeSize(sec.nodes.get(name)!.label)) })),
      edges: sec.edges.map((e, i) => ({
        id: `e${i}`,
        sources: [`n${names.indexOf(e.from)}`],
        targets: [`n${names.indexOf(e.to)}`],
      })),
    }
    const layout = await elk.layout(graph)

    const frameId = createShapeId()
    const frameW = (layout.width ?? 0) + FRAME_PAD * 2
    const frameH = (layout.height ?? 0) + FRAME_PAD * 2
    editor.createShape({
      id: frameId,
      type: 'frame',
      x: cursorX,
      y: originY,
      props: { w: frameW, h: frameH, name: sec.title },
    })
    createdFrames.push(frameId)

    const ids = new Map<string, TLShapeId>()
    const centers = new Map<string, { x: number; y: number }>()
    layout.children?.forEach((child, i) => {
      const name = names[i]
      const def = sec.nodes.get(name)!
      const id = createShapeId()
      const x = (child.x ?? 0) + FRAME_PAD
      const y = (child.y ?? 0) + FRAME_PAD
      ids.set(name, id)
      centers.set(name, { x: x + (child.width ?? 0) / 2, y: y + (child.height ?? 0) / 2 })
      editor.createShape({
        id,
        type: 'geo',
        parentId: frameId,
        x,
        y,
        meta: { explainName: name, step: def.step ?? def.declStep },
        props: {
          geo: def.geo,
          w: child.width,
          h: child.height,
          color: def.color,
          fill: 'semi',
          richText: toRichText(def.label),
        },
      })
    })

    for (const edge of sec.edges) {
      const a = centers.get(edge.from)!
      const b = centers.get(edge.to)!
      const arrowId = createShapeId()
      // Curve edges whose straight line would pass through another node.
      const blocked = [...centers.entries()].some(
        ([name, c]) => name !== edge.from && name !== edge.to && distToSegment(c, a, b) < 60,
      )
      editor.createShape({
        id: arrowId,
        type: 'arrow',
        parentId: frameId,
        meta: { step: edge.step },
        x: a.x,
        y: a.y,
        props: {
          start: { x: 0, y: 0 },
          end: { x: b.x - a.x, y: b.y - a.y },
          richText: toRichText(edge.label),
          dash: edge.dashed ? 'dashed' : 'draw',
          arrowheadStart: edge.bidirectional ? 'arrow' : 'none',
          arrowheadEnd: 'arrow',
          bend: blocked ? 110 : 0,
        },
      })
      editor.createBindings([
        bind(arrowId, ids.get(edge.from)!, 'start'),
        bind(arrowId, ids.get(edge.to)!, 'end'),
      ])
    }

    cursorX += frameW + FRAME_GAP
  }

  editor.select(...createdFrames)
  editor.zoomToSelection({ animation: { duration: 400 } })
  return sections.length
}

function toWH({ w, h }: { w: number; h: number }) {
  return { width: w, height: h }
}

function bind(fromId: TLShapeId, toId: TLShapeId, terminal: 'start' | 'end') {
  return {
    type: 'arrow' as const,
    fromId,
    toId,
    props: {
      terminal,
      normalizedAnchor: { x: 0.5, y: 0.5 },
      isExact: false,
      isPrecise: false,
      snap: 'none' as const,
    },
  }
}

type Pt = { x: number; y: number }
function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
