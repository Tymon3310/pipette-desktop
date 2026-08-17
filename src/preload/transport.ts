// SPDX-License-Identifier: GPL-2.0-or-later
// Pluggable transport dispatcher for HID send/receive

export type TransportSendReceive = (data: Uint8Array) => Promise<Uint8Array>
export type TransportSend = (data: Uint8Array) => Promise<void>

let currentSendReceive: TransportSendReceive = () => {
  throw new Error('HID transport not initialized. Call setTransport() first.')
}

let currentSend: TransportSend = () => {
  throw new Error('HID transport not initialized. Call setTransport() first.')
}

export function setTransport(transport: {
  sendReceive: TransportSendReceive
  send?: TransportSend
}): void {
  currentSendReceive = transport.sendReceive
  if (transport.send) {
    currentSend = transport.send
  }
}

export function sendReceive(data: Uint8Array): Promise<Uint8Array> {
  return currentSendReceive(data)
}

export function send(data: Uint8Array): Promise<void> {
  return currentSend(data)
}
