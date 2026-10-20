// SPDX-License-Identifier: GPL-2.0-or-later
// The transport ./protocol.ts and ./keychron-protocol.ts send reports over.
// By default the Tauri backend (./hid-transport); the web build
// (src/web/hid-transport.ts) swaps in WebHID with setTransport.

import * as tauriHid from './hid-transport'

export type TransportSendReceive = (data: Uint8Array) => Promise<Uint8Array>
export type TransportSend = (data: Uint8Array) => Promise<void>

// Looked up on each call, so a test that mocks ./hid-transport is honoured.
let currentSendReceive: TransportSendReceive = (data) => tauriHid.sendReceive(data)
let currentSend: TransportSend = (data) => tauriHid.send(data)

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
