// SPDX-License-Identifier: MIT
/* eslint-disable @typescript-eslint/no-namespace, @typescript-eslint/no-explicit-any */
// WebUSB DFU + STM32 DfuSe implementation for Pipette Web
// Ported directly from vial-web (https://github.com/vial-kb/vial-gui) / webdfu

export interface DfuLogCallback {
  (data: { log?: string; progress?: number }): void
}

export namespace dfu {
  // Request codes
  export const DETACH = 0
  export const DNLOAD = 1
  export const UPLOAD = 2
  export const GETSTATUS = 3
  export const CLRSTATUS = 4
  export const GETSTATE = 5
  export const ABORT = 6

  // States
  export const appIDLE = 0
  export const appDETACH = 1
  export const dfuIDLE = 2
  export const dfuDNLOAD_SYNC = 3
  export const dfuDNBUSY = 4
  export const dfuDNLOAD_IDLE = 5
  export const dfuMANIFEST_SYNC = 6
  export const dfuMANIFEST = 7
  export const dfuMANIFEST_WAIT_RESET = 8
  export const dfuUPLOAD_IDLE = 9
  export const dfuERROR = 10
  export const STATUS_OK = 0

  export interface DfuInterfaceSetting {
    configuration: USBConfiguration
    interface: USBInterface
    alternate: USBAlternateInterface
    name: string | null
  }

  export function findDeviceDfuInterfaces(device: USBDevice): DfuInterfaceSetting[] {
    const interfaces: DfuInterfaceSetting[] = []
    for (const conf of device.configurations) {
      for (const iface of conf.interfaces) {
        for (const alt of iface.alternates) {
          if (
            alt.interfaceClass === 0xfe &&
            alt.interfaceSubclass === 0x01 &&
            (alt.interfaceProtocol === 1 || alt.interfaceProtocol === 2)
          ) {
            interfaces.push({
              configuration: conf,
              interface: iface,
              alternate: alt,
              name: alt.alternateName || null,
            })
          }
        }
      }
    }
    return interfaces
  }

  export function parseConfigurationDescriptor(data: Uint8Array): {
    bConfigurationValue: number
    descriptors: Array<{
      bDescriptorType: number
      bmAttributes?: number
      wDetachTimeOut?: number
      wTransferSize?: number
      bcdDFUVersion?: number
    }>
  } {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
    const desc = { bConfigurationValue: view.getUint8(5), descriptors: [] as any[] }
    let offset = view.getUint8(0)
    while (offset < data.byteLength) {
      const len = view.getUint8(offset)
      const type = view.getUint8(offset + 1)
      if (len === 0) break
      const chunk: any = { bDescriptorType: type }
      if (type === 0x21 && len >= 9) {
        chunk.bmAttributes = view.getUint8(offset + 2)
        chunk.wDetachTimeOut = view.getUint16(offset + 3, true)
        chunk.wTransferSize = view.getUint16(offset + 5, true)
        chunk.bcdDFUVersion = view.getUint16(offset + 7, true)
      }
      desc.descriptors.push(chunk)
      offset += len
    }
    return desc
  }

  export class Device {
    public device_: USBDevice
    public settings: DfuInterfaceSetting
    public intfNumber: number
    public logProgress: ((bytesSent: number, total: number) => void) | null = null
    public logMsg: (msg: string) => void = (msg) => console.log('[vial][dfu] ' + msg)

    constructor(device: USBDevice, settings: DfuInterfaceSetting) {
      this.device_ = device
      this.settings = settings
      this.intfNumber = settings.interface.interfaceNumber
    }

    public async open(): Promise<void> {
      await this.device_.open()
      const cfgVal = this.settings.configuration.configurationValue
      if (!this.device_.configuration || this.device_.configuration.configurationValue !== cfgVal) {
        await this.device_.selectConfiguration(cfgVal)
      }
      if (!this.device_.configuration.interfaces[this.intfNumber]?.claimed) {
        await this.device_.claimInterface(this.intfNumber)
      }
      const alt = this.settings.alternate.alternateSetting
      const iface = this.device_.configuration.interfaces[this.intfNumber]
      if (!iface.alternate || iface.alternate.alternateSetting !== alt) {
        await this.device_.selectAlternateInterface(this.intfNumber, alt)
      }
    }

