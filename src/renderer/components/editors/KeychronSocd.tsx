// SPDX-License-Identifier: GPL-3.0-or-later

import { useState, useCallback, useLayoutEffect } from 'react'
import { useTranslation } from 'react-i18next'
import type { KeychronState, SnapClickEntry } from '../../../shared/types/keychron'
import { KeyboardWidget } from '../keyboard/KeyboardWidget'
import { KEY_UNIT, KEY_SPACING, KEYBOARD_PADDING } from '../keyboard/constants'
import { keyCorners } from '../keyboard/key-geometry'
import type { KleKey } from '../../../shared/kle/types'
import {
  SNAP_CLICK_TYPE_NAMES,
  SNAP_CLICK_TYPE_TOOLTIPS,
} from '../../../shared/constants/keychron'
import { KeychronModalShell } from './KeychronModalShell'
import { codeToLabel } from '../../../shared/keycodes/keycodes'
import { Tooltip } from '../ui/Tooltip'
import { BTN_SECONDARY } from '../../constants/ui-tokens'

interface Props {
  keychron: KeychronState
  keys: KleKey[]
  keymap: Map<string, number>
  onSettingChanged?: () => Promise<void>
  onClose: () => void
}

export function KeychronSocd({ keychron, keys, keymap, onSettingChanged, onClose }: Props) {
  const { t } = useTranslation()
  const api = window.vialAPI

  const [snapEntries, setSnapEntries] = useState<SnapClickEntry[]>(keychron.snapClickEntries)
  const [socdPickMode, setSocdPickMode] = useState<{ pairIdx: number; whichKey: 1 | 2 } | null>(
    null,
  )

  const defaultLayer = keychron.defaultLayer >= 0 ? keychron.defaultLayer : 0

  const handleSnapType = useCallback(
    async (index: number, type: number) => {
      const entry = snapEntries[index]
      if (!entry) return
      const ok = await api.keychronSetSnapClick(index, type, entry.key1, entry.key2)
      if (ok) {
        await api.keychronSaveSnapClick()
        setSnapEntries((prev) => {
          const next = [...prev]
          next[index] = { ...entry, type }
          return next
        })
        await onSettingChanged?.()
      }
    },
    [api, snapEntries, onSettingChanged],
  )

  const handleKeyPick = useCallback(
    async (key: KleKey) => {
      if (!socdPickMode) return
      const { pairIdx, whichKey } = socdPickMode
      const entry = snapEntries[pairIdx]
      if (!entry) return

      const posKey = `${defaultLayer},${key.row},${key.col}`
      const fullKeycode = keymap.get(posKey) ?? keymap.get(`0,${key.row},${key.col}`) ?? 0
      const basicKc = fullKeycode & 0xff

      const k1 = whichKey === 1 ? basicKc : entry.key1
      const k2 = whichKey === 2 ? basicKc : entry.key2

      const ok = await api.keychronSetSnapClick(pairIdx, entry.type, k1, k2)
      if (ok) {
        await api.keychronSaveSnapClick()
        setSnapEntries((prev) => {
          const next = [...prev]
          next[pairIdx] = { ...entry, key1: k1, key2: k2 }
          return next
        })
        await onSettingChanged?.()
      }
      setSocdPickMode(null)
    },
    [socdPickMode, snapEntries, keymap, defaultLayer, api, onSettingChanged],
  )

  // Keyboard container ref for dynamic scaling
  const [kbContainerEl, setKbContainerEl] = useState<HTMLDivElement | null>(null)
  const [kbScale, setKbScale] = useState(1)

  useLayoutEffect(() => {
    if (!kbContainerEl) return

    const updateScale = () => {
      const containerWidth = kbContainerEl.clientWidth - 40
      if (containerWidth <= 0 || keys.length === 0) return

      let minX = Infinity
      let maxX = -Infinity
      for (const key of keys) {
        for (const [cx] of keyCorners(key, KEY_UNIT, KEY_SPACING)) {
          if (cx < minX) minX = cx
          if (cx > maxX) maxX = cx
        }
      }
      const keysWidth = maxX - minX
      const naturalWidth = keysWidth + KEYBOARD_PADDING * 2
      if (naturalWidth > containerWidth && keysWidth > 0) {
        const targetScale = Math.min(1, (containerWidth - KEYBOARD_PADDING * 2) / keysWidth)
        setKbScale(Math.max(0.2, targetScale))
      } else {
        setKbScale(1)
      }
    }

    updateScale()
    const observer = new ResizeObserver(updateScale)
    observer.observe(kbContainerEl)
    return () => observer.disconnect()
  }, [kbContainerEl, keys])

  // Build keycodes map for KeyboardWidget display
  const widgetKeycodes = new Map<string, string>()
  for (const k of keys) {
    if (k.row !== undefined && k.col !== undefined) {
      const code =
        keymap.get(`${defaultLayer},${k.row},${k.col}`) ??
        keymap.get(`0,${k.row},${k.col}`) ??
        0
      widgetKeycodes.set(`${k.row},${k.col}`, codeToLabel(code))
    }
  }

  return (
    <KeychronModalShell
      title={t('keychron.socd.title', 'Keychron SOCD')}
      testId="keychron-socd"
      onClose={onClose}
      width="w-modal-3xl"
    >
      {keychron.isDebug && (
        <div className="mb-4 rounded-md border border-warning/40 bg-warning/10 p-3 text-sm text-warning">
          <strong>Debug Mode Active:</strong> Simulating Keychron SOCD. Settings saved will not be written to physical EEPROM.
        </div>
      )}

      <p className="text-sm text-content-secondary mb-4">
        {t(
          'keychron.socdDesc',
          'Configure Simultaneous Opposite Cardinal Direction (SOCD) key pairs. When both keys in a pair are pressed, the selected resolution mode determines which key takes priority.',
        )}
      </p>

      {/* Show keyboard widget when in pick mode */}
      {socdPickMode && (
        <div
          ref={setKbContainerEl}
          className="w-full rounded-lg border-2 border-accent bg-surface-dim p-4 flex flex-col mb-4"
        >
          <p className="mb-2 self-start text-sm font-medium text-accent">
            Click a key on the keyboard to assign it as Key {socdPickMode.whichKey} for SOCD pair #{socdPickMode.pairIdx + 1}
          </p>
          <div className="flex justify-center overflow-x-auto w-full">
            <div data-kb-widget>
              <KeyboardWidget
                keys={keys}
                keycodes={widgetKeycodes}
                multiSelectedKeys={new Set()}
                onKeyClick={(key) => handleKeyPick(key)}
                scale={kbScale}
              />
            </div>
          </div>
          <button
            type="button"
            className={`mt-3 self-center ${BTN_SECONDARY}`}
            onClick={() => setSocdPickMode(null)}
          >
            {t('common.cancel', 'Cancel')}
          </button>
        </div>
      )}

      {snapEntries.length === 0 ? (
        <div className="rounded-lg border border-dashed border-edge p-8 text-center text-sm italic text-content-secondary">
          {t('keychron.noSocd', 'No SOCD slots available for this keyboard.')}
        </div>
      ) : (
        <div className="space-y-3">
          {snapEntries.map((pair, i) => {
            const key1Label = pair.key1 ? codeToLabel(pair.key1) : ''
            const key1Sub = pair.key1 ? `0x${pair.key1.toString(16).padStart(2, '0')}` : ''

            const key2Label = pair.key2 ? codeToLabel(pair.key2) : ''
            const key2Sub = pair.key2 ? `0x${pair.key2.toString(16).padStart(2, '0')}` : ''

            return (
              <div
                key={i}
                className="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface p-3.5 transition-colors hover:border-edge-focus"
              >
                <div className="flex items-center gap-2 min-w-[70px]">
                  <span className="rounded-md bg-surface-dim px-2.5 py-1 text-xs font-semibold text-content-secondary">
                    {t('keychron.snapPair', 'Pair {{n}}', { n: i + 1 })}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <Tooltip content={t('keychron.socd.clickToAssign1', 'Click to assign Key 1')}>
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 1
                          ? 'border-accent bg-accent/10 text-accent font-semibold ring-1 ring-accent'
                          : 'border-edge bg-surface-alt text-content-secondary hover:text-content hover:bg-surface-dim'
                      }`}
                      onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 1 })}
                    >
                      <span className="text-content-muted">Key 1:</span>
                      <span className="font-semibold text-content">
                        {key1Label ? `(${key1Label})` : t('common.unassigned', 'None')}
                      </span>
                      {key1Sub && (
                        <span className="font-mono text-[10px] text-content-muted">{key1Sub}</span>
                      )}
                    </button>
                  </Tooltip>

                  <span className="text-content-muted font-bold text-sm">↔</span>

                  <Tooltip content={t('keychron.socd.clickToAssign2', 'Click to assign Key 2')}>
                    <button
                      type="button"
                      className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs transition-colors ${
                        socdPickMode?.pairIdx === i && socdPickMode?.whichKey === 2
                          ? 'border-accent bg-accent/10 text-accent font-semibold ring-1 ring-accent'
                          : 'border-edge bg-surface-alt text-content-secondary hover:text-content hover:bg-surface-dim'
                      }`}
                      onClick={() => setSocdPickMode({ pairIdx: i, whichKey: 2 })}
                    >
                      <span className="text-content-muted">Key 2:</span>
                      <span className="font-semibold text-content">
                        {key2Label ? `(${key2Label})` : t('common.unassigned', 'None')}
                      </span>
                      {key2Sub && (
                        <span className="font-mono text-[10px] text-content-muted">{key2Sub}</span>
                      )}
                    </button>
                  </Tooltip>
                </div>

                <div className="w-56 shrink-0">
                  <Tooltip content={SNAP_CLICK_TYPE_TOOLTIPS[pair.type] ?? ''}>
                    <select
                      value={pair.type}
                      onChange={(e) => handleSnapType(i, parseInt(e.target.value, 10))}
                      className="w-full rounded-md border border-edge bg-surface-alt px-2.5 py-1.5 text-xs font-medium text-content focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                    >
                      {Object.entries(SNAP_CLICK_TYPE_NAMES).map(([id, name]) => (
                        <option key={id} value={id}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </Tooltip>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </KeychronModalShell>
  )
}
