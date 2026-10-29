import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Activity, AlertTriangle, BarChart3, Check, ChevronDown, ChevronRight,
  Copy, Cpu, Database, FileCheck2, Gauge, Heart, LayoutDashboard,
  Menu, MessageCircle, MessageSquarePlus, MoreHorizontal, PackageSearch, PanelLeftClose,
  PanelLeftOpen, RefreshCw, Send, Settings2, ShieldCheck, Sparkles, ThumbsDown,
  ThumbsUp, TrendingUp, X, Zap,
} from 'lucide-react'
import './App.css'

const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'https://aichatbot-continuospipeline.onrender.com').replace(/\/+$/, '')
const METRICS_AUTH_TOKEN = import.meta.env.VITE_METRICS_AUTH_TOKEN || ''
const NAV_ITEMS = [
  ['overview', 'Overview', LayoutDashboard],
  ['chat', 'Live Chat', MessageCircle],
  ['model', 'Model Monitoring', Cpu],
  ['feedback', 'Feedback Analytics', ThumbsUp],
  ['pipeline', 'Pipeline Status', Activity],
  ['health', 'API & System Health', ShieldCheck],
]
const SUGGESTIONS = ['Find a laptop for programming under ₹70,000', 'Compare headphones for daily use', 'Recommend a monitor for coding and gaming', 'Help me choose a smartphone']
const PIPELINE = [
  ['User interaction', 'Conversations', MessageCircle], ['Feedback collection', 'Human signals', Heart],
  ['Data validation', 'Quality checks', FileCheck2], ['Data versioning', 'DVC snapshots', Database],
  ['Model training', 'Candidate model', Cpu], ['Evaluation', 'Quality gates', Gauge],
  ['Model approval', 'Release review', ShieldCheck], ['Deploy & monitor', 'Production loop', Activity],
]

function makeId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function formatConfidence(value) {
  return typeof value === 'number' ? `${(value <= 1 ? value * 100 : value).toFixed(1)}%` : String(value)
}

function formatLatency(value) {
  return typeof value === 'number' ? (value >= 1000 ? `${(value / 1000).toFixed(2)}s` : `${value}ms`) : String(value)
}

