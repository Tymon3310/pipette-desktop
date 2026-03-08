// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Keychron Settings editor — general keyboard settings panel.
 *
 * Handles debounce, NKRO, USB/2.4 GHz report rate, wireless power
 * management, Snap Click (SOCD), factory reset tutorial, and firmware info.
 *
 * Port of vial-gui/editor/keychron_settings.py to React.
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeychronState, SnapClickEntry } from '../../../shared/types/keychron'
import {
  DEBOUNCE_TYPE_NAMES,
  REPORT_RATE_NAMES,
  REPORT_RATE_8000HZ,
  REPORT_RATE_125HZ,
  SNAP_CLICK_TYPE_NAMES,
  SNAP_CLICK_TYPE_TOOLTIPS,
} from '../../../shared/constants/keychron'
import { KeycodeField } from './KeycodeField'
import { KeyPopover } from '../keycodes/KeyPopover'
import { FactoryResetDialog } from './FactoryResetDialog'
import type { Keycode } from '../../../shared/keycodes/keycodes'
import { deserialize } from '../../../shared/keycodes/keycodes'

interface Props {
  keychron: KeychronState
  /** Called after any setting is written to the keyboard so parent can refresh state. */
  onSettingChanged?: () => void
}

export function KeychronSettings({ keychron, onSettingChanged }: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI
  const updating = useRef(false)

  // Local mirrors of mutable settings
  const [debounceType, setDebounceType] = useState(keychron.debounceType)
  const [debounceTime, setDebounceTime] = useState(keychron.debounceTime)
  const [nkroEnabled, setNkroEnabled] = useState(keychron.nkroEnabled)
  const [reportRate, setReportRate] = useState(keychron.reportRate)
  const [pollRateUsb, setPollRateUsb] = useState(keychron.pollRateUsb)
  const [pollRate24g, setPollRate24g] = useState(keychron.pollRate24g)
  const [backlitTime, setBacklitTime] = useState(keychron.wirelessBacklitTime)
  const [idleTime, setIdleTime] = useState(keychron.wirelessIdleTime)
  const [snapEntries, setSnapEntries] = useState<SnapClickEntry[]>(
    keychron.snapClickEntries,
  )
  const [popoverState, setPopoverState] = useState<{
    index: number
    keyField: 'key1' | 'key2'
    anchorRect: DOMRect
  } | null>(null)
  const [showFactoryReset, setShowFactoryReset] = useState(false)

  // Sync local state when keychron prop changes
  useEffect(() => {
    updating.current = true
    setDebounceType(keychron.debounceType)
    setDebounceTime(keychron.debounceTime)
    setNkroEnabled(keychron.nkroEnabled)
    setReportRate(keychron.reportRate)
    setPollRateUsb(keychron.pollRateUsb)
    setPollRate24g(keychron.pollRate24g)
    setBacklitTime(keychron.wirelessBacklitTime)
    setIdleTime(keychron.wirelessIdleTime)
    setSnapEntries(keychron.snapClickEntries)
    updating.current = false
  }, [keychron])

  // --- Debounce ---
  const handleDebounceType = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (updating.current) return
      const type = parseInt(e.target.value, 10)
      setDebounceType(type)
      await api.keychronSetDebounce(type, debounceTime)
      onSettingChanged?.()
    },
    [api, debounceTime, onSettingChanged],
  )

  const handleDebounceTime = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (updating.current) return
      const time = parseInt(e.target.value, 10) || 0
      setDebounceTime(time)
      await api.keychronSetDebounce(debounceType, time)
      onSettingChanged?.()
    },
    [api, debounceType, onSettingChanged],
  )

  // --- NKRO ---
  const handleNkro = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (updating.current) return
      const enabled = e.target.checked
      setNkroEnabled(enabled)
      await api.keychronSetNkro(enabled)
      onSettingChanged?.()
    },
    [api, onSettingChanged],
  )

  // --- Report Rate (v1 single / v2 dual) ---
  const isV2 = keychron.pollRateVersion === 2

  const handleReportRate = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (updating.current) return
      const rate = parseInt(e.target.value, 10)
      if (isV2) {
        setPollRateUsb(rate)
        await api.keychronSetPollRateV2(rate, pollRate24g)
      } else {
        setReportRate(rate)
        await api.keychronSetReportRate(rate)
      }
      onSettingChanged?.()
    },
    [api, isV2, pollRate24g, onSettingChanged],
  )

  const handleFrRate = useCallback(
    async (e: React.ChangeEvent<HTMLSelectElement>) => {
      if (updating.current) return
      const rate = parseInt(e.target.value, 10)
      setPollRate24g(rate)
      await api.keychronSetPollRateV2(pollRateUsb, rate)
      onSettingChanged?.()
    },
    [api, pollRateUsb, onSettingChanged],
  )

  // --- Wireless LPM ---
  const handleBacklitTime = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (updating.current) return
      const v = parseInt(e.target.value, 10) || 5
      setBacklitTime(v)
      await api.keychronSetWirelessLpm(v, idleTime)
      onSettingChanged?.()
    },
    [api, idleTime, onSettingChanged],
  )

  const handleIdleTime = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (updating.current) return
      const v = parseInt(e.target.value, 10) || 60
      setIdleTime(v)
      await api.keychronSetWirelessLpm(backlitTime, v)
      onSettingChanged?.()
    },
    [api, backlitTime, onSettingChanged],
  )

  // --- Snap Click ---
  const handleSnapType = useCallback(
    async (index: number, e: React.ChangeEvent<HTMLSelectElement>) => {
      if (updating.current) return
      const type = parseInt(e.target.value, 10)
      const entry = snapEntries[index]
      const newEntries = [...snapEntries]
      newEntries[index] = { ...entry, type }
      setSnapEntries(newEntries)
      await api.keychronSetSnapClick(index, type, entry.key1, entry.key2)
      await api.keychronSaveSnapClick()
      onSettingChanged?.()
    },
    [api, snapEntries, onSettingChanged],
  )

  const handleRawKeycodeSelect = useCallback(
    (code: number) => {
      if (!popoverState) return
      const entry = snapEntries[popoverState.index]
      const newEntries = [...snapEntries]
      const newEntry = { ...entry, [popoverState.keyField]: code }
      newEntries[popoverState.index] = newEntry
      setSnapEntries(newEntries)
      api
        .keychronSetSnapClick(popoverState.index, newEntry.type, newEntry.key1, newEntry.key2)
        .then(() => {
          api.keychronSaveSnapClick().then(() => onSettingChanged?.())
        })
      setPopoverState(null)
    },
    [popoverState, snapEntries, api, onSettingChanged],
  )

  const handleKeycodeSelect = useCallback(
    (kc: Keycode) => {
      handleRawKeycodeSelect(deserialize(kc.qmkId))
    },
    [handleRawKeycodeSelect],
  )

  // Build supported rate options from bitmask
  function rateOptions(mask: number) {
    const opts: { value: number; label: string }[] = []
    for (let rate = REPORT_RATE_8000HZ; rate <= REPORT_RATE_125HZ; rate++) {
      if (mask & (1 << rate)) {
        opts.push({ value: rate, label: REPORT_RATE_NAMES[rate] ?? `${rate}` })
      }
    }
    return opts
  }

  return (
    <div className="flex flex-col gap-5" data-testid="keychron-settings">
      {/* Debounce */}
      {keychron.hasDebounce && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {t('keychron.debounce', 'Debounce')}
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex-1 min-w-0 text-sm">
                {t('keychron.debounceAlgorithm', 'Algorithm')}
              </label>
              <select
                value={debounceType}
                onChange={handleDebounceType}
                className="w-64 rounded border border-edge bg-surface px-2 py-1 text-sm"
                data-testid="keychron-debounce-type"
              >
                {Object.entries(DEBOUNCE_TYPE_NAMES)
                  .sort(([a], [b]) => Number(a) - Number(b))
                  .map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
              </select>
            </div>
            <div className="flex items-center gap-3">
              <label className="flex-1 min-w-0 text-sm">
                {t('keychron.debounceTime', 'Time (ms)')}
              </label>
              <input
                type="number"
                min={0}
                max={50}
                value={debounceTime}
                onChange={handleDebounceTime}
                className="w-28 rounded border border-edge bg-surface px-2 py-1 text-sm"
                data-testid="keychron-debounce-time"
              />
            </div>
          </div>
        </section>
      )}

      {/* NKRO */}
      {keychron.hasNkro && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {t('keychron.nkro', 'N-Key Rollover')}
          </h4>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              checked={nkroEnabled}
              onChange={handleNkro}
              disabled={keychron.nkroAdaptive || !keychron.nkroSupported}
              className="h-4 w-4"
              data-testid="keychron-nkro"
            />
            <span className="text-sm">
              {t('keychron.enableNkro', 'Enable NKRO')}
            </span>
            <span className="text-xs text-content-muted">
              {keychron.nkroAdaptive
                ? t('keychron.nkroAdaptive', '(Adaptive — controlled by firmware)')
                : keychron.nkroSupported
                  ? t('keychron.nkroSupported', '(NKRO supported)')
                  : t('keychron.nkroUnsupported', '(Not supported)')}
            </span>
          </div>
        </section>
      )}

      {/* Report Rate */}
      {keychron.hasReportRate && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {isV2
              ? t('keychron.pollingRate', 'Polling Rate')
              : t('keychron.usbReportRate', 'USB Report Rate')}
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex-1 min-w-0 text-sm">
                {t('keychron.usbPollingRate', 'USB Polling Rate')}
              </label>
              <select
                value={isV2 ? pollRateUsb : reportRate}
                onChange={handleReportRate}
                className="w-40 rounded border border-edge bg-surface px-2 py-1 text-sm"
                data-testid="keychron-report-rate"
              >
                {rateOptions(isV2 ? keychron.pollRateUsbMask : keychron.reportRateMask).map(
                  (opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ),
                )}
              </select>
            </div>
            {isV2 && (
              <div className="flex items-center gap-3">
                <label className="flex-1 min-w-0 text-sm">
                  {t('keychron.frPollingRate', '2.4 GHz Polling Rate')}
                </label>
                <select
                  value={pollRate24g}
                  onChange={handleFrRate}
                  className="w-40 rounded border border-edge bg-surface px-2 py-1 text-sm"
                  data-testid="keychron-fr-rate"
                >
                  {rateOptions(keychron.pollRate24gMask).map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </section>
      )}

      {/* Wireless LPM */}
      {keychron.hasWireless && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {t('keychron.wirelessPower', 'Wireless Power Management')}
          </h4>
          <div className="space-y-2">
            <div className="flex items-center gap-3">
              <label className="flex-1 min-w-0 text-sm">
                {t('keychron.backlightOff', 'Backlight off after (seconds)')}
              </label>
              <input
                type="number"
                min={5}
                max={3600}
                value={backlitTime}
                onChange={handleBacklitTime}
                className="w-28 rounded border border-edge bg-surface px-2 py-1 text-sm"
                data-testid="keychron-backlit-time"
              />
            </div>
            <div className="flex items-center gap-3">
              <label className="flex-1 min-w-0 text-sm">
                {t('keychron.sleepAfter', 'Sleep after idle (seconds)')}
              </label>
              <input
                type="number"
                min={60}
                max={7200}
                value={idleTime}
                onChange={handleIdleTime}
                className="w-28 rounded border border-edge bg-surface px-2 py-1 text-sm"
                data-testid="keychron-idle-time"
              />
            </div>
          </div>
        </section>
      )}

      {/* Snap Click (SOCD) */}
      {keychron.hasSnapClick && keychron.snapClickCount > 0 && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {t('keychron.snapClick', 'Snap Click (SOCD)')}
          </h4>
          <div className="space-y-2">
            {snapEntries.map((entry, i) => (
              <div key={i} className="flex items-center gap-3">
                <span className="w-16 text-xs text-content-muted">
                  {t('keychron.snapPair', 'Pair {{n}}', { n: i + 1 })}
                </span>
                <select
                  value={entry.type}
                  onChange={(e) => handleSnapType(i, e)}
                  className="flex-1 rounded border border-edge bg-surface px-2 py-1 text-sm"
                  title={SNAP_CLICK_TYPE_TOOLTIPS[entry.type] ?? ''}
                  data-testid={`keychron-snap-${i}`}
                >
                  {Object.entries(SNAP_CLICK_TYPE_NAMES).map(([id, name]) => (
                    <option key={id} value={id}>
                      {name}
                    </option>
                  ))}
                </select>
                <span className="text-xs text-content-muted tabular-nums">
                  {t('keychron.keys', 'Keys')}:
                </span>
                <div 
                  className="cursor-pointer" 
                  onClick={(e) => setPopoverState({ index: i, keyField: 'key1', anchorRect: e.currentTarget.getBoundingClientRect() })}
                >
                  <KeycodeField
                    value={entry.key1}
                    selected={popoverState?.index === i && popoverState?.keyField === 'key1'}
                    onSelect={() => {}}
                  />
                </div>
                <div 
                  className="cursor-pointer" 
                  onClick={(e) => setPopoverState({ index: i, keyField: 'key2', anchorRect: e.currentTarget.getBoundingClientRect() })}
                >
                  <KeycodeField
                    value={entry.key2}
                    selected={popoverState?.index === i && popoverState?.keyField === 'key2'}
                    onSelect={() => {}}
                  />
                </div>
              </div>
            ))}
          </div>
          {popoverState && (
            <KeyPopover
              anchorRect={popoverState.anchorRect}
              currentKeycode={snapEntries[popoverState.index][popoverState.keyField]}
              onKeycodeSelect={handleKeycodeSelect}
              onRawKeycodeSelect={handleRawKeycodeSelect}
              onClose={() => setPopoverState(null)}
            />
          )}
        </section>
      )}

      {/* Factory Reset */}
      <section className="border-t border-edge pt-3">
        <h4 className="mb-2 text-sm font-semibold text-content-muted">
          {t('keychron.factoryReset', 'Factory Reset')}
        </h4>
        <p className="mb-3 text-xs text-content-muted">
          {t(
            'keychron.factoryResetInfo',
            'Factory reset restores all settings to their defaults. This cannot be triggered via USB — use the hardware key combo instead.',
          )}
        </p>
        <button
          className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm hover:bg-surface-hover"
          onClick={() => setShowFactoryReset(true)}
          data-testid="keychron-factory-reset-btn"
        >
          {t('keychron.howToFactoryReset', 'How to Factory Reset...')}
        </button>
        {showFactoryReset && (
          <FactoryResetDialog onClose={() => setShowFactoryReset(false)} />
        )}
      </section>

      {/* FW Flasher placeholder */}
      {keychron.hasDfu && (
        <section>
          <h4 className="mb-2 text-sm font-semibold text-content-muted">
            {t('keychron.firmwareUpdate', 'Firmware Update')}
          </h4>
          {keychron.mcuInfo && (
            <p className="mb-2 text-xs text-content-muted">
              {t('keychron.mcuDetected', 'MCU')}: {keychron.mcuInfo}
            </p>
          )}
          <button
            className="rounded-md border border-edge bg-surface px-3 py-1.5 text-sm opacity-50 cursor-not-allowed"
            disabled
            title={t('keychron.fwFlasherComingSoon', 'Firmware flashing is coming soon')}
            data-testid="keychron-fw-flash-btn"
          >
            {t('keychron.flashFirmware', 'Flash Firmware...')}
          </button>
        </section>
      )}

      {/* Firmware info */}
      <section className="border-t border-edge pt-3">
        {keychron.firmwareVersion && (
          <div className="text-xs text-content-muted">
            {t('keychron.firmware', 'Firmware')}: {keychron.firmwareVersion}
          </div>
        )}
        {keychron.mcuInfo && (
          <div className="text-xs text-content-muted">
            {t('keychron.mcu', 'MCU')}: {keychron.mcuInfo}
          </div>
        )}
        <div className="text-xs text-content-muted">
          {t('keychron.protocol', 'Protocol')}: v{keychron.protocolVersion}
          {keychron.miscProtocolVersion > 0 &&
            ` / misc v${keychron.miscProtocolVersion}`}
        </div>
      </section>
    </div>
  )
}
