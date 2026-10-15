'use strict';

// Чтение файлов работ.
// Текстовые форматы (txt, rtf, doc, docx, odt, pdf с текстом) читаются прямо в браузере.
// Изображения и сканы PDF передаются в Gemini, который сам распознаёт текст (в т.ч. рукописный).
// extract() возвращает { texts: [строки], inline: [{ mimeType, data(base64) }] }.
const Files = (() => {
  const KINDS = {
    txt: 'text', text: 'text', md: 'text', csv: 'text',
    rtf: 'rtf',
    doc: 'doc', docx: 'docx', odt: 'odt',
    pdf: 'pdf',
    jpg: 'image', jpeg: 'image', jfif: 'image', png: 'image', webp: 'image',
    heic: 'image', heif: 'image', bmp: 'image', gif: 'image', tif: 'image', tiff: 'image',
  };
  const IMAGE_MIME = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', jfif: 'image/jpeg', png: 'image/png', webp: 'image/webp',
    heic: 'image/heic', heif: 'image/heif', bmp: 'image/bmp', gif: 'image/gif', tif: 'image/tiff', tiff: 'image/tiff',
  };
  // Форматы изображений, которые Gemini принимает напрямую
  const GEMINI_IMAGES = ['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif'];
  const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
  const MAX_IMAGE_SIDE = 3000;

  const ACCEPT = Object.keys(KINDS).map(e => '.' + e).join(',') + ',image/*,application/pdf';

  const extOf = name => (String(name).split('.').pop() || '').toLowerCase();

  function kindOf(file) {
    return KINDS[extOf(file.name)] || (file.type?.startsWith('image/') ? 'image' : null);
  }

  const isImage = file => kindOf(file) === 'image';

  function requireLib(lib, name) {
    if (typeof lib === 'undefined') throw new Error(t('errLib', { name }));
  }

  // --- base64 ---

  function toBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result).split(',')[1] || '');
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }

  function fromBase64(b64, type) {
    const bin = atob(b64 || '');
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  // --- обычный текст ---

  function decodeText(buf) {
    const u8 = new Uint8Array(buf);
    if (u8[0] === 0xFF && u8[1] === 0xFE) return new TextDecoder('utf-16le').decode(u8.subarray(2));
    if (u8[0] === 0xFE && u8[1] === 0xFF) return new TextDecoder('utf-16be').decode(u8.subarray(2));
    try {
      return new TextDecoder('utf-8', { fatal: true }).decode(u8).replace(/^﻿/, '');
    } catch {
      return new TextDecoder('windows-1251').decode(u8); // старые файлы на кириллице
    }
  }

  // --- RTF ---

  const RTF_SKIP = new Set([
    'fonttbl', 'colortbl', 'stylesheet', 'info', 'pict', 'header', 'footer', 'headerl', 'headerr', 'headerf',
    'footerl', 'footerr', 'footerf', 'object', 'themedata', 'colorschememapping', 'latentstyles', 'datastore',
    'listtable', 'listoverridetable', 'rsidtbl', 'generator', 'xmlnstbl', 'mmathPr', 'filetbl', 'revtbl', 'footnote',
  ]);

  function rtfToText(rtf) {
    let out = '';
    let i = 0;
    let skip = false;
    let uc = 1;
    let decoder = new TextDecoder('windows-1252');
    const stack = [];
    const len = rtf.length;

    const skipFallback = n => {
      while (n > 0 && i < len) {
        if (rtf[i] === '\\' && rtf[i + 1] === "'") i += 4;
        else if (rtf[i] === '\\' || rtf[i] === '{' || rtf[i] === '}') break;
        else i++;
        n--;
      }
    };

    while (i < len) {
      const ch = rtf[i];
      if (ch === '{') {
        stack.push({ skip, uc });
        i++;
        if (rtf.startsWith('\\*', i)) skip = true;
      } else if (ch === '}') {
        const st = stack.pop();
        if (st) ({ skip, uc } = st);
        i++;
      } else if (ch === '\\') {
        const next = rtf[i + 1];
        if (next === '\\' || next === '{' || next === '}') {
          if (!skip) out += next;
          i += 2;
        } else if (next === "'") {
          const byte = parseInt(rtf.substr(i + 2, 2), 16);
          if (!skip && !Number.isNaN(byte)) out += decoder.decode(new Uint8Array([byte]));
          i += 4;
        } else if (/[a-zA-Z]/.test(next || '')) {
          const m = /^([a-zA-Z]+)(-?\d+)? ?/.exec(rtf.slice(i + 1, i + 40));
          const word = m[1];
          const param = m[2] !== undefined ? Number(m[2]) : null;
          i += 1 + m[0].length;
          if (RTF_SKIP.has(word)) skip = true;
          else if (word === 'ansicpg' && param) {
            try { decoder = new TextDecoder('windows-' + param); } catch { /* неизвестная кодировка */ }
          } else if (word === 'uc' && param !== null) uc = param;
          else if (!skip) {
            if (word === 'par' || word === 'line' || word === 'sect' || word === 'page') out += '\n';
            else if (word === 'tab' || word === 'cell') out += '\t';
            else if (word === 'row') out += '\n';
            else if (word === 'emdash') out += '—';
            else if (word === 'endash') out += '–';
            else if (word === 'lquote') out += '‘';
            else if (word === 'rquote') out += '’';
            else if (word === 'ldblquote') out += '“';
            else if (word === 'rdblquote') out += '”';
            else if (word === 'bullet') out += '•';
            else if (word === 'u' && param !== null) {
              out += String.fromCharCode(param < 0 ? param + 65536 : param);
              skipFallback(uc);
            }
          } else if (word === 'u') {
            skipFallback(uc);
          }
        } else {
          // \~ неразрывный пробел, \- мягкий перенос и т.п.
          if (!skip && next === '~') out += ' ';
          i += 2;
        }
      } else {
        if (!skip && ch !== '\r' && ch !== '\n') out += ch;
        i++;
      }
    }
    return out.replace(/\n{3,}/g, '\n\n').trim();
  }

  // --- DOC (Word 97–2003): разбор составного файла OLE и таблицы кусков текста ---

  function readCfb(u8) {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const SIG = [0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
    if (!SIG.every((b, i) => u8[i] === b)) throw new Error('not an OLE file');
    const END = 0xFFFFFFFA;
    const secSize = 1 << dv.getUint16(0x1E, true);
    const miniSize = 1 << dv.getUint16(0x20, true);
    const nFat = dv.getUint32(0x2C, true);
    const dirStart = dv.getUint32(0x30, true);
    const miniCutoff = dv.getUint32(0x38, true);
    const miniFatStart = dv.getUint32(0x3C, true);
    let difatSec = dv.getUint32(0x44, true);
    const secOff = s => (s + 1) * secSize;
    const perSec = secSize / 4;

    const fatSecs = [];
    for (let i = 0; i < 109; i++) {
      const s = dv.getUint32(0x4C + i * 4, true);
      if (s < END) fatSecs.push(s);
    }
    const seenDifat = new Set();
    while (difatSec < END && fatSecs.length < nFat && !seenDifat.has(difatSec)) {
      seenDifat.add(difatSec);
      const o = secOff(difatSec);
      for (let i = 0; i < perSec - 1; i++) {
        const s = dv.getUint32(o + i * 4, true);
        if (s < END) fatSecs.push(s);
      }
      difatSec = dv.getUint32(o + secSize - 4, true);
    }

    const fat = new Uint32Array(fatSecs.length * perSec);
    fatSecs.forEach((s, k) => {
      const o = secOff(s);
      for (let i = 0; i < perSec && o + i * 4 + 4 <= u8.length; i++) fat[k * perSec + i] = dv.getUint32(o + i * 4, true);
    });

    const chain = (start, table) => {
      const out = [];
      const seen = new Set();
      for (let s = start; s < END && s < table.length && !seen.has(s); s = table[s]) {
        seen.add(s);
        out.push(s);
      }
      return out;
    };

    const readChain = (start, size) => {
      const secs = chain(start, fat);
      const out = new Uint8Array(secs.length * secSize);
      secs.forEach((s, i) => out.set(u8.subarray(secOff(s), secOff(s) + secSize), i * secSize));
      return size == null ? out : out.subarray(0, size);
    };

    const dir = readChain(dirStart);
    const ddv = new DataView(dir.buffer);
    const entries = [];
    for (let o = 0; o + 128 <= dir.length; o += 128) {
      const type = dir[o + 0x42];
      if (!type) continue;
      const nameLen = ddv.getUint16(o + 0x40, true);
      entries.push({
        name: new TextDecoder('utf-16le').decode(dir.subarray(o, o + Math.max(0, nameLen - 2))),
        type,
        start: ddv.getUint32(o + 0x74, true),
        size: ddv.getUint32(o + 0x78, true),
      });
    }

    const root = entries.find(e => e.type === 5);
    let miniStream = null;
    let miniFat = null;

    return function stream(name) {
      const e = entries.find(x => x.name === name && x.type === 2);
      if (!e) return null;
      if (e.size >= miniCutoff) return readChain(e.start, e.size);
      if (!miniStream) {
        miniStream = readChain(root.start, root.size);
        const mf = readChain(miniFatStart);
        const mdv = new DataView(mf.buffer);
        miniFat = new Uint32Array(mf.length / 4);
        for (let i = 0; i < miniFat.length; i++) miniFat[i] = mdv.getUint32(i * 4, true);
      }
      const secs = chain(e.start, miniFat);
      const out = new Uint8Array(secs.length * miniSize);
      secs.forEach((s, i) => out.set(miniStream.subarray(s * miniSize, (s + 1) * miniSize), i * miniSize));
      return out.subarray(0, e.size);
    };
  }

  function cleanWordText(text) {
    // Поля Word: \x13 код \x14 результат \x15 — оставляем только результат
    let prev;
    do {
      prev = text;
      text = text.replace(/\x13[^\x13\x14\x15]*\x14([^\x13\x14\x15]*)\x15/g, '$1')
        .replace(/\x13[^\x13\x14\x15]*\x15/g, '');
    } while (text !== prev);
    return text
      .replace(/[\x13\x14\x15]/g, '')
      .replace(/\r/g, '\n')
      .replace(/\x07/g, '\t')
      .replace(/[\x0B\x0C]/g, '\n')
      .replace(/[\x00-\x08\x0E-\x1F]/g, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function docToText(buf) {
    const stream = readCfb(new Uint8Array(buf));
    const wd = stream('WordDocument');
    if (!wd) throw new Error('no WordDocument stream');
    const wdv = new DataView(wd.buffer, wd.byteOffset, wd.byteLength);
    const flags = wdv.getUint16(0x0A, true);
    if (flags & 0x0100) throw new Error(t('errEncrypted'));
    const table = stream(flags & 0x0200 ? '1Table' : '0Table');
    if (!table) throw new Error('no table stream');
    const ccpText = wdv.getInt32(0x4C, true);
    const fcClx = wdv.getUint32(0x1A2, true);
    const lcbClx = wdv.getUint32(0x1A6, true);
    const clx = table.subarray(fcClx, fcClx + lcbClx);
    const cdv = new DataView(clx.buffer, clx.byteOffset, clx.byteLength);

    let p = 0;
    while (p < clx.length && clx[p] === 0x01) p += 3 + cdv.getUint16(p + 1, true);
    if (clx[p] !== 0x02) throw new Error('bad piece table');
    const lcb = cdv.getUint32(p + 1, true);
    p += 5;
    const n = (lcb - 4) / 12;
    const cp1252 = new TextDecoder('windows-1252');
    const utf16 = new TextDecoder('utf-16le');
    let text = '';
    for (let k = 0; k < n && text.length < ccpText; k++) {
      const cpStart = cdv.getUint32(p + k * 4, true);
      const cpEnd = cdv.getUint32(p + (k + 1) * 4, true);
      let fc = cdv.getUint32(p + (n + 1) * 4 + k * 8 + 2, true);
      const count = cpEnd - cpStart;
      if (fc & 0x40000000) {
        fc = (fc & 0x3FFFFFFF) / 2;
        text += cp1252.decode(wd.subarray(fc, fc + count));
      } else {
        text += utf16.decode(wd.subarray(fc, fc + count * 2));
      }
    }
    return cleanWordText(text.slice(0, ccpText));
  }

  // Запасной способ для повреждённых .doc: ищем куски текста в UTF-16
  function docFallback(buf) {
    const s = new TextDecoder('utf-16le').decode(new Uint8Array(buf, 0, buf.byteLength - (buf.byteLength % 2)));
    const runs = s.match(/[\p{L}\p{N}\p{P}\p{Zs}\r\n]{20,}/gu) || [];
    return cleanWordText(runs.filter(r => /\p{L}{3,}/u.test(r)).join('\n'));
  }

  // --- DOCX / ODT ---

  async function zipImages(blob, prefix) {
    requireLib(window.JSZip, 'JSZip');
    const zip = await JSZip.loadAsync(blob);
    const out = [];
    const names = Object.keys(zip.files).filter(n => n.startsWith(prefix) && IMAGE_MIME[extOf(n)]).sort();
    for (const name of names) {
      const b = new Blob([await zip.file(name).async('uint8array')], { type: IMAGE_MIME[extOf(name)] });
      out.push(await imageInline(b, name));
    }
    return out;
  }

  async function docxExtract(blob) {
    requireLib(window.mammoth, 'mammoth.js');
    const res = await mammoth.extractRawText({ arrayBuffer: await blob.arrayBuffer() });
    const text = res.value.replace(/\n{3,}/g, '\n\n').trim();
    // В документе только вставленные фото (например, снимок тетради)?
    if (letterCount(text) < 10) return { texts: [], inline: await zipImages(blob, 'word/media/') };
    return { texts: [text], inline: [] };
  }

  async function odtExtract(blob) {
    requireLib(window.JSZip, 'JSZip');
    const zip = await JSZip.loadAsync(blob);
    const xml = await zip.file('content.xml')?.async('string');
    if (!xml) throw new Error('content.xml not found');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const TEXT_NS = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
    const nodeText = node => {
      if (node.nodeType === Node.TEXT_NODE) return node.nodeValue;
      if (node.namespaceURI === TEXT_NS) {
        if (node.localName === 's') return ' '.repeat(Number(node.getAttributeNS(TEXT_NS, 'c')) || 1);
        if (node.localName === 'tab') return '\t';
        if (node.localName === 'line-break') return '\n';
      }
      return [...node.childNodes].map(nodeText).join('');
    };
    const paragraphs = [...doc.getElementsByTagName('*')]
      .filter(el => el.namespaceURI === TEXT_NS && (el.localName === 'p' || el.localName === 'h'));
    const text = paragraphs.map(nodeText).join('\n').trim();
    if (letterCount(text) < 10) return { texts: [], inline: await zipImages(blob, 'Pictures/') };
    return { texts: [text], inline: [] };
  }

  // --- PDF ---

  async function pdfExtract(blob) {
    let text = '';
    try {
      requireLib(window.pdfjsLib, 'pdf.js');
      const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
      for (let i = 1; i <= pdf.numPages; i++) {
        const content = await (await pdf.getPage(i)).getTextContent();
        text += content.items.map(it => it.str + (it.hasEOL ? '\n' : '')).join('') + '\n\n';
      }
    } catch (e) {
      console.warn('pdf.js failed, sending PDF to Gemini', e);
    }
    if (letterCount(text) >= 40) return { texts: [text.replace(/\n{3,}/g, '\n\n').trim()], inline: [] };
    // Скан без текстового слоя — Gemini распознает сам
    return { texts: [], inline: [{ mimeType: 'application/pdf', data: await toBase64(blob) }] };
  }

  // --- изображения ---

  async function reencode(blob) {
    const bmp = await createImageBitmap(blob);
    const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const out = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
    if (!out) throw new Error('canvas.toBlob failed');
    return { mimeType: 'image/jpeg', data: await toBase64(out) };
  }

  async function imageInline(blob, name) {
    const mime = (blob.type && blob.type !== 'application/octet-stream') ? blob.type : (IMAGE_MIME[extOf(name)] || 'image/jpeg');
    const supported = GEMINI_IMAGES.includes(mime);
    if (!supported || blob.size > MAX_IMAGE_BYTES) {
      try {
        return await reencode(blob);
      } catch (e) {
        if (!supported) throw new Error(t('errImage', { name }));
        // HEIC и т.п. браузер может не уметь открыть — отправляем как есть
      }
    }
    return { mimeType: mime, data: await toBase64(blob) };
  }

  // --- общее ---

  const letterCount = s => (String(s).match(/\p{L}/gu) || []).length;

  // Некоторые файлы переименованы: .doc на деле RTF или DOCX. Смотрим на первые байты.
  async function sniff(blob, kind) {
    if (!['doc', 'docx', 'rtf'].includes(kind)) return kind;
    const head = new Uint8Array(await blob.slice(0, 8).arrayBuffer());
    if (head[0] === 0x7B && head[1] === 0x5C && head[2] === 0x72) return 'rtf'; // {\rtf
    if (head[0] === 0x50 && head[1] === 0x4B) return 'docx';                       // PK (zip)
    if (head[0] === 0xD0 && head[1] === 0xCF) return 'doc';                        // OLE
    return kind;
  }

  async function extract(file) {
    const blob = file.blob || file;
    const kind = await sniff(blob, kindOf(file));
    try {
      switch (kind) {
        case 'text':
          return { texts: [decodeText(await blob.arrayBuffer())], inline: [] };
        case 'rtf': {
          const raw = new TextDecoder('latin1').decode(await blob.arrayBuffer());
          return { texts: [rtfToText(raw)], inline: [] };
        }
        case 'docx':
          return await docxExtract(blob);
        case 'odt':
          return await odtExtract(blob);
        case 'doc': {
          const buf = await blob.arrayBuffer();
          let text = '';
          try {
            text = docToText(buf);
          } catch (e) {
            if (e.message === t('errEncrypted')) throw e;
            console.warn('DOC parse failed, using fallback', e);
            text = docFallback(buf);
          }
          if (letterCount(text) < 10) throw new Error(t('errDoc', { name: file.name }));
          return { texts: [text], inline: [] };
        }
        case 'pdf':
          return await pdfExtract(blob);
        case 'image':
          return { texts: [], inline: [await imageInline(blob, file.name)] };
        default:
          throw new Error(t('errUnsupported', { name: file.name }));
      }
    } catch (e) {
      if (e.message.includes(file.name)) throw e;
      throw new Error(t('errFileRead', { name: file.name, msg: e.message }));
    }
  }

  return { ACCEPT, kindOf, isImage, extract, toBase64, fromBase64 };
})();

if (window.pdfjsLib) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
}
