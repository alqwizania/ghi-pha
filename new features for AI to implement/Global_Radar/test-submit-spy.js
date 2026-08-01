#!/usr/bin/env node
/**
 * Test: Override the form submit handler to log what it sees,
 * then let the original handler process.
 * 
 * Also try: dispatchEvent to fire "input" events on the fields
 * before submitting, to ensure the ULP's event listeners have 
 * updated their internal state.
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

    const email = `seha.debug.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";

    // === STEP 1: Add a spy on the form submit to see what the validator sees ===
    console.error("\n=== ADDING SUBMIT SPY ===");
    await page.evaluate(() => {
      const form = document.querySelector('form');
      if (!form) return;
      
      // Add a capturing listener that fires BEFORE the ULP handlers
      form.addEventListener("submit", function spyHandler(e) {
        const emailEl = document.querySelector('#email');
        const pwdEl = document.querySelector('#password');
        
        // Store debug info in a global
        window.__submitSpyData = {
          emailValue: emailEl?.value,
          passwordValue: pwdEl?.value,
          passwordLength: pwdEl?.value?.length,
          timestamp: Date.now(),
          // Check the validation function results
          ulpRequired_email: typeof window.ulpRequiredFunction === "function" ? 
            window.ulpRequiredFunction(emailEl, true) : "N/A",
          ulpRequired_password: typeof window.ulpRequiredFunction === "function" ? 
            window.ulpRequiredFunction(pwdEl, true) : "N/A",
          ulpEmailValid: typeof window.ulpEmailValidationFunction === "function" ?
            window.ulpEmailValidationFunction(emailEl, true) : "N/A",
          // Check data-ulp-validation-function elements
          validationElements: Array.from(document.querySelectorAll('[data-ulp-validation-function]')).map(el => ({
            functionName: el.getAttribute('data-ulp-validation-function'),
            target: el.getAttribute('data-ulp-validation-target'),
            isError: el.getAttribute('data-is-error'),
            classes: el.className.slice(0, 100),
          })),
          // Check for ulp-validator-error classes
          validatorErrors: Array.from(document.querySelectorAll('.ulp-validator-error')).map(el => ({
            text: el.textContent.trim().slice(0, 60),
          })),
        };
        
        console.log("SUBMIT SPY:", JSON.stringify(window.__submitSpyData));
      }, true);  // true = capturing phase, fires before bubbling
    });

    // === STEP 2: Type into fields ===
    console.error("\n=== TYPING INTO FIELDS ===");
    await page.click('#email');
    await sleep(300);
    await page.keyboard.type(email, { delay: 20 });
    await sleep(500);

    // Check validation state AFTER typing email
    const afterEmail = await page.evaluate(() => {
      const emailEl = document.querySelector('#email');
      return {
        value: emailEl?.value,
        ariaInvalid: emailEl?.getAttribute('aria-invalid'),
        ariaDescribedBy: emailEl?.getAttribute('aria-describedby'),
        parentClasses: emailEl?.parentElement?.className?.slice(0, 100),
        // Check validation elements for email
        emailValidators: Array.from(document.querySelectorAll('[data-ulp-validation-target="email"]')).map(el => ({
          functionName: el.getAttribute('data-ulp-validation-function'),
          hasError: el.classList.contains('ulp-validator-error'),
          dataIsError: el.getAttribute('data-is-error'),
          display: window.getComputedStyle(el).display,
        })),
      };
    });
    console.error(`After email: ${JSON.stringify(afterEmail)}`);

    await page.keyboard.press("Tab");
    await sleep(300);
    await page.keyboard.type(password, { delay: 20 });
    await sleep(500);

    // Check validation state AFTER typing password
    const afterPwd = await page.evaluate(() => {
      const pwdEl = document.querySelector('#password');
      return {
        value: pwdEl?.value?.length,
        ariaInvalid: pwdEl?.getAttribute('aria-invalid'),
        parentClasses: pwdEl?.parentElement?.className?.slice(0, 100),
        // Check password policy widget state
        policyWidget: document.querySelector('.cbc47e89c.c27eb6e0f') ? {
          hasHide: document.querySelector('.cbc47e89c.c27eb6e0f').classList.contains('hide'),
          dataShown: document.querySelector('.cbc47e89c.c27eb6e0f').getAttribute('data-shown'),
        } : "NOT FOUND",
        // Check for c51819df4 class on password (this indicates valid password)
        passwordHasValid: pwdEl?.classList.contains('c51819df4'),
        passwordClasses: pwdEl?.className,
        // All validation targets
        allValidators: Array.from(document.querySelectorAll('[data-ulp-validation-function]')).map(el => ({
          fn: el.getAttribute('data-ulp-validation-function'),
          target: el.getAttribute('data-ulp-validation-target'),
          hasError: el.classList.contains('ulp-validator-error'),
          dataIsError: el.getAttribute('data-is-error'),
        })),
      };
    });
    console.error(`After password: ${JSON.stringify(afterPwd, null, 2)}`);

    // === STEP 3: Before clicking submit, manually fire validation events ===
    console.error("\n=== MANUAL VALIDATION TRIGGER ===");
    const manualValidation = await page.evaluate(() => {
      const emailEl = document.querySelector('#email');
      const pwdEl = document.querySelector('#password');
      
      // Fire 'input' and 'change' events on both fields to trigger ULP's listeners
      // These listeners were set up by: s(T,"input",O), s(T,"keyup",q) for password
      // and the C(element) function which reads data-ulp-validation-event-listeners
      
      if (emailEl) {
        emailEl.dispatchEvent(new Event('input', { bubbles: true }));
        emailEl.dispatchEvent(new Event('change', { bubbles: true }));
        emailEl.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      if (pwdEl) {
        pwdEl.dispatchEvent(new Event('input', { bubbles: true }));
        pwdEl.dispatchEvent(new Event('change', { bubbles: true }));
        pwdEl.dispatchEvent(new Event('keyup', { bubbles: true }));
        pwdEl.dispatchEvent(new Event('blur', { bubbles: true }));
      }
      
      // Wait a tick and check validation state
      return new Promise(resolve => {
        setTimeout(() => {
          resolve({
            emailValidators: Array.from(document.querySelectorAll('[data-ulp-validation-target="email"]')).map(el => ({
              fn: el.getAttribute('data-ulp-validation-function'),
              hasError: el.classList.contains('ulp-validator-error'),
              dataIsError: el.getAttribute('data-is-error'),
              display: window.getComputedStyle(el).display,
            })),
            passwordValidators: Array.from(document.querySelectorAll('[data-ulp-validation-target="password"]')).map(el => ({
              fn: el.getAttribute('data-ulp-validation-function'),
              hasError: el.classList.contains('ulp-validator-error'),
              dataIsError: el.getAttribute('data-is-error'),
              display: window.getComputedStyle(el).display,
            })),
            emailAriaInvalid: emailEl?.getAttribute('aria-invalid'),
            passwordAriaInvalid: pwdEl?.getAttribute('aria-invalid'),
            // Check password class
            passwordHasValid: pwdEl?.classList.contains('c51819df4'),
            // Check policy widget
            policyHidden: document.querySelector('.cbc47e89c.c27eb6e0f')?.classList.contains('hide'),
          });
        }, 500);
      });
    });
    console.error(`Manual validation: ${JSON.stringify(manualValidation, null, 2)}`);

    // === STEP 4: Click submit and check spy data ===
    console.error("\n=== CLICKING SUBMIT ===");
    
    let responseStatus = null;
    let responseUrl = null;
    page.on("response", (resp) => {
      if (resp.request().method() === "POST" && resp.url().includes("signup")) {
        responseStatus = resp.status();
        responseUrl = resp.url();
        console.error(`[response] POST ${resp.status()} ${resp.url().slice(0, 100)}`);
      }
    });

    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);
    
    // Get spy data
    const spyData = await page.evaluate(() => window.__submitSpyData).catch(() => null);
    console.error(`\nSubmit spy data: ${JSON.stringify(spyData, null, 2)}`);
    console.error(`Response: ${responseStatus} at ${responseUrl}`);
    console.error(`Current URL: ${page.url()}`);

    // Check if we actually got through
    const finalState = await page.evaluate(() => {
      return {
        url: window.location.href,
        title: document.title,
        // Is there a consent/checkbox screen?
        checkboxes: Array.from(document.querySelectorAll('input[type="checkbox"]')).map(cb => ({
          checked: cb.checked,
          label: cb.closest('label')?.textContent?.trim()?.slice(0, 60) || 
                 cb.parentElement?.textContent?.trim()?.slice(0, 60),
        })),
        buttons: Array.from(document.querySelectorAll('button')).map(b => b.textContent.trim().slice(0, 30)),
        // Any visible errors
        visibleErrors: Array.from(document.querySelectorAll('[class*="error"]')).filter(el => {
          const style = window.getComputedStyle(el);
          return style.display !== 'none' && el.offsetHeight > 0;
        }).map(el => el.textContent.trim().slice(0, 60)),
      };
    });
    console.error(`\nFinal state: ${JSON.stringify(finalState, null, 2)}`);

    await page.screenshot({ path: "/app/runtime/promed/debug-submit-spy.png" });

  } catch (err) {
    console.error(`[test] ERROR: ${err.message}`);
    await page.screenshot({ path: "/app/runtime/promed/debug-submit-spy-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
