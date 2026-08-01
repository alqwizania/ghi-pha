#!/usr/bin/env node
/**
 * HYPOTHESIS: The 400 is NOT a validation error — it's a session/state issue.
 * Auth0's server checks the session cookie against the state token and rejects
 * the submission if they don't match or the session is invalid.
 * 
 * NEW APPROACH: Since REST API signup works, skip browser signup entirely.
 * Instead:
 * 1. Create account via REST API
 * 2. Get an access token via Authorization Code + PKCE flow
 * 3. Use the token to set cookies in the browser context
 * 
 * OR: Maybe the 400 is actually a SUCCESS and the form is being re-rendered
 * because Auth0 needs email verification. Let's check by:
 * 1. Looking at the actual response more carefully
 * 2. Checking if after the 400, navigating to ProMED shows us as logged in
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
    console.error(`[test] Signup URL: ${page.url()}`);

    // Check ALL cookies
    const cookies = await context.cookies();
    console.error(`\n=== COOKIES (${cookies.length}) ===`);
    for (const c of cookies) {
      console.error(`  ${c.name}=${c.value.slice(0, 80)}... (domain=${c.domain}, path=${c.path}, httpOnly=${c.httpOnly}, secure=${c.secure}, sameSite=${c.sameSite})`);
    }

    // Look at the form more carefully
    const formDetails = await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return { error: "No form" };
      
      return {
        action: form.action,
        method: form.method,
        enctype: form.enctype,
        novalidate: form.hasAttribute('novalidate'),
        dataFormPrimary: form.getAttribute('data-form-primary'),
        dataDisableHtmlValidations: form.hasAttribute('data-disable-html-validations'),
        // ALL form attributes
        attributes: Array.from(form.attributes).map(a => ({ name: a.name, value: a.value.slice(0, 60) })),
        // All hidden inputs (full values this time)
        hiddenInputs: Array.from(form.querySelectorAll('input[type="hidden"]')).map(h => ({
          name: h.name,
          value: h.value,
        })),
        // Check if the form action is actually a proper URL or an object ref
        actionType: typeof form.action,
        actionString: String(form.action),
      };
    });
    console.error(`\n=== FORM DETAILS ===`);
    console.error(JSON.stringify(formDetails, null, 2));

    // Type credentials
    const email = `seha.session.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";
    
    await page.click('#email');
    await sleep(200);
    await page.keyboard.type(email, { delay: 15 });
    await sleep(200);
    await page.keyboard.press("Tab");
    await sleep(200);
    await page.keyboard.type(password, { delay: 15 });
    await sleep(500);

    // Intercept POST and examine both request and response in detail
    let requestCookies = null;
    let responseBody = null;
    let responseStatus = null;
    let responseHeaders = null;
    let requestPostData = null;
    
    await page.route("**/u/signup**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        requestCookies = req.headers()["cookie"];
        requestPostData = req.postData();
        
        const resp = await route.fetch();
        responseStatus = resp.status();
        responseHeaders = resp.headers();
        responseBody = await resp.text();
        
        await route.fulfill({ response: resp });
      } else {
        await route.continue();
      }
    });

    // Click submit
    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);

    console.error(`\n=== POST REQUEST ===`);
    console.error(`Cookies sent: ${requestCookies?.slice(0, 300)}`);
    console.error(`Post data: ${requestPostData?.slice(0, 300)}`);
    
    console.error(`\n=== RESPONSE ===`);
    console.error(`Status: ${responseStatus}`);
    console.error(`Headers: ${JSON.stringify(responseHeaders)}`);

    if (responseBody) {
      // Look for ANY text content between specific divs that might be a server error
      // The 400 response is a full HTML page — look for inline error text
      require("fs").writeFileSync("/app/runtime/promed/signup-400-v2.html", responseBody);
      console.error(`Full response saved (${responseBody.length} bytes)`);
      
      // Check for specific Auth0 error patterns
      const patterns = [
        /class="[^"]*cdc4991f8[^"]*"[^>]*>([^<]+)/g,  // server error banner
        /class="[^"]*ulp-alert[^"]*"[^>]*>([^<]+)/g,
        /class="[^"]*error[^"]*"(?:(?!hide)[^>])*>([^<]+)/g,  // visible errors (not hidden)
        /data-error-title[^>]*>([^<]+)/g,
        /data-error-description[^>]*>([^<]+)/g,
      ];
      
      for (const pat of patterns) {
        let m;
        while ((m = pat.exec(responseBody)) !== null) {
          const text = m[1]?.trim();
          if (text && text.length > 3) {
            console.error(`  Found: ${text.slice(0, 100)}`);
          }
        }
      }

      // CRITICAL: Check if the response sets any cookies that indicate success
      const setCookies = responseHeaders?.["set-cookie"];
      if (setCookies) {
        console.error(`\nSet-Cookie headers: ${setCookies.slice(0, 500)}`);
      }
      
      // Check if the response body has any Auth0 transaction ID or error code
      const txIdMatch = responseBody.match(/transaction[_-]id[^"]*"[^"]*"([^"]*)"/i);
      const errorCodeMatch = responseBody.match(/error[_-]code[^"]*"[^"]*"([^"]*)"/i);
      console.error(`Transaction ID: ${txIdMatch?.[1] || "not found"}`);
      console.error(`Error code: ${errorCodeMatch?.[1] || "not found"}`);
      
      // Look for the "state" in the response - is it the same?
      const responseState = responseBody.match(/name="state"\s+value="([^"]+)"/);
      const requestState = requestPostData?.match(/state=([^&]+)/)?.[1];
      console.error(`\nRequest state: ${decodeURIComponent(requestState || "N/A").slice(0, 60)}`);
      console.error(`Response state: ${responseState?.[1]?.slice(0, 60) || "N/A"}`);
      console.error(`States match: ${decodeURIComponent(requestState || "") === responseState?.[1]}`);
    }

    // === REGARDLESS OF 400: Try navigating to ProMED and see if we're logged in ===
    console.error("\n=== CHECKING AUTH STATUS AFTER 400 ===");
    await page.unroute("**/u/signup**");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });
    await sleep(3000);
    
    const authCheck = await page.evaluate(() => {
      return {
        url: window.location.href,
        // Check for login/logout links
        hasLoginLink: !!document.querySelector('a[href*="login"], nav a:has-text("Login")'),
        loginLinks: Array.from(document.querySelectorAll('a')).filter(a => /login/i.test(a.textContent)).map(a => a.textContent.trim().slice(0, 30)),
        logoutLinks: Array.from(document.querySelectorAll('a')).filter(a => /logout/i.test(a.textContent)).map(a => a.textContent.trim().slice(0, 30)),
        // Avatar/profile elements
        hasAvatar: !!document.querySelector('[class*="avatar"], [class*="profile"], img[alt*="avatar"]'),
      };
    });
    console.error(`Auth check: ${JSON.stringify(authCheck)}`);
    
    await page.screenshot({ path: "/app/runtime/promed/session-test.png" });

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    await page.screenshot({ path: "/app/runtime/promed/session-test-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
