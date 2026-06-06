// ==UserScript==
// @name         Mansion Name Autocomplete
// @namespace    local.mansion-autocomplete
// @version      1.1.0
// @description  Add a custom autocomplete picker with site-specific usage history.
// @match        http://*/*
// @match        https://*/*
// @all-frames   true
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  const PHRASES_KEY = 'mansionAutocomplete.phrases.v2';
  const HISTORY_KEY = 'mansionAutocomplete.history.v1';
  const INPUT_MODE_KEY = 'mansionAutocomplete.inputMode.v1';
  const SUPPRESS_NATIVE_KEY = 'mansionAutocomplete.suppressNative.v1';
  const DISABLED_SITES_KEY = 'mansionAutocomplete.disabledSites.v1';
  const MAX_RESULTS = 12;
  const MAX_HISTORY_PER_SITE = 200;
  const MIN_RECORD_LENGTH = 2;
  const RECORD_DEDUPE_MS = 900;
  const ACTION_BUTTON_PATTERN = /検索|決定|確定|送信|登録|保存|次へ|反映|search|submit|ok/i;

  const DEFAULT_PHRASES = [];

  const siteKey = location.hostname || location.host || 'unknown-site';
  let phrases = loadPhrases();
  let history = loadHistory();
  let activeInput = null;
  let selectedIndex = 0;
  let matches = [];
  let isComposingText = false;
  let inputMode = loadInputMode();
  let suppressNativeAutocomplete = loadSuppressNativeAutocomplete();
  let disabledSites = loadDisabledSites();
  const recentRecords = new Map();
  const entryAttributeRestores = new WeakMap();
  let lastPopupCommit = { value: '', at: 0 };
  let lastCopyCommit = { value: '', at: 0 };
  let copiedMessage = '';

  const uiHost = document.createElement('div');
  uiHost.id = 'mansion-autocomplete-ui-host';
  const uiRoot = uiHost.attachShadow({ mode: 'open' });

  const managerButton = document.createElement('button');
  managerButton.id = 'mansion-autocomplete-manager-button';
  managerButton.type = 'button';
  managerButton.textContent = '設定';
  managerButton.title = 'マンション名候補の設定';

  const manager = document.createElement('div');
  manager.id = 'mansion-autocomplete-manager';
  manager.hidden = true;

  const popup = document.createElement('div');
  popup.id = 'mansion-autocomplete-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'listbox');

  const style = document.createElement('style');
  style.textContent = `
    :host {
      all: initial;
      color-scheme: light;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    button,
    input,
    textarea {
      font: inherit;
    }
    #mansion-autocomplete-popup {
      position: fixed;
      z-index: 2147483647;
      min-width: 240px;
      max-width: min(560px, calc(100vw - 24px));
      max-height: 280px;
      overflow-y: auto;
      box-sizing: border-box;
      padding: 4px;
      border: 1px solid #a8b1c1;
      border-radius: 6px;
      background: #fff;
      color: #111827;
      box-shadow: 0 10px 28px rgba(15, 23, 42, 0.22);
      font-size: 14px;
      line-height: 1.35;
    }
    #mansion-autocomplete-popup .mac-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto;
      gap: 8px;
      align-items: center;
      padding: 7px 9px;
      border-radius: 4px;
      cursor: pointer;
    }
    #mansion-autocomplete-popup .mac-name {
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    #mansion-autocomplete-popup .mac-meta {
      color: #6b7280;
      font-size: 12px;
      white-space: nowrap;
    }
    #mansion-autocomplete-popup .mac-copy,
    #mansion-autocomplete-popup .mac-delete {
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border: 0;
      border-radius: 4px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      font-size: 15px;
      line-height: 1;
    }
    #mansion-autocomplete-popup .mac-copy:hover {
      background: #dbeafe;
      color: #1d4ed8;
    }
    #mansion-autocomplete-popup .mac-delete:hover {
      background: #fee2e2;
      color: #b91c1c;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] {
      background: #1d4ed8;
      color: #fff;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-meta {
      color: #dbeafe;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-copy,
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-delete {
      color: #dbeafe;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-copy:hover {
      background: #dbeafe;
      color: #1d4ed8;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-delete:hover {
      background: #fee2e2;
      color: #b91c1c;
    }
    #mansion-autocomplete-popup .mac-help {
      padding: 5px 9px 3px;
      color: #6b7280;
      font-size: 12px;
      border-top: 1px solid #e5e7eb;
      margin-top: 3px;
    }
    #mansion-autocomplete-popup .mac-toast {
      padding: 5px 9px;
      color: #166534;
      font-size: 12px;
      background: #dcfce7;
      border-radius: 4px;
      margin: 3px 0;
    }
    #mansion-autocomplete-manager-button {
      position: fixed;
      right: 14px;
      bottom: 14px;
      z-index: 2147483646;
      border: 1px solid #1d4ed8;
      border-radius: 999px;
      padding: 9px 13px;
      background: #1d4ed8;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      line-height: 1;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
      cursor: pointer;
    }
    #mansion-autocomplete-manager {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      box-sizing: border-box;
      padding: 18px;
      background: rgba(15, 23, 42, 0.35);
      color: #111827;
    }
    #mansion-autocomplete-manager .mac-manager-panel {
      width: min(760px, 100%);
      max-height: min(720px, calc(100vh - 36px));
      margin: 0 auto;
      overflow: auto;
      box-sizing: border-box;
      border: 1px solid #cbd5e1;
      border-radius: 8px;
      background: #fff;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.28);
    }
    #mansion-autocomplete-manager .mac-manager-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px 18px;
      border-bottom: 1px solid #e5e7eb;
    }
    #mansion-autocomplete-manager h2,
    #mansion-autocomplete-manager h3 {
      margin: 0;
      line-height: 1.25;
    }
    #mansion-autocomplete-manager h2 {
      font-size: 18px;
    }
    #mansion-autocomplete-manager h3 {
      font-size: 15px;
      margin-bottom: 10px;
    }
    #mansion-autocomplete-manager .mac-manager-body {
      display: grid;
      gap: 18px;
      padding: 18px;
    }
    #mansion-autocomplete-manager .mac-mode {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 12px;
      border: 1px solid #dbe3ef;
      border-radius: 6px;
      background: #f8fafc;
    }
    #mansion-autocomplete-manager .mac-mode-text {
      min-width: 0;
      font-size: 13px;
      color: #334155;
    }
    #mansion-autocomplete-manager .mac-manager-row {
      display: flex;
      gap: 8px;
    }
    #mansion-autocomplete-manager input {
      min-width: 0;
      flex: 1;
      box-sizing: border-box;
      border: 1px solid #aeb8c7;
      border-radius: 6px;
      padding: 9px 10px;
      font: inherit;
    }
    #mansion-autocomplete-manager button {
      border: 1px solid #cbd5e1;
      border-radius: 6px;
      padding: 8px 11px;
      background: #fff;
      color: #111827;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
    }
    #mansion-autocomplete-manager .mac-primary {
      border-color: #1d4ed8;
      background: #1d4ed8;
      color: #fff;
    }
    #mansion-autocomplete-manager .mac-danger {
      border-color: #fecaca;
      color: #b91c1c;
    }
    #mansion-autocomplete-manager .mac-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    #mansion-autocomplete-manager .mac-list-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #f8fafc;
    }
    #mansion-autocomplete-manager .mac-list-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    #mansion-autocomplete-manager .mac-list-meta,
    #mansion-autocomplete-manager .mac-empty {
      color: #64748b;
      font-size: 12px;
    }
    @media (max-width: 560px) {
      #mansion-autocomplete-manager {
        padding: 8px;
      }
      #mansion-autocomplete-manager .mac-manager-panel {
        max-height: calc(100vh - 16px);
      }
      #mansion-autocomplete-manager .mac-manager-row {
        display: grid;
      }
      #mansion-autocomplete-manager .mac-list-item {
        grid-template-columns: minmax(0, 1fr) auto;
      }
      #mansion-autocomplete-manager .mac-list-meta {
        grid-column: 1 / -1;
        grid-row: 2;
      }
    }
  `;

  uiRoot.appendChild(style);
  uiRoot.appendChild(managerButton);
  uiRoot.appendChild(manager);
  uiRoot.appendChild(popup);
  document.documentElement.appendChild(uiHost);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('設定画面を開く', openManager);
    GM_registerMenuCommand('このサイトで有効/無効を切り替え', toggleSiteEnabled);
    GM_registerMenuCommand('入力モードを切り替え', toggleInputMode);
    GM_registerMenuCommand('Chrome候補抑制を切り替え', toggleSuppressNativeAutocomplete);
    GM_registerMenuCommand('候補リストを編集', editPhrases);
    GM_registerMenuCommand('候補リストを初期化', resetPhrases);
    GM_registerMenuCommand('このサイトの入力履歴を削除', clearSiteHistory);
    GM_registerMenuCommand('すべての入力履歴を削除', clearAllHistory);
  }

  managerButton.addEventListener('click', openManager);

  document.addEventListener('focusin', (event) => {
    if (isSiteDisabled()) return;
    if (isTextEntry(event.target)) {
      activeInput = event.target;
      applyNativeAutocompleteSuppression(activeInput);
      updatePopup();
    }
  });

  document.addEventListener('blur', (event) => {
    if (event.target === activeInput) {
      restoreEntryAttributes(event.target);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput) {
      if (isComposingText || event.isComposing) return;
      updatePopup();
    }
  });

  document.addEventListener('compositionstart', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput) {
      isComposingText = true;
      hidePopup();
    }
  });

  document.addEventListener('compositionend', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput) {
      isComposingText = false;
      updatePopup();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (isSiteDisabled()) return;
    if (event.isComposing || isComposingText || !activeInput || popup.hidden) return;

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, matches.length - 1);
      renderPopup();
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      renderPopup();
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      if (matches[selectedIndex]) {
        event.preventDefault();
        commit(matches[selectedIndex].value);
      }
    } else if (event.key === 'Escape') {
      hidePopup();
    }
  }, true);

  document.addEventListener('mousedown', (event) => {
    if (isOwnUiEvent(event)) return;
    if (isSiteDisabled()) return;
    if (event.target !== activeInput) {
      hidePopup();
    }
  }, true);

  document.addEventListener('submit', (event) => {
    if (isOwnUiEvent(event)) return;
    if (isSiteDisabled()) return;
    recordEntriesForAction(event.target);
  }, true);

  document.addEventListener('click', (event) => {
    if (isOwnUiEvent(event)) return;
    if (isSiteDisabled()) return;

    const action = event.target.closest && event.target.closest(
      'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]'
    );

    if (!action) return;
    if (!isActionButton(action)) return;

    recordEntriesForAction(action);
  }, true);

  window.addEventListener('resize', positionPopup);
  window.addEventListener('scroll', positionPopup, true);

  function loadPhrases() {
    const saved = readValue(PHRASES_KEY, null);
    if (Array.isArray(saved) && saved.every((item) => typeof item === 'string')) {
      return uniqueNonEmpty(saved);
    }
    return DEFAULT_PHRASES.slice();
  }

  function savePhrases(nextPhrases) {
    phrases = uniqueNonEmpty(nextPhrases);
    writeValue(PHRASES_KEY, phrases);
  }

  function loadHistory() {
    const saved = readValue(HISTORY_KEY, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }

  function loadInputMode() {
    const saved = readValue(INPUT_MODE_KEY, 'setter');
    return saved === 'typing' ? 'typing' : 'setter';
  }

  function loadSuppressNativeAutocomplete() {
    return readValue(SUPPRESS_NATIVE_KEY, true) !== false;
  }

  function loadDisabledSites() {
    const saved = readValue(DISABLED_SITES_KEY, []);
    return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
  }

  function saveDisabledSites() {
    writeValue(DISABLED_SITES_KEY, [...new Set(disabledSites)]);
  }

  function isSiteDisabled() {
    return disabledSites.includes(siteKey);
  }

  function saveHistory() {
    writeValue(HISTORY_KEY, history);
  }

  function readValue(key, fallback) {
    try {
      if (typeof GM_getValue === 'function') return GM_getValue(key, fallback);
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (_) {
      return fallback;
    }
  }

  function writeValue(key, value) {
    try {
      if (typeof GM_setValue === 'function') {
        GM_setValue(key, value);
      } else {
        localStorage.setItem(key, JSON.stringify(value));
      }
    } catch (_) {
      // Storage can be blocked on some sites. The picker still works without persistence.
    }
  }

  function deleteValue(key) {
    try {
      if (typeof GM_deleteValue === 'function') {
        GM_deleteValue(key);
      } else {
        localStorage.removeItem(key);
      }
    } catch (_) {
      // Ignore storage cleanup failures.
    }
  }

  function editPhrases() {
    const nextText = window.prompt(
      '候補を1行に1つずつ入力してください。',
      phrases.join('\n')
    );
    if (nextText === null) return;
    savePhrases(nextText.split(/\r?\n/));
    updatePopup();
  }

  function resetPhrases() {
    if (!window.confirm('候補リストを初期状態に戻しますか？')) return;
    deleteValue(PHRASES_KEY);
    phrases = DEFAULT_PHRASES.slice();
    updatePopup();
  }

  function clearSiteHistory() {
    if (!window.confirm(`${siteKey} の入力履歴を削除しますか？`)) return;
    delete history[siteKey];
    saveHistory();
    updatePopup();
  }

  function clearAllHistory() {
    if (!window.confirm('すべてのサイトの入力履歴を削除しますか？')) return;
    history = {};
    deleteValue(HISTORY_KEY);
    updatePopup();
  }

  function toggleInputMode() {
    inputMode = inputMode === 'setter' ? 'typing' : 'setter';
    writeValue(INPUT_MODE_KEY, inputMode);
    window.alert(`入力モードを「${inputModeLabel()}」にしました。`);
  }

  function toggleSiteEnabled() {
    setSiteDisabled(!isSiteDisabled());
    window.alert(`${siteKey} での機能を「${isSiteDisabled() ? '無効' : '有効'}」にしました。`);
  }

  function setSiteDisabled(disabled) {
    if (disabled) {
      disabledSites = [...new Set(disabledSites.concat(siteKey))];
      hidePopup();
      if (activeInput) restoreEntryAttributes(activeInput);
    } else {
      disabledSites = disabledSites.filter((item) => item !== siteKey);
      if (activeInput && isTextEntry(activeInput)) {
        applyNativeAutocompleteSuppression(activeInput);
      }
    }
    saveDisabledSites();
  }

  function toggleSuppressNativeAutocomplete() {
    suppressNativeAutocomplete = !suppressNativeAutocomplete;
    writeValue(SUPPRESS_NATIVE_KEY, suppressNativeAutocomplete);
    window.alert(`Chrome候補抑制を「${suppressNativeAutocomplete ? '有効' : '無効'}」にしました。`);
  }

  function inputModeLabel() {
    return inputMode === 'typing' ? 'キーボード入力風' : '標準';
  }

  function uniqueNonEmpty(items) {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  }

  function isTextEntry(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (uiHost.contains(element) || manager.contains(element)) return false;
    if (element instanceof HTMLTextAreaElement) return true;
    if (element instanceof HTMLElement && element.isContentEditable) return true;
    if (!(element instanceof HTMLInputElement)) return false;
    return [
      'text',
      'search',
      'tel',
      'url',
      'email',
      '',
    ].includes(element.type);
  }

  function updatePopup() {
    if (!activeInput || !isTextEntry(activeInput)) {
      hidePopup();
      return;
    }

    matches = buildMatches(getEntryValue(activeInput));
    selectedIndex = 0;

    if (!matches.length) {
      hidePopup();
      return;
    }

    renderPopup();
    popup.hidden = false;
    positionPopup();
  }

  function buildMatches(rawQuery) {
    const query = normalize(rawQuery);
    const siteHistory = history[siteKey] || {};
    const seen = new Set();

    const historyMatches = Object.entries(siteHistory)
      .filter(([value]) => matchesQuery(value, query))
      .map(([value, stat]) => ({
        value,
        source: '履歴',
        count: Number(stat.count) || 0,
        lastUsed: Number(stat.lastUsed) || 0,
        rank: rankValue(value, query),
      }))
      .sort(compareHistory);

    const phraseMatches = phrases
      .filter((value) => matchesQuery(value, query))
      .map((value) => ({
        value,
        source: '候補',
        count: 0,
        lastUsed: 0,
        rank: rankValue(value, query),
      }))
      .sort(comparePhrase);

    return historyMatches
      .concat(phraseMatches)
      .filter((item) => {
        const key = normalize(item.value);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, MAX_RESULTS);
  }

  function matchesQuery(value, query) {
    if (!query) return true;
    return normalize(value).includes(query);
  }

  function rankValue(value, query) {
    if (!query) return 0;
    const normalized = normalize(value);
    if (normalized === query) return 0;
    if (normalized.startsWith(query)) return 1;
    return 2;
  }

  function compareHistory(a, b) {
    return (
      a.rank - b.rank ||
      b.count - a.count ||
      b.lastUsed - a.lastUsed ||
      a.value.localeCompare(b.value, 'ja')
    );
  }

  function comparePhrase(a, b) {
    return (
      a.rank - b.rank ||
      a.value.localeCompare(b.value, 'ja')
    );
  }

  function normalize(value) {
    return String(value || '').trim().normalize('NFKC').toLowerCase();
  }

  function isOwnUiEvent(event) {
    const path = typeof event.composedPath === 'function' ? event.composedPath() : [];
    return path.includes(uiHost) || path.includes(manager) || path.includes(popup) || path.includes(managerButton);
  }

  function applyNativeAutocompleteSuppression(element) {
    if (!suppressNativeAutocomplete || !element || entryAttributeRestores.has(element)) return;
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;

    const attrs = ['autocomplete', 'autocorrect', 'autocapitalize', 'spellcheck', 'aria-autocomplete'];
    const restore = {};
    attrs.forEach((attr) => {
      restore[attr] = element.hasAttribute(attr) ? element.getAttribute(attr) : null;
    });
    entryAttributeRestores.set(element, restore);

    element.setAttribute('autocomplete', 'off');
    element.setAttribute('autocorrect', 'off');
    element.setAttribute('autocapitalize', 'off');
    element.setAttribute('spellcheck', 'false');
    element.setAttribute('aria-autocomplete', 'none');
  }

  function restoreEntryAttributes(element) {
    const restore = entryAttributeRestores.get(element);
    if (!restore) return;

    Object.entries(restore).forEach(([attr, value]) => {
      if (value === null) {
        element.removeAttribute(attr);
      } else {
        element.setAttribute(attr, value);
      }
    });
    entryAttributeRestores.delete(element);
  }

  function renderPopup() {
    popup.textContent = '';

    matches.forEach((match, index) => {
      const item = document.createElement('div');
      item.className = 'mac-item';
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(index === selectedIndex));

      const name = document.createElement('div');
      name.className = 'mac-name';
      name.textContent = match.value;

      const meta = document.createElement('div');
      meta.className = 'mac-meta';
      meta.textContent = match.source === '履歴' ? `履歴 ${match.count}回` : '候補';

      const copyButton = document.createElement('button');
      copyButton.className = 'mac-copy';
      copyButton.type = 'button';
      copyButton.title = `${match.value} をコピー`;
      copyButton.setAttribute('aria-label', `${match.value} を入力してコピー`);
      copyButton.textContent = '⧉';
      const copyAndInputFromPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        commitAndCopy(match.value);
      };
      copyButton.addEventListener('pointerdown', copyAndInputFromPopup);
      copyButton.addEventListener('mousedown', copyAndInputFromPopup);
      copyButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      const deleteButton = document.createElement('button');
      deleteButton.className = 'mac-delete';
      deleteButton.type = 'button';
      deleteButton.title = `${match.value} を削除`;
      deleteButton.setAttribute('aria-label', `${match.value} を削除`);
      deleteButton.textContent = '🗑';
      const deleteFromPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        deleteMatch(match);
      };
      deleteButton.addEventListener('pointerdown', deleteFromPopup);
      deleteButton.addEventListener('mousedown', deleteFromPopup);
      deleteButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      item.appendChild(name);
      item.appendChild(copyButton);
      item.appendChild(meta);
      item.appendChild(deleteButton);
      item.addEventListener('mouseenter', () => {
        selectedIndex = index;
        renderPopup();
      });
      item.addEventListener('pointerdown', (event) => commitFromPopup(event, match.value));
      item.addEventListener('mousedown', (event) => commitFromPopup(event, match.value));
      item.addEventListener('click', (event) => commitFromPopup(event, match.value));
      popup.appendChild(item);
    });

    if (copiedMessage) {
      const toast = document.createElement('div');
      toast.className = 'mac-toast';
      toast.textContent = copiedMessage;
      popup.appendChild(toast);
    }

    const help = document.createElement('div');
    help.className = 'mac-help';
    help.textContent = '↑↓で選択 / Enter・Tab・クリックで入力 / ⧉で入力+コピー';
    popup.appendChild(help);
  }

  function deleteMatch(match) {
    if (match.source === '履歴') {
      deleteHistoryValue(match.value);
    } else {
      savePhrases(phrases.filter((phrase) => normalize(phrase) !== normalize(match.value)));
    }

    updatePopup();
  }

  function deleteHistoryValue(value) {
    const siteHistory = history[siteKey] || {};
    const key = Object.keys(siteHistory).find((item) => normalize(item) === normalize(value));
    if (!key) return;

    delete siteHistory[key];
    if (Object.keys(siteHistory).length) {
      history[siteKey] = siteHistory;
    } else {
      delete history[siteKey];
    }
    saveHistory();
  }

  async function copyValue(value) {
    copiedMessage = 'コピー中...';
    renderPopup();

    const ok = await writeClipboard(value);
    copiedMessage = ok ? 'コピーしました' : 'コピーできませんでした';
    renderPopup();

    window.setTimeout(() => {
      if (!copiedMessage) return;
      copiedMessage = '';
      if (!popup.hidden) renderPopup();
    }, 1200);
  }

  async function writeClipboard(value) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(value);
        return true;
      }
    } catch (_) {
      // Fall back below.
    }

    return copyWithTextarea(value);
  }

  function copyWithTextarea(value) {
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    textarea.style.top = '0';
    document.documentElement.appendChild(textarea);

    try {
      textarea.select();
      return document.execCommand && document.execCommand('copy');
    } catch (_) {
      return false;
    } finally {
      textarea.remove();
      if (activeInput) activeInput.focus();
    }
  }

  function openManager() {
    hidePopup();
    renderManager();
    manager.hidden = false;
  }

  function closeManager() {
    manager.hidden = true;
  }

  function renderManager() {
    const siteHistory = history[siteKey] || {};
    const sortedHistory = Object.entries(siteHistory).sort(([, a], [, b]) => {
      return (Number(b.count) || 0) - (Number(a.count) || 0) ||
        (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0);
    });

    manager.textContent = '';

    const panel = document.createElement('div');
    panel.className = 'mac-manager-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());

    const head = document.createElement('div');
    head.className = 'mac-manager-head';

    const title = document.createElement('h2');
    title.textContent = 'マンション名候補';

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', closeManager);

    head.appendChild(title);
    head.appendChild(closeButton);

    const body = document.createElement('div');
    body.className = 'mac-manager-body';

    body.appendChild(createSiteEnabledSection());
    body.appendChild(createModeSection());
    body.appendChild(createSuppressSection());
    body.appendChild(createAddSection());
    body.appendChild(createPhraseSection());
    body.appendChild(createHistorySection(sortedHistory));

    panel.appendChild(head);
    panel.appendChild(body);
    manager.appendChild(panel);

    manager.addEventListener('mousedown', closeManager, { once: true });
  }

  function createSiteEnabledSection() {
    const section = document.createElement('section');
    const box = document.createElement('div');
    box.className = 'mac-mode';

    const text = document.createElement('div');
    text.className = 'mac-mode-text';
    text.textContent = `このサイト: ${isSiteDisabled() ? '無効' : '有効'} (${siteKey})`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = isSiteDisabled() ? 'mac-primary' : 'mac-danger';
    button.textContent = isSiteDisabled() ? '有効にする' : '無効にする';
    button.addEventListener('click', () => {
      setSiteDisabled(!isSiteDisabled());
      renderManager();
    });

    box.appendChild(text);
    box.appendChild(button);
    section.appendChild(box);
    return section;
  }

  function createModeSection() {
    const section = document.createElement('section');
    const box = document.createElement('div');
    box.className = 'mac-mode';

    const text = document.createElement('div');
    text.className = 'mac-mode-text';
    text.textContent = `入力モード: ${inputModeLabel()}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '切り替え';
    button.addEventListener('click', () => {
      inputMode = inputMode === 'setter' ? 'typing' : 'setter';
      writeValue(INPUT_MODE_KEY, inputMode);
      renderManager();
    });

    box.appendChild(text);
    box.appendChild(button);
    section.appendChild(box);
    return section;
  }

  function createSuppressSection() {
    const section = document.createElement('section');
    const box = document.createElement('div');
    box.className = 'mac-mode';

    const text = document.createElement('div');
    text.className = 'mac-mode-text';
    text.textContent = `Chrome候補抑制: ${suppressNativeAutocomplete ? '有効' : '無効'}`;

    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = '切り替え';
    button.addEventListener('click', () => {
      suppressNativeAutocomplete = !suppressNativeAutocomplete;
      writeValue(SUPPRESS_NATIVE_KEY, suppressNativeAutocomplete);
      if (activeInput) {
        if (suppressNativeAutocomplete) {
          applyNativeAutocompleteSuppression(activeInput);
        } else {
          restoreEntryAttributes(activeInput);
        }
      }
      renderManager();
    });

    box.appendChild(text);
    box.appendChild(button);
    section.appendChild(box);
    return section;
  }

  function createAddSection() {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = '候補を追加';

    const row = document.createElement('div');
    row.className = 'mac-manager-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '例: パークハウス松濤';
    input.setAttribute('aria-label', '追加する候補');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mac-primary';
    button.textContent = '追加';

    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      savePhrases(phrases.concat(value));
      renderManager();
    };

    button.addEventListener('click', add);
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') add();
    });

    row.appendChild(input);
    row.appendChild(button);
    section.appendChild(heading);
    section.appendChild(row);
    return section;
  }

  function createPhraseSection() {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = '手動候補';

    const list = document.createElement('div');
    list.className = 'mac-list';

    if (!phrases.length) {
      list.appendChild(emptyLine('手動候補はまだありません。'));
    } else {
      phrases.forEach((phrase) => {
        list.appendChild(createManagerItem(phrase, '候補', () => {
          savePhrases(phrases.filter((item) => normalize(item) !== normalize(phrase)));
          renderManager();
        }));
      });
    }

    section.appendChild(heading);
    section.appendChild(list);
    return section;
  }

  function createHistorySection(sortedHistory) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = `このサイトの履歴: ${siteKey}`;

    const actions = document.createElement('div');
    actions.className = 'mac-manager-row';

    const clearSiteButton = document.createElement('button');
    clearSiteButton.type = 'button';
    clearSiteButton.className = 'mac-danger';
    clearSiteButton.textContent = 'このサイトの履歴を削除';
    clearSiteButton.addEventListener('click', clearSiteHistoryFromManager);

    const clearAllButton = document.createElement('button');
    clearAllButton.type = 'button';
    clearAllButton.className = 'mac-danger';
    clearAllButton.textContent = '全履歴を削除';
    clearAllButton.addEventListener('click', clearAllHistoryFromManager);

    actions.appendChild(clearSiteButton);
    actions.appendChild(clearAllButton);

    const list = document.createElement('div');
    list.className = 'mac-list';

    if (!sortedHistory.length) {
      list.appendChild(emptyLine('このサイトの履歴はまだありません。'));
    } else {
      sortedHistory.forEach(([value, stat]) => {
        const count = Number(stat.count) || 0;
        list.appendChild(createManagerItem(value, `履歴 ${count}回`, () => {
          deleteHistoryValue(value);
          renderManager();
        }));
      });
    }

    section.appendChild(heading);
    section.appendChild(actions);
    section.appendChild(list);
    return section;
  }

  function createManagerItem(value, metaText, onDelete) {
    const item = document.createElement('div');
    item.className = 'mac-list-item';

    const name = document.createElement('div');
    name.className = 'mac-list-name';
    name.textContent = value;

    const meta = document.createElement('div');
    meta.className = 'mac-list-meta';
    meta.textContent = metaText;

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mac-danger';
    deleteButton.textContent = 'ゴミ箱';
    deleteButton.addEventListener('click', onDelete);

    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(deleteButton);
    return item;
  }

  function emptyLine(text) {
    const empty = document.createElement('div');
    empty.className = 'mac-empty';
    empty.textContent = text;
    return empty;
  }

  function clearSiteHistoryFromManager() {
    delete history[siteKey];
    saveHistory();
    renderManager();
  }

  function clearAllHistoryFromManager() {
    history = {};
    deleteValue(HISTORY_KEY);
    renderManager();
  }

  function positionPopup() {
    if (!activeInput || popup.hidden) return;

    const rect = activeInput.getBoundingClientRect();
    const viewportGap = 8;
    const belowTop = rect.bottom + 4;
    const width = Math.max(rect.width, 240);

    popup.style.width = `${Math.min(width, window.innerWidth - viewportGap * 2)}px`;
    popup.style.left = `${Math.min(
      Math.max(rect.left, viewportGap),
      window.innerWidth - popup.offsetWidth - viewportGap
    )}px`;

    const popupHeight = popup.offsetHeight || 240;
    const aboveTop = rect.top - popupHeight - 4;
    const fitsBelow = belowTop + popupHeight < window.innerHeight - viewportGap;
    popup.style.top = fitsBelow
      ? `${belowTop}px`
      : `${Math.max(viewportGap, aboveTop)}px`;
  }

  function commit(value) {
    if (!activeInput) return;

    setEntryValue(activeInput, value, inputMode);
    hidePopup();
  }

  async function commitAndCopy(value) {
    const now = Date.now();
    if (lastCopyCommit.value === value && now - lastCopyCommit.at < 250) return;
    lastCopyCommit = { value, at: now };

    if (activeInput) {
      setEntryValue(activeInput, value, inputMode);
    }

    await copyValue(value);
  }

  function commitFromPopup(event, value) {
    if (event.target.closest && event.target.closest('.mac-delete, .mac-copy')) return;

    event.preventDefault();
    event.stopPropagation();

    const now = Date.now();
    if (lastPopupCommit.value === value && now - lastPopupCommit.at < 250) return;

    lastPopupCommit = { value, at: now };
    commit(value);
  }

  function getEntryValue(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value;
    }
    if (element instanceof HTMLElement && element.isContentEditable) {
      return element.textContent || '';
    }
    return '';
  }

  function setEntryValue(element, value, mode) {
    applyNativeAutocompleteSuppression(element);
    element.focus();

    if (mode === 'typing') {
      if (replaceByTyping(element, value)) return;
    }

    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const valueSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;

      if (valueSetter) {
        valueSetter.call(element, value);
      } else {
        element.value = value;
      }

      // React/Vue/Angular style controlled fields usually listen for InputEvent.
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertReplacementText',
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }

    if (element instanceof HTMLElement && element.isContentEditable) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent('input', {
        bubbles: true,
        cancelable: true,
        data: value,
        inputType: 'insertReplacementText',
      }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    }
  }

  function replaceByTyping(element, value) {
    try {
      if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
        element.select();
        if (document.execCommand && document.execCommand('insertText', false, value)) {
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }

        setSelectionRange(element, 0, element.value.length);
        if (document.execCommand && document.execCommand('delete', false)) {
          document.execCommand('insertText', false, value);
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
        return false;
      }

      if (element instanceof HTMLElement && element.isContentEditable) {
        selectContentEditable(element);
        if (document.execCommand && document.execCommand('insertText', false, value)) {
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return true;
        }
      }
    } catch (_) {
      return false;
    }

    return false;
  }

  function setSelectionRange(element, start, end) {
    if (typeof element.setSelectionRange === 'function') {
      element.setSelectionRange(start, end);
    }
  }

  function selectContentEditable(element) {
    const range = document.createRange();
    range.selectNodeContents(element);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
  }

  function recordValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (value.length < MIN_RECORD_LENGTH) return;

    const normalized = normalize(value);
    const siteHistory = history[siteKey] || {};
    const existingKey = Object.keys(siteHistory).find((key) => normalize(key) === normalized);
    const key = existingKey || value;
    const current = siteHistory[key] || { count: 0, lastUsed: 0 };

    siteHistory[key] = {
      count: (Number(current.count) || 0) + 1,
      lastUsed: Date.now(),
    };

    history[siteKey] = trimHistory(siteHistory);
    saveHistory();
  }

  function recordEntriesForAction(trigger) {
    const entries = findActionTextEntries(trigger);
    entries.forEach((entry) => recordValueOnce(getEntryValue(entry)));
  }

  function findActionTextEntries(trigger) {
    const result = [];
    const add = (entry) => {
      if (!entry || !isTextEntry(entry) || result.includes(entry)) return;
      if (normalize(getEntryValue(entry)).length < MIN_RECORD_LENGTH) return;
      result.push(entry);
    };

    const form = trigger.closest && trigger.closest('form');
    if (form) {
      form.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(add);
      return result;
    }

    if (activeInput && isLikelyRelatedToAction(activeInput, trigger)) {
      add(activeInput);
      return result;
    }

    const searchRegion = trigger.closest && trigger.closest('[role="search"], [data-testid*="search"], [class*="search"], [class*="Search"]');
    if (searchRegion) {
      searchRegion.querySelectorAll('input, textarea, [contenteditable="true"]').forEach(add);
    }

    return result;
  }

  function isLikelyRelatedToAction(entry, action) {
    if (!entry || !action || !document.documentElement.contains(entry)) return false;
    if (entry.form && action.form && entry.form === action.form) return true;

    const entryRect = entry.getBoundingClientRect();
    const actionRect = action.getBoundingClientRect();
    if (!entryRect.width && !entryRect.height) return false;
    if (!actionRect.width && !actionRect.height) return false;

    const verticalDistance = Math.abs(
      (entryRect.top + entryRect.bottom) / 2 - (actionRect.top + actionRect.bottom) / 2
    );
    const horizontalGap = Math.max(0, actionRect.left - entryRect.right, entryRect.left - actionRect.right);

    return verticalDistance <= 90 && horizontalGap <= 420;
  }

  function isActionButton(element) {
    const text = [
      element.textContent,
      element.getAttribute('aria-label'),
      element.getAttribute('title'),
      element.getAttribute('value'),
      element.getAttribute('name'),
      element.id,
    ].filter(Boolean).join(' ');

    const type = element.getAttribute('type');
    return type === 'submit' || ACTION_BUTTON_PATTERN.test(text);
  }

  function recordValueOnce(rawValue) {
    const value = String(rawValue || '').trim();
    const key = normalize(value);
    if (!key) return;

    const now = Date.now();
    const recentAt = recentRecords.get(key) || 0;
    if (now - recentAt < RECORD_DEDUPE_MS) return;

    recentRecords.set(key, now);
    recordValue(value);
  }

  function trimHistory(siteHistory) {
    return Object.fromEntries(
      Object.entries(siteHistory)
        .sort(([, a], [, b]) => {
          return (Number(b.count) || 0) - (Number(a.count) || 0) ||
            (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0);
        })
        .slice(0, MAX_HISTORY_PER_SITE)
    );
  }

  function hidePopup() {
    popup.hidden = true;
    matches = [];
    selectedIndex = 0;
  }
})();
