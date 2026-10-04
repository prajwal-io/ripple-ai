import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { transform } from 'esbuild';

// This test mounts the real React UI and uses real HTTP/provider responses.
// Select a board explicitly. Set RIPPLE_TEST_WRITE=1 to verify live report writes.
const boardId = process.env.RIPPLE_TEST_BOARD_ID;
assert(boardId, 'Set RIPPLE_TEST_BOARD_ID to the board you authorize for integration checks.');
const base = process.env.RIPPLE_TEST_ORIGIN || 'http://localhost:4173';
const dom = new JSDOM('<div id="root"></div>', { url: base });
for (const key of ['window', 'document', 'navigator', 'location', 'history', 'HTMLElement', 'Event', 'MouseEvent']) {
  Object.defineProperty(globalThis, key, { value: dom.window[key], configurable: true });
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const nativeFetch = globalThis.fetch;
const calls = [];
let cookie = '';
globalThis.fetch = async (input, options = {}) => {
  const started = Date.now();
  const url = new URL(input, base);
  const headers = new Headers(options.headers);
  if (cookie) headers.set('Cookie', cookie);
  const response = await nativeFetch(url, { ...options, headers });
  const setCookie = response.headers.get('set-cookie');
  if (setCookie) cookie = setCookie.split(';')[0];
  calls.push({ path: url.pathname, method: options.method || 'GET', status: response.status, milliseconds: Date.now() - started });
  return response;
};
const { createElement, act } = await import('react');
const { createRoot } = await import('react-dom/client');
const transformed = await transform(await fs.readFile('src/App.jsx', 'utf8'), { loader: 'jsx', jsx: 'automatic', format: 'esm' });
await fs.mkdir('.test-build', { recursive: true });
await fs.writeFile('.test-build/App.mjs', transformed.code);
const { default: App, shapeBoard } = await import(pathToFileURL(path.resolve('.test-build/App.mjs')));
const root = createRoot(document.getElementById('root'));
const errors = [];
dom.window.addEventListener('error', event => errors.push(event.error?.message || event.message));
const button = label => [...document.querySelectorAll('button')].find(element => element.textContent.trim().includes(label));
async function waitFor(check, label, timeout = 320000) {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > timeout) throw new Error(`${label}: timed out. ${document.querySelector('.notice')?.textContent || ''}`);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 100)); });
  }
}
async function click(element) {
  assert(element, 'Expected UI control exists'); assert(!element.disabled, 'Expected UI control is enabled');
  await act(async () => element.dispatchEvent(new MouseEvent('click', { bubbles: true })));
}
async function finishedAnalysis(kind) {
  await waitFor(() => calls.some(call => call.path === `/api/analysis/${kind}`), `Wait for ${kind}`);
  await waitFor(() => button('Simulate impact') && !button('Simulate impact').disabled, `Finish ${kind}`);
  assert.equal(calls.findLast(call => call.path === `/api/analysis/${kind}`).status, 200, document.querySelector('.notice')?.textContent);
  assert(document.querySelector('.result-view'), `${kind} renders a result`);
  assert(document.querySelector('.affected-row'), `${kind} renders affected board items`);
  console.log(`PASS UI → API → Qwen → UI: ${kind}`);
}
try {
  await act(async () => root.render(createElement(App)));
  await waitFor(() => document.querySelector('select[aria-label="Select a Miro board"]'), 'Board picker', 30000);
  const select = document.querySelector('select[aria-label="Select a Miro board"]');
  assert([...select.options].some(option => option.value === boardId), 'Authorized board is listed');
  await act(async () => { select.value = boardId; select.dispatchEvent(new Event('change', { bubbles: true })); });
  await click(button('Load board'));
  await waitFor(() => document.querySelector('.board-card'), 'Load live board', 30000);
  assert(document.querySelectorAll('.board-content-row').length > 0);
  const analysisBefore = calls.filter(call => call.path.startsWith('/api/analysis/')).length;
  const loadsBefore = calls.filter(call => call.path === '/api/miro/items').length;
  await click(document.querySelector('button[aria-label="Reload board"]'));
  await waitFor(() => calls.filter(call => call.path === '/api/miro/items').length > loadsBefore, 'Reload live board', 30000);
  await waitFor(() => !button('Simulate impact').disabled, 'Reload completes', 30000);
  assert.equal(calls.filter(call => call.path.startsWith('/api/analysis/')).length, analysisBefore);
  console.log('PASS board load, connector rendering, and reload without analysis');
  await click(document.querySelector('button[aria-label="Help"]'));
  assert(document.querySelector('.notice').textContent.includes('Load a Miro board'));
  await click(document.querySelector('button[aria-label="Dismiss"]'));
  if (process.env.RIPPLE_TEST_SMOKE !== '1') {
  const textarea = document.querySelector('#scenario');
  await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set.call(textarea, 'External payments API fails two days before launch');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await click(button('Simulate impact'));
  await finishedAnalysis('simulate');
  if (process.env.RIPPLE_TEST_WRITE === '1') {
    for (const [label, endpoint] of [['Create recovery plan in Miro', 'recovery'], ['Save impact report in Miro', 'impact']]) {
      const reads = calls.filter(call => call.path === '/api/miro/items').length;
      await click(button(label));
      await waitFor(() => calls.some(call => call.path === `/api/miro/${endpoint}`), endpoint);
      await waitFor(() => calls.filter(call => call.path === '/api/miro/items').length > reads && !button('Simulate impact').disabled, `${endpoint} refresh`);
      assert.equal(calls.findLast(call => call.path === `/api/miro/${endpoint}`).status, 200, document.querySelector('.notice')?.textContent);
      assert(document.querySelector('.result-view'), 'Refreshing after write preserves analysis');
      console.log(`PASS UI → Miro ${endpoint} write → refreshed UI`);
    }
  }
  if (process.env.RIPPLE_TEST_ALL_MODES === '1') {
    await click(button('Chaos mode')); await finishedAnalysis('chaos');
    await click(button('Find blind spots')); await finishedAnalysis('blindspots');
    if (process.env.RIPPLE_TEST_WRITE === '1') {
      await click(button('Add blind spots to Miro'));
      await waitFor(() => calls.some(call => call.path === '/api/miro/blindspots') && !button('Simulate impact').disabled, 'Blind spots write');
      assert.equal(calls.findLast(call => call.path === '/api/miro/blindspots').status, 200, document.querySelector('.notice')?.textContent);
      console.log('PASS blind spots write and refresh');
    }
    await click(button('Analyze board')); await finishedAnalysis('analyze');
  }
  }
  const board = await (await fetch(`/api/miro/items?boardId=${encodeURIComponent(boardId)}`)).json();
  const shaped = shapeBoard(board);
  assert.equal(document.querySelectorAll('.board-content-row').length, board.items.length);
  assert.equal(shaped.edges.length, board.items.filter(item => item.type === 'connector' && item.startItem?.id && item.endItem?.id).length);
  assert.equal(document.querySelectorAll('.wires path').length, shaped.edges.length);
  assert.equal(errors.length, 0, errors.join('\n'));
  const invalid = await fetch('/api/analysis/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nodes: [], edges: [] }) });
  assert.equal(invalid.status, 400);
  const malformed = await fetch('/api/analysis/simulate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const unknown = await fetch('/api/unknown'); assert.equal(unknown.status, 404);
  console.log(JSON.stringify({ passed: true, boardItems: board.items.length, connectorsFetched: board.items.filter(item => item.type === 'connector').length, mappedConnectors: shaped.edges.length, runtimeErrors: errors, calls }, null, 2));
} finally {
  await act(async () => root.unmount()); dom.window.close();
}
