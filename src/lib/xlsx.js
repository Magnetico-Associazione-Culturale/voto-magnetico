// Lettura del primo foglio di un file Excel (.xlsx), senza dipendenze.
// Un .xlsx è un archivio ZIP di file XML: qui si legge solo quanto serve
// per l'export dell'anagrafica (testi, numeri, date come numero seriale).
import zlib from 'node:zlib';

const MAX_UNZIPPED = 50 * 1024 * 1024; // protezione contro file anomali

export class XlsxError extends Error {}

// Restituisce le righe del primo foglio come array di stringhe.
export function readXlsxRows(buffer) {
  const files = unzip(buffer);
  const text = (name) => (files.has(name) ? files.get(name)() : null);

  const shared = [];
  const sst = text('xl/sharedStrings.xml');
  if (sst) for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(runsText(m[1]));

  const sheet = text(firstSheetPath(text('xl/workbook.xml'), text('xl/_rels/workbook.xml.rels')));
  if (!sheet) throw new XlsxError('Il file Excel non contiene fogli leggibili');

  const rows = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*?(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const row = [];
    let next = 0;
    for (const cm of (rm[1] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+)\d+"/);
      const col = ref ? colIndex(ref[1]) : next;
      next = col + 1;
      row[col] = cellValue(attrs.match(/\bt="(\w+)"/)?.[1], cm[2] ?? '', shared);
    }
    rows.push(Array.from(row, (v) => v ?? ''));
  }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

function cellValue(type, inner, shared) {
  if (type === 'inlineStr') return runsText(inner);
  const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
  if (v === undefined) return '';
  if (type === 's') return shared[Number(v)] ?? '';
  return decode(v);
}

// Testo di un <si> o <is>: concatena i <t>, ignorando la guida fonetica (<rPh>).
function runsText(xml) {
  return [...xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decode(m[1])).join('');
}

function firstSheetPath(workbook, rels) {
  const rid = workbook?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid && rels?.match(new RegExp(`<Relationship\\b[^>]*\\bId="${rid}"[^>]*\\bTarget="([^"]+)"`))?.[1];
  if (!target) return 'xl/worksheets/sheet1.xml';
  return target.startsWith('/') ? target.slice(1) : `xl/${target}`;
}

function colIndex(letters) {
  let n = 0;
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64;
  return n - 1;
}

function decode(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[e.toLowerCase()];
  });
}

// ZIP minimo: indice centrale + voci "stored" (0) o "deflate" (8).
// Restituisce una mappa nome → funzione che estrae il testo (solo su richiesta).
function unzip(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 22) throw new XlsxError('Il file non è un Excel (.xlsx) valido');
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new XlsxError('Il file non è un Excel (.xlsx) valido');

  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const files = new Map();
  let total = 0;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new XlsxError('Il file Excel è danneggiato');
    const method = buf.readUInt16LE(p + 10);
    const size = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    p += 46 + nameLen + extraLen + commentLen;

    files.set(name, () => {
      if (local + 30 > buf.length || buf.readUInt32LE(local) !== 0x04034b50) throw new XlsxError('Il file Excel è danneggiato');
      const start = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
      const data = buf.subarray(start, start + size);
      let out;
      if (method === 0) out = data;
      else if (method === 8) {
        try {
          out = zlib.inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED - total });
        } catch {
          throw new XlsxError('Il file Excel è danneggiato o troppo grande');
        }
      } else throw new XlsxError('Formato di compressione non supportato');
      total += out.length;
      return out.toString('utf8');
    });
  }
  return files;
}
