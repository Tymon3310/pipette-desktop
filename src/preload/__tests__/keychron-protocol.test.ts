// SPDX-License-Identifier: GPL-2.0-or-later

import { vi, describe, it, expect, beforeEach } from 'vitest'

vi.mock('../hid-transport', () => ({
  sendReceive: vi.fn(),
}))

import { sendReceive } from '../hid-transport'
import type { Mock } from 'vitest'

import {
  getKeychronProtocolVersion,
  getKeychronSupportFeature,
  getKeychronFirmwareVersion,
  getKeychronDfuInfo,
  getKeychronMiscProtocol,
  getKeychronDefaultLayer,
  getKeychronDebounce,
  setKeychronDebounce,
  getKeychronNkro,
  setKeychronNkro,
  getKeychronReportRate,
  setKeychronReportRate,
  setKeychronPollRateV2,
  getKeychronSnapClickInfo,
  getKeychronSnapClickEntries,
  setKeychronSnapClick,
  saveKeychronSnapClick,
  getKeychronWirelessLpm,
  setKeychronWirelessLpm,
  getKeychronRGBProtocolVersion,
  saveKeychronRGB,
  getKeychronIndicators,
  setKeychronIndicators,
  getKeychronLedCount,
  getKeychronPerKeyRGBType,
  setKeychronPerKeyRGBType,
  getKeychronMixedRGBInfo,
  getKeychronAnalogVersion,
  getKeychronAnalogProfilesInfo,
  getKeychronAnalogCurve,
  setKeychronAnalogCurve,
  setKeychronAnalogProfile,
  saveKeychronAnalogProfile,
  resetKeychronAnalogProfile,
  setKeychronAnalogGameControllerMode,
  startKeychronCalibration,
  getKeychronCalibrationState,
  getKeychronRealtimeTravel,
  setKeychronAnalogProfileName,
  setKeychronAnalogAdvanceModeClear,
  setKeychronAnalogAdvanceModeToggle,
  reloadKeychron,
} from '../keychron-protocol'

const mockSendReceive = sendReceive as Mock

// Helper: build a 32-byte response Uint8Array with specified bytes at the start
function resp(...bytes: number[]): Uint8Array {
  const r = new Uint8Array(32)
  bytes.forEach((b, i) => {
    r[i] = b
  })
  return r
}

// Helper: extract the sent packet from the first call argument
function sentPacket(callIndex = 0): Uint8Array {
  return mockSendReceive.mock.calls[callIndex][0] as Uint8Array
}

beforeEach(() => {
  vi.clearAllMocks()
})

// =====================================================================
// Core Detection Commands
// =====================================================================

