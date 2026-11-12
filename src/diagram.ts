/**
 * Text → diagram.
 *
 * A tiny line-based language that covers architecture diagrams, data-flow
 * pipelines and knowledge-graph triples with one syntax:
 *
 *   ## Ingestion pipeline          start a new frame (= one presentation slide)
 *   direction: down                layout direction for this frame (right | down)
 *   Postgres: db icon:postgresql   declare a node's kind, color and/or icon
 *   Raw text -> Chunker -> LLM     chain of edges
 *   LLM -> Postgres: store triples edge with a label
 *   API <-> Cache                  bidirectional edge
 *   Worker ..> Metrics: async      dashed edge
 *   ---                            next reveal step: what follows appears on the next click
 *   # comment
 */
import ELK, { type ElkNode } from 'elkjs/lib/elk.bundled.js'
import { CaptureUpdateAction, convertToExcalidrawElements, ROUNDNESS } from '@excalidraw/excalidraw'
import type { ExcalidrawElementSkeleton } from '@excalidraw/excalidraw/data/transform'
import type { ExcalidrawElement } from '@excalidraw/excalidraw/element/types'
import { ensureIconFile, findIcon, INK } from './icons'
import { getApi, newId } from './state'

type Shape = 'rectangle' | 'ellipse' | 'diamond'

interface Look {
  shape: Shape
  stroke: string
  bg: string
  dashed?: boolean
  rounded?: boolean
}

