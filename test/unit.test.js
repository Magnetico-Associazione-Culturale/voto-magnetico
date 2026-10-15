import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateCode, isWellFormedCode, normalizeCode, formatCode, totpAt, verifyTotp, hashPassword, verifyPassword } from '../src/lib/crypto.js';
import { parseCsvObjects, toCsv } from '../src/lib/csv.js';
import { electedAndTie } from '../src/services/tally.js';
import { html } from '../src/lib/html.js';
import zlib from 'node:zlib';
import { readXlsxRows } from '../src/lib/xlsx.js';
import { parseDay, formatDay, ageOn } from '../src/lib/dates.js';

// Piccolo .xlsx costruito a mano: un file "stored" e uno compresso (deflate).
function makeXlsx(entries) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const [name, text, deflate] of entries) {
    const raw = Buffer.from(text);
    const data = deflate ? zlib.deflateRawSync(raw) : raw;
    const n = Buffer.from(name);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(deflate ? 8 : 0, 8);
    lh.writeUInt32LE(data.length, 18);
    lh.writeUInt32LE(raw.length, 22);
    lh.writeUInt16LE(n.length, 26);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(deflate ? 8 : 0, 10);
    ch.writeUInt32LE(data.length, 20);
    ch.writeUInt32LE(raw.length, 24);
    ch.writeUInt16LE(n.length, 28);
    ch.writeUInt32LE(offset, 42);
    locals.push(lh, n, data);
    central.push(ch, n);
    offset += lh.length + n.length + data.length;
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

test('codici: formato, casualità, normalizzazione', () => {
  const set = new Set();
  for (let i = 0; i < 5000; i++) {
    const c = generateCode();
    assert.ok(isWellFormedCode(c));
    assert.ok(!/[01OIL]/.test(c), 'niente caratteri ambigui');
    set.add(c);
  }
  assert.equal(set.size, 5000);
  const c = generateCode();
  assert.equal(normalizeCode(` ${formatCode(c).toLowerCase()} `), c);
});

test('TOTP: vettore di prova RFC 6238', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ'; // "12345678901234567890"
  assert.equal(totpAt(secret, 59_000), '287082');
  assert.equal(totpAt(secret, 1111111109_000), '081804');
  assert.ok(verifyTotp(secret, '287082', 59_000));
  assert.ok(!verifyTotp(secret, '000000', 59_000));
});

test('password: scrypt', () => {
  const h = hashPassword('una password');
  assert.ok(verifyPassword('una password', h));
  assert.ok(!verifyPassword('altra', h));
});

test('CSV: separatore ;, virgolette, BOM, intestazioni', () => {
  const rows = parseCsvObjects('﻿Nome;Cognome;"In regola"\n"De Luca, Anna";Rossi;sì\n\n');
  assert.deepEqual(rows, [{ nome: 'De Luca, Anna', cognome: 'Rossi', in_regola: 'sì' }]);
  assert.match(toCsv([['=SOMMA(A1)', 'a;b']]), /'=SOMMA\(A1\);"a;b"/);
});

test('eletti e parità all\'ultimo posto utile', () => {
  const r = (...pairs) => pairs.map(([name, total]) => ({ name, total }));
  assert.deepEqual(electedAndTie(r(['A', 5], ['B', 4], ['C', 3], ['D', 2]), 3), { elected: ['A', 'B', 'C'], tie: null });
  assert.deepEqual(electedAndTie(r(['A', 5], ['B', 3], ['C', 3], ['D', 3]), 3), {
    elected: ['A'],
    tie: { votes: 3, names: ['B', 'C', 'D'], seatsLeft: 2 },
  });
  // parità non all'ultimo posto: nessun ballottaggio
  assert.deepEqual(electedAndTie(r(['A', 5], ['B', 5], ['C', 3], ['D', 1]), 3).tie, null);
  // meno votati dei posti
  assert.deepEqual(electedAndTie(r(['A', 2], ['B', 0]), 3), { elected: ['A'], tie: null });
});

test('template HTML: escaping', () => {
  assert.equal(html`<p>${'<script>"x"</script>'}</p>`.toString(), '<p>&lt;script&gt;&quot;x&quot;&lt;/script&gt;</p>');
});

test('Excel: stringhe condivise e in linea, numeri, celle vuote, entità', () => {
  const buf = makeXlsx([
    ['xl/workbook.xml', '<workbook><sheets><sheet name="Elenco" sheetId="1" r:id="rId1"/></sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>'],
    ['xl/sharedStrings.xml', '<sst><si><t>Codice</t></si><si><r><t>Co</t></r><r><t xml:space="preserve">gnome</t></r></si></sst>', true],
    [
      'xl/worksheets/sheet1.xml',
      '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>Data Nascita</t></is></c></row>' +
        '<row r="2"><c r="A2"><v>7</v></c><c r="B2" t="inlineStr"><is><t>D&apos;Amico &amp; C.</t></is></c><c r="D2"><v>31046</v></c></row><row r="3"/></sheetData></worksheet>',
      true,
    ],
  ]);
  assert.deepEqual(readXlsxRows(buf), [
    ['Codice', 'Cognome', '', 'Data Nascita'],
    ['7', "D'Amico & C.", '', '31046'],
  ]);
  assert.throws(() => readXlsxRows(Buffer.from('non è un excel, solo testo qualunque')), /Excel/);
});

test('date: formati di Excel e del pannello, età', () => {
  assert.equal(parseDay('31048'), '1985-01-01');
  assert.equal(parseDay('46326'), '2026-10-31');
  assert.equal(parseDay('31/10/2026'), '2026-10-31');
  assert.equal(parseDay('2026-10-31'), '2026-10-31');
  assert.equal(parseDay('31 ottobre 2026'), '2026-10-31');
  assert.equal(parseDay('31.10.26'), '2026-10-31');
  assert.equal(parseDay('15/03/85'), '1985-03-15');
  assert.equal(parseDay('30/02/2026'), '');
  assert.equal(parseDay('domani'), '');
  assert.equal(formatDay('2026-10-31'), '31 ottobre 2026');
  assert.equal(ageOn('2008-10-31', '2026-10-31'), 18);
  assert.equal(ageOn('2008-11-01', '2026-10-31'), 17);
});

test('limiti: chiave IP, rete /64 per IPv6', async () => {
  const { ipKey } = await import('../src/lib/net.js');
  assert.equal(ipKey('203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('::ffff:203.0.113.7'), '203.0.113.7');
  assert.equal(ipKey('2001:db8:1:2:a:b:c:d'), '2001:0db8:0001:0002::/64');
  assert.equal(ipKey('2001:db8:1:2::5'), ipKey('2001:db8:1:2:ffff::1'));
  assert.notEqual(ipKey('2001::1:0:0:c:d'), ipKey('2001::'));
  assert.equal(ipKey('2001:0:0:1:a::'), ipKey('2001:0:0:1::9'));
});