describe('Keychron Protocol — Core Detection', () => {
  describe('getKeychronProtocolVersion', () => {
    it('sends [0xA0] and parses version from resp[1]', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa0, 0x01))

      const version = await getKeychronProtocolVersion()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa0)
      expect(version).toBe(1)
    })

    it('returns -1 if resp[0] is 0xFF (not a Keychron keyboard)', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const version = await getKeychronProtocolVersion()
      expect(version).toBe(-1)
    })
  })

  describe('getKeychronSupportFeature', () => {
    it('sends [0xA2] and parses flags from resp[2..3] LE16', async () => {
      // Flags: resp[2]=0x21 (debounce|defaultLayer), resp[3]=0x02 (NKRO)
      mockSendReceive.mockResolvedValueOnce(resp(0xa2, 0x00, 0x21, 0x02))

      const features = await getKeychronSupportFeature()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa2)
      // 0x21 | (0x02 << 8) = 0x0221 = 545
      expect(features).toBe(0x0221)
    })

    it('returns 0 if resp[0] is 0xFF', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const features = await getKeychronSupportFeature()
      expect(features).toBe(0)
    })
  })

  describe('getKeychronFirmwareVersion', () => {
    it('sends [0xA1] and extracts null-terminated string', async () => {
      const response = resp(0xa1, 0x31, 0x2e, 0x30, 0x30, 0x00) // "1.00\0"
      mockSendReceive.mockResolvedValueOnce(response)

      const version = await getKeychronFirmwareVersion()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa1)
      expect(version).toBe('1.00')
    })

    it('returns empty string if resp[0] is 0xFF', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const version = await getKeychronFirmwareVersion()
      expect(version).toBe('')
    })
  })

  describe('getKeychronDfuInfo', () => {
    it('sends [0xA7, 0x02] and extracts chip string on success', async () => {
      // resp: [0xA7, 0x02, 0x00(success), 0x01(DFU_INFO_CHIP), 0x05(len), 'S','T','M','3','2']
      const r = resp(0xa7, 0x02, 0x00, 0x01, 0x05, 0x53, 0x54, 0x4d, 0x33, 0x32)
      mockSendReceive.mockResolvedValueOnce(r)

      const chip = await getKeychronDfuInfo()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x02)
      expect(chip).toBe('STM32')
    })

    it('returns empty string on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x02, 0x01)) // resp[2]=1 = failure

      const chip = await getKeychronDfuInfo()
      expect(chip).toBe('')
    })
  })

  describe('getKeychronMiscProtocol', () => {
    it('sends [0xA7, 0x01] and parses version + features LE16', async () => {
      // resp[3..4] = version LE16 = 0x0003, resp[5..6] = features LE16 = 0x00FF
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x01, 0x00, 0x03, 0x00, 0xff, 0x00))

      const misc = await getKeychronMiscProtocol()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x01)
      expect(misc.version).toBe(3)
      expect(misc.features).toBe(0xff)
    })

    it('returns zeros if command not echoed', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const misc = await getKeychronMiscProtocol()
      expect(misc.version).toBe(0)
      expect(misc.features).toBe(0)
    })
  })

  describe('getKeychronDefaultLayer', () => {
    it('sends [0xA3] and returns layer index', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa3, 0x02))

      const layer = await getKeychronDefaultLayer()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa3)
      expect(layer).toBe(2)
    })

    it('returns -1 on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const layer = await getKeychronDefaultLayer()
      expect(layer).toBe(-1)
    })
  })
})

// =====================================================================
// Debounce & NKRO
// =====================================================================

describe('Keychron Protocol — Debounce', () => {
  describe('getKeychronDebounce', () => {
    it('sends [0xA7, 0x05] and parses type from resp[4] and time from resp[5]', async () => {
      // resp: [0xA7, 0x05, 0x00(success), ?, type=1, time=10]
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x05, 0x00, 0x00, 0x01, 0x0a))

      const debounce = await getKeychronDebounce()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x05)
      expect(debounce).toEqual({ type: 1, time: 10 })
    })

    it('returns defaults on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const debounce = await getKeychronDebounce()
      expect(debounce).toEqual({ type: 0, time: 5 })
    })
  })

  describe('setKeychronDebounce', () => {
    it('sends [0xA7, 0x06, type, time] and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x06, 0x00))

      const result = await setKeychronDebounce(1, 10)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x06)
      expect(pkt[2]).toBe(1)
      expect(pkt[3]).toBe(10)
      expect(result).toBe(true)
    })

    it('returns false on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x06, 0x01)) // fail

      const result = await setKeychronDebounce(1, 10)
      expect(result).toBe(false)
    })
  })
})

describe('Keychron Protocol — NKRO', () => {
  describe('getKeychronNkro', () => {
    it('sends [0xA7, 0x12] and parses NKRO flags', async () => {
      // resp[3] flags: bit0=enabled, bit1=supported, bit2=adaptive
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x12, 0x00, 0x07)) // all flags set

      const result = await getKeychronNkro()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x12)
      expect(result).toEqual({ enabled: true, supported: true, adaptive: true })
    })

    it('returns disabled defaults on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const result = await getKeychronNkro()
      expect(result).toEqual({ enabled: false, supported: false, adaptive: false })
    })
  })

  describe('setKeychronNkro', () => {
    it('sends [0xA7, 0x13, 1] for enable and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x13, 0x00))

      const result = await setKeychronNkro(true)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x13)
      expect(pkt[2]).toBe(1)
      expect(result).toBe(true)
    })

    it('sends [0xA7, 0x13, 0] for disable', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x13, 0x00))

      await setKeychronNkro(false)
      expect(sentPacket()[2]).toBe(0)
    })
  })
})

