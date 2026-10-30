// Insert an iTXt chunk (UTF-8 text metadata) into a PNG buffer just before IEND.
// Used for the implicit AIGC label required for AI-generated images.

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buffer) {
  let crc = 0xffffffff;
  for (let i = 0; i < buffer.length; i++) crc = CRC_TABLE[(crc ^ buffer[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export function isPng(buffer) {
  return buffer.length > 8 && buffer.subarray(0, 8).equals(SIGNATURE);
}

export function addPngText(png, keyword, text) {
  if (!isPng(png)) throw new Error("Not a PNG buffer");
  if (!/^[\x20-\x7e]{1,79}$/.test(keyword)) throw new Error("Invalid PNG text keyword");
  // iTXt: keyword \0 compressionFlag(0) compressionMethod(0) languageTag \0 translatedKeyword \0 text
  const data = Buffer.concat([
    Buffer.from(keyword, "latin1"), Buffer.from([0, 0, 0, 0, 0]), Buffer.from(text, "utf8")
  ]);
  const type = Buffer.from("iTXt", "latin1");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([type, data])));
  const chunk = Buffer.concat([length, type, data, crc]);

  // Walk chunks to find IEND rather than trusting the last 12 bytes.
  let offset = 8;
  while (offset + 8 <= png.length) {
    const size = png.readUInt32BE(offset);
    const name = png.toString("latin1", offset + 4, offset + 8);
    if (name === "IEND") return Buffer.concat([png.subarray(0, offset), chunk, png.subarray(offset)]);
    offset += 12 + size;
  }
  throw new Error("PNG has no IEND chunk");
}

export function readPngTexts(png) {
  const out = {};
  let offset = 8;
  while (offset + 8 <= png.length) {
    const size = png.readUInt32BE(offset);
    const name = png.toString("latin1", offset + 4, offset + 8);
    const data = png.subarray(offset + 8, offset + 8 + size);
    if (name === "iTXt" || name === "tEXt") {
      const zero = data.indexOf(0);
      const keyword = data.toString("latin1", 0, zero);
      if (name === "tEXt") out[keyword] = data.toString("latin1", zero + 1);
      else {
        let p = zero + 3;
        p = data.indexOf(0, p) + 1;
        p = data.indexOf(0, p) + 1;
        out[keyword] = data.toString("utf8", p);
      }
    }
    if (name === "IEND") break;
    offset += 12 + size;
  }
  return out;
}
