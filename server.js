import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cookieParser from 'cookie-parser';

const app = express();
const root = path.dirname(fileURLToPath(import.meta.url));
const isProd = process.env.NODE_ENV === 'production' || process.argv.includes('--prod');
const PORT = Number(process.env.PORT || 4173);
const sessions = new Map();
const oauthStates = new Map();
const reportsPath = path.join(root, '.ripple-reports.json');
const reports = fs.existsSync(reportsPath) ? JSON.parse(fs.readFileSync(reportsPath, 'utf8')) : {};
const saveReports = () => { fs.writeFileSync(`${reportsPath}.tmp`, JSON.stringify(reports)); fs.renameSync(`${reportsPath}.tmp`, reportsPath); };
app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

function session(req, res, next) {
  let id = req.cookies.ripple_session;
  if (!id || !sessions.has(id)) {
    id = crypto.randomUUID();
    sessions.set(id, {});
    res.cookie('ripple_session', id, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: 7 * 86400000 });
  }
  req.rippleSession = sessions.get(id);
  req.rippleSessionId = id;
  if (!req.rippleSession.miroToken && !req.rippleSession.miroTokenDisabled && process.env.MIRO_ACCESS_TOKEN) {
    req.rippleSession.miroToken = process.env.MIRO_ACCESS_TOKEN;
  }
  next();
}
app.use('/api', session);

function modelSettings() {
  const baseUrl = process.env.QWEN_BASE_URL || process.env.OPENAI_BASE_URL || process.env.DASHSCOPE_BASE_URL;
  const isGroq = Boolean(baseUrl && baseUrl.includes('api.groq.com'));
  const isModelScope = Boolean(baseUrl && baseUrl.includes('modelscope.'));
  return {
    provider: 'Qwen',
    key: process.env.QWEN_API_KEY || process.env.OPENAI_API_KEY || process.env.DASHSCOPE_API_KEY,
    baseUrl,
    model: process.env.QWEN_MODEL || (isGroq ? 'qwen/qwen3.8-27b' : 'Qwen/Qwen3.8-Flash-Next'),
    reasoningEffort: process.env.QWEN_REASONING_EFFORT || (isGroq ? 'medium' : 'xhigh'),
    isGroq,
    isModelScope,
  };
}
function config() {
  const model = modelSettings();
  return {
    aiReady: Boolean(model.key && model.baseUrl),
    aiProvider: model.provider,
    miro: Boolean(process.env.MIRO_ACCESS_TOKEN || (process.env.MIRO_CLIENT_ID && process.env.MIRO_CLIENT_SECRET)),
    connected: false,
  };
}
app.get('/api/status', (req, res) => res.json({ ...config(), connected: Boolean(req.rippleSession.miroToken) }));