    public async close(): Promise<void> {
      try {
        await this.device_.releaseInterface(this.intfNumber)
      } catch {}
      try {
        await this.device_.close()
      } catch {}
    }

    public async requestOut(request: number, data?: BufferSource, value = 0): Promise<number> {
      const r = await this.device_.controlTransferOut(
        {
          requestType: 'class',
          recipient: 'interface',
          request,
          value,
          index: this.intfNumber,
        },
        data,
      )
      if (r.status === 'ok') return r.bytesWritten || 0
      throw new Error('controlTransferOut failed: ' + r.status)
    }

    public async requestIn(request: number, length: number, value = 0): Promise<DataView> {
      const r = await this.device_.controlTransferIn(
        {
          requestType: 'class',
          recipient: 'interface',
          request,
          value,
          index: this.intfNumber,
        },
        length,
      )
      if (r.status === 'ok' && r.data) return r.data
      throw new Error('controlTransferIn failed: ' + r.status)
    }

    public download(data: BufferSource, blockNum: number): Promise<number> {
      return this.requestOut(DNLOAD, data, blockNum)
    }

    public upload(length: number, blockNum: number): Promise<DataView> {
      return this.requestIn(UPLOAD, length, blockNum)
    }

    public async getStatus(): Promise<{ status: number; pollTimeout: number; state: number }> {
      const data = await this.requestIn(GETSTATUS, 6)
      return {
        status: data.getUint8(0),
        pollTimeout: data.getUint32(1, true) & 0xffffff,
        state: data.getUint8(4),
      }
    }

    public clearStatus(): Promise<number> {
      return this.requestOut(CLRSTATUS)
    }

    public async getState(): Promise<number> {
      const d = await this.requestIn(GETSTATE, 1)
      return d.getUint8(0)
    }

    public abort(): Promise<number> {
      return this.requestOut(ABORT)
    }

    public async poll_until(predicate: (state: number) => boolean, timeoutMs = 30000): Promise<{ status: number; pollTimeout: number; state: number }> {
      const deadline = Date.now() + timeoutMs
      let status: { status: number; pollTimeout: number; state: number } | undefined
      do {
        if (Date.now() > deadline) {
          throw new Error('poll_until timed out after ' + timeoutMs + ' ms')
        }
        for (let retry = 0; retry < 5; retry++) {
          try {
            status = await this.getStatus()
            break
          } catch {}
        }
        if (!status) throw new Error('Device not responding')
        await new Promise((r) => setTimeout(r, status!.pollTimeout || 2))
      } while (!predicate(status.state) && status.state !== dfuERROR)
      return status
    }

    public poll_until_idle(targetState: number): Promise<{ status: number; pollTimeout: number; state: number }> {
      return this.poll_until((s) => s === targetState)
    }

    public async readConfigurationDescriptor(configIdx: number): Promise<Uint8Array> {
      const r1 = await this.device_.controlTransferIn(
        {
          requestType: 'standard',
          recipient: 'device',
          request: 6,
          value: 0x0200 | configIdx,
          index: 0,
        },
        4,
      )
      if (r1.status !== 'ok' || !r1.data) throw new Error('GET_DESCRIPTOR failed')
      const totalLength = r1.data.getUint16(2, true)
      const r2 = await this.device_.controlTransferIn(
        {
          requestType: 'standard',
          recipient: 'device',
          request: 6,
          value: 0x0200 | configIdx,
          index: 0,
        },
        totalLength,
      )
      if (r2.status !== 'ok' || !r2.data) throw new Error('GET_DESCRIPTOR (full) failed')
      return new Uint8Array(r2.data.buffer, r2.data.byteOffset, r2.data.byteLength)
    }

