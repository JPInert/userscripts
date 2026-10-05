// ==UserScript==
// @name         Canned Responses
// @namespace    https://github.com/JPInert/userscripts
// @version      2.0
// @description  Canned responses for the Zendesk agent workspace: store, edit, pin, search and insert reply snippets, import/export them as JSON, and optionally send the draft to a local model server for a rewrite you can revert.
// @author       JPInert
// @match        https://*.zendesk.com/agent/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        unsafeWindow
// @noframes
// @license      MIT
// @downloadURL  https://raw.githubusercontent.com/JPInert/userscripts/main/canned-responses.user.js
// @updateURL    https://raw.githubusercontent.com/JPInert/userscripts/main/canned-responses.user.js
// ==/UserScript==

(function () {
  'use strict';

  // STORAGE
  const STORE_KEY    = 'cr_snippets';
  const POS_KEY      = 'cr_panel_pos';
  const COLLAPSE_KEY = 'cr_collapsed';
  const TAB_KEY      = 'cr_active_tab';
  const SETTINGS_KEY = 'cr_settings';

  // SETTINGS (edited in Manage > Settings, stored in the userscript manager)
  const DEFAULT_SETTINGS = {
    // Local model server used by Revise. Leave blank to turn Revise off.
    serverUrl: 'http://127.0.0.1:8765',
    // Sent to the server with every Revise request.
    reviseInstructions: 'Tighten this support reply. Fix grammar and spelling, keep every fact, link and step, keep the tone friendly and plain, and do not add new information.',
    // Used by the pipeline insert to normalise the opening and closing lines.
    greeting:  'Hi there,',
    signature: 'Best,\nYour support team',
    // A CC or follower whose email equals this, or whose name contains it, is removed by the
    // pipeline insert (for example your own team's shared address). Blank = remove nobody.
    stripCcMatch: '',
  };

  function loadSettings() {
    let saved = {};
    try { saved = JSON.parse(GM_getValue(SETTINGS_KEY, '{}')) || {}; } catch (_) {}
    return Object.assign({}, DEFAULT_SETTINGS, saved);
  }
  function saveSettings(obj) { GM_setValue(SETTINGS_KEY, JSON.stringify(obj)); }
  function serverUrl() { return (loadSettings().serverUrl || '').trim().replace(/\/+$/, ''); }

  // Shipped examples, written to storage only when the store is empty (first run).
  const EXAMPLE_SNIPPETS = [
    { id: 'ex1', title: 'Looking into it', tags: ['ack'], pinned: true,
      body: 'Thanks for reaching out. I am looking into this now and will update you here as soon as I know more.' },
    { id: 'ex2', title: 'Ask for a screenshot', tags: ['info'], pinned: false,
      body: 'Could you send a screenshot of what you are seeing, including any error message? It will help me track this down faster.' },
    { id: 'ex3', title: 'Closing this out', tags: ['close'], pinned: false,
      body: 'It looks like this is resolved, so I am closing this ticket. If anything else comes up, just reply here and it will reopen.' },
  ];

  function loadSnippets() {
    try { return JSON.parse(GM_getValue(STORE_KEY, '[]')); } catch (_) { return []; }
  }

  // Storage is the userscript manager's own (GM_*), shared by every tab on the site.
  // The _api* functions stay async so the UI code does not care where snippets live.
  function _cacheSnippets(list) {
    GM_setValue(STORE_KEY, JSON.stringify(list));
  }

  function _seedIfEmpty() {
    let raw = null;
    try { raw = GM_getValue(STORE_KEY, null); } catch (_) {}
    if (raw === null) _cacheSnippets(EXAMPLE_SNIPPETS.map(s => Object.assign({ updatedAt: Date.now() }, s)));
  }

  // Save a single snippet (new or edited).
  async function _apiSaveSnippet(snip, isNew) {
    const list = loadSnippets();
    if (isNew) {
      list.push(snip);
    } else {
      const i = list.findIndex(s => s.id === snip.id);
      if (i < 0) throw new Error('Snippet not found');
      // Keep fields the editor does not show (e.g. pinned) unless the caller set them.
      list[i] = Object.assign({}, list[i], snip);
    }
    _cacheSnippets(list);
  }

  async function _apiDeleteSnippet(id) {
    _cacheSnippets(loadSnippets().filter(s => s.id !== id));
  }

  // Import an array (upsert by id). Returns { added, updated }.
  async function _apiImportSnippets(arr) {
    const list = loadSnippets();
    let added = 0, updated = 0;
    for (const snip of arr) {
      const i = list.findIndex(s => s.id === snip.id);
      if (i >= 0) { list[i] = snip; updated++; } else { list.push(snip); added++; }
    }
    _cacheSnippets(list);
    return { added, updated };
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

  async function togglePinned(id) {
    const snip = loadSnippets().find(s => s.id === id);
    if (!snip) return;
    try {
      await _apiSaveSnippet(Object.assign({}, snip, { pinned: !snip.pinned }), false);
      renderTabs();
    } catch (err) {
      alert('Failed to toggle pin: ' + err.message);
    }
  }

  function wirePinButtons(container) {
    container.querySelectorAll('.cr-pin-btn').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        togglePinned(btn.dataset.id);
      });
    });
  }

  // LINK CONVERSION
  // Author-time format: bare URLs and markdown [text](url) -- never raw HTML.
  // At insert time we convert to <a> tags so Zendesk gets real clickable links.
  const URL_RE  = /\bhttps?:\/\/[^\s<>"'()]+[^\s<>"'(),.;:!?\]]/g;
  const MD_LINK = /\[([^\]\n]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g;
  const URL_ONLY_RE = /^(?:https?:\/\/|mailto:)\S+$/;

  function escHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function bodyHasLinks(body) {
    return /https?:\/\//.test(body);
  }

  function bodyToHtml(body) {
    const masks = [];
    let s = body.replace(MD_LINK, (_m, text, url) => {
      masks.push({ text: text, url: url });
      return 'CRMDLINK' + (masks.length - 1) + 'CRMDEND';
    });
    s = escHtml(s);
    s = s.replace(URL_RE, function (url) { return '<a href="' + url + '">' + url + '</a>'; });
    s = s.replace(/CRMDLINK(\d+)CRMDEND/g, function (_m, i) {
      const entry = masks[+i];
      const safeUrl = entry.url.replace(/"/g, '%22');
      return '<a href="' + safeUrl + '">' + escHtml(entry.text) + '</a>';
    });
    return s.replace(/\n/g, '<br>');
  }

  function bodyToPlain(body) {
    return body.replace(MD_LINK, function (_m, text) { return text; });
  }

  // ZENDESK EDITOR INSERTION

  // Track the last reply editor that had focus. Clicking the canned-response panel
  // steals focus before findReplyEditor() runs, so document.activeElement no longer
  // points at the editor — this lets us remember which ticket was active.
  let _lastFocusedEditor = null;
  document.addEventListener('focusin', function (e) {
    const el = e.target;
    if (el.contentEditable === 'true' && (
      el.closest('.zendesk-editor--rich-text-container') ||
      el.closest('[data-test-id="omnicomposer-rich-text-ckeditor"]') ||
      el.classList.contains('ck-editor__editable')
    )) {
      _lastFocusedEditor = el;
    }
  }, true);

  function findReplyEditor() {
    // Prefer the editor that most recently had focus (survives panel click stealing focus).
    if (_lastFocusedEditor && _lastFocusedEditor.isConnected) {
      const r = _lastFocusedEditor.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return _lastFocusedEditor;
    }

    const editors = Array.from(document.querySelectorAll(
      '.zendesk-editor--rich-text-container [contenteditable="true"], ' +
      '[data-test-id="omnicomposer-rich-text-ckeditor"] [contenteditable="true"], ' +
      '.ck-editor__editable[contenteditable="true"]'
    ));
    if (editors.length === 0) return null;

    const isVisible = (el) => {
      if (!el.offsetParent) return false;
      const r = el.getBoundingClientRect();
      if (r.width <= 0 || r.height <= 0) return false;
      return r.bottom > 0 && r.top < window.innerHeight && r.right > 0 && r.left < window.innerWidth;
    };

    const visible = editors.filter(isVisible);
    if (visible.length === 0) return null;

    const focused = visible.find(e => e === document.activeElement || e.contains(document.activeElement));
    return focused || visible[0];
  }

  // CKEditor 5 instance for the active ticket's reply box. findReplyEditor() picks the
  // visible/focused editor (ZD keeps background tickets' editors in the DOM); the
  // omnicomposer data-test-id is kept only as a last-resort fallback.
  function findCkEditor() {
    const ed = findReplyEditor();
    const host = ed && (ed.ckeditorInstance ? ed : ed.closest('.ck-editor__editable'));
    if (host && host.ckeditorInstance) return host.ckeditorInstance;
    const legacy = document.querySelector('[data-test-id="omnicomposer-rich-text-ckeditor"]');
    return legacy && legacy.ckeditorInstance ? legacy.ckeditorInstance : null;
  }

  // REVISE (local server: POST <serverUrl>/api/revise, see README for the contract)
  // Two entry points share one implementation: the panel buttons (act on the focused /
  // visible editor) and the inline ✨ button next to the composer's mic button (acts on
  // the editor of the composer it sits in). Original drafts are kept per editor instance
  // (a WeakMap keyed on the CKEditor object), not in one global slot: the workspace keeps
  // several tickets' composers mounted at once, and a single "last draft" would let Revert
  // on one ticket paste another ticket's text.
  const reviseState = new WeakMap();   // ck -> { original, revised }
  const reviseBusy  = new WeakSet();   // ck currently being revised
  let lastPanelCk = null;

  // Time-of-day greeting in the browser's local time, passed to the server as a hint.
  function timeGreeting() {
    return new Date().getHours() < 12 ? 'Good Morning,' : 'Good Afternoon,';
  }

  // Returns { ok, msg }. Never throws; never overwrites edits made mid-request.
  async function reviseEditor(ck) {
    if (!ck) return { ok: false, msg: 'Could not find the reply box. Click into it first.' };
    if (reviseBusy.has(ck)) return { ok: false, msg: 'Already revising.' };
    const draft = ck.getData();
    if (!draft.replace(/<[^>]*>|&nbsp;/g, '').trim()) return { ok: false, msg: 'Reply box is empty.' };
    const base = serverUrl();
    if (!base) return { ok: false, msg: 'No revise server set. Add one in Manage > Settings.' };
    const settings = loadSettings();
    reviseBusy.add(ck);
    try {
      let resp;
      try {
        resp = await fetch(base + '/api/revise', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ html: draft, greeting: timeGreeting(), instructions: settings.reviseInstructions }),
          signal: AbortSignal.timeout(60000),
        });
      } catch (_) {
        return { ok: false, msg: 'Revise server not reachable at ' + base + '. Is it running?' };
      }
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok || !data.ok) return { ok: false, msg: data.error || ('Server error ' + resp.status) };
      // The request can take many seconds. If the agent kept typing meanwhile, applying the
      // rewrite would silently throw that typing away, so apply nothing and say so.
      if (ck.getData() !== draft) return { ok: false, msg: 'Draft changed while revising. Left it as you typed it; try again.' };
      ck.setData(data.html);
      const prev = reviseState.get(ck);
      // Keep the very first original across repeated revises, so Revert goes back to what the
      // agent wrote, not to an earlier rewrite.
      reviseState.set(ck, { original: prev && prev.revised === draft ? prev.original : draft, revised: ck.getData() });
      const secs = typeof data.duration_ms === 'number' ? ' in ' + (data.duration_ms / 1000).toFixed(1) + 's' : '';
      return { ok: true, msg: 'Revised' + secs + '. Review before sending.' };
    } finally {
      reviseBusy.delete(ck);
    }
  }

  // Returns { ok, msg }.
  function revertEditor(ck) {
    const st = ck && reviseState.get(ck);
    if (!st) return { ok: false, msg: 'Nothing to revert.' };
    if (ck.getData() !== st.revised &&
        !confirm('You edited the reply after revising. Revert to the original draft anyway?')) return { ok: false, msg: '' };
    ck.setData(st.original);
    reviseState.delete(ck);
    return { ok: true, msg: 'Original draft restored.' };
  }

  // ── panel buttons ──
  function setReviseStatus(msg, isError) {
    const el = document.getElementById('cr-revise-status');
    if (!el) return;
    el.textContent = msg || '';
    el.style.color = isError ? '#e58a8a' : '#8a9ab0';
    el.style.display = msg ? 'block' : 'none';
  }

  function syncPanelRevert() {
    const rv = document.getElementById('cr-revert-btn');
    if (rv) rv.disabled = !(lastPanelCk && reviseState.has(lastPanelCk));
  }

  async function runRevise() {
    const ck = findCkEditor();
    const btn = document.getElementById('cr-revise-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Revising…'; }
    setReviseStatus('');
    const res = await reviseEditor(ck);
    if (res.ok) lastPanelCk = ck;
    setReviseStatus(res.msg, !res.ok);
    const b = document.getElementById('cr-revise-btn');
    if (b) { b.disabled = false; b.textContent = '✨ Revise draft'; }
    syncPanelRevert();
    refreshInlineRevert();
  }

  function runRevert() {
    const res = revertEditor(lastPanelCk);
    if (res.msg) setReviseStatus(res.msg, !res.ok);
    syncPanelRevert();
    refreshInlineRevert();
  }

  // ── inline buttons next to the composer's "Record a voice message" mic ──
  const SPARKLE_SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="currentColor" d="M6 1l1.2 3.3L10.5 5.5 7.2 6.7 6 10 4.8 6.7 1.5 5.5 4.8 4.3zM12 8l.7 1.8 1.8.7-1.8.7L12 13l-.7-1.8-1.8-.7 1.8-.7zM11 1l.5 1.2 1.2.5-1.2.5L11 4.4l-.5-1.2-1.2-.5 1.2-.5z"/></svg>';
  const REVISE_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><g stroke="#D97757" stroke-width="1.6" stroke-linecap="round"><path d="M8 1.5v4.2M8 10.3v4.2M1.5 8h4.2M10.3 8h4.2M3.4 3.4l3 3M9.6 9.6l3 3M12.6 3.4l-3 3M6.4 9.6l-3 3"/></g></svg>';
  const REVERT_SVG  = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" focusable="false"><path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" d="M5.5 3.5L2.5 6.5l3 3M2.5 6.5h7a4 4 0 0 1 0 8h-2"/></svg>';

  function ensureInlineStyles() {
    if (document.getElementById('cr-inline-style')) return;
    const st = document.createElement('style');
    st.id = 'cr-inline-style';
    st.textContent =
      '@keyframes cr-spin{to{transform:rotate(360deg)}}' +
      '.cr-inline-busy svg{animation:cr-spin 1s linear infinite;}' +
      '.cr-inline-busy{color:#1f73b7 !important;}' +
      '#cr-inline-toast{position:fixed;z-index:99999;max-width:320px;background:#0f1e2e;color:#c8d8e8;border:1px solid #2a3a4a;border-radius:6px;padding:6px 9px;font:12px -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;box-shadow:0 4px 16px rgba(0,0,0,.4);pointer-events:none;}';
    document.head.appendChild(st);
  }

  let toastTimer = null;
  function inlineToast(anchor, msg, isError) {
    if (!msg) return;
    let t = document.getElementById('cr-inline-toast');
    if (!t) { t = document.createElement('div'); t.id = 'cr-inline-toast'; document.body.appendChild(t); }
    t.textContent = msg;
    t.style.color = isError ? '#e58a8a' : '#c8d8e8';
    const r = anchor.getBoundingClientRect();
    t.style.left = Math.max(8, r.left) + 'px';
    t.style.top = '0px';
    t.style.display = 'block';
    t.style.top = Math.max(8, r.top - t.offsetHeight - 8) + 'px';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.display = 'none'; }, isError ? 7000 : 4000);
  }

  // The composer's own editor: walk up from the toolbar until an ancestor holds one.
  // (ZD keeps background tickets' composers mounted; this ties the button to its own.)
  function ckForToolbarEl(el) {
    for (let p = el; p && p !== document.body; p = p.parentElement) {
      const ed = p.querySelector('.ck-editor__editable');
      if (ed) return ed.ckeditorInstance || null;
    }
    return null;
  }

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const isVis = el => { if (!el || !el.offsetParent) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  // Opens this composer's Enhance writing menu and clicks Simplify. Zendesk's own AI
  // does the rewrite and replaces the draft itself; we only press its buttons.
  async function zdSimplify(anchor) {
    const toolbar = anchor.closest('[data-test-id="ticket-editor-app-icon-view"]') || anchor.parentElement;
    const enh = toolbar.querySelector('[data-test-id="omnicomposer-enhance-writing-menu-button"]');
    if (!enh) return { ok: false, msg: 'Enhance writing button not found in this composer.' };
    const ck = ckForToolbarEl(anchor);
    if (ck && !ck.getData().replace(/<[^>]*>|&nbsp;/g, '').trim()) return { ok: false, msg: 'Reply box is empty.' };
    if (enh.getAttribute('aria-expanded') !== 'true') enh.click();
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      const item = [...document.querySelectorAll('[data-test-id="enhance-writing-simplify"]')].find(isVis);
      if (item) {
        if (item.getAttribute('aria-disabled') === 'true') {
          enh.click();
          return { ok: false, msg: 'Simplify is unavailable for this draft.' };
        }
        item.click();
        return { ok: true, msg: '' };
      }
    }
    return { ok: false, msg: 'Simplify menu did not open.' };
  }

  function refreshInlineRevert() {
    document.querySelectorAll('.cr-revert-inline').forEach(b => {
      const ck = ckForToolbarEl(b);
      b.style.display = ck && reviseState.has(ck) ? '' : 'none';
    });
  }

  function injectInlineButtons() {
    document.querySelectorAll('[data-test-id="audio-recorder-mic-button"]').forEach(mic => {
      if (mic.parentElement.querySelector('.cr-revise-inline')) return;
      ensureInlineStyles();

      const sb = document.createElement('button');
      sb.type = 'button';
      sb.className = mic.className + ' cr-simplify-inline';
      sb.setAttribute('aria-label', 'Simplify (Zendesk AI)');
      sb.title = 'Simplify (Zendesk Enhance writing)';
      sb.innerHTML = SPARKLE_SVG;

      const rb = document.createElement('button');
      rb.type = 'button';
      rb.className = mic.className + ' cr-revise-inline';
      rb.setAttribute('aria-label', 'Revise draft with the local model server');
      rb.title = 'Revise with the local model server (Revert undoes it)';
      rb.innerHTML = REVISE_SVG;

      const vb = document.createElement('button');
      vb.type = 'button';
      vb.className = mic.className + ' cr-revert-inline';
      vb.setAttribute('aria-label', 'Revert to original draft');
      vb.title = 'Revert to the draft from before Revise';
      vb.innerHTML = REVERT_SVG;
      vb.style.display = 'none';

      sb.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const res = await zdSimplify(sb);
        if (!res.ok) inlineToast(sb, res.msg, true);
      });
      rb.addEventListener('click', async (e) => {
        e.preventDefault(); e.stopPropagation();
        const ck = ckForToolbarEl(rb);
        rb.classList.add('cr-inline-busy');
        rb.disabled = true;
        const res = await reviseEditor(ck);
        rb.classList.remove('cr-inline-busy');
        rb.disabled = false;
        inlineToast(rb, res.msg, !res.ok);
        refreshInlineRevert();
      });
      vb.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
        const res = revertEditor(ckForToolbarEl(vb));
        inlineToast(vb, res.msg, !res.ok);
        refreshInlineRevert();
        syncPanelRevert();
      });

      mic.insertAdjacentElement('afterend', sb);
      sb.insertAdjacentElement('afterend', rb);
      rb.insertAdjacentElement('afterend', vb);
      refreshInlineRevert();
    });
  }

  // ZD re-renders composers on ticket switch / tab change; re-inject on DOM changes
  // (throttled — the workspace mutates constantly).
  let inlineScheduled = false;
  new MutationObserver(() => {
    if (inlineScheduled) return;
    inlineScheduled = true;
    setTimeout(() => { inlineScheduled = false; injectInlineButtons(); }, 250);
  }).observe(document.documentElement, { childList: true, subtree: true });

  function insertIntoEditor(body) {
    const editor = findReplyEditor();
    if (!editor) {
      alert('Could not find a reply editor. Click into the reply box first, then click the snippet.');
      return false;
    }
    editor.focus();

    // Normalize CRLF so newlines convert to <br> cleanly.
    body = body.replace(/\r\n?/g, '\n');
    const plain = bodyToPlain(body);

    // Zendesk's reply box is CKEditor 5, which keeps its own document model and re-renders
    // the DOM from it. Writing into the contenteditable directly, execCommand('insertText')
    // and a synthetic paste carrying only text/plain are all ignored or undone. A paste event
    // that carries text/html goes through CKEditor's own clipboard pipeline, so it lands at
    // the cursor and keeps <br> line breaks and <a> links.
    try {
      const dt = new DataTransfer();
      dt.setData('text/plain', plain);
      dt.setData('text/html', bodyToHtml(body));
      const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: dt });
      editor.dispatchEvent(ev);
      return true;
    } catch (_) {}

    // Fallback if synthetic paste throws (older browsers without DataTransfer constructor).
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0) {
      const range = sel.getRangeAt(0);
      range.deleteContents();
      range.insertNode(document.createTextNode(plain));
      range.collapse(false);
      return true;
    }
    return false;
  }

  // EXPORT / IMPORT
  function exportJSON() {
    const list = loadSnippets();
    const blob = new Blob([JSON.stringify(list, null, 2)], { type: 'application/json' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10);
    a.href = url; a.download = 'canned-responses-' + date + '.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function importJSON() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json,.json';
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(reader.result);
          if (!Array.isArray(parsed)) throw new Error('Expected an array');
          const cleaned = parsed
            .filter(s => s && typeof s.title === 'string' && typeof s.body === 'string')
            .map(s => ({
              id:        s.id || uid(),
              title:     s.title,
              tags:      Array.isArray(s.tags) ? s.tags : (typeof s.tags === 'string' ? s.tags.split(',').map(t=>t.trim()).filter(Boolean) : []),
              body:      s.body,
              pinned:    !!s.pinned,
              updatedAt: s.updatedAt || Date.now(),
            }));
          const result = await _apiImportSnippets(cleaned);
          renderPanel();
          alert('Imported: ' + result.added + ' added, ' + result.updated + ' updated.');
        } catch (err) {
          alert('Import failed: ' + err.message);
        }
      };
      reader.readAsText(file);
    });
    input.click();
  }

  // STATE
  const state = {
    activeTab: GM_getValue(TAB_KEY, 'insert'),
    search:    '',
    editingId: null,
  };

  // RENDER
  function esc(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
  }

  function buildInsertTab() {
    const all = loadSnippets();
    const q = state.search.trim().toLowerCase();
    const matches = q
      ? all.filter(s =>
          s.title.toLowerCase().includes(q) ||
          s.body.toLowerCase().includes(q) ||
          (s.tags || []).some(t => t.toLowerCase().includes(q)))
      : all;
    matches.sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));

    const list = matches.length === 0
      ? '<div style="text-align:center;color:#8a9ab0;padding:20px;font-size:12px;">' +
        (all.length === 0 ? 'No snippets yet. Switch to Manage to add one.' : 'No matches.') +
        '</div>'
      : matches.map(s => {
          const plainPreview = bodyToPlain(s.body);
          const preview = plainPreview.length > 80 ? plainPreview.slice(0, 80) + '...' : plainPreview;
          const tags = (s.tags || []).map(t => '<span style="background:#1a3a5a;color:#5ba4e5;border-radius:3px;padding:1px 5px;font-size:9px;">' + esc(t) + '</span>').join(' ');
          const pinBtn = '<button class="cr-pin-btn" data-id="' + s.id + '" title="' + (s.pinned ? 'Unpin' : 'Pin to top') + '" ' +
            'style="border:none;background:none;cursor:pointer;font-size:12px;padding:0 2px;line-height:1;opacity:' + (s.pinned ? '1' : '.3') + ';">📌</button>';
          return '<div class="cr-snip" data-id="' + s.id + '" style="background:#0d1e2e;border:1px solid ' + (s.pinned ? '#3a6a9a' : '#1a3a5a') + ';border-radius:6px;padding:8px 10px;margin-bottom:6px;cursor:pointer;transition:background .15s;">' +
            '<div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:3px;">' +
              '<span style="font-size:12px;font-weight:700;color:#c8d8e8;flex:1;">' + esc(s.title) + '</span>' +
              '<span style="display:flex;align-items:center;gap:3px;">' + pinBtn + tags + '</span>' +
            '</div>' +
            '<div style="font-size:10px;color:#8a9ab0;line-height:1.35;white-space:pre-wrap;">' + esc(preview) + '</div>' +
          '</div>';
        }).join('');

    return '' +
      '<div style="display:flex;gap:6px;margin-bottom:6px;">' +
        '<button id="cr-revise-btn" title="Send the current draft to the local model server for a rewrite. The whole draft is sent as written." style="flex:1;background:#1f73b7;border:none;color:#fff;border-radius:5px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">' + '✨ Revise draft' + '</button>' +
        '<button id="cr-revert-btn" title="Restore the draft from before the last revise" style="background:#1a2a3a;border:1px solid #2a3a4a;color:#c8d8e8;border-radius:5px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;"' + (lastPanelCk && reviseState.has(lastPanelCk) ? '' : ' disabled') + '>Revert</button>' +
      '</div>' +
      '<div id="cr-revise-status" style="display:none;font-size:10px;line-height:1.35;margin-bottom:6px;"></div>' +
      '<div style="margin-bottom:8px;">' +
        '<input id="cr-search" type="text" placeholder="Search snippets..." value="' + esc(state.search) + '" ' +
          'style="width:100%;background:#0a1520;border:1px solid #1a3a5a;color:#c8d8e8;border-radius:5px;padding:6px 8px;font-size:12px;box-sizing:border-box;outline:none;" />' +
      '</div>' +
      '<div id="cr-list">' + list + '</div>' +
      '<div style="margin-top:8px;font-size:10px;color:#8a9ab0;text-align:center;">' +
        all.length + ' snippet' + (all.length === 1 ? '' : 's') + ' - click to insert into reply' +
      '</div>';
  }

  function buildEditor(snip) {
    const isNew = !snip.id;
    return '' +
      '<div style="background:#0d1e2e;border:1px solid #1a3a5a;border-radius:6px;padding:10px;margin-bottom:8px;">' +
        '<div style="font-size:10px;color:#8a9ab0;font-weight:600;letter-spacing:.4px;text-transform:uppercase;margin-bottom:6px;">' +
          (isNew ? 'New Snippet' : 'Edit Snippet') +
        '</div>' +
        '<label style="display:block;font-size:10px;color:#8a9ab0;margin-bottom:3px;">Title</label>' +
        '<input id="cr-edit-title" type="text" value="' + esc(snip.title || '') + '" ' +
          'style="width:100%;background:#0a1520;border:1px solid #1a3a5a;color:#c8d8e8;border-radius:4px;padding:5px 7px;font-size:12px;box-sizing:border-box;outline:none;margin-bottom:6px;" />' +

        '<label style="display:block;font-size:10px;color:#8a9ab0;margin-bottom:3px;">Tags (comma-separated)</label>' +
        '<input id="cr-edit-tags" type="text" value="' + esc((snip.tags || []).join(', ')) + '" ' +
          'style="width:100%;background:#0a1520;border:1px solid #1a3a5a;color:#c8d8e8;border-radius:4px;padding:5px 7px;font-size:12px;box-sizing:border-box;outline:none;margin-bottom:6px;" />' +

        '<label style="display:block;font-size:10px;color:#8a9ab0;margin-bottom:3px;">Body</label>' +
        '<textarea id="cr-edit-body" rows="8" ' +
          'style="width:100%;background:#0a1520;border:1px solid #1a3a5a;color:#c8d8e8;border-radius:4px;padding:6px 8px;font-size:12px;box-sizing:border-box;outline:none;font-family:inherit;resize:vertical;">' + esc(snip.body || '') + '</textarea>' +
        '<div style="font-size:9px;color:#6a7a8a;margin-top:3px;line-height:1.4;">' +
          'Tip: highlight text and paste a URL to link it. Bare URLs auto-link on insert.' +
        '</div>' +

        '<div style="display:flex;gap:6px;margin-top:8px;">' +
          '<button id="cr-edit-save" style="flex:1;background:#1f73b7;border:none;color:#fff;border-radius:4px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">Save</button>' +
          '<button id="cr-edit-cancel" style="flex:1;background:#1a2a3a;border:1px solid #2a3a4a;color:#c8d8e8;border-radius:4px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">Cancel</button>' +
          (isNew ? '' : '<button id="cr-edit-delete" style="background:#3a1a1a;border:1px solid #5a2a2a;color:#e58a8a;border-radius:4px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;">Delete</button>') +
        '</div>' +
      '</div>';
  }

  function buildManageTab() {
    const all = loadSnippets();
    if (state.editingId) {
      const snip = state.editingId === 'new'
        ? { title: '', tags: [], body: '' }
        : all.find(s => s.id === state.editingId) || { title: '', tags: [], body: '' };
      return buildEditor(snip);
    }

    const sorted = all.slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
    const rows = sorted.length === 0
      ? '<div style="text-align:center;color:#8a9ab0;padding:20px;font-size:12px;">No snippets yet.</div>'
      : sorted.map(s => '<div class="cr-manage-row" data-id="' + s.id + '" style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#0d1e2e;border:1px solid ' + (s.pinned ? '#3a6a9a' : '#1a3a5a') + ';border-radius:5px;margin-bottom:5px;cursor:pointer;">' +
          '<button class="cr-pin-btn" data-id="' + s.id + '" title="' + (s.pinned ? 'Unpin' : 'Pin to top') + '" ' +
            'style="border:none;background:none;cursor:pointer;font-size:12px;padding:0 2px;line-height:1;opacity:' + (s.pinned ? '1' : '.3') + ';">📌</button>' +
          '<span style="flex:1;font-size:12px;color:#c8d8e8;font-weight:600;">' + esc(s.title) + '</span>' +
          '<span style="font-size:10px;color:#8a9ab0;">' + esc((s.tags || []).join(', ')) + '</span>' +
        '</div>').join('');

    return '' +
      '<button id="cr-new-btn" style="width:100%;background:#1f73b7;border:none;color:#fff;border-radius:5px;padding:7px;font-size:11px;font-weight:600;cursor:pointer;letter-spacing:.3px;margin-bottom:8px;">+ New Snippet</button>' +
      '<div id="cr-manage-list">' + rows + '</div>' +
      '<div style="display:flex;gap:5px;margin-top:8px;">' +
        '<button id="cr-export-btn" style="flex:1;background:#1a3a5a;border:1px solid #2a5a8a;color:#5ba4e5;border-radius:4px;padding:5px;font-size:10px;font-weight:600;cursor:pointer;">Export JSON</button>' +
        '<button id="cr-import-btn" style="flex:1;background:#1a3a5a;border:1px solid #2a5a8a;color:#5ba4e5;border-radius:4px;padding:5px;font-size:10px;font-weight:600;cursor:pointer;">Import JSON</button>' +
      '</div>' +
      buildSettings();
  }

  function buildSettings() {
    const st = loadSettings();
    const inp = 'width:100%;background:#0a1520;border:1px solid #1a3a5a;color:#c8d8e8;border-radius:4px;padding:5px 7px;font-size:11px;box-sizing:border-box;outline:none;margin-bottom:6px;font-family:inherit;';
    const lab = 'display:block;font-size:10px;color:#8a9ab0;margin-bottom:3px;';
    return '' +
      '<details id="cr-settings" style="margin-top:10px;border-top:1px solid #1a2a3a;padding-top:8px;">' +
        '<summary style="cursor:pointer;font-size:10px;color:#8a9ab0;font-weight:600;letter-spacing:.4px;text-transform:uppercase;">Settings</summary>' +
        '<div style="margin-top:8px;">' +
          '<label style="' + lab + '">Revise server URL (blank = Revise off)</label>' +
          '<input id="cr-set-server" type="text" value="' + esc(st.serverUrl) + '" style="' + inp + '" />' +
          '<label style="' + lab + '">Revise instructions (sent to the server)</label>' +
          '<textarea id="cr-set-instr" rows="3" style="' + inp + 'resize:vertical;">' + esc(st.reviseInstructions) + '</textarea>' +
          '<label style="' + lab + '">Pipeline greeting</label>' +
          '<input id="cr-set-greeting" type="text" value="' + esc(st.greeting) + '" style="' + inp + '" />' +
          '<label style="' + lab + '">Pipeline signature</label>' +
          '<textarea id="cr-set-signature" rows="2" style="' + inp + 'resize:vertical;">' + esc(st.signature) + '</textarea>' +
          '<label style="' + lab + '">Remove CC/follower matching (email, or part of a name; blank = none)</label>' +
          '<input id="cr-set-strip" type="text" value="' + esc(st.stripCcMatch) + '" style="' + inp + '" />' +
          '<div style="display:flex;gap:6px;">' +
            '<button id="cr-set-save" style="flex:1;background:#1f73b7;border:none;color:#fff;border-radius:4px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">Save settings</button>' +
            '<button id="cr-set-reset" style="background:#1a2a3a;border:1px solid #2a3a4a;color:#c8d8e8;border-radius:4px;padding:6px 10px;font-size:11px;font-weight:600;cursor:pointer;">Defaults</button>' +
          '</div>' +
        '</div>' +
      '</details>';
  }

  function wireSettings() {
    const save = document.getElementById('cr-set-save');
    if (!save) return;
    save.onclick = () => {
      saveSettings({
        serverUrl:          document.getElementById('cr-set-server').value.trim(),
        reviseInstructions: document.getElementById('cr-set-instr').value.trim(),
        greeting:           document.getElementById('cr-set-greeting').value.trim(),
        signature:          document.getElementById('cr-set-signature').value,
        stripCcMatch:       document.getElementById('cr-set-strip').value.trim(),
      });
      save.textContent = 'Saved';
      setTimeout(() => { save.textContent = 'Save settings'; }, 1200);
    };
    document.getElementById('cr-set-reset').onclick = () => {
      if (!confirm('Reset all settings to their defaults?')) return;
      saveSettings({});
      renderTabs();
      const d = document.getElementById('cr-settings');
      if (d) d.open = true;
    };
  }

  // PANEL
  function injectPanel() {
    const existing = document.getElementById('cr-float-panel');
    if (existing) existing.remove();

    const savedPos    = JSON.parse(GM_getValue(POS_KEY, 'null'));
    const isCollapsed = GM_getValue(COLLAPSE_KEY, false);

    const panel = document.createElement('div');
    panel.id = 'cr-float-panel';
    panel.style.cssText = 'position:fixed;left:' + (savedPos?savedPos.left:65) + 'px;top:' + (savedPos?savedPos.top:90) + 'px;z-index:99998;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;font-size:12px;color:#c8d8e8;display:flex;flex-direction:row;align-items:flex-start;';

    const tab = document.createElement('div');
    tab.id = 'cr-tab';
    tab.style.cssText = 'background:linear-gradient(180deg,#0d2137,#1a4a7a);border:1px solid #2a4a6a;border-radius:8px 0 0 8px;width:24px;cursor:pointer;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:12px 0;box-shadow:-2px 0 12px rgba(0,0,0,.4);user-select:none;min-height:80px;';
    tab.innerHTML = '<span style="writing-mode:vertical-rl;transform:rotate(180deg);font-size:11px;font-weight:700;color:#fff;letter-spacing:.5px;white-space:nowrap;">Canned</span>';

    const expanded = document.createElement('div');
    expanded.id = 'cr-expanded';
    expanded.style.cssText = 'background:#0f1e2e;border:1px solid #2a3a4a;border-left:none;border-radius:0 8px 8px 0;width:280px;box-shadow:4px 0 24px rgba(0,0,0,.5);display:' + (isCollapsed?'none':'flex') + ';flex-direction:column;';

    expanded.innerHTML = '' +
      '<div id="cr-drag-handle" style="background:linear-gradient(135deg,#0d2137,#1a4a7a);padding:8px 10px;cursor:grab;display:flex;justify-content:space-between;align-items:center;border-radius:0 8px 0 0;border-bottom:1px solid #2a4a6a;user-select:none;flex-shrink:0;">' +
        '<span style="font-weight:700;font-size:12px;color:#fff;letter-spacing:.3px;">Canned Responses</span>' +
      '</div>' +
      '<div style="display:flex;border-bottom:1px solid #1a2a3a;flex-shrink:0;">' +
        '<div id="cr-tab-insert" style="flex:1;text-align:center;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">Insert</div>' +
        '<div id="cr-tab-manage" style="flex:1;text-align:center;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">Manage</div>' +
      '</div>' +
      '<div id="cr-tab-content" style="padding:10px;overflow-y:auto;max-height:70vh;"></div>';

    panel.appendChild(tab);
    panel.appendChild(expanded);
    document.body.appendChild(panel);

    tab.addEventListener('click', () => {
      const nowCollapsed = expanded.style.display === 'none';
      expanded.style.display = nowCollapsed ? 'flex' : 'none';
      GM_setValue(COLLAPSE_KEY, !nowCollapsed);
    });

    const handle = document.getElementById('cr-drag-handle');
    let dragging = false, ox = 0, oy = 0;
    handle.addEventListener('mousedown', (e) => {
      dragging = true; ox = e.clientX - panel.offsetLeft; oy = e.clientY - panel.offsetTop;
      handle.style.cursor = 'grabbing'; e.preventDefault();
    });
    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      panel.style.left = Math.max(0, Math.min(window.innerWidth - panel.offsetWidth, e.clientX - ox)) + 'px';
      panel.style.top  = Math.max(0, Math.min(window.innerHeight - 40, e.clientY - oy)) + 'px';
    });
    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false; handle.style.cursor = 'grab';
      GM_setValue(POS_KEY, JSON.stringify({ left: parseInt(panel.style.left), top: parseInt(panel.style.top) }));
    });

    renderTabs();
  }

  function renderTabs() {
    const tabInsert  = document.getElementById('cr-tab-insert');
    const tabManage  = document.getElementById('cr-tab-manage');
    const content    = document.getElementById('cr-tab-content');
    if (!tabInsert || !tabManage || !content) return;

    const active = state.activeTab;
    tabInsert.style.color        = active === 'insert' ? '#5ba4e5' : '#8a9ab0';
    tabInsert.style.borderBottom = active === 'insert' ? '2px solid #1f73b7' : '2px solid transparent';
    tabManage.style.color        = active === 'manage' ? '#5ba4e5' : '#8a9ab0';
    tabManage.style.borderBottom = active === 'manage' ? '2px solid #1f73b7' : '2px solid transparent';

    tabInsert.onclick = () => { state.activeTab = 'insert'; GM_setValue(TAB_KEY, 'insert'); renderTabs(); };
    tabManage.onclick = () => { state.activeTab = 'manage'; state.editingId = null; GM_setValue(TAB_KEY, 'manage'); renderTabs(); };

    content.innerHTML = active === 'insert' ? buildInsertTab() : buildManageTab();
    wireContent();
  }

  function renderPanel() {
    if (document.getElementById('cr-float-panel')) renderTabs();
    else injectPanel();
  }

  function wireContent() {
    if (state.activeTab === 'insert') {
      const reviseBtn = document.getElementById('cr-revise-btn');
      if (reviseBtn) reviseBtn.onclick = runRevise;
      const revertBtn = document.getElementById('cr-revert-btn');
      if (revertBtn) revertBtn.onclick = runRevert;
      const search = document.getElementById('cr-search');
      if (search) {
        search.addEventListener('input', () => {
          state.search = search.value;
          const list = document.getElementById('cr-list');
          if (list) {
            const tmp = document.createElement('div');
            tmp.innerHTML = buildInsertTab();
            const newList = tmp.querySelector('#cr-list');
            if (newList) list.innerHTML = newList.innerHTML;
            wireSnippetClicks();
          }
        });
      }
      wireSnippetClicks();
      return;
    }

    // Manage tab
    if (state.editingId) {
      const titleEl = document.getElementById('cr-edit-title');
      const tagsEl  = document.getElementById('cr-edit-tags');
      const bodyEl  = document.getElementById('cr-edit-body');

      // Smart-paste: highlight + paste URL -> wrap selection in [text](url)
      bodyEl.addEventListener('paste', (e) => {
        const cd = e.clipboardData || window.clipboardData;
        if (!cd) return;
        const pasted = (cd.getData('text') || '').trim();
        if (!URL_ONLY_RE.test(pasted)) return;
        const start = bodyEl.selectionStart;
        const end   = bodyEl.selectionEnd;
        if (start === end) return; // no selection -- let default paste happen
        e.preventDefault();
        const selectedText = bodyEl.value.slice(start, end);
        const before = bodyEl.value.slice(0, start);
        const after  = bodyEl.value.slice(end);
        const replacement = '[' + selectedText + '](' + pasted + ')';
        bodyEl.value = before + replacement + after;
        const newPos = before.length + replacement.length;
        bodyEl.setSelectionRange(newPos, newPos);
        bodyEl.dispatchEvent(new Event('input', { bubbles: true }));
      });

      document.getElementById('cr-edit-save').onclick = async () => {
        const title = titleEl.value.trim();
        const body  = bodyEl.value;
        if (!title) { alert('Title is required.'); return; }
        if (!body)  { alert('Body is required.');  return; }
        const tags = tagsEl.value.split(',').map(t => t.trim()).filter(Boolean);
        const isNew = state.editingId === 'new';
        const snip = {
          id:        isNew ? uid() : state.editingId,
          title:     title,
          tags:      tags,
          body:      body,
          updatedAt: Date.now(),
        };
        const saveBtn = document.getElementById('cr-edit-save');
        saveBtn.disabled = true; saveBtn.textContent = 'Saving…';
        try {
          await _apiSaveSnippet(snip, isNew);
          state.editingId = null;
          renderTabs();
        } catch(err) {
          alert('Save failed: ' + err.message);
        } finally {
          saveBtn.disabled = false; saveBtn.textContent = 'Save';
        }
      };
      document.getElementById('cr-edit-cancel').onclick = () => {
        state.editingId = null;
        renderTabs();
      };
      const delBtn = document.getElementById('cr-edit-delete');
      if (delBtn) {
        delBtn.onclick = async () => {
          if (!confirm('Delete this snippet?')) return;
          delBtn.disabled = true; delBtn.textContent = 'Deleting…';
          try {
            await _apiDeleteSnippet(state.editingId);
            state.editingId = null;
            renderTabs();
          } catch(err) {
            alert('Delete failed: ' + err.message);
            delBtn.disabled = false; delBtn.textContent = 'Delete';
          }
        };
      }
      return;
    }

    document.getElementById('cr-new-btn').onclick = () => {
      state.editingId = 'new';
      renderTabs();
    };
    document.querySelectorAll('.cr-manage-row').forEach(row => {
      row.addEventListener('click', () => {
        state.editingId = row.dataset.id;
        renderTabs();
      });
    });
    wirePinButtons(document);
    document.getElementById('cr-export-btn').onclick = exportJSON;
    document.getElementById('cr-import-btn').onclick = importJSON;
    wireSettings();
  }

  function wireSnippetClicks() {
    wirePinButtons(document);
    document.querySelectorAll('.cr-snip').forEach(el => {
      el.addEventListener('mouseenter', () => { el.style.background = '#152a40'; });
      el.addEventListener('mouseleave', () => { el.style.background = '#0d1e2e'; });
      el.addEventListener('click', () => {
        const id = el.dataset.id;
        const snip = loadSnippets().find(s => s.id === id);
        if (!snip) return;
        const ok = insertIntoEditor(snip.body);
        if (ok) {
          el.style.background = '#1f73b7';
          setTimeout(() => { el.style.background = '#0d1e2e'; }, 250);
        }
      });
    });
  }

  // CROSS-TAB SYNC
  GM_addValueChangeListener(STORE_KEY, () => {
    if (document.getElementById('cr-float-panel')) renderTabs();
  });

  // PAGE API
  // Exposed on the real page (unsafeWindow) so an outside automation, for example a
  // Playwright or browser-agent pipeline, can call them with page.evaluate(). Every call
  // uses the agent's own Zendesk login on this origin; nothing is sent elsewhere.

  const ticketIdFromUrl = () => location.pathname.match(/\/tickets\/(\d+)/)?.[1];

  // Remove CCs and followers that match the stripCcMatch setting (e.g. your team's shared
  // address, so a reply does not loop back into your own queue). No-op when the setting is blank.
  // GET /email_ccs and /followers return { users: [{ id, name, email }] }; removal is a
  // PUT of { followers / email_ccs: [{ user_id, action: "delete" }] }.
  async function stripMatchingCcs(ticketId, caller) {
    const needle = (loadSettings().stripCcMatch || '').trim().toLowerCase();
    if (!needle || !ticketId) return;
    const hit = u => (u.email || '').toLowerCase() === needle || (u.name || '').toLowerCase().includes(needle);
    try {
      const base = location.origin;
      const [ccRes, folRes] = await Promise.all([
        fetch(`${base}/api/v2/tickets/${ticketId}/email_ccs`).then(r => r.json()),
        fetch(`${base}/api/v2/tickets/${ticketId}/followers`).then(r => r.json()),
      ]);
      const updates = {};
      const ccs = (ccRes.users || []).filter(hit);
      if (ccs.length) updates.email_ccs = ccs.map(u => ({ user_id: u.id, action: 'delete' }));
      const fols = (folRes.users || []).filter(hit);
      if (fols.length) updates.followers = fols.map(u => ({ user_id: u.id, action: 'delete' }));
      if (Object.keys(updates).length) {
        await fetch(`${base}/api/v2/tickets/${ticketId}.json`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ticket: updates }),
        });
      }
    } catch (e) {
      console.warn(caller + ': CC/follower cleanup failed', e);
    }
  }

  // Raw insert at the cursor, same as clicking the snippet in the panel.
  unsafeWindow.insertCannedResponse = function(title) {
    const snip = loadSnippets().find(s => s.title === title);
    if (!snip) return { ok: false, error: 'snippet_not_found', title: title };
    const ok = insertIntoEditor(snip.body);
    return ok ? { ok: true, title: title } : { ok: false, error: 'editor_not_found', title: title };
  };

  // Pipeline insert: normalises the greeting and sign-off to the settings, replaces the whole
  // draft through CKEditor's setData() (no focus or cursor needed), then strips matching CCs.
  unsafeWindow.insertCannedResponsePipeline = async function(title) {
    const snip = loadSnippets().find(s => s.title === title);
    if (!snip) return { ok: false, error: 'snippet_not_found', title: title };
    const settings = loadSettings();
    const greeting  = (settings.greeting || '').trim();
    const signature = (settings.signature || '').replace(/\r\n?/g, '\n').trim();

    let body = snip.body.replace(/\r\n?/g, '\n');
    if (greeting) {
      body = body.replace(
        /^(good\s+(morning|afternoon|evening)[,!]?|hello[,!]?|hi( there)?[,!]?|dear\s+\S+[,!]?|hey[,!]?)\s*/i,
        '');
      body = greeting + '\n\n' + body;
    }
    if (signature) {
      // Drop an existing "Thanks/Regards/Sincerely/Best, <name>" closing, then add ours.
      body = body.replace(/\n+(thanks|regards|sincerely|best)\b[^\n]*\n+\S[^\n]*\s*$/i, '');
      body = body.trimEnd() + '\n\n' + signature;
    }

    const ck = findCkEditor();
    if (!ck) return { ok: false, error: 'editor_not_found' };
    ck.setData(bodyToHtml(body));

    await stripMatchingCcs(ticketIdFromUrl(), 'insertCannedResponsePipeline');
    return { ok: true, title: title };
  };

  // Merge candidate tickets into the current one, but only after the agent confirms a
  // dialog that lists every ticket. A merge closes the source tickets and cannot be undone,
  // so no caller (human or pipeline) gets to do it silently.
  // Merge comments are internal (not public) so the requester is not emailed the merge note
  // itself. Zendesk may still notify on the closed source ticket, depending on your triggers.
  async function confirmAndMerge(targetId, candidates) {
    const ids = candidates.map(t => String(t.id)).filter(id => id !== String(targetId));
    if (!ids.length) return { ok: true, merged: [] };
    const lines = candidates
      .filter(t => String(t.id) !== String(targetId))
      .map(t => '#' + t.id + (t.subject ? '  ' + t.subject : ''));
    const msg = 'Merge ' + ids.length + ' ticket' + (ids.length === 1 ? '' : 's') +
      ' into #' + targetId + '?\n\n' + lines.join('\n') +
      '\n\nThe tickets above will be closed. This cannot be undone.';
    if (!confirm(msg)) return { ok: true, merged: [], cancelled: true };
    try {
      const res = await fetch(`${location.origin}/api/v2/tickets/${targetId}/merge`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ids: ids.map(Number),
          source_comment:           'This ticket has been merged into a related open ticket.',
          target_comment:           'A related open ticket from this user has been merged here.',
          source_comment_is_public: false,
          target_comment_is_public: false,
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        return { ok: false, error: `merge_api_${res.status}`, detail };
      }
    } catch (e) {
      return { ok: false, error: 'merge_failed: ' + e.message };
    }
    return { ok: true, merged: ids };
  }

  // Find the same requester's other open tickets (optionally only those whose subject
  // contains one of the keywords) and merge them into the current ticket, after confirm().
  unsafeWindow.mergeRelatedTickets = async function(requesterEmail, keywords) {
    const ticketId = ticketIdFromUrl();
    if (!ticketId) return { ok: false, error: 'no_ticket_id' };
    if (!requesterEmail) return { ok: true, merged: [], reason: 'no_requester_email' };

    let results = [];
    try {
      const query = `type:ticket status:open requester:${requesterEmail}`;
      const res = await fetch(`${location.origin}/api/v2/search.json?query=${encodeURIComponent(query)}`).then(r => r.json());
      results = res.results || [];
    } catch (e) {
      return { ok: false, error: 'search_failed: ' + e.message };
    }

    const kwLower = (keywords || []).map(k => k.toLowerCase());
    const candidates = results.filter(t => {
      if (String(t.id) === String(ticketId)) return false;
      if (!kwLower.length) return true;
      const subject = (t.subject || '').toLowerCase();
      return kwLower.some(k => subject.includes(k));
    });
    return confirmAndMerge(ticketId, candidates);
  };

  // Merge a list of ticket IDs the caller already picked, after confirm(). Subjects are
  // fetched so the dialog shows what is about to be closed, not just numbers.
  unsafeWindow.mergeDuplicates = async function(ticketIds) {
    const ticketId = ticketIdFromUrl();
    if (!ticketId) return { ok: false, error: 'no_ticket_id' };
    const ids = (ticketIds || []).map(String).filter(id => id !== String(ticketId));
    if (!ids.length) return { ok: true, merged: [] };
    let candidates = ids.map(id => ({ id: id, subject: '' }));
    try {
      const res = await fetch(`${location.origin}/api/v2/tickets/show_many.json?ids=${ids.join(',')}`).then(r => r.json());
      const byId = new Map((res.tickets || []).map(t => [String(t.id), t.subject || '']));
      candidates = ids.map(id => ({ id: id, subject: byId.get(id) || '' }));
    } catch (_) { /* fall back to IDs only in the dialog */ }
    return confirmAndMerge(ticketId, candidates);
  };

  // INIT
  function init() {
    _seedIfEmpty();
    injectPanel();
  }

  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      setTimeout(() => {
        if (!document.getElementById('cr-float-panel')) injectPanel();
      }, 1500);
    } else if (!document.getElementById('cr-float-panel')) {
      injectPanel();
    }
  }, 1500);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

})();
