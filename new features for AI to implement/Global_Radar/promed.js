// ProMED batch resolver for SehaRadar.
// Usage: node promed.js --resolve-batch /path/to/payload.json

const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const fs = require("fs");

// Apply stealth plugin — hides headless/automation signals from bot detection
chromium.use(StealthPlugin());

const DEFAULT_BASE_URL = "https://www.promedmail.org/";
const ROW_XPATH_TEMPLATE =
  "/html/body/div[2]/article/div/section[1]/div[2]/div/div[1]/div/div[2]/div[2]/div/div/div/table/tbody/tr[%ROW%]/td[2]/div";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseArgs() {
  const args = process.argv.slice(2);
  const idx = args.indexOf("--resolve-batch");
  if (idx === -1 || !args[idx + 1]) {
    return { mode: "help" };
  }
  return { mode: "resolve-batch", payloadPath: args[idx + 1] };
}

function normalizeTitle(title) {
  return String(title || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function readPayload(payloadPath) {
  const raw = fs.readFileSync(payloadPath, "utf8");
  const payload = JSON.parse(raw);
  const titles = Array.isArray(payload.titles)
    ? payload.titles.filter((v) => typeof v === "string" && v.trim())
    : [];
  const targets = Array.isArray(payload.targets)
    ? payload.targets
        .filter((v) => v && typeof v.title === "string" && v.title.trim())
        .map((v, idx) => ({
          title: String(v.title),
          row_number:
            Number.isInteger(v.row_number) && v.row_number > 0 ? v.row_number : idx + 1,
        }))
    : [];

  return {
    baseUrl: payload.base_url || DEFAULT_BASE_URL,
    headless: payload.headless !== false,
    email: typeof payload.email === "string" ? payload.email.trim() : "",
    password: typeof payload.password === "string" ? payload.password.trim() : "",
    titles,
    targets,
  };
}

// ---------------------------------------------------------------------------
// Authentication helpers
// ---------------------------------------------------------------------------

async function isAuthenticated(page) {
  // ProMED keeps the "Login" nav link visible even after authentication,
  // so we cannot rely on its presence/absence.  Instead, check for an
  // authenticated-only element: the article table or the "Read Full Article"
  // button.  As a lightweight proxy, try hitting the profile API endpoint.
  await sleep(1500);

  // Check if we can see the article table (only visible to logged-in users)
  const tableVisible = await page
    .locator("table tbody tr")
    .first()
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (tableVisible) {
    return true;
  }

  // Fallback: check for logout link or profile indicator
  const hasLogout = await page
    .locator('a[href*="logout"], a[href*="auth/logout"]')
    .first()
    .isVisible({ timeout: 3000 })
    .catch(() => false);

  return hasLogout;
}

async function loginAndOpenHome(page, baseUrl, email, password) {
  console.error("[auth] Logging in with provided credentials...");
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await sleep(3000);

  // Click Login link scoped to navigation (matches Playwright codegen recording)
  await page
    .getByRole("navigation")
    .getByRole("link", { name: "Login" })
    .click({ timeout: 25000 });
  await sleep(4000);
  console.error(`[auth] Auth page URL: ${page.url()}`);

  // Auth0 uses React — we need to trigger React's synthetic events properly.
  // Strategy: use evaluate() to set values via native input setter + dispatch
  // React-compatible events, then verify and submit.
  // Try role-based selectors, fall back to #id.
  const emailByRole = page.getByRole("textbox", { name: "Email address" });
  const passwordByRole = page.getByRole("textbox", { name: "Password" });

  const emailCount = await emailByRole.count().catch(() => 0);
  const emailLocator = emailCount > 0 ? emailByRole : page.locator("#username");
  const passwordCount = await passwordByRole.count().catch(() => 0);
  const passwordLocator = passwordCount > 0 ? passwordByRole : page.locator("#password");

  // Helper: set input value in a way that React's onChange recognises
  async function reactFill(locator, value) {
    await locator.click({ timeout: 15000 });
    await sleep(200);

    const element = await locator.elementHandle();
    await page.evaluate(
      ([el, val]) => {
        // Use React's internal value setter to trigger onChange
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, "value"
        ).set;
        nativeInputValueSetter.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      },
      [element, value],
    );
    await sleep(300);
  }

  await reactFill(emailLocator, email);
  await reactFill(passwordLocator, password);

  // Verify values
  const emailValue = await emailLocator.inputValue().catch(() => "");
  const passwordValue = await passwordLocator.inputValue().catch(() => "");
  console.error(
    `[auth] Email filled: ${emailValue ? "yes" : "NO"}, Password filled: ${passwordValue ? "yes" : "NO"}`,
  );
  if (!emailValue || !passwordValue) {
    throw new Error("Could not populate login credentials");
  }

  // Handle Cloudflare Turnstile CAPTCHA.
  // With playwright-extra + stealth plugin, Turnstile should auto-solve without
  // manual intervention. We detect if a CAPTCHA container is present and wait
  // for it to complete (hidden input gets a token value, or container disappears).
  const turnstileContainer = page.locator(".ulp-captcha-container, #ulp-auth0-v2-captcha").first();
  const hasContainer = await turnstileContainer
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (hasContainer) {
    console.error("[auth] Turnstile CAPTCHA container detected — waiting for auto-solve via stealth plugin...");

    // Poll for up to 20s: check if Turnstile solved (hidden input gets a token value)
    let captchaSolved = false;
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(1000);

      // Check 1: hidden captcha input has a token value (Auth0 sets this when Turnstile completes)
      const tokenValue = await page.evaluate(() => {
        const inputs = document.querySelectorAll('input[name*="captcha"], input[name*="turnstile"], input[type="hidden"][name*="cf"]');
        for (const inp of inputs) {
          if (inp.value && inp.value.length > 10) return inp.value.slice(0, 20) + "...";
        }
        // Also check for cf-turnstile response
        const cfInput = document.querySelector('[name="cf-turnstile-response"]');
        if (cfInput && cfInput.value && cfInput.value.length > 10) return cfInput.value.slice(0, 20) + "...";
        return null;
      }).catch(() => null);

      if (tokenValue) {
        console.error(`[auth] Turnstile auto-solved (token: ${tokenValue}) after ${attempt + 1}s`);
        captchaSolved = true;
        break;
      }

      // Check 2: container became hidden or was removed (Turnstile completed and hid itself)
      const stillVisible = await turnstileContainer.isVisible().catch(() => false);
      if (!stillVisible) {
        console.error(`[auth] Turnstile container disappeared after ${attempt + 1}s — likely solved`);
        captchaSolved = true;
        break;
      }

      // Check 3: look for a success indicator inside the Turnstile iframe
      const iframeSuccess = await page.evaluate(() => {
        const iframe = document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]');
        if (!iframe) return null;
        // If the iframe has data attributes indicating success
        return iframe.getAttribute("data-status") || null;
      }).catch(() => null);

      if (iframeSuccess === "solved" || iframeSuccess === "ready") {
        console.error(`[auth] Turnstile iframe status: ${iframeSuccess} after ${attempt + 1}s`);
        captchaSolved = true;
        break;
      }

      if (attempt % 5 === 4) {
        console.error(`[auth] Still waiting for Turnstile... (${attempt + 1}s)`);
      }
    }

    if (!captchaSolved) {
      console.error("[auth] Turnstile did NOT auto-solve within 20s");
      await page.screenshot({ path: "/tmp/promed_captcha_timeout.png", fullPage: true }).catch(() => {});
      // Attempt a click on the Turnstile iframe as last resort
      try {
        const turnstileFrame = page.frameLocator(
          'iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"]'
        );
        await turnstileFrame.locator("body").first().click({ timeout: 5000, position: { x: 28, y: 28 } });
        console.error("[auth] Last-resort click inside Turnstile iframe");
        await sleep(5000);
      } catch (e) {
        console.error(`[auth] Last-resort Turnstile click failed: ${e.message.slice(0, 100)}`);
      }
    }
  } else {
    console.error("[auth] No CAPTCHA container detected — proceeding");
  }

  // Submit via Continue button (matches recording), fall back to Enter
  const continueBtn = page.getByRole("button", { name: /continue/i }).first();
  const hasContinue = await continueBtn.isVisible({ timeout: 3000 }).catch(() => false);
  if (hasContinue) {
    await continueBtn.click({ timeout: 15000 });
  } else {
    await page.keyboard.press("Enter");
  }

  // Wait for redirect back to ProMED (Auth0 redirects after successful login)
  const redirected = await page
    .waitForURL(
      (url) => {
        const host = url.hostname;
        return host.includes("promedmail.org") && !host.startsWith("auth.");
      },
      { timeout: 30000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!redirected) {
    // Check for error messages on the Auth0 page
    const errorText = await page
      .locator('[class*="error"], [id*="error"], [role="alert"]')
      .first()
      .textContent({ timeout: 3000 })
      .catch(() => "");
    if (errorText) {
      console.error(`[auth] Auth0 error: ${errorText.trim().slice(0, 200)}`);
    }
    console.error(`[auth] Still on: ${page.url()}`);
    throw new Error("Login redirect to ProMED did not complete");
  }

  console.error(`[auth] Login successful — redirected to: ${page.url()}`);

  // Navigate to home page with article table
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await sleep(2000);
  await page.getByRole("link", { name: /^home$/i }).first().click({ timeout: 25000 });
  await sleep(1000);
}

