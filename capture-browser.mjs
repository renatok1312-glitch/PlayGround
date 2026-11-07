import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const url = process.env.CAPTURE_URL;
const output = process.env.CAPTURE_DIR;
if (!url || !output) throw new Error('CAPTURE_URL and CAPTURE_DIR are required.');

const runtime = join(process.env.HOME, '.local/share/omgithub-playwright');
const require = createRequire(join(runtime, 'package.json'));
const { chromium } = require('playwright');
const configName = process.platform === 'darwin' ? 'metal.json' : 'linux.json';
const config = JSON.parse(readFileSync(join(runtime, configName), 'utf8'));
if (process.platform === 'linux') {
  process.env.DISPLAY ||= ':' + readFileSync(join(runtime, 'display'), 'utf8').trim();
}

const temporary = (message, cause) => Object.assign(new Error(message, { cause }), { exitCode: 75 });
let browser;
let exitCode = 0;
try {
  try {
    browser = await chromium.launch({ ...config.browser.launchOptions, timeout: 30000 });
  } catch (error) {
    throw temporary(`Browser launch failed: ${error.message}`, error);
  }

  for (const [name, width, height] of [['desktop', 1280, 900], ['mobile', 390, 844]]) {
    let page;
    try {
      page = await browser.newPage({ viewport: { width, height } });
      page.setDefaultTimeout(20000);
      const pageErrors = [];
      const badResponses = [];
      const origin = new URL(url).origin;
      page.on('pageerror', error => pageErrors.push(error.message));
      page.on('response', response => {
        if (response.status() >= 400 && new URL(response.url()).origin === origin) {
          badResponses.push(`HTTP ${response.status()} ${response.url()}`);
        }
      });

      let response;
      try {
        response = await page.goto(url, { waitUntil: 'load', timeout: 45000 });
      } catch (error) {
        throw temporary(`Navigation failed for ${url}: ${error.message}`, error);
      }
      if (!response) throw temporary(`No HTTP response loading ${url}.`);
      if (response.status() >= 500 || [408, 429].includes(response.status())) {
        throw temporary(`Preview returned temporary HTTP ${response.status()}.`);
      }
      if (!response.ok()) throw new Error(`Preview returned HTTP ${response.status()} for ${url}.`);

      try {
        await page.locator('#appContent .page-heading').waitFor({ state: 'visible' });
      } catch (error) {
        throw new Error(`Rendered game content did not appear at ${url}: ${error.message}`);
      }
      const rendered = await page.locator('#appContent').innerText();
      if (!rendered.trim() || !(await page.locator('#appContent .page-heading h1').count())) {
        throw new Error(`Game content is empty at ${url}.`);
      }
      await page.waitForTimeout(700);
      if (pageErrors.length) throw new Error(`Browser rendering error: ${pageErrors.join('; ')}`);
      if (badResponses.length) throw new Error(`Preview asset failure: ${badResponses.join('; ')}`);

      await page.screenshot({
        path: join(output, `final-${name}.png`),
        type: 'png',
        fullPage: false,
        timeout: 30000,
      });
      console.log(`Captured ${name} (${width}x${height}) from ${url}`);
    } catch (error) {
      if (error.exitCode === 75) throw error;
      throw Object.assign(new Error(`${name} capture failed: ${error.message}`, { cause: error }), { exitCode: 1 });
    } finally {
      await page?.close().catch(error => {
        if (!exitCode) exitCode = 75;
        console.error(`Could not close capture page: ${error.message}`);
      });
    }
  }
} catch (error) {
  exitCode = error.exitCode || 1;
  console.error(error);
} finally {
  try {
    await browser?.close();
  } catch (error) {
    exitCode ||= 75;
    console.error(`Could not close browser: ${error.message}`);
  }
}
process.exitCode = exitCode;
