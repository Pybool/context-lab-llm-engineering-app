'use client';

import { useEffect, useRef, useState } from 'react';
import {
  Activity, ArrowRight, Bot, Check, ChevronDown, CircleAlert, Clock3,
  Cpu, LogOut, Menu, MessageSquare, Plus, Send, Settings2, ShieldCheck, X,
} from 'lucide-react';
import { api, ApiError, type Budget, type Chat, type LabConfig, type Message, type User } from '@/lib/api';

function AuthPanel({ onAuthenticated }: { onAuthenticated: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setLoading(true); setError('');
    try {
      const result = await api<{ user: User }>(`/auth/${mode}`, {
        method: 'POST', body: JSON.stringify({ email, password }),
      });
      onAuthenticated(result.user);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setLoading(false); }
  }
  return <main className="auth-layout">
    <section className="auth-intro">
      <div className="brand brand-auth"><span className="brand-mark"><Activity size={20} /></span><span>Context<span className="brand-highlight">Lab</span></span></div>
      <div className="eyebrow"><span className="pulse-dot" /> LOCAL AI QUALITY WORKBENCH</div>
      <h1>Find the limits.<br /><span>Prove the behavior.</span></h1>
      <p>Test chat history, token budgets, rejection boundaries, and LLM reliability with a local Qwen model. No cloud API key.</p>
      <div className="auth-feature"><ShieldCheck size={18}/> Private local test environment</div>
      <div className="auth-feature"><Cpu size={18}/> Ollama + Qwen2.5 integration</div>
      <div className="auth-feature"><Settings2 size={18}/> Server-side configuration</div>
    </section>
    <section className="auth-form-panel">
      <div className="eyebrow">YOUR TEST ENVIRONMENT</div>
      <h2>{mode === 'register' ? 'Create your account' : 'Welcome back'}</h2>
      <p>{mode === 'register' ? 'Start a persistent conversation and explore its context budget.' : 'Continue your LLM testing sessions.'}</p>
      <form onSubmit={submit} className="auth-form">
        <label>Email address <input required type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="qa@example.com" /></label>
        <label>Password <input required type="password" minLength={10} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Minimum 10 characters" /></label>
        {error && <div className="notice error"><CircleAlert size={16}/>{error}</div>}
        <button type="submit" className="primary-button" disabled={loading}>{loading ? 'Please wait…' : mode === 'register' ? 'Create account' : 'Sign in'} <ArrowRight size={18}/></button>
      </form>
      <button className="text-button" onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(''); }}>
        {mode === 'register' ? 'Already registered? Sign in' : 'Need an account? Register'}
      </button>
      <div className="auth-footnote">Local QA lab · Credentials are stored as salted scrypt hashes</div>
    </section>
  </main>;
}

function BudgetPanel({ cfg, budget, error, onRefresh }: { cfg: LabConfig | null; budget: Budget | null; error: string; onRefresh: () => void }) {
  return <aside className="inspector">
    <div className="inspector-top"><div className="sidebar-section-title">INSPECTOR</div><div className="inspector-subtitle">Request context &amp; usage</div></div>
    <div className="inspector-body">
      <div className="tiny-label">ACTIVE MODEL</div>
      <div className="model-card"><div className="model-avatar"><Cpu size={19}/></div><div><div className="model-title">{cfg?.model ?? 'Loading…'}</div><div className="model-status"><span className="online-dot" /> Ollama local</div></div></div>
      <div className="panel-heading"><span>Token budget</span><button type="button" onClick={onRefresh} title="Reload server configuration" aria-label="Reload server configuration" className="icon-button"><Settings2 size={15}/></button></div>
      <div className="meter-meta"><span>Projected usage</span><strong>{budget ? budget.projectedTotal.toLocaleString() : '—'} <span>/ {cfg?.policyLimitTokens.toLocaleString() ?? '—'}</span></strong></div>
      <div className="meter-track"><div className={`meter-fill ${budget && !budget.allowed ? 'meter-over' : ''}`} style={{ width: `${budget ? Math.min(100, budget.projectedTotal / budget.contextLimit * 100) : 0}%` }} /></div>
      <div className="meter-caption">{budget ? (budget.allowed ? `${budget.remainingTokens} tokens available` : `${-budget.remainingTokens} tokens over limit`) : 'Start typing to preview request size'}</div>
      {budget && <div className={`decision ${budget.allowed ? 'decision-ok' : 'decision-no'}`}>{budget.allowed ? <Check size={15}/> : <CircleAlert size={15}/>} {budget.allowed ? 'Request would be accepted' : 'Request would be rejected'}</div>}
      {error && <div className="notice error" style={{ marginTop: 10 }}>{error}</div>}
      <div className="token-breakdown">
        <div><span>Input estimate</span><strong>{budget?.inputTokens ?? '—'}</strong></div>
        <div><span>Safety margin</span><strong>{budget?.overheadTokens ?? cfg?.safetyMarginTokens ?? '—'}</strong></div>
        <div><span>Output reserved</span><strong>{budget?.reservedOutputTokens ?? cfg?.reservedOutputTokens ?? '—'}</strong></div>
        <div><span>Remaining</span><strong>{budget?.remainingTokens ?? '—'}</strong></div>
      </div>
      <div className="panel-heading" style={{ marginTop: 30 }}>Server configuration</div>
      <div className="settings-list">
        <div><span>Policy limit</span><strong>{cfg?.policyLimitTokens ?? '—'}</strong></div>
        <div><span>Model window</span><strong>{cfg?.contextWindowTokens ?? '—'}</strong></div>
        <div><span>Max output</span><strong>{cfg?.reservedOutputTokens ?? '—'}</strong></div>
        <div><span>Temperature</span><strong>{cfg?.temperature ?? '—'}</strong></div>
        <div><span>Overflow</span><span className="reject-pill">REJECT</span></div>
      </div>
      <div className="config-tip"><Settings2 size={16}/><div>Configure these values in <code>apps/server/config/lab.config.json</code>. Changes apply to the next request.</div></div>
      <div className="panel-heading" style={{ marginTop: 27 }}>System instruction</div>
      <p className="system-prompt">{cfg?.systemPrompt ?? 'Loading system prompt…'}</p>
      <p className="estimation-note">Preflight uses Qwen tokenizer + chat template approximation. Actual model usage is captured after response.</p>
    </div>
  </aside>;
}

