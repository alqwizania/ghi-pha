#!/usr/bin/env node
/**
 * Test adding action=default to the POST body.
 * The submit button has name="action" value="default" but HTML form submission
 * only includes the button's name/value if it's the explicit submitter.
 * 
 * Also try: Using page.evaluate to programmatically submit the form
 * with all fields INCLUDING the button value.
 */
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const BASE_URL = "https://promedmail.org";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-blink-features=AutomationControlled"],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  try {
    console.error("[test] Navigating to ProMED signup...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);
    await page.getByRole("link", { name: /login/i }).first().click({ timeout: 15000 });
    await sleep(3000);
    for (const getSel of [
      () => page.getByRole("link", { name: /sign up/i }).first(),
      () => page.locator(".ulp-alternate-action a").first(),
    ]) {
      try {
        const loc = getSel();
        if (await loc.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
          await loc.click({ timeout: 10000 });
          break;
        }
      } catch {}
    }
    await sleep(3000);

    const email = `seha.act.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";

    // === TEST 1: Intercept POST and ADD action=default ===
    console.error("\n=== TEST 1: Intercept POST, add action=default ===");
    
    await page.click('#email');
    await sleep(200);
    await page.keyboard.type(email, { delay: 20 });
    await sleep(200);
    await page.keyboard.press("Tab");
    await sleep(200);
    await page.keyboard.type(password, { delay: 20 });
    await sleep(500);

    let test1Status = null;
    let test1Body = null;
    
    await page.route("**/u/signup**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        let postData = req.postData();
        console.error(`[route] Original POST: ${postData?.slice(0, 200)}`);
        
        // Add action=default if not present
        if (!postData.includes("action=")) {
          postData += "&action=default";
          console.error("[route] Added action=default to POST");
        }
        
        // Forward with modified body
        const resp = await route.fetch({
          postData: postData,
        });
        test1Status = resp.status();
        test1Body = await resp.text();
        console.error(`[route] Modified POST response: ${resp.status()}`);
        await route.fulfill({ response: resp });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);
    
    console.error(`Test 1 result: ${test1Status}`);
    if (test1Body) {
      const hasErrors = test1Body.includes("Please enter an email");
      const hasRedirect = test1Body.includes('http-equiv="refresh"');
      console.error(`  Has email error: ${hasErrors}, Has redirect: ${hasRedirect}`);
    }

    // === TEST 2: Submit form programmatically with explicit submitter ===
    console.error("\n=== TEST 2: form.requestSubmit(button) ===");
    
    // Reload page
    await page.unroute("**/u/signup**");
    await page.goto(page.url(), { waitUntil: "domcontentloaded" });
    await sleep(3000);
    
    // Check if we're still on signup
    if (!page.url().includes("signup")) {
      // Navigate back to signup
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await sleep(2000);
      await page.getByRole("link", { name: /login/i }).first().click({ timeout: 15000 });
      await sleep(3000);
      for (const getSel of [
        () => page.getByRole("link", { name: /sign up/i }).first(),
        () => page.locator(".ulp-alternate-action a").first(),
      ]) {
        try {
          const loc = getSel();
          if (await loc.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
            await loc.click({ timeout: 10000 });
            break;
          }
        } catch {}
      }
      await sleep(3000);
    }

    const email2 = `seha.sub.${Date.now()}@promedmail.org`;
    
    await page.click('#email');
    await sleep(200);
    await page.keyboard.type(email2, { delay: 20 });
    await sleep(200);
    await page.keyboard.press("Tab");
    await sleep(200);
    await page.keyboard.type(password, { delay: 20 });
    await sleep(500);

    let test2Status = null;
    let test2Body = null;
    
    await page.route("**/u/signup**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        console.error(`[route2] POST: ${req.postData()?.slice(0, 200)}`);
        const resp = await route.fetch();
        test2Status = resp.status();
        test2Body = await resp.text();
        console.error(`[route2] Response: ${resp.status()}`);
        await route.fulfill({ response: resp });
      } else {
        await route.continue();
      }
    });

    // Use requestSubmit with the button as submitter - this ensures the button's
    // name/value get included in FormData
    const submitted = await page.evaluate(() => {
      const form = document.querySelector('form');
      const btn = document.querySelector('button[name="action"]');
      if (!form || !btn) return { error: "form or button not found" };
      
      try {
        // requestSubmit with submitter includes the button's name=value
        form.requestSubmit(btn);
        return { success: true };
      } catch (e) {
        return { error: e.message };
      }
    });
    console.error(`requestSubmit result: ${JSON.stringify(submitted)}`);
    await sleep(5000);
    
    console.error(`Test 2 result: ${test2Status}`);
    if (test2Body) {
      const hasErrors = test2Body.includes("Please enter an email");
      console.error(`  Has email error: ${hasErrors}`);
    }

    // === TEST 3: Build FormData manually with all fields and fetch() it ===
    console.error("\n=== TEST 3: Manual fetch() POST with all fields ===");
    
    await page.unroute("**/u/signup**");
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(3000);

    const email3 = `seha.fetch.${Date.now()}@promedmail.org`;
    
    // Don't type - just use evaluate to POST directly
    const fetchResult = await page.evaluate(async (args) => {
      const { email, password } = args;
      
      // Get the state and other hidden fields from the form
      const form = document.querySelector('form');
      if (!form) return { error: "No form found" };
      
      const formData = new FormData(form);
      // Set email and password
      formData.set('email', email);
      formData.set('password', password);
      // Ensure action is included
      formData.set('action', 'default');
      
      // Convert FormData to URLSearchParams
      const params = new URLSearchParams();
      for (const [key, val] of formData.entries()) {
        params.append(key, val);
      }
      
      // Log what we're sending
      const paramStr = params.toString();
      
      try {
        const resp = await fetch(form.action || window.location.href, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: paramStr,
          redirect: 'manual',  // Don't follow redirects
        });
        
        return {
          status: resp.status,
          statusText: resp.statusText,
          redirected: resp.redirected,
          url: resp.url,
          type: resp.type,
          headers: Object.fromEntries(resp.headers.entries()),
          bodyPreview: (await resp.text().catch(() => "")).slice(0, 500),
          sentParams: paramStr.slice(0, 300),
        };
      } catch (e) {
        return { error: e.message, sentParams: paramStr.slice(0, 300) };
      }
    }, { email: email3, password });
    
    console.error(`Fetch result: ${JSON.stringify(fetchResult, null, 2)}`);

    await page.screenshot({ path: "/app/runtime/promed/action-test-final.png" });

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 500));
    await page.screenshot({ path: "/app/runtime/promed/action-test-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
