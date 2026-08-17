// SPDX-License-Identifier: MIT
// Pure JS in-browser LZMA decompressor based on LZMA-JS (Nathan Rugg)

/* eslint-disable */
export const lzmaBrowserDecompress = (function () {
  const wait = typeof setImmediate === 'function' ? setImmediate : setTimeout
  const __4294967296 = 4294967296
  const N1_longLit = [4294967295, -__4294967296]
  const P0_longLit = [0, 0]
  const P1_longLit = [1, 0]

  function initDim(len: number) {
    const a: any[] = []
    a[len - 1] = undefined
    return a
  }

  function add(a: number[], b: number[]) {
    return create(a[0] + b[0], a[1] + b[1])
  }

  function compare(a: number[], b: number[]) {
    if (a[0] === b[0] && a[1] === b[1]) return 0
    const nega = a[1] < 0
    const negb = b[1] < 0
    if (nega && !negb) return -1
    if (!nega && negb) return 1
    if (sub(a, b)[1] < 0) return -1
    return 1
  }

  function create(valueLow: number, valueHigh: number) {
    let diffHi, diffLo
    valueHigh %= 1.8446744073709552e19
    valueLow %= 1.8446744073709552e19
    diffHi = valueHigh % __4294967296
    diffLo = Math.floor(valueLow / __4294967296) * __4294967296
    valueHigh = valueHigh - diffHi + diffLo
    valueLow = valueLow - diffLo + diffHi
    while (valueLow < 0) {
      valueLow += __4294967296
      valueHigh -= __4294967296
    }
    while (valueLow > 4294967295) {
      valueLow -= __4294967296
      valueHigh += __4294967296
    }
    valueHigh %= 1.8446744073709552e19
    while (valueHigh > 9223372032559808512) valueHigh -= 1.8446744073709552e19
    while (valueHigh < -9223372036854775808) valueHigh += 1.8446744073709552e19
    return [valueLow, valueHigh]
  }

  function fromInt(value: number) {
    if (value >= 0) return [value, 0]
    return [value + __4294967296, -__4294967296]
  }

  function lowBits_UNKNOWN(a: number[]) {
    if (a[0] >= 2147483648) {
      return ~~Math.max(Math.min(a[0] - __4294967296, 2147483647), -2147483648)
    }
    return ~~Math.max(Math.min(a[0], 2147483647), -2147483648)
  }

  function sub(a: number[], b: number[]) {
    return create(a[0] - b[0], a[1] - b[1])
  }

  function ByteArrayInputStream(this: any, data: any) {
    this.data = data
    this.pos = 0
    this.len = data.length
  }
  ByteArrayInputStream.prototype.read = function () {
    if (this.pos >= this.len) return -1
    return this.data[this.pos++] & 255
  }

  function ByteArrayOutputStream(this: any) {
    this.data = initDim(32)
    this.len = 0
  }
  ByteArrayOutputStream.prototype.toByteArray = function () {
    const data = this.data
    data.length = this.len
    return data
  }
  ByteArrayOutputStream.prototype.write = function (data: any, offset: number, len: number) {
    for (let i = 0; i < len; ++i) {
      this.data[this.len + i] = data[offset + i]
    }
    this.len += len
  }

  function decodeProperties(this: any, input: any, output: any) {
    let i, val, hex = '', prop: any = []
    for (i = 0; i < 5; ++i) {
      val = input.read()
      if (val === -1) throw new Error('truncated input')
      prop[i] = (val << 24) >> 24
    }
    const decoder: any = Decoder()
    if (!decoder.SetDecoderProperties(prop)) throw new Error('corrupted input')
    for (i = 0; i < 64; i += 8) {
      val = input.read()
      if (val === -1) throw new Error('truncated input')
      val = val.toString(16)
      if (val.length === 1) val = '0' + val
      hex = val + '' + hex
    }
    let uncompressedSize
    if (/^0+$|^f+$/i.test(hex)) {
      uncompressedSize = N1_longLit
    } else {
      const parsed = parseInt(hex, 16)
      uncompressedSize = parsed > 4294967295 ? N1_longLit : fromInt(parsed)
    }
    this.outStream = output
    this.decoder = decoder
    this.uncompressedSize = uncompressedSize
    this.chunker = decoder.Code(input, output, uncompressedSize)
  }

  function OutWindow(this: any) {
    this._buffer = null
    this._pos = 0
    this._streamPos = 0
    this._stream = null
    this._windowSize = 0
  }
  OutWindow.prototype.CopyBlock = function (distance: number, len: number) {
    let pos = this._pos - distance - 1
    if (pos < 0) pos += this._windowSize
    for (; len !== 0; --len) {
      if (pos >= this._windowSize) pos = 0
      this._buffer[this._pos++] = this._buffer[pos++]
      if (this._pos >= this._windowSize) this.Flush()
    }
  }
  OutWindow.prototype.Create = function (windowSize: number) {
    if (this._buffer == null || this._windowSize !== windowSize) {
      this._buffer = initDim(windowSize)
    }
    this._windowSize = windowSize
    this._pos = 0
    this._streamPos = 0
  }
  OutWindow.prototype.Flush = function () {
    const size = this._pos - this._streamPos
    if (size) {
      this._stream.write(this._buffer, this._streamPos, size)
      if (this._pos >= this._windowSize) this._pos = 0
      this._streamPos = this._pos
    }
  }
  OutWindow.prototype.GetByte = function (distance: number) {
    let pos = this._pos - distance - 1
    if (pos < 0) pos += this._windowSize
    return this._buffer[pos]
  }
  OutWindow.prototype.PutByte = function (b: number) {
    this._buffer[this._pos++] = b
    if (this._pos >= this._windowSize) this.Flush()
  }
  OutWindow.prototype.ReleaseStream = function () {
    this.Flush()
    this._stream = null
  }

  function BitTreeDecoder(this: any, numBitLevels: number) {
    this.NumBitLevels = numBitLevels
    this.Models = initDim(1 << numBitLevels)
  }
  BitTreeDecoder.prototype.Decode = function (rangeDecoder: any) {
    let m = 1
    for (let bitIndex = this.NumBitLevels; bitIndex !== 0; --bitIndex) {
      m = (m << 1) + rangeDecoder.DecodeBit(this.Models, m)
    }
    return m - (1 << this.NumBitLevels)
  }
  BitTreeDecoder.prototype.Init = function () {
    InitBitModels(this.Models)
  }

  function ReverseBitTreeDecoder(this: any, numBitLevels: number) {
    this.NumBitLevels = numBitLevels
    this.Models = initDim(1 << numBitLevels)
  }
  ReverseBitTreeDecoder.prototype.Decode = function (rangeDecoder: any) {
    let m = 1, symbol = 0
    for (let bitIndex = 0; bitIndex < this.NumBitLevels; ++bitIndex) {
      const bit = rangeDecoder.DecodeBit(this.Models, m)
      m <<= 1
      m += bit
      symbol |= bit << bitIndex
    }
    return symbol
  }
  ReverseBitTreeDecoder.prototype.Init = function () {
    InitBitModels(this.Models)
  }

  function RangeDecoder(this: any) {
    this.Range = 0
    this.Code = 0
    this.Stream = null
  }
  RangeDecoder.prototype.DecodeBit = function (probs: any, index: number) {
    const prob = probs[index]
    const newBound = (this.Range >>> 11) * prob
    if ((this.Code ^ -2147483648) > (newBound ^ -2147483648)) {
      this.Range = newBound
      probs[index] = prob + ((2048 - prob) >>> 5)
      if (!(this.Range & -16777216)) {
        this.Code = (this.Code << 8) | this.Stream.read()
        this.Range <<= 8
      }
      return 0
    }
    this.Range -= newBound
    this.Code -= newBound
    probs[index] = prob - (prob >>> 5)
    if (!(this.Range & -16777216)) {
      this.Code = (this.Code << 8) | this.Stream.read()
      this.Range <<= 8
    }
    return 1
  }
  RangeDecoder.prototype.DecodeDirectBits = function (numTotalBits: number) {
    let result = 0
    for (let i = numTotalBits; i !== 0; --i) {
      this.Range >>>= 1
      const t = (this.Code - this.Range) >>> 31
      this.Code -= this.Range & (t - 1)
      result = (result << 1) | (1 - t)
      if (!(this.Range & -16777216)) {
        this.Code = (this.Code << 8) | this.Stream.read()
        this.Range <<= 8
      }
    }
    return result
  }
  RangeDecoder.prototype.Init = function () {
    this.Code = 0
    this.Range = -1
    for (let i = 0; i < 5; ++i) {
      this.Code = (this.Code << 8) | this.Stream.read()
    }
  }

  function LenDecoder(this: any) {
    this._choice = initDim(2)
    this._lowCoder = initDim(16)
    this._midCoder = initDim(16)
    this._highCoder = new (BitTreeDecoder as any)(8)
    this._numPosStates = 0
  }
  LenDecoder.prototype.Create = function (numPosStates: number) {
    for (; this._numPosStates < numPosStates; ++this._numPosStates) {
      this._lowCoder[this._numPosStates] = new (BitTreeDecoder as any)(3)
      this._midCoder[this._numPosStates] = new (BitTreeDecoder as any)(3)
    }
  }
  LenDecoder.prototype.Decode = function (rangeDecoder: any, posState: number) {
    if (rangeDecoder.DecodeBit(this._choice, 0) === 0) {
      return this._lowCoder[posState].Decode(rangeDecoder)
    }
    if (rangeDecoder.DecodeBit(this._choice, 1) === 0) {
      return 8 + this._midCoder[posState].Decode(rangeDecoder)
    }
    return 16 + this._highCoder.Decode(rangeDecoder)
  }
  LenDecoder.prototype.Init = function () {
    InitBitModels(this._choice)
    for (let posState = 0; posState < this._numPosStates; ++posState) {
      this._lowCoder[posState].Init()
      this._midCoder[posState].Init()
    }
    this._highCoder.Init()
  }

  function LiteralDecoder(this: any) {
    this.m_Coders = null
    this.m_NumPosBits = 0
    this.m_NumPrevBits = 0
    this.m_PosMask = 0
  }
  LiteralDecoder.prototype.Create = function (numPosBits: number, numPrevBits: number) {
    if (this.m_Coders != null && this.m_NumPrevBits === numPrevBits && this.m_NumPosBits === numPosBits) return
    this.m_NumPosBits = numPosBits
    this.m_PosMask = (1 << numPosBits) - 1
    this.m_NumPrevBits = numPrevBits
    const numStates = 1 << (this.m_NumPrevBits + this.m_NumPosBits)
    this.m_Coders = initDim(numStates)
    for (let i = 0; i < numStates; ++i) {
      this.m_Coders[i] = new (Decoder2 as any)()
    }
  }
  LiteralDecoder.prototype.GetDecoder = function (pos: number, prevByte: number) {
    return this.m_Coders[((pos & this.m_PosMask) << this.m_NumPrevBits) + ((prevByte & 255) >>> (8 - this.m_NumPrevBits))]
  }
  LiteralDecoder.prototype.Init = function () {
    const numStates = 1 << (this.m_NumPrevBits + this.m_NumPosBits)
    for (let i = 0; i < numStates; ++i) {
      this.m_Coders[i].Init()
    }
  }

  function Decoder2(this: any) {
    this.m_Decoders = initDim(768)
  }
  Decoder2.prototype.DecodeNormal = function (rangeDecoder: any) {
    let symbol = 1
    do {
      symbol = (symbol << 1) | rangeDecoder.DecodeBit(this.m_Decoders, symbol)
    } while (symbol < 256)
    return (symbol << 24) >> 24
  }
  Decoder2.prototype.DecodeWithMatchByte = function (rangeDecoder: any, matchByte: number) {
    let symbol = 1
    do {
      const matchBit = (matchByte >> 7) & 1
      matchByte <<= 1
      const bit = rangeDecoder.DecodeBit(this.m_Decoders, ((1 + matchBit) << 8) + symbol)
      symbol = (symbol << 1) | bit
      if (matchBit !== bit) {
        while (symbol < 256) {
          symbol = (symbol << 1) | rangeDecoder.DecodeBit(this.m_Decoders, symbol)
        }
        break
      }
    } while (symbol < 256)
    return (symbol << 24) >> 24
  }
  Decoder2.prototype.Init = function () {
    InitBitModels(this.m_Decoders)
  }

  function InitBitModels(probs: any) {
    for (let i = probs.length - 1; i >= 0; --i) probs[i] = 1024
  }

  function ReverseDecode(models: any, startIndex: number, rangeDecoder: any, NumBitLevels: number) {
    let m = 1, symbol = 0
    for (let bitIndex = 0; bitIndex < NumBitLevels; ++bitIndex) {
      const bit = rangeDecoder.DecodeBit(models, startIndex + m)
      m <<= 1
      m += bit
      symbol |= bit << bitIndex
    }
    return symbol
  }

  function Decoder(this: any) {
    const d = this instanceof Decoder ? this : Object.create(Decoder.prototype)
    d.m_OutWindow = new (OutWindow as any)()
    d.m_RangeDecoder = new (RangeDecoder as any)()
    d.m_IsMatchDecoders = initDim(192)
    d.m_IsRepDecoders = initDim(12)
    d.m_IsRepG0Decoders = initDim(12)
    d.m_IsRepG1Decoders = initDim(12)
    d.m_IsRepG2Decoders = initDim(12)
    d.m_IsRep0LongDecoders = initDim(192)
    d.m_PosSlotDecoder = initDim(4)
    d.m_PosDecoders = initDim(114)
    d.m_PosAlignDecoder = new (ReverseBitTreeDecoder as any)(4)
    d.m_LenDecoder = new (LenDecoder as any)()
    d.m_RepLenDecoder = new (LenDecoder as any)()
    d.m_LiteralDecoder = new (LiteralDecoder as any)()
    d.m_DictionarySize = -1
    d.m_DictionarySizeCheck = -1
    d.m_PosStateMask = 0
    for (let i = 0; i < 4; ++i) {
      d.m_PosSlotDecoder[i] = new (BitTreeDecoder as any)(6)
    }
    return d
  }
  Decoder.prototype.Code = function (inStream: any, outStream: any, outSize: any) {
    this.m_RangeDecoder.Stream = inStream
    this.m_OutWindow.ReleaseStream()
    this.m_OutWindow._stream = outStream
    this.Init()
    let state = 0, rep0 = 0, rep1 = 0, rep2 = 0, rep3 = 0
    let nowPos64 = P0_longLit, prevByte = 0
    const that = this

    return function chunkProcess() {
      let posState, distance, len
      while (compare(outSize, P0_longLit) < 0 || compare(nowPos64, outSize) < 0) {
        posState = lowBits_UNKNOWN(nowPos64) & that.m_PosStateMask
        if (that.m_RangeDecoder.DecodeBit(that.m_IsMatchDecoders, (state << 4) + posState) === 0) {
          const decoder2 = that.m_LiteralDecoder.GetDecoder(lowBits_UNKNOWN(nowPos64), prevByte)
          if (state < 7) {
            prevByte = decoder2.DecodeNormal(that.m_RangeDecoder)
          } else {
            prevByte = decoder2.DecodeWithMatchByte(that.m_RangeDecoder, that.m_OutWindow.GetByte(rep0))
          }
          that.m_OutWindow.PutByte(prevByte)
          state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
          nowPos64 = add(nowPos64, P1_longLit)
        } else {
          if (that.m_RangeDecoder.DecodeBit(that.m_IsRepDecoders, state) === 1) {
            len = 0
            if (that.m_RangeDecoder.DecodeBit(that.m_IsRepG0Decoders, state) === 0) {
              if (that.m_RangeDecoder.DecodeBit(that.m_IsRep0LongDecoders, (state << 4) + posState) === 0) {
                state = state < 7 ? 9 : 11
                len = 1
              }
            } else {
              let distance2
              if (that.m_RangeDecoder.DecodeBit(that.m_IsRepG1Decoders, state) === 0) {
                distance2 = rep1
              } else {
                if (that.m_RangeDecoder.DecodeBit(that.m_IsRepG2Decoders, state) === 0) {
                  distance2 = rep2
                } else {
                  distance2 = rep3
                  rep3 = rep2
                }
                rep2 = rep1
              }
              rep1 = rep0
              rep0 = distance2
            }
            if (len === 0) {
              len = that.m_RepLenDecoder.Decode(that.m_RangeDecoder, posState) + 2
              state = state < 7 ? 8 : 11
            }
          } else {
            rep3 = rep2
            rep2 = rep1
            rep1 = rep0
            len = 2 + that.m_LenDecoder.Decode(that.m_RangeDecoder, posState)
            state = state < 7 ? 7 : 10
            const posSlot = that.m_PosSlotDecoder[len < 6 ? len - 2 : 3].Decode(that.m_RangeDecoder)
            if (posSlot >= 4) {
              const numDirectBits = (posSlot >> 1) - 1
              rep0 = (2 | (posSlot & 1)) << numDirectBits
              if (posSlot < 14) {
                rep0 += ReverseDecode(that.m_PosDecoders, rep0 - posSlot - 1, that.m_RangeDecoder, numDirectBits)
              } else {
                rep0 += that.m_RangeDecoder.DecodeDirectBits(numDirectBits - 4) << 4
                rep0 += that.m_PosAlignDecoder.Decode(that.m_RangeDecoder)
                if (rep0 < 0) {
                  if (rep0 === -1) break
                  return false
                }
              }
            } else {
              rep0 = posSlot
            }
          }
          if (compare(fromInt(rep0), nowPos64) >= 0 || rep0 >= that.m_DictionarySizeCheck) {
            return false
          }
          that.m_OutWindow.CopyBlock(rep0, len)
          nowPos64 = add(nowPos64, fromInt(len))
          prevByte = that.m_OutWindow.GetByte(0)
        }
      }
      that.m_OutWindow.Flush()
      that.m_OutWindow.ReleaseStream()
      that.m_RangeDecoder.Stream = null
      return true
    }
  }
  Decoder.prototype.Init = function () {
    this.m_OutWindow.Create(this.m_DictionarySize)
    InitBitModels(this.m_IsMatchDecoders)
    InitBitModels(this.m_IsRep0LongDecoders)
    InitBitModels(this.m_IsRepDecoders)
    InitBitModels(this.m_IsRepG0Decoders)
    InitBitModels(this.m_IsRepG1Decoders)
    InitBitModels(this.m_IsRepG2Decoders)
    InitBitModels(this.m_PosDecoders)
    this.m_LiteralDecoder.Init()
    for (let i = 0; i < 4; ++i) this.m_PosSlotDecoder[i].Init()
    this.m_LenDecoder.Init()
    this.m_RepLenDecoder.Init()
    this.m_PosAlignDecoder.Init()
    this.m_RangeDecoder.Init()
  }
  Decoder.prototype.SetDecoderProperties = function (properties: any) {
    if (properties.length < 5) return false
    const val = properties[0] & 255
    const lc = val % 9
    const remainder = ~~(val / 9)
    const lp = remainder % 5
    const pb = ~~(remainder / 5)
    let dictionarySize = 0
    for (let i = 0; i < 4; ++i) {
      dictionarySize += (properties[1 + i] & 255) << (i * 8)
    }
    if (dictionarySize < 0) return false
    if (this.m_DictionarySize !== dictionarySize) {
      this.m_DictionarySize = dictionarySize
      this.m_DictionarySizeCheck = Math.max(this.m_DictionarySize, 1)
      this.m_OutWindow.Create(Math.max(this.m_DictionarySizeCheck, 4096))
    }
    if (lc > 8 || lp > 4 || pb > 4) return false
    this.m_LiteralDecoder.Create(lp, lc)
    const numPosStates = 1 << pb
    this.m_LenDecoder.Create(numPosStates)
    this.m_RepLenDecoder.Create(numPosStates)
    this.m_PosStateMask = numPosStates - 1
    return true
  }

  function decompress(byteArr: number[] | Uint8Array, callback?: (res: string | Uint8Array | null, err?: any) => void) {
    try {
      const inStream = new (ByteArrayInputStream as any)(byteArr)
      const outStream = new (ByteArrayOutputStream as any)()
      const runner: any = {}
      decodeProperties.call(runner, inStream, outStream)
      const ok = runner.chunker()
      if (!ok) {
        if (callback) callback(null, new Error('Decompression failed'))
        return null
      }
      const rawBytes = outStream.toByteArray()
      const decoder = new TextDecoder('utf-8')
      const result = decoder.decode(new Uint8Array(rawBytes))
      if (callback) callback(result)
      return result
    } catch (err) {
      if (callback) callback(null, err)
      return null
    }
  }

  return {
    decompress,
  }
})()
