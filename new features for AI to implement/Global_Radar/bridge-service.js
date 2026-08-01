#!/usr/bin/env node
/**
 * Health Agent Bridge Service - Phase 2 Implementation
 * Connects ChangeDetection.io webhooks to Health Surveillance Agent workflow
 * 
 * @version 2.0.0
 * @status PRODUCTION READY
 * @implemented Phase 2 - Full webhook processing, HTML parsing, findings writer
 */

require('dotenv').config();
const express = require('express');
const axios = require('axios');
const fs = require('fs').promises;
const path = require('path');
const { JSDOM } = require('jsdom');
const crypto = require('crypto');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ============================================================================
// Configuration
// ============================================================================

const CONFIG = {
  PORT: process.env.PORT || 8080,
  NODE_ENV: process.env.NODE_ENV || 'development',
  LOG_LEVEL: process.env.LOG_LEVEL || 'info',
  CHANGEDETECTION_URL: process.env.CHANGEDETECTION_URL || 'http://changedetection:5000',
  CHANGEDETECTION_API_KEY: process.env.CHANGEDETECTION_API_KEY,
  WEBHOOK_SECRET: process.env.WEBHOOK_SECRET,
  FINDINGS_DIR: path.join(__dirname, 'findings'),
  WATCH_UUIDS: {
    WHO: process.env.WATCH_UUID_WHO || '4125358c-e214-432b-a534-417be9664cca',
    CDC: process.env.WATCH_UUID_CDC || '097d6524-4761-45ac-b4a7-ba377745a368',
    CDC_EMERGENCY: process.env.WATCH_UUID_CDC_EMERGENCY || '4a9f902f-cc37-459b-949a-946c016da701',
    BLUEDOT: process.env.WATCH_UUID_BLUEDOT || '310bb11a-18fa-4e73-9033-d3a577ff8680',
    NIH: process.env.WATCH_UUID_NIH || '251096a4-e5d2-4a04-b42d-38921bd759cd'
  }
};

