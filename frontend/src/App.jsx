import React, { useState, useEffect, useRef } from 'react';
import { 
  MessageSquare, 
  LayoutDashboard, 
  Terminal, 
  Settings, 
  Shield, 
  User, 
  Send, 
  AlertTriangle, 
  CheckCircle, 
  Clock, 
  Truck, 
  FileText, 
  HelpCircle,
  Database,
  RefreshCw
} from 'lucide-react';

const API_BASE = import.meta.env.DEV ? 'http://localhost:8000' : '';

function App() {
  // Navigation & User Context State
  const [activeTab, setActiveTab] = useState('welcome'); // welcome, customer_chat, internal_chat, dashboard
  const [userContext, setUserContext] = useState('customer'); // customer, internal
  const [selectedAccountId, setSelectedAccountId] = useState('ACCT-001'); // ACCT-001 to ACCT-004
  const [selectedAccountName, setSelectedAccountName] = useState('Northstar Logistics');
  
  // App settings & state
  const [apiKey, setApiKey] = useState(localStorage.getItem('gemini_api_key') || '');
  const [showSettings, setShowSettings] = useState(false);
  const [dbResetting, setDbResetting] = useState(false);
  
  // Data lists
  const [accounts, setAccounts] = useState([]);
  const [orders, setOrders] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [dashboardAlerts, setDashboardAlerts] = useState({ summary: {}, alerts: [], sla_breaches: [], matching_issues: [] });
  const [activeViewTab, setActiveViewTab] = useState('tickets'); // tickets, orders, accounts
  
  // Chat States
  const [customerMessages, setCustomerMessages] = useState([]);
  const [internalMessages, setInternalMessages] = useState([]);
  const [inputVal, setInputVal] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  
  // Refs
  const customerEndRef = useRef(null);
  const internalEndRef = useRef(null);
  
  // Load data on start & when state changes
  useEffect(() => {
    fetchAccounts();
    fetchOrders();
    fetchTickets();
    fetchProactiveAlerts();
  }, [userContext, selectedAccountId]);

  // Scroll chat
  useEffect(() => {
    if (activeTab === 'customer_chat') {
      customerEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    } else if (activeTab === 'internal_chat') {
      internalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [customerMessages, internalMessages, activeTab]);

  const fetchAccounts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/accounts`);
      const data = await res.json();
      setAccounts(data);
    } catch (e) {
      console.error('Failed to fetch accounts', e);
    }
  };

  const fetchOrders = async () => {
    try {
      const url = userContext === 'customer' 
        ? `${API_BASE}/api/orders?account_id=${selectedAccountId}` 
        : `${API_BASE}/api/orders`;
      const res = await fetch(url);
      const data = await res.json();
      setOrders(data);
    } catch (e) {
      console.error('Failed to fetch orders', e);
    }
  };

  const fetchTickets = async () => {
    try {
      const url = userContext === 'customer' 
        ? `${API_BASE}/api/tickets?account_id=${selectedAccountId}` 
        : `${API_BASE}/api/tickets`;
      const res = await fetch(url);
      const data = await res.json();
      setTickets(data);
    } catch (e) {
      console.error('Failed to fetch tickets', e);
    }
  };

  const fetchProactiveAlerts = async () => {
    try {
      const res = await fetch(`${API_BASE}/api/proactive-alerts`);
      const data = await res.json();
      setDashboardAlerts(data);
    } catch (e) {
      console.error('Failed to fetch proactive alerts', e);
    }
  };

  const resetDatabase = async () => {
    setDbResetting(true);
    try {
      const res = await fetch(`${API_BASE}/api/reset`, { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        alert(data.message);
        setCustomerMessages([]);
        setInternalMessages([]);
        fetchAccounts();
        fetchOrders();
        fetchTickets();
        fetchProactiveAlerts();
      }
    } catch (e) {
      alert('Failed to reset database');
    } finally {
      setDbResetting(false);
    }
  };

  const handleUserChange = (e) => {
    const val = e.target.value;
    if (val === 'internal') {
      setUserContext('internal');
      setActiveTab('dashboard');
    } else {
      setUserContext('customer');
      setSelectedAccountId(val);
      const acc = accounts.find(a => a.account_id === val);
      if (acc) {
        setSelectedAccountName(acc.account_name);
      }
      setActiveTab('customer_chat');
    }
  };

  const handleSendMessage = async (e) => {
    e.preventDefault();
    if (!inputVal.trim()) return;

    const currentInput = inputVal;
    setInputVal('');
    setChatLoading(true);

    const userMsg = {
      sender: 'user',
      text: currentInput,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    };

    if (userContext === 'customer') {
      setCustomerMessages(prev => [...prev, userMsg]);
    } else {
      setInternalMessages(prev => [...prev, userMsg]);
    }

    try {
      const history = userContext === 'customer' ? customerMessages : internalMessages;
      const historyPayload = history.map(m => ({
        role: m.sender === 'user' ? 'user' : 'model',
        parts: [{ text: m.text }]
      }));

      const res = await fetch(`${API_BASE}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: currentInput,
          user_context: userContext,
          account_id: userContext === 'customer' ? selectedAccountId : null,
          chat_history: historyPayload,
          api_key: apiKey || null
        })
      });

      const data = await res.json();

      const agentMsg = {
        sender: 'agent',
        text: data.response,
        toolUsed: data.tool_used,
        requiresConfirmation: data.requires_confirmation,
        actionType: data.action_type,
        params: data.params,
        logs: data.logs,
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      if (userContext === 'customer') {
        setCustomerMessages(prev => [...prev, agentMsg]);
      } else {
        setInternalMessages(prev => [...prev, agentMsg]);
      }
    } catch (e) {
      console.error(e);
      const errorMsg = {
        sender: 'agent',
        text: 'Sorry, I encountered an error communicating with the backend. Make sure the FastAPI server is running.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };
      if (userContext === 'customer') {
        setCustomerMessages(prev => [...prev, errorMsg]);
      } else {
        setInternalMessages(prev => [...prev, errorMsg]);
      }
    } finally {
      setChatLoading(false);
    }
  };

  const handleConfirmAction = async (actionType, params, messageIndex) => {
    try {
      const res = await fetch(`${API_BASE}/api/action/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action_type: actionType,
          params: params,
          account_id: userContext === 'customer' ? selectedAccountId : null
        })
      });
      const data = await res.json();
      
      const confMsg = {
        sender: 'system',
        text: data.message || 'Action executed successfully.',
        timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      };

      // Disable confirmation UI in the specific message
      if (userContext === 'customer') {
        setCustomerMessages(prev => {
          const updated = [...prev];
          updated[messageIndex].requiresConfirmation = false;
          return [...updated, confMsg];
        });
      } else {
        setInternalMessages(prev => {
          const updated = [...prev];
          updated[messageIndex].requiresConfirmation = false;
          return [...updated, confMsg];
        });
      }

      // Refresh listings
      fetchOrders();
      fetchTickets();
      fetchProactiveAlerts();
    } catch (e) {
      alert('Failed to execute confirm action');
    }
  };

  const handleRejectAction = (messageIndex) => {
    // Just remove the confirmation prompt
    if (userContext === 'customer') {
      setCustomerMessages(prev => {
        const updated = [...prev];
        updated[messageIndex].requiresConfirmation = false;
        updated[messageIndex].text += "\n\n*(Action cancelled by user)*";
        return updated;
      });
    } else {
      setInternalMessages(prev => {
        const updated = [...prev];
        updated[messageIndex].requiresConfirmation = false;
        updated[messageIndex].text += "\n\n*(Action cancelled by user)*";
        return updated;
      });
    }
  };

  const handleSaveApiKey = (e) => {
    e.preventDefault();
    localStorage.setItem('gemini_api_key', apiKey);
    setShowSettings(false);
    alert('Gemini API Key saved and configured!');
  };

  const handleClearApiKey = () => {
    setApiKey('');
    localStorage.removeItem('gemini_api_key');
    setShowSettings(false);
    alert('Gemini API Key cleared. System will fall back to local rule reasoning.');
  };

  return (
    <div className="app-container">
      {/* Sidebar Navigation */}
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-logo">
            <Shield />
          </div>
          <span className="brand-name">ParcelPilot</span>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-title">Navigation</div>
          
          <div 
            className={`nav-item ${activeTab === 'welcome' ? 'active' : ''}`}
            onClick={() => setActiveTab('welcome')}
          >
            <HelpCircle />
            <span>Overview & Guide</span>
          </div>

          {userContext === 'customer' ? (
            <div 
              className={`nav-item ${activeTab === 'customer_chat' ? 'active' : ''}`}
              onClick={() => setActiveTab('customer_chat')}
            >
              <MessageSquare />
              <span>Customer Support Chat</span>
            </div>
          ) : (
            <>
              <div 
                className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`}
                onClick={() => setActiveTab('dashboard')}
              >
                <LayoutDashboard />
                <span>Ops Dashboard</span>
              </div>
              <div 
                className={`nav-item ${activeTab === 'internal_chat' ? 'active' : ''}`}
                onClick={() => setActiveTab('internal_chat')}
              >
                <Terminal />
                <span>Internal Support Chat</span>
              </div>
            </>
          )}
        </div>

        {/* Mock Authorization Switcher */}
        <div className="user-selector-container">
          <div className="sidebar-title">Mock Auth Session</div>
          <div className="select-wrapper">
            <label className="selector-label">Log in as context:</label>
            <select 
              value={userContext === 'internal' ? 'internal' : selectedAccountId}
              onChange={handleUserChange}
              className="styled-select"
            >
              <optgroup label="Customers">
                <option value="ACCT-001">Northstar Logistics (Enterprise)</option>
                <option value="ACCT-002">LumenWorks (Growth)</option>
                <option value="ACCT-003">Beacon Retail (Standard)</option>
                <option value="ACCT-004">Axis Labs (Enterprise)</option>
              </optgroup>
              <optgroup label="Internal Staff">
                <option value="internal">Authorized Support / Ops Staff</option>
              </optgroup>
            </select>
          </div>
        </div>

        {/* DB reset & configs */}
        <div style={{ marginTop: '1.5rem', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <button 
            className="api-key-btn" 
            onClick={() => setShowSettings(true)}
            style={{ width: '100%', justifyContent: 'center' }}
          >
            <Settings size={14} />
            <span>API Settings</span>
          </button>
          <button 
            className="api-key-btn" 
            onClick={resetDatabase}
            disabled={dbResetting}
            style={{ width: '100%', justifyContent: 'center', borderColor: 'rgba(239, 68, 68, 0.2)' }}
          >
            <RefreshCw size={14} className={dbResetting ? 'spin' : ''} />
            <span>Reset DB to Excel</span>
          </button>
        </div>
      </aside>

      {/* Main Panel */}
      <main className="main-content">
        
        {/* Header */}
        <header className="main-header">
          <div className="header-title-area">
            <h2>
              {activeTab === 'welcome' && 'Welcome Guide'}
              {activeTab === 'customer_chat' && `${selectedAccountName} Support Chat`}
              {activeTab === 'internal_chat' && 'Internal AI Operations Chat'}
              {activeTab === 'dashboard' && 'Internal Operations Console'}
            </h2>
            <span className={`context-tag ${userContext === 'internal' ? 'internal' : ''}`}>
              {userContext === 'internal' ? 'Authorized Internal Staff' : `Customer Context: ${selectedAccountId}`}
            </span>
          </div>

          <div className="header-controls">
            <div className={`api-key-btn ${apiKey ? 'configured' : ''}`}>
              <Shield size={14} />
              <span>{apiKey ? 'API Key Enabled' : 'Local Reasoning Fallback'}</span>
            </div>
          </div>
        </header>

        {/* TAB 1: Welcome Guide */}
        {activeTab === 'welcome' && (
          <div className="dashboard-section" style={{ maxWidth: '800px', margin: '0 auto', padding: '3rem 2rem' }}>
            <div className="welcome-screen" style={{ background: 'none' }}>
              <div className="welcome-logo">
                <Shield />
              </div>
              <h2>ParcelPilot Support & Operations Portal</h2>
              <p>
                This application serves as a candidate assessment prototype for CalQuity.
                It has two core roles depending on the user context chosen in the **Mock Auth Session** selector in the sidebar:
              </p>
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem', marginTop: '1rem' }}>
              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: '12px' }}>
                <h3 style={{ marginBottom: '0.5rem', color: 'white', display: 'flex', gap: '0.5rem', alignItems: 'center' }}><User size={18} color="#a5b4fc" /> Customer Context</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Enforces strict data isolation. Customers can only view data (shipments, SLA tickets) belonging to their own account. They can ask about:
                  <br />
                  - **Order cancellation**: Northstar Logistics (ACCT-001) has custom terms (free cancel on BOOKED before pickup). Standard accounts charge INR 250 fee after 30 mins.
                  <br />
                  - **Service credits**: LumenWorks (ACCT-002) has fixed INR 300 credits for late pickups over 4 hours. Standard accounts get lower of 500 or 10% for delay over 2 hours.
                </p>
                <button className="btn btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setUserContext('customer'); setSelectedAccountId('ACCT-001'); setActiveTab('customer_chat'); }}>Try as Northstar Customer</button>
              </div>

              <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border-color)', padding: '1.5rem', borderRadius: '12px' }}>
                <h3 style={{ marginBottom: '0.5rem', color: 'white', display: 'flex', gap: '0.5rem', alignItems: 'center' }}><LayoutDashboard size={18} color="#34d399" /> Internal Operations Context</h3>
                <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                  Designed for operations managers. Displays active warnings, dynamic SLA breach monitors, matches tickets with open bugs (Known Issues), and hosts a powerful chatbot with full database control and escalation capabilities.
                </p>
                <button className="btn btn-primary" style={{ marginTop: '1rem', background: 'var(--accent-success)' }} onClick={() => { setUserContext('internal'); setActiveTab('dashboard'); }}>Open Operations Console</button>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: Customer Support Chat */}
        {activeTab === 'customer_chat' && (
          <div className="chat-section">
            <div className="messages-list">
              {customerMessages.length === 0 ? (
                <div className="welcome-screen">
                  <div className="welcome-logo" style={{ background: 'var(--primary)' }}>
                    <MessageSquare />
                  </div>
                  <h2>Chat with Support</h2>
                  <p>
                    Ask me questions about your shipments, cancellation fees, late pickups, or support tickets.
                    All answers are retrieved dynamically from the current support policy and your Enterprise Service Agreement.
                  </p>
                  <div className="welcome-choices">
                    <button className="api-key-btn" onClick={() => setInputVal("Can I cancel ORD-1001 without a cancellation fee? Explain why.")}>
                      Can I cancel ORD-1001?
                    </button>
                    <button className="api-key-btn" onClick={() => setInputVal("A pickup is three hours late because of carrier fault. Should I get a service credit?")}>
                      Should I get a service credit for 3h late pickup?
                    </button>
                  </div>
                </div>
              ) : (
                customerMessages.map((m, index) => (
                  <div key={index} className={`message-wrapper ${m.sender}`}>
                    <div className="avatar">
                      {m.sender === 'user' ? <User /> : <Shield />}
                    </div>
                    <div>
                      <div className="message-bubble">
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                        
                        {/* Tool usage tracker logs */}
                        {m.sender === 'agent' && m.toolUsed && (
                          <div className="tool-timeline">
                            <span className="tool-badge">
                              <Database size={10} style={{ marginRight: '2px' }} /> 
                              Tool Run: {m.toolUsed}
                            </span>
                            <div style={{ opacity: 0.85, fontSize: '0.7rem', marginTop: '0.25rem' }}>
                              Successfully verified data scoping policies.
                            </div>
                          </div>
                        )}
                        
                        {/* Confirmation Box */}
                        {m.sender === 'agent' && m.requiresConfirmation && (
                          <div className="confirm-bubble">
                            <div className="confirm-bubble-title">
                              <AlertTriangle size={16} color="var(--accent-warning)" />
                              <span>Confirmation Required</span>
                            </div>
                            <div className="confirm-bubble-desc">
                              I've prepared this action for you: **{m.actionType}**
                              <br />
                              Please confirm below to run this transaction.
                            </div>
                            <div className="confirm-bubble-actions">
                              <button 
                                className="btn btn-primary"
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                                onClick={() => handleConfirmAction(m.actionType, m.params, index)}
                              >
                                Confirm Action
                              </button>
                              <button 
                                className="btn btn-secondary"
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                                onClick={() => handleRejectAction(index)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dark)', marginTop: '0.25rem', display: 'block', textAlign: m.sender === 'user' ? 'right' : 'left' }}>
                        {m.timestamp}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="message-wrapper agent">
                  <div className="avatar"><Shield /></div>
                  <div className="message-bubble" style={{ opacity: 0.7 }}>Thinking and retrieving documents...</div>
                </div>
              )}
              <div ref={customerEndRef} />
            </div>

            <div className="chat-input-area">
              <form onSubmit={handleSendMessage} className="chat-input-form">
                <div className="input-container">
                  <input 
                    type="text" 
                    className="chat-input"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder={`Query support as ${selectedAccountName}...`}
                  />
                </div>
                <button type="submit" className="btn btn-primary send-btn" disabled={chatLoading}>
                  <Send />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 3: Internal Support Chat */}
        {activeTab === 'internal_chat' && (
          <div className="chat-section">
            <div className="messages-list">
              {internalMessages.length === 0 ? (
                <div className="welcome-screen">
                  <div className="welcome-logo" style={{ background: 'var(--accent-success)' }}>
                    <Terminal />
                  </div>
                  <h2>Internal Operations Agent</h2>
                  <p>
                    Authorized View. You can run cross-account support audits, perform custom agreement calculations,
                    diagnose bulk upload issues, investigate SwiftShip delays, and perform state-changing operations like escalating tickets.
                  </p>
                  <div className="welcome-choices">
                    <button className="api-key-btn" onClick={() => setInputVal("Audit Ticket TKT-501 SLA status.")}>
                      Audit Ticket TKT-501 SLA
                    </button>
                    <button className="api-key-btn" onClick={() => setInputVal("Explain known issue KI-208 and list matching tickets.")}>
                      Explain Bug KI-208
                    </button>
                    <button className="api-key-btn" onClick={() => setInputVal("Check if LumenWorks (ACCT-002) is eligible for service credit on ORD-2002.")}>
                      Check LumenWorks ORD-2002 Credit
                    </button>
                  </div>
                </div>
              ) : (
                internalMessages.map((m, index) => (
                  <div key={index} className={`message-wrapper ${m.sender}`}>
                    <div className="avatar">
                      {m.sender === 'user' ? <User /> : <Terminal />}
                    </div>
                    <div>
                      <div className="message-bubble">
                        <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                        
                        {/* Tool logs timeline */}
                        {m.sender === 'agent' && m.toolUsed && (
                          <div className="tool-timeline">
                            <span className="tool-badge">
                              <Database size={10} style={{ marginRight: '2px' }} /> 
                              Tool Run: {m.toolUsed}
                            </span>
                            {m.logs && m.logs.length > 0 && (
                              <div style={{ opacity: 0.85, fontSize: '0.7rem', marginTop: '0.25rem', overflowX: 'auto' }}>
                                <pre>{JSON.stringify(m.logs[0], null, 2)}</pre>
                              </div>
                            )}
                          </div>
                        )}
                        
                        {/* Confirmation Box */}
                        {m.sender === 'agent' && m.requiresConfirmation && (
                          <div className="confirm-bubble">
                            <div className="confirm-bubble-title">
                              <AlertTriangle size={16} color="var(--accent-warning)" />
                              <span>Confirmation Required (Authorized Operator)</span>
                            </div>
                            <div className="confirm-bubble-desc">
                              Verify params and confirm writing changes: **{m.actionType}**
                              <br />
                              Parameters: `{JSON.stringify(m.params)}`
                            </div>
                            <div className="confirm-bubble-actions">
                              <button 
                                className="btn btn-primary"
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem', background: 'var(--accent-success)' }}
                                onClick={() => handleConfirmAction(m.actionType, m.params, index)}
                              >
                                Confirm Action
                              </button>
                              <button 
                                className="btn btn-secondary"
                                style={{ padding: '0.4rem 0.8rem', fontSize: '0.75rem' }}
                                onClick={() => handleRejectAction(index)}
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                      <span style={{ fontSize: '0.7rem', color: 'var(--text-dark)', marginTop: '0.25rem', display: 'block', textAlign: m.sender === 'user' ? 'right' : 'left' }}>
                        {m.timestamp}
                      </span>
                    </div>
                  </div>
                ))
              )}
              {chatLoading && (
                <div className="message-wrapper agent">
                  <div className="avatar"><Terminal /></div>
                  <div className="message-bubble" style={{ opacity: 0.7 }}>Analyzing logs and executing query...</div>
                </div>
              )}
              <div ref={internalEndRef} />
            </div>

            <div className="chat-input-area">
              <form onSubmit={handleSendMessage} className="chat-input-form">
                <div className="input-container">
                  <input 
                    type="text" 
                    className="chat-input"
                    value={inputVal}
                    onChange={(e) => setInputVal(e.target.value)}
                    placeholder="Query as Authorized Operator..."
                  />
                </div>
                <button type="submit" className="btn btn-primary send-btn" style={{ background: 'var(--accent-success)' }} disabled={chatLoading}>
                  <Send />
                  <span>Send</span>
                </button>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: Operations Console Dashboard */}
        {activeTab === 'dashboard' && (
          <div className="dashboard-section">
            
            {/* Metric grid */}
            <div className="dashboard-grid">
              <div className="metric-card">
                <div className="metric-icon-wrapper critical">
                  <AlertTriangle />
                </div>
                <div className="metric-details">
                  <h3>SLA Breaches</h3>
                  <div className="metric-value">{dashboardAlerts.sla_breaches.length}</div>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon-wrapper warning">
                  <Clock />
                </div>
                <div className="metric-details">
                  <h3>Open Inquiries</h3>
                  <div className="metric-value">
                    {tickets.filter(t => t.status === 'open').length}
                  </div>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon-wrapper info">
                  <Truck />
                </div>
                <div className="metric-details">
                  <h3>Delayed Pickups</h3>
                  <div className="metric-value">
                    {orders.filter(o => o.status === 'BOOKED' && o.carrier_fault).length}
                  </div>
                </div>
              </div>
              <div className="metric-card">
                <div className="metric-icon-wrapper success">
                  <CheckCircle />
                </div>
                <div className="metric-details">
                  <h3>Active Accounts</h3>
                  <div className="metric-value">{accounts.length}</div>
                </div>
              </div>
            </div>

            <div className="dashboard-layout">
              {/* Proactive Alerts Panel */}
              <div className="dashboard-panel">
                <div className="panel-header">
                  <h2><AlertTriangle size={18} color="var(--accent-critical)" /> Proactive Issue Detection</h2>
                  <span className="context-tag" style={{ background: 'rgba(239, 68, 68, 0.1)', color: 'var(--accent-critical)' }}>
                    Live Alert Feed
                  </span>
                </div>
                <div className="panel-body">
                  {dashboardAlerts.alerts.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', textAlign: 'center', padding: '2rem' }}>
                      No active operational issues detected in shipments or tickets!
                    </div>
                  ) : (
                    dashboardAlerts.alerts.map((a, i) => (
                      <div key={i} className={`alert-item ${a.severity.toLowerCase()}`}>
                        <div className="alert-item-header">
                          <span className="alert-title">{a.title}</span>
                          <span className={`alert-severity-badge ${a.severity}`}>
                            {a.severity}
                          </span>
                        </div>
                        <div className="alert-desc">{a.description}</div>
                        <div className="alert-action">
                          <CheckCircle size={12} />
                          <span>Suggested: {a.suggested_action}</span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>

              {/* Data Explorer */}
              <div className="dashboard-panel" style={{ height: '450px' }}>
                <div className="panel-header" style={{ borderBottom: 'none', marginBottom: '0.5rem' }}>
                  <h2><Database size={18} color="var(--primary)" /> Data Explorer</h2>
                  <div style={{ display: 'flex', gap: '0.25rem', background: 'rgba(255,255,255,0.03)', padding: '0.2rem', borderRadius: '8px' }}>
                    <button 
                      className={`btn ${activeViewTab === 'tickets' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: 'none' }}
                      onClick={() => setActiveViewTab('tickets')}
                    >
                      Tickets
                    </button>
                    <button 
                      className={`btn ${activeViewTab === 'orders' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: 'none' }}
                      onClick={() => setActiveViewTab('orders')}
                    >
                      Orders
                    </button>
                    <button 
                      className={`btn ${activeViewTab === 'accounts' ? 'btn-primary' : 'btn-secondary'}`}
                      style={{ padding: '0.35rem 0.75rem', fontSize: '0.75rem', border: 'none' }}
                      onClick={() => setActiveViewTab('accounts')}
                    >
                      Accounts
                    </button>
                  </div>
                </div>
                <div className="panel-body" style={{ overflow: 'hidden' }}>
                  <div className="data-table-container" style={{ maxHeight: '100%', overflowY: 'auto' }}>
                    
                    {/* Tickets Explorer */}
                    {activeViewTab === 'tickets' && (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Account</th>
                            <th>Subject</th>
                            <th>Created At</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {tickets.map(t => (
                            <tr key={t.ticket_id}>
                              <td>{t.ticket_id}</td>
                              <td>{t.account_id}</td>
                              <td style={{ maxWidth: '150px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={t.subject}>
                                {t.subject}
                              </td>
                              <td>{t.created_at.split(' ')[1] || t.created_at}</td>
                              <td>
                                <span className={`status-indicator ${t.status}`}>
                                  {t.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Orders Explorer */}
                    {activeViewTab === 'orders' && (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Account</th>
                            <th>Carrier</th>
                            <th>Fee</th>
                            <th>Status</th>
                          </tr>
                        </thead>
                        <tbody>
                          {orders.map(o => (
                            <tr key={o.order_id}>
                              <td>{o.order_id}</td>
                              <td>{o.account_id}</td>
                              <td>{o.carrier}</td>
                              <td>INR {o.shipment_fee_inr}</td>
                              <td>
                                <span className={`status-indicator ${o.status}`}>
                                  {o.status}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                    {/* Accounts Explorer */}
                    {activeViewTab === 'accounts' && (
                      <table className="data-table">
                        <thead>
                          <tr>
                            <th>ID</th>
                            <th>Account Name</th>
                            <th>Plan</th>
                            <th>CSM</th>
                            <th>Premium Support</th>
                          </tr>
                        </thead>
                        <tbody>
                          {accounts.map(a => (
                            <tr key={a.account_id}>
                              <td>{a.account_id}</td>
                              <td style={{ fontWeight: 600 }}>{a.account_name}</td>
                              <td>{a.plan}</td>
                              <td>{a.csm}</td>
                              <td>{a.premium_support ? '🟢 Yes' : '⚪ No'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}

                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

      </main>

      {/* Settings Modal (API Key configuration) */}
      {showSettings && (
        <div className="modal-overlay">
          <div className="modal-card">
            <div className="modal-header">
              <h3><Settings size={18} style={{ marginRight: '6px' }} /> API Configuration Settings</h3>
              <button className="btn btn-secondary" style={{ padding: '0.2rem 0.5rem', border: 'none' }} onClick={() => setShowSettings(false)}>X</button>
            </div>
            <form onSubmit={handleSaveApiKey}>
              <div className="modal-body">
                <div className="form-group">
                  <label htmlFor="gemini-key">Google Gemini API Key (Optional)</label>
                  <input 
                    type="password" 
                    id="gemini-key"
                    className="form-input"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter your AIzaSy... key"
                  />
                  <p style={{ fontSize: '0.75rem', color: 'var(--text-dark)', marginTop: '0.5rem' }}>
                    If provided, the system will use the live Gemini 1.5 Flash model for conversational reasoning. 
                    If left blank, the system falls back to the deterministic local reasoning engine (zero dependencies, works offline).
                  </p>
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={handleClearApiKey}>Clear Key</button>
                <button type="submit" className="btn btn-primary">Save and Apply</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