export default function Lab() {
  const [user, setUser] = useState<User | null>(null);
  const [checkingAuth, setCheckingAuth] = useState(true);
  const [chats, setChats] = useState<Chat[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [config, setConfig] = useState<LabConfig | null>(null);
  const [preview, setPreview] = useState<Budget | null>(null);
  const [prompt, setPrompt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [previewError, setPreviewError] = useState('');
  const [menuOpen, setMenuOpen] = useState(false);
  const listEnd = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api<{ user: User | null }>('/auth/me').then((r) => setUser(r.user)).catch(() => setUser(null)).finally(() => setCheckingAuth(false));
  }, []);

  useEffect(() => {
    if (!user) return;
    void refreshChats();
    api<LabConfig>('/config').then(setConfig).catch((e) => setError(String(e)));
  }, [user]);

  useEffect(() => { listEnd.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, busy]);

  useEffect(() => {
    if (!selected || !prompt.trim() || busy) { setPreview(null); setPreviewError(''); return; }
    let active = true;
    const timer = setTimeout(() => {
      api<{ budget: Budget }>(`/chats/${selected}/preview`, { method: 'POST', body: JSON.stringify({ content: prompt }) })
        .then((result) => { if (active) { setPreview(result.budget); setPreviewError(''); } })
        .catch((e) => { if (active) { setPreview(null); setPreviewError(e instanceof Error ? e.message : String(e)); } });
    }, 300);
    return () => { active = false; clearTimeout(timer); };
  }, [selected, prompt, busy, messages, config]);

  async function refreshChats() {
    const result = await api<{ chats: Chat[] }>('/chats');
    setChats(result.chats);
    return result.chats;
  }

  async function openChat(id: string) {
    setSelected(id); setPrompt(''); setError(''); setPreview(null); setMenuOpen(false);
    const result = await api<{ messages: Message[] }>(`/chats/${id}`);
    setMessages(result.messages);
  }

  async function createChat() {
    try {
      const result = await api<{ chat: Chat }>('/chats', { method: 'POST', body: JSON.stringify({}) });
      await refreshChats();
      await openChat(result.chat.id);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  async function send(event?: React.FormEvent) {
    event?.preventDefault();
    if (!selected || !prompt.trim() || busy) return;
    const content = prompt.trim();
    setBusy(true); setError('');
    try {
      await api(`/chats/${selected}/messages`, { method: 'POST', body: JSON.stringify({ content }) });
      setPrompt(''); setPreview(null);
      const result = await api<{ messages: Message[] }>(`/chats/${selected}`);
      setMessages(result.messages);
      await refreshChats();
      setConfig(await api<LabConfig>('/config'));
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'CONTEXT_LIMIT_EXCEEDED'
        ? 'TOK-006: Request rejected before Ollama. Persisted conversation was not modified.'
        : e instanceof Error ? e.message : String(e));
    } finally { setBusy(false); }
  }

  async function logout() {
    await api('/auth/logout', { method: 'POST' });
    setUser(null); setChats([]); setSelected(null); setMessages([]); setConfig(null);
  }

  if (checkingAuth) return <div className="loading-page"><span className="brand-mark"><Activity/></span> Loading ContextLab…</div>;
  if (!user) return <AuthPanel onAuthenticated={setUser} />;

  const activeChat = chats.find((c) => c.id === selected);
  return <div className="workspace">
    {menuOpen && <button className="mobile-overlay" aria-label="Close menu" onClick={() => setMenuOpen(false)}/>}
    <aside className={`sidebar ${menuOpen ? 'sidebar-open' : ''}`}>
      <div className="sidebar-header"><div className="brand"><span className="brand-mark"><Activity size={19}/></span>Context<span className="brand-highlight">Lab</span></div><button className="icon-button mobile-close" onClick={() => setMenuOpen(false)}><X size={19}/></button></div>
      <div className="sidebar-subheading">LLM Quality Workbench <span className="version">v1.0</span></div>
      <button className="new-chat" onClick={createChat}><Plus size={18}/> New conversation</button>
      <div className="sidebar-section-title" style={{ margin: '27px 18px 12px' }}>CONVERSATIONS</div>
      <nav className="chat-list">{chats.map((c) => <button className={`chat-nav ${selected === c.id ? 'chat-nav-active' : ''}`} key={c.id} onClick={() => void openChat(c.id)}><MessageSquare size={15}/><span>{c.title}</span></button>)}{chats.length === 0 && <div className="empty-sidebar">Create a chat to begin testing.</div>}</nav>
      <div className="sidebar-bottom"><div className="local-status"><span className="online-dot"/> Local test environment <span>LIVE</span></div><div className="profile"><div className="avatar">{user.email[0]?.toUpperCase() ?? 'U'}</div><div className="profile-data"><strong>{user.email.split('@')[0]}</strong><span>{user.email}</span></div><button title="Sign out" className="icon-button" onClick={() => void logout()}><LogOut size={17}/></button></div></div>
    </aside>

    <main className="main-chat">
      <div className="chat-topbar"><div className="chat-top-left"><button className="icon-button menu-button" onClick={() => setMenuOpen(true)}><Menu size={20}/></button><span className="topbar-breadcrumb">Workspace <span>/</span> <strong>{activeChat?.title ?? 'New conversation'}</strong></span></div><div className="topbar-chip"><span className="online-dot"/> Connected locally</div></div>
      {selected ? <>
        <div className="message-scroll">
          {messages.length === 0 ? <div className="empty-chat"><div className="empty-icon"><Bot size={26}/></div><div className="eyebrow">READY TO EXPERIMENT</div><h2>Start a conversation</h2><p>Grow the conversation and inspect the token budget in real time. When the limit is exceeded, the backend rejects the request without changing history.</p><div className="suggestions"><button onClick={() => setPrompt('Explain tokens, context windows, and output reservations simply.')}>Explain token budgets <ArrowRight size={13}/></button><button onClick={() => setPrompt('Remember this constraint: monetary values must never use floating point arithmetic. Explain why.')}>Test instruction retention <ArrowRight size={13}/></button></div></div> : <div className="message-list">{messages.map((m) => <div key={m.id} className={`message-row ${m.role === 'user' ? 'message-user' : 'message-assistant'}`}><div className={`message-avatar ${m.role === 'assistant' ? 'bot-avatar' : ''}`}>{m.role === 'assistant' ? <Bot size={16}/> : (user.email[0]?.toUpperCase() ?? 'U')}</div><div className="message-content"><div className="message-author">{m.role === 'assistant' ? 'Qwen2.5' : 'You'} <span>{new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span></div><div className="message-text">{m.content}</div>{m.usage && <div className="usage-strip"><Cpu size={13}/> input {m.usage.actualInputTokens} · output {m.usage.actualOutputTokens} · stop {m.usage.doneReason} <span className="usage-est">(estimated input {m.usage.estimatedInputTokens})</span></div>}</div></div>)}{busy && <div className="message-row message-assistant"><div className="message-avatar bot-avatar"><Bot size={16}/></div><div className="message-content"><div className="message-author">Qwen2.5</div><div className="typing-dots"><span/><span/><span/></div></div></div>}<div ref={listEnd}/></div>}
        </div>
        <div className="compose-outer">{error && <div className="notice error compose-error"><CircleAlert size={16}/>{error}</div>}<form className="compose-box" onSubmit={send}><textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} disabled={busy} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }} placeholder="Ask something, or try to exceed the context limit…" rows={3} /><div className="compose-bottom"><div className="compose-hint"><Clock3 size={14}/> Messages are persisted only after successful generation</div><button className="send-button" disabled={busy || !prompt.trim()} type="submit"><Send size={16}/></button></div></form><p className="compose-footnote">QA-only · No silent truncation · Shift + Enter for new line</p></div>
      </> : <div className="no-chat"><div className="empty-icon"><MessageSquare size={28}/></div><h2>Your testing workspace</h2><p>Create a conversation to begin verifying token usage, long-context behavior, and rejection policies.</p><button className="primary-button" onClick={createChat}><Plus size={18}/> Create conversation</button></div>}
    </main>
    <BudgetPanel cfg={config} budget={preview} error={previewError} onRefresh={() => { void api<LabConfig>('/config').then(setConfig).catch((e) => setError(String(e))); }}/>
  </div>;
}
