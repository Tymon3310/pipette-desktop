import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'

// --- Mocks ---

const mockHandlers = new Map<string, (...args: unknown[]) => unknown>()

vi.mock('electron', () => ({
  ipcMain: {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      mockHandlers.set(channel, handler)
    }),
  },
}))

vi.mock('../ipc-guard', async () => {
  const { ipcMain } = await import('electron')
  return { secureHandle: ipcMain.handle }
})

vi.mock('../logger', () => ({
  log: vi.fn(),
}))

// Mock child_process.spawn
const mockSpawn = vi.fn()
vi.mock('node:child_process', () => ({
  spawn: (...args: unknown[]) => mockSpawn(...args),
}))

// Mock lzma package
const mockLzmaDecompress = vi.fn()
vi.mock('lzma', () => ({
  decompress: (...args: unknown[]) => mockLzmaDecompress(...args),
}))

import { IpcChannels } from '../../shared/ipc/channels'
import { log } from '../logger'
import {
  setupLzmaIpc,
  MAX_COMPRESSED_SIZE,
  MAX_DECOMPRESSED_SIZE,
  XZ_TIMEOUT_MS,
} from '../lzma'

interface MockChild extends EventEmitter {
  stdin: { end: ReturnType<typeof vi.fn> }
  stdout: EventEmitter
  kill: ReturnType<typeof vi.fn>
}

function createMockChild(): MockChild {
  const child = new EventEmitter() as MockChild
  child.stdin = { end: vi.fn() }
  child.stdout = new EventEmitter()
  child.kill = vi.fn()
  return child
}

// XZ magic bytes prefix
const XZ_MAGIC = [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]