    public async do_download(transferSize: number, firmwareBuffer: ArrayBuffer, manifestationTolerant: boolean): Promise<void> {
      let bytesSent = 0
      const total = firmwareBuffer.byteLength
      let blockNum = 0

      while (bytesSent < total) {
        const chunkSize = Math.min(total - bytesSent, transferSize)
        const chunk = firmwareBuffer.slice(bytesSent, bytesSent + chunkSize)
        const written = await this.download(chunk, blockNum++)
        const status = await this.poll_until_idle(dfuDNLOAD_IDLE)
        if (status.status !== STATUS_OK) {
          throw new Error(`DFU DOWNLOAD failed: state=${status.state} status=${status.status}`)
        }
        bytesSent += written
        if (this.logProgress) this.logProgress(bytesSent, total)
      }

      await this.download(new ArrayBuffer(0), blockNum++)

      if (manifestationTolerant) {
        await this.poll_until((s) => s === dfuIDLE || s === dfuMANIFEST_WAIT_RESET)
      } else {
        try {
          await this.getStatus()
        } catch {}
      }
      try {
        await this.device_.reset()
      } catch {}
    }
  }
}

export namespace dfuse {
  export const GET_COMMANDS = 0x00
  export const SET_ADDRESS = 0x21
  export const ERASE_SECTOR = 0x41

  export interface MemorySegment {
    start: number
    end: number
    sectorSize: number
    readable: boolean
    erasable: boolean
    writable: boolean
  }

  export const STM32F4_SECTORS: MemorySegment[] = (function () {
    const segs: MemorySegment[] = []
    let addr = 0x08000000
    const layout = [
      { count: 4, size: 16 * 1024 },
      { count: 1, size: 64 * 1024 },
      { count: 7, size: 128 * 1024 },
    ]
    for (const g of layout) {
      for (let i = 0; i < g.count; i++) {
        segs.push({
          start: addr,
          end: addr + g.size,
          sectorSize: g.size,
          readable: true,
          erasable: true,
          writable: true,
        })
        addr += g.size
      }
    }
    return segs
  })()

  export function parseMemoryDescriptor(desc: string): { name: string; segments: MemorySegment[] } {
    const nameEnd = desc.indexOf('/')
    const name = desc.substring(1, nameEnd).trim()
    const segStr = desc.substring(nameEnd + 1)
    const segments: MemorySegment[] = []

    const parts = segStr.split(',')
    let addr: number | null = null

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i].trim()
      const addrMatch = part.match(/^(0x[0-9a-fA-F]+)\/(.*)/)
      let segPart = part
      if (addrMatch) {
        addr = parseInt(addrMatch[1], 16)
        segPart = addrMatch[2]
      }
      const segMatch = segPart.match(/^(\d+)\*(\d+)([KMGB]?)([a-g]+)/i)
      if (!segMatch || addr === null) continue

      const count = parseInt(segMatch[1], 10)
      let sectorSize = parseInt(segMatch[2], 10)
      const unit = segMatch[3].toUpperCase()
      const flags = segMatch[4].toLowerCase()

      if (unit === 'K') sectorSize *= 1024
      else if (unit === 'M') sectorSize *= 1024 * 1024

      const readable = flags.includes('a') || flags.includes('g') || flags.includes('e')
      const erasable = flags.includes('g') || flags.includes('e')
      const writable = flags.includes('g')

