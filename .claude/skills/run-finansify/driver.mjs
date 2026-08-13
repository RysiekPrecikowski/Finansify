// REPL driver for the Finansify web app. Drives a real headless Chromium
// (via the Playwright dependency installed in this directory) against the
// Next.js dev server. Wrap in tmux; send-keys commands, capture-pane output.
import { chromium } from 'playwright';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const SHOT_DIR = process.env.SCREENSHOT_DIR || '/tmp/shots';
fs.mkdirSync(SHOT_DIR, { recursive: true });

let browser = null;
let page = null;
let consoleErrors = [];

const COMMANDS = {
  async launch() {
    if (browser) return console.log('already launched');
    browser = await chromium.launch({ args: ['--no-sandbox'] });
    page = await (await browser.newContext()).newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => consoleErrors.push('pageerror: ' + err.message));
    console.log('launched.', browser.version());
  },

  async nav(url) {
    if (!page) return console.log('ERROR: launch first');
    const target = /^https?:\/\//.test(url) ? url : BASE_URL + (url || '/');
    await page.goto(target, { waitUntil: 'load' });
    console.log('nav →', target);
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate((t) => {
      const els = [...document.querySelectorAll('button, a, [role="button"]')];
      const el =
        els.find((e) => e.textContent?.trim() === t) ?? els.find((e) => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click();
      return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  async type(text) {
    if (page) await page.keyboard.type(text, { delay: 30 });
  },
  async press(key) {
    if (page) await page.keyboard.press(key);
  },

  async wait(sel) {
    if (!page) return console.log('ERROR: launch first');
    try {
      await page.waitForSelector(sel, { timeout: 10_000 });
      console.log('found:', sel);
    } catch {
      console.log('TIMEOUT:', sel);
    }
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try {
      console.log(JSON.stringify(await page.evaluate(expr)));
    } catch (e) {
      console.log('ERROR:', e.message);
    }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(
      await page.evaluate(
        (s) => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
        sel || null,
      ),
    );
  },

  async resize(dims) {
    if (!page) return console.log('ERROR: launch first');
    const [w, h] = (dims || '375,812').split(',').map(Number);
    await page.setViewportSize({ width: w, height: h });
    console.log('resized to', w, 'x', h);
  },

  // The chart tween and any future motion must honour prefers-reduced-motion,
  // which is otherwise only assertable by reading the source and hoping.
  async 'reduced-motion'(value) {
    if (!page) return console.log('ERROR: launch first');
    const setting = value === 'no-preference' ? 'no-preference' : 'reduce';
    await page.emulateMedia({ reducedMotion: setting });
    console.log('prefers-reduced-motion:', setting);
  },

  async 'console-errors'() {
    if (!consoleErrors.length) return console.log('no console errors observed');
    consoleErrors.forEach((e) => console.log('console error:', e));
  },

  async quit() {
    if (browser) await browser.close().catch(() => {});
    browser = null;
    page = null;
  },
  help() {
    console.log('commands:', Object.keys(COMMANDS).join(', '));
  },
};

const stdin = fs.createReadStream(null, { fd: fs.openSync('/dev/stdin', 'r') });
const rl = readline.createInterface({ input: stdin, output: process.stdout, prompt: 'driver> ' });

console.log('finansify driver — "help" for commands, "launch" to start');
rl.prompt();

// `for await` over the readline interface, not an rl.on('line', async ...)
// listener: a piped heredoc delivers every line in one chunk, and a plain
// 'line' listener fires for all of them synchronously before the first
// command's promise (e.g. launch's chromium.launch()) ever resolves —
// rl.pause()/resume() does NOT stop that, because readline's per-chunk
// line-emission loop is synchronous. The async-iterator protocol is what
// actually waits for one command to finish before pulling the next line.
for await (const line of rl) {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) {
    rl.prompt();
    continue;
  }
  const fn = COMMANDS[cmd];
  if (!fn) {
    console.log('unknown:', cmd, '— try: help');
    rl.prompt();
    continue;
  }
  try {
    await fn(rest.join(' '));
  } catch (e) {
    console.log('ERROR:', e.message);
  }
  if (cmd === 'quit') break;
  // A piped heredoc hits EOF (and readline auto-closes) while we're still
  // awaiting the last command's promise -- prompt() after close() throws.
  try {
    rl.prompt();
  } catch {
    /* input already closed (non-interactive pipe) -- fine, keep going */
  }
}
await COMMANDS.quit();
process.exit(0);
