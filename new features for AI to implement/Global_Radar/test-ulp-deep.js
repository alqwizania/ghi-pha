#!/usr/bin/env node
/**
 * Extract and analyze Auth0's ULP inline script.
 * The key question: how does the ULP validate fields?
 * It uses ulpRequiredFunction(e,n) where e is the element and n is... what?
 * 
 * ulpRequiredFunction: function(e,n){return!n||!!e.value}
 * -> Returns true if n is falsy OR e.value is truthy
 * -> This means: if n is true (required), value must be truthy
 * 
 * BUT the error messages say "Please enter an email address" even though value IS set.
 * This means either:
 * 1. The validation runs at a time when value isn't set yet
 * 2. There's a separate validation mechanism we're missing
 * 3. The error messages are rendered via CSS and never cleared
 * 
 * Let's extract the FULL script and look at how errors are shown/hidden.
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
    // Navigate straight to signup
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

    // KEY QUESTION: Are the "error" messages actually VISIBLE or just in DOM?
    console.error("\n=== ERROR VISIBILITY CHECK ===");
    const errorVisibility = await page.evaluate(() => {
      const errors = document.querySelectorAll('[class*="error"], [role="alert"]');
      return Array.from(errors).map(el => {
        const rect = el.getBoundingClientRect();
        const style = window.getComputedStyle(el);
        return {
          text: el.textContent.trim().slice(0, 60),
          visible: rect.width > 0 && rect.height > 0,
          display: style.display,
          visibility: style.visibility,
          opacity: style.opacity,
          height: style.height,
          overflow: style.overflow,
          ariaHidden: el.getAttribute("aria-hidden"),
          className: el.className.slice(0, 80),
          tagName: el.tagName,
          role: el.getAttribute("role"),
          // Check parent visibility
          parentDisplay: el.parentElement ? window.getComputedStyle(el.parentElement).display : null,
          parentHeight: el.parentElement ? window.getComputedStyle(el.parentElement).height : null,
        };
      });
    });
    console.error(JSON.stringify(errorVisibility, null, 2));

    // Extract the full inline script
    console.error("\n=== EXTRACTING FULL ULP SCRIPT ===");
    const fullScript = await page.evaluate(() => {
      const scripts = document.querySelectorAll("script");
      for (const s of scripts) {
        if (!s.src && s.textContent.includes("ulpFlags")) {
          return s.textContent;
        }
      }
      return null;
    });
    
    if (fullScript) {
      // Write it to a file for analysis
      require("fs").writeFileSync("/app/runtime/promed/ulp-script.js", fullScript);
      console.error(`Full ULP script extracted: ${fullScript.length} characters`);
      
      // Look for key patterns in the script
      const patterns = [
        "addEventListener",
        "submit",
        "validate",
        "error",
        "invalid",
        "required",
        ".value",
        "FormData",
        "XMLHttpRequest",
        "fetch(",
        "aria-invalid",
        "c51819df4",  // class from password validation
        "cbc47e89c",  // class from password policy function
        "c27eb6e0f",  // another class from password policy
      ];
      
      console.error("\nPattern occurrences in ULP script:");
      for (const p of patterns) {
        const count = (fullScript.match(new RegExp(p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length;
        if (count > 0) {
          // Find first occurrence context
          const idx = fullScript.indexOf(p);
          const context = fullScript.slice(Math.max(0, idx - 50), idx + p.length + 50);
          console.error(`  "${p}": ${count} occurrences. Context: ...${context}...`);
        }
      }
    }

    // Now the real test: Check if form submission is actually working when fields are truly valid
    // by intercepting and modifying the POST request
    console.error("\n=== ROUTE INTERCEPTION TEST ===");
    
    const email = `seha.ri.${Date.now()}@promedmail.org`;
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

    // Before submitting, let's check: what does the ULP validation actually think?
    const validationCheck = await page.evaluate(() => {
      const emailEl = document.querySelector('#email');
      const pwdEl = document.querySelector('#password');
      
      const results = {};
      
      // Call the actual ULP validation functions
      if (typeof window.ulpRequiredFunction === "function") {
        results.emailRequired = window.ulpRequiredFunction(emailEl, true);
        results.passwordRequired = window.ulpRequiredFunction(pwdEl, true);
      }
      if (typeof window.ulpEmailValidationFunction === "function") {
        results.emailValid = window.ulpEmailValidationFunction(emailEl, true);
      }
      
      results.emailValue = emailEl?.value;
      results.passwordValue = pwdEl?.value?.length;
      
      // Check HTML5 validation
      results.emailHtml5Valid = emailEl?.checkValidity?.();
      results.passwordHtml5Valid = pwdEl?.checkValidity?.();
      
      // Check aria-invalid attribute
      results.emailAriaInvalid = emailEl?.getAttribute("aria-invalid");
      results.passwordAriaInvalid = pwdEl?.getAttribute("aria-invalid");
      
      // Check for any CSS class that marks as invalid
      results.emailClasses = emailEl?.className;
      results.passwordClasses = pwdEl?.className;
      
      return results;
    });
    console.error(`ULP validation results: ${JSON.stringify(validationCheck, null, 2)}`);

    // Now try: intercept the POST and see the response body
    let responseBody = null;
    await page.route("**/u/signup**", async (route) => {
      const req = route.request();
      if (req.method() === "POST") {
        console.error(`[route] Intercepted POST, forwarding...`);
        console.error(`[route] POST body: ${req.postData()?.slice(0, 300)}`);
        const resp = await route.fetch();
        responseBody = await resp.text();
        console.error(`[route] Response status: ${resp.status()}`);
        console.error(`[route] Response body (first 500): ${responseBody.slice(0, 500)}`);
        await route.fulfill({ response: resp });
      } else {
        await route.continue();
      }
    });

    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);

    console.error(`\n[test] Final URL: ${page.url()}`);
    
    // If we got a response body, check what errors the server sent
    if (responseBody) {
      // Look for error indicators in the HTML response
      const errorMatches = responseBody.match(/ulp-input-error[^"]*"|error-text[^"]*"|class="[^"]*error[^"]*"/g);
      console.error(`Error class patterns in response: ${JSON.stringify(errorMatches?.slice(0, 5))}`);
      
      // Check if the response contains the form again (failed) or a redirect (success)
      const hasSignupForm = responseBody.includes('id="email"');
      const hasRedirect = responseBody.includes('meta http-equiv="refresh"') || responseBody.includes('window.location');
      console.error(`Response has signup form: ${hasSignupForm}, has redirect: ${hasRedirect}`);
    }

    await page.screenshot({ path: "/app/runtime/promed/route-test.png" });

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    console.error(err.stack?.slice(0, 500));
  } finally {
    await browser.close();
  }
})();
