import { Inflate } from "fflate"

/** A ZIP entry from the central directory, after its structure has been checked. */
export interface ZipEntry {
  name: string
  /** Unpacked size. Checked against the data while unpacking, so it can be trusted for budgets. */
  size: number
}

/** The archive is malformed or dishonest. The message is safe to show. */
export class ZipError extends Error {}

const EOCD = 0x06054b50
const CENTRAL = 0x02014b50
const LOCAL = 0x04034b50
const DESCRIPTOR = 0x08074b50
/** General-purpose flag: CRC and sizes follow the data, in a data descriptor. */
const DESCRIBED = 8
/** Compressed bytes fed to the inflater at a time: deflate expands at most about 1032:1, so one step yields at most about 1 MB. */
const STEP = 1024

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()
function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

interface Located extends ZipEntry {
  method: number
  crc: number
  /** Where the entry's local header starts, where its data starts and ends, and where its bytes end (data descriptor included). */
  header: number
  start: number
  end: number
  extent: number
}

/**
 * Reads a ZIP without trusting its headers. Every entry is located through the
 * central directory and its local header, and the archive is refused when:
 * - an offset or length points outside the archive or into the directory;
 * - two entries' headers or data overlap (one payload counted many times);
 * - a stored entry's sizes disagree, or an entry is encrypted, ZIP64, spans
 *   disks or uses a method other than stored or deflate;
 * - a local header's method, flags, CRC or sizes contradict the directory. With
 *   the data-descriptor flag, the local CRC and sizes may be zero (deferred),
 *   and the descriptor after the data must then match the directory;
 * - unpacked data is longer or shorter than declared, or fails its CRC.
 * `accept` sees every entry first, with its declared size, and returns whether
 * to unpack it; it may throw to refuse the archive. Only accepted entries are
 * unpacked, and inflating stops as soon as one passes its declared size, so a
 * budget enforced in `accept` bounds what is allocated.
 */