      for (let s = 0; s < count; s++) {
        segments.push({
          start: addr,
          end: addr + sectorSize,
          sectorSize,
          readable,
          erasable,
          writable,
        })
        addr += sectorSize
      }
    }
    return { name, segments }
  }

  export class Device extends dfu.Device {
    public startAddress = NaN
    public memoryInfo: { name: string; segments: MemorySegment[] }

    constructor(device: USBDevice, settings: dfu.DfuInterfaceSetting) {
      super(device, settings)

      const altName = settings.alternate.alternateName || settings.name || ''
      console.log('[vial][dfu] DfuSe altName:', JSON.stringify(altName))
      if (altName.startsWith('@')) {
        this.memoryInfo = parseMemoryDescriptor(altName)
        console.log(
          '[vial][dfu] DfuSe memoryInfo segments:',
          this.memoryInfo.segments.map(
            (s) =>
              '0x' +
              s.start.toString(16) +
              '-0x' +
              s.end.toString(16) +
              ' sz=' +
              s.sectorSize +
              ' r=' +
              s.readable +
              ' e=' +
              s.erasable +
              ' w=' +
              s.writable,
          ),
        )
      } else {
        this.memoryInfo = { name: 'Internal Flash (fallback)', segments: STM32F4_SECTORS }
        console.warn('[vial][dfu] DfuSe: no memory descriptor in altName — using hardcoded STM32F4 layout')
      }
    }

    public async dfuseCommand(command: number, param?: number, paramLen = 0): Promise<void> {
      const buf = new ArrayBuffer(1 + (paramLen || 0))
      const view = new DataView(buf)
      view.setUint8(0, command)
      if (paramLen === 1 && param !== undefined) view.setUint8(1, param)
      else if (paramLen === 4 && param !== undefined) view.setUint32(1, param, true)
      await this.download(buf, 0)
      const status = await this.poll_until((s) => s !== dfu.dfuDNBUSY, 10000)
      if (status.status !== dfu.STATUS_OK) {
        throw new Error(`DfuSe command 0x${command.toString(16)} failed: status=${status.status}`)
      }
    }

    public getSectorEnd(addr: number): number {
      if (!this.memoryInfo) return addr
      for (const seg of this.memoryInfo.segments) {
        if (addr >= seg.start && addr < seg.end) return seg.end
      }
      return addr
    }

    public async erase(startAddr: number, length: number): Promise<void> {
      let addr = startAddr
      const end = startAddr + length

      if (!this.memoryInfo || this.memoryInfo.segments.length === 0) {
        throw new Error('Erase: no memory info available (this should not happen)')
      }

      while (addr < end) {
        const nextEnd = this.getSectorEnd(addr)
        if (nextEnd <= addr) {
          throw new Error(
            'Erase: getSectorEnd(0x' +
              addr.toString(16) +
              ') = 0x' +
              nextEnd.toString(16) +
              ' (not advancing); memory descriptor may be wrong',
          )
        }
        this.logMsg('Erasing sector at 0x' + addr.toString(16) + ' (size ' + (nextEnd - addr) + ' bytes)...')
        await this.dfuseCommand(ERASE_SECTOR, addr, 4)
        addr = nextEnd
        if (this.logProgress) this.logProgress(addr - startAddr, end - startAddr)
      }
    }

    public override async do_download(
      transferSize: number,
      firmwareBuffer: ArrayBuffer,
      _manifestTolerant = false,
    ): Promise<void> {
      const total = firmwareBuffer.byteLength

      let addr = isNaN(this.startAddress)
        ? this.memoryInfo
          ? this.memoryInfo.segments[0].start
          : 0x08000000
        : this.startAddress

      this.logMsg(`DfuSe: flashing ${total} bytes to 0x${addr.toString(16).toUpperCase()}`)

      // Phase 1: Erase
      this.logMsg('Erasing...')
      await this.erase(addr, total)

      // Phase 2: Write
      this.logMsg('Writing...')
      let bytesSent = 0
      let writeAddr = addr

      while (bytesSent < total) {
        const chunkSize = Math.min(total - bytesSent, transferSize)
        const chunk = firmwareBuffer.slice(bytesSent, bytesSent + chunkSize)

        await this.dfuseCommand(SET_ADDRESS, writeAddr, 4)
        const written = await this.download(chunk, 2)
        const status = await this.poll_until_idle(dfu.dfuDNLOAD_IDLE)
        if (status.status !== dfu.STATUS_OK) {
          throw new Error(`DfuSe write failed at 0x${writeAddr.toString(16)}: status=${status.status}`)
        }

        writeAddr += chunkSize
        bytesSent += written
        if (this.logProgress) this.logProgress(bytesSent, total)
      }

      // Phase 3: Manifest
      this.logMsg('Manifesting...')
      await this.dfuseCommand(SET_ADDRESS, addr, 4)
      await this.download(new ArrayBuffer(0), 0)
      try {
        await this.poll_until((s) => s === dfu.dfuMANIFEST)
      } catch {}
      try {
        await this.device_.reset()
      } catch {}
    }
  }
}