// =====================================================================
// Report Rate
// =====================================================================

describe('Keychron Protocol — Report Rate', () => {
  describe('getKeychronReportRate', () => {
    it('parses v1 single rate when miscProtocolVersion != 3', async () => {
      // resp: [0xA7, 0x0D, 0x00(success), rate=3, mask=0x7F]
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0d, 0x00, 0x03, 0x7f))

      const result = await getKeychronReportRate(1)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x0d)
      expect(result.pollRateVersion).toBe(1)
      expect(result.reportRate).toBe(3) // 1000Hz
      expect(result.reportRateMask).toBe(0x7f)
    })

    it('parses v2 dual rate when miscProtocolVersion === 3', async () => {
      // V2: resp[3]=currentUsb, resp[4]=supportUsb, resp[5]=support24g, resp[6]=current24g
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0d, 0x00, 0x02, 0x3f, 0x1f, 0x03))

      const result = await getKeychronReportRate(3)

      expect(result.pollRateVersion).toBe(2)
      expect(result.pollRateUsb).toBe(2)
      expect(result.pollRateUsbMask).toBe(0x3f)
      expect(result.pollRate24gMask).toBe(0x1f)
      expect(result.pollRate24g).toBe(3)
    })

    it('returns defaults on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const result = await getKeychronReportRate(1)
      expect(result.pollRateVersion).toBe(1)
      expect(result.reportRate).toBe(3) // REPORT_RATE_1000HZ default
    })
  })

  describe('setKeychronReportRate', () => {
    it('sends [0xA7, 0x0E, rate] and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0e, 0x00))

      const result = await setKeychronReportRate(2)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x0e)
      expect(pkt[2]).toBe(2)
      expect(result).toBe(true)
    })
  })

  describe('setKeychronPollRateV2', () => {
    it('sends [0xA7, 0x0E, usbRate, frRate] and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0e, 0x00))

      const result = await setKeychronPollRateV2(2, 4)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x0e)
      expect(pkt[2]).toBe(2)
      expect(pkt[3]).toBe(4)
      expect(result).toBe(true)
    })
  })
})

// =====================================================================
// Snap Click
// =====================================================================

describe('Keychron Protocol — Snap Click', () => {
  describe('getKeychronSnapClickInfo', () => {
    it('returns max pair count on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x07, 0x00, 0x04))

      const count = await getKeychronSnapClickInfo()

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x07)
      expect(count).toBe(4)
    })

    it('returns 0 on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronSnapClickInfo()).toBe(0)
    })
  })

  describe('getKeychronSnapClickEntries', () => {
    it('fetches entries in batches of 8', async () => {
      // 3 entries: each is (type, key1, key2)
      const r = resp(0xa7, 0x08, 0x00)
      // Entry 0: type=1, key1=0x04, key2=0x07
      r[3] = 1
      r[4] = 0x04
      r[5] = 0x07
      // Entry 1: type=2, key1=0x16, key2=0x13
      r[6] = 2
      r[7] = 0x16
      r[8] = 0x13
      // Entry 2: type=0, key1=0, key2=0
      r[9] = 0
      r[10] = 0
      r[11] = 0
      mockSendReceive.mockResolvedValueOnce(r)

      const entries = await getKeychronSnapClickEntries(3)

      expect(entries).toHaveLength(3)
      expect(entries[0]).toEqual({ type: 1, key1: 0x04, key2: 0x07 })
      expect(entries[1]).toEqual({ type: 2, key1: 0x16, key2: 0x13 })
      expect(entries[2]).toEqual({ type: 0, key1: 0, key2: 0 })
    })
  })

  describe('setKeychronSnapClick', () => {
    it('sends correct packet and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x09, 0x00))

      const result = await setKeychronSnapClick(0, 1, 0x04, 0x07)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x09) // SNAP_CLICK_SET
      expect(pkt[2]).toBe(0) // index
      expect(pkt[3]).toBe(1) // count
      expect(pkt[4]).toBe(1) // type
      expect(pkt[5]).toBe(0x04) // key1
      expect(pkt[6]).toBe(0x07) // key2
      expect(result).toBe(true)
    })
  })

  describe('saveKeychronSnapClick', () => {
    it('returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0a, 0x00))

      const result = await saveKeychronSnapClick()

      expect(sentPacket()[0]).toBe(0xa7)
      expect(sentPacket()[1]).toBe(0x0a)
      expect(result).toBe(true)
    })
  })
})

