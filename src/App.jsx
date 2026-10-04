import { useEffect, useState } from 'react';
import { Activity, AlertTriangle, ArrowDownRight, ArrowRight, Check, ChevronDown, CircleHelp, Command, ExternalLink, GitBranch, LoaderCircle, Network, Plus, RefreshCw, ScanEye, Send, ShieldCheck, Sparkles, Waves, X, Zap } from 'lucide-react';

const readText = item => [item.data?.content, item.data?.title, item.data?.description, item.data?.text, item.data?.altText, item.data?.caption, item.caption, item.title].filter(Boolean).join(' · ').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const parseBoardId = value => {
  const input = String(value || '').trim();
  try { const url = new URL(input); const match = url.pathname.match(/\/board\/([^/]+)/); if (match) return decodeURIComponent(match[1]); } catch {}
  return input.match(/board\/([^/?#]+)/)?.[1] || input;
};
function shapeBoard(payload) {
  const items = payload.items || [];
  const boardNodes = items.filter(item => item.type !== 'connector').map(item => ({
    id: item.id,
    title: readText(item) || `Untitled ${String(item.type || 'board').replaceAll('_', ' ')} item`,
    type: item.type || 'item',
    x: Number(item.position?.x) || 0,
    y: Number(item.position?.y) || 0,
    raw: item,
  }));
  const ids = new Set(boardNodes.map(node => node.id));
  const edges = items.filter(item => item.type === 'connector').map(item => ({
    id: item.id,
    from: item.startItem?.id || item.data?.startItem?.id,
    to: item.endItem?.id || item.data?.endItem?.id,
    label: readText(item),
  })).filter(edge => ids.has(edge.from) && ids.has(edge.to));
  const minX = Math.min(...boardNodes.map(n => n.x), 0), maxX = Math.max(...boardNodes.map(n => n.x), 1);
  const minY = Math.min(...boardNodes.map(n => n.y), 0), maxY = Math.max(...boardNodes.map(n => n.y), 1);
  const nodes = boardNodes.map(node => ({ ...node,
    px: 8 + ((node.x - minX) / Math.max(1, maxX - minX)) * 82,
    py: 8 + ((node.y - minY) / Math.max(1, maxY - minY)) * 78,
  }));
  return { id: payload.id, name: payload.name, nodes, edges, rawItems: items };
}
const statusColor = (risk = '') => risk.toLowerCase().includes('critical') || risk.toLowerCase().includes('blocked') ? 'coral' : risk.toLowerCase().includes('risk') || risk.toLowerCase().includes('high') ? 'amber' : 'green';

function BoardCanvas({ board, result, onAnalyze, loading }) {
  const nodeById = new Map(board.nodes.map(node => [node.id, node]));
  const contentFor = item => {
    if (item.type === 'connector') {
      const from = nodeById.get(item.startItem?.id || item.data?.startItem?.id)?.title;
      const to = nodeById.get(item.endItem?.id || item.data?.endItem?.id)?.title;
      if (from || to) return `${from || 'Unknown item'} → ${to || 'Unknown item'}${readText(item) ? ` · ${readText(item)}` : ''}`;
    }
    return readText(item) || `Untitled ${String(item.type || 'board').replaceAll('_', ' ')} item`;
  };
  return <section className="board-card">
    <div className="board-topline"><div className="board-title"><span className="board-glyph"><Network size={17}/></span><div><strong>{board.name}</strong><span>{board.nodes.length} ITEMS · {board.edges.length} CONNECTORS</span></div></div><div className="canvas-controls"><span className="live-dot"/><span>Loaded from Miro</span><button aria-label="Reload board" onClick={onAnalyze}><RefreshCw size={15}/></button></div></div>
    <div className="canvas" aria-label="Position map of the Miro board">
      <div className="canvas-grid"/>
      <svg className="wires" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        {board.edges.map(edge => { const from = nodeById.get(edge.from), to = nodeById.get(edge.to); if (!from || !to) return null; const mid = (from.px + to.px) / 2; return <g key={edge.id}><path d={`M ${from.px + 4} ${from.py + 3} C ${mid} ${from.py + 3}, ${mid} ${to.py + 3}, ${to.px} ${to.py + 3}`} /><circle cx={to.px} cy={to.py + 3} r=".7"/></g>; })}
      </svg>
      {board.nodes.map(node => {
        const impact = result?.affectedItems?.find(item => item.id === node.id);
        return <div key={node.id} className={`canvas-node ${impact ? `affected affected-${statusColor(impact.status)}` : ''}`} style={{ left: `${node.px}%`, top: `${node.py}%` }} title={`${node.type}: ${node.title}`}>
          <span className="node-type">{node.type.replaceAll('_', ' ').toUpperCase()}</span><strong>{node.title}</strong>
          {impact && <span className={`risk-tag ${statusColor(impact.status)}`}>{impact.status}</span>}
        </div>;
      })}
      {board.nodes.length === 0 && <div className="canvas-empty">This board has no items to display.</div>}
      <div className="canvas-legend"><span><i className="legend-dot legend-flow"/>Miro connector</span>{result && <span><i className="legend-dot legend-risk"/>Impacted item</span>}</div>
      <div className="canvas-zoom"><span>ITEM POSITIONS</span></div>
    </div>
    <details className="board-content" open><summary><span>Board contents</span><b>{board.rawItems.length} items and connectors</b><ChevronDown size={14}/></summary><div className="board-content-list">
      {board.rawItems.map((item, index) => <div className="board-content-row" key={item.id}><span className="content-index">{String(index + 1).padStart(2, '0')}</span><span className="content-type">{String(item.type || 'item').replaceAll('_', ' ')}</span><span className="content-text">{contentFor(item)}</span></div>)}
    </div></details>
    <div className="board-foot"><span><GitBranch size={14}/>{board.edges.length} connectors mapped</span><span>{board.rawItems.length} Miro elements read</span><button onClick={onAnalyze} disabled={loading}>{loading ? <LoaderCircle className="spin" size={14}/> : <ScanEye size={14}/>} Analyze board <span className="keycap">⌘ ↵</span></button></div>
  </section>;
}

function BoardPicker({ server, boards, selectedBoardId, setSelectedBoardId, onLoad, boardId, setBoardId, busy, notice }) {
  return <section className="board-setup-card">
    <div className="setup-illustration"><div className="setup-ripple"><Waves size={25}/></div><div className="setup-node setup-node-a"/><div className="setup-node setup-node-b"/><div className="setup-node setup-node-c"/></div>
    <div className="setup-copy"><span className="eyebrow">MIRO BOARD CONNECTION</span><h3>Load a board to begin.</h3><p>Ripple will read the real items and connectors on your Miro board. Nothing is generated for this view.</p>
      {!server.miro ? <div className="setup-requirement"><AlertTriangle size={15}/><span>Miro app credentials are missing. Add <code>MIRO_CLIENT_ID</code> and <code>MIRO_CLIENT_SECRET</code> to <code>outputs/.env</code>.</span></div> : !server.connected ? <button className="primary-action" onClick={()=>location.assign('/api/miro/connect')}><GitBranch size={15}/> Connect Miro</button> : <>
        {boards.length > 0 && <div className="board-picker"><select aria-label="Select a Miro board" value={selectedBoardId} onChange={event=>setSelectedBoardId(event.target.value)}><option value="">Select one of your Miro boards</option>{boards.map(board=><option key={board.id} value={board.id}>{board.name || 'Untitled board'}</option>)}</select><button onClick={()=>onLoad(selectedBoardId)} disabled={!selectedBoardId || busy==='load'}>{busy==='load'?<LoaderCircle size={15} className="spin"/>:<ArrowRight size={15}/>} Load board</button></div>}
        <div className="manual-board"><span>Or paste a board link or ID</span><div><input value={boardId} onChange={event=>setBoardId(event.target.value)} onKeyDown={event=>event.key==='Enter'&&onLoad(boardId)} placeholder="https://miro.com/app/board/…"/><button onClick={()=>onLoad(boardId)} disabled={!boardId || busy==='load'}>Load</button></div></div>
      </>}
      {server.aiReady ? <div className="setup-service"><span className="service-check"><Check size={12}/></span> Qwen API is configured</div> : <div className="setup-requirement qwen-requirement"><Sparkles size={14}/><span>Qwen key missing. Add <code>QWEN_API_KEY</code> to <code>outputs/.env</code> to enable analysis.</span></div>}
      {notice && <div className="setup-error"><AlertTriangle size={14}/>{notice}</div>}
    </div>
  </section>;
}

function ResultPanel({ result, busy, onShowImpact, onRecovery, onBlindspots, writing, boardLive, aiReady }) {
  if (!result) return <div className="empty-insight"><div className="empty-orbit"><Waves size={24}/></div><span className="eyebrow">{boardLive ? 'BOARD LOADED' : 'WAITING FOR BOARD ANALYSIS'}</span><h3>{boardLive ? (aiReady ? 'Ready to analyze this board.' : 'Miro board loaded.') : 'Load your Miro board first.'}</h3><p>{boardLive ? (aiReady ? 'Run an analysis to see the risks and recovery actions for this board.' : 'Add your Qwen API key to enable board analysis.') : 'Ripple will reason over the board you select, then show the impact and recovery actions here.'}</p><div className="empty-steps"><span><b>01</b> Miro board</span><ArrowRight size={14}/><span><b>02</b> Qwen analysis</span><ArrowRight size={14}/><span><b>03</b> Board update</span></div></div>;
  const color = statusColor(result.riskLevel);
  return <div className="result-view"><div className="result-label">QWEN ANALYSIS <span>JUST NOW</span></div>
    <div className="risk-heading"><span className={`risk-pill ${color}`}><i/>{result.riskLevel} RISK</span><h2>{result.scenario}</h2></div>
    <p className="result-summary">{result.impact || result.summary}</p>
    <div className="metric-row"><div><span>PRIMARY BOTTLENECK</span><b>{result.primaryBottleneck}</b></div><div><span>EXPECTED IMPACT</span><b>{result.estimatedImpact}</b></div></div>
    <div className="affected-list"><div className="section-label">AFFECTED ITEMS <span>{result.affectedItems?.length || 0}</span></div>{result.affectedItems?.slice(0,8).map((item,index)=><div className="affected-row" key={item.id || item.title}><div className="affected-index">{String(index+1).padStart(2,'0')}</div><div className="affected-copy"><b>{item.title}</b><small>{item.reason}</small></div><span className={`mini-state ${statusColor(item.status)}`}>{item.status}</span></div>)}</div>
    <div className="recovery-box"><div className="recovery-title"><span className="recovery-icon"><ShieldCheck size={16}/></span><div><b>{result.kind === 'blindspots' ? 'Blind spots to review' : 'Recovery strategy'}</b><small>Generated from this board</small></div></div><p>{result.recoveryActions?.[0] || result.summary}</p><button onClick={onRecovery} disabled={writing || !boardLive}>{writing ? <LoaderCircle size={14} className="spin"/> : <ArrowDownRight size={14}/>} {result.kind === 'blindspots' ? 'Add blind spots to Miro' : 'Create recovery plan in Miro'}</button></div>
    <button className="impact-link" onClick={onShowImpact} disabled={writing || !boardLive}>{writing ? <LoaderCircle size={15} className="spin"/> : <ExternalLink size={15}/>} Mark affected items in Miro</button>
    <button className="blindspot-link" onClick={onBlindspots} disabled={!!busy}><ScanEye size={14}/> Find blind spots</button>
  </div>;
}

export default function App() {
  const [server, setServer] = useState({ aiReady: false, aiProvider: 'Qwen', miro: false, connected: false });
  const [boards, setBoards] = useState([]);
  const [selectedBoardId, setSelectedBoardId] = useState('');
  const [board, setBoard] = useState(null);
  const [boardId, setBoardId] = useState('');
  const [scenario, setScenario] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState('');
  const [writing, setWriting] = useState(false);
  const [notice, setNotice] = useState('');
  const liveBoard = Boolean(board);

  const loadBoards = async () => {
    setBusy('boards'); setNotice('');
    try { const response=await fetch('/api/miro/boards');const payload=await response.json();if(!response.ok)throw new Error(payload.error);setBoards(payload.boards||[]); }
    catch(error){setNotice(error.message);}finally{setBusy('');}
  };
  const loadBoard = async (value) => {
    const id = parseBoardId(value);
    if (!id) return setNotice('Choose a Miro board or paste its URL or ID.');
    setBusy('load'); setNotice('');
    try { const response=await fetch(`/api/miro/items?boardId=${encodeURIComponent(id)}`);const payload=await response.json();if(!response.ok)throw new Error(payload.error);setBoard(shapeBoard(payload));setSelectedBoardId(id);setBoardId(id);setResult(null); }
    catch(error){setNotice(error.message);}finally{setBusy('');}
  };
  useEffect(() => {
    fetch('/api/status').then(response=>response.json()).then(status=>{setServer(status);if(status.connected)loadBoards();}).catch(()=>setNotice('Ripple server is unavailable. Restart it and reload this page.'));
    const params = new URLSearchParams(location.search);
    if (params.has('miro')) { const connected=params.get('miro')==='connected';setNotice(connected?'Miro connected. Choose a board to load it.':'Miro authorization did not complete. Check the Miro app settings and try again.');history.replaceState({}, '', '/');if(connected)loadBoards(); }
  }, []);
  const run = async (kind, query = scenario) => {
    if (!board) return setNotice('Connect Miro and load a board before asking Ripple.');
    if (!server.aiReady) return setNotice('Qwen is not configured. Add QWEN_API_KEY to outputs/.env and restart Ripple.');
    if (kind === 'simulate' && !query.trim()) return setNotice('Describe a scenario to simulate.');
    setBusy(kind);setNotice('');
    try { const response=await fetch(`/api/analysis/${kind}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nodes:board.nodes.map(({id,title,type,x,y})=>({id,title,type,x,y})),edges:board.edges,scenario:query})});const payload=await response.json();if(!response.ok){if(response.status===401)setServer(current=>({...current,aiReady:false}));throw new Error(payload.error||'The analysis could not be completed.');}setResult({...payload,kind});if(kind==='chaos'||kind==='simulate')setScenario(payload.scenario||query); }
    catch(error){setNotice(error.message);}finally{setBusy('');}
  };
  const writeToMiro = async (endpoint) => {
    if (!board || !result) return setNotice('Load a Miro board and run an analysis first.');
    setWriting(true);setNotice('');
    try { const route=result.kind==='blindspots'&&endpoint==='recovery'?'blindspots':endpoint;const response=await fetch(`/api/miro/${route}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({boardId:board.id,result,items:board.rawItems})});const payload=await response.json();if(!response.ok)throw new Error(payload.error);setNotice(route==='recovery'?'AI RECOVERY PLAN added to your Miro board.':route==='blindspots'?'Blind spots added to your Miro board.':'Impact markers added beside affected Miro items.'); }
    catch(error){setNotice(error.message);}finally{setWriting(false);}
  };
  const connectOrDisconnect = () => {
    if(server.connected) fetch('/api/miro/disconnect',{method:'POST'}).then(()=>{setServer(current=>({...current,connected:false}));setBoards([]);setSelectedBoardId('');setBoard(null);setResult(null);});
    else if(server.miro) location.assign('/api/miro/connect');
    else setNotice('Add MIRO_CLIENT_ID and MIRO_CLIENT_SECRET to outputs/.env before connecting Miro.');
  };
  return <main className="app-shell">
    <header className="topbar"><a className="brand" href="#top"><span className="brand-mark"><Waves size={18}/></span><span>ripple<span className="brand-ai">AI</span></span></a><div className="top-center"><span className="crumb-muted">Workspace</span><span className="crumb-slash">/</span><span>{board?.name||'Miro workspace'}</span><ChevronDown size={13}/></div><div className="top-right"><span className={`service-status ${server.aiReady?'ready':''}`}><i/>{server.aiReady?'Qwen ready':'Qwen key needed'}</span><button className={`connect-button ${server.connected?'connected':''}`} onClick={connectOrDisconnect}>{server.connected?<><Check size={14}/> Miro connected</>:<><Plus size={14}/> Connect Miro</>}</button><button className="avatar" aria-label="Help"><CircleHelp size={16}/></button></div></header>
    <div className="page-wrap" id="top">
      <div className="intro-row"><div><div className="eyebrow"><span className="eyebrow-dash"/>DECISION INTELLIGENCE</div><h1>Stress-test your ideas<br className="desktop-break"/> before reality does<span className="period">.</span></h1><p className="intro-sub">{board ? (server.aiReady ? `${board.name} is loaded. Run an analysis to see its risks and recovery actions.` : `${board.name} is loaded. Add a Qwen API key to analyze it.`) : 'Load your Miro board first. Ripple will analyze its actual content.'}</p></div><div className="intro-meta"><span className="meta-icon"><Activity size={16}/></span><div><b>LIVE BOARD CONTEXT</b><span>{board?`${board.rawItems.length} elements loaded`:'Waiting for Miro authorization'}</span></div></div></div>
      {notice && <div className="notice"><AlertTriangle size={15}/><span>{notice}</span><button onClick={()=>setNotice('')} aria-label="Dismiss"><X size={14}/></button></div>}
      <div className="workspace-grid">
        <div className="left-column">
          <div className="section-heading"><div><span className="step-count">01</span><div><h2>Your Miro board</h2><p>Board items and connectors loaded from your workspace.</p></div></div><button className="text-action" onClick={loadBoards} disabled={!server.connected||busy==='boards'}>{busy==='boards'?<LoaderCircle size={14} className="spin"/>:<RefreshCw size={14}/>} Refresh boards</button></div>
          {board ? <BoardCanvas board={board} result={result} onAnalyze={()=>run('analyze')} loading={busy==='analyze'}/> : <BoardPicker server={server} boards={boards} selectedBoardId={selectedBoardId} setSelectedBoardId={setSelectedBoardId} onLoad={loadBoard} boardId={boardId} setBoardId={setBoardId} busy={busy} notice={''}/>}
          {board && <div className="board-connect-row"><span className="connection-icon online"><GitBranch size={16}/></span><div className="board-connect-copy"><b>{board.name}</b><span>{board.rawItems.length} items and connectors are available to Ripple.</span></div><div className="board-connect-controls"><select aria-label="Switch Miro board" value={selectedBoardId} onChange={event=>{setSelectedBoardId(event.target.value);loadBoard(event.target.value);}}><option value="">Switch board…</option>{boards.map(option=><option key={option.id} value={option.id}>{option.name||'Untitled board'}</option>)}</select></div></div>}
          <div className="board-stats"><div><span>BOARD ELEMENTS</span><b>{board?String(board.rawItems.length).padStart(2,'0'):'—'}</b></div><div><span>CONNECTORS</span><b>{board?String(board.edges.length).padStart(2,'0'):'—'}</b></div><div><span>IMPACT SIGNALS</span><b className={result?'stat-alert':''}>{result?String(result.affectedItems?.length||0).padStart(2,'0'):'—'}</b></div><div className="stats-note"><Sparkles size={15}/><span>{board?'Live board context is ready.':'No board data is shown until you load a real Miro board.'}</span></div></div>
          <div className="qwen-note"><div className="qwen-symbol">q</div><p><b>Qwen reasons over this board.</b> Ripple sends the loaded Miro content and connector relationships for analysis.</p><span className="secure-chip"><ShieldCheck size={13}/> API key stays server-side</span></div>
        </div>
        <aside className="right-column">
          <div className="section-heading"><div><span className="step-count">02</span><div><h2>Ask Ripple</h2><p>Explore the “what ifs.”</p></div></div><span className="qwen-badge"><span>q</span> QWEN</span></div>
          <section className="ask-card"><div className="ask-card-head"><span className="ask-spark"><Sparkles size={15}/></span><div><b>What could go wrong?</b><small>Qwen will trace the ripple effect.</small></div></div><label className="sr-only" htmlFor="scenario">What could go wrong?</label><textarea id="scenario" value={scenario} onChange={event=>setScenario(event.target.value)} placeholder="Describe a risk or change to simulate…" rows="4" onKeyDown={event=>{if((event.metaKey||event.ctrlKey)&&event.key==='Enter')run('simulate')}} disabled={!board||!server.aiReady}/><div className="prompt-suggestions"><span>SCENARIO</span><span>Uses current board content</span></div><button className="simulate-button" onClick={()=>run('simulate')} disabled={!!busy||!board||!server.aiReady}>{busy==='simulate'?<><LoaderCircle size={16} className="spin"/> Tracing impact…</>:<><span>Simulate impact</span><Send size={15}/></>}</button><div className="ask-foot"><span><Command size={12}/> + Enter to run</span><span>{server.aiReady?'Powered by Qwen':'Qwen key required'}</span></div></section>
          <button className={`chaos-button ${busy==='chaos'?'chaos-loading':''}`} onClick={()=>run('chaos')} disabled={!!busy||!board||!server.aiReady}><span className="chaos-icon">{busy==='chaos'?<LoaderCircle size={18} className="spin"/>:<Zap size={18}/>}</span><span><b>{busy==='chaos'?'Analyzing this board…':'Chaos mode'}</b><small>{board?'Ask Qwen to find a board-specific failure':'Load a board to enable Chaos Mode'}</small></span><ArrowRight size={17}/></button>
          <section className="result-card"><div className="result-card-heading"><div><span className="step-count">03</span><div><h2>Impact report</h2><p>{result?'Analysis of the loaded board.':board?'Board loaded; waiting for Qwen analysis.':'Waiting for Qwen analysis.'}</p></div></div>{result&&<button className="icon-button" onClick={()=>setResult(null)} aria-label="Clear results"><X size={15}/></button>}</div><ResultPanel result={result} busy={busy} writing={writing} boardLive={liveBoard} aiReady={server.aiReady} onShowImpact={()=>writeToMiro('impact')} onRecovery={()=>writeToMiro('recovery')} onBlindspots={()=>run('blindspots')}/></section>
        </aside>
      </div>
      <footer className="page-footer"><span><span className="footer-mark"><Waves size={13}/></span>RIPPLE AI</span><span>MIRO IS THE MAP <i/> QWEN IS THE REASONING <i/> RIPPLE IS THE RESPONSE</span><span>LIVE BOARD MODE</span></footer>
    </div>
  </main>;
}
