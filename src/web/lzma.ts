// SPDX-License-Identifier: GPL-2.0-or-later
// In-browser LZMA and XZ decompression for Vial keyboard definitions

import { lzmaBrowserDecompress } from './lzma-browser'
import * as xzModule from 'xz-decompress'

const XzReadableStream =
  (xzModule as { XzReadableStream?: typeof globalThis.ReadableStream }).XzReadableStream ||
  (xzModule as { default?: { XzReadableStream?: typeof globalThis.ReadableStream } }).default?.XzReadableStream ||
  (xzModule as unknown as { default?: typeof globalThis.ReadableStream }).default

export const MAX_COMPRESSED_SIZE = 1 * 1024 * 1024 // 1 MB
export const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024 // 10 MB

const XZ_MAGIC = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])

export function hasXzMagic(data: Uint8Array): boolean {
  if (data.length < XZ_MAGIC.length) return false
  for (let i = 0; i < XZ_MAGIC.length; i++) {
    if (data[i] !== XZ_MAGIC[i]) return false
  }
  return true
}

export async function decompressXz(data: Uint8Array): Promise<string | null> {
  try {
    if (!XzReadableStream) {
      console.warn('XzReadableStream is unavailable')
      return null
    }
    const input = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(data)
        controller.close()
      },
    })
    const stream = new (XzReadableStream as unknown as new (stream: ReadableStream<Uint8Array>) => ReadableStream<Uint8Array>)(input)
    const reader = stream.getReader()
    const chunks: Uint8Array[] = []
    let totalSize = 0

    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        totalSize += value.byteLength
        if (totalSize > MAX_DECOMPRESSED_SIZE) {
          await reader.cancel()
          console.warn(`XZ output exceeded limit: ${totalSize} bytes`)
          return null
        }
        chunks.push(value)
      }
    }

    const merged = new Uint8Array(totalSize)
    let offset = 0
    for (const chunk of chunks) {
      merged.set(chunk, offset)
      offset += chunk.byteLength
    }

    const decoder = new TextDecoder('utf-8')
    return decoder.decode(merged)
  } catch (err) {
    console.warn('XZ decompress error:', err)
    return null
  }
}

export function decompressLzma(data: number[] | Uint8Array): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      const arr = Array.isArray(data) ? data : Array.from(data)
      lzmaBrowserDecompress.decompress(arr, (result: string | Uint8Array | number[] | null, error?: unknown) => {
        if (error) {
          console.warn('LZMA decompress error:', error)
          resolve(null)
          return
        }
        if (result == null) {
          resolve(null)
          return
        }
        if (typeof result === 'string') {
          resolve(result)
          return
        }
        const bytes = result instanceof Uint8Array ? result : new Uint8Array(result)
        const decoder = new TextDecoder('utf-8')
        resolve(decoder.decode(bytes))
      })
    } catch (err) {
      console.warn('LZMA decompress threw:', err)
      resolve(null)
    }
  })
}

export async function decompressDefinition(data: Uint8Array | number[]): Promise<string | null> {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data)
  if (bytes.length === 0) return null
  if (bytes.length > MAX_COMPRESSED_SIZE) {
    console.warn(`Compressed data size ${bytes.length} exceeds limit`)
    return null
  }
  if (hasXzMagic(bytes)) {
    return decompressXz(bytes)
  }
  return decompressLzma(bytes)
}