// ---------------------------------------------------------------------------
// Article interaction
// ---------------------------------------------------------------------------

function getRowXPath(rowNumber) {
  return ROW_XPATH_TEMPLATE.replace("%ROW%", String(rowNumber));
}

async function clickByRowXPath(page, rowNumber) {
  if (!Number.isInteger(rowNumber) || rowNumber < 1) {
    return false;
  }

  const rowLocator = page.locator(`xpath=${getRowXPath(rowNumber)}`);
  const visible = await rowLocator
    .waitFor({ state: "visible", timeout: 12000 })
    .then(() => true)
    .catch(() => false);

  if (!visible) {
    return false;
  }

  await rowLocator.click({ timeout: 12000 });
  await sleep(1000);
  return true;
}

async function findAndOpenTitle(page, title, rowNumber) {
  const openedByRow = await clickByRowXPath(page, rowNumber);
  if (openedByRow) {
    return true;
  }

  const candidates = [
    title,
    title.toUpperCase(),
    title.slice(0, 140),
    title.slice(0, 100),
    title.slice(0, 80),
  ].filter((v, i, arr) => v && arr.indexOf(v) === i);

  for (const candidate of candidates) {
    const locator = page.getByText(candidate, { exact: false }).first();
    const visible = await locator
      .waitFor({ state: "visible", timeout: 7000 })
      .then(() => true)
      .catch(() => false);

    if (!visible) {
      continue;
    }

    await locator.click({ timeout: 10000 });
    await sleep(1000);
    return true;
  }

  return false;
}

