const u32 = (n: number) => {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n);
  return b;
};
const u16 = (n: number) => {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n);
  return b;
};
const box = (type: string, ...parts: Buffer[]) => {
  const body = Buffer.concat(parts);
  return Buffer.concat([
    u32(8 + body.length),
    Buffer.from(type, "ascii"),
    body,
  ]);
};

export function png(width: number, height: number): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.concat([
    u32(width),
    u32(height),
    Buffer.from([8, 2, 0, 0, 0]),
  ]);
  return Buffer.concat([sig, u32(13), Buffer.from("IHDR"), ihdr, u32(0)]);
}

export function jpeg(width: number, height: number): Buffer {
  const app0 = Buffer.concat([
    Buffer.from([0xff, 0xe0]),
    u16(16),
    Buffer.from("JFIF\0", "ascii"),
    Buffer.from([1, 1, 0, 0, 1, 0, 1, 0, 0]),
  ]);
  const sof = Buffer.concat([
    Buffer.from([0xff, 0xc0]),
    u16(17),
    Buffer.from([8]),
    u16(height),
    u16(width),
    Buffer.from([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]),
  ]);
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    app0,
    sof,
    Buffer.from([0xff, 0xd9]),
  ]);
}

export function mp4(o: {
  timescaleMs: number;
  durationMs: number;
  moovAtEnd: boolean;
  mdatBytes: number;
}): Buffer {
  const ftyp = box("ftyp", Buffer.from("isom"), u32(0), Buffer.from("isom"));
  const mvhd = box(
    "mvhd",
    Buffer.alloc(4), // version 0 + flags
    u32(0),
    u32(0),
    u32(o.timescaleMs),
    u32((o.durationMs * o.timescaleMs) / 1000),
    Buffer.alloc(80),
  );
  const moov = box("moov", mvhd);
  const mdat = box("mdat", Buffer.alloc(o.mdatBytes));
  return Buffer.concat(o.moovAtEnd ? [ftyp, mdat, moov] : [ftyp, moov, mdat]);
}
