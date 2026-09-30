// Opt-in smoke test: three real generations with synthetic character material.
import {createRequire} from 'node:module';
import assert from 'node:assert/strict';
const require=createRequire('C:/Users/p/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/package.json');
const {chromium}=require('playwright');
const browser=await chromium.launch({executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
const page=await browser.newPage({viewport:{width:390,height:844}});
await page.route('**/*',route=>{const url=route.request().url();if(url.startsWith('http://127.0.0.1:5189')||url.startsWith('https://ark.cn-beijing.volces.com/'))return route.continue();return route.fulfill({json:{ok:true,service:'echo-computer-bridge',protected:true}});});
await page.addInitScript(()=>{localStorage.setItem('CapacitorStorage.theme','dark');localStorage.setItem('CapacitorStorage.agents',JSON.stringify([{id:'live-test',name:'阿泽',mode:'fast',log:'阿泽：计划赶不上肚子饿，明天再当自律的人。阿泽：树突然出现在我的艺术道路上。',proactive:{enabled:false}}]));});
const idle=()=>page.waitForFunction(()=>!document.querySelector('.play-working'),{},{timeout:80000});
try{
 await page.goto('http://127.0.0.1:5189');await page.locator('[data-go="playground"]').click();
 for(const kind of ['court','board']){await page.locator(`[data-play-tab="${kind}"]`).click();await page.locator('[data-play-example]').first().click();await page.locator('[data-play-start] button').click();await idle();assert.equal(await page.locator('.play-error').count(),0);assert.equal(await page.locator('.play-line').count(),1);console.log(kind,await page.locator('.play-line p').innerText());await page.screenshot({path:`output/playground-live-${kind}.png`});await page.locator('[data-play-back]').click();await page.locator('[data-play-back]').click();}
 await page.locator('[data-play-tab="feed"]').click();await page.locator('[data-feed-generate]').click();await idle();assert.equal(await page.locator('.play-error').count(),0);assert.equal(await page.locator('.play-post').count(),1);console.log('feed',await page.locator('.play-post>div>p').innerText());await page.screenshot({path:'output/playground-live-feed.png'});
 console.log('PASS: real Doubao responses for all three features.');
}finally{await browser.close();}
