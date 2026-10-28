import {expect,type Page} from '@playwright/test';
import {resetDemoViewerFixtureLoginLimit} from './fixture-auth';
export async function enterSimulation(page:Page,width=1440,theme='light'){
 await resetDemoViewerFixtureLoginLimit();
 await page.setViewportSize({width,height:960});
 await page.addInitScript(t=>localStorage.setItem('theme',t),theme);
 await page.goto('/#/login');await page.getByRole('button',{name:'Demo Viewer',exact:true}).click();await page.getByRole('button',{name:/^sign in$/i}).click();
 await expect(page.getByRole('heading',{name:'Overview',exact:true})).toBeVisible();
 // Sign-in now starts the real Overview preview automatically. Finish its first
 // frame (or WebGL fallback) before navigating so software-GPU preparation does
 // not overlap another workspace's assertions.
 await expect(page.locator('[aria-label="Linked equipment preview"] [data-state]')).toHaveAttribute('data-state',/^(ready|unsupported)$/,{timeout:30000});
 return (await(await page.request.get('/api/trpc/system.showcase')).json()).result.data.json;
}
export const rpc=(name:string,input:unknown)=>'/api/trpc/'+name+'?input='+encodeURIComponent(JSON.stringify({json:input}));
export async function noOverflow(page:Page){await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);}