function looksExternalUrl(url, baseUrl) {
  if (!url || !url.startsWith("http")) {
    return false;
  }

  try {
    const baseHost = new URL(baseUrl).hostname.replace(/^www\./, "");
    const host = new URL(url).hostname.replace(/^www\./, "");
    return host !== baseHost;
  } catch {
    return false;
  }
}

async function extractFromRadixXpath(page, baseUrl) {
  const radixLinks = page.locator(
    'xpath=//*[starts-with(@id,"radix-")]//p/a[@href]',
  );
  const hrefs = await radixLinks.evaluateAll((els) =>
    els
      .map((el) => {
        const href = el.getAttribute("href") || "";
        if (!href) {
          return "";
        }
        try {
          return new URL(href, window.location.href).toString();
        } catch {
          return "";
        }
      })
      .filter(Boolean),
  );

  if (!hrefs.length) {
    return null;
  }

  const external = hrefs.find((href) => looksExternalUrl(href, baseUrl));
  if (external) {
    return external;
  }

  const absoluteHttp = hrefs.find((href) => href.startsWith("http"));
  return absoluteHttp || null;
}

async function extractExternalLink(page, baseUrl) {
  const radixPreClick = await extractFromRadixXpath(page, baseUrl);
  if (radixPreClick) {
    return radixPreClick;
  }

  const readBtn = page.getByRole("button", { name: /read full article/i }).first();
  const canRead = await readBtn
    .waitFor({ state: "visible", timeout: 8000 })
    .then(() => true)
    .catch(() => false);

  if (!canRead) {
    return null;
  }

  const initialUrl = page.url();
  const popupPromise = page.context().waitForEvent("page", { timeout: 7000 }).catch(() => null);
  const requestPromise = page
    .waitForRequest((req) => looksExternalUrl(req.url(), baseUrl), { timeout: 7000 })
    .catch(() => null);

  await readBtn.click({ timeout: 15000 });
  await sleep(1200);

  const popup = await popupPromise;
  if (popup) {
    await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
    const popupUrl = popup.url();
    if (looksExternalUrl(popupUrl, baseUrl)) {
      await popup.close().catch(() => {});
      return popupUrl;
    }
    await popup.close().catch(() => {});
  }

  const externalRequest = await requestPromise;
  if (externalRequest && looksExternalUrl(externalRequest.url(), baseUrl)) {
    return externalRequest.url();
  }

  const currentUrl = page.url();
  if (currentUrl !== initialUrl && looksExternalUrl(currentUrl, baseUrl)) {
    return currentUrl;
  }

  const radixPostClick = await extractFromRadixXpath(page, baseUrl);
  if (radixPostClick) {
    return radixPostClick;
  }

  const hrefs = await page
    .locator("a[href]")
    .evaluateAll((els) =>
      els
        .map((el) => {
          const href = el.getAttribute("href") || "";
          if (!href) {
            return "";
          }
          try {
            return new URL(href, window.location.href).toString();
          } catch {
            return "";
          }
        })
        .filter(Boolean),
    );

  const external = hrefs.find((href) => looksExternalUrl(href, baseUrl));
  return external || null;
}

