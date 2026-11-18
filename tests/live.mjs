// Runs the script's page parsers on real Threads/TikTok pages:  npm run test:live
// (Google's servers may get different answers than your PC; this only checks the parsers still match.)
import { loadScript } from './fake-gas.js';

const { gas } = loadScript();
const BOT = 'Mozilla/5.0 (compatible; SavesBot/1.0; +https://github.com/asyraffff/saves)';
const get = async (url, ua = BOT) => (await fetch(url, { headers: { 'user-agent': ua } })).text();

const threads = 'https://www.threads.com/@zuck/post/CuP48CiS5sx';
const t = gas.parseThreadsHtml(await get(threads), threads);
console.log('Threads:', t);

const tt = gas.parseTikTokHtml(await get('https://www.tiktok.com/@tiktok/video/7106594312292453675'));
console.log('TikTok :', tt);

const res = await fetch('https://vm.tiktok.com/ZMhvqjqjq/', { redirect: 'manual', headers: { 'user-agent': 'Mozilla/5.0 (iPhone)' } });
console.log('Short  :', gas.normalizeUrl(res.headers.get('location') || ''));

const ok = t.text && tt.text && tt.author;
console.log(ok ? '\nOK' : '\nFAILED');
process.exit(ok ? 0 : 1);