export function readZip(bytes: Uint8Array, { maxEntries, accept }: { maxEntries: number; accept: (entry: ZipEntry) => boolean }): Record<string, Uint8Array> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const u16 = (at: number) => view.getUint16(at, true)
  const u32 = (at: number) => view.getUint32(at, true)
  const within = (start: number, length: number, limit = bytes.length) => start >= 0 && length >= 0 && start + length <= limit
  /** Length of the data descriptor at `at` (signed or not) when it repeats `values` (CRC and sizes), or 0. */
  const descriptor = (at: number, values: number[], limit: number) => {
    const repeats = (from: number) => within(from, 12, limit) && values.every((v, j) => u32(from + 4 * j) === v)
    return within(at, 4, limit) && u32(at) === DESCRIPTOR && repeats(at + 4) ? 16 : repeats(at) ? 12 : 0
  }

  // The end-of-central-directory record: the last 22 bytes, or up to 64 KB earlier with a comment.
  let eocd = -1
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 22 - 0xffff); at--) {
    if (u32(at) === EOCD && at + 22 + u16(at + 20) === bytes.length) { eocd = at; break }
  }
  if (eocd < 0) throw new ZipError("This is not a ZIP file, or it is damaged")
  const count = u16(eocd + 10)
  const directorySize = u32(eocd + 12)
  const directory = u32(eocd + 16)
  if (u16(eocd + 4) !== 0 || u16(eocd + 6) !== 0 || u16(eocd + 8) !== count) throw new ZipError("ZIPs split across several files are not supported")
  if (count === 0xffff || directory === 0xffffffff || directorySize === 0xffffffff) throw new ZipError("ZIP64 archives are not supported")
  if (count > maxEntries) throw new ZipError("The ZIP has too many entries")
  if (!within(directory, directorySize, eocd)) throw new ZipError("The ZIP directory is damaged")

  const decode = new TextDecoder("utf-8", { fatal: true })
  const entries: Located[] = []
  const names = new Set<string>()
  let at = directory
  for (let i = 0; i < count; i++) {
    if (!within(at, 46, directory + directorySize) || u32(at) !== CENTRAL) throw new ZipError("The ZIP directory is damaged")
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16)
    const compressed = u32(at + 20), size = u32(at + 24)
    const nameLength = u16(at + 28), extraLength = u16(at + 30), commentLength = u16(at + 32)
    const disk = u16(at + 34), header = u32(at + 42)
    const next = at + 46 + nameLength + extraLength + commentLength
    if (next > directory + directorySize) throw new ZipError("The ZIP directory is damaged")
    let name: string
    try { name = decode.decode(bytes.subarray(at + 46, at + 46 + nameLength)) } catch { throw new ZipError("A file name in the ZIP is not valid text") }
    if (flags & 1) throw new ZipError("Encrypted ZIPs are not supported")
    if (disk !== 0 || compressed === 0xffffffff || size === 0xffffffff || header === 0xffffffff) throw new ZipError("ZIP64 archives are not supported")
    if (method !== 0 && method !== 8) throw new ZipError(`Unsupported compression in the ZIP: ${name.slice(0, 120)}`)
    if (method === 0 && compressed !== size) throw new ZipError(`The ZIP misstates the size of ${name.slice(0, 120)}`)
    if (names.has(name)) throw new ZipError(`The ZIP lists ${name.slice(0, 120)} twice`)
    names.add(name)
    // The local header must agree with the directory, and the data must sit before the directory.
    if (!within(header, 30, directory) || u32(header) !== LOCAL || u16(header + 8) !== method) throw new ZipError(`The ZIP entry ${name.slice(0, 120)} is damaged`)
    const localName = u16(header + 26), localExtra = u16(header + 28)
    if (localName !== nameLength || !bytes.subarray(header + 30, header + 30 + localName).every((b, j) => b === bytes[at + 46 + j])) throw new ZipError(`The ZIP entry ${name.slice(0, 120)} is damaged`)
    const start = header + 30 + localName + localExtra
    if (!within(start, compressed, directory)) throw new ZipError(`The ZIP entry ${name.slice(0, 120)} points outside the archive`)
    // Local flags, CRC and sizes must say what the directory says; descriptors may defer them as zeros.
    const local = [u32(header + 14), u32(header + 18), u32(header + 22)], central = [crc, compressed, size]
    const deferred = flags & DESCRIBED
    if (u16(header + 6) !== flags || local.some((v, j) => v !== central[j] && !(deferred && v === 0))) throw new ZipError(`The ZIP entry ${name.slice(0, 120)} has a local header that contradicts the directory`)
    const end = start + compressed
    const described = deferred ? descriptor(end, central, directory) : 0
    if (deferred && !described) throw new ZipError(`The ZIP entry ${name.slice(0, 120)} has a missing or contradictory data descriptor`)
    entries.push({ name, size, method, crc, header, start, end, extent: end + described })
    at = next
  }
  // No two entries may share bytes: each payload is read, and counted, once.
  const spans = entries.slice().sort((a, b) => a.header - b.header)
  for (let i = 1; i < spans.length; i++) if (spans[i].header < spans[i - 1].extent) throw new ZipError("Entries in the ZIP overlap")

  const files: Record<string, Uint8Array> = {}
  for (const entry of entries) {
    if (!accept({ name: entry.name, size: entry.size })) continue
    const data = entry.method === 0 ? bytes.slice(entry.start, entry.end) : inflate(bytes.subarray(entry.start, entry.end), entry.size, entry.name)
    if (crc32(data) !== entry.crc) throw new ZipError(`The ZIP entry ${entry.name.slice(0, 120)} is damaged`)
    files[entry.name] = data
  }
  return files
}

/** Inflate in small steps, stopping as soon as the output passes `size`. */
function inflate(compressed: Uint8Array, size: number, name: string): Uint8Array {
  const out = new Uint8Array(size)
  let written = 0
  const inflater = new Inflate((chunk) => {
    if (written + chunk.length > size) throw new ZipError(`The ZIP misstates the size of ${name.slice(0, 120)}`)
    out.set(chunk, written)
    written += chunk.length
  })
  try {
    for (let i = 0; i < compressed.length; i += STEP) inflater.push(compressed.subarray(i, i + STEP), i + STEP >= compressed.length)
    if (!compressed.length) inflater.push(compressed, true)
  } catch (e) {
    if (e instanceof ZipError) throw e
    throw new ZipError(`The ZIP entry ${name.slice(0, 120)} cannot be unpacked`)
  }
  if (written !== size) throw new ZipError(`The ZIP misstates the size of ${name.slice(0, 120)}`)
  return out
}