// =====================================================================
// Wireless LPM
// =====================================================================

describe('Keychron Protocol — Wireless LPM', () => {
  describe('getKeychronWirelessLpm', () => {
    it('parses LE16 backlitTime and idleTime', async () => {
      // backlitTime = 60 = 0x003C, idleTime = 300 = 0x012C
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0b, 0x00, 0x3c, 0x00, 0x2c, 0x01))

      const lpm = await getKeychronWirelessLpm()

      expect(lpm.backlitTime).toBe(60)
      expect(lpm.idleTime).toBe(300)
    })

    it('returns defaults on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))

      const lpm = await getKeychronWirelessLpm()
      expect(lpm.backlitTime).toBe(30)
      expect(lpm.idleTime).toBe(300)
    })
  })

  describe('setKeychronWirelessLpm', () => {
    it('encodes LE16 values and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x0c, 0x00))

      const result = await setKeychronWirelessLpm(60, 300)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa7)
      expect(pkt[1]).toBe(0x0c)
      // backlitTime=60=0x003C LE16
      expect(pkt[2]).toBe(0x3c)
      expect(pkt[3]).toBe(0x00)
      // idleTime=300=0x012C LE16
      expect(pkt[4]).toBe(0x2c)
      expect(pkt[5]).toBe(0x01)
      expect(result).toBe(true)
    })
  })
})

// =====================================================================
// RGB Commands
// =====================================================================