export async function requestAndFlashWebDfu(
  firmwareData: ArrayBuffer,
  onOutput?: DfuLogCallback,
): Promise<{ success: boolean; error?: string }> {
  if (typeof navigator === 'undefined' || !('usb' in navigator)) {
    return { success: false, error: 'WebUSB is not supported in this browser' }
  }

  try {
    console.log('[vial] dfuRequestUsb: calling navigator.usb.requestDevice()')
    onOutput?.({ log: 'Prompting user to select USB DFU device...' })

    const usbDevice = await navigator.usb.requestDevice({
      filters: [{ classCode: 0xfe, subclassCode: 0x01 }],
    })

    if (!usbDevice) {
      return { success: false, error: 'No device selected' }
    }

    console.log(
      '[vial] dfuRequestUsb: device selected:',
      usbDevice.productName,
      'vid=0x' + usbDevice.vendorId.toString(16),
      'pid=0x' + usbDevice.productId.toString(16),
    )
    onOutput?.({ log: `Found USB device: ${usbDevice.productName || 'DFU Device'}` })

    const ifaces = dfu.findDeviceDfuInterfaces(usbDevice)
    if (ifaces.length === 0) {
      console.error('[vial] dfuRequestUsb: no DFU interface found')
      return { success: false, error: 'No DFU interface found on selected device' }
    }

    const iface = ifaces.find((i) => i.alternate.interfaceProtocol === 2) || ifaces[0]
    const isDfuSe = iface.alternate.interfaceProtocol === 2
    console.log('[vial] dfuRequestUsb: using', isDfuSe ? 'DfuSe (protocol 2)' : 'plain DFU', 'interface')

    const dfuDev = isDfuSe ? new dfuse.Device(usbDevice, iface) : new dfu.Device(usbDevice, iface)

    dfuDev.logMsg = (msg: string) => {
      console.log('[vial][dfu]', msg)
      onOutput?.({ log: msg })
    }
    dfuDev.logProgress = (sent: number, total: number) => {
      const pct = sent / total
      console.log('[vial][dfu] progress:', sent, '/', total, `(${Math.round(pct * 100)}%)`)
      onOutput?.({ progress: pct })
    }

    console.log('[vial] dfuFlash: opening device')
    await dfuDev.open()

    let transferSize = 2048
    try {
      const cfgData = await dfuDev.readConfigurationDescriptor(0)
      const parsed = dfu.parseConfigurationDescriptor(cfgData)
      for (const d of parsed.descriptors || []) {
        if (d.bDescriptorType === 0x21 && d.wTransferSize) {
          transferSize = d.wTransferSize
        }
      }
    } catch (e) {
      console.warn('[vial] dfuFlash: descriptor read failed, using default transfer size 2048', e)
    }
    console.log('[vial] dfuFlash: transfer size =', transferSize)

    // Abort any previous DFU operation
    try {
      await dfuDev.abort()
    } catch {}
    try {
      await dfuDev.poll_until((s) => s === dfu.dfuIDLE || s === dfu.dfuDNLOAD_IDLE)
    } catch {}
    try {
      await dfuDev.clearStatus()
    } catch {}

    console.log('[vial] dfuFlash: starting do_download')
    await dfuDev.do_download(transferSize, firmwareData, false)

    try {
      await dfuDev.close()
    } catch {}

    return { success: true }
  } catch (err: unknown) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    console.error('[vial] dfuFlash error:', err)
    onOutput?.({ log: `Error: ${errorMsg}` })
    return { success: false, error: errorMsg }
  }
}
