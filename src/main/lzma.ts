// SPDX-License-Identifier: GPL-2.0-or-later
// LZMA/XZ decompression with bomb protection — runs in main process

import { spawn } from 'node:child_process'
import * as lzmaModule from 'lzma'
import { IpcChannels } from '../shared/ipc/channels'
import { secureHandle } from './ipc-guard'
import { log } from './logger'

export const MAX_COMPRESSED_SIZE = 1 * 1024 * 1024   // 1 MB
export const MAX_DECOMPRESSED_SIZE = 10 * 1024 * 1024 // 10 MB
export const XZ_TIMEOUT_MS = 10_000                   // 10 seconds

const XZ_MAGIC = new Uint8Array([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00])

function hasXzMagic(buf: Buffer): boolean {
  if (buf.length < XZ_MAGIC.length) return false
  for (let i = 0; i < XZ_MAGIC.length; i++) {
    if (buf[i] !== XZ_MAGIC[i]) return false
  }
  return true
}

export function setupLzmaIpc(): void {
  secureHandle(IpcChannels.LZMA_DECOMPRESS, (_event, data: number[]): Promise<string | null> => {
    if (!data || !Array.isArray(data) || data.length === 0) {
      return Promise.resolve(null)
    }
    if (data.length > MAX_COMPRESSED_SIZE) {
      log('warn', `LZMA input rejected: ${data.length} bytes exceeds limit`)
      return Promise.resolve(null)
    }
    const buf = Buffer.from(data)
    if (hasXzMagic(buf)) {
      return decompressXz(buf)
    }
    return decompressLzma(data)
  })
}

function decompressXz(buf: Buffer): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('xz', ['--decompress', '--stdout'], {
      stdio: ['pipe', 'pipe', 'ignore'],
    })
    const chunks: Buffer[] = []
    let totalSize = 0
    let settled = false

    const settle = (value: string | null): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(value)
    }

    const timer = setTimeout(() => {
      log('warn', `XZ decompress timed out after ${XZ_TIMEOUT_MS}ms`)
      child.kill()
      settle(null)
    }, XZ_TIMEOUT_MS)

    child.stdout.on('data', (chunk: Buffer) => {
      totalSize += chunk.length
      if (totalSize > MAX_DECOMPRESSED_SIZE) {
        log('warn', `XZ output exceeded limit: ${totalSize} bytes`)
        child.kill()
        settle(null)
        return
      }
      chunks.push(chunk)
    })

    child.on('close', (code: number | null) => {
      if (totalSize > MAX_DECOMPRESSED_SIZE) {
        settle(null)
        return
      }
      if (code !== 0) {
        log('warn', `XZ decompress exited with code ${code}`)
        settle(null)
        return
      }
      try {
        settle(Buffer.concat(chunks).toString('utf-8'))
      } catch {
        settle(null)
      }
    })

    child.on('error', (err: Error) => {
      log('warn', `XZ decompress error: ${err.message}`)
      settle(null)
    })

    child.stdin.end(buf)
  })
}

function decompressLzma(data: number[]): Promise<string | null> {
  return new Promise((resolve) => {
    try {
      lzmaModule.decompress(data, (result: string | Uint8Array | null, error?: unknown) => {
        if (error) {
          log('warn', `LZMA decompress error: ${error}`)
          resolve(null)
          return
        }
        if (result == null) {
          resolve(null)
          return
        }
        const str = typeof result === 'string' ? result : Buffer.from(result).toString('utf-8')
        if (Buffer.byteLength(str, 'utf-8') > MAX_DECOMPRESSED_SIZE) {
          log('warn', 'LZMA output exceeded limit')
          resolve(null)
          return
        }
        resolve(str)
      })
    } catch {
      resolve(null)
    }
  })
}
