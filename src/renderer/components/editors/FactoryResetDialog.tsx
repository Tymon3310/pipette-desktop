// SPDX-License-Identifier: GPL-3.0-or-later

/**
 * Factory Reset Dialog — instructs the user how to trigger a hardware factory
 * reset on their Keychron keyboard (Fn + J + Z held for 3 seconds).
 *
 * Port of vial-gui/factory_reset_dialog.py.
 */

import { useState, useRef, useCallback, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

const HOLD_MS = 3000
const TICK_MS = 50

interface Props {
  onClose: () => void
}

export function FactoryResetDialog({ onClose }: Props) {
  const { t } = useTranslation()

  const [started, setStarted] = useState(false)
  const [done, setDone] = useState(false)
  const [elapsed, setElapsed] = useState(0)
  const timerRef = useRef<number | null>(null)

  const stop = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const start = useCallback(() => {
    setStarted(true)
    setDone(false)
    setElapsed(0)

    timerRef.current = window.setInterval(() => {
      setElapsed((prev) => {
        const next = prev + TICK_MS
        if (next >= HOLD_MS) {
          stop()
          setDone(true)
          return HOLD_MS
        }
        return next
      })
    }, TICK_MS)
  }, [stop])

  useEffect(() => {
    return () => stop()
  }, [stop])

  const progress = Math.min((elapsed / HOLD_MS) * 100, 100)
  const keyCombo = ['Fn', 'J', 'Z']

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[460px] max-w-[90vw] rounded-lg bg-surface-alt p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-4 text-lg font-semibold">
          {t('keychron.factoryReset', 'Factory Reset')}
        </h3>

        <p className="mb-3 text-sm text-content-secondary">
          {t(
            'keychron.factoryResetIntro',
            'This will restore all keyboard settings to factory defaults. The reset is performed entirely on the keyboard — no USB command is sent.',
          )}
        </p>

        <div className="mb-4 rounded-md border border-edge bg-surface p-3 text-sm text-content-muted">
          <p className="font-medium text-content mb-1">
            {t('keychron.whatResets', 'The following will be reset:')}
          </p>
          <ul className="ml-4 list-disc space-y-0.5">
            <li>{t('keychron.resetKeymap', 'Keymap (all layers restored to firmware defaults)')}</li>
            <li>{t('keychron.resetActuation', 'Key actuation profiles (Hall Effect keyboards)')}</li>
            <li>{t('keychron.resetRgb', 'RGB lighting settings')}</li>
            <li>{t('keychron.resetDebounce', 'Debounce, NKRO, and USB report rate settings')}</li>
            <li>{t('keychron.resetWireless', 'Wireless pairing information')}</li>
          </ul>
        </div>

        <p className="mb-3 text-sm text-content-secondary">
          {t(
            'keychron.holdInstructions',
            'Press and hold the following key combination until the bar fills:',
          )}
        </p>

        {/* Key combo badge */}
        <div className="mb-4 flex items-center justify-center gap-2">
          {keyCombo.map((key, i) => (
            <span key={key}>
              <span className="inline-block rounded-lg border-2 border-edge bg-surface px-4 py-2 text-sm font-bold">
                {key}
              </span>
              {i < keyCombo.length - 1 && (
                <span className="mx-1 text-content-muted">+</span>
              )}
            </span>
          ))}
        </div>

        {/* Progress bar */}
        <div className="mb-3 h-2 overflow-hidden rounded-full bg-surface-dim">
          <div
            className={`h-full rounded-full transition-all duration-75 ${done ? 'bg-success' : 'bg-accent'}`}
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Status */}
        <p className="mb-4 text-center text-sm text-content-muted">
          {done
            ? t(
                'keychron.resetComplete',
                'Release the keys — the keyboard is resetting.\nIt will flash red three times to confirm.\n\nClose this dialog and re-open the application to reload settings.',
              )
            : started
              ? t('keychron.resetHolding', 'Hold the keys above until the bar is full...')
              : t('keychron.resetReady', 'Press Start, then hold the key combo on your keyboard.')}
        </p>

        {/* Buttons */}
        <div className="flex justify-end gap-3">
          {!done && (
            <button
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
              onClick={start}
              disabled={started && !done}
            >
              {t('common.start', 'Start')}
            </button>
          )}
          <button
            className="rounded-md border border-edge bg-surface px-4 py-2 text-sm font-medium hover:bg-surface-hover"
            onClick={() => {
              stop()
              onClose()
            }}
          >
            {done ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
          </button>
        </div>
      </div>
    </div>
  )
}
