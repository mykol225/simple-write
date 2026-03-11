/**
 * chat-widget.js — Simple Write edition
 *
 * Adapted from ai-roadmap-view/chat-widget.js.
 * Styles match Simple Write's design tokens (same font stack, grays, border radius).
 *
 * Usage (called from App.tsx after confirming the API key is configured):
 *   ChatWidget.init({
 *     endpoint: '/api/chat',
 *     getViewState: () => ({ document, title, status, project, selectedText })
 *   });
 */

const ChatWidget = (() => {
  // ── State ─────────────────────────────────────────────────────────────────
  let _endpoint    = '/api/chat';
  let _getViewState = () => ({});
  let _messages    = [];       // { role: 'user'|'assistant', content: string }[]
  let _isOpen      = false;
  let _isStreaming  = false;
  let _isDocked    = false;

  // ── DOM refs ──────────────────────────────────────────────────────────────
  let _panel, _messageList, _input, _sendBtn, _trigger, _dockBtn;

  // ── Public API ────────────────────────────────────────────────────────────

  function init({ endpoint, getViewState }) {
    _endpoint     = endpoint     || '/api/chat';
    _getViewState = getViewState || (() => ({}));
    _injectStyles();
    _buildDOM();
  }

  function setViewState(state) {
    _getViewState = () => state;
  }

  // ── DOM construction ──────────────────────────────────────────────────────

  function _buildDOM() {
    // Floating trigger bubble
    _trigger = _el('button', 'cw-trigger', null, '✦');
    _trigger.title = 'Ask about this document';
    _trigger.addEventListener('click', _toggle);

    // Floating panel
    _panel = _el('div', 'cw-panel');
    _panel.setAttribute('aria-label', 'Writing assistant');

    // Header
    const header       = _el('div', 'cw-header');
    const title        = _el('span', 'cw-title', null, 'Writing assistant');
    const headerActions = _el('div', 'cw-header-actions');

    _dockBtn = _el('button', 'cw-dock', null, '◧');
    _dockBtn.title = 'Dock to sidebar';
    _dockBtn.addEventListener('click', _toggleDock);

    const closeBtn = _el('button', 'cw-close', null, '×');
    closeBtn.title = 'Close';
    closeBtn.addEventListener('click', _close);

    headerActions.append(_dockBtn, closeBtn);
    header.append(title, headerActions);

    // Message list
    _messageList = _el('div', 'cw-messages');

    // Input row
    const inputRow = _el('div', 'cw-input-row');
    _input = _el('textarea', 'cw-input');
    _input.placeholder = 'Ask anything about this document…';
    _input.rows = 1;
    _input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); _send(); }
    });
    _input.addEventListener('input', _autoResize);

    _sendBtn = _el('button', 'cw-send', null, '↑');
    _sendBtn.title = 'Send';
    _sendBtn.addEventListener('click', _send);

    inputRow.append(_input, _sendBtn);
    _panel.append(header, _messageList, inputRow);
    document.body.append(_trigger, _panel);
  }

  // ── Open / close ──────────────────────────────────────────────────────────

  function _toggle() { _isOpen ? _close() : _open(); }

  function _open() {
    _isOpen = true;
    _panel.classList.add('cw-panel--open');
    _trigger.classList.add('cw-trigger--active');
    _appendContextIndicator();
    _input.focus();
  }

  function _close() {
    if (_isDocked) _undock();
    _isOpen = false;
    _panel.classList.remove('cw-panel--open');
    _trigger.classList.remove('cw-trigger--active');
  }

  // ── Dock / undock ─────────────────────────────────────────────────────────

  function _toggleDock() { _isDocked ? _undock() : _dock(); }

  function _dock() {
    _isDocked = true;
    _panel.classList.add('cw-panel--docked');
    _trigger.classList.add('cw-trigger--hidden');
    document.body.classList.add('cw-body-docked');
    _dockBtn.textContent = '◨';
    _dockBtn.title = 'Undock';
    if (!_isOpen) {
      _isOpen = true;
      _panel.classList.add('cw-panel--open');
      _appendContextIndicator();
    }
    _input.focus();
  }

  function _undock() {
    _isDocked = false;
    _panel.classList.remove('cw-panel--docked');
    _trigger.classList.remove('cw-trigger--hidden');
    document.body.classList.remove('cw-body-docked');
    _dockBtn.textContent = '◧';
    _dockBtn.title = 'Dock to sidebar';
  }

  document.addEventListener('mousedown', (e) => {
    if (_isDocked || !_isOpen) return;
    if (!_panel.contains(e.target) && !_trigger.contains(e.target)) _close();
  }, true);

  // Show what context the AI has each time the panel opens
  function _appendContextIndicator() {
    const state = _getViewState();
    let text = 'I can see your full document.';
    if (state.title) text += ` "${state.title}"`;
    if (state.selectedText) text += ' You have text selected.';
    const indicator = _el('div', 'cw-context', null, text);
    _messageList.appendChild(indicator);
    _scrollToBottom();
  }

  // ── Send / receive ────────────────────────────────────────────────────────

  function _send() {
    const text = _input.value.trim();
    if (!text || _isStreaming) return;
    _input.value = '';
    _autoResize.call(_input);
    _messages.push({ role: 'user', content: text });
    _appendMessage('user', text);
    _stream();
  }

  async function _stream() {
    _isStreaming = true;
    _sendBtn.disabled = true;
    const bubble = _appendMessage('assistant', '');

    try {
      const res = await fetch(_endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: _messages, viewState: _getViewState() }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Server error' }));
        bubble.textContent = `⚠ ${err.error}`;
        return;
      }

      const reader  = res.body.getReader();
      const decoder = new TextDecoder();
      let assistantText = '';
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const payload = line.slice(6).trim();
          if (payload === '[DONE]') break;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.error) { bubble.textContent = `⚠ ${parsed.error}`; return; }
            if (parsed.token) {
              assistantText += parsed.token;
              bubble.innerHTML = _md(assistantText);
              _scrollToBottom();
            }
          } catch { /* skip malformed SSE */ }
        }
      }

      _messages.push({ role: 'assistant', content: assistantText });

    } catch {
      bubble.textContent = '⚠ Could not reach the server. Is it running?';
    } finally {
      _isStreaming = false;
      _sendBtn.disabled = false;
      _input.focus();
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  function _appendMessage(role, text) {
    const row    = _el('div', `cw-msg cw-msg--${role}`);
    const bubble = _el('div', 'cw-bubble');
    bubble[role === 'assistant' ? 'innerHTML' : 'textContent'] =
      role === 'assistant' ? _md(text) : text;
    row.appendChild(bubble);
    _messageList.appendChild(row);
    _scrollToBottom();
    return bubble;
  }

  function _md(text) {
    return (typeof marked !== 'undefined') ? marked.parse(text) : text;
  }

  function _scrollToBottom() {
    _messageList.scrollTop = _messageList.scrollHeight;
  }

  function _autoResize() {
    this.style.height = 'auto';
    this.style.height = Math.min(this.scrollHeight, 120) + 'px';
  }

  function _el(tag, cls, id, text) {
    const el = document.createElement(tag);
    if (cls)       el.className   = cls;
    if (id)        el.id          = id;
    if (text != null) el.textContent = text;
    return el;
  }

  // ── Styles ────────────────────────────────────────────────────────────────
  // Matches Simple Write design tokens: same font stack, same gray palette,
  // same border radius levels (12px panel = rounded-lg, 8px inputs = rounded-md).

  function _injectStyles() {
    if (document.getElementById('cw-styles')) return;
    const style = document.createElement('style');
    style.id = 'cw-styles';
    style.textContent = `
      .cw-trigger {
        position: fixed;
        bottom: 24px;
        right: 24px;
        width: 44px;
        height: 44px;
        border-radius: 50%;
        background: #111827;
        color: #fff;
        font-size: 18px;
        border: none;
        cursor: pointer;
        box-shadow: 0 4px 12px rgba(0,0,0,.20);
        z-index: 9999;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: transform .15s, background .15s;
        line-height: 1;
      }
      .cw-trigger:hover  { background: #374151; transform: scale(1.06); }
      .cw-trigger--active { background: #374151; }
      .cw-trigger--hidden { display: none; }

      .cw-panel {
        position: fixed;
        bottom: 80px;
        right: 24px;
        width: 400px;
        height: 520px;
        background: #fff;
        border: 1px solid #E5E7EB;
        border-radius: 12px;
        box-shadow: 0 12px 32px rgba(0,0,0,.15);
        display: none;
        flex-direction: column;
        overflow: hidden;
        z-index: 9998;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
        font-size: 13px;
      }
      .cw-panel--open { display: flex; }

      .cw-panel--docked {
        top: 0; left: 0; bottom: 0; right: auto;
        width: 360px; height: 100vh;
        border-radius: 0;
        border-left: none; border-top: none; border-bottom: none;
        border-right: 1px solid #E5E7EB;
        box-shadow: 2px 0 12px rgba(0,0,0,.06);
      }
      body.cw-body-docked { padding-left: 360px !important; transition: padding-left .2s; }

      .cw-header {
        display: flex; align-items: center; justify-content: space-between;
        padding: 12px 16px;
        border-bottom: 1px solid #F3F4F6;
        flex-shrink: 0;
      }
      .cw-title { font-weight: 600; color: #111827; font-size: 13px; }
      .cw-header-actions { display: flex; align-items: center; gap: 2px; }
      .cw-dock, .cw-close {
        background: none; border: none; line-height: 1; cursor: pointer;
        color: #9CA3AF; padding: 2px 5px; border-radius: 6px;
        transition: color .15s, background .15s;
      }
      .cw-dock  { font-size: 15px; }
      .cw-close { font-size: 20px; }
      .cw-dock:hover, .cw-close:hover { color: #111827; background: #F3F4F6; }

      .cw-messages {
        flex: 1; overflow-y: auto; padding: 12px 16px;
        display: flex; flex-direction: column; gap: 8px;
      }
      .cw-context {
        font-size: 11px; color: #9CA3AF; text-align: center;
        padding: 4px 0 8px; border-bottom: 1px solid #F3F4F6; margin-bottom: 4px;
      }

      .cw-msg { display: flex; }
      .cw-msg--user      { justify-content: flex-end; }
      .cw-msg--assistant { justify-content: flex-start; }

      .cw-bubble {
        max-width: 82%; padding: 8px 12px;
        border-radius: 10px; line-height: 1.55; word-break: break-word;
      }
      .cw-msg--user .cw-bubble {
        white-space: pre-wrap; background: #111827; color: #fff;
        border-bottom-right-radius: 3px;
      }
      .cw-msg--assistant .cw-bubble {
        background: #F3F4F6; color: #111827; border-bottom-left-radius: 3px;
      }

      .cw-msg--assistant .cw-bubble h1,
      .cw-msg--assistant .cw-bubble h2,
      .cw-msg--assistant .cw-bubble h3 { font-weight: 600; margin: 10px 0 4px; line-height: 1.3; }
      .cw-msg--assistant .cw-bubble h1 { font-size: 15px; }
      .cw-msg--assistant .cw-bubble h2 { font-size: 14px; }
      .cw-msg--assistant .cw-bubble h3 { font-size: 13px; }
      .cw-msg--assistant .cw-bubble p  { margin: 0 0 6px; }
      .cw-msg--assistant .cw-bubble p:last-child { margin-bottom: 0; }
      .cw-msg--assistant .cw-bubble ul,
      .cw-msg--assistant .cw-bubble ol { margin: 4px 0 6px; padding-left: 18px; }
      .cw-msg--assistant .cw-bubble li { margin-bottom: 2px; }
      .cw-msg--assistant .cw-bubble code {
        background: #E5E7EB; border-radius: 4px; padding: 1px 4px;
        font-size: 12px; font-family: 'SF Mono', ui-monospace, monospace;
      }
      .cw-msg--assistant .cw-bubble pre {
        background: #E5E7EB; border-radius: 6px; padding: 8px 10px;
        overflow-x: auto; margin: 6px 0;
      }
      .cw-msg--assistant .cw-bubble pre code { background: none; padding: 0; }
      .cw-msg--assistant .cw-bubble strong { font-weight: 600; }
      .cw-msg--assistant .cw-bubble em     { font-style: italic; }
      .cw-msg--assistant .cw-bubble hr     { border: none; border-top: 1px solid #D1D5DB; margin: 8px 0; }

      .cw-input-row {
        display: flex; align-items: flex-end; gap: 8px;
        padding: 10px 12px; border-top: 1px solid #F3F4F6; flex-shrink: 0;
      }
      .cw-input {
        flex: 1; border: 1px solid #E5E7EB; border-radius: 8px;
        padding: 8px 10px; font-size: 13px; font-family: inherit;
        resize: none; outline: none; line-height: 1.4;
        max-height: 120px; overflow-y: auto; transition: border-color .15s;
        color: #111827;
      }
      .cw-input:focus { border-color: #6366F1; }
      .cw-send {
        width: 32px; height: 32px; border-radius: 8px;
        background: #6366F1; color: #fff; border: none; cursor: pointer;
        font-size: 16px; display: flex; align-items: center; justify-content: center;
        flex-shrink: 0; transition: background .15s;
      }
      .cw-send:hover    { background: #4F46E5; }
      .cw-send:disabled { background: #D1D5DB; cursor: default; }
    `;
    document.head.appendChild(style);
  }

  return { init, setViewState };
})();
