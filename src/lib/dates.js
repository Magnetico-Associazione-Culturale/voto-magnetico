// Date di calendario (senza orario) nel formato "AAAA-MM-GG".

const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

const iso = (y, m, d) => {
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return '';
  return dt.toISOString().slice(0, 10);
};

/**
 * Interpreta una data scritta nei modi in cui arriva da Excel o dal pannello:
 * numero seriale di Excel (es. 46325), 2026-10-31, 31/10/2026, 31-10-2026, 31.10.26, «31 ottobre 2026».
 * Restituisce "AAAA-MM-GG", oppure '' se non è una data valida.
 */
export function parseDay(value) {
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) return '';
  let m;
  if ((m = s.match(/^(\d{4,5})(?:\.\d+)?$/))) {
    // Excel: giorni dal 30/12/1899 (date tra il 1900 e il 2173)
    const n = Number(m[1]);
    if (n < 60 || n > 100000) return '';
    return new Date(Date.UTC(1899, 11, 30) + n * 86_400_000).toISOString().slice(0, 10);
  }
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[t ].*)?$/))) return iso(+m[1], +m[2], +m[3]);
  if ((m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})(?: .*)?$/))) {
    let y = +m[3];
    if (m[3].length === 2) y += y > (new Date().getFullYear() % 100) + 10 ? 1900 : 2000;
    return iso(y, +m[2], +m[1]);
  }
  if ((m = s.match(/^(\d{1,2})\s+([a-z]+)\s+(\d{4})$/))) {
    const month = MONTHS.indexOf(m[2]) + 1;
    return month ? iso(+m[3], month, +m[1]) : '';
  }
  return '';
}

// "2026-10-31" → "31 ottobre 2026" (un testo non riconosciuto resta com'è).
export function formatDay(day) {
  const m = String(day ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : String(day ?? '');
}

// "2026-10-31" → "31/10/2026"
export function formatDayShort(day) {
  const m = String(day ?? '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(day ?? '');
}

// Anni compiuti alla data indicata (entrambe "AAAA-MM-GG").
export function ageOn(birth, day) {
  const [by, bm, bd] = birth.split('-').map(Number);
  const [y, m, d] = day.split('-').map(Number);
  return y - by - (m < bm || (m === bm && d < bd) ? 1 : 0);
}