describe('lzma', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockHandlers.clear()
    vi.useFakeTimers()
    setupLzmaIpc()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  function getHandler(): (...args: unknown[]) => Promise<string | null> {
    const handler = mockHandlers.get(IpcChannels.LZMA_DECOMPRESS)
    expect(handler).toBeDefined()
    return handler as (...args: unknown[]) => Promise<string | null>
  }

  describe('input validation', () => {
    it('returns null for empty array', async () => {
      const result = await getHandler()({}, [])
      expect(result).toBeNull()
    })

    it('returns null for null data', async () => {
      const result = await getHandler()({}, null)
      expect(result).toBeNull()
    })

    it('returns null for non-array data', async () => {
      const result = await getHandler()({}, 'not-array')
      expect(result).toBeNull()
    })

    it('returns null for undefined data', async () => {
      const result = await getHandler()({}, undefined)
      expect(result).toBeNull()
    })
  })

  describe('input size limit', () => {
    it('rejects input exceeding MAX_COMPRESSED_SIZE', async () => {
      const oversized = new Array(MAX_COMPRESSED_SIZE + 1).fill(0)
      const result = await getHandler()({}, oversized)
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('exceeds limit'),
      )
    })

    it('accepts input at exactly MAX_COMPRESSED_SIZE', async () => {
      const exactSize = new Array(MAX_COMPRESSED_SIZE).fill(0)
      // Non-XZ, non-LZMA data — will go to LZMA path
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: string | null) => void) => cb('ok'),
      )
      const result = await getHandler()({}, exactSize)
      expect(result).toBe('ok')
    })
  })

  describe('XZ decompression', () => {
    it('decompresses valid XZ data', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      // Simulate xz output
      child.stdout.emit('data', Buffer.from('decompressed result'))
      child.emit('close', 0)

      const result = await promise
      expect(result).toBe('decompressed result')
      expect(mockSpawn).toHaveBeenCalledWith(
        'xz',
        ['--decompress', '--stdout'],
        expect.objectContaining({ stdio: ['pipe', 'pipe', 'ignore'] }),
      )
    })

    it('returns null and settles immediately when XZ output exceeds MAX_DECOMPRESSED_SIZE', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      // Emit a chunk that exceeds the limit — should settle immediately
      const oversizedChunk = Buffer.alloc(MAX_DECOMPRESSED_SIZE + 1)
      child.stdout.emit('data', oversizedChunk)

      // No close event needed — settle happens in data handler
      const result = await promise
      expect(result).toBeNull()
      expect(child.kill).toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('exceeded limit'),
      )
    })

    it('returns null when XZ output exceeds limit across multiple chunks', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      // Emit chunks that collectively exceed the limit
      const halfSize = Math.ceil(MAX_DECOMPRESSED_SIZE / 2)
      child.stdout.emit('data', Buffer.alloc(halfSize))
      child.stdout.emit('data', Buffer.alloc(halfSize + 1))
      child.emit('close', 0)

      const result = await promise
      expect(result).toBeNull()
      expect(child.kill).toHaveBeenCalled()
    })

    it('returns null when XZ times out', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      // Advance time past the timeout
      vi.advanceTimersByTime(XZ_TIMEOUT_MS + 1)

      const result = await promise
      expect(result).toBeNull()
      expect(child.kill).toHaveBeenCalled()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('timed out'),
      )
    })

    it('returns null when XZ process exits with non-zero code', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      child.emit('close', 1)

      const result = await promise
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('exited with code 1'),
      )
    })

    it('returns null when XZ process emits error', async () => {
      const child = createMockChild()
      mockSpawn.mockReturnValue(child)

      const data = [...XZ_MAGIC, 1, 2, 3]
      const promise = getHandler()({}, data)

      child.emit('error', new Error('spawn xz ENOENT'))

      // Process also closes after error
      child.emit('close', null)

      const result = await promise
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('spawn xz ENOENT'),
      )
    })
  })

  describe('LZMA decompression', () => {
    it('decompresses valid LZMA data', async () => {
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: string | null) => void) => cb('lzma result'),
      )

      const data = [0x5d, 0x00, 0x00, 0x01] // Non-XZ magic bytes
      const result = await getHandler()({}, data)
      expect(result).toBe('lzma result')
    })

    it('returns null when LZMA output exceeds MAX_DECOMPRESSED_SIZE', async () => {
      const hugeString = 'x'.repeat(MAX_DECOMPRESSED_SIZE + 1)
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: string | null) => void) => cb(hugeString),
      )

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('LZMA output exceeded limit'),
      )
    })

    it('returns null when LZMA.decompress throws', async () => {
      mockLzmaDecompress.mockImplementation(() => {
        throw new Error('corrupt data')
      })

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBeNull()
    })

    it('returns null when LZMA.decompress returns null', async () => {
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: string | null) => void) => cb(null),
      )

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBeNull()
    })

    it('returns null when LZMA.decompress reports an error via callback', async () => {
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: string | null, error?: unknown) => void) =>
          cb(null, new Error('decompression failed')),
      )

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('decompression failed'),
      )
    })

    it('handles Uint8Array output from LZMA.decompress', async () => {
      const bytes = new TextEncoder().encode('binary result')
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: Uint8Array) => void) => cb(bytes),
      )

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBe('binary result')
    })

    it('rejects oversized Uint8Array output from LZMA.decompress', async () => {
      const oversized = new Uint8Array(MAX_DECOMPRESSED_SIZE + 1)
      mockLzmaDecompress.mockImplementation(
        (_data: unknown, cb: (result: Uint8Array) => void) => cb(oversized),
      )

      const data = [0x5d, 0x00, 0x00, 0x01]
      const result = await getHandler()({}, data)
      expect(result).toBeNull()
      expect(log).toHaveBeenCalledWith(
        'warn',
        expect.stringContaining('LZMA output exceeded limit'),
      )
    })
  })

  describe('constants', () => {
    it('MAX_COMPRESSED_SIZE is 1 MB', () => {
      expect(MAX_COMPRESSED_SIZE).toBe(1 * 1024 * 1024)
    })

    it('MAX_DECOMPRESSED_SIZE is 10 MB', () => {
      expect(MAX_DECOMPRESSED_SIZE).toBe(10 * 1024 * 1024)
    })

    it('XZ_TIMEOUT_MS is 10 seconds', () => {
      expect(XZ_TIMEOUT_MS).toBe(10_000)
    })
  })
})
