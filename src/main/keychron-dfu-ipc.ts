import { spawn } from 'node:child_process'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { app } from 'electron'
import type Electron from 'electron'
import { IpcChannels } from '../shared/ipc/channels.js'
import { secureHandle } from './ipc-guard.js'
import { log } from './logger.js'

let activeDfuProcess: ReturnType<typeof spawn> | null = null

export function setupKeychronDfuIpc(): void {
  secureHandle(IpcChannels.KEYCHRON_DFU_FLASH, async (event: Electron.IpcMainInvokeEvent, firmwareData: unknown) => {
    if (!(firmwareData instanceof ArrayBuffer) && !(firmwareData instanceof Uint8Array)) {
      return { success: false, error: 'Invalid firmware data. Expected ArrayBuffer.' }
    }
    
    if (activeDfuProcess) {
      log('warn', 'DFU flash already in progress')
      return { success: false, error: 'Flash already in progress' }
    }

    // Write buffer to temporary file
    const tempDir = app.getPath('temp')
    const firmwarePath = path.join(tempDir, `keychron_firmware_${Date.now()}.bin`)
    try {
      await fs.writeFile(firmwarePath, Buffer.from(firmwareData as ArrayBuffer))
    } catch (err: unknown) {
      return { success: false, error: `Failed to write temp firmware file: ${(err as Error).message}` }
    }

    return new Promise((resolve) => {
      // Step 1: Wait for DFU device to appear (timeout 60s)
      log('info', `Waiting for DFU device to flash temporary file...`)
      event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: 'Waiting for DFU device (up to 60s)...', progress: 0 })


      const timeout = Date.now() + 60000

      const checkDfuDevice = () => {
        if (Date.now() > timeout) {
          event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: 'Timeout waiting for DFU device' })
          fs.unlink(firmwarePath).catch(() => {}) // Cleanup
          resolve({ success: false, error: 'DFU device did not appear within 60s' })
          return
        }

        const ls = spawn('dfu-util', ['-l'])
        let output = ''
        ls.stdout.on('data', (data) => { output += data.toString() })
        ls.stderr.on('data', (data) => { output += data.toString() })
        
        ls.on('close', (code) => {
          if (code === 0 && output.includes('Found DFU')) {
            startFlashing()
          } else {
            // Check again in 1 second
            setTimeout(checkDfuDevice, 1000)
          }
        })

        ls.on('error', (err) => {
          event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: `Error running dfu-util: ${err.message}` })
          fs.unlink(firmwarePath).catch(() => {}) // Cleanup
          resolve({ success: false, error: `dfu-util not found: ${err.message}` })
        })
      }

      const startFlashing = () => {
        log('info', 'DFU device found, starting flash')
        event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: 'DFU device found. Starting flash...', progress: 0.05 })

        // dfu-util --device 0483:df11 --alt 0 --dfuse-address 0x08000000:leave --download <firmware_path>
        activeDfuProcess = spawn('dfu-util', [
          '--device', '0483:df11',
          '--alt', '0',
          '--dfuse-address', '0x08000000:leave',
          '--download', firmwarePath
        ])

        const progressRegex = /^(Erase|Download|Upload)\s+\[.*?\]\s+(\d+)%/

        const handleOutput = (data: Buffer) => {
          const text = data.toString('utf-8')
          const lines = text.split(/[\r\n]+/)
          
          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed) continue

            const match = progressRegex.exec(trimmed)
            if (match) {
              const phase = match[1]
              const pct = parseInt(match[2], 10)
              
              let overallProgress = 0
              if (phase === 'Erase') {
                // Erase: 5% to 50%
                overallProgress = 0.05 + (pct * 0.45 / 100)
              } else {
                // Download/Upload: 50% to 100%
                overallProgress = 0.50 + (pct * 0.50 / 100)
              }
              
              event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { progress: overallProgress })
              if (pct === 100) {
                event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: trimmed })
              }
            } else {
              event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: trimmed })
            }
          }
        }

        activeDfuProcess?.stdout?.on('data', handleOutput)
        activeDfuProcess?.stderr?.on('data', handleOutput)

        activeDfuProcess?.on('close', (code) => {
          activeDfuProcess = null
          fs.unlink(firmwarePath).catch(() => {}) // Cleanup

          if (code === 0) {
            log('info', 'DFU flash complete')
            event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: 'Flash complete.', progress: 1.0 })
            resolve({ success: true })
          } else {
            log('error', `DFU flash failed with code ${code}`)
            event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: `dfu-util exited with code ${code}` })
            resolve({ success: false, error: `dfu-util exited with code ${code}` })
          }
        })

        activeDfuProcess?.on('error', (err) => {
          activeDfuProcess = null
          fs.unlink(firmwarePath).catch(() => {}) // Cleanup
          log('error', `Error spawning dfu-util: ${err.message}`)
          event.sender.send(IpcChannels.KEYCHRON_DFU_OUTPUT, { log: `Error spawning dfu-util: ${err.message}` })
          resolve({ success: false, error: err.message })
        })
      }

      checkDfuDevice()
    })
  })
}