describe('Keychron Protocol — RGB', () => {
  describe('getKeychronRGBProtocolVersion', () => {
    it('sends [0xA8, 0x01] and returns version', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa8, 0x01, 0x02))

      const version = await getKeychronRGBProtocolVersion()

      expect(sentPacket()[0]).toBe(0xa8)
      expect(sentPacket()[1]).toBe(0x01)
      expect(version).toBe(2)
    })

    it('returns 0 on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronRGBProtocolVersion()).toBe(0)
    })
  })

  describe('saveKeychronRGB', () => {
    it('sends [0xA8, 0x02]', async () => {
      mockSendReceive.mockResolvedValueOnce(resp())

      await saveKeychronRGB()

      expect(sentPacket()[0]).toBe(0xa8)
      expect(sentPacket()[1]).toBe(0x02)
    })
  })

  describe('getKeychronIndicators', () => {
    it('parses OS indicator config', async () => {
      // Response: [cmd, subcmd, status=0, availableMask, disableMask, hue, sat, val]
      mockSendReceive.mockResolvedValueOnce(resp(0xa8, 0x03, 0x00, 0x07, 0x01, 0x80, 0xff, 0xc0))

      const config = await getKeychronIndicators()

      expect(config).toEqual({
        availableMask: 0x07,
        disableMask: 1,
        hue: 0x80,
        sat: 0xff,
        val: 0xc0,
      })
    })

    it('returns null on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronIndicators()).toBeNull()
    })
  })

  describe('setKeychronIndicators', () => {
    it('sends correct packet', async () => {
      mockSendReceive.mockResolvedValueOnce(resp())

      await setKeychronIndicators(1, 0x80, 0xff, 0xc0)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa8)
      expect(pkt[1]).toBe(0x04) // SET_INDICATORS_CONFIG
      expect(pkt[2]).toBe(1)
      expect(pkt[3]).toBe(0x80)
      expect(pkt[4]).toBe(0xff)
      expect(pkt[5]).toBe(0xc0)
    })
  })

  describe('getKeychronLedCount', () => {
    it('parses LED count from resp[3]', async () => {
      // Response: [cmd, subcmd, status=0, count]
      mockSendReceive.mockResolvedValueOnce(resp(0xa8, 0x05, 0x00, 87))

      const count = await getKeychronLedCount()
      expect(count).toBe(87)
    })

    it('returns 0 on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronLedCount()).toBe(0)
    })
  })

  describe('getKeychronPerKeyRGBType / setKeychronPerKeyRGBType', () => {
    it('gets per-key RGB effect type', async () => {
      // Response: [cmd, subcmd, status=0, type]
      mockSendReceive.mockResolvedValueOnce(resp(0xa8, 0x07, 0x00, 0x02))

      const type = await getKeychronPerKeyRGBType()
      expect(type).toBe(2)
    })

    it('sets per-key RGB effect type', async () => {
      mockSendReceive.mockResolvedValueOnce(resp())

      await setKeychronPerKeyRGBType(3)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa8)
      expect(pkt[1]).toBe(0x08)
      expect(pkt[2]).toBe(3)
    })
  })

  describe('getKeychronMixedRGBInfo', () => {
    it('parses layers and effectsPerLayer', async () => {
      // Response: [cmd, subcmd, status=0, layers, effectsPerLayer]
      mockSendReceive.mockResolvedValueOnce(resp(0xa8, 0x0b, 0x00, 0x03, 0x05))

      const info = await getKeychronMixedRGBInfo()
      expect(info).toEqual({ layers: 3, effectsPerLayer: 5 })
    })

    it('returns zeros on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronMixedRGBInfo()).toEqual({ layers: 0, effectsPerLayer: 0 })
    })
  })
})

// =====================================================================
// Analog Matrix Commands
// =====================================================================

