#!/usr/bin/env node
/**
 * Test Auth0 ULP functions and try to use them to validate fields.
 * Also test: what if we type using keyboard ONLY (no programmatic fill)?
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
    // Navigate to signup page
    console.error("[test] Navigating to ProMED...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);
    await page.getByRole("link", { name: /login/i }).first().click({ timeout: 15000 });
    await sleep(3000);
    
    // Click Sign up
    const signupSelectors = [
      () => page.getByRole("link", { name: /sign up/i }).first(),
      () => page.locator("a:has-text('Sign up')").first(),
      () => page.locator(".ulp-alternate-action a").first(),
    ];
    for (const getSel of signupSelectors) {
      try {
        const loc = getSel();
        if (await loc.waitFor({ state: "visible", timeout: 5000 }).then(() => true).catch(() => false)) {
          await loc.click({ timeout: 10000 });
          break;
        }
      } catch {}
    }
    await sleep(3000);
    console.error(`[test] On signup page: ${page.url()}`);

    // === STEP 1: Inspect the ULP functions ===
    console.error("\n=== ULP FUNCTIONS INSPECTION ===");
    const ulpInfo = await page.evaluate(() => {
      const results = {};
      
      // Inspect each ULP function
      if (typeof window.ulpRequiredFunction === "function") {
        results.ulpRequiredFunction = window.ulpRequiredFunction.toString().slice(0, 500);
      }
      if (typeof window.ulpEmailValidationFunction === "function") {
        results.ulpEmailValidationFunction = window.ulpEmailValidationFunction.toString().slice(0, 500);
      }
      if (typeof window.ulpPasswordPolicyFunction === "function") {
        results.ulpPasswordPolicyFunction = window.ulpPasswordPolicyFunction.toString().slice(0, 500);
      }
      if (typeof window.ulpPatternCheckFunction === "function") {
        results.ulpPatternCheckFunction = window.ulpPatternCheckFunction.toString().slice(0, 500);
      }
      if (typeof window.ulpFlags === "object") {
        results.ulpFlags = window.ulpFlags;
      }
      
      return results;
    });
    console.error(JSON.stringify(ulpInfo, null, 2));

    // === STEP 2: Look at all inline scripts on the page ===
    console.error("\n=== INLINE SCRIPTS ===");
    const scripts = await page.evaluate(() => {
      return Array.from(document.querySelectorAll("script")).map((s, i) => ({
        index: i,
        src: s.src || "(inline)",
        contentPreview: s.src ? null : s.textContent.slice(0, 300),
        contentLength: s.textContent.length,
      }));
    });
    console.error(JSON.stringify(scripts, null, 2));

    // === STEP 3: Try PURE KEYBOARD approach ===
    // The theory: Auth0's ULP uses native browser events (not React).
    // If we click the field and type character by character using the real keyboard,
    // the browser's built-in event system should fire input/change events that
    // Auth0's JS listens to.
    console.error("\n=== PURE KEYBOARD TEST ===");
    
    const email = `seha.kb.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";
    
    // Click email field to focus it
    await page.click('#email');
    await sleep(500);
    
    // Check errors BEFORE typing
    const errorsBefore = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
        .map(e => e.textContent.trim().slice(0, 80)).filter(t => t.length > 5);
    });
    console.error(`Errors BEFORE typing: ${JSON.stringify(errorsBefore)}`);
    
    // Type email character by character using keyboard
    await page.keyboard.type(email, { delay: 30 });
    await sleep(500);
    
    // Check field value and errors after email
    const afterEmail = await page.evaluate(() => {
      const emailEl = document.querySelector('#email');
      return {
        value: emailEl?.value,
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim().slice(0, 80)).filter(t => t.length > 5),
      };
    });
    console.error(`After typing email: value="${afterEmail.value}", errors=${JSON.stringify(afterEmail.errors)}`);
    
    // Tab to password field
    await page.keyboard.press("Tab");
    await sleep(300);
    
    // Check which element is focused
    const focused = await page.evaluate(() => {
      const el = document.activeElement;
      return { tag: el?.tagName, id: el?.id, name: el?.name, type: el?.type };
    });
    console.error(`Focused after Tab: ${JSON.stringify(focused)}`);
    
    // Type password
    await page.keyboard.type(password, { delay: 30 });
    await sleep(500);
    
    // Check state after both fields
    const afterBoth = await page.evaluate(() => {
      const emailEl = document.querySelector('#email');
      const pwdEl = document.querySelector('#password');
      return {
        emailValue: emailEl?.value,
        passwordLength: pwdEl?.value?.length,
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim().slice(0, 80)).filter(t => t.length > 5),
      };
    });
    console.error(`After both fields: ${JSON.stringify(afterBoth)}`);

    await page.screenshot({ path: "/app/runtime/promed/keyboard-test-before-submit.png" });

    // === STEP 4: Click Continue via keyboard (press Enter) or click button ===
    console.error("\n=== SUBMITTING VIA BUTTON CLICK ===");
    
    // Set up request interception
    const postedRequests = [];
    page.on("request", (req) => {
      if (req.method() === "POST") {
        postedRequests.push({
          url: req.url(),
          postData: req.postData()?.slice(0, 500),
        });
      }
    });
    page.on("response", (resp) => {
      if (resp.request().method() === "POST") {
        console.error(`[test] POST ${resp.status()} ${resp.url().slice(0, 100)}`);
      }
    });

    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);
    
    console.error(`POST requests: ${postedRequests.length}`);
    for (const req of postedRequests) {
      console.error(`  URL: ${req.url.slice(0, 100)}`);
      console.error(`  Data: ${req.postData}`);
    }

    const afterSubmit = await page.evaluate(() => {
      return {
        url: window.location.href,
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim().slice(0, 80)).filter(t => t.length > 5),
        title: document.title,
        // Check if there are any checkbox/agreement pages
        checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).length,
        buttons: Array.from(document.querySelectorAll('button'))
          .map(b => b.textContent.trim()).filter(t => t.length > 0),
      };
    });
    console.error(`After submit: ${JSON.stringify(afterSubmit)}`);
    
    await page.screenshot({ path: "/app/runtime/promed/keyboard-test-after-submit.png" });

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    await page.screenshot({ path: "/app/runtime/promed/keyboard-test-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