function formatValue(value) {
  if (value === undefined || value === null || value === '') return 'Not available from backend'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

async function fetchJson(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, options)
  let payload = null
  try { payload = await response.json() } catch { /* Some health implementations may return an empty body. */ }
  if (!response.ok) {
    const error = new Error(payload?.detail || `Request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return payload
}

async function fetchMetrics() {
  const headers = METRICS_AUTH_TOKEN ? { Authorization: `Bearer ${METRICS_AUTH_TOKEN}` } : {}
  const response = await fetch(`${API_BASE_URL}/metrics`, { headers })
  const text = await response.text()
  if (!response.ok) {
    const error = new Error(response.status === 401 ? 'Metrics authentication is required.' : `Metrics request failed (${response.status})`)
    error.status = response.status
    throw error
  }
  return { text, parsed: parsePrometheus(text) }
}

function parsePrometheus(text) {
  const values = {}
  text.split('\n').forEach((line) => {
    if (!line || line.startsWith('#')) return
    const match = line.match(/^([a-zA-Z_:][a-zA-Z0-9_:]*)(?:\{[^}]*\})?\s+([-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?)$/)
    if (match) values[match[1]] = Number(match[2])
  })
  return values
}

function errorText(error) {
  if (error?.status === 401) return 'Metrics are unavailable because the backend requires a valid metrics token.'
  if (error?.status >= 500) return 'The backend is temporarily unavailable. Try refreshing again.'
  if (error instanceof TypeError) return 'Could not reach the backend. Check the API origin and CORS configuration.'
  return error?.message || 'The backend request failed.'
}

function App() {
  const [activeView, setActiveView] = useState('overview')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [conversationId, setConversationId] = useState(makeId)
  const [conversations, setConversations] = useState([])
  const [activeConversation, setActiveConversation] = useState({ id: null, messages: [] })
  const [composer, setComposer] = useState('')
  const [sending, setSending] = useState(false)
  const [expanded, setExpanded] = useState(null)
  const [feedbackMessage, setFeedbackMessage] = useState(null)
  const [monitoring, setMonitoring] = useState({ loading: true, refreshing: false, error: '', updatedAt: null, health: null, ready: null, stats: null, model: null, prompt: null, metrics: null })
  const bottomRef = useRef(null)

  const loadMonitoring = useCallback(async (refresh = false) => {
    setMonitoring((current) => ({ ...current, loading: !refresh && !current.updatedAt, refreshing: refresh, error: '' }))
    const results = await Promise.allSettled([
      fetchJson('/health'), fetchJson('/ready'), fetchJson('/feedback/stats'),
      fetchJson('/metadata/model'), fetchJson('/metadata/prompt'), fetchMetrics(),
    ])
    const next = { updatedAt: new Date().toISOString(), refreshing: false, loading: false }
    const fields = ['health', 'ready', 'stats', 'model', 'prompt', 'metrics']
    const errors = []
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') next[fields[index]] = result.value
      else errors.push(`${fields[index]}: ${errorText(result.reason)}`)
    })
    setMonitoring((current) => ({ ...current, ...next, error: errors.join(' ') }))
  }, [])

  useEffect(() => {
    loadMonitoring()
    const timer = setInterval(() => loadMonitoring(true), 30000)
    return () => clearInterval(timer)
  }, [loadMonitoring])

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [activeConversation.messages, sending])

  const startNewChat = useCallback(() => {
    if (activeConversation.messages.length) setConversations((current) => current.map((item) => item.id === conversationId ? { ...item, messages: activeConversation.messages } : item))
    const id = makeId()
    setConversationId(id)
    setActiveConversation({ id, messages: [] })
    setComposer('')
    setExpanded(null)
    setFeedbackMessage(null)
    setSidebarOpen(false)
    setActiveView('chat')
  }, [activeConversation.messages, conversationId])

  const sendMessage = useCallback(async (value, retryId = null) => {
    const text = value.trim()
    if (!text || sending) return
    const requestId = makeId()
    const assistantId = retryId || makeId()
    const currentMessages = activeConversation.messages
    if (retryId) {
      setActiveConversation((current) => ({ ...current, messages: current.messages.map((item) => item.id === retryId ? { ...item, status: 'loading', requestId, error: '' } : item) }))
    } else {
      setActiveConversation((current) => ({ ...current, messages: [...current.messages, { id: makeId(), role: 'user', text }, { id: assistantId, role: 'assistant', status: 'loading', text: '', requestId }] }))
      setComposer('')
      setConversations((current) => [{ id: conversationId, title: text, messages: [...currentMessages, { id: makeId(), role: 'user', text }], time: 'Just now' }, ...current.filter((item) => item.id !== conversationId)].slice(0, 8))
    }
    setSending(true)
    try {
      const payload = await fetchJson('/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: text, conversation_id: conversationId, request_id: requestId }) })
      if (!payload?.response || typeof payload.response !== 'string') throw new Error('The backend returned no assistant response.')
      setActiveConversation((current) => ({ ...current, messages: current.messages.map((item) => item.id === assistantId ? { ...item, status: 'complete', text: payload.response, requestId: payload.request_id || requestId, metadata: payload, feedback: { rating: null, text: '', status: 'idle', error: '' } } : item) }))
    } catch (error) {
      setActiveConversation((current) => ({ ...current, messages: current.messages.map((item) => item.id === assistantId ? { ...item, status: 'error', requestId, error: errorText(error) } : item) }))
    } finally { setSending(false) }
  }, [activeConversation.messages, conversationId, sending])

  const retryMessage = (message) => {
    const index = activeConversation.messages.findIndex((item) => item.id === message.id)
    const previous = activeConversation.messages[index - 1]
    if (previous?.role === 'user') sendMessage(previous.text, message.id)
  }

  const submitFeedback = async (message) => {
    if (!message.requestId || !message.feedback?.rating || message.feedback.status === 'submitting' || message.feedback.status === 'submitted') return
    updateMessage(message.id, { feedback: { ...message.feedback, status: 'submitting', error: '' } })
    try {
      await fetchJson('/feedback', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: message.requestId, rating: message.feedback.rating, corrected_intent: null, corrected_response: null, textual_feedback: message.feedback.text.trim() || null }) })
      updateMessage(message.id, { feedback: { ...message.feedback, status: 'submitted', error: '' } })
    } catch (error) {
      updateMessage(message.id, { feedback: { ...message.feedback, status: 'error', error: error.status === 409 ? 'Feedback for this response was already submitted.' : errorText(error) } })
    }
  }

  const updateMessage = (id, changes) => setActiveConversation((current) => ({ ...current, messages: current.messages.map((item) => item.id === id ? { ...item, ...changes } : item) }))
  const switchConversation = (conversation) => { setConversationId(conversation.id); setActiveConversation({ id: conversation.id, messages: conversation.messages || [] }); setActiveView('chat'); setSidebarOpen(false) }
  const activeTitle = NAV_ITEMS.find(([key]) => key === activeView)?.[1] || 'Overview'

  return (
    <div className="app-shell">
      <aside className={`sidebar ${collapsed ? 'sidebar--collapsed' : ''} ${sidebarOpen ? 'sidebar--open' : ''}`}>
        <div className="sidebar-top"><div className="brand"><div className="brand-mark"><Sparkles size={18} /></div>{!collapsed && <div><strong>AI Chatbot</strong><span>MLOps Control Center</span></div>}</div><button className="icon-button sidebar-close" onClick={() => setSidebarOpen(false)} aria-label="Close navigation"><X size={18} /></button></div>
        <button className="new-chat-button" onClick={startNewChat}><MessageSquarePlus size={18} /> {!collapsed && 'New chat'}</button>
        <nav className="main-nav" aria-label="Main navigation">{NAV_ITEMS.map(([key, label, Icon]) => <button key={key} className={activeView === key ? 'nav-item active' : 'nav-item'} onClick={() => { setActiveView(key); setSidebarOpen(false) }}><Icon size={18} /> {!collapsed && <span>{label}</span>}</button>)}</nav>
        {!collapsed && <div className="sidebar-section recent-section"><div className="section-label"><span>Recent conversations</span><MoreHorizontal size={15} /></div>{conversations.length ? conversations.map((item) => <button className="recent-chat" key={item.id} onClick={() => switchConversation(item)}><span>{item.title}</span><small>{item.time}</small></button>) : <p className="empty-sidebar">No conversations this session.</p>}</div>}
        <div className="sidebar-bottom">{!collapsed && <div className="system-card"><div className="system-heading"><span className="live-dot" /> Backend-connected UI</div><p>Live status is read from the API.</p><span className="demo-pill">No simulated metrics</span></div>}<div className="profile"><div className="avatar">ML</div>{!collapsed && <div><strong>Presentation workspace</strong><span>No account required</span></div>}<Settings2 size={16} className="profile-settings" /></div></div>
        <button className="collapse-button" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}>{collapsed ? <PanelLeftOpen size={18} /> : <PanelLeftClose size={18} />}</button>
      </aside>
      <main className="main-area">
        <header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen(true)} aria-label="Open navigation"><Menu size={21} /></button><div><p className="eyebrow">AI Chatbot · Continuous Learning</p><h1>{activeTitle}</h1></div><div className="topbar-actions"><div className="assistant-status"><span className="live-dot" /> <span>{monitoring.health ? 'Backend connected' : 'Checking backend'}</span></div><div className="top-avatar">ML</div></div></header>
        {activeView === 'chat' ? <ChatView conversation={activeConversation} composer={composer} setComposer={setComposer} sendMessage={sendMessage} sending={sending} expanded={expanded} setExpanded={setExpanded} feedbackMessage={feedbackMessage} setFeedbackMessage={setFeedbackMessage} updateMessage={updateMessage} submitFeedback={submitFeedback} retryMessage={retryMessage} bottomRef={bottomRef} /> : <Dashboard view={activeView} monitoring={monitoring} refresh={() => loadMonitoring(true)} />}
      </main>
    </div>
  )
}

function ChatView({ conversation, composer, setComposer, sendMessage, sending, expanded, setExpanded, feedbackMessage, setFeedbackMessage, updateMessage, submitFeedback, retryMessage, bottomRef }) {
  const messages = conversation.messages
  const keyDown = (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); sendMessage(composer) } }
  return <section className="content chat-content"><div className={`chat-panel ${!messages.length ? 'chat-panel--empty' : ''}`}>{!messages.length ? <div className="welcome"><div className="welcome-icon"><Sparkles size={25} /></div><p className="kicker">Live inference workspace</p><h2>Explore the assistant.<br /><em>Inspect every response.</em></h2><p className="welcome-copy">Send a real request to the deployed chatbot, then inspect correlation IDs, intent metadata, latency, and feedback collection.</p><div className="suggestion-grid">{SUGGESTIONS.map((item) => <button key={item} className="suggestion-card" onClick={() => setComposer(item)}><span className="suggestion-icon"><PackageSearch size={17} /></span><span>{item}</span><ChevronRight size={15} /></button>)}</div></div> : <div className="message-list" aria-live="polite"><div className="conversation-date"><span>Current conversation</span></div>{messages.map((message) => <MessageBubble key={message.id} message={message} expanded={expanded === message.id} setExpanded={setExpanded} feedbackMessage={feedbackMessage} setFeedbackMessage={setFeedbackMessage} updateMessage={updateMessage} submitFeedback={submitFeedback} retryMessage={retryMessage} />)}<div ref={bottomRef} /></div>}<form className="composer-wrap" onSubmit={(event) => { event.preventDefault(); sendMessage(composer) }}><div className="composer"><textarea value={composer} maxLength={1000} onChange={(event) => setComposer(event.target.value)} onKeyDown={keyDown} placeholder="Ask the deployed assistant..." rows={1} aria-label="Message the assistant" disabled={sending} /><div className="composer-footer"><span><Sparkles size={12} /> Live backend inference · {composer.length}/1000</span><button className="send-button" type="submit" disabled={!composer.trim() || sending} aria-label="Send message">{sending ? <RefreshCw className="spin" size={18} /> : <Send size={18} />}</button></div></div><p className="composer-hint">Press <kbd>Enter</kbd> to send <span>·</span> <kbd>Shift + Enter</kbd> for a new line</p></form></div></section>
}

function MessageBubble({ message, expanded, setExpanded, feedbackMessage, setFeedbackMessage, updateMessage, submitFeedback, retryMessage }) {
  if (message.role === 'user') return <div className="message-row user-row"><div className="message user-message">{message.text}</div><div className="message-avatar user-avatar">ML</div></div>
  if (message.status === 'loading') return <div className="message-row assistant-row"><div className="message-avatar assistant-avatar"><Sparkles size={15} /></div><div className="message assistant-message loading-message"><span className="typing-dot" /><span className="typing-dot" /><span className="typing-dot" /><span className="loading-label">Waiting for backend...</span></div></div>
  if (message.status === 'error') return <div className="message-row assistant-row"><div className="message-avatar assistant-avatar"><Sparkles size={15} /></div><div className="message assistant-message error-message"><strong>Request failed.</strong><p>{message.error}</p><button className="retry-button" onClick={() => retryMessage(message)}><RefreshCw size={14} /> Retry</button></div></div>
  const feedback = message.feedback || { rating: null, text: '', status: 'idle', error: '' }
  return <div className="message-row assistant-row"><div className="message-avatar assistant-avatar"><Sparkles size={15} /></div><div className="assistant-stack"><div className="message assistant-message"><div className="message-text">{message.text}</div></div><div className="assistant-tools"><button className="tool-button" onClick={() => setExpanded(expanded ? null : message.id)}><Zap size={13} /> Response metadata <ChevronDown size={13} className={expanded ? 'rotate' : ''} /></button><div className="feedback-controls"><span>Helpful?</span><button className={feedback.rating === 'positive' ? 'feedback-button chosen' : 'feedback-button'} onClick={() => setFeedbackMessage(message.id)} aria-label="Choose positive feedback"><ThumbsUp size={14} /></button><button className={feedback.rating === 'negative' ? 'feedback-button chosen negative' : 'feedback-button'} onClick={() => setFeedbackMessage(message.id)} aria-label="Choose negative feedback"><ThumbsDown size={14} /></button></div></div>{expanded && <ResponseMetadata metadata={message.metadata} />}{feedbackMessage === message.id && feedback.status !== 'submitted' && <div className="feedback-form"><p>Select a rating, optionally add context, then submit.</p><div className="rating-picker"><button className={feedback.rating === 'positive' ? 'rating-choice selected' : 'rating-choice'} onClick={() => updateMessage(message.id, { feedback: { ...feedback, rating: 'positive' } })}><ThumbsUp size={13} /> Positive</button><button className={feedback.rating === 'negative' ? 'rating-choice selected negative' : 'rating-choice'} onClick={() => updateMessage(message.id, { feedback: { ...feedback, rating: 'negative' } })}><ThumbsDown size={13} /> Negative</button></div><textarea value={feedback.text} onChange={(event) => updateMessage(message.id, { feedback: { ...feedback, text: event.target.value } })} placeholder="Optional feedback..." rows={2} /><div className="feedback-actions"><button onClick={() => submitFeedback(message)} disabled={!feedback.rating || feedback.status === 'submitting'}>{feedback.status === 'submitting' ? <RefreshCw className="spin" size={13} /> : <Send size={13} />} Submit feedback</button>{feedback.error && <span className="feedback-error">{feedback.error}</span>}</div></div>}{feedback.status === 'submitted' && <div className="feedback-success"><Check size={14} /> Feedback submitted.</div>}</div></div>
}

function ResponseMetadata({ metadata = {} }) {
  const items = [['Request ID', metadata.request_id, true], ['Intent', metadata.predicted_intent], ['Confidence', metadata.intent_confidence !== null && metadata.intent_confidence !== undefined ? formatConfidence(metadata.intent_confidence) : null], ['Model', metadata.model_version], ['Prompt', metadata.prompt_version], ['Latency', metadata.latency_ms !== null && metadata.latency_ms !== undefined ? formatLatency(metadata.latency_ms) : null]].filter((item) => item[1] !== undefined && item[1] !== null && item[1] !== '')
  return <div className="metadata-grid">{items.length ? items.map(([label, value, copyable]) => <div key={label}><span>{label}</span><strong>{String(value).slice(0, 32)}{String(value).length > 32 ? '…' : ''}</strong>{copyable && <button className="copy-button" onClick={() => navigator.clipboard?.writeText(String(value))} aria-label={`Copy ${label}`}><Copy size={11} /></button>}</div>) : <span className="metadata-empty">No optional metadata was returned.</span>}</div>
}

function Dashboard({ view, monitoring, refresh }) {
  const { loading, refreshing, error, updatedAt } = monitoring
  const updated = updatedAt ? new Date(updatedAt).toLocaleTimeString() : 'Not refreshed'
  return <section className="content dashboard-content"><div className="dashboard-intro"><div><div className="title-with-badge"><span className="demo-badge"><span /> Live backend data</span><span className="muted-label">Last successful refresh: {updated}</span></div><h2>{view === 'overview' ? 'Operational clarity for your AI' : NAV_ITEMS.find(([key]) => key === view)?.[1]}</h2><p>{viewDescription(view)}</p></div><button className="refresh-control" onClick={refresh} disabled={refreshing}>{refreshing ? <RefreshCw className="spin" size={15} /> : <RefreshCw size={15} />} {refreshing ? 'Refreshing' : 'Refresh data'}</button></div>{error && <div className="backend-alert"><AlertTriangle size={16} /><span>{error}</span></div>}{loading ? <LoadingPanel /> : <ViewContent view={view} monitoring={monitoring} />}</section>
}

function viewDescription(view) {
  return { overview: 'Live aggregates and metadata returned by the deployed backend.', model: 'Only model, prompt, and inference data exposed by the backend is shown.', feedback: 'Feedback counts are read from the deployed feedback statistics endpoint.', pipeline: 'Architecture stages are shown read-only unless the backend exposes execution status.', health: 'Connectivity and readiness are based on backend responses, not frontend availability.' }[view]
}

function LoadingPanel() { return <div className="dashboard-card loading-panel"><RefreshCw className="spin" size={22} /><span>Loading backend data…</span></div> }

function ViewContent({ view, monitoring }) {
  if (view === 'health') return <HealthView monitoring={monitoring} />
  if (view === 'pipeline') return <PipelineView />
  if (view === 'model') return <ModelView monitoring={monitoring} />
  if (view === 'feedback') return <FeedbackView stats={monitoring.stats} />
  return <OverviewView monitoring={monitoring} />
}

function OverviewView({ monitoring }) {
  const stats = monitoring.stats || {}
  const model = monitoring.model || {}
  const ready = monitoring.ready || {}
  const metrics = monitoring.metrics?.parsed || {}
  const metricEntries = Object.entries(metrics).slice(0, 4)
  const cards = [['Total feedback', stats.total_feedback, MessageCircle], ['Positive ratings', stats.positive_ratings, ThumbsUp], ['Negative ratings', stats.negative_ratings, ThumbsDown], ['Training eligible', stats.training_eligible, FileCheck2], ['Model version', model.model_version || ready.model_version, Cpu], ['Prompt version', monitoring.prompt?.prompt_version || ready.prompt_version, Zap]]
  return <><div className="stats-grid">{cards.map(([label, value, Icon]) => <MetricCard key={label} label={label} value={value} Icon={Icon} />)}</div><div className="dashboard-grid"><section className="dashboard-card"><CardHeader title="Backend metrics" subtitle="Prometheus values returned by /metrics" action={<BarChart3 size={17} />} />{metricEntries.length ? <div className="metric-list">{metricEntries.map(([key, value]) => <div key={key}><span>{key}</span><strong>{value}</strong></div>)}</div> : <Unavailable text="No parseable Prometheus metrics were returned." />}</section><section className="dashboard-card"><CardHeader title="Inference visibility" subtitle="Aggregate history is not exposed by the API" action={<TrendingUp size={17} />} /><Unavailable text="Historical request volume, latency trends, and error rates are not available from backend endpoints." /></section></div></>
}

function MetricCard({ label, value, Icon }) { return <div className="stat-card"><div className="stat-card-top"><span>{label}</span><span className="stat-icon"><Icon size={16} /></span></div><strong className={value === undefined || value === null ? 'unavailable-value' : ''}>{formatValue(value)}</strong><p>Live backend value</p></div> }
function ModelView({ monitoring }) { const model = monitoring.model || {}; const prompt = monitoring.prompt || {}; return <div className="dashboard-grid"><section className="dashboard-card"><CardHeader title="Model metadata" subtitle="Returned by /metadata/model" action={<Cpu size={17} />} /><InfoRows data={model} /></section><section className="dashboard-card"><CardHeader title="Prompt metadata" subtitle="Returned by /metadata/prompt" action={<Zap size={17} />} /><InfoRows data={prompt} /></section></div> }
function FeedbackView({ stats }) { const data = stats || {}; const total = Number(data.total_feedback) || 0; return <><div className="stats-grid">{[['Total submissions', data.total_feedback], ['Positive ratings', data.positive_ratings], ['Negative ratings', data.negative_ratings], ['Training eligible', data.training_eligible]].map(([label, value]) => <MetricCard key={label} label={label} value={value} Icon={ThumbsUp} />)}</div><section className="dashboard-card"><CardHeader title="Rating distribution" subtitle="Exact counts from /feedback/stats" action={<BarChart3 size={17} />} /><div className="distribution"><div><span>Positive</span><b>{total ? `${((Number(data.positive_ratings) / total) * 100).toFixed(1)}%` : '0%'}</b><i><em style={{ width: total ? `${(Number(data.positive_ratings) / total) * 100}%` : '0%' }} /></i></div><div><span>Negative</span><b>{total ? `${((Number(data.negative_ratings) / total) * 100).toFixed(1)}%` : '0%'}</b><i><em className="negative-bar" style={{ width: total ? `${(Number(data.negative_ratings) / total) * 100}%` : '0%' }} /></i></div></div><p className="card-footnote">Trend history and corrected-intent distributions are not available from the current backend response.</p></section></> }
function PipelineView() { return <><section className="dashboard-card pipeline-card"><CardHeader title="Continuous learning workflow" subtitle="Read-only architecture view · execution status is not instrumented" action={<span className="demo-inline">Read only</span>} /><div className="pipeline">{PIPELINE.map(([label, text, Icon], index) => <div className="pipeline-stage" key={label}><div className="pipeline-icon"><Icon size={17} /></div><strong>{label}</strong><span>{text}</span>{index < PIPELINE.length - 1 && <ChevronRight className="pipeline-arrow" size={16} />}</div>)}</div></section><div className="dashboard-card unavailable-card"><AlertTriangle size={18} /><div><strong>Pipeline execution status unavailable</strong><p>The backend exposes no safe run, deployment, approval, or drift-status endpoint, so this page does not present simulated job states or action buttons.</p></div></div></> }
function HealthView({ monitoring }) { const checks = [['Service health', monitoring.health, 'status'], ['Readiness', monitoring.ready, 'ready'], ['Model version at readiness', monitoring.ready, 'model_version'], ['Prompt version at readiness', monitoring.ready, 'prompt_version']]; return <div className="health-grid">{checks.map(([label, data, key]) => <div className="dashboard-card health-card" key={label}><div className="health-icon"><ShieldCheck size={18} /></div><div><span>{label}</span><strong>{formatValue(data?.[key])}</strong></div><span className={data ? 'health-status good' : 'health-status bad'}>{data ? 'Live response' : 'Unavailable'}</span></div>)}</div> }
function InfoRows({ data }) { const entries = Object.entries(data).filter(([key]) => !key.includes('artifact_location') && !key.includes('instruction_path')); return <div className="info-rows">{entries.length ? entries.map(([key, value]) => <div key={key}><span>{key.replaceAll('_', ' ')}</span><strong>{formatValue(value)}</strong></div>) : <Unavailable text="No metadata was returned." />}</div> }
function Unavailable({ text }) { return <div className="unavailable"><AlertTriangle size={16} /><span>{text}</span></div> }
function CardHeader({ title, subtitle, action }) { return <div className="card-header"><div><h3>{title}</h3><p>{subtitle}</p></div><span>{action}</span></div> }

export default App
