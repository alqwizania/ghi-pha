#!/usr/bin/env node
/**
 * Capture the FULL server response when signup POST returns 400.
 * Also try: an action=default field that might be missing or extra.
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
    console.error("[test] Navigating to ProMED...");
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

    const email = `seha.full.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";
    
    // Type using keyboard
    await page.click('#email');
    await sleep(300);
    await page.keyboard.type(email, { delay: 20 });
    await sleep(300);
    await page.keyboard.press("Tab");
    await sleep(300);
    await page.keyboard.type(password, { delay: 20 });
    await sleep(500);

    // Intercept the POST and capture the FULL response
    let fullResponseBody = null;
    let requestHeaders = null;
    let requestPostData = null;
    let responsHeaders = null;
    
    await page.route("**/u/signup**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        requestHeaders = req.headers();
        requestPostData = req.postData();
        
        const resp = await route.fetch();
        fullResponseBody = await resp.text();
        responsHeaders = resp.headers();
        
        console.error(`[route] Response status: ${resp.status()}`);
        console.error(`[route] Response headers: ${JSON.stringify(responsHeaders)}`);
        
        await route.fulfill({ response: resp });
      } else {
        await route.continue();
      }
    });

    console.error("[test] Clicking Continue...");
    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);

    if (requestPostData) {
      console.error(`\n=== REQUEST POST DATA ===`);
      console.error(requestPostData);
      
      // Parse the URL-encoded data
      const params = new URLSearchParams(requestPostData);
      console.error(`\n=== PARSED POST PARAMS ===`);
      for (const [key, val] of params) {
        console.error(`  ${key}: ${val.slice(0, 80)}`);
      }
    }
    
    if (requestHeaders) {
      console.error(`\n=== REQUEST HEADERS ===`);
      const important = ["content-type", "cookie", "origin", "referer", "accept", "user-agent"];
      for (const h of important) {
        if (requestHeaders[h]) {
          console.error(`  ${h}: ${requestHeaders[h].slice(0, 200)}`);
        }
      }
    }

    if (fullResponseBody) {
      // Save the full response
      require("fs").writeFileSync("/app/runtime/promed/signup-400-response.html", fullResponseBody);
      console.error(`\n=== FULL RESPONSE SAVED (${fullResponseBody.length} bytes) ===`);
      
      // Look for error messages that are NOT hidden
      const visibleErrorPattern = /class="[^"]*ulp-error[^"]*"[^>]*>([^<]+)</g;
      const hiddenErrorPattern = /class="[^"]*hide[^"]*"[^>]*>([^<]+)</g;
      
      let match;
      console.error("\n=== VISIBLE ERROR MESSAGES IN RESPONSE ===");
      const allErrors = fullResponseBody.match(/class="[^"]*error[^"]*"[^>]*>[^<]+/g) || [];
      for (const e of allErrors) {
        const isHidden = e.includes("hide") || e.includes("display:none") || e.includes("display: none");
        const text = e.match(/>([^<]+)$/)?.[1]?.trim();
        if (text && text.length > 3) {
          console.error(`  ${isHidden ? "[HIDDEN]" : "[VISIBLE]"} ${text.slice(0, 100)}`);
        }
      }
      
      // Look for server-side error banners (Auth0 sometimes adds them)
      const alertPattern = /class="[^"]*alert[^"]*"[^>]*>([^<]+)/g;
      console.error("\n=== ALERT MESSAGES ===");
      const alerts = fullResponseBody.match(/class="[^"]*alert[^"]*"[^>]*>[^<]+/g) || [];
      for (const a of alerts) {
        const text = a.match(/>([^<]+)$/)?.[1]?.trim();
        if (text && text.length > 3) {
          console.error(`  ${text.slice(0, 100)}`);
        }
      }
      
      // Check for "danger" or server error messages
      if (fullResponseBody.includes("danger")) {
        const dangerContext = fullResponseBody.slice(
          Math.max(0, fullResponseBody.indexOf("danger") - 200),
          fullResponseBody.indexOf("danger") + 300
        );
        console.error(`\n=== DANGER CONTEXT ===\n${dangerContext}`);
      }
      
      // Check for any text between <p> or <span> tags that could be error text
      // in the non-form area (like server-side error banner at top)
      const bodyMatch = fullResponseBody.match(/<body[^>]*>([\s\S]*)/);
      if (bodyMatch) {
        // Look for elements with specific error indicator classes
        const errorSections = fullResponseBody.match(/class="[^"]*(?:cdc4991f8|c6c28785e|alert-danger|error-message|server-error)[^"]*"[^>]*>([^<]*)/g);
        if (errorSections) {
          console.error("\n=== ERROR SECTIONS ===");
          for (const s of errorSections) {
            console.error(`  ${s.slice(0, 150)}`);
          }
        }
      }

      // IMPORTANT: Check if the response is actually a REDIRECT that the browser should follow
      const metaRefresh = fullResponseBody.match(/meta.*http-equiv.*refresh.*content.*url=([^"]+)/i);
      if (metaRefresh) {
        console.error(`\n=== META REDIRECT: ${metaRefresh[1]} ===`);
      }
      
      // Look for the key difference between the initial page and the 400 response
      // by checking if there's an "action" field difference
      const actionValue = fullResponseBody.match(/name="action"\s+value="([^"]+)"/);
      console.error(`\nAction field in response: ${actionValue ? actionValue[1] : "NOT FOUND"}`);
      
      // Check for any __csrf or similar token
      const csrfMatch = fullResponseBody.match(/name="[^"]*csrf[^"]*"\s+value="([^"]+)"/i);
      console.error(`CSRF token: ${csrfMatch ? csrfMatch[1].slice(0, 50) : "NOT FOUND"}`);
    }

    // === SECOND APPROACH: Use REST API signup THEN login via browser ===
    // Since REST signup works, and the issue is only with browser-based signup,
    // let's try: create account via REST, then on the LOGIN page, just type credentials
    console.error("\n\n=== APPROACH B: REST SIGNUP + BROWSER LOGIN ===");
    
    // First, create account via REST
    const https = require("https");
    const signupEmail = `seha.hybrid.${Date.now()}@promedmail.org`;
    const signupPassword = "SehaR4dar!Tmp2026";
    
    const signupResult = await new Promise((resolve, reject) => {
      const data = JSON.stringify({
        client_id: "YOUkzZhUgchQa0MJjah9h78cKV8TlE6n",
        email: signupEmail,
        password: signupPassword,
        connection: "Username-Password-Authentication",
      });
      
      const options = {
        hostname: "auth.promedmail.org",
        path: "/dbconnections/signup",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      };
      
      const req = https.request(options, (res) => {
        let body = "";
        res.on("data", (chunk) => body += chunk);
        res.on("end", () => resolve({ status: res.statusCode, body }));
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
    
    console.error(`REST signup: ${signupResult.status} ${signupResult.body.slice(0, 200)}`);
    
    if (signupResult.status === 200) {
      // Account created! Now try to login via browser
      // Navigate to the LOGIN page (not signup)
      console.error("[test] Navigating to login page...");
      await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
      await sleep(2000);
      await page.getByRole("link", { name: /login/i }).first().click({ timeout: 15000 });
      await sleep(3000);
      
      console.error(`[test] Login page URL: ${page.url()}`);
      
      // Check if there's a Turnstile/captcha on the login page
      const loginPageInfo = await page.evaluate(() => {
        return {
          hasTurnstile: !!document.querySelector('[class*="turnstile"], [class*="captcha"], #cf-turnstile, iframe[src*="challenges"]'),
          turnstileFrames: Array.from(document.querySelectorAll('iframe')).map(f => f.src.slice(0, 100)),
          inputs: Array.from(document.querySelectorAll('input')).map(i => ({
            id: i.id, name: i.name, type: i.type, 
          })),
          hiddenInputs: Array.from(document.querySelectorAll('input[type="hidden"]')).map(h => ({
            name: h.name, value: h.value?.slice(0, 50),
          })),
        };
      });
      console.error(`Login page info: ${JSON.stringify(loginPageInfo, null, 2)}`);
      
      // Type credentials on login page
      const usernameField = '#username';
      const loginPwdField = '#password';
      
      await page.click(usernameField).catch(() => page.click('input[name="username"]'));
      await sleep(300);
      await page.keyboard.type(signupEmail, { delay: 20 });
      await sleep(300);
      await page.keyboard.press("Tab");
      await sleep(300);
      await page.keyboard.type(signupPassword, { delay: 20 });
      await sleep(500);
      
      // Check for captcha/turnstile
      const hasCaptcha = await page.evaluate(() => {
        const captchaInput = document.querySelector('input[name="captcha"]');
        return {
          hasCaptchaInput: !!captchaInput,
          captchaValue: captchaInput?.value?.slice(0, 50) || null,
          iframeCount: document.querySelectorAll('iframe').length,
          iframeSrcs: Array.from(document.querySelectorAll('iframe')).map(f => f.src.slice(0, 100)),
        };
      });
      console.error(`Captcha check: ${JSON.stringify(hasCaptcha)}`);
      
      // Intercept login POST
      let loginResponseStatus = null;
      let loginResponseBody = null;
      await page.route("**/u/login**", async (route) => {
        const req = route.request();
        if (req.method() === "POST") {
          console.error(`[route] Login POST body: ${req.postData()?.slice(0, 300)}`);
          const resp = await route.fetch();
          loginResponseStatus = resp.status();
          loginResponseBody = await resp.text();
          console.error(`[route] Login response: ${resp.status()}`);
          await route.fulfill({ response: resp });
        } else {
          await route.continue();
        }
      });
      
      // Click login
      await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
      await sleep(5000);
      
      console.error(`Final URL after login: ${page.url()}`);
      console.error(`Login response status: ${loginResponseStatus}`);
      
      if (loginResponseBody) {
        // Check if we got redirected to ProMED (success)
        const isProMed = page.url().includes("promedmail.org") && !page.url().includes("auth.promedmail.org");
        console.error(`Redirected to ProMED (success): ${isProMed}`);
        
        if (!isProMed && loginResponseBody) {
          // Look for error
          const errors = loginResponseBody.match(/class="[^"]*error[^"]*"[^>]*>([^<]+)/g) || [];
          const visibleErrors = errors.filter(e => !e.includes("hide"));
          console.error(`Login errors: ${JSON.stringify(visibleErrors.map(e => e.match(/>([^<]+)$/)?.[1]?.trim()).filter(Boolean))}`);
        }
      }
      
      await page.screenshot({ path: "/app/runtime/promed/hybrid-login-result.png" });
    }

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 300));
  } finally {
    await browser.close();
  }
})();
