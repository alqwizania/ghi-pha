#!/usr/bin/env node
/**
 * Inspect Auth0's ULP (Universal Login Page) JavaScript internals
 * to understand how it tracks form field state.
 * 
 * This script:
 * 1. Navigates to the ProMED signup page
 * 2. Intercepts and logs all JS bundles loaded
 * 3. Inspects the DOM for React/Preact/custom framework fiber nodes
 * 4. Tests various input event strategies to see which ones register
 * 5. Tries to find and call internal state setters
 */
const { chromium } = require("playwright-extra");
const stealth = require("puppeteer-extra-plugin-stealth")();
chromium.use(stealth);

const BASE_URL = "https://promedmail.org";
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });

  const context = await browser.newContext({
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
    viewport: { width: 1280, height: 720 },
  });

  const page = await context.newPage();

  // Intercept network to find JS bundles
  const jsBundles = [];
  page.on("response", async (response) => {
    const url = response.url();
    if (url.includes("ulp") && url.endsWith(".js")) {
      jsBundles.push(url);
    }
  });

  try {
    // Navigate to homepage and then to signup
    console.error("[inspect] Navigating to ProMED homepage...");
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await sleep(2000);

    console.error("[inspect] Clicking Login...");
    await page.getByRole("link", { name: /login/i }).first().click({ timeout: 15000 });
    await sleep(3000);
    console.error(`[inspect] Login page URL: ${page.url()}`);

    console.error("[inspect] Clicking Sign up...");
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
    console.error(`[inspect] Signup page URL: ${page.url()}`);

    // Log JS bundles found
    console.error(`\n[inspect] === JS BUNDLES LOADED ===`);
    for (const url of jsBundles) {
      console.error(`  ${url}`);
    }

    // Deep inspection of the signup form
    console.error(`\n[inspect] === FORM INSPECTION ===`);
    const formInfo = await page.evaluate(() => {
      const results = {};

      // 1. Find all forms
      const forms = document.querySelectorAll("form");
      results.formCount = forms.length;
      results.forms = Array.from(forms).map((f, i) => ({
        index: i,
        action: f.action,
        method: f.method,
        id: f.id,
        className: f.className,
        onsubmit: f.onsubmit ? f.onsubmit.toString().slice(0, 200) : null,
      }));

      // 2. Find email and password inputs
      const emailInput = document.querySelector('#email') || 
                         document.querySelector('input[type="email"]') ||
                         document.querySelector('input[name="email"]');
      const passwordInput = document.querySelector('#password') ||
                           document.querySelector('input[type="password"]') ||
                           document.querySelector('input[name="password"]');

      if (emailInput) {
        // 3. Inspect React/Preact fiber on email input
        const emailKeys = Object.keys(emailInput);
        const reactFiberKey = emailKeys.find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
        const reactPropsKey = emailKeys.find(k => k.startsWith("__reactProps") || k.startsWith("__reactEvents"));
        
        results.emailInput = {
          id: emailInput.id,
          name: emailInput.name,
          type: emailInput.type,
          allKeys: emailKeys,
          hasReactFiber: !!reactFiberKey,
          reactFiberKey: reactFiberKey || null,
          reactPropsKey: reactPropsKey || null,
        };

        // Check if there's a React fiber with onChange
        if (reactPropsKey) {
          const props = emailInput[reactPropsKey];
          results.emailReactProps = {
            keys: Object.keys(props || {}),
            hasOnChange: !!(props && props.onChange),
            hasOnInput: !!(props && props.onInput),
            onChangeType: props?.onChange ? typeof props.onChange : null,
          };
        }

        if (reactFiberKey) {
          const fiber = emailInput[reactFiberKey];
          results.emailFiber = {
            type: fiber?.type?.toString?.()?.slice(0, 100),
            stateNode: fiber?.stateNode ? "exists" : "null",
            memoizedProps: fiber?.memoizedProps ? Object.keys(fiber.memoizedProps) : null,
            pendingProps: fiber?.pendingProps ? Object.keys(fiber.pendingProps) : null,
          };

          // Try to find onChange in memoizedProps or pendingProps
          if (fiber?.memoizedProps?.onChange) {
            results.emailFiberOnChange = "found in memoizedProps";
          }
          if (fiber?.pendingProps?.onChange) {
            results.emailFiberOnChange = "found in pendingProps";
          }
        }
      }

      // 4. Check for any global state management
      results.globalStateClues = {
        hasRedux: typeof window.__REDUX_DEVTOOLS_EXTENSION__ !== "undefined",
        hasReactRoot: !!document.querySelector("[data-reactroot]"),
        hasPreactRoot: !!document.querySelector("[__preactattr_]"),
        hasAngular: typeof window.ng !== "undefined",
        hasVue: typeof window.__VUE__ !== "undefined",
      };

      // 5. Check for Auth0-specific globals
      results.auth0Globals = {};
      for (const key of Object.keys(window)) {
        if (key.toLowerCase().includes("auth0") || 
            key.toLowerCase().includes("ulp") ||
            key.toLowerCase().includes("universal")) {
          results.auth0Globals[key] = typeof window[key];
        }
      }

      // 6. Look at all hidden inputs
      const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
      results.hiddenInputs = Array.from(hiddenInputs).map(h => ({
        name: h.name,
        value: h.value?.slice(0, 100),
        id: h.id,
      }));

      // 7. Check for event listeners on the form or inputs
      // (getEventListeners only works in DevTools, not via evaluate)
      // Instead, check for data attributes that might hint at framework bindings
      if (emailInput) {
        const emailAttrs = {};
        for (const attr of emailInput.attributes) {
          emailAttrs[attr.name] = attr.value?.slice(0, 100);
        }
        results.emailAttributes = emailAttrs;
      }

      if (passwordInput) {
        const pwdAttrs = {};
        for (const attr of passwordInput.attributes) {
          pwdAttrs[attr.name] = attr.value?.slice(0, 100);
        }
        results.passwordAttributes = pwdAttrs;
        
        const pwdKeys = Object.keys(passwordInput);
        const pwdReactPropsKey = pwdKeys.find(k => k.startsWith("__reactProps") || k.startsWith("__reactEvents"));
        results.passwordInput = {
          id: passwordInput.id,
          name: passwordInput.name,
          type: passwordInput.type,
          allKeys: pwdKeys,
          reactPropsKey: pwdReactPropsKey || null,
        };
        
        if (pwdReactPropsKey) {
          const props = passwordInput[pwdReactPropsKey];
          results.passwordReactProps = {
            keys: Object.keys(props || {}),
            hasOnChange: !!(props && props.onChange),
            hasOnInput: !!(props && props.onInput),
          };
        }
      }

      // 8. Look at the submit button
      const submitBtn = document.querySelector('button[type="submit"]') ||
                       document.querySelector('button[name="action"]') ||
                       document.querySelector('button:has(span)');
      if (submitBtn) {
        const btnKeys = Object.keys(submitBtn);
        const btnReactPropsKey = btnKeys.find(k => k.startsWith("__reactProps") || k.startsWith("__reactEvents"));
        results.submitButton = {
          type: submitBtn.type,
          name: submitBtn.name,
          value: submitBtn.value,
          textContent: submitBtn.textContent?.trim()?.slice(0, 50),
          allKeys: btnKeys,
          reactPropsKey: btnReactPropsKey || null,
        };
        
        if (btnReactPropsKey) {
          const props = submitBtn[btnReactPropsKey];
          results.submitReactProps = {
            keys: Object.keys(props || {}),
            hasOnClick: !!(props && props.onClick),
            hasOnSubmit: !!(props && props.onSubmit),
          };
        }
      }

      // 9. Check the form's parent container for React root
      const appRoot = document.querySelector("#app-root") || 
                     document.querySelector("#root") || 
                     document.querySelector("[data-reactroot]") ||
                     document.querySelector(".auth0-lock-widget") ||
                     document.querySelector("main");
      if (appRoot) {
        const rootKeys = Object.keys(appRoot);
        const rootFiberKey = rootKeys.find(k => k.startsWith("__reactFiber") || k.startsWith("__reactContainer"));
        results.appRoot = {
          tag: appRoot.tagName,
          id: appRoot.id,
          className: appRoot.className?.slice(0, 100),
          allKeys: rootKeys,
          reactFiberKey: rootFiberKey || null,
        };
      }

      return results;
    });

    console.error(JSON.stringify(formInfo, null, 2));

    // Now try Strategy: InputEvent with inputType 'insertText'
    console.error(`\n[inspect] === TESTING INPUT STRATEGIES ===`);
    
    const strategyResults = await page.evaluate(() => {
      const results = {};
      const emailInput = document.querySelector('#email') || 
                        document.querySelector('input[type="email"]') ||
                        document.querySelector('input[name="email"]');
      
      if (!emailInput) {
        return { error: "No email input found" };
      }

      // Record initial state
      results.initialValue = emailInput.value;

      // Strategy 1: InputEvent with inputType 'insertText'
      emailInput.focus();
      const testEmail = "test@example.com";
      
      // Clear first
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype, "value"
      ).set;
      nativeSetter.call(emailInput, "");
      emailInput.dispatchEvent(new Event("input", { bubbles: true }));
      
      // Type character by character using InputEvent
      for (const char of testEmail) {
        // This mimics what a real keyboard does in browsers
        const inputEvent = new InputEvent("input", {
          bubbles: true,
          cancelable: true,
          inputType: "insertText",
          data: char,
        });

        // First update the value
        nativeSetter.call(emailInput, emailInput.value + char);
        // Then fire the InputEvent
        emailInput.dispatchEvent(inputEvent);
      }

      results.afterInsertText = emailInput.value;

      // Check if there's a React fiber that tracks value
      const reactPropsKey = Object.keys(emailInput).find(k => k.startsWith("__reactProps") || k.startsWith("__reactEvents"));
      if (reactPropsKey) {
        const props = emailInput[reactPropsKey];
        results.reactPropsAfter = {
          value: props?.value,
          hasOnChange: !!props?.onChange,
        };
      }

      // Strategy 2: Try calling React's onChange directly
      if (reactPropsKey) {
        const props = emailInput[reactPropsKey];
        if (props?.onChange) {
          try {
            // Simulate a React SyntheticEvent
            const fakeEvent = {
              target: emailInput,
              currentTarget: emailInput,
              type: "change",
              nativeEvent: new Event("change"),
              preventDefault: () => {},
              stopPropagation: () => {},
              persist: () => {},
              bubbles: true,
            };
            // Force value on target
            Object.defineProperty(fakeEvent, "target", {
              get: () => ({ ...emailInput, value: testEmail }),
            });
            
            props.onChange(fakeEvent);
            results.afterReactOnChange = "called successfully";
          } catch (e) {
            results.afterReactOnChange = `error: ${e.message}`;
          }
        }
      }

      // Strategy 3: Find React fiber and try to set state
      const fiberKey = Object.keys(emailInput).find(k => k.startsWith("__reactFiber") || k.startsWith("__reactInternalInstance"));
      if (fiberKey) {
        const fiber = emailInput[fiberKey];
        
        // Walk up the fiber tree to find a component with setState
        let current = fiber;
        let stateComponents = [];
        for (let i = 0; i < 20 && current; i++) {
          if (current.stateNode && current.stateNode.setState) {
            stateComponents.push({
              depth: i,
              type: current.type?.name || current.type?.toString?.()?.slice(0, 50),
              stateKeys: current.stateNode.state ? Object.keys(current.stateNode.state) : null,
            });
          }
          // Also check hooks (for functional components)
          if (current.memoizedState) {
            const hookType = typeof current.memoizedState;
            if (hookType === "object" && current.memoizedState.queue) {
              stateComponents.push({
                depth: i,
                type: current.type?.name || "anonymous",
                hookBased: true,
                memoizedStateKeys: Object.keys(current.memoizedState),
              });
            }
          }
          current = current.return;
        }
        results.fiberTree = stateComponents;
      }

      return results;
    });

    console.error(JSON.stringify(strategyResults, null, 2));

    // Try approach: Just use page.fill and then check what happens when we click Continue
    console.error(`\n[inspect] === TESTING page.fill + SUBMIT ===`);
    
    // Reset the page - reload signup
    await page.reload({ waitUntil: "domcontentloaded" });
    await sleep(3000);
    
    const email = `seha.test.${Date.now()}@promedmail.org`;
    const password = "SehaR4dar!Tmp2026";
    
    // Try using page.fill
    const emailSel = '#email, input[type="email"], input[name="email"]';
    const pwdSel = '#password, input[type="password"], input[name="password"]';
    
    await page.locator(emailSel).first().focus();
    await sleep(200);
    
    // Use page.fill which triggers focus, clear, then type
    await page.locator(emailSel).first().fill(email);
    await sleep(500);
    
    // Check what Auth0 thinks
    const afterFill = await page.evaluate(() => {
      const emailEl = document.querySelector('#email') || document.querySelector('input[type="email"]');
      const form = emailEl?.closest('form');
      
      return {
        emailValue: emailEl?.value,
        formData: form ? Object.fromEntries(new FormData(form)) : null,
        // Check for error messages already showing
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim()).filter(t => t.length > 0),
      };
    });
    console.error(`After page.fill email: ${JSON.stringify(afterFill)}`);

    await page.locator(pwdSel).first().fill(password);
    await sleep(500);

    const afterBothFill = await page.evaluate(() => {
      const emailEl = document.querySelector('#email') || document.querySelector('input[type="email"]');
      const pwdEl = document.querySelector('#password') || document.querySelector('input[type="password"]');
      return {
        emailValue: emailEl?.value,
        passwordValue: pwdEl?.value?.length,
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim()).filter(t => t.length > 0),
      };
    });
    console.error(`After both fills: ${JSON.stringify(afterBothFill)}`);

    // Click Continue and capture what happens
    console.error("\n[inspect] Clicking Continue...");
    
    // Set up request interception to see what gets POSTed
    const postedRequests = [];
    page.on("request", (req) => {
      if (req.method() === "POST" && req.url().includes("auth")) {
        postedRequests.push({
          url: req.url(),
          postData: req.postData()?.slice(0, 500),
          headers: Object.fromEntries(
            Object.entries(req.headers()).filter(([k]) => 
              ["content-type", "origin", "referer"].includes(k)
            )
          ),
        });
      }
    });

    page.on("response", (resp) => {
      if (resp.url().includes("auth") && resp.request().method() === "POST") {
        console.error(`[inspect] POST response: ${resp.status()} ${resp.url()}`);
      }
    });

    await page.getByRole("button", { name: /continue/i }).first().click({ timeout: 15000 });
    await sleep(5000);
    
    console.error(`\n[inspect] POST requests captured: ${postedRequests.length}`);
    for (const req of postedRequests) {
      console.error(JSON.stringify(req, null, 2));
    }

    // Check page state after submit
    const afterSubmit = await page.evaluate(() => {
      return {
        url: window.location.href,
        errors: Array.from(document.querySelectorAll('[class*="error"], [role="alert"]'))
          .map(e => e.textContent.trim()).filter(t => t.length > 0),
        title: document.title,
      };
    });
    console.error(`After submit: ${JSON.stringify(afterSubmit)}`);

    await page.screenshot({ path: "/app/runtime/promed/inspect-after-submit.png" });
    console.error("[inspect] Screenshot saved to /app/runtime/promed/inspect-after-submit.png");

  } catch (err) {
    console.error(`[inspect] ERROR: ${err.message}`);
    await page.screenshot({ path: "/app/runtime/promed/inspect-error.png" }).catch(() => {});
  } finally {
    await browser.close();
  }
})();