interface NodeDef {
  label: string
  look: Look
  icon?: string
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

/** Washi palette: sumi ink, shu red, ai indigo, matcha, kogane gold, fuji violet. */
export const INKS = {
  ink: { stroke: INK, bg: '#FBF5EA' },
  grey: { stroke: '#6F6354', bg: '#EDE5D6' },
  red: { stroke: '#C2361F', bg: '#F7DDD3' },
  orange: { stroke: '#C7672A', bg: '#F8E2CC' },
  yellow: { stroke: '#A87B2C', bg: '#F4E6C2' },
  green: { stroke: '#4E7A4C', bg: '#DDE8D3' },
  blue: { stroke: '#2E5A86', bg: '#D9E5F0' },
  indigo: { stroke: '#22314F', bg: '#D8DEEA' },
  violet: { stroke: '#6E4E8C', bg: '#E7DDF0' },
} as const
type InkName = keyof typeof INKS

const COLOR_ALIASES: Record<string, InkName> = {
  black: 'ink', ink: 'ink', grey: 'grey', gray: 'grey', red: 'red', shu: 'red', orange: 'orange',
  yellow: 'yellow', gold: 'yellow', green: 'green', matcha: 'green', blue: 'blue', 'light-blue': 'blue',
  indigo: 'indigo', violet: 'violet', purple: 'violet', 'light-violet': 'violet',
}

const look = (shape: Shape, ink: InkName, extra: Partial<Look> = {}): Look => ({ shape, ...INKS[ink], ...extra })

/** Node kinds: a keyword maps to a shape and default colors. */
const KINDS: Record<string, Look> = {
  service: look('rectangle', 'ink', { rounded: true }),
  box: look('rectangle', 'ink', { rounded: true }),
  db: look('ellipse', 'green'),
  database: look('ellipse', 'green'),
  store: look('ellipse', 'green'),
  queue: look('diamond', 'yellow'),
  topic: look('diamond', 'yellow'),
  llm: look('rectangle', 'violet', { rounded: true }),
  model: look('rectangle', 'violet', { rounded: true }),
  user: look('ellipse', 'indigo'),
  client: look('ellipse', 'indigo'),
  external: look('rectangle', 'grey', { dashed: true, bg: 'transparent', rounded: true }),
  cloud: look('rectangle', 'grey', { dashed: true, bg: 'transparent', rounded: true }),
  decision: look('diamond', 'red'),
  data: look('rectangle', 'blue'),
  doc: look('rectangle', 'blue'),
  entity: look('ellipse', 'red'),
}

const ARROW = /\s*(<->|\.\.>|->)\s*/

function newSection(title: string): Section {
  return { title, step: 0, direction: 'RIGHT', nodes: new Map(), edges: [] }
}

function ensureNode(section: Section, name: string): NodeDef {
  let node = section.nodes.get(name)
  if (!node) {
    node = { label: name, look: { ...KINDS.service }, declStep: section.step }
    section.nodes.set(name, node)
  }
  return node
}

function applyStyle(node: NodeDef, words: string[]): boolean {
  let matched = false
  let color: InkName | null = null
  for (const w of words) {
    const word = w.toLowerCase()
    const icon = word.match(/^icon[:=](.+)$/)
    if (icon) {
      node.icon = icon[1]
      matched = true
    } else if (KINDS[word]) {
      node.look = { ...KINDS[word] }
      matched = true
    } else if (COLOR_ALIASES[word]) {
      color = COLOR_ALIASES[word]
      matched = true
    }
  }
  if (color) node.look = { ...node.look, ...INKS[color], bg: node.look.bg === 'transparent' ? 'transparent' : INKS[color].bg }
  return matched
}

export function parseDiagram(source: string): Section[] {
  const sections: Section[] = []
  let current: Section | null = null
  const section = () => (current ??= (sections.push(newSection('Diagram')), sections[sections.length - 1]))

  for (const raw of source.split('\n')) {
    const line = raw.trim()
    if (!line || (line.startsWith('#') && !line.startsWith('##'))) continue

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
const FRAME_PAD = 80
const FRAME_GAP = 200
const ICON = 40

function nodeSize(def: NodeDef) {
  const longest = Math.max(...def.label.split('\n').map((l) => l.length))
  const w = Math.max(180, longest * 14 + 80)
  const h = def.icon ? 124 : 84
  // Diamonds and ellipses need extra room for the same text.
  if (def.look.shape === 'diamond') return { w: w * 1.35, h: h * 1.35 }
  if (def.look.shape === 'ellipse') return { w: w * 1.15, h: h * 1.1 }
  return { w, h }
}

/** Parse `source`, lay it out with ELK and add it to the canvas as frames. */
export async function insertDiagram(source: string): Promise<number> {
  const api = getApi()
  const sections = parseDiagram(source)
  if (sections.length === 0) return 0

  const existing = api.getSceneElements()
  let cursorX = 100
  let originY = 100
  if (existing.length) {
    cursorX = Math.max(...existing.map((e) => e.x + e.width)) + FRAME_GAP
    originY = Math.min(...existing.map((e) => e.y))
  }

  // Text is measured when elements are created: make sure the hand-drawn font is ready,
  // or labels get sized with a fallback font and end up clipped.
  try {
    await Promise.all([document.fonts.load('18px Excalifont'), document.fonts.load('15px Excalifont')])
  } catch {
    /* measure with whatever is available */
  }

  const skeletons: ExcalidrawElementSkeleton[] = []
  const steps = new Map<string, number>()
  const frameIds: string[] = []
  const missingIcons = new Set<string>()

  for (const sec of sections) {
    const names = [...sec.nodes.keys()]
    const longestLabel = Math.max(0, ...sec.edges.map((e) => e.label.length))
    const graph: ElkNode = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': sec.direction,
        'elk.spacing.nodeNode': '70',
        'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.max(120, longestLabel * 10 + 90)),
        'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
        // Wrap long chains into rows so each frame still fits a 16:10 screen.
        ...(sec.direction === 'RIGHT' && sec.nodes.size > 5
          ? {
              'elk.layered.wrapping.strategy': 'MULTI_EDGE',
              'elk.aspectRatio': '1.6',
              'elk.layered.wrapping.additionalEdgeSpacing': '40',
            }
          : {}),
      },
      children: names.map((name, i) => {
        const { w, h } = nodeSize(sec.nodes.get(name)!)
        return { id: `n${i}`, width: w, height: h }
      }),
      edges: sec.edges.map((e, i) => ({
        id: `e${i}`,
        sources: [`n${names.indexOf(e.from)}`],
        targets: [`n${names.indexOf(e.to)}`],
      })),
    }
    const layout = await elk.layout(graph)

    const frameId = newId('frame')
    const children: string[] = []
    const ids = new Map<string, string>()
    const centers = new Map<string, { x: number; y: number }>()
    const boxes = new Map<string, Box>()

    for (const [i, child] of (layout.children ?? []).entries()) {
      const name = names[i]
      const def = sec.nodes.get(name)!
      const id = newId('node')
      const x = cursorX + (child.x ?? 0) + FRAME_PAD
      const y = originY + (child.y ?? 0) + FRAME_PAD
      const w = child.width ?? 0
      const h = child.height ?? 0
      ids.set(name, id)
      centers.set(name, { x: x + w / 2, y: y + h / 2 })
      boxes.set(name, { cx: x + w / 2, cy: y + h / 2, hw: w / 2, hh: h / 2, shape: def.look.shape })
      steps.set(id, def.step ?? def.declStep)
      children.push(id)
      skeletons.push({
        type: def.look.shape,
        id,
        x,
        y,
        width: w,
        height: h,
        strokeColor: def.look.stroke,
        backgroundColor: def.look.bg,
        fillStyle: 'solid',
        strokeWidth: 2,
        strokeStyle: def.look.dashed ? 'dashed' : 'solid',
        roundness: def.look.rounded ? { type: ROUNDNESS.ADAPTIVE_RADIUS } : null,
        customData: { explainName: name },
        label: {
          text: def.label,
          fontSize: 18,
          strokeColor: INK,
          verticalAlign: def.icon ? 'bottom' : 'middle',
        },
      })

      if (def.icon) {
        const icon = await findIcon(def.icon)
        if (!icon) {
          missingIcons.add(def.icon)
          continue
        }
        const iconId = newId('icon')
        children.push(iconId)
        steps.set(iconId, def.step ?? def.declStep)
        skeletons.push({
          type: 'image',
          id: iconId,
          x: x + w / 2 - ICON / 2,
          y: y + (def.look.shape === 'rectangle' ? 16 : h * 0.2),
          width: ICON,
          height: ICON,
          fileId: ensureIconFile(icon, 'brand'),
        })
      }
    }

    for (const edge of sec.edges) {
      const a = centers.get(edge.from)!
      const b = centers.get(edge.to)!
      const id = newId('arrow')
      // Bend edges whose straight line would pass through another node.
      const blocked = [...centers.entries()].some(
        ([name, c]) => name !== edge.from && name !== edge.to && distToSegment(c, a, b) < 60,
      )
      // Optional bend point, then clip both ends to the node outlines.
      const len = Math.hypot(b.x - a.x, b.y - a.y) || 1
      const bend = 90
      const mid = blocked
        ? { x: (a.x + b.x) / 2 - ((b.y - a.y) / len) * bend, y: (a.y + b.y) / 2 + ((b.x - a.x) / len) * bend }
        : null
      const start = edgePoint(boxes.get(edge.from)!, mid ?? b)
      const end = edgePoint(boxes.get(edge.to)!, mid ?? a)
      const points: [number, number][] = [[0, 0]]
      if (mid) points.push([mid.x - start.x, mid.y - start.y])
      points.push([end.x - start.x, end.y - start.y])
      steps.set(id, edge.step)
      children.push(id)
      skeletons.push({
        type: 'arrow',
        id,
        x: start.x,
        y: start.y,
        points,
        strokeColor: INK,
        strokeWidth: 2,
        strokeStyle: edge.dashed ? 'dashed' : 'solid',
        roundness: blocked ? { type: ROUNDNESS.PROPORTIONAL_RADIUS } : null,
        startArrowhead: edge.bidirectional ? 'arrow' : null,
        endArrowhead: 'arrow',
        start: { id: ids.get(edge.from)! },
        end: { id: ids.get(edge.to)! },
        ...(edge.label ? { label: { text: edge.label, fontSize: 15, strokeColor: '#5A4A3A' } } : {}),
      } as ExcalidrawElementSkeleton)
    }

    const frameW = (layout.width ?? 0) + FRAME_PAD * 2
    const frameH = (layout.height ?? 0) + FRAME_PAD * 2
    skeletons.push({
      type: 'frame',
      id: frameId,
      x: cursorX,
      y: originY,
      width: frameW,
      height: frameH,
      name: sec.title,
      children,
    })
    frameIds.push(frameId)
    cursorX += frameW + FRAME_GAP
  }

  const created = convertToExcalidrawElements(skeletons, { regenerateIds: false }).map((el) => {
    const step = steps.get(el.id)
    return step ? { ...el, customData: { ...el.customData, step } } : el
  }) as ExcalidrawElement[]

  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: { selectedElementIds: Object.fromEntries(frameIds.map((id) => [id, true as const])) },
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  })
  // Let the scene settle for a frame, then bring the first new frame into view.
  requestAnimationFrame(() => {
    const first = api.getSceneElements().find((e) => e.id === frameIds[0])
    if (first) api.scrollToContent(first, { fitToViewport: true, viewportZoomFactor: 0.85, animate: true })
  })

  if (missingIcons.size) throw new MissingIconsError([...missingIcons])
  return sections.length
}

export class MissingIconsError extends Error {
  constructor(public icons: string[]) {
    super(`Diagram added, but these icons weren't found: ${icons.join(', ')}. Search the icon gallery for the exact name.`)
  }
}

type Pt = { x: number; y: number }
interface Box {
  cx: number
  cy: number
  hw: number
  hh: number
  shape: Shape
}

/** Where the ray from the box center toward `toward` leaves the shape (plus a small gap). */
function edgePoint(box: Box, toward: Pt, gap = 8): Pt {
  const dx = toward.x - box.cx
  const dy = toward.y - box.cy
  const len = Math.hypot(dx, dy) || 1
  let t: number
  if (box.shape === 'ellipse') t = 1 / Math.sqrt((dx / box.hw) ** 2 + (dy / box.hh) ** 2)
  else if (box.shape === 'diamond') t = 1 / (Math.abs(dx) / box.hw + Math.abs(dy) / box.hh)
  else t = Math.min(box.hw / Math.abs(dx || 1e-9), box.hh / Math.abs(dy || 1e-9))
  return { x: box.cx + dx * t + (dx / len) * gap, y: box.cy + dy * t + (dy / len) * gap }
}
function distToSegment(p: Pt, a: Pt, b: Pt) {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy || 1
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}
