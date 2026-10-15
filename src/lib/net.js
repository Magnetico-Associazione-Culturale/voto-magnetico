// Chiave per i limiti di richieste: l'IP, oppure la rete /64 per IPv6
// (una singola connessione IPv6 di casa ha a disposizione miliardi di indirizzi).
import { isIPv6 } from 'node:net';

function expandIPv6(ip) {
  const [head, tail = ''] = ip.split('::');
  const h = head ? head.split(':') : [];
  const t = ip.includes('::') && tail ? tail.split(':') : [];
  const fill = ip.includes('::') ? Array(8 - h.length - t.length).fill('0') : [];
  return [...h, ...fill, ...t].map((g) => g.toLowerCase().padStart(4, '0'));
}

export function ipKey(ip) {
  const s = String(ip ?? '').replace(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/, '$1');
  if (!isIPv6(s)) return s;
  return `${expandIPv6(s.split('%')[0]).slice(0, 4).join(':')}::/64`;
}
