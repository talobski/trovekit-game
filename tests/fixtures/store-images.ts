// Helper process for tests/assets.test.ts: store each image from a payload file into a data directory.
import { readFileSync } from "node:fs"
import { storeImage } from "../../server/assets.ts"

const [dataDir, payload] = process.argv.slice(2)
const images = JSON.parse(readFileSync(payload, "utf8")) as { src: string; bytes: string }[]
for (let round = 0; round < 5; round++) for (const image of images) storeImage(dataDir, { src: image.src, bytes: Buffer.from(image.bytes, "base64") })
