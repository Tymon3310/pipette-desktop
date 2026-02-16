// SPDX-License-Identifier: GPL-2.0-or-later
// Generate keymap PDF from current keymap state

import { jsPDF } from 'jspdf'
import type { KleKey } from './kle/types'
import { filterVisibleKeys } from './kle/filter-keys'

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const chunks: string[] = []
  const CHUNK_SIZE = 8192
  for (let i = 0; i < bytes.length; i += CHUNK_SIZE) {
    chunks.push(String.fromCharCode(...bytes.subarray(i, i + CHUNK_SIZE)))
  }
  return btoa(chunks.join(''))
}

export interface PdfExportInput {
  deviceName: string
  layers: number
  keys: KleKey[]
  keymap: Map<string, number>
  encoderLayout: Map<string, number>
  encoderCount: number
  layoutOptions: Map<number, number>
  serializeKeycode: (code: number) => string
  keycodeLabel: (qmkId: string) => string
  isMask: (qmkId: string) => boolean
  findOuterKeycode: (qmkId: string) => { label: string } | undefined
  findInnerKeycode: (qmkId: string) => { label: string } | undefined
}

interface Bounds {
  minX: number
  minY: number
  width: number
  height: number
}

// Page layout dimensions in mm (dynamic height, one layer per page)
const PAGE_WIDTH = 297
const MARGIN = 5
const USABLE_WIDTH = PAGE_WIDTH - MARGIN * 2
const FOOTER_HEIGHT = 6
const LAYER_HEADER_HEIGHT = 7
const BORDER_PAD = 4
const SPACING_RATIO = 0.2
const ROUNDNESS = 0.08

// Font size caps: Math.min(absolute max pt, scale-relative max pt)
const MASKED_LABEL_MAX = 18
const MASKED_LABEL_SCALE = 0.55
const NORMAL_LABEL_MAX = 20
const NORMAL_LABEL_SCALE = 0.65
const ENCODER_DIR_MAX = 14
const ENCODER_DIR_SCALE = 0.45
const ENCODER_LABEL_MAX = 16
const ENCODER_LABEL_SCALE = 0.5

// jsPDF's built-in Helvetica only supports WinAnsiEncoding (Latin-1).
// Strip non-Latin1 characters (outside U+0020..U+00FF) to avoid rendering blanks.
function sanitizeLabel(text: string): string {
  return text.replace(/[^\x20-\xFF]/g, '')
}

// Latin fallback labels for keycodes whose visual labels contain only non-Latin1 chars
const QMK_ALIAS_FALLBACK: Record<string, string> = {
  KC_LANG1: 'HAEN',
  KC_LANG2: 'HANJ',
}

function pdfKeyLabel(rawLabel: string, qmkId: string): string {
  const sanitized = sanitizeLabel(rawLabel)
  if (sanitized.trim()) return sanitized
  if (!rawLabel) return ''
  return QMK_ALIAS_FALLBACK[qmkId] ?? qmkId.replace(/^KC_/, '')
}