async function closeArticle(page) {
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(500);
  await page.keyboard.press("Escape").catch(() => {});
  await sleep(500);
}

// ---------------------------------------------------------------------------
// Main batch resolver
// ---------------------------------------------------------------------------

async function resolveBatch(payload) {
  const browser = await chromium.launch({
    headless: payload.headless,
    args: [
      "--no-first-run",
      "--no-default-browser-check",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    colorScheme: "light",
    timezoneId: "America/New_York",
  });

  const page = await context.newPage();

  const resolved = [];
  const failed = [];
  let usedEmail = "";

  try {
    // Auth strategy: single authenticated account from payload/.env only
    const hasCredentials = payload.email && payload.password;

    if (!hasCredentials) {
      console.error("[auth] Missing ProMED credentials (email/password)");
      const allTitles = (payload.targets && payload.targets.length)
        ? payload.targets
        : payload.titles.map((t, i) => ({ title: t, row_number: i + 1 }));
      for (const item of allTitles) {
        failed.push({ title: item.title, reason: "missing_credentials", row: item.row_number || 0 });
      }
      return { email: "", resolved, failed, error: "missing_credentials" };
    }

    await loginAndOpenHome(page, payload.baseUrl, payload.email, payload.password);
    usedEmail = payload.email;

    // Verify authentication before spending time on articles
    const authed = await isAuthenticated(page);
    if (!authed) {
      console.error("[auth] Authentication verification FAILED — page is still unauthenticated");
      const allTitles = (payload.targets && payload.targets.length)
        ? payload.targets
        : payload.titles.map((t, i) => ({ title: t, row_number: i + 1 }));
      for (const item of allTitles) {
        failed.push({ title: item.title, reason: "auth_failed", row: item.row_number || 0 });
      }
      return { email: usedEmail, resolved, failed, error: "auth_failed" };
    }
    console.error("[auth] Authentication verified OK");

    const workItems = payload.targets && payload.targets.length
      ? payload.targets
      : payload.titles.map((title, index) => ({ title, row_number: index + 1 }));

    for (let i = 0; i < workItems.length; i += 1) {
      const title = workItems[i].title;
      const rowNumber = Number.isInteger(workItems[i].row_number) ? workItems[i].row_number : i + 1;
      const opened = await findAndOpenTitle(page, title, rowNumber);
      if (!opened) {
        failed.push({ title, reason: "title_not_found", row: rowNumber });
        continue;
      }

      const url = await extractExternalLink(page, payload.baseUrl);
      if (url) {
        resolved.push({ title, url, row: rowNumber });
      } else {
        failed.push({ title, reason: "external_link_not_found", row: rowNumber });
      }

      await closeArticle(page);
    }

    return { email: usedEmail, resolved, failed };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs();
  if (args.mode !== "resolve-batch") {
    console.log("Usage: node promed.js --resolve-batch /path/to/payload.json");
    process.exit(1);
  }

  let payload;
  try {
    payload = readPayload(args.payloadPath);
  } catch (error) {
    console.error(`Failed to read payload: ${error.message}`);
    process.exit(1);
  }

  const hasTargets = Array.isArray(payload.targets) && payload.targets.length > 0;
  if (!payload.titles.length && !hasTargets) {
    console.log(`PROMED_RESOLVE_JSON:${JSON.stringify({ resolved: [], failed: [] })}`);
    process.exit(0);
  }

  const uniqueTargets = [];
  const seen = new Set();

  if (hasTargets) {
    for (const target of payload.targets) {
      const key = normalizeTitle(target.title);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueTargets.push(target);
    }
  } else {
    for (const title of payload.titles) {
      const key = normalizeTitle(title);
      if (!key || seen.has(key)) {
        continue;
      }
      seen.add(key);
      uniqueTargets.push({ title, row_number: uniqueTargets.length + 1 });
    }
  }

  payload.targets = uniqueTargets.slice(0, 5);
  payload.titles = payload.targets.map((t) => t.title);

  try {
    const result = await resolveBatch(payload);
    console.log(`PROMED_RESOLVE_JSON:${JSON.stringify(result)}`);
    process.exit(0);
  } catch (error) {
    console.error(`Resolver failure: ${error.message}`);
    process.exit(2);
  }
}

main();
