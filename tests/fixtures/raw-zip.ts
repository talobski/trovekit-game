import { Zip, ZipDeflate } from "fflate"

/**
 * A minimal ZIP writer for archives no ordinary tool would make: every header
 * field and offset is under the test's control.
 */
export interface Raw { name: string; data: Uint8Array; method?: 0 | 8; size?: number; compressed?: number; crc?: number; header?: number; flags?: number }
export function crc32(bytes: Uint8Array) {
  let c = 0xffffffff
  for (const b of bytes) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1 }
  return (c ^ 0xffffffff) >>> 0
}
export function localHeader(name: string, data: Uint8Array, crc = crc32(data), size = data.length, { compressed = data.length, flags = 0 } = {}) {
  const n = Buffer.from(name)
  const h = Buffer.alloc(30)
  h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(flags, 6); h.writeUInt16LE(0, 8)
  h.writeUInt32LE(crc, 14); h.writeUInt32LE(compressed, 18); h.writeUInt32LE(size, 22); h.writeUInt16LE(n.length, 26)
  return Buffer.concat([h, n, data])
}
/** The data descriptor that follows an entry's data when its flags include 8, with or without its optional signature. */
export function dataDescriptor(crc: number, compressed: number, size: number, signed = true) {
  const d = Buffer.alloc(12)
  d.writeUInt32LE(crc, 0); d.writeUInt32LE(compressed, 4); d.writeUInt32LE(size, 8)
  return signed ? Buffer.concat([Buffer.from([0x50, 0x4b, 0x07, 0x08]), d]) : d
}
/** `locals` is the raw bytes before the directory; `central` describes entries, each pointing at a header offset. */
export function rawZip(locals: Buffer, central: (Required<Pick<Raw, "name" | "header" | "compressed" | "size" | "crc">> & Pick<Raw, "flags">)[]) {
  const records = central.map((e) => {
    const n = Buffer.from(e.name)
    const r = Buffer.alloc(46)
    r.writeUInt32LE(0x02014b50, 0); r.writeUInt16LE(20, 4); r.writeUInt16LE(20, 6); r.writeUInt16LE(e.flags ?? 0, 8); r.writeUInt16LE(0, 10)
    r.writeUInt32LE(e.crc, 16); r.writeUInt32LE(e.compressed, 20); r.writeUInt32LE(e.size, 24); r.writeUInt16LE(n.length, 28); r.writeUInt32LE(e.header, 42)
    return Buffer.concat([r, n])
  })
  const directory = Buffer.concat(records)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(central.length, 8); end.writeUInt16LE(central.length, 10)
  end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(locals.length, 16)
  return Buffer.concat([locals, directory, end])
}

/** A real streaming writer's archive: deflated, with each entry's CRC and sizes deferred to a signed data descriptor. */
export function streamedZip(files: Record<string, Uint8Array>) {
  const chunks: Uint8Array[] = []
  const archive = new Zip((error, chunk) => { if (error) throw error; chunks.push(chunk) })
  for (const [name, data] of Object.entries(files)) {
    const entry = new ZipDeflate(name, { level: 6 })
    archive.add(entry)
    entry.push(data, true)
  }
  archive.end()
  return Buffer.concat(chunks)
}
