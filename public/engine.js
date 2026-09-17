/**
 * MP4 Patch Engine — edit this file in GitHub to update the patcher.
 * Redeploy on Vercel after changes (or rely on auto-deploy from main).
 */
const ENCODER_TAG = 'TikQuick Quality Method - https://tikquick.online/ - v19';
const CONTAINERS = new Set(['moov', 'trak', 'edts', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst', 'dinf']);
const PERCENT = 10.0;
const POISON_SAMPLE_SIZE = 8;
const POISON_FIRST = false;

function fourCC(name) {
  if (name instanceof Uint8Array) return name.subarray(0, 4);
  const b = new Uint8Array(4);
  const str = String(name);
  for (let i = 0; i < 4; i++) b[i] = i < str.length ? str.charCodeAt(i) & 0xff : 0x20;
  return b;
}

function readName(bytes, offset) {
  return String.fromCharCode(bytes[offset + 4], bytes[offset + 5], bytes[offset + 6], bytes[offset + 7]);
}

function readU32(buf, off) {
  return new DataView(buf.buffer, buf.byteOffset + off, 4).getUint32(0, false);
}

function readU64(buf, off) {
  return new DataView(buf.buffer, buf.byteOffset + off, 8).getBigUint64(0, false);
}

function concatBytes(...parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) { out.set(p, off); off += p.length; }
  return out;
}

function parseBoxes(data) {
  const boxes = [];
  let i = 0;
  while (i + 8 <= data.length) {
    let size = readU32(data, i);
    const name = readName(data, i);
    let headerLen = 8;
    if (size === 1) {
      if (i + 16 > data.length) break;
      size = Number(readU64(data, i + 8));
      headerLen = 16;
    } else if (size === 0) {
      size = data.length - i;
    }
    if (size < headerLen || i + size > data.length) break;
    const boxData = data.subarray(i + headerLen, i + size);
    if (CONTAINERS.has(name)) {
      boxes.push({ name, children: parseBoxes(boxData), data: null });
    } else {
      boxes.push({ name, children: [], data: boxData.slice() });
    }
    i += size;
  }
  return boxes;
}

function buildBoxes(boxes) {
  const chunks = [];
  for (const b of boxes) {
    const body = b.children?.length ? buildBoxes(b.children) : (b.data || new Uint8Array(0));
    const size = body.length + 8;
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, size, false);
    header.set(fourCC(b.name), 4);
    chunks.push(header, body);
  }
  return concatBytes(...chunks);
}

function findBox(boxes, path) {
  if (!path.length) return [boxes];
  const result = [];
  for (const b of boxes) {
    if (b.name === path[0]) {
      if (path.length === 1) result.push(b);
      else result.push(...findBox(b.children, path.slice(1)));
    }
  }
  return result;
}

function requireBox(boxes, path) {
  const found = findBox(boxes, path);
  if (!found || !found.length) throw new Error(`Required atom path '${path.join('/')}' not found.`);
  return found[0];
}

function walkBoxesOffset(boxes, visitor) {
  for (const box of boxes) {
    visitor(box);
    if (box.children?.length) walkBoxesOffset(box.children, visitor);
  }
}

function snapshotChunkOffsetBoxes(moovBoxes) {
  const snapshots = [];
  walkBoxesOffset(moovBoxes, (box) => {
    if (box.name !== 'stco' && box.name !== 'co64') return;
    const isCo64 = box.name === 'co64';
    const width = isCo64 ? 8 : 4;
    if (!box.data || box.data.length < 8) throw new Error(`Malformed ${box.name} box.`);
    const count = readU32(box.data, 4);
    if (8 + count * width > box.data.length) throw new Error(`Truncated ${box.name} box.`);
    const offsets = Array.from({ length: count }, (_, index) =>
      isCo64 ? Number(readU64(box.data, 8 + index * 8)) : readU32(box.data, 8 + index * 4)
    );
    snapshots.push({ box, originalName: box.name, offsets });
  });
  return snapshots;
}

