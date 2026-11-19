// Local preview of the Review page: runs apps-script/Code.js against the in-memory fake sheet
// (tests/fake-gas.js) with a few sample posts, so the page can be tried without Google.
//   npm run preview   →   http://localhost:5178
import http from 'node:http';
import { loadScript } from './fake-gas.js';

const PORT = Number(process.env.PORT) || 5178;

const SAMPLES = [
  ['https://www.threads.com/@laballoonshouz/post/DcDNy3XE2Yb', 'Weddings / Venue Tunang', '@laballoonshouz',
    'sesiapa mencari event space yg murah, kemas & cantik. RM599 (5 jam rental space)\n\ncontact: 0109317736'],
  ['https://www.tiktok.com/@arlazrn/video/7690391821251366164', 'Weddings / Tiktok Trends', '@arlazrn', '19.9.2026'],
  ['https://www.threads.com/@tempahcincin/post/DfA1', 'Weddings / Rings & Jewelry', '@tempahcincin',
    'Come and drop by here!\n\n📍 Tempah Cincin\nTaman Melawati, KL'],
  ['https://www.threads.com/@nis0piee/post/DfB2', 'Food / Wanna Try', '@nis0piee', 'SEDAP 😍😍😍 MURAH 😍😍😍 JAUH 😡😡😡'],
  ['https://www.threads.com/@rseventspace.kl/post/DftAWIRkuCo', 'Weddings / Venue Tunang', '@rseventspace.kl',
    '🌙 PROMO KHAS SLOT MALAM DISEMBER!\n\nNak buat majlis hujung tahun? Jom booking Retro Style Event Space 🥰\n\n📍 Cheras Permaisuri\n📲 0182575157'],
  ['https://www.threads.com/@far.hz/post/DfC3', '', '@far.hz', 'I jumpa taobao irl weh. Banyak choice dan murah.'],
];

function makeApp() {
  const env = loadScript();
  const { gas } = env;
  gas.setup();
  const token = env.props.get('TOKEN');
  const call = (body) => gas.doPost({ postData: { contents: JSON.stringify({ token, ...body }) } }).json();
  const saves = env.sheets.get('Saves');
  SAMPLES.forEach(([url, folders, author, text], i) => {
    const { id } = call({ action: 'save', input: url });
    call({ action: 'assign', id, folders });
    const row = saves.dump().findIndex((r) => r[7] === id) + 1;
    saves.set(row, 1, new Date(Date.now() - (SAMPLES.length - i) * 2 * 86400000));
    saves.set(row, 3, author);
    saves.set(row, 4, text);
  });
  gas.reviewUpdate(token, saves.dump()[1][7], { status: 'Shortlisted', rating: '⭐⭐⭐⭐', price: 'RM 599', contact: '0109317736', note: 'ask about Dec' });
  return { gas, token };
}

// Stands in for google.script.run: forwards calls to /api/<function>.
const STUB = `<script>
window.google = { script: { run: (function () {
  function runner(ok, fail) {
    return new Proxy({}, { get: function (_t, name) {
      if (name === 'withSuccessHandler') return function (f) { return runner(f, fail); };
      if (name === 'withFailureHandler') return function (f) { return runner(ok, f); };
      return function () {
        fetch('/api/' + name, { method: 'POST', body: JSON.stringify([].slice.call(arguments)) })
          .then(function (r) { return r.json(); })
          .then(function (d) { if (d.error) { if (fail) fail(new Error(d.error)); } else if (ok) ok(d.result); });
      };
    } });
  }
  return runner();
})() } };
</script>`;

let app = makeApp();
const ALLOWED = ['reviewData', 'reviewUpdate'];

http
  .createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/reset') {
      app = makeApp();
      res.writeHead(302, { Location: '/' }).end();
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      const name = url.pathname.slice(5);
      let body = '';
      req.on('data', (c) => { body += c; });
      req.on('end', () => {
        res.setHeader('content-type', 'application/json');
        try {
          if (!ALLOWED.includes(name)) throw new Error('Unknown function ' + name);
          res.end(JSON.stringify({ result: app.gas[name](...JSON.parse(body || '[]')) }));
        } catch (err) {
          res.end(JSON.stringify({ error: err.message }));
        }
      });
      return;
    }
    if (url.pathname !== '/') {
      res.writeHead(404).end();
      return;
    }
    const page = app.gas.doGet({ parameter: { page: 'review', token: app.token } }).getContent();
    const html = page
      .replace('<meta charset="utf-8">', '<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Saves Review (preview)</title>')
      .replace('<script>', STUB + '<script>');
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(html);
  })
  .listen(PORT, () => console.log(`Review page preview: http://localhost:${PORT}  (sample data; /reset starts over)`));
