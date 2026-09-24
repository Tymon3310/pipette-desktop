// SPDX-License-Identifier: GPL-3.0-or-later

import React, { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { KeychronModalShell } from './KeychronModalShell'
import { useUnlockGate } from '../../hooks/useUnlockGate'
import type { DeviceInfo, VilFile } from '../../../shared/types/protocol'
import { BTN_PRIMARY, BTN_SECONDARY, BTN_DANGER } from '../../constants/ui-tokens'

/** How often to poll for the device to re-appear after DFU flashing (ms) */
const RECONNECT_POLL_MS = 2000
/** Maximum time to wait for the device to re-appear after DFU flashing (ms) */
const RECONNECT_TIMEOUT_MS = 60_000

interface KeychronDfuFlasherProps {
  isOpen: boolean
  onClose: () => void
  onSaveBackup?: () => Promise<VilFile | null>
  onRestoreBackup?: (backup: VilFile) => Promise<void>
  unlocked?: boolean
  onUnlock?: () => void
  /** Suppress disconnect detection while flashing */
  setSuppressDisconnect?: (suppress: boolean) => void
  /** Original device info for auto-reconnect matching */
  originalDevice?: DeviceInfo | null
  /** Connect to a specific device */
  connectDevice?: (device: DeviceInfo) => Promise<boolean>
  /** Called after a successful flash and reconnect to refresh the UI */
  onReload?: () => Promise<void>
}

export const KeychronDfuFlasher = ({
  isOpen,
  onClose,
  onSaveBackup,
  onRestoreBackup,
  unlocked,
  onUnlock,
  setSuppressDisconnect,
  originalDevice,
  connectDevice,
  onReload,
}: KeychronDfuFlasherProps) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [isFlashing, setIsFlashing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [logs, setLogs] = useState<string[]>([])
  const [backupLayout, setBackupLayout] = useState(true)
  const backupDataRef = useRef<VilFile | null>(null)
  const [flashSuccess, setFlashSuccess] = useState<boolean | null>(null)
  const [reconnecting, setReconnecting] = useState(false)
  const logEndRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()

  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // Clean up suppress on unmount
  useEffect(() => {
    return () => {
      setSuppressDisconnect?.(false)
    }
  }, [setSuppressDisconnect])

  const { guardAll } = useUnlockGate({ unlocked, onUnlock })

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      handleFileSelection(e.target.files[0])
    }
  }

  const handleFileSelection = (file: File) => {
    // Basic validation
    if (!file.name.toLowerCase().endsWith('.bin')) {
      setLogs(['Error: Selected file is not a .bin file. Please select a valid firmware file.'])
      setSelectedFile(null)
      setFlashSuccess(false)
      return
    }

    setSelectedFile(file)
    setFlashSuccess(null)
    setProgress(0)
    setLogs([`Selected firmware: ${file.name} (${(file.size / 1024).toFixed(1)} KB)`])
  }

  const [isDragging, setIsDragging] = useState(false)

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!isBusy) {
      setIsDragging(true)
    }
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
    if (isBusy) return

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      handleFileSelection(e.dataTransfer.files[0])
    }
  }

  const waitForReconnect = useCallback(async (): Promise<boolean> => {
    if (!originalDevice || !connectDevice) return false

    setReconnecting(true)
    if (typeof window.vialAPI?.requestDevice === 'function') {
      setLogs((prev) => [
        ...prev,
        'Flash successful! The keyboard is rebooting.',
        "Click 'Reconnect / Authorize Keyboard' below to restore layout & settings.",
      ])
    } else {
      setLogs((prev) => [...prev, 'Waiting for keyboard to reconnect...'])
    }

    const deadline = Date.now() + RECONNECT_TIMEOUT_MS
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, RECONNECT_POLL_MS))
      try {
        const devices = await window.vialAPI.listDevices()
        console.log('[Flasher] Polling for reconnected devices...', devices)
        const match =
          devices.find(
            (d: DeviceInfo) => d.vendorId === originalDevice.vendorId && d.productId === originalDevice.productId,
          ) ||
          devices.find((d: DeviceInfo) => d.vendorId === originalDevice.vendorId) ||
          (devices.length === 1 ? devices[0] : undefined)

        if (match) {
          console.log('[Flasher] Found matching device:', match)
          setLogs((prev) => [...prev, `Device found: ${match.productName}. Reconnecting...`])
          // Release the suppress so the normal poller takes over after connect
          setSuppressDisconnect?.(false)
          const ok = await connectDevice(match)
          if (ok) {
            console.log('[Flasher] Reconnected successfully! Reloading and restoring backup...')
            setLogs((prev) => [
              ...prev,
              'Reconnected successfully! Restoring layout + settings...',
            ])
            setReconnecting(false)
            try {
              await onReload?.()
            } catch (e: unknown) {
              setLogs((prev) => [
                ...prev,
                `Warning: Reload failed: ${e instanceof Error ? e.message : String(e)}. Attempting restore anyway...`,
              ])
            }
            if (backupDataRef.current && onRestoreBackup) {
              try {
                setLogs((prev) => [
                  ...prev,
                  'Applying layout backup (unlock keyboard if prompted)...',
                ])
                await onRestoreBackup(backupDataRef.current)
                setLogs((prev) => [...prev, 'Layout and settings restored successfully.'])
              } catch (e: unknown) {
                console.error('[Flasher] Restore layout failed:', e)
                setLogs((prev) => [
                  ...prev,
                  `Warning: Failed to restore layout: ${e instanceof Error ? e.message : String(e)}`,
                ])
              }
            }

            // Wait 3 seconds so the user can read the success message before closing
            setTimeout(() => {
              onClose()
            }, 3000)

            return true
          }
        }
      } catch (err) {
        console.warn('[Flasher] Polling error:', err)
      }
    }

    setLogs((prev) => [...prev, 'Timed out waiting for keyboard. Please reconnect manually.'])
    setSuppressDisconnect?.(false)
    setReconnecting(false)
    return false
  }, [originalDevice, connectDevice, setSuppressDisconnect, onReload, onRestoreBackup, onClose])

  const handleManualReconnect = useCallback(async () => {
    if (window.vialAPI?.requestDevice && connectDevice) {
      try {
        const dev = await window.vialAPI.requestDevice()
        if (dev) {
          setLogs((prev) => [...prev, `Device selected: ${dev.productName}. Connecting...`])
          setSuppressDisconnect?.(false)
          const ok = await connectDevice(dev)
          if (ok) {
            setLogs((prev) => [...prev, 'Connected successfully! Restoring layout + settings...'])
            setReconnecting(false)
            try {
              await onReload?.()
            } catch (e: unknown) {
              setLogs((prev) => [
                ...prev,
                `Warning: Reload failed: ${e instanceof Error ? e.message : String(e)}. Attempting restore anyway...`,
              ])
            }
            if (backupDataRef.current && onRestoreBackup) {
              try {
                await onRestoreBackup(backupDataRef.current)
                setLogs((prev) => [...prev, 'Layout and settings restored successfully.'])
              } catch (e: unknown) {
                setLogs((prev) => [
                  ...prev,
                  `Warning: Failed to restore layout: ${e instanceof Error ? e.message : String(e)}`,
                ])
              }
            }
            setTimeout(() => {
              onClose()
            }, 3000)
          }
        }
      } catch (err: unknown) {
        console.warn('Manual reconnect failed:', err)
      }
    }
  }, [connectDevice, setSuppressDisconnect, onReload, onRestoreBackup, onClose])

  const handleFlash = async () => {
    if (!selectedFile) return

    // Safety check: prevent flashing over wireless connection
    if (originalDevice?.serialNumber?.startsWith('bridge:')) {
      setLogs(['Error: DFU flashing over wireless (2.4 GHz) is not supported.',
               'Wireless connections are unreliable for firmware updates.',
               'Please connect the keyboard via USB cable to flash.'])
      return
    }

    setIsFlashing(true)
    setFlashSuccess(null)
    setProgress(0)
    setLogs(['Starting Keychron DFU Flashing sequence...'])

    // Save layout silently
    if (backupLayout && onSaveBackup) {
      setLogs((prev) => [...prev, 'Backing up current layout and keychron settings...'])
      try {
        const backup = await onSaveBackup()
        if (backup) {
          backupDataRef.current = backup
          setLogs((prev) => [...prev, 'Layout saved successfully to background.'])
        } else {
          setLogs((prev) => [...prev, 'Warning: Failed to save layout.'])
        }
      } catch (e: unknown) {
        setLogs((prev) => [
          ...prev,
          `Warning: Failed to save layout: ${e instanceof Error ? e.message : String(e)}`,
        ])
      }
    }

    // Parse the file explicitly as an ArrayBuffer since Electron's isolated context removes native .path
    let firmwareData: ArrayBuffer
    try {
      firmwareData = await selectedFile.arrayBuffer()
    } catch (e: unknown) {
      setLogs((prev) => [
        ...prev,
        `Error: Failed to read file data: ${e instanceof Error ? e.message : String(e)}`,
      ])
      setIsFlashing(false)
      setFlashSuccess(false)
      return
    }

    // Gate the actual jump + flash behind unlock
    // Note: backup is done BEFORE unlock gate, just like vial-gui does
    guardAll(async () => {
      // Suppress disconnect detection BEFORE jumping to bootloader
      setSuppressDisconnect?.(true)

      setLogs((prev) => [...prev, 'Rebooting keyboard to DFU bootloader...'])
      try {
        await window.vialAPI.jumpToBootloader()
        setLogs((prev) => [...prev, 'Jump command sent. Waiting for DFU device...'])
      } catch (e: unknown) {
        setLogs((prev) => [
          ...prev,
          `Warning: Jump command failed (if already in DFU mode, this is fine). Error: ${e instanceof Error ? e.message : String(e)}`,
        ])
      }

      // Subscribe to progress
      const unsubscribe = window.vialAPI.keychronDfuOnOutput((data: { log?: string; progress?: number }) => {
        if (data.log) {
          setLogs((prev) => [...prev, data.log!])
        }
        if (data.progress !== undefined) {
          setProgress(Math.round(data.progress * 100))
        }
      })

      try {
        const result = await window.vialAPI.keychronDfuFlash(firmwareData)
        if (result.success) {
          setFlashSuccess(true)
          setLogs((prev) => [...prev, 'Firmware flashed successfully!'])
          // Auto-reconnect after successful flash
          await waitForReconnect()
        } else {
          setFlashSuccess(false)
          setLogs((prev) => [...prev, `Flash failed: ${result.error}`])
          setSuppressDisconnect?.(false)
        }
      } catch (err: unknown) {
        setFlashSuccess(false)
        setLogs((prev) => [
          ...prev,
          `IPC Error: ${err instanceof Error ? err.message : String(err)}`,
        ])
        setSuppressDisconnect?.(false)
      } finally {
        setIsFlashing(false)
        unsubscribe()
      }
    })
  }

  const handleClose = () => {
    setSuppressDisconnect?.(false)
    onClose()
  }

  const isBusy = isFlashing || reconnecting

  if (!isOpen) return null

  return (
    <KeychronModalShell
      title={t('keychron.flasher.title', 'Keychron Firmware Flasher')}
      testId="keychron-dfu-flasher-modal"
      onClose={handleClose}
      width="w-modal-xl"
      isBusy={isBusy}
      contentClassName="flex flex-col gap-6 text-sm"
      footer={
        <>
          {reconnecting && typeof window.vialAPI?.requestDevice === 'function' && (
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={handleManualReconnect}
            >
              {t('app.pairDevice', 'Reconnect / Authorize Keyboard')}
            </button>
          )}
          <button
            type="button"
            className={BTN_SECONDARY}
            onClick={handleClose}
            disabled={isFlashing}
          >
            {flashSuccess ? t('common.close', 'Close') : t('common.cancel', 'Cancel')}
          </button>
          {!reconnecting && (
            <button
              type="button"
              className={BTN_DANGER}
              onClick={handleFlash}
              disabled={!selectedFile || isBusy}
            >
              {isFlashing
                ? t('keychron.flasher.flashing', 'Flashing...')
                : t('keychron.flasher.flashFirmware', 'Flash Firmware')}
            </button>
          )}
        </>
      }
    >
      <p className="text-sm text-content-secondary">
        Select a <b>.bin</b> firmware file to flash your Keychron keyboard. This process will
        reboot your keyboard into DFU mode and use <code className="rounded bg-surface px-1 py-0.5 text-content">dfu-util</code> to deploy the firmware.
      </p>

      <div
        className={`p-6 border-2 border-dashed rounded-xl transition-colors flex flex-col items-center justify-center gap-3 cursor-pointer
          ${
            isBusy
              ? 'border-edge bg-surface-dim opacity-50 cursor-not-allowed'
              : isDragging
                ? 'border-accent bg-accent/10'
                : 'border-edge bg-surface hover:border-accent/50'
          }
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !isBusy && fileInputRef.current?.click()}
      >
        <div className="flex flex-col items-center justify-center text-center gap-1">
          <span className="font-medium text-sm text-content">
            {selectedFile ? selectedFile.name : 'Drag and drop your .bin file here'}
          </span>
          {!selectedFile && (
            <span className="text-xs text-content-secondary">
              or click to browse from your computer
            </span>
          )}
        </div>

        <input
          type="file"
          accept=".bin"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleFileChange}
          disabled={isBusy}
        />

        {selectedFile && (
          <button
            type="button"
            className="mt-2 rounded-md border border-edge bg-surface-dim px-3 py-1.5 text-xs font-medium text-content hover:bg-edge transition-colors disabled:opacity-50"
            onClick={(e) => {
              e.stopPropagation()
              fileInputRef.current?.click()
            }}
            disabled={isBusy}
          >
            Choose different file
          </button>
        )}
      </div>

      <label className="flex items-center gap-2 cursor-pointer text-sm font-medium text-content">
        <input
          type="checkbox"
          checked={backupLayout}
          onChange={(e) => setBackupLayout(e.target.checked)}
          disabled={isBusy}
          className="h-4 w-4 rounded border-edge text-accent focus:ring-accent accent-accent disabled:cursor-not-allowed disabled:opacity-50"
        />
        {t('keychron.flasher.backup', 'Restore current layout after flashing')}
      </label>

      {(isBusy || logs.length > 0) && (
        <div>
          <div className="mb-2 font-bold text-sm text-content">
            {reconnecting ? 'Reconnecting...' : 'Flash Progress'}
          </div>
          <div className="w-full h-2 bg-surface-dim rounded-full overflow-hidden mb-2">
            <div
              className={`h-full transition-all duration-300 ${
                flashSuccess === false
                  ? 'bg-danger'
                  : reconnecting
                    ? 'bg-warning animate-pulse'
                    : 'bg-accent'
              }`}
              style={{ width: reconnecting ? '100%' : `${progress}%` }}
            />
          </div>

          <div className="bg-surface-dim p-3 rounded-xl font-mono text-sm h-48 overflow-y-auto border border-edge">
            {logs.map((log, i) => (
              <div
                key={i}
                className={
                  log.toLowerCase().includes('error') || log.toLowerCase().includes('failed')
                    ? 'text-danger'
                    : 'text-content-secondary'
                }
              >
                {log}
              </div>
            ))}
            <div ref={logEndRef} />
          </div>
        </div>
      )}

      {flashSuccess === true && !reconnecting && (
        <div className="flex gap-2 p-3 bg-success/10 text-success border border-success/20 rounded-xl items-center text-sm font-medium">
          <span>✓</span>
          <span>Flash completed successfully. The keyboard should reconnect shortly.</span>
        </div>
      )}

      {flashSuccess === false && (
        <div className="flex gap-2 p-3 bg-danger/10 text-danger border border-danger/20 rounded-xl items-center text-sm font-medium">
          <span>⚠</span>
          <span>Flashing failed. Check the logs above for details.</span>
        </div>
      )}
    </KeychronModalShell>
  )
}