function applyChunkOffsetShift(snapshots, shift) {
  for (const snapshot of snapshots) {
    const offsets = snapshot.offsets.map((offset) => offset + shift);
    const isCo64 = snapshot.originalName === 'co64' || Math.max(...offsets, 0) > 0xffffffff;
    snapshot.box.name = isCo64 ? 'co64' : 'stco';
    const width = isCo64 ? 8 : 4;
    const data = new Uint8Array(8 + offsets.length * width);
    const view = new DataView(data.buffer);
    view.setUint32(4, offsets.length, false);
    offsets.forEach((offset, index) => {
      if (isCo64) view.setBigUint64(8 + index * 8, BigInt(offset), false);
      else view.setUint32(8 + index * 4, offset >>> 0, false);
    });
    snapshot.box.data = data;
  }
}

function purgeAllEdtsBoxes(boxes) {
  const cleaned = boxes.filter((box) => box.name !== 'edts');
  for (const box of cleaned) {
    if (box.children?.length) box.children = purgeAllEdtsBoxes(box.children);
  }
  return cleaned;
}

function cloneBoxTree(box) {
  return {
    name: box.name,
    data: box.data ? box.data.slice() : null,
    children: (box.children || []).map(cloneBoxTree),
  };
}

function getTrackId(data) {
  const offset = data?.[0] === 1 ? 20 : 12;
  if (!data || data.length < offset + 4) throw new Error("Malformed 'tkhd' track ID.");
  return readU32(data, offset);
}

function setTrackId(data, trackId) {
  const output = data.slice();
  const offset = output[0] === 1 ? 20 : 12;
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset, trackId, false);
  return output;
}

function getNextTrackId(data) {
  const offset = data?.[0] === 1 ? 108 : 96;
  if (!data || data.length < offset + 4) throw new Error("Malformed 'mvhd' next track ID.");
  return readU32(data, offset);
}

function setNextTrackId(data, trackId) {
  const output = data.slice();
  const offset = output[0] === 1 ? 108 : 96;
  new DataView(output.buffer, output.byteOffset, output.byteLength).setUint32(offset, trackId, false);
  return output;
}

function findAudioTrak(moovBoxes) {
  const traks = findBox(moovBoxes, ['trak']);
  for (const trak of traks) {
    const hdlr = findBox(trak.children, ['mdia', 'hdlr']);
    if (
      hdlr.length && hdlr[0].data && hdlr[0].data.length >= 12 &&
      String.fromCharCode(hdlr[0].data[8], hdlr[0].data[9], hdlr[0].data[10], hdlr[0].data[11]) === 'soun'
    ) return trak;
  }
  return null;
}

function findVideoTrak(moovBoxes) {
  const traks = findBox(moovBoxes, ['trak']);
  for (const trak of traks) {
    const hdlr = findBox(trak.children, ['mdia', 'hdlr']);
    if (
      hdlr.length && hdlr[0].data && hdlr[0].data.length >= 12 &&
      String.fromCharCode(hdlr[0].data[8], hdlr[0].data[9], hdlr[0].data[10], hdlr[0].data[11]) === 'vide'
    ) return trak;
  }
  return null;
}

function patchMdhdLangBox(box) {
  if (!box.data) return;
  const p = box.data.slice();
  const version = p[0];
  const langOffset = version === 1 ? 32 : 20;
  if (langOffset + 2 <= p.length) {
    p[langOffset] = (21956 >> 8) & 0xff;
    p[langOffset + 1] = 21956 & 0xff;
  }
  box.data = p;
}