// Statistics tracking
const stats = {
  webhooksReceived: 0,
  findingsWritten: 0,
  parseErrors: 0,
  lastUpdate: null,
  errors: 0,
  startTime: new Date().toISOString(),
  byAgency: {
    WHO: { received: 0, processed: 0, errors: 0 },
    CDC: { received: 0, processed: 0, errors: 0 },
    CDC_EMERGENCY: { received: 0, processed: 0, errors: 0 },
    BLUEDOT: { received: 0, processed: 0, errors: 0 },
    NIH: { received: 0, processed: 0, errors: 0 }
  }
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Logs messages with timestamp and level
 */
function log(level, message, data = null) {
  const timestamp = new Date().toISOString();
  const logLevels = ['error', 'warn', 'info', 'debug'];
  const configLevel = logLevels.indexOf(CONFIG.LOG_LEVEL);
  const messageLevel = logLevels.indexOf(level);
  
  if (messageLevel <= configLevel) {
    const prefix = {
      error: '❌',
      warn: '⚠️ ',
      info: 'ℹ️ ',
      debug: '🔍'
    }[level];
    
    console.log(`[${timestamp}] ${prefix} ${message}`);
    if (data) {
      console.log(JSON.stringify(data, null, 2));
    }
  }
}

/**
 * Validates webhook authenticity (if secret is configured)
 */
function validateWebhook(req) {
  if (!CONFIG.WEBHOOK_SECRET) {
    return true; // No validation if secret not configured
  }
  
  const signature = req.headers['x-webhook-signature'];
  if (!signature) {
    return false;
  }
  
  const payload = JSON.stringify(req.body);
  const expectedSignature = crypto
    .createHmac('sha256', CONFIG.WEBHOOK_SECRET)
    .update(payload)
    .digest('hex');
  
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

/**
 * Ensures findings directory exists
 */
async function ensureFindingsDir() {
  try {
    await fs.access(CONFIG.FINDINGS_DIR);
  } catch {
    await fs.mkdir(CONFIG.FINDINGS_DIR, { recursive: true });
    log('info', `Created findings directory: ${CONFIG.FINDINGS_DIR}`);
  }
}

// ============================================================================
// HTML Parsers for Each Agency
// ============================================================================

/**
 * Parses WHO Disease Outbreak News HTML
 * @param {string} html - Raw HTML content
 * @returns {Array} - Parsed outbreak findings
 */
function parseWHO(html) {
  log('debug', 'Parsing WHO HTML content');
  const findings = [];
  
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // WHO uses article cards or list items for disease outbreaks
    const articles = document.querySelectorAll('article, .list-view--item, .sf-item-container');
    
    articles.forEach(article => {
      try {
        // Extract headline (usually in h2, h3, or sf-card-heading)
        const headlineEl = article.querySelector('h2, h3, .sf-card-heading, .list-view--item--headline');
        const headline = headlineEl?.textContent?.trim();
        
        // Extract URL
        const linkEl = article.querySelector('a[href]');
        const url = linkEl?.href || linkEl?.getAttribute('href');
        
        // Extract date
        const dateEl = article.querySelector('time, .date, .sf-card-date, .list-view--item--date');
        const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime');
        
        // Extract summary/description
        const summaryEl = article.querySelector('p, .sf-card-description, .list-view--item--dek');
        const summary = summaryEl?.textContent?.trim();
        
        if (headline) {
          findings.push({
            headline,
            summary: summary || '',
            date: date || new Date().toISOString().split('T')[0],
            url: url ? (url.startsWith('http') ? url : `https://www.who.int${url}`) : null,
            extractedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        log('warn', 'Error parsing WHO article', { error: err.message });
      }
    });
    
    // Fallback: look for any links in emergency/outbreak sections
    if (findings.length === 0) {
      const links = document.querySelectorAll('a[href*="disease-outbreak"], a[href*="emergency"]');
      links.forEach(link => {
        const headline = link.textContent?.trim();
        const url = link.href || link.getAttribute('href');
        if (headline && url) {
          findings.push({
            headline,
            summary: '',
            date: new Date().toISOString().split('T')[0],
            url: url.startsWith('http') ? url : `https://www.who.int${url}`,
            extractedAt: new Date().toISOString()
          });
        }
      });
    }
    
    log('info', `Parsed ${findings.length} WHO findings`);
  } catch (error) {
    log('error', 'WHO parser error', { error: error.message });
    stats.parseErrors++;
  }
  
  return findings;
}

/**
 * Parses CDC Outbreaks HTML
 * @param {string} html - Raw HTML content
 * @returns {Array} - Parsed outbreak findings
 */
function parseCDC(html) {
  log('debug', 'Parsing CDC HTML content');
  const findings = [];
  
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // CDC outbreak listings - look for cards, list items, or table rows
    const items = document.querySelectorAll(
      '.card, .list-item, .cdc-card, article, .outbreak-item, tbody tr'
    );
    
    items.forEach(item => {
      try {
        // Extract headline
        const headlineEl = item.querySelector('h2, h3, h4, .card-title, td:first-child, a');
        const headline = headlineEl?.textContent?.trim();
        
        // Extract URL
        const linkEl = item.querySelector('a[href]');
        const url = linkEl?.href || linkEl?.getAttribute('href');
        
        // Extract date
        const dateEl = item.querySelector('.date, time, .published, td:nth-child(2)');
        const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime');
        
        // Extract summary
        const summaryEl = item.querySelector('p, .description, .card-body, td:last-child');
        const summary = summaryEl?.textContent?.trim();
        
        // Extract case count if available
        const casesMatch = (headline + ' ' + summary)?.match(/(\d+)\s+(cases?|confirmed|deaths?)/i);
        const cases = casesMatch ? casesMatch[1] : null;
        
        if (headline && headline.length > 5) {
          findings.push({
            headline,
            summary: summary || '',
            date: date || new Date().toISOString().split('T')[0],
            url: url ? (url.startsWith('http') ? url : `https://www.cdc.gov${url}`) : null,
            cases: cases ? parseInt(cases) : null,
            extractedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        log('warn', 'Error parsing CDC item', { error: err.message });
      }
    });
    
    log('info', `Parsed ${findings.length} CDC findings`);
  } catch (error) {
    log('error', 'CDC parser error', { error: error.message });
    stats.parseErrors++;
  }
  
  return findings;
}

/**
 * Parses BlueDot Insights HTML
 * @param {string} html - Raw HTML content
 * @returns {Array} - Parsed insights
 */
function parseBlueDot(html) {
  log('debug', 'Parsing BlueDot HTML content');
  const findings = [];
  
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // BlueDot insights - typically in article cards or blog-style posts
    const articles = document.querySelectorAll('article, .insight, .post, .blog-item, .card');
    
    articles.forEach(article => {
      try {
        // Extract headline
        const headlineEl = article.querySelector('h1, h2, h3, .title, .headline');
        const headline = headlineEl?.textContent?.trim();
        
        // Extract URL
        const linkEl = article.querySelector('a[href]') || headlineEl?.closest('a');
        const url = linkEl?.href || linkEl?.getAttribute('href');
        
        // Extract date
        const dateEl = article.querySelector('time, .date, .published, .post-date');
        const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime');
        
        // Extract summary
        const summaryEl = article.querySelector('p, .excerpt, .summary, .description');
        const summary = summaryEl?.textContent?.trim();
        
        // Extract category/tags
        const categoryEl = article.querySelector('.category, .tag, .label');
        const category = categoryEl?.textContent?.trim();
        
        if (headline && headline.length > 5) {
          findings.push({
            headline,
            summary: summary || '',
            date: date || new Date().toISOString().split('T')[0],
            url: url ? (url.startsWith('http') ? url : `https://bluedot.global${url}`) : null,
            category: category || 'General',
            extractedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        log('warn', 'Error parsing BlueDot article', { error: err.message });
      }
    });
    
    log('info', `Parsed ${findings.length} BlueDot findings`);
  } catch (error) {
    log('error', 'BlueDot parser error', { error: error.message });
    stats.parseErrors++;
  }
  
  return findings;
}

/**
 * Parses NIH/NIAID News HTML
 * @param {string} html - Raw HTML content
 * @returns {Array} - Parsed news items
 */
function parseNIH(html) {
  log('debug', 'Parsing NIH HTML content');
  const findings = [];
  
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    // NIH news items - articles, press releases, news cards
    const items = document.querySelectorAll(
      'article, .news-item, .press-release, .event-item, .list-item, .card'
    );
    
    items.forEach(item => {
      try {
        // Extract headline
        const headlineEl = item.querySelector('h2, h3, h4, .title, .headline, a[href*="news"]');
        const headline = headlineEl?.textContent?.trim();
        
        // Extract URL
        const linkEl = item.querySelector('a[href]');
        const url = linkEl?.href || linkEl?.getAttribute('href');
        
        // Extract date
        const dateEl = item.querySelector('time, .date, .published, .post-date');
        const date = dateEl?.textContent?.trim() || dateEl?.getAttribute('datetime');
        
        // Extract summary
        const summaryEl = item.querySelector('p, .description, .teaser, .excerpt');
        const summary = summaryEl?.textContent?.trim();
        
        // Extract type (news, event, press release)
        const typeEl = item.querySelector('.type, .category, .label');
        const type = typeEl?.textContent?.trim();
        
        if (headline && headline.length > 5) {
          findings.push({
            headline,
            summary: summary || '',
            date: date || new Date().toISOString().split('T')[0],
            url: url ? (url.startsWith('http') ? url : `https://www.nih.gov${url}`) : null,
            type: type || 'News',
            extractedAt: new Date().toISOString()
          });
        }
      } catch (err) {
        log('warn', 'Error parsing NIH item', { error: err.message });
      }
    });
    
    log('info', `Parsed ${findings.length} NIH findings`);
  } catch (error) {
    log('error', 'NIH parser error', { error: error.message });
    stats.parseErrors++;
  }
  
  return findings;
}

/**
 * Routes to appropriate parser based on agency
 */
function parseHTML(agency, html) {
  const parsers = {
    WHO: parseWHO,
    CDC: parseCDC,
    CDC_EMERGENCY: parseCDC, // Use CDC parser for emergency site too
    BLUEDOT: parseBlueDot,
    NIH: parseNIH
  };
  
  const parser = parsers[agency];
  if (!parser) {
    log('error', `No parser found for agency: ${agency}`);
    return [];
  }
  
  return parser(html);
}

// ============================================================================
// Findings Writer
// ============================================================================

/**
 * Writes parsed findings to JSON file
 * @param {string} agency - Agency name (WHO, CDC, etc.)
 * @param {Array} findings - Parsed findings array
 * @returns {string} - Path to written file
 */
async function writeFindingsFile(agency, findings) {
  await ensureFindingsDir();
  
  const today = new Date().toISOString().split('T')[0];
  const filename = `${agency}-${today}.json`;
  const filepath = path.join(CONFIG.FINDINGS_DIR, filename);
  
  // Create findings document matching Phase 1 format
  const document = {
    agency: agency,
    detectionDate: today,
    timestamp: new Date().toISOString(),
    sourceUrl: getAgencyURL(agency),
    findingsCount: findings.length,
    findings: findings,
    metadata: {
      generatedBy: 'bridge-service',
      version: '2.0.0',
      parserType: 'html-changedetection',
      lastUpdated: new Date().toISOString()
    }
  };
  
  try {
    // Check if file exists for today
    let existingData = null;
    try {
      const existingContent = await fs.readFile(filepath, 'utf8');
      existingData = JSON.parse(existingContent);
      log('info', `Existing findings file found for ${agency}, will merge`);
    } catch {
      // File doesn't exist, will create new
    }
    
    // Merge with existing findings if present
    if (existingData && existingData.findings) {
      // Combine findings, avoiding duplicates based on headline
      const existingHeadlines = new Set(
        existingData.findings.map(f => f.headline?.toLowerCase())
      );
      
      const newFindings = findings.filter(
        f => !existingHeadlines.has(f.headline?.toLowerCase())
      );
      
      if (newFindings.length > 0) {
        document.findings = [...existingData.findings, ...newFindings];
        document.findingsCount = document.findings.length;
        document.metadata.merged = true;
        document.metadata.newFindingsAdded = newFindings.length;
        log('info', `Added ${newFindings.length} new findings to existing file`);
      } else {
        log('info', `No new findings to add (all duplicates)`);
        return filepath; // Don't rewrite if no changes
      }
    }
    
    // Write file
    await fs.writeFile(filepath, JSON.stringify(document, null, 2), 'utf8');
    log('info', `✅ Wrote findings file: ${filename}`, {
      agency,
      findingsCount: document.findingsCount,
      path: filepath
    });
    
    stats.findingsWritten++;
    stats.lastUpdate = new Date().toISOString();
    
    return filepath;
  } catch (error) {
    log('error', `Failed to write findings file for ${agency}`, {
      error: error.message,
      filepath
    });
    throw error;
  }
}

/**
 * Gets the source URL for an agency
 */
function getAgencyURL(agency) {
  const urls = {
    WHO: 'https://www.who.int/emergencies/disease-outbreak-news',
    CDC: 'https://www.cdc.gov/outbreaks/',
    CDC_EMERGENCY: 'https://emergency.cdc.gov/outbreaks/',
    BLUEDOT: 'https://bluedot.global/insights/',
    NIH: 'https://www.niaid.nih.gov/news-events'
  };
  return urls[agency] || '';
}

// ============================================================================
// ChangeDetection.io API Client
// ============================================================================

/**
 * Fetches the latest snapshot HTML from ChangeDetection.io
 * @param {string} watchUUID - Watch UUID
 * @returns {string} - HTML content
 */
async function fetchSnapshot(watchUUID) {
  try {
    const url = `${CONFIG.CHANGEDETECTION_URL}/api/v1/watch/${watchUUID}`;
    log('debug', `Fetching snapshot for watch ${watchUUID}`);
    
    const response = await axios.get(url, {
      headers: {
        'x-api-key': CONFIG.CHANGEDETECTION_API_KEY
      },
      timeout: 30000
    });
    
    // ChangeDetection.io stores the latest snapshot content
    const html = response.data.last_snapshot || response.data.history?.[0] || '';
    
    if (!html) {
      log('warn', `No snapshot data found for watch ${watchUUID}`);
      return '';
    }
    
    log('info', `Fetched snapshot for watch ${watchUUID} (${html.length} bytes)`);
    return html;
  } catch (error) {
    log('error', `Failed to fetch snapshot for watch ${watchUUID}`, {
      error: error.message,
      status: error.response?.status
    });
    throw error;
  }
}

// ============================================================================
// Webhook Handlers
// ============================================================================

/**
 * Generic webhook handler
 */
async function handleWebhook(agency, req, res) {
  const startTime = Date.now();
  stats.webhooksReceived++;
  stats.byAgency[agency].received++;
  
  log('info', `🚨 Webhook received: ${agency}`, {
    headers: req.headers,
    bodyKeys: Object.keys(req.body)
  });
  
  try {
    // Validate webhook (if secret configured)
    if (CONFIG.WEBHOOK_SECRET && !validateWebhook(req)) {
      log('warn', `Invalid webhook signature for ${agency}`);
      stats.errors++;
      return res.status(401).json({
        success: false,
        error: 'Invalid webhook signature'
      });
    }
    
    // Extract HTML from webhook payload
    // ChangeDetection.io sends the snapshot HTML in the body
    let html = req.body.snapshot || req.body.html || req.body.content || '';
    
    // If webhook doesn't contain HTML, fetch it from API
    if (!html) {
      log('info', `No HTML in webhook payload, fetching from API`);
      const watchUUID = CONFIG.WATCH_UUIDS[agency];
      html = await fetchSnapshot(watchUUID);
    }
    
    if (!html) {
      log('warn', `No HTML content available for ${agency}`);
      return res.json({
        success: true,
        message: 'Webhook received but no HTML content available',
        agency,
        processed: false
      });
    }
    
    log('debug', `Processing HTML for ${agency} (${html.length} bytes)`);
    
    // Parse HTML using appropriate parser
    const findings = parseHTML(agency, html);
    
    if (findings.length === 0) {
      log('warn', `No findings extracted from ${agency} HTML`);
      return res.json({
        success: true,
        message: 'Webhook processed but no findings extracted',
        agency,
        processed: true,
        findingsCount: 0
      });
    }
    
    // Write findings to file
    const filepath = await writeFindingsFile(agency, findings);
    
    stats.byAgency[agency].processed++;
    const duration = Date.now() - startTime;
    
    log('info', `✅ Webhook processed successfully: ${agency}`, {
      findingsCount: findings.length,
      filepath,
      duration: `${duration}ms`
    });
    
    res.json({
      success: true,
      message: 'Webhook processed successfully',
      agency,
      processed: true,
      findingsCount: findings.length,
      filepath,
      duration: `${duration}ms`
    });
    
  } catch (error) {
    log('error', `Webhook processing failed: ${agency}`, {
      error: error.message,
      stack: error.stack
    });
    
    stats.errors++;
    stats.byAgency[agency].errors++;
    
    res.status(500).json({
      success: false,
      error: 'Webhook processing failed',
      message: error.message,
      agency
    });
  }
}

// ============================================================================
// Webhook Endpoints
// ============================================================================

app.post('/webhook/who-update', (req, res) => handleWebhook('WHO', req, res));
app.post('/webhook/cdc-update', (req, res) => handleWebhook('CDC', req, res));
app.post('/webhook/cdc-emergency-update', (req, res) => handleWebhook('CDC_EMERGENCY', req, res));
app.post('/webhook/bluedot-update', (req, res) => handleWebhook('BLUEDOT', req, res));
app.post('/webhook/nih-update', (req, res) => handleWebhook('NIH', req, res));

// Generic webhook endpoint (agency specified in body)
app.post('/webhook/changedetection', async (req, res) => {
  const agency = req.body.agency || req.query.agency;
  
  if (!agency || !CONFIG.WATCH_UUIDS[agency]) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing agency parameter',
      validAgencies: Object.keys(CONFIG.WATCH_UUIDS)
    });
  }
  
  handleWebhook(agency, req, res);
});

// ============================================================================
// API Endpoints
// ============================================================================

app.get('/status', (req, res) => {
  res.json({
    status: 'healthy',
    version: '2.0.0',
    phase: 'Phase 2 Complete - Full Implementation',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    config: {
      environment: CONFIG.NODE_ENV,
      logLevel: CONFIG.LOG_LEVEL,
      watchesConfigured: Object.keys(CONFIG.WATCH_UUIDS).length,
      webhookSecurityEnabled: !!CONFIG.WEBHOOK_SECRET,
      findingsDirectory: CONFIG.FINDINGS_DIR
    },
    watches: CONFIG.WATCH_UUIDS
  });
});

app.get('/stats', (req, res) => {
  res.json({
    ...stats,
    uptime: process.uptime(),
    uptimeFormatted: formatUptime(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

app.get('/health', (req, res) => {
  res.send('OK');
});

// List all findings files
app.get('/api/findings', async (req, res) => {
  try {
    await ensureFindingsDir();
    const files = await fs.readdir(CONFIG.FINDINGS_DIR);
    const jsonFiles = files.filter(f => f.endsWith('.json'));
    
    const findings = await Promise.all(
      jsonFiles.map(async file => {
        const filepath = path.join(CONFIG.FINDINGS_DIR, file);
        const stats = await fs.stat(filepath);
        const content = await fs.readFile(filepath, 'utf8');
        const data = JSON.parse(content);
        
        return {
          filename: file,
          size: stats.size,
          modified: stats.mtime,
          agency: data.agency,
          findingsCount: data.findingsCount || data.findings?.length || 0,
          detectionDate: data.detectionDate
        };
      })
    );
    
    res.json({
      success: true,
      count: findings.length,
      findings: findings.sort((a, b) => 
        new Date(b.modified) - new Date(a.modified)
      )
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Get specific findings file
app.get('/api/findings/:filename', async (req, res) => {
  try {
    const filepath = path.join(CONFIG.FINDINGS_DIR, req.params.filename);
    const content = await fs.readFile(filepath, 'utf8');
    const data = JSON.parse(content);
    
    res.json({
      success: true,
      data
    });
  } catch (error) {
    res.status(404).json({
      success: false,
      error: 'Findings file not found'
    });
  }
});

// API to fetch watches from ChangeDetection.io
app.get('/api/watches', async (req, res) => {
  try {
    const response = await axios.get(
      `${CONFIG.CHANGEDETECTION_URL}/api/v1/watch`,
      { 
        headers: { 'x-api-key': CONFIG.CHANGEDETECTION_API_KEY },
        timeout: 10000
      }
    );
    
    res.json({
      success: true,
      watches: Object.keys(response.data).length,
      data: response.data
    });
  } catch (error) {
    log('error', 'Error fetching watches', { error: error.message });
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// Get specific watch
app.get('/api/watch/:uuid', async (req, res) => {
  try {
    const response = await axios.get(
      `${CONFIG.CHANGEDETECTION_URL}/api/v1/watch/${req.params.uuid}`,
      { 
        headers: { 'x-api-key': CONFIG.CHANGEDETECTION_API_KEY },
        timeout: 10000
      }
    );
    
    res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    log('error', 'Error fetching watch', { error: error.message });
    res.status(500).json({ 
      success: false,
      error: error.message 
    });
  }
});

// ============================================================================
// Error Handling
// ============================================================================

app.use((err, req, res, next) => {
  stats.errors++;
  log('error', 'Unhandled error', { 
    error: err.message,
    stack: err.stack,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({ 
    success: false,
    error: 'Internal server error',
    message: err.message,
    timestamp: new Date().toISOString()
  });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: 'Endpoint not found',
    path: req.path,
    method: req.method
  });
});

// ============================================================================
// Helper Functions
// ============================================================================

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  
  const parts = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${secs}s`);
  
  return parts.join(' ');
}

// ============================================================================
// Server Startup
// ============================================================================

async function startServer() {
  // Ensure findings directory exists
  await ensureFindingsDir();
  
  app.listen(CONFIG.PORT, () => {
    console.log('╔═══════════════════════════════════════════════════════════════╗');
    console.log('║  🩺 Health Agent Bridge Service - Phase 2 COMPLETE           ║');
    console.log('╚═══════════════════════════════════════════════════════════════╝');
    console.log('');
    console.log(`🚀 Server listening on port ${CONFIG.PORT}`);
    console.log(`🌍 Environment: ${CONFIG.NODE_ENV}`);
    console.log(`📊 ChangeDetection.io: ${CONFIG.CHANGEDETECTION_URL}`);
    console.log(`📁 Findings directory: ${CONFIG.FINDINGS_DIR}`);
    console.log(`🔒 Webhook security: ${CONFIG.WEBHOOK_SECRET ? 'Enabled' : 'Disabled'}`);
    console.log('');
    console.log('📋 Configured Watches:');
    Object.entries(CONFIG.WATCH_UUIDS).forEach(([name, uuid]) => {
      console.log(`   ✅ ${name.padEnd(15)} ${uuid}`);
    });
    console.log('');
    console.log('🔗 Webhook Endpoints:');
    console.log(`   POST /webhook/who-update              - WHO webhook`);
    console.log(`   POST /webhook/cdc-update              - CDC webhook`);
    console.log(`   POST /webhook/cdc-emergency-update    - CDC Emergency webhook`);
    console.log(`   POST /webhook/bluedot-update          - BlueDot webhook`);
    console.log(`   POST /webhook/nih-update              - NIH webhook`);
    console.log(`   POST /webhook/changedetection         - Generic webhook`);
    console.log('');
    console.log('🔗 API Endpoints:');
    console.log(`   GET  /status                          - Service health`);
    console.log(`   GET  /stats                           - Service statistics`);
    console.log(`   GET  /api/findings                    - List findings files`);
    console.log(`   GET  /api/findings/:filename          - Get findings file`);
    console.log(`   GET  /api/watches                     - List watches`);
    console.log(`   GET  /api/watch/:uuid                 - Get watch details`);
    console.log('');
    log('info', '✅ Health Agent Bridge Service started successfully');
  });
}

// Graceful shutdown
process.on('SIGTERM', () => {
  log('info', '🛑 SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  log('info', '🛑 SIGINT received, shutting down gracefully...');
  process.exit(0);
});

process.on('uncaughtException', (error) => {
  log('error', '💥 Uncaught exception', { error: error.message, stack: error.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  log('error', '💥 Unhandled rejection', { reason, promise });
});

// Start server
startServer().catch(error => {
  log('error', '💥 Failed to start server', { error: error.message });
  process.exit(1);
});