describe('Keychron Protocol — Analog Matrix', () => {
  describe('getKeychronAnalogVersion', () => {
    it('returns analog firmware version', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x01, 0x03))

      const version = await getKeychronAnalogVersion()

      expect(sentPacket()[0]).toBe(0xa9)
      expect(sentPacket()[1]).toBe(0x01)
      expect(version).toBe(3)
    })

    it('returns 0 on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronAnalogVersion()).toBe(0)
    })
  })

  describe('getKeychronAnalogProfilesInfo', () => {
    it('parses profile counts, size, okmc count, socd count', async () => {
      // resp[2]=current, resp[3]=count, resp[4..5]=profileSize LE16, resp[6]=okmc, resp[7]=socd
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x10, 0x00, 0x03, 0x00, 0x02, 0x04, 0x08))

      const info = await getKeychronAnalogProfilesInfo()

      expect(info.currentProfile).toBe(0)
      expect(info.profileCount).toBe(3)
      expect(info.profileSize).toBe(512) // 0x0200
      expect(info.okmcCount).toBe(4)
      expect(info.socdCount).toBe(8)
    })
  })

  describe('getKeychronAnalogCurve / setKeychronAnalogCurve', () => {
    it('gets curve as 8 points', async () => {
      const r = resp(0xa9, 0x20)
      // 4 pairs of (x, y)
      r[2] = 0
      r[3] = 0
      r[4] = 25
      r[5] = 30
      r[6] = 50
      r[7] = 60
      r[8] = 100
      r[9] = 100
      mockSendReceive.mockResolvedValueOnce(r)

      const curve = await getKeychronAnalogCurve()
      expect(curve).toEqual([0, 0, 25, 30, 50, 60, 100, 100])
    })

    it('sets curve and returns true on echo', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x21))

      const result = await setKeychronAnalogCurve([0, 0, 25, 30, 50, 60, 100, 100])

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa9)
      expect(pkt[1]).toBe(0x21)
      expect(pkt[2]).toBe(0)
      expect(pkt[3]).toBe(0)
      expect(pkt[4]).toBe(25)
      expect(result).toBe(true)
    })
  })

  describe('setKeychronAnalogProfile', () => {
    it('sends profile select and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x11, 0x00))

      const result = await setKeychronAnalogProfile(2)

      expect(sentPacket()[2]).toBe(2)
      expect(result).toBe(true)
    })
  })

  describe('saveKeychronAnalogProfile', () => {
    it('sends save and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x1f, 0x00))

      const result = await saveKeychronAnalogProfile(1)

      expect(sentPacket()[0]).toBe(0xa9)
      expect(sentPacket()[1]).toBe(0x1f)
      expect(sentPacket()[2]).toBe(1)
      expect(result).toBe(true)
    })
  })

  describe('resetKeychronAnalogProfile', () => {
    it('sends reset and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x1e, 0x00))

      const result = await resetKeychronAnalogProfile(0)

      expect(sentPacket()[1]).toBe(0x1e)
      expect(result).toBe(true)
    })
  })

  describe('setKeychronAnalogGameControllerMode', () => {
    it('sends mode and returns true on echo', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x23))

      const result = await setKeychronAnalogGameControllerMode(1)

      expect(sentPacket()[2]).toBe(1)
      expect(result).toBe(true)
    })
  })

  describe('startKeychronCalibration', () => {
    it('sends calibration type and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x40, 0x00))

      const result = await startKeychronCalibration(2)

      expect(sentPacket()[0]).toBe(0xa9)
      expect(sentPacket()[1]).toBe(0x40)
      expect(sentPacket()[2]).toBe(2)
      expect(result).toBe(true)
    })
  })

  describe('getKeychronCalibrationState', () => {
    it('parses calibrated and state', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x41, 0x01, 0x03))

      const result = await getKeychronCalibrationState()

      expect(result).toEqual({ calibrated: 1, state: 3 })
    })

    it('returns null on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xff))
      expect(await getKeychronCalibrationState()).toBeNull()
    })
  })

  describe('getKeychronRealtimeTravel', () => {
    it('parses realtime travel data', async () => {
      const r = resp(0xa9, 0x30, 0x00) // success
      r[3] = 2
      r[4] = 5 // row, col
      r[5] = 20
      r[6] = 40 // travelMm, travelRaw
      r[7] = 0x00
      r[8] = 0x10 // value LE16 = 4096
      r[9] = 0x00
      r[10] = 0x01 // zero LE16 = 256
      r[11] = 0x00
      r[12] = 0x20 // full LE16 = 8192
      r[13] = 1 // state
      mockSendReceive.mockResolvedValueOnce(r)

      const result = await getKeychronRealtimeTravel(2, 5)

      expect(result).toEqual({
        row: 2,
        col: 5,
        travelMm: 20,
        travelRaw: 40,
        value: 4096,
        zero: 256,
        full: 8192,
        state: 1,
      })
    })

    it('returns null on failure', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x30, 0x01))
      expect(await getKeychronRealtimeTravel(0, 0)).toBeNull()
    })
  })

  describe('setKeychronAnalogProfileName', () => {
    it('sends profile name and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x13, 0x00))

      const result = await setKeychronAnalogProfileName(0, 'Gaming')

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa9)
      expect(pkt[1]).toBe(0x13)
      expect(pkt[2]).toBe(0) // profile
      expect(pkt[3]).toBe(6) // name length
      // 'Gaming' ASCII
      expect(pkt[4]).toBe(0x47) // G
      expect(pkt[5]).toBe(0x61) // a
      expect(result).toBe(true)
    })
  })

  describe('setKeychronAnalogAdvanceModeClear', () => {
    it('sends clear advance mode and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x15, 0x00))

      const result = await setKeychronAnalogAdvanceModeClear(0, 2, 5)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa9)
      expect(pkt[1]).toBe(0x15)
      expect(pkt[2]).toBe(0) // profile
      expect(pkt[3]).toBe(0) // ADV_MODE_CLEAR
      expect(pkt[4]).toBe(2) // row
      expect(pkt[5]).toBe(5) // col
      expect(result).toBe(true)
    })
  })

  describe('setKeychronAnalogAdvanceModeToggle', () => {
    it('sends toggle advance mode and returns true on success', async () => {
      mockSendReceive.mockResolvedValueOnce(resp(0xa9, 0x15, 0x00))

      const result = await setKeychronAnalogAdvanceModeToggle(1, 3, 4)

      const pkt = sentPacket()
      expect(pkt[0]).toBe(0xa9)
      expect(pkt[1]).toBe(0x15)
      expect(pkt[2]).toBe(1) // profile
      expect(pkt[3]).toBe(3) // ADV_MODE_TOGGLE
      expect(pkt[4]).toBe(3) // row
      expect(pkt[5]).toBe(4) // col
      expect(result).toBe(true)
    })
  })
})