function patchHdlrNameBox(box) {
  if (!box.data || box.data.length < 12) return;
  const p = box.data;
  const handlerType = String.fromCharCode(p[8], p[9], p[10], p[11]);
  let name;
  if (handlerType === 'vide') name = 'VideoHandler';
  else if (handlerType === 'soun') name = 'SoundHandler';
  else return;

  const nameBytes = new TextEncoder().encode(name);
  const newPayload = new Uint8Array(24 + nameBytes.length + 1);
  newPayload.set(p.subarray(0, 24), 0);
  newPayload.set(nameBytes, 24);
  newPayload[24 + nameBytes.length] = 0;
  box.data = newPayload;
}

function makeUdtaWithEncoderBox() {
  const tagBytes = new TextEncoder().encode(ENCODER_TAG);
  // data box payload: type(4)=1, locale(4)=0, string + null
  const dataPayload = new Uint8Array(8 + tagBytes.length + 1);
  new DataView(dataPayload.buffer).setUint32(0, 1, false);
  new DataView(dataPayload.buffer).setUint32(4, 0, false);
  dataPayload.set(tagBytes, 8);
  dataPayload[8 + tagBytes.length] = 0;

  function atom(name, payload) {
    const header = new Uint8Array(8);
    new DataView(header.buffer).setUint32(0, payload.length + 8, false);
    header.set(fourCC(name), 4);
    return concatBytes(header, payload);
  }

  const dataBox = atom('data', dataPayload);
  const ctooBox = atom('\xA9too', dataBox);
  const ilstBox = atom('ilst', ctooBox);

  const hdlrPayload = new Uint8Array(25);
  hdlrPayload.set(fourCC('mdir'), 8);
  hdlrPayload[24] = 0x00;
  const hdlrBox = atom('hdlr', hdlrPayload);

  const metaPayload = concatBytes(new Uint8Array(4), hdlrBox, ilstBox);
  const metaBox = atom('meta', metaPayload);

  // Return as a leaf-ish udta whose data is the whole meta box bytes
  // (matches original structure where udta wraps meta)
  return { name: 'udta', children: [], data: metaBox };
}

function applyWatermark(moovBoxes, videoTrak) {
  const moovUdtaIdx = moovBoxes.findIndex(c => c.name === 'udta');
  if (moovUdtaIdx >= 0) moovBoxes.splice(moovUdtaIdx, 1);

  const traks = moovBoxes.filter(c => c.name === 'trak');
  for (const trak of traks) {
    const isVideo = trak === videoTrak;
    if (isVideo) {
      const udtaIdx = trak.children.findIndex(c => c.name === 'udta');
      const newUdta = makeUdtaWithEncoderBox();
      if (udtaIdx >= 0) trak.children[udtaIdx] = newUdta;
      else trak.children.push(newUdta);
    } else {
      trak.children = trak.children.filter(c => c.name !== 'udta');
    }

    const mdia = findBox(trak.children, ['mdia'])[0];
    if (mdia && mdia.children) {
      const mdhd = mdia.children.find(c => c.name === 'mdhd');
      if (mdhd) patchMdhdLangBox(mdhd);
      const hdlr = mdia.children.find(c => c.name === 'hdlr');
      if (hdlr) patchHdlrNameBox(hdlr);
    }
  }
}

/**
 * Main patcher — returns Uint8Array of patched MP4
 */
