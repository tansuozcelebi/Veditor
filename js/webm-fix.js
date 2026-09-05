// ===================== WebM duration patcher =====================
// MediaRecorder writes WebM files without a Duration element (the Segment has an unknown size),
// so players cannot show the total length or seek. This module injects a Duration element
// into the Segment Info header and patches SeekHead offsets. Only the header region is read.

const ID_EBML = 0x1a45dfa3, ID_SEGMENT = 0x18538067, ID_SEEKHEAD = 0x114d9b74, ID_INFO = 0x1549a966,
  ID_CLUSTER = 0x1f43b675, ID_CUES = 0x1c53bb6b, ID_TIMECODESCALE = 0x2ad7b1, ID_DURATION = 0x4489,
  ID_SEEK = 0x4dbb, ID_SEEKPOSITION = 0x53ac;

function readId(b, p) {
  const first = b[p];
  let len = 1;
  if (first & 0x80) len = 1; else if (first & 0x40) len = 2; else if (first & 0x20) len = 3; else if (first & 0x10) len = 4; else throw new Error('bad id');
  let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[p + i];
  return { id: v, len };
}
function readSize(b, p) {
  const first = b[p];
  let len = 1, mask = 0x80;
  while (len <= 8 && !(first & mask)) { len++; mask >>= 1; }
  if (len > 8) throw new Error('bad size');
  let v = first & (mask - 1), allOnes = v === mask - 1;
  for (let i = 1; i < len; i++) { v = v * 256 + b[p + i]; if (b[p + i] !== 0xff) allOnes = false; }
  return { size: v, len, unknown: allOnes };
}
function encodeSize(v, len) {
  const out = new Uint8Array(len);
  for (let i = len - 1; i >= 0; i--) { out[i] = v & 0xff; v = Math.floor(v / 256); }
  out[0] |= 0x80 >> (len - 1);
  return out;
}
function readUint(b, p, len) { let v = 0; for (let i = 0; i < len; i++) v = v * 256 + b[p + i]; return v; }

/**
 * @param {Blob} blob   WebM blob produced by MediaRecorder
 * @param {number} durationSec
 * @returns {Promise<Blob>} patched blob (or the original if patching is not possible)
 */
export async function fixWebmDuration(blob, durationSec) {
  try {
    const headLen = Math.min(blob.size, 2 * 1024 * 1024);
    const b = new Uint8Array(await blob.slice(0, headLen).arrayBuffer());
    let p = 0;
    // EBML header
    let { id, len } = readId(b, p); if (id !== ID_EBML) return blob;
    p += len; let sz = readSize(b, p); p += sz.len + sz.size;
    // Segment
    ({ id, len } = readId(b, p)); if (id !== ID_SEGMENT) return blob;
    p += len; sz = readSize(b, p); p += sz.len;
    const segDataStart = p;
    let infoPos = -1, infoHeaderLen = 0, infoDataLen = 0, seekHead = null, clusterPos = -1, timecodeScale = 1000000, durationPos = -1, durationLen = 0;
    while (p < b.length) {
      const idr = readId(b, p); const szr = readSize(b, p + idr.len);
      const dataStart = p + idr.len + szr.len;
      if (idr.id === ID_CLUSTER) { clusterPos = p; break; }
      if (idr.id === ID_CUES) return blob; // cues before clusters: not produced by MediaRecorder, bail out
      if (szr.unknown) return blob;
      if (idr.id === ID_SEEKHEAD) seekHead = { pos: p, dataStart, dataLen: szr.size };
      if (idr.id === ID_INFO) {
        infoPos = p; infoHeaderLen = idr.len + szr.len; infoDataLen = szr.size;
        let q = dataStart;
        while (q < dataStart + szr.size) {
          const cid = readId(b, q); const csz = readSize(b, q + cid.len);
          const cds = q + cid.len + csz.len;
          if (cid.id === ID_TIMECODESCALE) timecodeScale = readUint(b, cds, csz.size);
          if (cid.id === ID_DURATION) { durationPos = cds; durationLen = csz.size; }
          q = cds + csz.size;
        }
      }
      p = dataStart + szr.size;
    }
    if (infoPos < 0 || clusterPos < 0) return blob;
    const ticks = (durationSec * 1e9) / timecodeScale;
    const view = new DataView(b.buffer);
    if (durationPos >= 0) {
      if (durationLen === 8) view.setFloat64(durationPos, ticks); else if (durationLen === 4) view.setFloat32(durationPos, ticks); else return blob;
      return new Blob([b, blob.slice(headLen)], { type: blob.type });
    }
    // Build Duration element: ID(2) + size(1) + float64(8)
    const durEl = new Uint8Array(11);
    durEl[0] = 0x44; durEl[1] = 0x89; durEl[2] = 0x88;
    new DataView(durEl.buffer).setFloat64(3, ticks);
    const oldSizeLen = infoHeaderLen - 4; // Info ID is 4 bytes
    const newDataLen = infoDataLen + durEl.length;
    let newSizeLen = oldSizeLen;
    if (newDataLen >= Math.pow(2, 7 * newSizeLen) - 1) newSizeLen++;
    const delta = durEl.length + (newSizeLen - oldSizeLen);
    const infoDataStart = infoPos + infoHeaderLen;
    const infoEnd = infoDataStart + infoDataLen;
    const out = new Uint8Array(b.length + delta);
    let o = 0;
    out.set(b.subarray(0, infoPos + 4), o); o += infoPos + 4;
    out.set(encodeSize(newDataLen, newSizeLen), o); o += newSizeLen;
    out.set(b.subarray(infoDataStart, infoEnd), o); o += infoDataLen;
    out.set(durEl, o); o += durEl.length;
    out.set(b.subarray(infoEnd), o);
    // Patch SeekHead positions pointing past Info (positions are relative to segment data start).
    if (seekHead) {
      const infoRel = infoPos - segDataStart;
      const ov = new DataView(out.buffer);
      let q = seekHead.dataStart;
      const end = seekHead.dataStart + seekHead.dataLen;
      while (q < end) {
        const sid = readId(out, q); const ssz = readSize(out, q + sid.len);
        const sds = q + sid.len + ssz.len;
        if (sid.id === ID_SEEK) {
          let r = sds;
          while (r < sds + ssz.size) {
            const eid = readId(out, r); const esz = readSize(out, r + eid.len);
            const eds = r + eid.len + esz.len;
            if (eid.id === ID_SEEKPOSITION) {
              const val = readUint(out, eds, esz.size);
              if (val > infoRel) {
                const nv = val + delta;
                if (nv >= Math.pow(2, 8 * esz.size)) return blob; // would not fit; give up safely
                let tmp = nv; for (let i = esz.size - 1; i >= 0; i--) { ov.setUint8(eds + i, tmp & 0xff); tmp = Math.floor(tmp / 256); }
              }
            }
            r = eds + esz.size;
          }
        }
        q = sds + ssz.size;
      }
    }
    return new Blob([out, blob.slice(headLen)], { type: blob.type });
  } catch (e) {
    console.warn('webm duration fix skipped:', e);
    return blob;
  }
}