function computeBounds(keys: KleKey[]): Bounds {
  if (keys.length === 0) {
    return { minX: 0, minY: 0, width: 0, height: 0 }
  }

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const key of keys) {
    if (key.x < minX) minX = key.x
    if (key.y < minY) minY = key.y
    if (key.x + key.width > maxX) maxX = key.x + key.width
    if (key.y + key.height > maxY) maxY = key.y + key.height
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

function fitText(doc: jsPDF, text: string, maxWidth: number, maxSize: number): number {
  let size = maxSize
  while (size > 4) {
    doc.setFontSize(size)
    if (doc.getTextWidth(text) <= maxWidth) return size
    size -= 0.5
  }
  return 4
}

function formatTimestamp(date: Date): string {
  const pad = (n: number): string => String(n).padStart(2, '0')
  const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
  const t = `${pad(date.getHours())}:${pad(date.getMinutes())}`
  return `${d} ${t}`
}

function drawKey(
  doc: jsPDF,
  key: KleKey,
  layer: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  input: PdfExportInput,
): void {
  const spacing = scale * SPACING_RATIO
  const x = offsetX + key.x * scale
  const y = offsetY + key.y * scale
  const w = key.width * scale - spacing
  const h = key.height * scale - spacing
  const corner = scale * ROUNDNESS

  const code = input.keymap.get(`${layer},${key.row},${key.col}`) ?? 0
  const qmkId = input.serializeKeycode(code)
  const label = input.keycodeLabel(qmkId)
  const masked = input.isMask(qmkId)

  doc.setDrawColor(0)
  doc.setFillColor(255, 255, 255)
  doc.roundedRect(x, y, w, h, corner, corner, 'FD')

  if (masked) {
    // Inner rect for masked keys (modifier + base key)
    const innerPad = scale * 0.05
    const innerX = x + innerPad
    const innerY = y + h * 0.4 + innerPad
    const innerW = Math.max(0, w - innerPad * 2)
    const innerH = Math.max(0, h * 0.6 - innerPad * 2)
    const innerCorner = corner * 0.8

    doc.setFillColor(240, 240, 240)
    doc.roundedRect(innerX, innerY, innerW, innerH, innerCorner, innerCorner, 'FD')

    // Outer label (modifier) in top portion
    const outerLabel = sanitizeLabel(
      input.findOuterKeycode(qmkId)?.label.replace(/\n?\(kc\)$/, '') ?? label,
    )
    const outerSize = fitText(doc, outerLabel, w * 0.9, Math.min(MASKED_LABEL_MAX, scale * MASKED_LABEL_SCALE))
    doc.setFontSize(outerSize)
    doc.setTextColor(0)
    doc.text(outerLabel, x + w / 2, y + h * 0.22, {
      align: 'center',
      baseline: 'middle',
    })

    // Inner label (base key) in inner rect
    const innerLabel = sanitizeLabel(input.findInnerKeycode(qmkId)?.label ?? '')
    if (innerLabel) {
      const innerSize = fitText(doc, innerLabel, innerW * 0.9, Math.min(MASKED_LABEL_MAX, scale * MASKED_LABEL_SCALE))
      doc.setFontSize(innerSize)
      doc.text(innerLabel, x + w / 2, innerY + innerH / 2, {
        align: 'center',
        baseline: 'middle',
      })
    }
  } else {
    // Normal key label (may have \n for multi-line like "!\n1")
    // When sanitization empties all lines (CJK-only labels), fall back to qmkId
    const sanitizedLines = label.split('\n').map(sanitizeLabel)
    const lines = sanitizedLines.some((l) => l.trim())
      ? sanitizedLines
      : [pdfKeyLabel(label, qmkId)]
    doc.setTextColor(0)
    for (let i = 0; i < lines.length; i++) {
      const fontSize = fitText(doc, lines[i], w * 0.9, Math.min(NORMAL_LABEL_MAX, scale * NORMAL_LABEL_SCALE))
      doc.setFontSize(fontSize)
      const lineY = y + (h / (lines.length + 1)) * (i + 1)
      doc.text(lines[i], x + w / 2, lineY, {
        align: 'center',
        baseline: 'middle',
      })
    }
  }
}

function drawEncoder(
  doc: jsPDF,
  key: KleKey,
  layer: number,
  offsetX: number,
  offsetY: number,
  scale: number,
  input: PdfExportInput,
): void {
  const spacing = scale * SPACING_RATIO
  const cx = offsetX + key.x * scale + (key.width * scale - spacing) / 2
  const cy = offsetY + key.y * scale + (key.height * scale - spacing) / 2
  const r = Math.min(key.width, key.height) * scale / 2 - spacing / 2

  doc.setDrawColor(0)
  doc.setFillColor(255, 255, 255)
  doc.circle(cx, cy, r, 'FD')

  // encoderDir: 0=CW, 1=CCW
  const code = input.encoderLayout.get(`${layer},${key.encoderIdx},${key.encoderDir}`) ?? 0
  const qmkId = input.serializeKeycode(code)
  const label = pdfKeyLabel(input.keycodeLabel(qmkId), qmkId)
  const dirLabel = key.encoderDir === 0 ? 'CW' : 'CCW'

  doc.setTextColor(0)

  // Direction label on top
  const dirSize = fitText(doc, dirLabel, r * 1.6, Math.min(ENCODER_DIR_MAX, scale * ENCODER_DIR_SCALE))
  doc.setFontSize(dirSize)
  doc.text(dirLabel, cx, cy - r * 0.3, { align: 'center', baseline: 'middle' })

  // Key label on bottom
  const labelSize = fitText(doc, label, r * 1.6, Math.min(ENCODER_LABEL_MAX, scale * ENCODER_LABEL_SCALE))
  doc.setFontSize(labelSize)
  doc.text(label, cx, cy + r * 0.3, { align: 'center', baseline: 'middle' })
}

export function generateKeymapPdf(input: PdfExportInput): string {
  const visibleKeys = filterVisibleKeys(input.keys, input.layoutOptions)
  const normalKeys = visibleKeys.filter((k) => k.encoderIdx === -1)
  const encoderKeys = visibleKeys.filter((k) => k.encoderIdx !== -1)

  const bounds = computeBounds(visibleKeys)
  if (bounds.width === 0 || bounds.height === 0) {
    const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' })
    return arrayBufferToBase64(doc.output('arraybuffer'))
  }

  // Scale keyboard to fit usable page width, capped so page height stays reasonable
  const MAX_PAGE_HEIGHT = PAGE_WIDTH // cap at square page to avoid jsPDF orientation swap
  const maxContentHeight = MAX_PAGE_HEIGHT - MARGIN * 2 - LAYER_HEADER_HEIGHT - FOOTER_HEIGHT - BORDER_PAD * 2
  const scale = Math.min(
    USABLE_WIDTH / bounds.width,
    maxContentHeight / bounds.height,
  )
  // Visual keyboard dimensions (keys are visually smaller due to inter-key spacing)
  const spacing = scale * SPACING_RATIO
  const visualW = bounds.width * scale - spacing
  const visualH = bounds.height * scale - spacing

  const borderW = visualW + BORDER_PAD * 2
  const borderH = visualH + BORDER_PAD * 2
  const borderX = (PAGE_WIDTH - borderW) / 2
  const borderY = MARGIN + LAYER_HEADER_HEIGHT
  const keysOffsetX = borderX + BORDER_PAD - bounds.minX * scale
  const keysOffsetY = borderY + BORDER_PAD - bounds.minY * scale

  // Dynamic page height: fits exactly one layer with minimal whitespace
  const pageHeight = MARGIN + LAYER_HEADER_HEIGHT + borderH + FOOTER_HEIGHT + MARGIN

  const doc = new jsPDF({
    orientation: 'landscape',
    unit: 'mm',
    format: [PAGE_WIDTH, pageHeight],
  })

  // Footer text (rendered on each page at the end)
  const timestamp = formatTimestamp(new Date())
  const deviceLabel = sanitizeLabel(input.deviceName).trim()
  const footerText = deviceLabel
    ? `${deviceLabel} - Exported ${timestamp} by Pipette`
    : `Exported ${timestamp} by Pipette`

  for (let layer = 0; layer < input.layers; layer++) {
    if (layer > 0) {
      doc.addPage()
    }

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(0)
    doc.text(`Layer ${layer}`, borderX, MARGIN + 5)

    // Outer border around keymap
    doc.setDrawColor(180)
    doc.setLineWidth(0.3)
    doc.roundedRect(borderX, borderY, borderW, borderH, 1.5, 1.5, 'S')

    doc.setFont('helvetica', 'normal')

    for (const key of normalKeys) {
      drawKey(doc, key, layer, keysOffsetX, keysOffsetY, scale, input)
    }

    for (const key of encoderKeys) {
      drawEncoder(doc, key, layer, keysOffsetX, keysOffsetY, scale, input)
    }
  }

  // Footer on each page
  const totalPages = doc.getNumberOfPages()
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7)
    doc.setTextColor(150)
    doc.text(footerText, PAGE_WIDTH / 2, pageHeight - MARGIN, { align: 'center' })
  }

  return arrayBufferToBase64(doc.output('arraybuffer'))
}
