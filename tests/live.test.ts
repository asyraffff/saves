// Hits real Threads/TikTok pages. Run with:  LIVE=1 npx vitest run tests/live.test.ts
import { describe, expect, it } from 'vitest';
import { fetchPreview } from '../server/preview';

describe.skipIf(!process.env.LIVE)('live previews', () => {
  it('Threads post', async () => {
    const p = await fetchPreview('https://www.threads.net/@zuck/post/CuP48CiS5sx?xmt=abc');
    console.log(p);
    expect(p.url).toBe('https://www.threads.com/@zuck/post/CuP48CiS5sx');
    expect(p.author).toBe('zuck');
    expect(p.text).toMatch(/Welcome to Threads/);
  }, 20000);

  it('TikTok video', async () => {
    const p = await fetchPreview('https://www.tiktok.com/@tiktok/video/7106594312292453675?_r=1');
    console.log(p);
    expect(p.author).toBe('tiktok');
    expect(p.text).toBeTruthy();
    expect(p.thumbnail).toMatch(/^https:/);
  }, 20000);

  it('TikTok short link', async () => {
    const p = await fetchPreview('https://vm.tiktok.com/ZMhvqjqjq/');
    console.log(p);
    expect(p.url).toMatch(/^https:\/\/www\.tiktok\.com\/@[^/]*\/video\/\d+$/);
  }, 20000);

  it('missing Threads post falls back to the handle', async () => {
    const p = await fetchPreview('https://www.threads.com/@zuck/post/CuUP2DCSxzm');
    expect(p.author).toBe('zuck');
    expect(p.text).toBeNull();
  }, 20000);
});
