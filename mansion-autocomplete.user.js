// ==UserScript==
// @name         Site Input Autocomplete
// @namespace    local.site-input-autocomplete
// @version      1.6.0
// @description  Add a custom autocomplete picker with site-specific candidates and usage counts.
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

  const SITE_PHRASES_KEY = 'mansionAutocomplete.sitePhrases.v1';
  const HISTORY_KEY = 'mansionAutocomplete.history.v1';
  const PINNED_KEY = 'mansionAutocomplete.pinned.v1';
  const INPUT_MODE_KEY = 'mansionAutocomplete.inputMode.v1';
  const SUPPRESS_NATIVE_KEY = 'mansionAutocomplete.suppressNative.v1';
  const DISABLED_SITES_KEY = 'mansionAutocomplete.disabledSites.v1';
  const HISTORY_LIMIT_KEY = 'mansionAutocomplete.historyLimit.v1';
  const MAX_RESULTS = 12;
  const DEFAULT_HISTORY_LIMIT_PER_SITE = 5000;
  const HISTORY_LIMIT_OPTIONS = [500, 1000, 3000, 5000, 10000];
  const MIN_RECORD_LENGTH = 2;
  const RECORD_DEDUPE_MS = 900;
  const ACTION_BUTTON_PATTERN = /検索|決定|確定|送信|登録|保存|次へ|反映|search|submit|ok/i;

  const siteKey = location.hostname || location.host || 'unknown-site';
  let sitePhrases = loadSitePhrases();
  let history = loadHistory();
  let pinned = loadPinned();
  let activeInput = null;
  let selectedIndex = 0;
  let matches = [];
  let isComposingText = false;
  let inputMode = loadInputMode();
  let suppressNativeAutocomplete = loadSuppressNativeAutocomplete();
  let disabledSites = loadDisabledSites();
  let historyLimitPerSite = loadHistoryLimitPerSite();
  const recentRecords = new Map();
  const entryAttributeRestores = new WeakMap();
  let lastPopupCommit = { value: '', at: 0 };
  let lastCopyCommit = { value: '', at: 0 };
  let copiedMessage = '';
  let csvImportMessage = '';
  let lastCsvImportEncoding = '';
  let openPopupMenuKey = '';
  let managerCandidateQuery = '';
  let isManagerSearchComposing = false;

  const uiHost = document.createElement('div');
  uiHost.id = 'mansion-autocomplete-ui-host';
  const uiRoot = uiHost.attachShadow({ mode: 'open' });

  const managerButton = document.createElement('button');
  managerButton.id = 'mansion-autocomplete-manager-button';
  managerButton.type = 'button';
  managerButton.textContent = '設定';
  managerButton.title = '入力候補の設定';

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
      position: relative;
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto auto auto auto;
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
    #mansion-autocomplete-popup .mac-pin,
    #mansion-autocomplete-popup .mac-copy,
    #mansion-autocomplete-popup .mac-more,
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
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI Symbol", "Segoe UI", sans-serif;
      line-height: 1;
    }
    #mansion-autocomplete-popup .mac-pin[aria-pressed="true"] {
      color: #f59e0b;
      background: transparent;
    }
    #mansion-autocomplete-popup .mac-pin:hover {
      background: #f3f4f6;
      color: #f59e0b;
    }
    #mansion-autocomplete-popup .mac-copy:hover {
      background: #dbeafe;
      color: #1d4ed8;
    }
    #mansion-autocomplete-popup .mac-more:hover,
    #mansion-autocomplete-popup .mac-more[aria-expanded="true"] {
      background: #f3f4f6;
      color: #111827;
    }
    #mansion-autocomplete-popup .mac-delete:hover {
      background: #fee2e2;
      color: #b91c1c;
    }
    #mansion-autocomplete-popup .mac-menu {
      position: absolute;
      right: 8px;
      top: calc(100% - 2px);
      z-index: 1;
      display: grid;
      gap: 4px;
      min-width: 96px;
      padding: 5px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
      box-shadow: 0 8px 20px rgba(15, 23, 42, 0.18);
    }
    #mansion-autocomplete-popup .mac-menu .mac-delete {
      width: 100%;
      height: auto;
      justify-content: start;
      padding: 6px 8px;
      color: #b91c1c;
      font-size: 13px;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] {
      background: #1d4ed8;
      color: #fff;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-meta {
      color: #dbeafe;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-pin,
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-copy,
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-more,
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-delete {
      color: #dbeafe;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-pin[aria-pressed="true"] {
      background: transparent;
      color: #fbbf24;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-pin:hover {
      background: #f3f4f6;
      color: #f59e0b;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-copy:hover {
      background: #dbeafe;
      color: #1d4ed8;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-more:hover,
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-more[aria-expanded="true"] {
      background: #f3f4f6;
      color: #111827;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-delete:hover {
      background: #fee2e2;
      color: #b91c1c;
    }
    #mansion-autocomplete-popup .mac-help {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 5px 9px 3px;
      color: #6b7280;
      font-size: 12px;
      border-top: 1px solid #e5e7eb;
      margin-top: 3px;
    }
    #mansion-autocomplete-popup .mac-clear-input {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      border: 0;
      border-radius: 4px;
      padding: 3px 6px;
      background: transparent;
      color: #6b7280;
      cursor: pointer;
      font-size: 12px;
      line-height: 1.2;
      white-space: nowrap;
    }
    #mansion-autocomplete-popup .mac-clear-input:hover {
      background: #f3f4f6;
      color: #111827;
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
      padding: 9px 18px;
      background: #1d4ed8;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.06em;
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
    #mansion-autocomplete-manager input,
    #mansion-autocomplete-manager select {
      min-width: 0;
      box-sizing: border-box;
      border: 1px solid #aeb8c7;
      border-radius: 6px;
      padding: 9px 10px;
      font: inherit;
    }
    #mansion-autocomplete-manager input {
      flex: 1;
    }
    #mansion-autocomplete-manager select {
      min-width: 128px;
      background: #fff;
      color: #111827;
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
    #mansion-autocomplete-manager .mac-pin-toggle[aria-pressed="true"] {
      border-color: #cbd5e1;
      background: #fff;
      color: #f59e0b;
    }
    #mansion-autocomplete-manager .mac-list {
      display: grid;
      gap: 6px;
      margin-top: 8px;
    }
    #mansion-autocomplete-manager .mac-list-item {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto auto;
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
    GM_registerMenuCommand('このサイトの候補を編集', editPhrases);
    GM_registerMenuCommand('このサイトの候補を初期化', resetPhrases);
    GM_registerMenuCommand('このサイトの使用回数をリセット', clearSiteHistory);
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
    if (isOwnUiEvent(event)) return;
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

  function loadSitePhrases() {
    const saved = readValue(SITE_PHRASES_KEY, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }

  function getCurrentSitePhrases() {
    const current = sitePhrases[siteKey];
    return Array.isArray(current) ? uniqueNonEmpty(current) : [];
  }

  function loadPinned() {
    const saved = readValue(PINNED_KEY, {});
    return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {};
  }

  function getCurrentSitePinned() {
    const current = pinned[siteKey];
    return Array.isArray(current) ? uniqueNonEmpty(current) : [];
  }

  function saveCurrentSitePinned(nextPinned) {
    const cleaned = uniqueNonEmpty(nextPinned);
    if (cleaned.length) {
      pinned[siteKey] = cleaned;
    } else {
      delete pinned[siteKey];
    }
    writeValue(PINNED_KEY, pinned);
  }

  function isPinned(value) {
    const key = normalize(value);
    return getCurrentSitePinned().some((item) => normalize(item) === key);
  }

  function togglePinned(value) {
    const key = normalize(value);
    const current = getCurrentSitePinned();
    const exists = current.some((item) => normalize(item) === key);
    if (exists) {
      saveCurrentSitePinned(current.filter((item) => normalize(item) !== key));
    } else {
      addCurrentSitePhrase(value);
      saveCurrentSitePinned(current.concat(String(value || '').trim()));
    }
  }

  function getCurrentSiteCandidates() {
    const siteHistory = history[siteKey] || {};
    const candidates = new Map();

    getCurrentSitePhrases().forEach((value) => {
      candidates.set(normalize(value), {
        value,
        count: 0,
        lastUsed: 0,
        pinned: isPinned(value),
      });
    });

    Object.entries(siteHistory).forEach(([value, stat]) => {
      const key = normalize(value);
      const existing = candidates.get(key);
      candidates.set(key, {
        value: existing ? existing.value : value,
        count: Number(stat.count) || 0,
        lastUsed: Number(stat.lastUsed) || 0,
        pinned: isPinned(existing ? existing.value : value),
      });
    });

    return Array.from(candidates.values()).sort(compareCandidate);
  }

  function saveCurrentSitePhrases(nextPhrases) {
    const cleaned = uniqueNonEmpty(nextPhrases);
    if (cleaned.length) {
      sitePhrases[siteKey] = cleaned;
    } else {
      delete sitePhrases[siteKey];
    }
    writeValue(SITE_PHRASES_KEY, sitePhrases);
  }

  function addCurrentSitePhrase(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) return;
    const current = getCurrentSitePhrases();
    if (current.some((item) => normalize(item) === normalize(cleaned))) return;
    saveCurrentSitePhrases(current.concat(cleaned));
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

  function loadHistoryLimitPerSite() {
    const saved = Number(readValue(HISTORY_LIMIT_KEY, DEFAULT_HISTORY_LIMIT_PER_SITE));
    return HISTORY_LIMIT_OPTIONS.includes(saved) ? saved : DEFAULT_HISTORY_LIMIT_PER_SITE;
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
    const currentPhrases = getCurrentSitePhrases();
    const nextText = window.prompt(
      `${siteKey} の候補を1行に1つずつ入力してください。`,
      currentPhrases.join('\n')
    );
    if (nextText === null) return;
    saveCurrentSitePhrases(nextText.split(/\r?\n/));
    updatePopup();
  }

  function resetPhrases() {
    if (!confirmClearAllSiteCandidates()) return;
    clearAllSiteCandidates();
    managerCandidateQuery = '';
    updatePopup();
  }

  function clearAllSiteCandidates() {
    saveCurrentSitePhrases([]);
    saveCurrentSitePinned([]);
    delete history[siteKey];
    saveHistory();
  }

  function clearSiteHistory() {
    if (!confirmClearSiteHistory()) return;
    saveCurrentSitePhrases(getCurrentSiteCandidates().map((candidate) => candidate.value));
    delete history[siteKey];
    saveHistory();
    updatePopup();
  }

  function confirmClearSiteHistory() {
    return window.confirm(`${siteKey} の候補名は残したまま、使用回数と最終使用日だけをリセットします。\nよろしいですか？`);
  }

  function confirmClearAllSiteCandidates() {
    const count = getCurrentSiteCandidates().length;
    if (!count) {
      window.alert(`${siteKey} の候補はまだありません。`);
      return false;
    }
    return window.confirm(`${siteKey} の候補 ${count.toLocaleString('ja-JP')}件をすべて削除します。\n使用回数とピン止め状態も削除されます。\nよろしいですか？`);
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
    if (!matches.some((match) => normalize(match.value) === openPopupMenuKey)) {
      openPopupMenuKey = '';
    }

    if (!matches.length) {
      hidePopup();
      return;
    }

    renderPopup();
    popup.hidden = false;
    positionPopup();
  }

  function buildMatches(rawQuery) {
    const query = buildSearchQuery(rawQuery);
    return getCurrentSiteCandidates()
      .filter((candidate) => matchesQuery(candidate.value, query))
      .map((candidate) => ({
        ...candidate,
        rank: rankValue(candidate.value, query),
      }))
      .sort(compareMatch)
      .slice(0, MAX_RESULTS);
  }

  function matchesQuery(value, query) {
    if (!query.compact) return true;
    const searchable = normalizeForSearch(value);
    return query.tokens.every((token) => searchable.includes(token));
  }

  function rankValue(value, query) {
    if (!query.compact) return 0;
    const searchable = normalizeForSearch(value);
    if (searchable === query.compact) return 0;
    if (searchable.startsWith(query.compact)) return 1;
    if (query.tokens.length > 1 && query.tokens.every((token) => searchable.startsWith(token) || searchable.includes(token))) {
      return query.tokens[0] && searchable.startsWith(query.tokens[0]) ? 2 : 3;
    }
    if (query.tokens.some((token) => searchable.startsWith(token))) return 4;
    return 5;
  }

  function compareMatch(a, b) {
    return (
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      a.rank - b.rank ||
      b.count - a.count ||
      b.lastUsed - a.lastUsed ||
      a.value.localeCompare(b.value, 'ja')
    );
  }

  function compareCandidate(a, b) {
    return (
      Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)) ||
      (Number(b.count) || 0) - (Number(a.count) || 0) ||
      (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0) ||
      a.value.localeCompare(b.value, 'ja')
    );
  }

  function normalize(value) {
    return String(value || '').trim().normalize('NFKC').toLowerCase();
  }

  function buildSearchQuery(value) {
    const normalized = normalize(value);
    const tokens = normalized
      .split(/[\s\u3000]+/)
      .map(normalizeForSearch)
      .filter(Boolean);
    const compact = normalizeForSearch(normalized);
    return {
      compact,
      tokens: tokens.length ? tokens : compact ? [compact] : [],
    };
  }

  function normalizeForSearch(value) {
    return toKatakana(String(value || '').normalize('NFKC').toLowerCase())
      .replace(/[ヶヵ]/g, 'ケ')
      .replace(/\bthe\b/g, 'ザ')
      .replace(/[\s\u3000\-‐‑‒–—―ｰー~〜・･_'’"“”.,，．/／\\|()（）［］\[\]【】<>＜＞]/g, '');
  }

  function toKatakana(value) {
    return value.replace(/[\u3041-\u3096]/g, (char) => {
      return String.fromCharCode(char.charCodeAt(0) + 0x60);
    });
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
      meta.textContent = match.count > 0 ? `${match.count}回使用` : '未使用';

      const pinButton = document.createElement('button');
      pinButton.className = 'mac-pin';
      pinButton.type = 'button';
      pinButton.title = match.pinned ? `${match.value} のピン止めを解除` : `${match.value} をピン止め`;
      pinButton.setAttribute('aria-label', pinButton.title);
      pinButton.setAttribute('aria-pressed', String(Boolean(match.pinned)));
      pinButton.textContent = match.pinned ? '★' : '☆';
      const togglePinFromPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        togglePinned(match.value);
        updatePopup();
      };
      pinButton.addEventListener('pointerdown', togglePinFromPopup);
      pinButton.addEventListener('mousedown', togglePinFromPopup);
      pinButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

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

      const moreButton = document.createElement('button');
      moreButton.className = 'mac-more';
      moreButton.type = 'button';
      moreButton.title = 'その他の操作';
      moreButton.setAttribute('aria-label', `${match.value} のその他の操作`);
      moreButton.setAttribute('aria-expanded', String(openPopupMenuKey === normalize(match.value)));
      moreButton.textContent = '…';
      const toggleMenuFromPopup = (event) => {
        event.preventDefault();
        event.stopPropagation();
        const key = normalize(match.value);
        openPopupMenuKey = openPopupMenuKey === key ? '' : key;
        renderPopup();
      };
      moreButton.addEventListener('pointerdown', toggleMenuFromPopup);
      moreButton.addEventListener('mousedown', toggleMenuFromPopup);
      moreButton.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
      });

      item.appendChild(name);
      item.appendChild(pinButton);
      item.appendChild(copyButton);
      item.appendChild(meta);
      item.appendChild(moreButton);
      if (openPopupMenuKey === normalize(match.value)) {
        const menu = document.createElement('div');
        menu.className = 'mac-menu';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'mac-delete';
        deleteButton.type = 'button';
        deleteButton.title = `${match.value} を候補から削除`;
        deleteButton.setAttribute('aria-label', `${match.value} を候補から削除`);
        deleteButton.textContent = '候補を削除';
        const deleteFromPopup = (event) => {
          event.preventDefault();
          event.stopPropagation();
          openPopupMenuKey = '';
          deleteMatch(match);
        };
        deleteButton.addEventListener('pointerdown', deleteFromPopup);
        deleteButton.addEventListener('mousedown', deleteFromPopup);
        deleteButton.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();
        });

        menu.appendChild(deleteButton);
        item.appendChild(menu);
      }
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
    const helpText = document.createElement('span');
    helpText.textContent = 'Enter・Tab・クリックで入力 / ☆★でピン / ⧉で入力+コピー';

    const clearInputButton = document.createElement('button');
    clearInputButton.type = 'button';
    clearInputButton.className = 'mac-clear-input';
    clearInputButton.title = '入力欄を空にする';
    clearInputButton.setAttribute('aria-label', '入力欄を空にする');
    clearInputButton.textContent = '入力をクリア ×';
    const clearInputFromPopup = (event) => {
      event.preventDefault();
      event.stopPropagation();
      clearActiveInput();
    };
    clearInputButton.addEventListener('pointerdown', clearInputFromPopup);
    clearInputButton.addEventListener('mousedown', clearInputFromPopup);
    clearInputButton.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });

    help.appendChild(helpText);
    help.appendChild(clearInputButton);
    popup.appendChild(help);
  }

  function clearActiveInput() {
    if (!activeInput) return;
    setEntryValue(activeInput, '', inputMode);
    updatePopup();
  }

  function deleteMatch(match) {
    deleteCandidateValue(match.value);
    updatePopup();
  }

  function deleteCandidateValue(value) {
    saveCurrentSitePhrases(getCurrentSitePhrases().filter((phrase) => normalize(phrase) !== normalize(value)));
    saveCurrentSitePinned(getCurrentSitePinned().filter((phrase) => normalize(phrase) !== normalize(value)));
    deleteHistoryValue(value);
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
    manager.textContent = '';

    const panel = document.createElement('div');
    panel.className = 'mac-manager-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());

    const head = document.createElement('div');
    head.className = 'mac-manager-head';

    const title = document.createElement('h2');
    title.textContent = '入力候補';

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
    body.appendChild(createHistoryLimitSection());
    body.appendChild(createAddSection());
    body.appendChild(createCsvSection());
    body.appendChild(createCandidateSection());

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

  function createHistoryLimitSection() {
    const section = document.createElement('section');
    const box = document.createElement('div');
    box.className = 'mac-mode';

    const text = document.createElement('div');
    text.className = 'mac-mode-text';
    text.textContent = `使用回数データ上限: 1サイト ${historyLimitPerSite.toLocaleString('ja-JP')}件`;

    const select = document.createElement('select');
    select.setAttribute('aria-label', '1サイトあたりの使用回数データ上限');
    HISTORY_LIMIT_OPTIONS.forEach((limit) => {
      const option = document.createElement('option');
      option.value = String(limit);
      option.textContent = `${limit.toLocaleString('ja-JP')}件`;
      option.selected = limit === historyLimitPerSite;
      select.appendChild(option);
    });
    select.addEventListener('change', () => {
      historyLimitPerSite = Number(select.value) || DEFAULT_HISTORY_LIMIT_PER_SITE;
      writeValue(HISTORY_LIMIT_KEY, historyLimitPerSite);
      trimAllHistory();
      saveHistory();
      renderManager();
    });

    box.appendChild(text);
    box.appendChild(select);
    section.appendChild(box);
    return section;
  }

  function createAddSection() {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = 'このサイトの候補を追加';

    const row = document.createElement('div');
    row.className = 'mac-manager-row';

    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = '例: 中野ブロードウェイ';
    input.setAttribute('aria-label', '追加する候補');

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mac-primary';
    button.textContent = '追加';

    const add = () => {
      const value = input.value.trim();
      if (!value) return;
      saveCurrentSitePhrases(getCurrentSitePhrases().concat(value));
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

  function createCsvSection() {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = 'このサイト候補CSV一括登録';

    const row = document.createElement('div');
    row.className = 'mac-manager-row';

    const importInput = document.createElement('input');
    importInput.type = 'file';
    importInput.accept = '.csv,text/csv,text/plain';
    importInput.hidden = true;
    importInput.addEventListener('change', () => {
      const file = importInput.files && importInput.files[0];
      if (!file) return;
      importPhrasesFromCsv(file);
      importInput.value = '';
    });

    const importButton = document.createElement('button');
    importButton.type = 'button';
    importButton.className = 'mac-primary';
    importButton.textContent = 'CSVインポート';
    importButton.addEventListener('click', () => importInput.click());

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.textContent = 'このサイトの候補をCSVエクスポート';
    exportButton.addEventListener('click', exportPhrasesToCsv);

    const help = document.createElement('div');
    help.className = 'mac-empty';
    help.textContent = 'name列または1列目を、このサイトの候補として追加します。セル内改行がある行はスキップします。エクスポートには使用回数とピン止め状態も含めます。';

    row.appendChild(importButton);
    row.appendChild(exportButton);
    section.appendChild(heading);
    section.appendChild(row);
    section.appendChild(help);
    if (csvImportMessage) {
      const result = document.createElement('div');
      result.className = 'mac-empty';
      result.textContent = csvImportMessage;
      section.appendChild(result);
    }
    section.appendChild(importInput);
    return section;
  }

  function createCandidateSection() {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = `このサイトの候補: ${siteKey}`;

    const actions = document.createElement('div');
    actions.className = 'mac-manager-row';

    const clearUsageButton = document.createElement('button');
    clearUsageButton.type = 'button';
    clearUsageButton.className = 'mac-danger';
    clearUsageButton.textContent = '使用回数をリセット';
    clearUsageButton.addEventListener('click', clearSiteHistoryFromManager);

    const clearAllButton = document.createElement('button');
    clearAllButton.type = 'button';
    clearAllButton.className = 'mac-danger';
    clearAllButton.textContent = 'すべて削除';
    clearAllButton.addEventListener('click', clearAllSiteCandidatesFromManager);

    actions.appendChild(clearUsageButton);
    actions.appendChild(clearAllButton);

    const note = document.createElement('div');
    note.className = 'mac-empty';
    note.textContent = '検索・決定した名前も自動でこの候補に追加されます。使用回数は候補の並び順に使います。';

    const searchRow = document.createElement('div');
    searchRow.className = 'mac-manager-row';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = '候補を検索';
    searchInput.value = managerCandidateQuery;
    searchInput.setAttribute('aria-label', '候補を検索');
    searchInput.addEventListener('compositionstart', () => {
      isManagerSearchComposing = true;
    });
    searchInput.addEventListener('compositionend', () => {
      isManagerSearchComposing = false;
      managerCandidateQuery = searchInput.value;
      renderManagerPreservingScroll({ focusCandidateSearch: true });
    });
    searchInput.addEventListener('input', (event) => {
      managerCandidateQuery = searchInput.value;
      if (isManagerSearchComposing || event.isComposing) return;
      renderManagerPreservingScroll({ focusCandidateSearch: true });
    });

    searchRow.appendChild(searchInput);

    const list = document.createElement('div');
    list.className = 'mac-list';
    const candidates = getCurrentSiteCandidates();
    const query = buildSearchQuery(managerCandidateQuery);
    const filteredCandidates = query.compact
      ? candidates.filter((candidate) => matchesQuery(candidate.value, query)).map((candidate) => ({
        ...candidate,
        rank: rankValue(candidate.value, query),
      })).sort(compareMatch)
      : candidates;

    const countLine = document.createElement('div');
    countLine.className = 'mac-empty';
    countLine.textContent = query.compact
      ? `表示中 ${filteredCandidates.length.toLocaleString('ja-JP')}件 / 全 ${candidates.length.toLocaleString('ja-JP')}件`
      : `全 ${candidates.length.toLocaleString('ja-JP')}件`;

    if (!candidates.length) {
      list.appendChild(emptyLine('このサイトの候補はまだありません。'));
    } else if (!filteredCandidates.length) {
      list.appendChild(emptyLine('一致する候補はありません。'));
    } else {
      filteredCandidates.forEach((candidate) => {
        list.appendChild(createManagerItem(candidate.value, candidate.count > 0 ? `${candidate.count}回使用` : '未使用', () => {
          deleteCandidateValue(candidate.value);
          renderManagerPreservingScroll();
        }, {
          pinned: candidate.pinned,
          onTogglePin: () => {
            togglePinned(candidate.value);
            renderManagerPreservingScroll();
          },
        }));
      });
    }

    section.appendChild(heading);
    section.appendChild(actions);
    section.appendChild(note);
    section.appendChild(searchRow);
    section.appendChild(countLine);
    section.appendChild(list);
    return section;
  }

  function createManagerItem(value, metaText, onDelete, options = {}) {
    const item = document.createElement('div');
    item.className = 'mac-list-item';

    const name = document.createElement('div');
    name.className = 'mac-list-name';
    name.textContent = value;

    const meta = document.createElement('div');
    meta.className = 'mac-list-meta';
    meta.textContent = metaText;

    const pinButton = document.createElement('button');
    pinButton.type = 'button';
    pinButton.className = 'mac-pin-toggle';
    pinButton.textContent = options.pinned ? '★' : '☆';
    pinButton.title = options.pinned ? `${value} のピン止めを解除` : `${value} をピン止め`;
    pinButton.setAttribute('aria-label', pinButton.title);
    pinButton.setAttribute('aria-pressed', String(Boolean(options.pinned)));
    pinButton.addEventListener('click', options.onTogglePin || (() => {}));

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mac-danger';
    deleteButton.textContent = 'ゴミ箱';
    deleteButton.addEventListener('click', onDelete);

    item.appendChild(pinButton);
    item.appendChild(name);
    item.appendChild(meta);
    item.appendChild(deleteButton);
    return item;
  }

  async function importPhrasesFromCsv(file) {
    try {
      const text = await readCsvFileText(file);
      const result = extractPhrasesFromCsv(text);
      const imported = result.entries.map((entry) => entry.value);
      if (!imported.length) {
        csvImportMessage = formatCsvImportMessage(0, 0, result.skippedRows);
        window.alert('CSVから候補を読み取れませんでした。');
        renderManager();
        return;
      }

      const before = getCurrentSitePhrases().length;
      saveCurrentSitePhrases(getCurrentSitePhrases().concat(imported));
      importUsageStats(result.entries);
      importPinnedState(result.entries);
      const added = getCurrentSitePhrases().length - before;
      csvImportMessage = formatCsvImportMessage(result.readCount, added, result.skippedRows);
      window.alert(`${imported.length}件読み取り、${added}件追加しました。`);
      renderManager();
    } catch (error) {
      window.alert(`CSVインポートに失敗しました: ${error && error.message ? error.message : error}`);
    }
  }

  async function readCsvFileText(file) {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);

    if (hasUtf8Bom(bytes)) {
      lastCsvImportEncoding = 'UTF-8 BOM';
      return new TextDecoder('utf-8').decode(bytes.subarray(3));
    }
    if (hasUtf16LeBom(bytes)) {
      lastCsvImportEncoding = 'UTF-16 LE';
      return new TextDecoder('utf-16le').decode(bytes.subarray(2));
    }
    if (hasUtf16BeBom(bytes)) {
      lastCsvImportEncoding = 'UTF-16 BE';
      return new TextDecoder('utf-16be').decode(bytes.subarray(2));
    }

    const utf8 = new TextDecoder('utf-8').decode(bytes);
    const shiftJis = decodeShiftJis(bytes);
    return chooseCsvText(utf8, shiftJis);
  }

  function hasUtf8Bom(bytes) {
    return bytes.length >= 3 && bytes[0] === 0xEF && bytes[1] === 0xBB && bytes[2] === 0xBF;
  }

  function hasUtf16LeBom(bytes) {
    return bytes.length >= 2 && bytes[0] === 0xFF && bytes[1] === 0xFE;
  }

  function hasUtf16BeBom(bytes) {
    return bytes.length >= 2 && bytes[0] === 0xFE && bytes[1] === 0xFF;
  }

  function decodeShiftJis(bytes) {
    try {
      return new TextDecoder('shift_jis').decode(bytes);
    } catch (_) {
      return '';
    }
  }

  function chooseCsvText(utf8, shiftJis) {
    if (!shiftJis) {
      lastCsvImportEncoding = 'UTF-8';
      return utf8;
    }

    const utf8ReplacementCount = countReplacementChars(utf8);
    const shiftJisReplacementCount = countReplacementChars(shiftJis);
    if (utf8ReplacementCount > 0 && shiftJisReplacementCount === 0) {
      lastCsvImportEncoding = 'Shift-JIS/CP932';
      return shiftJis;
    }

    const utf8Score = scoreDecodedText(utf8);
    const shiftJisScore = scoreDecodedText(shiftJis);
    if (shiftJisScore < utf8Score) {
      lastCsvImportEncoding = 'Shift-JIS/CP932';
      return shiftJis;
    }

    lastCsvImportEncoding = 'UTF-8';
    return utf8;
  }

  function countReplacementChars(text) {
    return (text.match(/\uFFFD/g) || []).length;
  }

  function scoreDecodedText(text) {
    const replacementCount = countReplacementChars(text);
    const mojibakeCount = (text.match(/[縺繧譁蜷鬆莨髱逕荳]/g) || []).length;
    const japaneseCount = (text.match(/[\u3040-\u30ff\u3400-\u9fff]/g) || []).length;
    return replacementCount * 100 + mojibakeCount * 8 - japaneseCount;
  }

  function extractPhrasesFromCsv(text) {
    const rows = parseCsv(String(text || '').replace(/^\uFEFF/, ''));
    if (!rows.length) return { entries: [], readCount: 0, skippedRows: [] };

    const firstRow = rows[0].map((cell) => normalize(cell));
    const nameIndex = firstRow.indexOf('name');
    const countIndex = firstRow.indexOf('count');
    const lastUsedIndex = firstRow.indexOf('lastused');
    const pinnedIndex = firstRow.indexOf('pinned');
    const startIndex = nameIndex >= 0 ? 1 : 0;
    const targetIndex = nameIndex >= 0 ? nameIndex : 0;
    const entries = [];
    const skippedRows = [];
    const seen = new Set();

    rows.slice(startIndex).forEach((row, index) => {
      const rowNumber = startIndex + index + 1;
      const rawValue = row[targetIndex] || '';
      const value = rawValue.trim();
      if (!value) return;
      if (/[\r\n]/.test(rawValue)) {
        skippedRows.push({ rowNumber, reason: 'セル内改行', value: value.replace(/\s+/g, ' ') });
        return;
      }
      if (/\uFFFD/.test(value)) {
        skippedRows.push({ rowNumber, reason: '文字化けの可能性', value });
        return;
      }
      const key = normalize(value);
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({
        value,
        count: countIndex >= 0 ? parseCsvCount(row[countIndex]) : 0,
        lastUsed: lastUsedIndex >= 0 ? parseCsvDate(row[lastUsedIndex]) : 0,
        pinned: pinnedIndex >= 0 ? parseCsvBoolean(row[pinnedIndex]) : false,
      });
    });

    return {
      entries,
      readCount: entries.length,
      skippedRows,
    };
  }

  function parseCsvCount(value) {
    const count = Number(String(value || '').replace(/,/g, '').trim());
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
  }

  function parseCsvDate(value) {
    const text = String(value || '').trim();
    if (!text) return 0;
    const time = Date.parse(text);
    return Number.isFinite(time) ? time : 0;
  }

  function parseCsvBoolean(value) {
    const text = normalize(value);
    return ['1', 'true', 'yes', 'y', 'on', 'pinned', 'pin', 'ピン', '固定'].includes(text);
  }

  function importUsageStats(entries) {
    const stats = entries.filter((entry) => entry.count > 0 || entry.lastUsed > 0);
    if (!stats.length) return;

    const siteHistory = history[siteKey] || {};
    stats.forEach((entry) => {
      const existingKey = Object.keys(siteHistory).find((key) => normalize(key) === normalize(entry.value));
      const key = existingKey || entry.value;
      const current = siteHistory[key] || { count: 0, lastUsed: 0 };
      siteHistory[key] = {
        count: Math.max(Number(current.count) || 0, Number(entry.count) || 0),
        lastUsed: Math.max(Number(current.lastUsed) || 0, Number(entry.lastUsed) || 0),
      };
    });

    history[siteKey] = trimHistory(siteHistory);
    saveHistory();
  }

  function importPinnedState(entries) {
    const pinnedEntries = entries.filter((entry) => entry.pinned).map((entry) => entry.value);
    if (!pinnedEntries.length) return;
    saveCurrentSitePinned(getCurrentSitePinned().concat(pinnedEntries));
  }

  function formatCsvImportMessage(readCount, added, skippedRows) {
    const encoding = lastCsvImportEncoding ? ` / 文字コード: ${lastCsvImportEncoding}` : '';
    const parts = [`CSV結果: 読み取り ${readCount}件 / 追加 ${added}件${encoding}`];
    if (skippedRows.length) {
      const rows = skippedRows.slice(0, 8).map((item) => `${item.rowNumber}行目(${item.reason})`);
      const suffix = skippedRows.length > rows.length ? ` ほか${skippedRows.length - rows.length}件` : '';
      parts.push(`スキップ: ${rows.join('、')}${suffix}`);
    }
    return parts.join('。');
  }

  function parseCsv(text) {
    const rows = [];
    let row = [];
    let cell = '';
    let inQuotes = false;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      const next = text[index + 1];

      if (inQuotes) {
        if (char === '"' && next === '"') {
          cell += '"';
          index += 1;
        } else if (char === '"') {
          inQuotes = false;
        } else {
          cell += char;
        }
      } else if (char === '"') {
        inQuotes = true;
      } else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell);
        rows.push(row);
        row = [];
        cell = '';
      } else if (char !== '\r') {
        cell += char;
      }
    }

    row.push(cell);
    rows.push(row);
    return rows.filter((item) => item.some((cellValue) => cellValue.trim()));
  }

  function exportPhrasesToCsv() {
    const rows = [
      ['name', 'count', 'lastUsed', 'pinned'],
      ...getCurrentSiteCandidates().map((candidate) => [
        candidate.value,
        String(candidate.count || 0),
        candidate.lastUsed ? new Date(candidate.lastUsed).toISOString() : '',
        candidate.pinned ? '1' : '',
      ]),
    ];
    const csv = rows.map((row) => row.map(escapeCsvCell).join(',')).join('\r\n') + '\r\n';
    const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    const date = new Date().toISOString().slice(0, 10).replaceAll('-', '');

    anchor.href = url;
    anchor.download = `mansion-autocomplete-${sanitizeFilename(siteKey)}-candidates-${date}.csv`;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function escapeCsvCell(value) {
    const text = String(value || '');
    if (/[",\r\n]/.test(text)) {
      return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
  }

  function sanitizeFilename(value) {
    return String(value || 'site').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 80);
  }

  function emptyLine(text) {
    const empty = document.createElement('div');
    empty.className = 'mac-empty';
    empty.textContent = text;
    return empty;
  }

  function clearSiteHistoryFromManager() {
    if (!confirmClearSiteHistory()) return;
    saveCurrentSitePhrases(getCurrentSiteCandidates().map((candidate) => candidate.value));
    delete history[siteKey];
    saveHistory();
    renderManager();
  }

  function clearAllSiteCandidatesFromManager() {
    if (!confirmClearAllSiteCandidates()) return;
    clearAllSiteCandidates();
    managerCandidateQuery = '';
    renderManager();
    updatePopup();
  }

  function renderManagerPreservingScroll(options = {}) {
    const currentPanel = manager.querySelector('.mac-manager-panel');
    const scrollTop = currentPanel ? currentPanel.scrollTop : 0;
    renderManager();
    const nextPanel = manager.querySelector('.mac-manager-panel');
    if (nextPanel) {
      nextPanel.scrollTop = Math.min(scrollTop, nextPanel.scrollHeight);
    }
    if (options.focusCandidateSearch) {
      const searchInput = manager.querySelector('input[aria-label="候補を検索"]');
      if (searchInput) {
        searchInput.focus();
        const end = searchInput.value.length;
        searchInput.setSelectionRange(end, end);
      }
    }
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
    if (event.target.closest && event.target.closest('.mac-delete, .mac-copy, .mac-pin, .mac-more, .mac-menu')) return;

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

    addCurrentSitePhrase(value);

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

  function trimAllHistory() {
    Object.keys(history).forEach((key) => {
      history[key] = trimHistory(history[key] || {});
    });
  }

  function trimHistory(siteHistory) {
    return Object.fromEntries(
      Object.entries(siteHistory)
        .sort(([, a], [, b]) => {
          return (Number(b.count) || 0) - (Number(a.count) || 0) ||
            (Number(b.lastUsed) || 0) - (Number(a.lastUsed) || 0);
        })
        .slice(0, historyLimitPerSite)
    );
  }

  function hidePopup() {
    popup.hidden = true;
    matches = [];
    selectedIndex = 0;
    openPopupMenuKey = '';
  }
})();
