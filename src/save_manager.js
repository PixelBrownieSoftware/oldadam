// Binary save format:
//   bytes 0-7   magic "OLDADAM\0"
//   bytes 8-9   format version (uint16, little-endian)
//   bytes 10-13 payload length (uint32)
//   bytes 14-17 payload CRC-32 (uint32)
//   bytes 18-   payload: one tagged value (see TAG)
export const SAVE_VERSION = 1;
const MAGIC = [0x4f, 0x4c, 0x44, 0x41, 0x44, 0x41, 0x4d, 0x00];
const HEADER_SIZE = 18;

const TAG = Object.freeze({
  NULL: 0,
  FALSE: 1,
  TRUE: 2,
  NUMBER: 3,
  STRING: 4,
  ARRAY: 5,
  OBJECT: 6,
  NUMBER_ARRAY: 7,
});

const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Writer {
  constructor() {
    this.bytes = new Uint8Array(1024);
    this.view = new DataView(this.bytes.buffer);
    this.length = 0;
  }

  reserve(size) {
    if (this.length + size <= this.bytes.length) return;
    let capacity = this.bytes.length;
    while (capacity < this.length + size) capacity *= 2;
    const bytes = new Uint8Array(capacity);
    bytes.set(this.bytes);
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer);
  }

  u8(value) {
    this.reserve(1);
    this.view.setUint8(this.length, value);
    this.length += 1;
  }

  u32(value) {
    this.reserve(4);
    this.view.setUint32(this.length, value, true);
    this.length += 4;
  }

  f64(value) {
    this.reserve(8);
    this.view.setFloat64(this.length, value, true);
    this.length += 8;
  }

  string(value) {
    const bytes = encoder.encode(value);
    this.u32(bytes.length);
    this.reserve(bytes.length);
    this.bytes.set(bytes, this.length);
    this.length += bytes.length;
  }

  value(value) {
    if (value === null || value === undefined) {
      this.u8(TAG.NULL);
    } else if (value === true || value === false) {
      this.u8(value ? TAG.TRUE : TAG.FALSE);
    } else if (typeof value === 'number') {
      this.u8(TAG.NUMBER);
      this.f64(value);
    } else if (typeof value === 'string') {
      this.u8(TAG.STRING);
      this.string(value);
    } else if (Array.isArray(value)) {
      if (value.length > 0 && value.every((item) => typeof item === 'number')) {
        this.u8(TAG.NUMBER_ARRAY);
        this.u32(value.length);
        for (const item of value) this.f64(item);
      } else {
        this.u8(TAG.ARRAY);
        this.u32(value.length);
        for (const item of value) this.value(item);
      }
    } else if (typeof value === 'object') {
      const entries = Object.entries(value);
      this.u8(TAG.OBJECT);
      this.u32(entries.length);
      for (const [key, item] of entries) {
        this.string(key);
        this.value(item);
      }
    } else {
      throw new TypeError(`Cannot save a value of type ${typeof value}.`);
    }
  }
}

class Reader {
  constructor(bytes) {
    this.bytes = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.offset = 0;
  }

  need(size) {
    if (this.offset + size > this.bytes.length) throw new Error('Save file is truncated.');
  }

  u8() {
    this.need(1);
    return this.view.getUint8(this.offset++);
  }

  u32() {
    this.need(4);
    const value = this.view.getUint32(this.offset, true);
    this.offset += 4;
    return value;
  }

  f64() {
    this.need(8);
    const value = this.view.getFloat64(this.offset, true);
    this.offset += 8;
    return value;
  }

  string() {
    const length = this.u32();
    this.need(length);
    const value = decoder.decode(this.bytes.subarray(this.offset, this.offset + length));
    this.offset += length;
    return value;
  }

  value() {
    const tag = this.u8();
    switch (tag) {
      case TAG.NULL:
        return null;
      case TAG.FALSE:
        return false;
      case TAG.TRUE:
        return true;
      case TAG.NUMBER:
        return this.f64();
      case TAG.STRING:
        return this.string();
      case TAG.NUMBER_ARRAY: {
        const length = this.u32();
        this.need(length * 8);
        return Array.from({ length }, () => this.f64());
      }
      case TAG.ARRAY: {
        const length = this.u32();
        return Array.from({ length }, () => this.value());
      }
      case TAG.OBJECT: {
        const count = this.u32();
        const result = {};
        for (let i = 0; i < count; i += 1) {
          const key = this.string();
          if (key === '__proto__') throw new Error('Save file is corrupted.');
          result[key] = this.value();
        }
        return result;
      }
      default:
        throw new Error('Save file is corrupted.');
    }
  }
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) {
    crc ^= bytes[i];
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

export function encodeSave(data) {
  const writer = new Writer();
  writer.value(data);
  const payload = writer.bytes.subarray(0, writer.length);

  const file = new Uint8Array(HEADER_SIZE + payload.length);
  const view = new DataView(file.buffer);
  file.set(MAGIC, 0);
  view.setUint16(8, SAVE_VERSION, true);
  view.setUint32(10, payload.length, true);
  view.setUint32(14, crc32(payload), true);
  file.set(payload, HEADER_SIZE);
  return file;
}

export function decodeSave(buffer) {
  const file = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  if (file.length < HEADER_SIZE || MAGIC.some((byte, i) => file[i] !== byte)) {
    throw new Error('This is not an Old Adam save file.');
  }

  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const version = view.getUint16(8, true);
  if (version !== SAVE_VERSION) {
    throw new Error(`Unsupported save version ${version}.`);
  }
  const length = view.getUint32(10, true);
  if (HEADER_SIZE + length !== file.length) throw new Error('Save file is truncated.');

  const payload = file.subarray(HEADER_SIZE);
  if (crc32(payload) !== view.getUint32(14, true)) throw new Error('Save file is corrupted.');
  return new Reader(payload).value();
}