function patch(inputBytes) {
  const raw = inputBytes instanceof Uint8Array ? inputBytes : new Uint8Array(inputBytes);
  if (raw.length < 16) throw new Error('File is too small to be a valid MP4.');

  // Top-level box scan
  const topBoxes = [];
  let i = 0;
  while (i < raw.length) {
    if (i + 8 > raw.length) break;
    let size = readU32(raw, i);
    const name = readName(raw, i);
    if (size === 1) {
      if (i + 16 > raw.length) throw new Error('Truncated 64-bit box header.');
      size = Number(readU64(raw, i + 8));
    } else if (size === 0) {
      size = raw.length - i;
    }
    if (size < 8 || i + size > raw.length) throw new Error(`Malformed top-level box '${name}'.`);
    topBoxes.push({ name, offset: i, size });
    i += size;
  }

  const moovCandidates = topBoxes.filter((b) => b.name === 'moov');
  const mdatCandidates = topBoxes.filter((b) => b.name === 'mdat');
  if (!moovCandidates.length || !mdatCandidates.length) {
    throw new Error("Mandatory atoms ('moov' or 'mdat') missing.");
  }

  const moovEntry = moovCandidates[0];
  const mdatEntry = mdatCandidates[0];
  const mdatOff = mdatEntry.offset;
  const mdatSize = mdatEntry.size;
  const moovOff = moovEntry.offset;
  const moovSize = moovEntry.size;
  const tailEdge = Math.max(mdatOff + mdatSize, moovOff + moovSize);
  const minOffset = Math.min(mdatOff, moovOff);

  const prefixBoxes = topBoxes.filter(
    (b) => b.name !== 'moov' && b.name !== 'mdat' && b.name !== 'free' && b.offset < minOffset
  );
  const trailerBoxes = topBoxes.filter(
    (b) => b.name !== 'moov' && b.name !== 'mdat' && b.offset >= tailEdge
  );

  const prefixBytes = concatBytes(...prefixBoxes.map((b) => raw.subarray(b.offset, b.offset + b.size)));
  const trailerBytes = concatBytes(...trailerBoxes.map((b) => raw.subarray(b.offset, b.offset + b.size)));

  const moovRaw = raw.subarray(moovOff + 8, moovOff + moovSize);
  let moovBoxes = parseBoxes(moovRaw);
  if (!moovBoxes.length) throw new Error("'moov' box is empty or failed to parse.");

  const sourceAudioTrak = findAudioTrak(moovBoxes);
  if (!sourceAudioTrak) throw new Error("No audio track ('soun' handler) found in moov.");

  const videoTrak = findVideoTrak(moovBoxes);
  if (!videoTrak) throw new Error("No video track ('vide' handler) found in moov.");

  // 1. Watermark
  applyWatermark(moovBoxes, videoTrak);

  // 2. Duplicate audio track
  const audioTrak = cloneBoxTree(sourceAudioTrak);
  const mvhd = requireBox(moovBoxes, ['mvhd']);
  const traks = findBox(moovBoxes, ['trak']);
  const existingIds = traks.map((trak) => getTrackId(requireBox(trak.children, ['tkhd']).data));
  const newTrackId = Math.max(...existingIds, getNextTrackId(mvhd.data) - 1) + 1;
  const copiedTkhd = requireBox(audioTrak.children, ['tkhd']);
  copiedTkhd.data = setTrackId(copiedTkhd.data, newTrackId);
  mvhd.data = setNextTrackId(mvhd.data, newTrackId + 1);

  const sourceTrackIndex = moovBoxes.indexOf(sourceAudioTrak);
  if (sourceTrackIndex < 0) throw new Error('Source audio track is not a direct moov child.');
  moovBoxes.splice(sourceTrackIndex + 1, 0, audioTrak);

  // 3. Purge edts
  moovBoxes = purgeAllEdtsBoxes(moovBoxes);

  // 4. Mutate duplicate track sample tables
  const stbl = requireBox(audioTrak.children, ['mdia', 'minf', 'stbl']);
  const stsz = requireBox(stbl.children, ['stsz']);
  const stsc = requireBox(stbl.children, ['stsc']);
  const stts = requireBox(stbl.children, ['stts']);
  const mdhd = requireBox(audioTrak.children, ['mdia', 'mdhd']);
  const stcoRes = findBox(stbl.children, ['stco']);
  const co64Res = findBox(stbl.children, ['co64']);
  if (!stcoRes.length && !co64Res.length) {
    throw new Error("Audio track missing chunk offset tables ('stco'/'co64').");
  }
  const audioStcoBox = stcoRes.length ? stcoRes[0] : co64Res[0];

  if (!stsz.data || stsz.data.length < 12) throw new Error("Malformed 'stsz' box.");
  const sampleSize = readU32(stsz.data, 4);
  const realFrames = readU32(stsz.data, 8);
  if (sampleSize !== 0) throw new Error('Constant-size stsz not supported.');
  if (realFrames === 0) throw new Error('Audio track has zero samples.');

  const ratio = 100.0 / PERCENT;
  const totalFrames = Math.floor(realFrames * ratio);
  const fakeFrames = totalFrames - realFrames;
  if (fakeFrames <= 0) throw new Error(`Track too short for PERCENT=${PERCENT}.`);

  // stsz poison sizes
  const realSizes = [];
  for (let idx = 0; idx < realFrames; idx++) realSizes.push(readU32(stsz.data, 12 + idx * 4));
  const fakeSizes = Array(fakeFrames).fill(POISON_SAMPLE_SIZE);
  const sizes = POISON_FIRST ? [...fakeSizes, ...realSizes] : [...realSizes, ...fakeSizes];

  const newStszData = new Uint8Array(12 + sizes.length * 4);
  newStszData.set(stsz.data.subarray(0, 4), 0);
  const stszDv = new DataView(newStszData.buffer);
  stszDv.setUint32(4, 0, false);
  stszDv.setUint32(8, sizes.length, false);
  for (let idx = 0; idx < sizes.length; idx++) stszDv.setUint32(12 + idx * 4, sizes[idx] >>> 0, false);
  stsz.data = newStszData;

  // stts timing
  const sttsData = stts.data;
  if (!sttsData || sttsData.length < 8) throw new Error("Malformed 'stts' box.");
  const sttsCount = readU32(sttsData, 4);
  if (8 + sttsCount * 8 > sttsData.length) throw new Error("Truncated 'stts' box.");
  const newSttsData = new Uint8Array(8 + (sttsCount + 1) * 8);
  newSttsData.set(sttsData.subarray(0, 4), 0);
  const sttsDv = new DataView(newSttsData.buffer);
  sttsDv.setUint32(4, sttsCount + 1, false);
  if (POISON_FIRST) {
    sttsDv.setUint32(8, fakeFrames, false);
    sttsDv.setUint32(12, 1, false);
    newSttsData.set(sttsData.subarray(8, 8 + sttsCount * 8), 16);
  } else {
    newSttsData.set(sttsData.subarray(8, 8 + sttsCount * 8), 8);
    sttsDv.setUint32(8 + sttsCount * 8, fakeFrames, false);
    sttsDv.setUint32(12 + sttsCount * 8, 1, false);
  }
  stts.data = newSttsData;

  let totalUnits = 0n;
  for (let idx = 0; idx < sttsCount + 1; idx++) {
    const count = readU32(newSttsData, 8 + idx * 8);
    const delta = readU32(newSttsData, 12 + idx * 8);
    totalUnits += BigInt(count) * BigInt(delta);
  }
  if (!mdhd.data || mdhd.data.length < 20) throw new Error("Malformed 'mdhd' box.");
  const mdhdData = mdhd.data.slice();
  const mdhdView = new DataView(mdhdData.buffer, mdhdData.byteOffset, mdhdData.byteLength);
  if (mdhdData[0] === 1) {
    if (mdhdData.length < 32) throw new Error("Truncated version-1 'mdhd' box.");
    mdhdView.setBigUint64(24, totalUnits, false);
  } else {
    if (totalUnits > 0xffffffffn) throw new Error("Version-0 'mdhd' duration overflow.");
    mdhdView.setUint32(16, Number(totalUnits), false);
  }
  mdhd.data = mdhdData;

  // stsc poison chunk
  const stscData = stsc.data;
  if (!stscData || stscData.length < 8) throw new Error("Malformed 'stsc' box.");
  const stscCnt = readU32(stscData, 4);
  const entries = [];
  for (let idx = 0; idx < stscCnt; idx++) {
    entries.push([
      readU32(stscData, 8 + idx * 12),
      readU32(stscData, 12 + idx * 12),
      readU32(stscData, 16 + idx * 12),
    ]);
  }
  const realChunkCount = readU32(audioStcoBox.data, 4);
  const lastDesc = entries.length ? entries[entries.length - 1][2] : 1;
  if (POISON_FIRST) {
    const firstDesc = entries.length ? entries[0][2] : lastDesc;
    for (const entry of entries) entry[0] += 1;
    entries.unshift([1, fakeFrames, firstDesc]);
  } else {
    entries.push([realChunkCount + 1, fakeFrames, lastDesc]);
  }
  const newStscData = new Uint8Array(8 + entries.length * 12);
  newStscData.set(stscData.subarray(0, 4), 0);
  const stscDv = new DataView(newStscData.buffer);
  stscDv.setUint32(4, entries.length, false);
  for (let idx = 0; idx < entries.length; idx++) {
    stscDv.setUint32(8 + idx * 12, entries[idx][0] >>> 0, false);
    stscDv.setUint32(12 + idx * 12, entries[idx][1] >>> 0, false);
    stscDv.setUint32(16 + idx * 12, entries[idx][2] >>> 0, false);
  }
  stsc.data = newStscData;

  // Poison payload (8 bytes per fake frame)
  const poisonUnit = new Uint8Array([0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00, 0x00]);
  const poisonBlob = new Uint8Array(fakeFrames * 8);
  for (let idx = 0; idx < fakeFrames; idx++) poisonBlob.set(poisonUnit, idx * 8);

  // Snapshot all chunk offsets before we change layout
  const snapshots = snapshotChunkOffsetBoxes(moovBoxes);

  // Rebuild mdat with poison appended (or prepended)
  // Original mdat payload is after the 8-byte header
  const mdatPayload = raw.subarray(mdatOff + 8, mdatOff + mdatSize);
  let newMdatPayload;
  if (POISON_FIRST) {
    newMdatPayload = concatBytes(poisonBlob, mdatPayload);
  } else {
    newMdatPayload = concatBytes(mdatPayload, poisonBlob);
  }
  const newMdatSize = 8 + newMdatPayload.length;
  const newMdatHeader = new Uint8Array(8);
  new DataView(newMdatHeader.buffer).setUint32(0, newMdatSize, false);
  newMdatHeader.set(fourCC('mdat'), 4);
  const newMdatBytes = concatBytes(newMdatHeader, newMdatPayload);

  // Layout: prefix | mdat | moov | trailer
  // New absolute offset of mdat start = prefixBytes.length
  const newMdatStart = prefixBytes.length;
  // Poison chunk absolute offset inside file
  const poisonChunkOffset = POISON_FIRST
    ? newMdatStart + 8
    : newMdatStart + 8 + mdatPayload.length;

  // Shift all original chunk offsets:
  // old absolute offsets assumed original file layout. We need delta from old mdat start to new mdat start,
  // and if poison is first, also +poisonBlob.length for data that was after poison.
  const oldMdatStart = mdatOff;
  const shiftBase = newMdatStart - oldMdatStart;
  const shiftData = POISON_FIRST ? shiftBase + poisonBlob.length : shiftBase;

  applyChunkOffsetShift(snapshots, shiftData);

  // Now inject poison offset into the *duplicate* audio track's stco/co64
  {
    const b = audioStcoBox;
    let isCo64 = b.name === 'co64';
    // re-read current offsets after shift (they were updated in snapshot for this box too)
    const cnt = readU32(b.data, 4);
    const offsets = [];
    for (let idx = 0; idx < cnt; idx++) {
      if (isCo64) offsets.push(Number(readU64(b.data, 8 + idx * 8)));
      else offsets.push(readU32(b.data, 8 + idx * 4));
    }
    // The shift already moved the real chunks. Replace list with real + poison.
    // Actually snapshot shifted the *original* offsets of the duplicate track (same as source).
    // We need: shifted real offsets + poison offset.
   
