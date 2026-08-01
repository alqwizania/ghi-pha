// Temporary script to extract Auth0 client_id and connection from ProMED's signup page
const { chromium } = require("playwright-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
chromium.use(StealthPlugin());

(async () => {
  const browser = await chromium.launch({ headless: true, args: ["--no-first-run"] });
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: "en-US",
    timezoneId: "America/New_York",
  });
  const page = await context.newPage();

  // Capture all network requests
  const capturedRequests = [];
  page.on("request", (req) => {
    const url = req.url();
    if (url.includes("auth") || url.includes("client_id") || url.includes("dbconnections")) {
      capturedRequests.push({ method: req.method(), url, postData: req.postData() });
    }
  });

  // Capture all network responses
  const capturedResponses = [];
  page.on("response", async (resp) => {
    const url = resp.url();
    if (url.includes("client") || url.includes("config") || url.includes("authorize")) {
      try {
        const body = await resp.text().catch(() => "");
        if (body.includes("client_id") || body.includes("connection")) {
          capturedResponses.push({ url, status: resp.status(), bodySnippet: body.slice(0, 2000) });
        }
      } catch {}
    }
  });

  console.log("1. Navigating to ProMED...");
  await page.goto("https://www.promedmail.org/", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(3000);

  console.log("2. Clicking Login...");
  await page.getByRole("link", { name: /login/i }).first().click({ timeout: 25000 });
  await page.waitForTimeout(3000);
  console.log(`   URL: ${page.url()}`);

  // Extract config from the Auth0 page HTML/JS
  const pageConfig = await page.evaluate(() => {
    // Look for client_id in page source, meta tags, scripts, hidden inputs
    const html = document.documentElement.outerHTML;
    const results = {};

    // Check for client_id in URL params
    const urlParams = new URLSearchParams(window.location.search);
    results.url_client_id = urlParams.get("client_id");

    // Check for client_id in hidden inputs
    const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
    results.hidden_inputs = Array.from(hiddenInputs).map(inp => ({
      name: inp.name,
      value: inp.value.slice(0, 100),
    }));

    // Check for config in script tags
    const scripts = document.querySelectorAll("script");
    for (const script of scripts) {
      const text = script.textContent || "";
      // Look for client_id patterns
      const clientIdMatch = text.match(/client[_-]?id['":\s]*['"]([a-zA-Z0-9]{20,50})['"]/i);
      if (clientIdMatch) {
        results.script_client_id = clientIdMatch[1];
      }
      // Look for connection patterns
      const connMatch = text.match(/connection['":\s]*['"]([a-zA-Z0-9_-]+)['"]/i);
      if (connMatch) {
        results.script_connection = connMatch[1];
      }
      // Look for Auth0 config object
      if (text.includes("Auth0") || text.includes("auth0") || text.includes("clientID")) {
        results.auth0_script_snippet = text.slice(0, 3000);
      }
    }

    // Check meta tags
    const metas = document.querySelectorAll("meta");
    results.meta_tags = Array.from(metas).map(m => ({
      name: m.name || m.getAttribute("property"),
      content: (m.content || "").slice(0, 100),
    })).filter(m => m.name || m.content);

    // Extract from URL
    results.current_url = window.location.href;

    // Look for client_id in the full HTML (regex)
    const htmlClientId = html.match(/client[_-]?[iI]d['"=:\s]+['"]?([a-zA-Z0-9]{20,50})/);
    if (htmlClientId) results.html_client_id = htmlClientId[1];

    // Look for connection in the full HTML
    const htmlConn = html.match(/"connection":\s*"([^"]+)"/);
    if (htmlConn) results.html_connection = htmlConn[1];

    // Check forms
    const forms = document.querySelectorAll("form");
    results.forms = Array.from(forms).map(f => ({
      action: f.action,
      method: f.method,
      id: f.id,
      inputs: Array.from(f.querySelectorAll("input")).map(i => ({
        name: i.name,
        type: i.type,
        id: i.id,
        value: i.type === "hidden" ? i.value.slice(0, 200) : "(omitted)",
      })),
    }));

    return results;
  });

  console.log("\n=== PAGE CONFIG ===");
  console.log(JSON.stringify(pageConfig, null, 2));

  // Now click "Sign up" to see if the signup page has different config
  console.log("\n3. Clicking Sign Up...");
  try {
    const signupLink = page.locator("a:has-text('Sign up')").first();
    await signupLink.click({ timeout: 10000 });
    await page.waitForTimeout(2000);
    console.log(`   Signup URL: ${page.url()}`);

    const signupConfig = await page.evaluate(() => {
      const html = document.documentElement.outerHTML;
      const results = {};

      // URL params
      const urlParams = new URLSearchParams(window.location.search);
      results.url_client_id = urlParams.get("client_id");
      results.current_url = window.location.href;

      // Hidden inputs
      const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
      results.hidden_inputs = Array.from(hiddenInputs).map(inp => ({
        name: inp.name,
        value: inp.value.slice(0, 200),
      }));

      // Forms
      const forms = document.querySelectorAll("form");
      results.forms = Array.from(forms).map(f => ({
        action: f.action,
        method: f.method,
        id: f.id,
        inputs: Array.from(f.querySelectorAll("input")).map(i => ({
          name: i.name,
          type: i.type,
          id: i.id,
          value: i.type === "hidden" ? i.value.slice(0, 200) : "(omitted)",
        })),
      }));

      // Full regex scan for client_id
      const htmlClientId = html.match(/client[_-]?[iI]d['"=:\s]+['"]?([a-zA-Z0-9]{20,50})/);
      if (htmlClientId) results.html_client_id = htmlClientId[1];

      // Look for state parameter (contains encoded config)
      const stateParam = urlParams.get("state");
      if (stateParam) results.state_param = stateParam.slice(0, 200);

      return results;
    });

    console.log("\n=== SIGNUP PAGE CONFIG ===");
    console.log(JSON.stringify(signupConfig, null, 2));
  } catch (e) {
    console.error(`Sign up click failed: ${e.message}`);
  }

  // Also try to extract from the /authorize URL that Auth0 redirected to
  console.log("\n=== CAPTURED AUTH REQUESTS ===");
  for (const req of capturedRequests) {
    console.log(JSON.stringify(req, null, 2));
  }

  console.log("\n=== CAPTURED CONFIG RESPONSES ===");
  for (const resp of capturedResponses) {
    console.log(JSON.stringify(resp, null, 2));
  }

  // Try to directly fetch the Auth0 client configuration
  console.log("\n4. Trying Auth0 client config endpoint...");
  const configUrl = page.url().match(/https:\/\/([^/]+)/)?.[1];
  if (configUrl) {
    console.log(`   Auth0 domain: ${configUrl}`);
    // Auth0 exposes client config at /.well-known/openid-configuration
    try {
      const configResp = await page.evaluate(async (domain) => {
        const resp = await fetch(`https://${domain}/.well-known/openid-configuration`);
        return resp.text();
      }, configUrl);
      console.log(`   OpenID config: ${configResp.slice(0, 1000)}`);
    } catch (e) {
      console.error(`   Config fetch failed: ${e.message}`);
    }
  }

  await browser.close();
  console.log("\nDone.");
})();
