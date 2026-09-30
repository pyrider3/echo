import { createRequire } from 'node:module';
import assert from 'node:assert/strict';
const require = createRequire('C:/Users/p/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const { chromium } = require('playwright');
const baseUrl=process.env.ECHO_TEST_URL||'http://127.0.0.1:15189';
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
let calls=0, fail=false;
await page.route('**/*',async route=>{
 const url=route.request().url();
 if(url.includes('/api/v3/responses')){calls++;if(fail){fail=false;return route.fulfill({status:400,json:{error:{message:'模拟生成失败，请重试'}}});}return route.fulfill({json:{output_text:`第${calls}轮：财务说预算不足，快乐部申请精神补贴。`}});}
 if(url.startsWith(baseUrl))return route.continue();
 return route.fulfill({json:{ok:true,service:'echo-computer-bridge',protected:true}});
});
await page.addInitScript(()=>{if(!localStorage.getItem('test-seeded')){localStorage.setItem('test-seeded','1');localStorage.setItem('CapacitorStorage.agents',JSON.stringify([{id:'17',name:'阿泽',relation:'朋友',mode:'pro',trainingStatus:'queued',log:'阿泽：别急，我先替你把奶茶喝了。',turns:[],proactive:{enabled:false}}]));localStorage.setItem('CapacitorStorage.theme','light');}});
const click=async selector=>{await page.locator(selector).first().click();};
const idle=()=>page.waitForFunction(()=>!document.querySelector('.play-working'));
try{
 await page.goto(baseUrl);await page.locator('[data-go="playground"]').waitFor();
 for(const size of [{width:390,height:844},{width:360,height:640}]){await page.setViewportSize(size);await page.waitForTimeout(400);const box=await page.locator('[data-go="playground"]').boundingBox();await page.screenshot({path:`output/playground-home-${size.width}.png`});console.log(size,box);assert(box.y>=0&&box.y+box.height<=size.height,'home entry visible');}
 await page.setViewportSize({width:390,height:844});await click('[data-go="playground"]');await click('[data-play-tab="court"]');await click('[data-play-example]');await click('[data-play-start] button');await idle();assert.equal(await page.locator('.play-line').count(),1);
 await click('[data-play-next]');await idle();assert.equal(await page.locator('.play-line').count(),2);
 await page.evaluate(()=>document.documentElement.dataset.theme='dark');await page.waitForTimeout(450);assert.equal(await page.locator('.play-line').last().evaluate(el=>getComputedStyle(el).opacity),'1');await page.screenshot({path:'output/playground-dark-verified.png'});await page.evaluate(()=>document.documentElement.dataset.theme='light');
 await page.locator('[data-play-draft]').fill('我有异议，证人就是冰箱！');await click('[data-play-interject] button');await idle();assert.equal(await page.locator('.play-line').count(),4);
 await click('[data-play-final]');await idle();await page.screenshot({path:'output/playground-court.png'});assert.equal(await page.locator('[data-play-next]').count(),0);
 await click('[data-play-back]');await click('[data-play-back]');await click('[data-play-tab="board"]');await click('[data-play-example]');await click('[data-play-start] button');await idle();
 fail=true;await click('[data-play-next]');await idle();assert.match(await page.locator('.play-error').innerText(),/模拟生成失败/);assert.equal(await page.locator('.play-line').count(),1);
 await click('[data-play-next]');await idle();assert.equal(await page.locator('.play-line').count(),2);await click('[data-play-final]');await idle();
 await click('[data-play-back]');await click('[data-play-back]');await click('[data-play-tab="feed"]');await click('[data-feed-generate]');await idle();await click('[data-feed-like]');await idle();assert.equal(await page.locator('[data-feed-like]').getAttribute('aria-pressed'),'true');
 await page.locator('[data-feed-comment] input').fill('快乐部不同意！');await click('[data-feed-comment] button');await idle();await click('[data-feed-reply]');await idle();assert.equal(await page.locator('.play-comments p').count(),2);await page.screenshot({path:'output/playground-feed.png'});
 await page.reload();await click('[data-go="playground"]');await click('[data-play-tab="feed"]');assert.equal(await page.locator('.play-post').count(),1);assert.equal(await page.locator('.play-comments p').count(),2);
 await click('[data-play-back]');await click('[data-play-back]');await click('[data-create]');await click('[data-sample]');await click('[data-next]');await page.locator('#name').waitFor();await click('[data-next]');await page.locator('[data-voice]').first().waitFor();await click('[data-next]');await page.locator('[data-finish]').waitFor();assert.match(await page.locator('.wizard>small').innerText(),/04 \/ 04/);assert.equal(await page.locator('[data-mode]').count(),0);assert(!((await page.locator('body').innerText()).includes('专业档')));
 await click('[data-finish]');await page.locator('#message').waitFor();const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem('CapacitorStorage.agents')));assert(saved.every(a=>a.mode==='fast'));assert.equal(saved[0].name,'阿泽');
 assert.deepEqual(errors,[]);console.log('PASS: court, board, error/retry, feed, likes/comments, reload persistence, four-step creation, legacy migration, mobile entry bounds.');
}finally{await browser.close();}