app.get('/api/miro/connect', (req, res) => {
  if (!process.env.MIRO_CLIENT_ID || !process.env.MIRO_CLIENT_SECRET) return res.status(503).send('Add MIRO_CLIENT_ID and MIRO_CLIENT_SECRET to .env to connect a live board.');
  const state = crypto.randomBytes(24).toString('hex');
  oauthStates.set(state, { sessionId: req.rippleSessionId, expires: Date.now() + 10 * 60000 });
  const query = new URLSearchParams({ response_type: 'code', client_id: process.env.MIRO_CLIENT_ID, redirect_uri: process.env.MIRO_REDIRECT_URI || `${process.env.APP_ORIGIN || `http://localhost:${PORT}`}/api/miro/callback`, scope: 'boards:read boards:write', state });
  res.redirect(`https://miro.com/oauth/authorize?${query}`);
});
app.get('/api/miro/callback', async (req, res) => {
  const { code, state } = req.query;
  const pending = oauthStates.get(state);
  const sessionId = pending?.sessionId;
  oauthStates.delete(state);
  if (!code || !sessionId || pending.expires < Date.now() || sessionId !== req.rippleSessionId || !sessions.has(sessionId)) return res.redirect('/?miro=error');
  try {
    const form = new URLSearchParams({ grant_type: 'authorization_code', client_id: process.env.MIRO_CLIENT_ID, client_secret: process.env.MIRO_CLIENT_SECRET, code, redirect_uri: process.env.MIRO_REDIRECT_URI || `${process.env.APP_ORIGIN || `http://localhost:${PORT}`}/api/miro/callback` });
    const tokenRes = await fetch('https://api.miro.com/v1/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form });
    const tokenData = await tokenRes.json();
    if (!tokenRes.ok) throw new Error(tokenData.message || 'Miro authorization failed');
    sessions.get(sessionId).miroToken = tokenData.access_token;
    sessions.get(sessionId).miroTokenDisabled = false;
    res.redirect('/?miro=connected');
  } catch (error) { console.error('Miro OAuth:', error.message); res.redirect('/?miro=error'); }
});
app.post('/api/miro/disconnect', (req, res) => { delete req.rippleSession.miroToken; req.rippleSession.miroTokenDisabled = true; res.json({ ok: true }); });

async function miroFetchPath(req, pathname, options = {}) {
  if (!req.rippleSession.miroToken) throw Object.assign(new Error('Connect Miro to use a live board.'), { status: 401 });
  const response = await fetch(`https://api.miro.com/v2${pathname}`, { signal: AbortSignal.timeout(30000), ...options, headers: { Authorization: `Bearer ${req.rippleSession.miroToken}`, 'Content-Type': 'application/json', ...options.headers } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(payload.message || payload.error || `Miro returned ${response.status}`), { status: response.status });
  return payload;
}
async function miroFetch(req, boardId, endpoint, options = {}) {
  return miroFetchPath(req, `/boards/${encodeURIComponent(boardId)}${endpoint}`, options);
}
async function ensureBoardFrame(req, boardId, title, frameOptions) {
  const key = `${boardId}:${title}`;
  let frame;
  if (reports[key]) {
    try { frame = await miroFetch(req, boardId, `/frames/${reports[key].id}`); }
    catch (error) { if (error.status !== 404) throw error; }
  }
  if (!frame) {
    frame = await miroFetch(req, boardId, '/frames', { method: 'POST', body: JSON.stringify({ data: { title } }) });
    reports[key] = { id: frame.id, notes: [] }; saveReports();
  } else {
    frameOptions = { ...frameOptions }; delete frameOptions.position;
  }
  return miroFetch(req, boardId, `/frames/${encodeURIComponent(frame.id)}`, {
    method: 'PATCH',
    body: JSON.stringify(frameOptions),
  });
}
async function createFrameStickyOnce(req, boardId, frameId, content, index, fillColor = 'light_yellow') {
  const note = await miroFetch(req, boardId, '/sticky_notes', {
    method: 'POST',
    body: JSON.stringify({
      data: { content, shape: 'rectangle' },
      style: { fillColor, textAlign: 'left' },
      position: { x: 280, y: 144 + index * 250, origin: 'center' },
      parent: { id: frameId },
    }),
  });
  const report = Object.values(reports).find(value => value.id === frameId);
  report.notes.push({ id: note.id, content: note.data.content }); saveReports();
}
async function clearFrameStickyNotes(req, boardId, frameId) {
  const report = Object.values(reports).find(value => value.id === frameId);
  for (const note of [...report.notes]) {
    try {
      const current = await miroFetch(req, boardId, `/sticky_notes/${note.id}`);
      if (current.parent?.id === frameId && current.data?.content === note.content) {
        await miroFetch(req, boardId, `/sticky_notes/${note.id}`, { method: 'DELETE' });
      }
    } catch (error) { if (error.status !== 404) throw error; }
    report.notes = report.notes.filter(entry => entry.id !== note.id); saveReports();
  }
}
app.get('/api/miro/boards', async (req, res) => {
  try {
    const boards = [];
    let cursor = '';
    do {
      const query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', cursor);
      const page = await miroFetchPath(req, `/boards?${query}`);
      boards.push(...(page.data || [])); cursor = page.cursor || '';
    } while (cursor);
    res.json({ boards: boards.map(({ id, name, description, viewLink }) => ({ id, name, description, viewLink })) });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
app.get('/api/miro/items', async (req, res) => {
  try {
    const boardId = String(req.query.boardId || '').trim();
    if (!boardId) return res.status(400).json({ error: 'Enter a Miro board ID or board URL.' });
    const board = await miroFetch(req, boardId, '');
    const items = [];
    let cursor = '';
    do {
      const query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', cursor);
      const page = await miroFetch(req, boardId, `/items?${query}`);
      items.push(...(page.data || [])); cursor = page.cursor || '';
    } while (cursor);
    cursor = '';
    do {
      const query = new URLSearchParams({ limit: '50' }); if (cursor) query.set('cursor', cursor);
      const page = await miroFetch(req, boardId, `/connectors?${query}`);
      items.push(...(page.data || []).map(item => ({ ...item, type: 'connector' }))); cursor = page.cursor || '';
    } while (cursor);
    res.json({ id: boardId, name: board.name || 'Miro board', items: [...new Map(items.map(item => [item.id, item])).values()] });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

const systemPrompt = `You are Ripple, a decision simulator for plans on a Miro board. Use only the board context provided; distinguish known facts from estimates. Return one valid JSON object only, no markdown. Keep language concise and actions concrete. Include at most 5 affectedItems and 3 recoveryActions; keep each reason/action to one short sentence. Required schema: {"scenario":"string","riskLevel":"Low|Medium|High|Critical","primaryBottleneck":"string","affectedItems":[{"id":"exact board node id","title":"node title","status":"AT RISK|DELAYED|BLOCKED|CRITICAL","reason":"short reason"}],"impact":"short explanation","estimatedImpact":"plain-language estimate or Unknown","recoveryActions":["action"],"summary":"one sentence"}. Select affected node IDs only from supplied context. Avoid false precision.`;
function contextFor(nodes, edges) { return JSON.stringify({ nodes, relationships: edges }); }
function parseJsonObject(raw) {
  const text = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
  const start = text.indexOf('{');
  if (start < 0) throw new Error('Qwen returned an unreadable response. Try again.');
  let depth = 0, inString = false, escaped = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}' && --depth === 0) return JSON.parse(text.slice(start, i + 1));
  }
  throw new Error('Qwen returned an incomplete JSON response. Try again.');
}
async function askModel(kind, { nodes, edges, scenario }) {
  const settings = modelSettings();
  if (!settings.key || !settings.baseUrl) throw Object.assign(new Error('Qwen is not configured. Add the ModelScope API key and base URL to .env, then restart Ripple.'), { status: 503 });
  const instruction = kind === 'analyze'
    ? 'Analyze the board structure. Identify its weakest point and risks, then return the required JSON. Treat scenario as a general board analysis request.'
    : kind === 'chaos'
      ? 'Invent one realistic, high-impact failure scenario specific to this board, then immediately simulate it and return the required JSON.'
      : kind === 'blindspots'
        ? 'Find missing steps or uncovered risks grounded in this board. Use affectedItems to represent the nearest relevant existing nodes, and list blind spots as recoveryActions prefixed with "BLIND SPOT:".'
        : `Simulate this what-if scenario against the board: ${scenario}`;
  const userPrompt = `${instruction}\n\nBoard context:\n${contextFor(nodes, edges)}`;
  const baseUrl = settings.baseUrl.replace(/\/$/, '');
  const endpoint = baseUrl.endsWith('/chat/completions') ? baseUrl : `${baseUrl}/chat/completions`;
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { Authorization: `Bearer ${settings.key}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' },
    signal: AbortSignal.timeout(300000),
    body: JSON.stringify({
      model: settings.model,
      messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: userPrompt }],
      ...(settings.isGroq ? { max_completion_tokens: 550, response_format: { type: 'json_object' }, reasoning_format: 'hidden' } : settings.isModelScope ? { response_format: { type: 'json_object' } } : { chat_template_kwargs: { enable_thinking: true, preserve_thinking: true } }),
      ...(!settings.isModelScope ? { reasoning_effort: settings.reasoningEffort } : {}),
      ...(!settings.isModelScope ? { temperature: kind === 'chaos' ? 0.8 : 0.25 } : {}),
      stream: true,
      ...(!settings.isModelScope ? { stream_options: { include_usage: true } } : {}),
    }),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw Object.assign(new Error(payload.error?.message || `Qwen returned ${response.status}. Check the API key, base URL, model, and region.`), { status: response.status });
  }
  let answer = '';
  let usage;
  let buffer = '';
  const decoder = new TextDecoder();
  const consumeLine = line => {
    if (!line.startsWith('data:')) return;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') return;
    try {
      const chunk = JSON.parse(data);
      const delta = chunk.choices?.[0]?.delta;
      if (typeof delta?.content === 'string') answer += delta.content;
      else if (Array.isArray(delta?.content)) answer += delta.content.filter(part => part.type === 'text').map(part => part.text || '').join('');
      if (chunk.usage) usage = chunk.usage;
      // Reasoning deltas are intentionally not retained, logged, or sent to the client.
    } catch { /* Ignore non-JSON stream keep-alive lines. */ }
  };
  for await (const bytes of response.body) {
    buffer += decoder.decode(bytes, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    for (const line of lines) consumeLine(line);
  }
  buffer += decoder.decode();
  if (buffer) consumeLine(buffer);
  const raw = answer.trim();
  if (!raw) throw new Error('Qwen returned no final answer. Try again or lower the reasoning effort.');
  try { return { ...parseJsonObject(raw), ...(usage ? { usage } : {}) }; } catch (error) { throw new Error(error.message || 'Qwen returned an unreadable response. Try again.'); }
}
function validateContext(body) {
  if (!Array.isArray(body.nodes) || !Array.isArray(body.edges)) throw Object.assign(new Error('Board context is missing. Reload the board and try again.'), { status: 400 });
  if (!body.nodes.length || body.nodes.length > 2000 || body.edges.length > 4000 || body.nodes.some(node => !node || typeof node.id !== 'string' || typeof node.title !== 'string')) throw Object.assign(new Error('Load a nonempty board with valid items before analyzing.'), { status: 400 });
  return { nodes: body.nodes, edges: body.edges, scenario: String(body.scenario || '').slice(0, 1000) };
}
function validateResult(result, nodes) {
  const valid = result && ['Low', 'Medium', 'High', 'Critical'].includes(result.riskLevel)
    && ['scenario', 'primaryBottleneck', 'impact', 'estimatedImpact', 'summary'].every(key => typeof result[key] === 'string')
    && Array.isArray(result.affectedItems) && Array.isArray(result.recoveryActions)
    && result.affectedItems.every(item => item && typeof item.id === 'string' && typeof item.title === 'string' && typeof item.reason === 'string' && ['AT RISK', 'DELAYED', 'BLOCKED', 'CRITICAL'].includes(item.status))
    && result.recoveryActions.every(action => typeof action === 'string' && action.trim());
  if (!valid) throw Object.assign(new Error('The analysis response is incomplete. Please run the analysis again.'), { status: 502 });
  const ids = new Set(nodes.map(node => node.id));
  if (result.affectedItems.some(item => !ids.has(item.id))) throw Object.assign(new Error('The analysis referenced an unknown board item. Please try again.'), { status: 502 });
  return { ...result, affectedItems: result.affectedItems.slice(0, 5), recoveryActions: result.recoveryActions.slice(0, 3) };
}
app.post('/api/analysis/:kind', async (req, res) => {
  try {
    if (!['analyze', 'simulate', 'chaos', 'blindspots'].includes(req.params.kind)) return res.status(404).json({ error: 'Unknown Ripple action.' });
    const { nodes, edges, scenario } = validateContext(req.body);
    if (req.params.kind === 'simulate' && !scenario.trim()) return res.status(400).json({ error: 'Describe a scenario to simulate.' });
    const result = await askModel(req.params.kind, { nodes, edges, scenario }); res.json(validateResult(result, nodes));
  }
  catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

const boardWrites = new Set();
app.use(['/api/miro/impact', '/api/miro/recovery', '/api/miro/blindspots'], (req, res, next) => {
  if (req.method !== 'POST') return next();
  const { boardId, result, items } = req.body || {};
  if (typeof boardId !== 'string' || !boardId.trim() || !Array.isArray(items) || items.some(item => !item || typeof item.id !== 'string')) return res.status(400).json({ error: 'Load a board before saving a report.' });
  try { req.body.result = validateResult(result, items); } catch (error) { return res.status(400).json({ error: error.message }); }
  if (boardWrites.has(boardId)) return res.status(409).json({ error: 'A report is already being saved to this board. Please wait.' });
  boardWrites.add(boardId);
  res.once('finish', () => boardWrites.delete(boardId));
  next();
});
app.post('/api/miro/impact', async (req, res) => {
  try {
    const { boardId, result, items = [] } = req.body;
    if (!req.rippleSession.miroToken) return res.status(401).json({ error: 'Connect Miro to write simulation results to a live board.' });
    const xs = items.map(i => Number(i.position?.x) || 0), ys = items.map(i => Number(i.position?.y) || 0);
    const baseX = Math.max(...xs, 0) + 850, baseY = Math.min(...ys, 0);
    const frame = await ensureBoardFrame(req, boardId, `RIPPLE IMPACT · ${result.riskLevel}`, { position: { x: baseX, y: baseY, origin: 'center' }, geometry: { width: 560, height: Math.max(460, (result.affectedItems?.length || 1) * 250 + 70) }, style: { fillColor: '#f1f4ef' } });
    await clearFrameStickyNotes(req, boardId, frame.id);
    for (const [i, affected] of (result.affectedItems || []).entries()) {
      const colors = { CRITICAL: 'red', BLOCKED: 'red', 'AT RISK': 'light_pink', DELAYED: 'light_yellow' };
      await createFrameStickyOnce(req, boardId, frame.id, `${affected.status} · ${affected.title}\n${affected.reason || ''}`, i, colors[affected.status] || 'light_yellow');
    }
    res.json({ ok: true, frameId: frame.id });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
app.post('/api/miro/recovery', async (req, res) => {
  try {
    const { boardId, result, items = [] } = req.body;
    if (!req.rippleSession.miroToken) return res.status(401).json({ error: 'Connect Miro to create a recovery plan on a live board.' });
    const xs = items.map(i => Number(i.position?.x) || 0), ys = items.map(i => Number(i.position?.y) || 0);
    const x = Math.max(...xs, 0) + 1450, y = Math.min(...ys, 0);
    const frame = await ensureBoardFrame(req, boardId, 'AI RECOVERY PLAN', { position: { x, y, origin: 'center' }, geometry: { width: 560, height: Math.max(550, (result.recoveryActions?.length || 1) * 250 + 70) }, style: { fillColor: '#eff4e9' } });
    await clearFrameStickyNotes(req, boardId, frame.id);
    for (const [i, action] of (result.recoveryActions || []).entries()) {
      await createFrameStickyOnce(req, boardId, frame.id, `${String(i + 1).padStart(2, '0')}  ${action}`, i);
    }
    res.json({ ok: true, frameId: frame.id });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});
app.post('/api/miro/blindspots', async (req, res) => {
  try {
    const { boardId, result, items = [] } = req.body;
    if (!req.rippleSession.miroToken) return res.status(401).json({ error: 'Connect Miro to add blind spots to a live board.' });
    const xs = items.map(i => Number(i.position?.x) || 0), ys = items.map(i => Number(i.position?.y) || 0);
    const x = Math.max(...xs, 0) + 2100, y = Math.min(...ys, 0);
    const actions = result.recoveryActions || [];
    const frame = await ensureBoardFrame(req, boardId, 'RIPPLE · BLIND SPOTS', { position: { x, y, origin: 'center' }, geometry: { width: 560, height: Math.max(550, actions.length * 250 + 70) }, style: { fillColor: '#f5f1e8' } });
    await clearFrameStickyNotes(req, boardId, frame.id);
    for (const [i, action] of actions.entries()) {
      await createFrameStickyOnce(req, boardId, frame.id, `WATCH OUT  ${String(action).replace(/^BLIND SPOT:\s*/i, '')}`, i);
    }
    res.json({ ok: true, frameId: frame.id });
  } catch (error) { res.status(error.status || 502).json({ error: error.message }); }
});

app.use('/api', (_req, res) => res.status(404).json({ error: 'Unknown API route.' }));
app.use((error, _req, res, next) => {
  if (error.type === 'entity.parse.failed') return res.status(400).json({ error: 'Send valid JSON.' });
  if (error.type === 'entity.too.large') return res.status(413).json({ error: 'This board request is too large.' });
  next(error);
});
if (!isProd) {
  const { createServer } = await import('vite');
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' });
  app.use(vite.middlewares);
} else {
  app.use(express.static(path.join(root, 'dist')));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(root, 'dist', 'index.html')));
}
app.listen(PORT, () => console.log(`Ripple is running at http://localhost:${PORT}`));
