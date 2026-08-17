// SPDX-License-Identifier: GPL-2.0-or-later
// Browser File I/O Implementation (Blob download & file input picker)

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function downloadText(content: string, filename: string, mimeType = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type: mimeType })
  downloadBlob(blob, filename)
}

export function pickFile(accept?: string): Promise<{ name: string; content: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.style.display = 'none'

    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) {
        resolve(null)
        return
      }
      try {
        const content = await file.text()
        resolve({ name: file.name, content })
      } catch (err) {
        console.error('Failed to read file:', err)
        resolve(null)
      } finally {
        document.body.removeChild(input)
      }
    }

    input.oncancel = () => {
      resolve(null)
      document.body.removeChild(input)
    }

    document.body.appendChild(input)
    input.click()
  })
}

export async function saveLayout(json: string, deviceName?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const name = `${(deviceName || 'keyboard').replace(/[^a-zA-Z0-9_-]/g, '_')}_layout.vil`
    downloadText(json, name, 'application/json')
    return { success: true, filePath: name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function loadLayout(_title?: string, extensions?: string[]): Promise<{ success: boolean; data?: string; filePath?: string; error?: string }> {
  try {
    const accept = extensions?.map((ext) => (ext.startsWith('.') ? ext : `.${ext}`)).join(',') || '.vil,.json'
    const result = await pickFile(accept)
    if (!result) return { success: false, error: 'Cancelled' }
    return { success: true, data: result.content, filePath: result.name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function exportKeymapC(content: string, deviceName?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const name = `${(deviceName || 'keymap').replace(/[^a-zA-Z0-9_-]/g, '_')}.c`
    downloadText(content, name, 'text/plain;charset=utf-8')
    return { success: true, filePath: name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function exportPdf(base64Data: string, deviceName?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const byteCharacters = atob(base64Data.replace(/^data:application\/pdf;base64,/, ''))
    const byteNumbers = new Array(byteCharacters.length)
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i)
    }
    const byteArray = new Uint8Array(byteNumbers)
    const blob = new Blob([byteArray], { type: 'application/pdf' })
    const name = `${(deviceName || 'keyboard').replace(/[^a-zA-Z0-9_-]/g, '_')}_summary.pdf`
    downloadBlob(blob, name)
    return { success: true, filePath: name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function exportCsv(content: string, defaultName?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const name = defaultName || 'export.csv'
    downloadText(content, name, 'text/csv;charset=utf-8')
    return { success: true, filePath: name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function exportCsvBundle(
  files: ReadonlyArray<{ name: string; content: string }>,
): Promise<{ success: boolean; dirPath?: string; files?: string[]; error?: string }> {
  try {
    for (const f of files) {
      downloadText(f.content, f.name, 'text/csv;charset=utf-8')
    }
    return { success: true, files: files.map((f) => f.name) }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function exportJson(content: string, defaultName?: string): Promise<{ success: boolean; filePath?: string; error?: string }> {
  try {
    const name = defaultName || 'export.json'
    downloadText(content, name, 'application/json')
    return { success: true, filePath: name }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}

export async function sideloadJson(_title?: string): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const result = await pickFile('.json')
    if (!result) return { success: false, error: 'Cancelled' }
    const parsed = JSON.parse(result.content)
    return { success: true, data: parsed }
  } catch (err) {
    return { success: false, error: String(err) }
  }
}
