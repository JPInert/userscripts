// ==UserScript==
// @name         Clipboard Scratchpad
// @namespace    https://github.com/JPInert/userscripts
// @version      2.1
// @description  Compact running clipboard-copy history, available on every page, with a collapsible notes field at the bottom. Captures native copy events (Ctrl+C / right-click Copy); synced live across tabs via GM storage.
// @author       JPInert
// @match        *://*/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM.getValue
// @grant        GM_addValueChangeListener
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/JPInert/userscripts/main/clipboard_scratchpad.user.js
// @updateURL    https://raw.githubusercontent.com/JPInert/userscripts/main/clipboard_scratchpad.user.js
// ==/UserScript==

(function () {
  'use strict';

  const log = (...args) => console.log('[Scratchpad]', ...args);
  const MAX_HISTORY = 100;
  const DRAG_THRESHOLD = 4; // px of movement before a mousedown counts as a drag, not a click

  // ── STYLES ────────────────────────────────────────────────────────────────
  function injectStyles() {
    if (document.getElementById('csp-styles')) return;
    const s = document.createElement('style');
    s.id = 'csp-styles';
    s.textContent = `
      .csp-icon-btn {
        border: none; border-radius: 3px; padding: 3px 6px;
        font-size: 12px; font-family: 'Segoe UI', sans-serif;
        cursor: pointer; line-height: 1.3; transition: opacity .15s;
      }
      .csp-icon-btn:hover { opacity: .8; }
      .csp-btn-clear { background: #7a1f1f; color: #fff; }
      .csp-btn-pause { background: #5a4a1f; color: #fff; }
      .csp-btn-pause.csp-active { background: #1f5a2e; }
      .csp-notes-toggle {
        border: none; background: none; color: #9a84ac; font-size: 12px;
        font-family: 'Segoe UI', sans-serif; cursor: pointer; padding: 2px 0;
      }
      .csp-notes-toggle:hover { color: #dcc8e8; }
      .csp-textarea {
        background: #0d1e2e; border: 1px solid #2a3a4a; border-radius: 3px;
        color: #c8d8e8; font-size: 13px; padding: 5px 7px; font-family: 'Segoe UI', sans-serif;
        width: 100%; box-sizing: border-box; resize: vertical; min-height: 50px;
      }
      .csp-bottom-bar {
        display: flex; align-items: center; justify-content: space-between;
        gap: 6px; padding: 4px 8px; border-top: 1px solid #2a1f38;
      }
      .csp-history { overflow-y: auto; max-height: 150px; }
      .csp-entry {
        display: flex; align-items: flex-start; justify-content: space-between; gap: 6px;
        padding: 4px 8px; border-bottom: 1px solid #16101f; cursor: pointer;
        font-size: 12.5px; color: #c8d8e8; user-select: text;
      }
      .csp-entry:hover { background: #150c20; }
      .csp-entry.csp-cell-copied { background: #2e7d32 !important; color: #fff; }
      .csp-entry-main { flex: 1; min-width: 0; }
      .csp-entry-meta { color: #5a7a94; font-size: 10.5px; margin-top: 1px; }
      .csp-entry-text { white-space: pre-wrap; word-break: break-word; }
      .csp-entry-del {
        border: none; background: none; color: #b04a4a; font-size: 14px;
        line-height: 1; cursor: pointer; padding: 0 2px; flex-shrink: 0;
      }
      .csp-entry-del:hover { color: #ff6b6b; }
      .csp-empty { padding: 8px; color: #5a7a94; font-size: 12.5px; text-align: center; }
    `;
    document.head.appendChild(s);
  }

  // ── STATE ─────────────────────────────────────────────────────────────────
  let history = [];
  let paused = GM_getValue('csp_capture_paused', false);
  let elements = {};

  let historyRaw = '[]'; // last csp_history string this tab saw — cheap change detection

  function applyHistoryRaw(raw) {
    raw = raw || '[]';
    if (raw === historyRaw) return false;
    try { history = JSON.parse(raw); } catch (e) { history = []; }
    historyRaw = raw;
    return true;
  }

  function loadHistory() {
    applyHistoryRaw(GM_getValue('csp_history', '[]'));
  }

  function saveHistory() {
    historyRaw = JSON.stringify(history);
    GM_setValue('csp_history', historyRaw);
  }

  // Pull path. Value-change events don't reliably reach background / frozen /
  // bfcache-restored tabs, so re-read storage whenever the tab comes back into
  // view instead of trusting that every push arrived. Prefers async GM.getValue
  // (goes to the extension) over GM_getValue (per-tab cache that can itself be stale).
  const readValue = (key, def) =>
    (typeof GM !== 'undefined' && GM.getValue)
      ? GM.getValue(key, def).catch(() => GM_getValue(key, def))
      : Promise.resolve(GM_getValue(key, def));

  async function refreshFromStorage() {
    const [raw, p, notes] = await Promise.all([
      readValue('csp_history', '[]'),
      readValue('csp_capture_paused', false),
      readValue('csp_notepad_text', ''),
    ]);
    if (applyHistoryRaw(raw)) renderHistory();
    setPaused(!!p);
    applyRemoteNotes(notes);
  }

  function setPaused(p) {
    paused = p;
    if (!elements.pauseBtn) return;
    elements.pauseBtn.textContent = paused ? '▶' : '⏸';
    elements.pauseBtn.title = paused ? 'Resume capture' : 'Pause capture';
    elements.pauseBtn.classList.toggle('csp-active', !paused);
  }

  // Don't stomp the textarea mid-typing — the blur handler re-reads storage.
  function applyRemoteNotes(val) {
    const ta = elements.textarea;
    if (!ta || val == null || val === ta.value) return;
    if (document.activeElement === ta) return;
    ta.value = val;
  }

  function addHistoryEntry(text) {
    loadHistory(); // pick up anything added from another tab first
    history.unshift({ text, ts: Date.now(), host: location.hostname });
    if (history.length > MAX_HISTORY) history.length = MAX_HISTORY;
    saveHistory();
    renderHistory();
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  // ── WIDGET ────────────────────────────────────────────────────────────────
  function injectWidget() {
    if (document.getElementById('csp-widget')) return;

    const savedPos = JSON.parse(GM_getValue('csp_panel_pos', 'null'));
    const startCollapsed = GM_getValue('csp_panel_collapsed', true);
    const notesExpanded = GM_getValue('csp_notes_expanded', false);

    const widget = document.createElement('div');
    widget.id = 'csp-widget';
    Object.assign(widget.style, {
      position: 'fixed', display: 'flex', flexDirection: 'column',
      width: 'fit-content',
      zIndex: '2147483000',
      left:   savedPos ? `${savedPos.left}px` : 'auto',
      top:    savedPos ? `${savedPos.top}px`  : '20px',
      right:  savedPos ? 'auto' : '20px',
      fontFamily: "'Segoe UI', sans-serif", fontSize: '12px',
      userSelect: 'none',
      background: '#1a0f26',
      border: '1px solid #3a2a4a', borderRadius: '6px',
      boxShadow: '0 4px 16px rgba(0,0,0,.5)',
      overflow: 'hidden',
    });

    // Header — flat top edge, drag handle + collapse toggle in one
    const header = document.createElement('div');
    Object.assign(header.style, {
      background: 'linear-gradient(135deg, #2a1a3a, #5a2d7a)',
      padding: '5px 9px', cursor: 'grab',
      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px',
      flexShrink: '0',
    });
    const titleEl = document.createElement('span');
    Object.assign(titleEl.style, { fontWeight: '600', fontSize: '12.5px', color: '#dcc8e8', whiteSpace: 'nowrap' });
    titleEl.textContent = '📋 Clipboard';
    const chevronEl = document.createElement('span');
    Object.assign(chevronEl.style, { fontSize: '12px', color: '#c8b8d8' });
    chevronEl.textContent = startCollapsed ? '▸' : '▾';
    header.appendChild(titleEl);
    header.appendChild(chevronEl);

    // Body — everything below the header, hidden when collapsed
    const body = document.createElement('div');
    Object.assign(body.style, {
      display: startCollapsed ? 'none' : 'flex',
      flexDirection: 'column',
      width: '260px',
    });

    // History list (the main content)
    const historyWrap = document.createElement('div');
    historyWrap.className = 'csp-history';
    const historyBody = document.createElement('div');
    historyBody.id = 'csp-history-body';
    historyWrap.appendChild(historyBody);

    // Bottom bar — notes toggle + small pause/clear buttons, one line
    const bottomBar = document.createElement('div');
    bottomBar.className = 'csp-bottom-bar';
    const notesToggle = document.createElement('button');
    notesToggle.className = 'csp-notes-toggle';
    notesToggle.textContent = (notesExpanded ? '▾' : '▸') + ' Notes';
    const btnGroup = document.createElement('div');
    Object.assign(btnGroup.style, { display: 'flex', gap: '4px' });
    const pauseBtn = document.createElement('button');
    pauseBtn.className = 'csp-icon-btn csp-btn-pause' + (paused ? '' : ' csp-active');
    pauseBtn.textContent = paused ? '▶' : '⏸';
    pauseBtn.title = paused ? 'Resume capture' : 'Pause capture';
    const clearBtn = document.createElement('button');
    clearBtn.className = 'csp-icon-btn csp-btn-clear'; clearBtn.textContent = '🗑';
    clearBtn.title = 'Clear history';
    btnGroup.appendChild(pauseBtn); btnGroup.appendChild(clearBtn);
    bottomBar.appendChild(notesToggle); bottomBar.appendChild(btnGroup);

    // Notes textarea — collapsed by default
    const textarea = document.createElement('textarea');
    textarea.className = 'csp-textarea';
    textarea.value = GM_getValue('csp_notepad_text', '');
    textarea.placeholder = 'Freeform notes… autosaves as you type';
    Object.assign(textarea.style, { display: notesExpanded ? 'block' : 'none', margin: '0 8px 6px', width: 'calc(100% - 16px)' });

    body.appendChild(historyWrap);
    body.appendChild(bottomBar);
    body.appendChild(textarea);
    widget.appendChild(header);
    widget.appendChild(body);
    document.body.appendChild(widget);

    elements = { textarea, pauseBtn, clearBtn, historyBody };
    renderHistory();

    // Header: click toggles collapse, drag repositions — distinguished by movement
    let collapsed = startCollapsed;
    let dragging = false, dragged = false, dragOX = 0, dragOY = 0;
    header.addEventListener('mousedown', e => {
      if (e.button !== 0) return;
      dragging = true; dragged = false; header.style.cursor = 'grabbing';
      const r = widget.getBoundingClientRect();
      dragOX = e.clientX - r.left; dragOY = e.clientY - r.top;
      e.preventDefault();
    });
    document.addEventListener('mousemove', e => {
      if (!dragging) return;
      const dx = Math.abs(e.clientX - (widget.getBoundingClientRect().left + dragOX));
      const dy = Math.abs(e.clientY - (widget.getBoundingClientRect().top + dragOY));
      if (dx > DRAG_THRESHOLD || dy > DRAG_THRESHOLD) dragged = true;
      if (!dragged) return;
      widget.style.left  = `${Math.max(0, Math.min(window.innerWidth  - 50, e.clientX - dragOX))}px`;
      widget.style.top   = `${Math.max(0, Math.min(window.innerHeight - 50, e.clientY - dragOY))}px`;
      widget.style.right = 'auto';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; header.style.cursor = 'grab';
      if (dragged) {
        GM_setValue('csp_panel_pos', JSON.stringify({
          left: parseInt(widget.style.left), top: parseInt(widget.style.top),
        }));
      } else {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'flex';
        chevronEl.textContent = collapsed ? '▸' : '▾';
        GM_setValue('csp_panel_collapsed', collapsed);
      }
    });

    // Notes toggle (collapsible, independent of the main collapse)
    let notesOpen = notesExpanded;
    notesToggle.addEventListener('click', e => {
      e.stopPropagation();
      notesOpen = !notesOpen;
      textarea.style.display = notesOpen ? 'block' : 'none';
      notesToggle.textContent = (notesOpen ? '▾' : '▸') + ' Notes';
      GM_setValue('csp_notes_expanded', notesOpen);
    });

    // Notepad autosave (debounced)
    let saveTimer = null;
    const saveNotes = () => { saveTimer = null; GM_setValue('csp_notepad_text', textarea.value); };
    textarea.addEventListener('input', () => {
      clearTimeout(saveTimer);
      saveTimer = setTimeout(saveNotes, 400);
    });
    textarea.addEventListener('blur', () => {
      // Local edit pending → it's the newest write, flush it. Otherwise pick up
      // whatever another tab wrote while this one had focus.
      if (saveTimer) { clearTimeout(saveTimer); saveNotes(); }
      else refreshFromStorage();
    });

    pauseBtn.addEventListener('click', e => {
      e.stopPropagation();
      setPaused(!paused);
      GM_setValue('csp_capture_paused', paused);
    });

    clearBtn.addEventListener('click', e => {
      e.stopPropagation();
      loadHistory(); // count/clear what's actually stored, not this tab's copy
      if (!history.length) { renderHistory(); return; }
      if (!confirm(`Clear all ${history.length} clipboard history entries? This cannot be undone.`)) return;
      history = [];
      saveHistory();
      renderHistory();
    });

    log('Widget injected');
  }

  function renderHistory() {
    const el = elements.historyBody;
    if (!el) return;
    if (!history.length) {
      el.innerHTML = '<div class="csp-empty">Nothing copied yet.</div>';
      return;
    }
    el.innerHTML = history.map((h, i) => `
      <div class="csp-entry" data-idx="${i}" title="Click to copy">
        <div class="csp-entry-main">
          <div class="csp-entry-text"></div>
          <div class="csp-entry-meta">${timeLabel(h.ts)} — ${h.host}</div>
        </div>
        <button class="csp-entry-del" title="Delete entry">×</button>
      </div>
    `).join('');
    // set text via textContent (not innerHTML) so copied HTML/script-looking text can't inject markup
    el.querySelectorAll('.csp-entry').forEach(entryEl => {
      const idx = parseInt(entryEl.dataset.idx, 10);
      entryEl.querySelector('.csp-entry-text').textContent = history[idx].text.length > 300
        ? history[idx].text.slice(0, 300) + '…'
        : history[idx].text;
      const { ts, text } = history[idx];
      entryEl.querySelector('.csp-entry-del').addEventListener('click', e => {
        e.stopPropagation();
        // Re-read first: splicing a stale in-memory copy and saving it would wipe
        // every entry other tabs added since this tab last synced.
        loadHistory();
        const i = history.findIndex(h => h.ts === ts && h.text === text);
        if (i !== -1) { history.splice(i, 1); saveHistory(); }
        renderHistory();
      });
      entryEl.addEventListener('click', () => {
        navigator.clipboard.writeText(text).then(() => {
          entryEl.classList.add('csp-cell-copied');
          setTimeout(() => entryEl.classList.remove('csp-cell-copied'), 400);
        }).catch(() => {});
      });
    });
  }

  // ── COPY CAPTURE ──────────────────────────────────────────────────────────
  function installCopyListener() {
    document.addEventListener('copy', () => {
      if (paused) return;
      const sel = window.getSelection ? window.getSelection().toString() : '';
      if (!sel || !sel.trim()) return;
      addHistoryEntry(sel);
    });
  }

  // ── CROSS-TAB SYNC ────────────────────────────────────────────────────────
  function installSync() {
    // Push path. Compare content instead of trusting the `remote` flag, so a
    // quirk in how Tampermonkey sets it can't silently drop an update.
    GM_addValueChangeListener('csp_history', (name, oldValue, newValue) => {
      if (applyHistoryRaw(newValue)) renderHistory();
    });
    GM_addValueChangeListener('csp_capture_paused', (name, oldValue, newValue) => {
      if (!!newValue !== paused) setPaused(!!newValue);
    });
    // Live-sync the notes field across already-open tabs. Last write wins if
    // two tabs are edited at the exact same moment — fine for a personal
    // scratchpad, not worth building conflict resolution for.
    GM_addValueChangeListener('csp_notepad_text', (name, oldValue, newValue) => {
      applyRemoteNotes(newValue);
    });

    // Pull path — see refreshFromStorage().
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') refreshFromStorage();
    });
    window.addEventListener('focus', refreshFromStorage);
    window.addEventListener('pageshow', e => { if (e.persisted) refreshFromStorage(); });
  }

  // ── INIT ──────────────────────────────────────────────────────────────────
  function init() {
    loadHistory();
    injectStyles();
    injectWidget();
    installCopyListener();
    installSync();
    log('init: done');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => setTimeout(init, 800));
  } else {
    setTimeout(init, 800);
  }

})();