// =====================================================================
// Orchestrator: reloadKeychron
// =====================================================================

describe('Keychron Protocol — reloadKeychron', () => {
  it('returns null for non-Keychron keyboard (0xFF)', async () => {
    mockSendReceive.mockResolvedValueOnce(resp(0xff)) // protocolVersion → -1

    const state = await reloadKeychron()
    expect(state).toBeNull()
  })

  it('returns null when features are 0', async () => {
    // Protocol version succeeds
    mockSendReceive.mockResolvedValueOnce(resp(0xa0, 0x01))
    // Features = 0
    mockSendReceive.mockResolvedValueOnce(resp(0xa2, 0x00, 0x00, 0x00))

    const state = await reloadKeychron()
    expect(state).toBeNull()
  })

  it('loads minimal Keychron state with debounce + NKRO', async () => {
    // 1. getKeychronProtocolVersion → version 1
    mockSendReceive.mockResolvedValueOnce(resp(0xa0, 0x01))
    // 2. getKeychronSupportFeature → FEATURE_DYNAMIC_DEBOUNCE(0x20) | FEATURE_NKRO(0x0200)
    mockSendReceive.mockResolvedValueOnce(resp(0xa2, 0x00, 0x20, 0x02))
    // 3. getKeychronFirmwareVersion → "1.00"
    mockSendReceive.mockResolvedValueOnce(resp(0xa1, 0x31, 0x2e, 0x30, 0x30, 0x00))
    // 4. getKeychronDfuInfo → failure (empty string)
    mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x02, 0x01))
    // 5. getKeychronMiscProtocol → version=1, features=0x84 (MISC_DEBOUNCE|MISC_NKRO)
    mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x01, 0x00, 0x01, 0x00, 0x84, 0x00))
    // 6. getKeychronDebounce → type=1, time=10
    mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x05, 0x00, 0x00, 0x01, 0x0a))
    // 7. getKeychronNkro → enabled=true, supported=true
    mockSendReceive.mockResolvedValueOnce(resp(0xa7, 0x12, 0x00, 0x03))

    const state = await reloadKeychron()

    expect(state).not.toBeNull()
    expect(state!.protocolVersion).toBe(1)
    expect(state!.firmwareVersion).toBe('1.00')
    expect(state!.hasDebounce).toBe(true)
    expect(state!.debounceType).toBe(1)
    expect(state!.debounceTime).toBe(10)
    expect(state!.hasNkro).toBe(true)
    expect(state!.nkroEnabled).toBe(true)
    expect(state!.nkroSupported).toBe(true)
    // Features not set
    expect(state!.hasRgb).toBe(false)
    expect(state!.hasAnalog).toBe(false)
    expect(state!.hasSnapClick).toBe(false)
    expect(state!.hasWireless).toBe(false)
  })
})
