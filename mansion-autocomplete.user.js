// ==UserScript==
// @name         Site Input Autocomplete
// @namespace    local.site-input-autocomplete
// @version      1.8.1
// @description  Add a custom autocomplete picker with site-specific candidates and usage counts.
// @homepageURL   https://github.com/poison-cookie/mansion-autocomplete
// @updateURL     https://raw.githubusercontent.com/poison-cookie/mansion-autocomplete/main/mansion-autocomplete.user.js
// @downloadURL   https://raw.githubusercontent.com/poison-cookie/mansion-autocomplete/main/mansion-autocomplete.user.js
// @match        http://*/*
// @match        https://*/*
// @all-frames   true
// @inject-into  content
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// ==/UserScript==

(function () {
  'use strict';

  // 保存キー。既存ユーザーのデータを引き継ぐため、古い mansionAutocomplete 名は変更しない。
  const SITE_PHRASES_KEY = 'mansionAutocomplete.sitePhrases.v1';
  const HISTORY_KEY = 'mansionAutocomplete.history.v1';
  const PINNED_KEY = 'mansionAutocomplete.pinned.v1';
  const INPUT_MODE_KEY = 'mansionAutocomplete.inputMode.v1';
  const SUPPRESS_NATIVE_KEY = 'mansionAutocomplete.suppressNative.v1';
  const DISABLED_SITES_KEY = 'mansionAutocomplete.disabledSites.v1';
  const HISTORY_LIMIT_KEY = 'mansionAutocomplete.historyLimit.v1';
  const MANAGER_BUTTON_POSITION_KEY = 'mansionAutocomplete.managerButtonPosition.v1';
  const HIDDEN_MANAGER_BUTTON_SITES_KEY = 'mansionAutocomplete.hiddenManagerButtonSites.v1';
  const SITE_SCOPES_KEY = 'mansionAutocomplete.siteScopes.v1';
  const SCRIPT_VERSION = '1.8.1';
  const MIGRATION_SCHEMA = 'site-input-autocomplete';
  const MIGRATION_VERSION = 1;
  const SYNC_STORAGE_KEYS = [
    SITE_PHRASES_KEY,
    HISTORY_KEY,
    PINNED_KEY,
    INPUT_MODE_KEY,
    SUPPRESS_NATIVE_KEY,
    DISABLED_SITES_KEY,
    HISTORY_LIMIT_KEY,
    MANAGER_BUTTON_POSITION_KEY,
    HIDDEN_MANAGER_BUTTON_SITES_KEY,
    SITE_SCOPES_KEY,
  ];
  const MAX_RESULTS = 12;
  const DEFAULT_HISTORY_LIMIT_PER_SITE = 5000;
  const HISTORY_LIMIT_OPTIONS = [500, 1000, 3000, 5000, 10000];
  const MIN_RECORD_LENGTH = 2;
  const RECORD_DEDUPE_MS = 900;
  const ACTION_BUTTON_PATTERN = /検索|決定|確定|送信|登録|保存|次へ|反映|search|submit|ok/i;

  // このスクリプトはサイトごとに候補・使用回数・ピン止め状態を分けて保存する。
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
  let hiddenManagerButtonSites = loadHiddenManagerButtonSites();
  let siteScopes = loadSiteScopes();
  const recentRecords = new Map();
  const entryAttributeRestores = new WeakMap();
  let lastFocusedTextEntry = null;
  let lastPopupCommit = { value: '', at: 0 };
  let lastCopyCommit = { value: '', at: 0 };
  let copiedMessage = '';
  let csvImportMessage = '';
  let lastCsvImportEncoding = '';
  let openPopupMenuKey = '';
  let managerCandidateQuery = '';
  let isManagerSearchComposing = false;
  let managerView = 'settings';
  let migrationSelectedSites = [];
  let migrationSiteQuery = '';
  let migrationIncludePinned = true;
  let migrationIncludeHistory = false;
  let migrationIncludeSettings = true;
  let migrationImportIncludePinned = true;
  let migrationImportIncludeHistory = false;
  let migrationImportIncludeSettings = true;
  let migrationMessage = '';
  let migrationPendingImport = null;
  let managerButtonPosition = loadManagerButtonPosition();
  let managerButtonDrag = null;
  let siteScopeMessage = '';
  let managerFieldPickerOpen = false;

  const uiHost = document.createElement('div');
  uiHost.id = 'mansion-autocomplete-ui-host';
  const uiRoot = uiHost.attachShadow({ mode: 'open' });

  const managerButton = document.createElement('button');
  managerButton.id = 'mansion-autocomplete-manager-button';
  managerButton.type = 'button';
  managerButton.textContent = '設 定';
  managerButton.title = '入力候補の設定';

  const manager = document.createElement('div');
  manager.id = 'mansion-autocomplete-manager';
  manager.hidden = true;

  const popup = document.createElement('div');
  popup.id = 'mansion-autocomplete-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'listbox');

  // Shadow DOM 内にUIを作ることで、サイト側CSSの影響を受けにくくする。
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
      max-width: calc(100vw - 16px);
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
      min-width: 0;
      white-space: normal;
      overflow-wrap: anywhere;
      word-break: break-word;
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
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-menu .mac-delete {
      color: #991b1b;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-menu .mac-delete:hover {
      color: #7f1d1d;
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
      border: 1px solid #9ca3af;
      border-radius: 999px;
      padding: 10px 24px;
      background: #4b5563;
      color: #fff;
      font-size: 13px;
      font-weight: 600;
      letter-spacing: 0.08em;
      line-height: 1;
      box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);
      cursor: grab;
      user-select: none;
      touch-action: none;
    }
    #mansion-autocomplete-manager-button:active {
      cursor: grabbing;
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
    #mansion-autocomplete-manager .mac-scope-block {
      display: grid;
      gap: 10px;
      padding: 12px;
      border: 1px solid #dbe3ef;
      border-radius: 6px;
      background: #f8fafc;
    }
    #mansion-autocomplete-manager .mac-scope-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 10px;
      min-width: 0;
    }
    #mansion-autocomplete-manager .mac-scope-title {
      min-width: 0;
      color: #334155;
      font-size: 13px;
      font-weight: 700;
    }
    #mansion-autocomplete-manager .mac-rule-list {
      display: grid;
      gap: 6px;
    }
    #mansion-autocomplete-manager .mac-rule-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 8px;
      align-items: center;
      padding: 8px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
    }
    #mansion-autocomplete-manager .mac-rule-name {
      min-width: 0;
      overflow-wrap: anywhere;
      color: #111827;
      font-size: 13px;
    }
    #mansion-autocomplete-manager .mac-rule-meta {
      margin-top: 2px;
      color: #64748b;
      font-size: 12px;
      overflow-wrap: anywhere;
    }
    #mansion-autocomplete-manager .mac-manager-row {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
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
      padding: 9px 13px;
      background: #fff;
      color: #111827;
      font-size: 13px;
      font-weight: 600;
      line-height: 1.2;
      cursor: pointer;
      white-space: nowrap;
    }
    #mansion-autocomplete-manager button:disabled {
      opacity: 0.55;
      cursor: not-allowed;
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
    #mansion-autocomplete-manager .mac-check-options,
    #mansion-autocomplete-manager .mac-check-list {
      display: grid;
      gap: 8px;
    }
    #mansion-autocomplete-manager .mac-migration-body {
      gap: 22px;
    }
    #mansion-autocomplete-manager .mac-migration-section {
      display: grid;
      gap: 12px;
      padding-bottom: 18px;
      border-bottom: 1px solid #e5e7eb;
    }
    #mansion-autocomplete-manager .mac-migration-section:last-child {
      padding-bottom: 0;
      border-bottom: 0;
    }
    #mansion-autocomplete-manager .mac-migration-section h3 {
      margin-bottom: 0;
    }
    #mansion-autocomplete-manager .mac-migration-actions {
      gap: 10px;
    }
    #mansion-autocomplete-manager .mac-migration-search input {
      flex-basis: 260px;
    }
    #mansion-autocomplete-manager .mac-check-options {
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
      gap: 10px;
    }
    #mansion-autocomplete-manager .mac-check-list {
      max-height: 280px;
      overflow: auto;
      padding: 10px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #f8fafc;
    }
    #mansion-autocomplete-manager .mac-check-item {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      min-width: 0;
      color: #334155;
      font-size: 13px;
      line-height: 1.35;
    }
    #mansion-autocomplete-manager .mac-check-options .mac-check-item,
    #mansion-autocomplete-manager .mac-check-list .mac-check-item {
      padding: 9px 10px;
      border: 1px solid #e5e7eb;
      border-radius: 6px;
      background: #fff;
    }
    #mansion-autocomplete-manager .mac-check-list .mac-check-item + .mac-check-item {
      margin-top: 2px;
    }
    #mansion-autocomplete-manager .mac-check-item input[type="checkbox"] {
      flex: 0 0 auto;
      width: auto;
      margin-top: 2px;
    }
    #mansion-autocomplete-manager .mac-check-text {
      min-width: 0;
      overflow-wrap: anywhere;
    }
    #mansion-autocomplete-manager .mac-status {
      padding: 8px 10px;
      border-radius: 6px;
      background: #ecfdf5;
      color: #166534;
      font-size: 12px;
    }
    #mansion-autocomplete-manager .mac-preview {
      display: grid;
      gap: 6px;
      padding: 11px 12px;
      border: 1px solid #bfdbfe;
      border-radius: 6px;
      background: #eff6ff;
      color: #1e3a8a;
      font-size: 12px;
      line-height: 1.45;
    }
    #mansion-autocomplete-manager .mac-preview-title {
      color: #1e40af;
      font-size: 13px;
      font-weight: 700;
    }
    #mansion-autocomplete-manager .mac-preview-line {
      overflow-wrap: anywhere;
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
  applyManagerButtonPosition();
  updateManagerButtonVisibility();

  if (typeof GM_registerMenuCommand === 'function') {
    // Tampermonkey側は復旧導線だけに絞り、詳細操作は設定画面へ集約する。
    GM_registerMenuCommand('設定画面を開く', openManager);
  }

  managerButton.addEventListener('pointerdown', startManagerButtonDrag);
  managerButton.addEventListener('click', (event) => {
    if (managerButtonDrag && managerButtonDrag.wasDragged) {
      event.preventDefault();
      event.stopPropagation();
      managerButtonDrag = null;
      return;
    }
    managerButtonDrag = null;
    if (isSiteDisabled()) {
      updateManagerButtonVisibility();
      return;
    }
    openManager();
  });
  setupStorageSync();

  // 入力欄にフォーカスしたら候補ポップアップを表示する。
  document.addEventListener('focusin', (event) => {
    if (isTextEntry(event.target)) {
      lastFocusedTextEntry = event.target;
    }
    if (isSiteDisabled()) return;
    if (isAutocompleteTarget(event.target)) {
      activeInput = event.target;
      applyNativeAutocompleteSuppression(activeInput);
      updatePopup();
    } else if (isTextEntry(event.target)) {
      activeInput = null;
      hidePopup();
    }
  });

  document.addEventListener('blur', (event) => {
    if (event.target === activeInput) {
      restoreEntryAttributes(event.target);
    }
  }, true);

  document.addEventListener('input', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput && isAutocompleteTarget(event.target)) {
      if (isComposingText || event.isComposing) return;
      updatePopup();
    }
  });

  document.addEventListener('compositionstart', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput && isAutocompleteTarget(event.target)) {
      isComposingText = true;
      hidePopup();
    }
  });

  document.addEventListener('compositionend', (event) => {
    if (isSiteDisabled()) return;
    if (event.target === activeInput && isAutocompleteTarget(event.target)) {
      isComposingText = false;
      updatePopup();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (isSettingsShortcut(event)) {
      if (!isOwnUiEvent(event) && !isSiteDisabled()) {
        event.preventDefault();
        event.stopPropagation();
        openManager();
      }
      return;
    }

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

  // 外側をクリックしたら候補ポップアップを閉じる。
  document.addEventListener('mousedown', (event) => {
    if (isOwnUiEvent(event)) return;
    if (isSiteDisabled()) return;
    if (event.target !== activeInput) {
      hidePopup();
    }
  }, true);

  // フォーム送信時に入力値を候補へ追加し、使用回数を+1する。
  document.addEventListener('submit', (event) => {
    if (isOwnUiEvent(event)) return;
    if (isSiteDisabled()) return;
    recordEntriesForAction(event.target);
  }, true);

  // 検索・決定・保存などのボタン押下でも使用回数を記録する。
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

  window.addEventListener('resize', () => {
    positionPopup();
    applyManagerButtonPosition();
  });
  window.addEventListener('scroll', positionPopup, true);

  // --- 保存データの読み書き -------------------------------------------------
  // 候補、使用回数、ピン止め、サイト別ON/OFFなどを Tampermonkey storage に保存する。
  // Tampermonkey API が使えない検証環境では localStorage にフォールバックする。
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

  function writeCurrentSitePhrases(nextPhrases, store) {
    const nextStore = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
    const cleaned = uniqueNonEmpty(nextPhrases);
    if (cleaned.length) {
      nextStore[siteKey] = cleaned;
    } else {
      delete nextStore[siteKey];
    }
    sitePhrases = nextStore;
    writeValue(SITE_PHRASES_KEY, sitePhrases);
    return cleaned;
  }

  function saveCurrentSitePhrases(nextPhrases) {
    return writeCurrentSitePhrases(nextPhrases, loadSitePhrases());
  }

  function mergeCurrentSitePhrases(nextPhrases) {
    const additions = uniqueNonEmpty(nextPhrases);
    const latest = loadSitePhrases();
    const current = Array.isArray(latest[siteKey]) ? uniqueNonEmpty(latest[siteKey]) : [];
    if (!additions.length) {
      sitePhrases = latest;
      return current;
    }
    return writeCurrentSitePhrases(current.concat(additions), latest);
  }

  function removeCurrentSitePhrases(values) {
    const removeKeys = new Set(uniqueNonEmpty(values).map((item) => normalize(item)));
    const latest = loadSitePhrases();
    const current = Array.isArray(latest[siteKey]) ? uniqueNonEmpty(latest[siteKey]) : [];
    if (!removeKeys.size) {
      sitePhrases = latest;
      return current;
    }
    return writeCurrentSitePhrases(current.filter((phrase) => !removeKeys.has(normalize(phrase))), latest);
  }

  function writeCurrentSitePinned(nextPinned, store) {
    const nextStore = store && typeof store === 'object' && !Array.isArray(store) ? store : {};
    const cleaned = uniqueNonEmpty(nextPinned);
    if (cleaned.length) {
      nextStore[siteKey] = cleaned;
    } else {
      delete nextStore[siteKey];
    }
    pinned = nextStore;
    writeValue(PINNED_KEY, pinned);
    return cleaned;
  }

  function saveCurrentSitePinned(nextPinned) {
    return writeCurrentSitePinned(nextPinned, loadPinned());
  }

  function mergeCurrentSitePinned(nextPinned) {
    const additions = uniqueNonEmpty(nextPinned);
    const latest = loadPinned();
    const current = Array.isArray(latest[siteKey]) ? uniqueNonEmpty(latest[siteKey]) : [];
    if (!additions.length) {
      pinned = latest;
      return current;
    }
    return writeCurrentSitePinned(current.concat(additions), latest);
  }

  function removeCurrentSitePinned(values) {
    const removeKeys = new Set(uniqueNonEmpty(values).map((item) => normalize(item)));
    const latest = loadPinned();
    const current = Array.isArray(latest[siteKey]) ? uniqueNonEmpty(latest[siteKey]) : [];
    if (!removeKeys.size) {
      pinned = latest;
      return current;
    }
    return writeCurrentSitePinned(current.filter((phrase) => !removeKeys.has(normalize(phrase))), latest);
  }

  function isPinned(value) {
    const key = normalize(value);
    return getCurrentSitePinned().some((item) => normalize(item) === key);
  }

  function togglePinned(value) {
    pinned = loadPinned();
    const key = normalize(value);
    const current = getCurrentSitePinned();
    const exists = current.some((item) => normalize(item) === key);
    if (exists) {
      removeCurrentSitePinned([value]);
    } else {
      addCurrentSitePhrase(value);
      mergeCurrentSitePinned([value]);
    }
  }

  function getCurrentSiteCandidates() {
    const siteHistory = getHistoryForSite(history);
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

  function addCurrentSitePhrase(value) {
    const cleaned = String(value || '').trim();
    if (!cleaned) return;
    mergeCurrentSitePhrases([cleaned]);
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

  function loadHiddenManagerButtonSites() {
    const saved = readValue(HIDDEN_MANAGER_BUTTON_SITES_KEY, []);
    return Array.isArray(saved) ? saved.filter((item) => typeof item === 'string') : [];
  }

  function loadSiteScopes() {
    const saved = readValue(SITE_SCOPES_KEY, {});
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};

    const result = {};
    Object.entries(saved).forEach(([site, scope]) => {
      const cleanSite = String(site || '').trim();
      if (!cleanSite) return;
      const cleanScope = sanitizeSiteScope(scope);
      if (cleanScope.enabledPaths.length || cleanScope.fieldSelectors.length) {
        result[cleanSite] = cleanScope;
      }
    });
    return result;
  }

  function getCurrentSiteScope() {
    return sanitizeSiteScope(siteScopes[siteKey]);
  }

  function writeCurrentSiteScope(scope) {
    const nextScopes = loadSiteScopes();
    const cleanScope = sanitizeSiteScope(scope);
    if (cleanScope.enabledPaths.length || cleanScope.fieldSelectors.length) {
      nextScopes[siteKey] = cleanScope;
    } else {
      delete nextScopes[siteKey];
    }
    siteScopes = nextScopes;
    writeValue(SITE_SCOPES_KEY, siteScopes);
  }

  function sanitizeSiteScope(scope) {
    const result = {
      enabledPaths: [],
      fieldSelectors: [],
    };
    if (!scope || typeof scope !== 'object' || Array.isArray(scope)) return result;

    const seenPaths = new Set();
    if (Array.isArray(scope.enabledPaths)) {
      scope.enabledPaths.forEach((rule) => {
        const cleanRule = sanitizePathRule(rule);
        if (!cleanRule) return;
        const key = `${cleanRule.type}\n${cleanRule.value}`;
        if (seenPaths.has(key)) return;
        seenPaths.add(key);
        result.enabledPaths.push(cleanRule);
      });
    }

    const seenFields = new Set();
    if (Array.isArray(scope.fieldSelectors)) {
      scope.fieldSelectors.forEach((field) => {
        const cleanField = sanitizeFieldSelector(field);
        if (!cleanField) return;
        if (seenFields.has(cleanField.selector)) return;
        seenFields.add(cleanField.selector);
        result.fieldSelectors.push(cleanField);
      });
    }

    return result;
  }

  function sanitizePathRule(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return null;
    const type = rule.type === 'prefix' ? 'prefix' : 'exact';
    const value = normalizePagePath(rule.value);
    if (!value) return null;
    return { type, value };
  }

  function sanitizeFieldSelector(field) {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return null;
    const selector = String(field.selector || '').trim();
    if (!selector || !isValidSelector(selector)) return null;
    const label = String(field.label || '').trim() || selector;
    const source = String(field.source || '').trim() || 'selector';
    return { selector, label, source };
  }

  function loadHistoryLimitPerSite() {
    const saved = Number(readValue(HISTORY_LIMIT_KEY, DEFAULT_HISTORY_LIMIT_PER_SITE));
    return HISTORY_LIMIT_OPTIONS.includes(saved) ? saved : DEFAULT_HISTORY_LIMIT_PER_SITE;
  }

  function loadManagerButtonPosition() {
    const saved = readValue(MANAGER_BUTTON_POSITION_KEY, null);
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return null;
    const left = Number(saved.left);
    const top = Number(saved.top);
    if (!Number.isFinite(left) || !Number.isFinite(top)) return null;
    return { left, top };
  }

  function saveManagerButtonPosition(position) {
    managerButtonPosition = position;
    writeValue(MANAGER_BUTTON_POSITION_KEY, managerButtonPosition);
  }

  function saveDisabledSites() {
    writeValue(DISABLED_SITES_KEY, [...new Set(disabledSites)]);
  }

  function isSiteDisabled() {
    return disabledSites.includes(siteKey);
  }

  function saveHiddenManagerButtonSites() {
    writeValue(HIDDEN_MANAGER_BUTTON_SITES_KEY, [...new Set(hiddenManagerButtonSites)]);
  }

  function isManagerButtonHiddenForSite() {
    return hiddenManagerButtonSites.includes(siteKey);
  }

  function saveHistory() {
    writeValue(HISTORY_KEY, history);
  }

  function getHistoryForSite(store) {
    const current = store && store[siteKey];
    return current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  }

  function writeHistoryStore(nextHistory) {
    history = nextHistory && typeof nextHistory === 'object' && !Array.isArray(nextHistory) ? nextHistory : {};
    writeValue(HISTORY_KEY, history);
    return history;
  }

  function updateCurrentSiteHistory(mutator) {
    const latest = loadHistory();
    const siteHistory = { ...getHistoryForSite(latest) };
    const nextSiteHistory = mutator(siteHistory) || siteHistory;
    if (nextSiteHistory && Object.keys(nextSiteHistory).length) {
      latest[siteKey] = trimHistory(nextSiteHistory);
    } else {
      delete latest[siteKey];
    }
    writeHistoryStore(latest);
    return getHistoryForSite(history);
  }

  function clearCurrentSiteHistory() {
    const latest = loadHistory();
    delete latest[siteKey];
    writeHistoryStore(latest);
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

  // --- Tampermonkeyメニューから呼ぶ操作 ------------------------------------
  function setupStorageSync() {
    if (typeof GM_addValueChangeListener === 'function') {
      SYNC_STORAGE_KEYS.forEach((key) => {
        GM_addValueChangeListener(key, (_name, _oldValue, _newValue, remote) => {
          if (!remote) return;
          syncStoredData();
          refreshUiAfterStorageSync();
        });
      });
    }

    window.addEventListener('storage', (event) => {
      if (event.key !== null && !SYNC_STORAGE_KEYS.includes(event.key)) return;
      syncStoredData();
      refreshUiAfterStorageSync();
    });

    window.addEventListener('focus', () => {
      syncStoredData();
      refreshUiAfterStorageSync();
    });
  }

  function syncStoredData() {
    sitePhrases = loadSitePhrases();
    history = loadHistory();
    pinned = loadPinned();
    inputMode = loadInputMode();
    suppressNativeAutocomplete = loadSuppressNativeAutocomplete();
    disabledSites = loadDisabledSites();
    historyLimitPerSite = loadHistoryLimitPerSite();
    hiddenManagerButtonSites = loadHiddenManagerButtonSites();
    siteScopes = loadSiteScopes();
    managerButtonPosition = loadManagerButtonPosition();
    applyManagerButtonPosition();
    updateManagerButtonVisibility();
  }

  function refreshUiAfterStorageSync() {
    const managerOpen = !manager.hidden;
    if (managerOpen) {
      hidePopup();
    }

    if (isSiteDisabled()) {
      hidePopup();
      if (activeInput) restoreEntryAttributes(activeInput);
    } else if (!managerOpen && activeInput && isAutocompleteTarget(activeInput)) {
      applyNativeAutocompleteSuppression(activeInput);
      updatePopup();
    } else if (!managerOpen && activeInput) {
      restoreEntryAttributes(activeInput);
      activeInput = null;
      hidePopup();
    }

    const focusedInManager = uiRoot.activeElement && manager.contains(uiRoot.activeElement);
    if (!manager.hidden && !focusedInManager && !isManagerSearchComposing) {
      if (managerView === 'migration') {
        renderMigration();
      } else {
        renderManagerPreservingScroll();
      }
    }
  }

  function editPhrases() {
    syncStoredData();
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
    syncStoredData();
    if (!confirmClearAllSiteCandidates()) return;
    clearAllSiteCandidates();
    managerCandidateQuery = '';
    updatePopup();
  }

  function clearAllSiteCandidates() {
    saveCurrentSitePhrases([]);
    saveCurrentSitePinned([]);
    clearCurrentSiteHistory();
  }

  function clearSiteHistory() {
    if (!confirmClearSiteHistory()) return;
    syncStoredData();
    mergeCurrentSitePhrases(getCurrentSiteCandidates().map((candidate) => candidate.value));
    clearCurrentSiteHistory();
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
    inputMode = loadInputMode();
    inputMode = inputMode === 'setter' ? 'typing' : 'setter';
    writeValue(INPUT_MODE_KEY, inputMode);
    window.alert(`入力モードを「${inputModeLabel()}」にしました。`);
  }

  function toggleSiteEnabled() {
    syncStoredData();
    setSiteDisabled(!isSiteDisabled());
    window.alert(`${siteKey} での機能を「${isSiteDisabled() ? '無効' : '有効'}」にしました。`);
  }

  function toggleManagerButtonForSite() {
    syncStoredData();
    setManagerButtonHiddenForSite(!isManagerButtonHiddenForSite());
    window.alert(`${siteKey} の設定ボタンを「${isManagerButtonHiddenForSite() ? '非表示' : '表示'}」にしました。非表示でも Ctrl + . またはTampermonkeyメニューから設定画面を開けます。`);
  }

  function setSiteDisabled(disabled) {
    disabledSites = loadDisabledSites();
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
    updateManagerButtonVisibility();
  }

  function setManagerButtonHiddenForSite(hidden) {
    hiddenManagerButtonSites = loadHiddenManagerButtonSites();
    if (hidden) {
      hiddenManagerButtonSites = [...new Set(hiddenManagerButtonSites.concat(siteKey))];
    } else {
      hiddenManagerButtonSites = hiddenManagerButtonSites.filter((item) => item !== siteKey);
    }
    saveHiddenManagerButtonSites();
    updateManagerButtonVisibility();
  }

  function toggleSuppressNativeAutocomplete() {
    suppressNativeAutocomplete = loadSuppressNativeAutocomplete();
    suppressNativeAutocomplete = !suppressNativeAutocomplete;
    writeValue(SUPPRESS_NATIVE_KEY, suppressNativeAutocomplete);
    window.alert(`Chrome候補抑制を「${suppressNativeAutocomplete ? '有効' : '無効'}」にしました。`);
  }

  function inputModeLabel() {
    return inputMode === 'typing' ? 'キーボード入力風' : '標準';
  }

  // --- 入力欄・候補検索の基本処理 ------------------------------------------
  function uniqueNonEmpty(items) {
    const result = [];
    const seen = new Set();
    (Array.isArray(items) ? items : []).forEach((item) => {
      const value = String(item || '').trim();
      if (!value) return;
      const key = normalize(value);
      if (seen.has(key)) return;
      seen.add(key);
      result.push(value);
    });
    return result;
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

  function isAutocompleteTarget(element) {
    if (!isTextEntry(element)) return false;
    if (isFloatingPropertySearchInput(element)) return true;
    return isPageAllowed() && isFieldAllowed(element);
  }

  function isPageAllowed() {
    const rules = getCurrentSiteScope().enabledPaths;
    if (!rules.length) return true;
    const currentPath = getCurrentPagePath();
    return rules.some((rule) => {
      if (rule.type === 'prefix') return currentPath.startsWith(rule.value);
      return currentPath === rule.value;
    });
  }

  function isFieldAllowed(element) {
    const fields = getCurrentSiteScope().fieldSelectors;
    if (!fields.length) return true;
    if (isFloatingPropertySearchInput(element)) return true;
    return fields.some((field) => matchesFieldSelector(element, field.selector));
  }

  function isFloatingPropertySearchInput(element) {
    return Boolean(
      element instanceof HTMLInputElement &&
      element.classList.contains('fps-floating-input') &&
      element.closest('#fps-floating-form')
    );
  }

  function matchesFieldSelector(element, selector) {
    try {
      return Boolean(element && typeof element.matches === 'function' && element.matches(selector));
    } catch (_) {
      return false;
    }
  }

  function isValidSelector(selector) {
    try {
      document.querySelector(selector);
      return true;
    } catch (_) {
      return false;
    }
  }

  function updatePopup() {
    if (!activeInput || !isAutocompleteTarget(activeInput)) {
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
    const compactIndex = searchable.indexOf(query.compact);
    const tokenPositions = query.tokens.map((token) => searchable.indexOf(token));
    const firstTokenPosition = tokenPositions[0] ?? -1;
    let score = 0;

    if (searchable === query.compact) {
      score += 0;
    } else if (searchable.startsWith(query.compact)) {
      score += 20;
    } else if (compactIndex >= 0) {
      score += 60 + compactIndex;
    } else if (firstTokenPosition === 0) {
      score += 95;
    } else if (tokenPositions.some((position) => position === 0)) {
      score += 125;
    } else {
      score += 170;
    }

    if (query.tokens.length > 1) {
      score += tokenOrderPenalty(query.tokens, tokenPositions, searchable.length);
    }

    score += Math.min(80, Math.max(0, searchable.length - query.compact.length) * 2);
    score += Math.min(40, firstTokenPosition > 0 ? firstTokenPosition : 0);
    return score;
  }

  function tokenOrderPenalty(tokens, positions, fallbackLength) {
    if (!tokens.length) return 0;
    if (positions.some((position) => position < 0)) return 500;

    const ordered = positions.every((position, index) => index === 0 || position >= positions[index - 1]);
    const start = Math.min(...positions);
    const end = Math.max(...positions.map((position, index) => position + tokens[index].length));
    const tokenLength = tokens.reduce((sum, token) => sum + token.length, 0);
    const gap = Math.max(0, end - start - tokenLength);

    return (ordered ? 0 : 120) +
      Math.min(90, gap * 3) +
      Math.min(40, start || fallbackLength);
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

  // 検索専用の正規化。全角半角、空白、ハイフン、ひらがな/カタカナなどの表記ゆれを吸収する。
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

  // Chrome標準オートコンプリートが被りにくいよう、フォーカス中だけ属性を書き換える。
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

  // --- 候補ポップアップ -----------------------------------------------------
  // 入力欄の下に候補を表示し、選択・ピン止め・コピー・入力クリアを処理する。
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
    removeCurrentSitePhrases([value]);
    removeCurrentSitePinned([value]);
    deleteHistoryValue(value);
  }

  function deleteHistoryValue(value) {
    updateCurrentSiteHistory((siteHistory) => {
      const key = Object.keys(siteHistory).find((item) => normalize(item) === normalize(value));
      if (key) delete siteHistory[key];
      return siteHistory;
    });
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

  function startManagerButtonDrag(event) {
    if (event.button !== undefined && event.button !== 0) return;

    const rect = managerButton.getBoundingClientRect();
    managerButtonDrag = {
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      wasDragged: false,
    };

    managerButton.setPointerCapture(event.pointerId);
    managerButton.addEventListener('pointermove', moveManagerButtonDrag);
    managerButton.addEventListener('pointerup', finishManagerButtonDrag);
    managerButton.addEventListener('pointercancel', finishManagerButtonDrag);
  }

  function moveManagerButtonDrag(event) {
    if (!managerButtonDrag || event.pointerId !== managerButtonDrag.pointerId) return;

    const distance = Math.hypot(
      event.clientX - managerButtonDrag.startClientX,
      event.clientY - managerButtonDrag.startClientY
    );
    if (distance > 4) managerButtonDrag.wasDragged = true;
    if (!managerButtonDrag.wasDragged) return;

    event.preventDefault();
    setManagerButtonPosition(event.clientX - managerButtonDrag.offsetX, event.clientY - managerButtonDrag.offsetY);
  }

  function finishManagerButtonDrag(event) {
    if (!managerButtonDrag || event.pointerId !== managerButtonDrag.pointerId) return;

    managerButton.releasePointerCapture(event.pointerId);
    managerButton.removeEventListener('pointermove', moveManagerButtonDrag);
    managerButton.removeEventListener('pointerup', finishManagerButtonDrag);
    managerButton.removeEventListener('pointercancel', finishManagerButtonDrag);

    if (managerButtonDrag.wasDragged) {
      const rect = managerButton.getBoundingClientRect();
      saveManagerButtonPosition({ left: Math.round(rect.left), top: Math.round(rect.top) });
    }
  }

  function applyManagerButtonPosition() {
    if (!managerButtonPosition) return;
    setManagerButtonPosition(managerButtonPosition.left, managerButtonPosition.top);
  }

  function updateManagerButtonVisibility() {
    managerButton.hidden = isSiteDisabled() || isManagerButtonHiddenForSite();
  }

  function isSettingsShortcut(event) {
    return event.ctrlKey && !event.altKey && !event.metaKey && !event.shiftKey && event.key === '.';
  }

  function setManagerButtonPosition(left, top) {
    const rect = managerButton.getBoundingClientRect();
    const gap = 8;
    const maxLeft = Math.max(gap, window.innerWidth - rect.width - gap);
    const maxTop = Math.max(gap, window.innerHeight - rect.height - gap);
    const nextLeft = Math.min(Math.max(gap, Number(left) || gap), maxLeft);
    const nextTop = Math.min(Math.max(gap, Number(top) || gap), maxTop);

    managerButton.style.left = `${nextLeft}px`;
    managerButton.style.top = `${nextTop}px`;
    managerButton.style.right = 'auto';
    managerButton.style.bottom = 'auto';
  }

  // --- 設定画面 -------------------------------------------------------------
  // 右下の「設定」ボタンから開く管理画面。候補追加、CSV入出力、検索、ピン止め、削除を行う。
  function openManager() {
    hidePopup();
    syncStoredData();
    managerView = 'settings';
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
    title.textContent = `サイト別入力候補オートコンプリート ver${SCRIPT_VERSION}`;

    const headActions = document.createElement('div');
    headActions.className = 'mac-manager-row';

    const migrationButton = document.createElement('button');
    migrationButton.type = 'button';
    migrationButton.textContent = '移行';
    migrationButton.addEventListener('click', openMigration);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', closeManager);

    headActions.appendChild(migrationButton);
    headActions.appendChild(closeButton);
    head.appendChild(title);
    head.appendChild(headActions);

    const body = document.createElement('div');
    body.className = 'mac-manager-body';

    body.appendChild(createSiteEnabledSection());
    body.appendChild(createManagerButtonSection());
    body.appendChild(createScopeSection());
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

  function openMigration() {
    hidePopup();
    syncStoredData();
    managerView = 'migration';
    migrationSiteQuery = '';
    migrationSelectedSites = getMigrationSiteKeys();
    migrationMessage = '';
    renderMigration();
    manager.hidden = false;
  }

  function renderMigration() {
    manager.textContent = '';

    const panel = document.createElement('div');
    panel.className = 'mac-manager-panel';
    panel.addEventListener('mousedown', (event) => event.stopPropagation());

    const head = document.createElement('div');
    head.className = 'mac-manager-head';

    const title = document.createElement('h2');
    title.textContent = '移行';

    const headActions = document.createElement('div');
    headActions.className = 'mac-manager-row';

    const backButton = document.createElement('button');
    backButton.type = 'button';
    backButton.textContent = '設定へ戻る';
    backButton.addEventListener('click', openManager);

    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.textContent = '閉じる';
    closeButton.addEventListener('click', closeManager);

    headActions.appendChild(backButton);
    headActions.appendChild(closeButton);
    head.appendChild(title);
    head.appendChild(headActions);

    const body = document.createElement('div');
    body.className = 'mac-manager-body mac-migration-body';
    body.appendChild(createMigrationExportSection());
    body.appendChild(createMigrationImportSection());

    if (migrationMessage) {
      const status = document.createElement('div');
      status.className = 'mac-status';
      status.textContent = migrationMessage;
      body.appendChild(status);
    }

    panel.appendChild(head);
    panel.appendChild(body);
    manager.appendChild(panel);

    manager.addEventListener('mousedown', closeManager, { once: true });
  }

  function createMigrationExportSection() {
    const section = document.createElement('section');
    section.className = 'mac-migration-section';
    const heading = document.createElement('h3');
    heading.textContent = 'JSONエクスポート';

    const note = document.createElement('div');
    note.className = 'mac-empty';
    note.textContent = '候補名は常に含めます。社内共有では、個人の利用傾向が入る使用履歴は必要な場合だけ含めてください。';

    const optionBox = document.createElement('div');
    optionBox.className = 'mac-check-options';
    optionBox.appendChild(createMigrationOption('ピン止めを含める', migrationIncludePinned, (checked) => {
      migrationIncludePinned = checked;
    }));
    optionBox.appendChild(createMigrationOption('使用履歴を含める', migrationIncludeHistory, (checked) => {
      migrationIncludeHistory = checked;
    }));
    optionBox.appendChild(createMigrationOption('基本設定を含める', migrationIncludeSettings, (checked) => {
      migrationIncludeSettings = checked;
    }));

    const actions = document.createElement('div');
    actions.className = 'mac-manager-row mac-migration-actions';

    const selectAllButton = document.createElement('button');
    selectAllButton.type = 'button';
    selectAllButton.textContent = '全選択';
    selectAllButton.addEventListener('click', () => {
      migrationSelectedSites = getMigrationSiteKeys();
      renderMigration();
    });

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.textContent = '全解除';
    clearButton.addEventListener('click', () => {
      migrationSelectedSites = [];
      renderMigration();
    });

    const currentButton = document.createElement('button');
    currentButton.type = 'button';
    currentButton.textContent = '現在サイトのみ';
    currentButton.addEventListener('click', () => {
      migrationSelectedSites = [siteKey];
      renderMigration();
    });

    actions.appendChild(selectAllButton);
    actions.appendChild(clearButton);
    actions.appendChild(currentButton);

    const searchRow = document.createElement('div');
    searchRow.className = 'mac-manager-row mac-migration-search';

    const searchInput = document.createElement('input');
    searchInput.type = 'search';
    searchInput.placeholder = 'サイトを検索';
    searchInput.value = migrationSiteQuery;
    searchInput.setAttribute('aria-label', '移行するサイトを検索');
    searchInput.addEventListener('input', () => {
      migrationSiteQuery = searchInput.value;
      renderMigration();
    });
    searchRow.appendChild(searchInput);

    const allSites = getMigrationSiteKeys();
    const query = normalize(migrationSiteQuery);
    const visibleSites = query
      ? allSites.filter((site) => normalize(site).includes(query))
      : allSites;

    const countLine = document.createElement('div');
    countLine.className = 'mac-empty';
    countLine.textContent = `選択中 ${getSelectedMigrationSites().length.toLocaleString('ja-JP')}サイト / 全 ${allSites.length.toLocaleString('ja-JP')}サイト`;

    const exportPreview = createMigrationPreview('エクスポート内容プレビュー', buildExportPreviewLines());

    const list = document.createElement('div');
    list.className = 'mac-check-list';

    if (!visibleSites.length) {
      list.appendChild(emptyLine('一致するサイトはありません。'));
    } else {
      visibleSites.forEach((site) => {
        list.appendChild(createMigrationSiteItem(site));
      });
    }

    const exportRow = document.createElement('div');
    exportRow.className = 'mac-manager-row mac-migration-actions';

    const exportButton = document.createElement('button');
    exportButton.type = 'button';
    exportButton.className = 'mac-primary';
    exportButton.textContent = 'JSONエクスポート';
    exportButton.disabled = !getSelectedMigrationSites().length;
    exportButton.addEventListener('click', exportMigrationJson);
    exportRow.appendChild(exportButton);

    section.appendChild(heading);
    section.appendChild(note);
    section.appendChild(optionBox);
    section.appendChild(actions);
    section.appendChild(searchRow);
    section.appendChild(countLine);
    section.appendChild(exportPreview);
    section.appendChild(list);
    section.appendChild(exportRow);
    return section;
  }

  function createMigrationImportSection() {
    const section = document.createElement('section');
    section.className = 'mac-migration-section';
    const heading = document.createElement('h3');
    heading.textContent = 'JSONインポート';

    const note = document.createElement('div');
    note.className = 'mac-empty';
    note.textContent = '既存データは消さずにマージします。使用回数は大きい方、最終使用日は新しい方を残します。';

    const optionBox = document.createElement('div');
    optionBox.className = 'mac-check-options';
    optionBox.appendChild(createMigrationOption('ピン止めを取り込む', migrationImportIncludePinned, (checked) => {
      migrationImportIncludePinned = checked;
    }));
    optionBox.appendChild(createMigrationOption('使用履歴を取り込む', migrationImportIncludeHistory, (checked) => {
      migrationImportIncludeHistory = checked;
    }));
    optionBox.appendChild(createMigrationOption('基本設定を取り込む', migrationImportIncludeSettings, (checked) => {
      migrationImportIncludeSettings = checked;
    }));

    const row = document.createElement('div');
    row.className = 'mac-manager-row mac-migration-actions';

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,application/json';
    input.hidden = true;
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      if (!file) return;
      importMigrationJson(file);
      input.value = '';
    });

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mac-primary';
    button.textContent = 'JSONインポート';
    button.addEventListener('click', () => input.click());

    row.appendChild(button);
    section.appendChild(heading);
    section.appendChild(note);
    section.appendChild(optionBox);
    section.appendChild(row);
    if (migrationPendingImport) {
      section.appendChild(createMigrationPreview('インポート内容確認', migrationPendingImport.summary.lines));

      const confirmRow = document.createElement('div');
      confirmRow.className = 'mac-manager-row mac-migration-actions';

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'mac-primary';
      confirmButton.textContent = 'この内容をインポート';
      confirmButton.addEventListener('click', applyPendingMigrationImport);

      const cancelButton = document.createElement('button');
      cancelButton.type = 'button';
      cancelButton.textContent = 'キャンセル';
      cancelButton.addEventListener('click', () => {
        migrationPendingImport = null;
        migrationMessage = 'JSONインポートをキャンセルしました。';
        renderMigration();
      });

      confirmRow.appendChild(confirmButton);
      confirmRow.appendChild(cancelButton);
      section.appendChild(confirmRow);
    }
    section.appendChild(input);
    return section;
  }

  function createMigrationPreview(title, lines) {
    const box = document.createElement('div');
    box.className = 'mac-preview';

    const head = document.createElement('div');
    head.className = 'mac-preview-title';
    head.textContent = title;
    box.appendChild(head);

    lines.forEach((line) => {
      const item = document.createElement('div');
      item.className = 'mac-preview-line';
      item.textContent = line;
      box.appendChild(item);
    });

    return box;
  }

  function createMigrationOption(text, checked, onChange) {
    const label = document.createElement('label');
    label.className = 'mac-check-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = checked;
    input.addEventListener('change', () => {
      onChange(input.checked);
      if (migrationPendingImport) {
        migrationPendingImport.summary = buildImportPreview(migrationPendingImport.payload);
      }
      renderMigration();
    });

    const span = document.createElement('span');
    span.className = 'mac-check-text';
    span.textContent = text;

    label.appendChild(input);
    label.appendChild(span);
    return label;
  }

  function createMigrationSiteItem(site) {
    const label = document.createElement('label');
    label.className = 'mac-check-item';

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.checked = migrationSelectedSites.includes(site);
    input.addEventListener('change', () => {
      if (input.checked) {
        migrationSelectedSites = uniqueNonEmpty(migrationSelectedSites.concat(site));
      } else {
        migrationSelectedSites = migrationSelectedSites.filter((item) => item !== site);
      }
      renderMigration();
    });

    const summary = getMigrationSiteSummary(site);
    const text = document.createElement('span');
    text.className = 'mac-check-text';
    text.textContent = `${site} / 候補 ${summary.candidates.toLocaleString('ja-JP')}件 / ピン ${summary.pinned.toLocaleString('ja-JP')}件 / 履歴 ${summary.history.toLocaleString('ja-JP')}件 / 表示条件 ${summary.scopes.toLocaleString('ja-JP')}件`;

    label.appendChild(input);
    label.appendChild(text);
    return label;
  }

  function getMigrationSiteKeys() {
    const keys = new Set([
      ...Object.keys(sitePhrases || {}),
      ...Object.keys(history || {}),
      ...Object.keys(pinned || {}),
      ...Object.keys(siteScopes || {}),
      ...disabledSites,
      ...hiddenManagerButtonSites,
    ]);
    keys.add(siteKey);
    return [...keys].filter(Boolean).sort((a, b) => a.localeCompare(b, 'ja'));
  }

  function getSelectedMigrationSites() {
    const validSites = new Set(getMigrationSiteKeys());
    return uniqueNonEmpty(migrationSelectedSites).filter((site) => validSites.has(site));
  }

  function getMigrationSiteSummary(site) {
    const scope = getSiteScope(site);
    return {
      candidates: getSitePhrases(site).length,
      pinned: getSitePinned(site).length,
      history: Object.keys(getSiteHistory(site)).length,
      scopes: countSiteScopeRules(scope),
    };
  }

  function getSitePhrases(site) {
    const current = sitePhrases && sitePhrases[site];
    return Array.isArray(current) ? uniqueNonEmpty(current) : [];
  }

  function getSitePinned(site) {
    const current = pinned && pinned[site];
    return Array.isArray(current) ? uniqueNonEmpty(current) : [];
  }

  function getSiteHistory(site) {
    const current = history && history[site];
    return current && typeof current === 'object' && !Array.isArray(current) ? current : {};
  }

  function getSiteScope(site) {
    return sanitizeSiteScope(siteScopes && siteScopes[site]);
  }

  function countSiteScopeRules(scope) {
    const cleanScope = sanitizeSiteScope(scope);
    return cleanScope.enabledPaths.length + cleanScope.fieldSelectors.length;
  }

  function buildExportPreviewLines() {
    const selectedSites = getSelectedMigrationSites();
    const summary = selectedSites.reduce((total, site) => {
      const historyEntries = migrationIncludeHistory ? sanitizeHistoryMap(getSiteHistory(site)) : {};
      const candidates = uniqueNonEmpty([
        ...getSitePhrases(site),
        ...(migrationIncludePinned ? getSitePinned(site) : []),
        ...Object.keys(historyEntries),
      ]);
      total.candidates += candidates.length;
      total.pinned += migrationIncludePinned ? getSitePinned(site).length : 0;
      total.history += Object.keys(historyEntries).length;
      total.scopes += migrationIncludeSettings ? countSiteScopeRules(getSiteScope(site)) : 0;
      return total;
    }, { candidates: 0, pinned: 0, history: 0, scopes: 0 });

    return [
      `対象サイト: ${selectedSites.length.toLocaleString('ja-JP')}件`,
      `候補名: ${summary.candidates.toLocaleString('ja-JP')}件`,
      `ピン止め: ${migrationIncludePinned ? `${summary.pinned.toLocaleString('ja-JP')}件を含める` : '含めない'}`,
      `使用履歴: ${migrationIncludeHistory ? `${summary.history.toLocaleString('ja-JP')}件を含める` : '含めない'}`,
      `表示条件: ${migrationIncludeSettings ? `${summary.scopes.toLocaleString('ja-JP')}件を含める` : '含めない'}`,
      `基本設定: ${migrationIncludeSettings ? '含める' : '含めない'}`,
      `出力サイト: ${formatSiteList(selectedSites)}`,
    ];
  }

  function buildImportPreview(payload) {
    if (!payload || payload.schema !== MIGRATION_SCHEMA || !payload.sites || typeof payload.sites !== 'object' || Array.isArray(payload.sites)) {
      throw new Error('このツール用のJSONではありません。');
    }

    const importedScopes = migrationImportIncludeSettings && payload.settings
      ? sanitizeSiteScopesMap(payload.settings.siteScopes)
      : {};
    const targetSites = uniqueNonEmpty([
      ...Object.keys(payload.sites),
      ...Object.keys(importedScopes),
    ]);

    const siteEntries = targetSites.map((site) => {
      const rawSiteData = payload.sites[site];
      const cleanSite = String(site || '').trim();
      const siteData = rawSiteData && typeof rawSiteData === 'object' && !Array.isArray(rawSiteData)
        ? rawSiteData
        : {};

      const importedPinned = migrationImportIncludePinned ? uniqueNonEmpty(siteData.pinned || []) : [];
      const importedHistory = migrationImportIncludeHistory ? sanitizeHistoryMap(siteData.history || {}) : {};
      const importedCandidates = uniqueNonEmpty([
        ...(Array.isArray(siteData.candidates) ? siteData.candidates : []),
        ...(Array.isArray(siteData.phrases) ? siteData.phrases : []),
        ...importedPinned,
        ...Object.keys(importedHistory),
      ]);
      const importedScopeCount = countSiteScopeRules(importedScopes[cleanSite]);

      return {
        site: cleanSite,
        candidates: importedCandidates.length,
        pinned: importedPinned.length,
        history: Object.keys(importedHistory).length,
        scopes: importedScopeCount,
      };
    })
      .filter((entry) => entry.site && (entry.candidates || entry.pinned || entry.history || entry.scopes));

    const totals = siteEntries.reduce((sum, entry) => {
      sum.candidates += entry.candidates;
      sum.pinned += entry.pinned;
      sum.history += entry.history;
      sum.scopes += entry.scopes;
      return sum;
    }, { candidates: 0, pinned: 0, history: 0, scopes: 0 });

    return {
      siteEntries,
      lines: [
        `対象サイト: ${siteEntries.length.toLocaleString('ja-JP')}件`,
        `候補名: ${totals.candidates.toLocaleString('ja-JP')}件をマージ`,
        `ピン止め: ${migrationImportIncludePinned ? `${totals.pinned.toLocaleString('ja-JP')}件を取り込む` : '取り込まない'}`,
        `使用履歴: ${migrationImportIncludeHistory ? `${totals.history.toLocaleString('ja-JP')}件を取り込む` : '取り込まない'}`,
        `表示条件: ${migrationImportIncludeSettings && payload.settings ? `${totals.scopes.toLocaleString('ja-JP')}件を取り込む` : '取り込まない'}`,
        `基本設定: ${migrationImportIncludeSettings && payload.settings ? '取り込む' : '取り込まない'}`,
        `対象サイト: ${formatSiteList(siteEntries.map((entry) => entry.site))}`,
      ],
    };
  }

  function formatSiteList(sites) {
    if (!sites.length) return 'なし';
    const shown = sites.slice(0, 6).join('、');
    const rest = sites.length > 6 ? `、ほか${(sites.length - 6).toLocaleString('ja-JP')}件` : '';
    return `${shown}${rest}`;
  }

  function exportMigrationJson() {
    syncStoredData();
    const selectedSites = getSelectedMigrationSites();
    if (!selectedSites.length) {
      window.alert('エクスポートするサイトを選択してください。');
      return;
    }

    const payload = buildMigrationPayload(selectedSites);
    downloadJson(payload, `site-input-autocomplete-migration-${formatDateForFilename()}.json`);
    migrationMessage = `${selectedSites.length.toLocaleString('ja-JP')}サイト分をJSONエクスポートしました。`;
    renderMigration();
  }

  function buildMigrationPayload(selectedSites) {
    const sites = {};
    selectedSites.forEach((site) => {
      const phrases = getSitePhrases(site);
      const pinnedEntries = migrationIncludePinned ? getSitePinned(site) : [];
      const historyEntries = migrationIncludeHistory ? sanitizeHistoryMap(getSiteHistory(site)) : {};
      const candidates = uniqueNonEmpty([
        ...phrases,
        ...pinnedEntries,
        ...Object.keys(historyEntries),
      ]);

      sites[site] = { candidates };
      if (migrationIncludePinned) {
        sites[site].pinned = uniqueNonEmpty(pinnedEntries);
      }
      if (migrationIncludeHistory) {
        sites[site].history = historyEntries;
      }
    });

    const payload = {
      schema: MIGRATION_SCHEMA,
      version: MIGRATION_VERSION,
      exportedAt: new Date().toISOString(),
      sourceSite: siteKey,
      sites,
    };

    if (migrationIncludeSettings) {
      const selected = new Set(selectedSites);
      const selectedSiteScopes = {};
      selectedSites.forEach((site) => {
        const scope = getSiteScope(site);
        if (countSiteScopeRules(scope)) {
          selectedSiteScopes[site] = scope;
        }
      });
      payload.settings = {
        inputMode,
        suppressNativeAutocomplete,
        historyLimitPerSite,
        disabledSites: disabledSites.filter((site) => selected.has(site)),
        hiddenManagerButtonSites: hiddenManagerButtonSites.filter((site) => selected.has(site)),
      };
      if (Object.keys(selectedSiteScopes).length) {
        payload.settings.siteScopes = selectedSiteScopes;
      }
    }

    return payload;
  }

  function downloadJson(payload, filename) {
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.documentElement.appendChild(anchor);
    anchor.click();
    anchor.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importMigrationJson(file) {
    try {
      const text = await file.text();
      const payload = JSON.parse(text);
      const summary = buildImportPreview(payload);
      migrationPendingImport = { payload, summary };
      migrationMessage = 'JSONを読み込みました。内容を確認してからインポートしてください。';
      renderMigration();
    } catch (error) {
      migrationPendingImport = null;
      migrationMessage = `JSONインポートに失敗しました: ${error && error.message ? error.message : error}`;
      window.alert(migrationMessage);
      renderMigration();
    }
  }

  function applyPendingMigrationImport() {
    if (!migrationPendingImport) return;
    try {
      const result = applyMigrationPayload(migrationPendingImport.payload);
      migrationPendingImport = null;
      syncStoredData();
      migrationMessage = `JSONインポート完了: ${result.sites.toLocaleString('ja-JP')}サイト / 候補 ${result.candidates.toLocaleString('ja-JP')}件 / ピン ${result.pinned.toLocaleString('ja-JP')}件 / 履歴 ${result.history.toLocaleString('ja-JP')}件 / 表示条件 ${result.scopes.toLocaleString('ja-JP')}件`;
      window.alert(migrationMessage);
      hidePopup();
      renderMigration();
    } catch (error) {
      migrationMessage = `JSONインポートに失敗しました: ${error && error.message ? error.message : error}`;
      window.alert(migrationMessage);
      renderMigration();
    }
  }

  function applyMigrationPayload(payload) {
    if (!payload || payload.schema !== MIGRATION_SCHEMA || !payload.sites || typeof payload.sites !== 'object' || Array.isArray(payload.sites)) {
      throw new Error('このツール用のJSONではありません。');
    }

    const nextPhrases = loadSitePhrases();
    const nextPinned = loadPinned();
    const nextHistory = loadHistory();
    const result = { sites: 0, candidates: 0, pinned: 0, history: 0, scopes: 0 };
    const touchedSites = new Set();

    Object.entries(payload.sites).forEach(([site, rawSiteData]) => {
      const cleanSite = String(site || '').trim();
      if (!cleanSite || !rawSiteData || typeof rawSiteData !== 'object' || Array.isArray(rawSiteData)) return;

      const importedPinned = migrationImportIncludePinned ? uniqueNonEmpty(rawSiteData.pinned || []) : [];
      const importedHistory = migrationImportIncludeHistory ? sanitizeHistoryMap(rawSiteData.history || {}) : {};
      const importedCandidates = uniqueNonEmpty([
        ...(Array.isArray(rawSiteData.candidates) ? rawSiteData.candidates : []),
        ...(Array.isArray(rawSiteData.phrases) ? rawSiteData.phrases : []),
        ...importedPinned,
        ...Object.keys(importedHistory),
      ]);

      if (!importedCandidates.length && !importedPinned.length && !Object.keys(importedHistory).length) return;
      touchedSites.add(cleanSite);

      const currentPhrases = Array.isArray(nextPhrases[cleanSite]) ? uniqueNonEmpty(nextPhrases[cleanSite]) : [];
      const mergedPhrases = uniqueNonEmpty(currentPhrases.concat(importedCandidates));
      nextPhrases[cleanSite] = mergedPhrases;
      result.candidates += Math.max(0, mergedPhrases.length - currentPhrases.length);

      if (migrationImportIncludePinned && importedPinned.length) {
        const currentPinned = Array.isArray(nextPinned[cleanSite]) ? uniqueNonEmpty(nextPinned[cleanSite]) : [];
        const mergedPinned = uniqueNonEmpty(currentPinned.concat(importedPinned));
        nextPinned[cleanSite] = mergedPinned;
        result.pinned += Math.max(0, mergedPinned.length - currentPinned.length);
      }

      if (migrationImportIncludeHistory && Object.keys(importedHistory).length) {
        const currentHistory = nextHistory[cleanSite] && typeof nextHistory[cleanSite] === 'object' && !Array.isArray(nextHistory[cleanSite])
          ? { ...nextHistory[cleanSite] }
          : {};
        Object.entries(importedHistory).forEach(([value, stat]) => {
          const existingKey = Object.keys(currentHistory).find((key) => normalize(key) === normalize(value));
          const key = existingKey || value;
          const current = currentHistory[key] || { count: 0, lastUsed: 0 };
          currentHistory[key] = {
            count: Math.max(Number(current.count) || 0, Number(stat.count) || 0),
            lastUsed: Math.max(Number(current.lastUsed) || 0, Number(stat.lastUsed) || 0),
          };
        });
        nextHistory[cleanSite] = trimHistory(currentHistory);
        result.history += Object.keys(importedHistory).length;
      }
    });

    sitePhrases = nextPhrases;
    pinned = nextPinned;
    history = nextHistory;
    writeValue(SITE_PHRASES_KEY, sitePhrases);
    writeValue(PINNED_KEY, pinned);
    writeValue(HISTORY_KEY, history);

    if (migrationImportIncludeSettings && payload.settings && typeof payload.settings === 'object') {
      const settingsResult = applyMigrationSettings(payload.settings);
      settingsResult.sites.forEach((site) => touchedSites.add(site));
      result.scopes += settingsResult.scopes;
    }

    result.sites = touchedSites.size;
    return result;
  }

  function applyMigrationSettings(settings) {
    const result = { sites: [], scopes: 0 };
    if (settings.inputMode === 'setter' || settings.inputMode === 'typing') {
      inputMode = settings.inputMode;
      writeValue(INPUT_MODE_KEY, inputMode);
    }
    if (typeof settings.suppressNativeAutocomplete === 'boolean') {
      suppressNativeAutocomplete = settings.suppressNativeAutocomplete;
      writeValue(SUPPRESS_NATIVE_KEY, suppressNativeAutocomplete);
    }
    if (HISTORY_LIMIT_OPTIONS.includes(Number(settings.historyLimitPerSite))) {
      historyLimitPerSite = Number(settings.historyLimitPerSite);
      writeValue(HISTORY_LIMIT_KEY, historyLimitPerSite);
    }
    if (Array.isArray(settings.disabledSites)) {
      disabledSites = uniqueNonEmpty(loadDisabledSites().concat(settings.disabledSites));
      writeValue(DISABLED_SITES_KEY, disabledSites);
    }
    if (Array.isArray(settings.hiddenManagerButtonSites)) {
      hiddenManagerButtonSites = uniqueNonEmpty(loadHiddenManagerButtonSites().concat(settings.hiddenManagerButtonSites));
      writeValue(HIDDEN_MANAGER_BUTTON_SITES_KEY, hiddenManagerButtonSites);
    }
    const importedScopes = sanitizeSiteScopesMap(settings.siteScopes);
    if (Object.keys(importedScopes).length) {
      const merged = mergeSiteScopes(loadSiteScopes(), importedScopes);
      siteScopes = merged.scopes;
      result.scopes = merged.addedRules;
      result.sites = Object.keys(importedScopes);
      writeValue(SITE_SCOPES_KEY, siteScopes);
    }
    return result;
  }

  function sanitizeSiteScopesMap(rawScopes) {
    const result = {};
    if (!rawScopes || typeof rawScopes !== 'object' || Array.isArray(rawScopes)) return result;

    Object.entries(rawScopes).forEach(([site, scope]) => {
      const cleanSite = String(site || '').trim();
      if (!cleanSite) return;
      const cleanScope = sanitizeSiteScope(scope);
      if (countSiteScopeRules(cleanScope)) {
        result[cleanSite] = cleanScope;
      }
    });

    return result;
  }

  function mergeSiteScopes(currentScopes, importedScopes) {
    const nextScopes = sanitizeSiteScopesMap(currentScopes);
    let addedRules = 0;

    Object.entries(importedScopes).forEach(([site, scope]) => {
      const current = sanitizeSiteScope(nextScopes[site]);
      const before = countSiteScopeRules(current);
      const merged = sanitizeSiteScope({
        enabledPaths: current.enabledPaths.concat(scope.enabledPaths),
        fieldSelectors: current.fieldSelectors.concat(scope.fieldSelectors),
      });

      if (countSiteScopeRules(merged)) {
        nextScopes[site] = merged;
      } else {
        delete nextScopes[site];
      }
      addedRules += Math.max(0, countSiteScopeRules(merged) - before);
    });

    return { scopes: nextScopes, addedRules };
  }

  function sanitizeHistoryMap(rawHistory) {
    const result = {};
    if (!rawHistory || typeof rawHistory !== 'object' || Array.isArray(rawHistory)) return result;

    Object.entries(rawHistory).forEach(([value, stat]) => {
      const name = String(value || '').trim();
      if (!name || !stat || typeof stat !== 'object') return;
      const count = Math.max(0, Math.floor(Number(stat.count) || 0));
      const lastUsed = parseMigrationTime(stat.lastUsed);
      if (!count && !lastUsed) return;
      result[name] = { count, lastUsed };
    });

    return result;
  }

  function parseMigrationTime(value) {
    const number = Number(value);
    if (Number.isFinite(number) && number > 0) return number;
    const parsed = Date.parse(String(value || ''));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  function formatDateForFilename() {
    return new Date().toISOString().slice(0, 10).replaceAll('-', '');
  }

  function getCurrentPagePath() {
    const path = location.pathname || '/';
    const hash = location.hash || '';
    if (hash.startsWith('#/') || hash.startsWith('#!')) {
      return `${path}${hash}`;
    }
    return path;
  }

  function getCurrentDirectoryPath() {
    const path = getCurrentPagePath();
    if (!path || path === '/' || path.endsWith('/')) return path || '/';
    const index = path.lastIndexOf('/');
    return index <= 0 ? `${path}/` : path.slice(0, index + 1);
  }

  function normalizePagePath(value) {
    let text = String(value || '').trim();
    if (!text) return '';

    if (/^https?:\/\//i.test(text)) {
      try {
        const url = new URL(text);
        text = `${url.pathname || '/'}${url.hash && (url.hash.startsWith('#/') || url.hash.startsWith('#!')) ? url.hash : ''}`;
      } catch (_) {
        return '';
      }
    }

    if (text.startsWith('#/') || text.startsWith('#!')) {
      text = `/${text}`;
    } else if (!text.startsWith('/')) {
      text = `/${text}`;
    }

    return text;
  }

  function addCurrentPathRule(type, value) {
    const scope = getCurrentSiteScope();
    const rule = sanitizePathRule({ type, value });
    if (!rule) return;

    const exists = scope.enabledPaths.some((item) => item.type === rule.type && item.value === rule.value);
    if (!exists) {
      writeCurrentSiteScope({
        ...scope,
        enabledPaths: scope.enabledPaths.concat(rule),
      });
    }
    siteScopeMessage = exists ? 'このページ条件はすでに追加済みです。' : 'ページ条件を追加しました。';
    renderManager();
  }

  function canUseLastFocusedTextEntry() {
    return Boolean(lastFocusedTextEntry && document.documentElement.contains(lastFocusedTextEntry) && isTextEntry(lastFocusedTextEntry));
  }

  function addFieldSelectorForElement(element) {
    if (!element || !isTextEntry(element)) {
      siteScopeMessage = '追加できる入力欄が見つかりませんでした。先に対象の入力欄をクリックしてください。';
      renderManager();
      return;
    }
    addFieldSelector(buildFieldSelectorForElement(element));
  }

  function addFieldSelector(field) {
    const scope = getCurrentSiteScope();
    const cleanField = sanitizeFieldSelector(field);
    if (!cleanField) {
      siteScopeMessage = '入力欄条件を追加できませんでした。';
      renderManager();
      return;
    }

    const exists = scope.fieldSelectors.some((item) => item.selector === cleanField.selector);
    if (!exists) {
      writeCurrentSiteScope({
        ...scope,
        fieldSelectors: scope.fieldSelectors.concat(cleanField),
      });
    }
    siteScopeMessage = exists ? 'この入力欄条件はすでに追加済みです。' : '入力欄条件を追加しました。';
    renderManagerPreservingScroll();
  }

  function collectPageTextEntries() {
    const entries = Array.from(document.querySelectorAll('input, textarea, [contenteditable]'))
      .filter((element) => isTextEntry(element));
    const visibleEntries = entries.filter(isVisibleTextEntry);
    return (visibleEntries.length ? visibleEntries : entries).slice(0, 30);
  }

  function isVisibleTextEntry(element) {
    const rect = element.getBoundingClientRect();
    if (!rect.width && !rect.height) return false;
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && style.visibility !== 'hidden';
  }

  function buildFieldSelectorForElement(element) {
    const label = getFieldLabel(element);
    const candidates = buildFieldSelectorCandidates(element);
    const selector = candidates.find((candidate) => selectorMatchesSingleTextEntry(candidate, element)) ||
      candidates.find((candidate) => matchesFieldSelector(element, candidate)) ||
      buildElementPathSelector(element);

    return {
      selector,
      label,
      source: 'auto',
    };
  }

  function buildFieldSelectorCandidates(element) {
    const base = getElementBaseSelector(element);
    const candidates = [];
    if (isFloatingPropertySearchInput(element)) {
      candidates.push('#fps-floating-form .fps-floating-input');
      candidates.push('input.fps-floating-input');
    }
    const attrNames = ['id', 'name', 'aria-label', 'placeholder', 'title'];

    attrNames.forEach((attr) => {
      const value = element.getAttribute(attr);
      if (!value) return;
      candidates.push(`${base}[${attr}="${escapeCssString(value)}"]`);
      candidates.push(`[${attr}="${escapeCssString(value)}"]`);
    });

    if (element instanceof HTMLInputElement && element.getAttribute('type')) {
      const typeBase = `input[type="${escapeCssString(element.getAttribute('type'))}"]`;
      ['name', 'placeholder', 'aria-label'].forEach((attr) => {
        const value = element.getAttribute(attr);
        if (value) candidates.push(`${typeBase}[${attr}="${escapeCssString(value)}"]`);
      });
    }

    if (element instanceof HTMLElement && element.hasAttribute('contenteditable')) {
      candidates.push(`${element.tagName.toLowerCase()}[contenteditable]`);
    }

    return uniqueStrings(candidates).filter(isValidSelector);
  }

  function getElementBaseSelector(element) {
    if (element instanceof HTMLInputElement) return 'input';
    if (element instanceof HTMLTextAreaElement) return 'textarea';
    if (element instanceof HTMLElement) return element.tagName.toLowerCase();
    return '*';
  }

  function selectorMatchesSingleTextEntry(selector, element) {
    return matchesFieldSelector(element, selector) && selectorTextEntryCount(selector) === 1;
  }

  function selectorTextEntryCount(selector) {
    try {
      return Array.from(document.querySelectorAll(selector)).filter((element) => isTextEntry(element)).length;
    } catch (_) {
      return 0;
    }
  }

  function getFieldLabel(element) {
    if (isFloatingPropertySearchInput(element)) return 'フローティング検索フォーム';
    const labelText = getAssociatedLabelText(element);
    const candidates = [
      element.getAttribute('aria-label'),
      element.getAttribute('placeholder'),
      labelText,
      element.getAttribute('name'),
      element.getAttribute('id'),
      element.getAttribute('title'),
    ].map((item) => String(item || '').trim()).filter(Boolean);

    if (candidates.length) return candidates[0];
    if (element instanceof HTMLTextAreaElement) return 'テキストエリア';
    if (element instanceof HTMLElement && element.isContentEditable) return '編集可能エリア';
    return '入力欄';
  }

  function getAssociatedLabelText(element) {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      if (element.labels && element.labels.length) {
        return Array.from(element.labels).map((label) => label.textContent || '').join(' ').trim();
      }
    }
    const parentLabel = element.closest && element.closest('label');
    return parentLabel ? String(parentLabel.textContent || '').trim() : '';
  }

  function buildElementPathSelector(element) {
    const parts = [];
    let current = element;
    while (current && current.nodeType === Node.ELEMENT_NODE && current !== document.documentElement && parts.length < 6) {
      const tag = current.tagName.toLowerCase();
      const id = current.getAttribute('id');
      if (id) {
        parts.unshift(`${tag}[id="${escapeCssString(id)}"]`);
        break;
      }

      let index = 1;
      let sibling = current.previousElementSibling;
      while (sibling) {
        if (sibling.tagName === current.tagName) index += 1;
        sibling = sibling.previousElementSibling;
      }
      parts.unshift(`${tag}:nth-of-type(${index})`);
      current = current.parentElement;
    }

    return parts.join(' > ') || getElementBaseSelector(element);
  }

  function escapeCssString(value) {
    return String(value || '')
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\r?\n/g, '\\A ');
  }

  function uniqueStrings(items) {
    const result = [];
    const seen = new Set();
    items.forEach((item) => {
      const value = String(item || '').trim();
      if (!value || seen.has(value)) return;
      seen.add(value);
      result.push(value);
    });
    return result;
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

  function createManagerButtonSection() {
    const section = document.createElement('section');
    const box = document.createElement('div');
    box.className = 'mac-mode';

    const text = document.createElement('div');
    text.className = 'mac-mode-text';
    text.textContent = `設定ボタン: ${isManagerButtonHiddenForSite() ? '非表示' : '表示'} (${siteKey})`;

    const button = document.createElement('button');
    button.type = 'button';
    button.className = isManagerButtonHiddenForSite() ? 'mac-primary' : '';
    button.textContent = isManagerButtonHiddenForSite() ? '表示する' : '非表示にする';
    button.title = '非表示でも Ctrl + . またはTampermonkeyメニューから設定画面を開けます。';
    button.addEventListener('click', () => {
      setManagerButtonHiddenForSite(!isManagerButtonHiddenForSite());
      renderManager();
    });

    box.appendChild(text);
    box.appendChild(button);
    section.appendChild(box);
    return section;
  }

  function createScopeSection() {
    const scope = getCurrentSiteScope();
    const section = document.createElement('section');

    const heading = document.createElement('h3');
    heading.textContent = '表示条件';

    const note = document.createElement('div');
    note.className = 'mac-empty';
    note.textContent = '未指定の場合は、これまで通り全ページ・全入力欄で候補を表示します。';

    section.appendChild(heading);
    section.appendChild(note);
    if (siteScopeMessage) {
      const status = document.createElement('div');
      status.className = 'mac-status';
      status.textContent = siteScopeMessage;
      section.appendChild(status);
    }
    section.appendChild(createPageScopeBlock(scope));
    section.appendChild(createFieldScopeBlock(scope));
    return section;
  }

  function createPageScopeBlock(scope) {
    const block = document.createElement('div');
    block.className = 'mac-scope-block';

    const head = document.createElement('div');
    head.className = 'mac-scope-head';

    const title = document.createElement('div');
    title.className = 'mac-scope-title';
    title.textContent = `対象ページ: ${scope.enabledPaths.length ? `${scope.enabledPaths.length.toLocaleString('ja-JP')}件指定` : '全ページ'}`;

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'mac-danger';
    clearButton.textContent = 'ページ指定をクリア';
    clearButton.disabled = !scope.enabledPaths.length;
    clearButton.addEventListener('click', () => {
      writeCurrentSiteScope({ ...scope, enabledPaths: [] });
      siteScopeMessage = 'ページ指定をクリアしました。';
      renderManager();
    });

    head.appendChild(title);
    head.appendChild(clearButton);

    const actions = document.createElement('div');
    actions.className = 'mac-manager-row';

    const currentPageButton = document.createElement('button');
    currentPageButton.type = 'button';
    currentPageButton.textContent = '現在のページを追加';
    currentPageButton.addEventListener('click', () => {
      addCurrentPathRule('exact', getCurrentPagePath());
    });

    const directoryButton = document.createElement('button');
    directoryButton.type = 'button';
    directoryButton.textContent = 'この階層以下を追加';
    directoryButton.addEventListener('click', () => {
      addCurrentPathRule('prefix', getCurrentDirectoryPath());
    });

    actions.appendChild(currentPageButton);
    actions.appendChild(directoryButton);

    const list = document.createElement('div');
    list.className = 'mac-rule-list';
    if (!scope.enabledPaths.length) {
      list.appendChild(emptyLine('全ページで表示します。'));
    } else {
      scope.enabledPaths.forEach((rule, index) => {
        list.appendChild(createScopeRuleItem(
          rule.type === 'prefix' ? 'この階層以下' : 'このページだけ',
          rule.value,
          () => {
            const nextPaths = scope.enabledPaths.filter((_rule, ruleIndex) => ruleIndex !== index);
            writeCurrentSiteScope({ ...scope, enabledPaths: nextPaths });
            siteScopeMessage = 'ページ条件を削除しました。';
            renderManager();
          }
        ));
      });
    }

    block.appendChild(head);
    block.appendChild(actions);
    block.appendChild(list);
    return block;
  }

  function createFieldScopeBlock(scope) {
    const block = document.createElement('div');
    block.className = 'mac-scope-block';

    const head = document.createElement('div');
    head.className = 'mac-scope-head';

    const title = document.createElement('div');
    title.className = 'mac-scope-title';
    title.textContent = `対象入力欄: ${scope.fieldSelectors.length ? `${scope.fieldSelectors.length.toLocaleString('ja-JP')}件指定` : '全入力欄'}`;

    const clearButton = document.createElement('button');
    clearButton.type = 'button';
    clearButton.className = 'mac-danger';
    clearButton.textContent = '入力欄指定をクリア';
    clearButton.disabled = !scope.fieldSelectors.length;
    clearButton.addEventListener('click', () => {
      writeCurrentSiteScope({ ...scope, fieldSelectors: [] });
      siteScopeMessage = '入力欄指定をクリアしました。';
      renderManager();
    });

    head.appendChild(title);
    head.appendChild(clearButton);

    const actions = document.createElement('div');
    actions.className = 'mac-manager-row';

    const lastFieldButton = document.createElement('button');
    lastFieldButton.type = 'button';
    lastFieldButton.textContent = '直前にクリックした入力欄を追加';
    lastFieldButton.disabled = !canUseLastFocusedTextEntry();
    lastFieldButton.addEventListener('click', () => {
      addFieldSelectorForElement(lastFocusedTextEntry);
    });

    const pickerButton = document.createElement('button');
    pickerButton.type = 'button';
    pickerButton.textContent = managerFieldPickerOpen ? '入力欄一覧を閉じる' : 'このページの入力欄から選ぶ';
    pickerButton.addEventListener('click', () => {
      managerFieldPickerOpen = !managerFieldPickerOpen;
      renderManagerPreservingScroll();
    });

    actions.appendChild(lastFieldButton);
    actions.appendChild(pickerButton);

    const list = document.createElement('div');
    list.className = 'mac-rule-list';
    if (!scope.fieldSelectors.length) {
      list.appendChild(emptyLine('全入力欄で表示します。'));
    } else {
      scope.fieldSelectors.forEach((field, index) => {
        list.appendChild(createScopeRuleItem(field.label, field.selector, () => {
          const nextFields = scope.fieldSelectors.filter((_field, fieldIndex) => fieldIndex !== index);
          writeCurrentSiteScope({ ...scope, fieldSelectors: nextFields });
          siteScopeMessage = '入力欄条件を削除しました。';
          renderManagerPreservingScroll();
        }));
      });
    }

    block.appendChild(head);
    block.appendChild(actions);
    block.appendChild(list);

    if (managerFieldPickerOpen) {
      block.appendChild(createFieldPickerList(scope));
    }

    return block;
  }

  function createFieldPickerList(scope) {
    const list = document.createElement('div');
    list.className = 'mac-rule-list';

    const entries = collectPageTextEntries();
    if (!entries.length) {
      list.appendChild(emptyLine('このページに選択できる入力欄が見つかりません。'));
      return list;
    }

    entries.forEach((entry) => {
      list.appendChild(createDetectedFieldItem(entry, scope));
    });
    return list;
  }

  function createDetectedFieldItem(element, scope) {
    const item = document.createElement('div');
    item.className = 'mac-rule-item';

    const field = buildFieldSelectorForElement(element);
    const text = document.createElement('div');

    const name = document.createElement('div');
    name.className = 'mac-rule-name';
    name.textContent = field.label;

    const meta = document.createElement('div');
    meta.className = 'mac-rule-meta';
    meta.textContent = field.selector;

    text.appendChild(name);
    text.appendChild(meta);

    const exists = scope.fieldSelectors.some((current) => current.selector === field.selector);
    const addButton = document.createElement('button');
    addButton.type = 'button';
    addButton.textContent = exists ? '追加済み' : '追加';
    addButton.disabled = exists;
    addButton.addEventListener('click', () => {
      addFieldSelector(field);
    });

    item.appendChild(text);
    item.appendChild(addButton);
    return item;
  }

  function createScopeRuleItem(nameText, metaText, onDelete) {
    const item = document.createElement('div');
    item.className = 'mac-rule-item';

    const text = document.createElement('div');
    const name = document.createElement('div');
    name.className = 'mac-rule-name';
    name.textContent = nameText;

    const meta = document.createElement('div');
    meta.className = 'mac-rule-meta';
    meta.textContent = metaText;

    text.appendChild(name);
    text.appendChild(meta);

    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'mac-danger';
    deleteButton.textContent = '削除';
    deleteButton.addEventListener('click', onDelete);

    item.appendChild(text);
    item.appendChild(deleteButton);
    return item;
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
      inputMode = loadInputMode();
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
      suppressNativeAutocomplete = loadSuppressNativeAutocomplete();
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
      history = loadHistory();
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
      addCurrentSitePhrase(value);
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

  // --- CSVインポート / エクスポート ----------------------------------------
  // Excel由来のShift-JIS/CP932やUTF-8 BOM付きCSVを読み、候補・使用回数・ピン状態を取り込む。
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

      syncStoredData();
      const before = getCurrentSitePhrases().length;
      mergeCurrentSitePhrases(imported);
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

    updateCurrentSiteHistory((siteHistory) => {
      stats.forEach((entry) => {
        const existingKey = Object.keys(siteHistory).find((key) => normalize(key) === normalize(entry.value));
        const key = existingKey || entry.value;
        const current = siteHistory[key] || { count: 0, lastUsed: 0 };
        siteHistory[key] = {
          count: Math.max(Number(current.count) || 0, Number(entry.count) || 0),
          lastUsed: Math.max(Number(current.lastUsed) || 0, Number(entry.lastUsed) || 0),
        };
      });
      return siteHistory;
    });
  }

  function importPinnedState(entries) {
    const pinnedEntries = entries.filter((entry) => entry.pinned).map((entry) => entry.value);
    if (!pinnedEntries.length) return;
    mergeCurrentSitePinned(pinnedEntries);
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
    syncStoredData();
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
    syncStoredData();
    mergeCurrentSitePhrases(getCurrentSiteCandidates().map((candidate) => candidate.value));
    clearCurrentSiteHistory();
    renderManager();
  }

  function clearAllSiteCandidatesFromManager() {
    syncStoredData();
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
    const inputGap = 4;
    const defaultMaxHeight = 280;
    const belowTop = rect.bottom + 4;
    const aboveBottom = rect.top - inputGap;
    const availableBelow = Math.max(0, window.innerHeight - belowTop - viewportGap);
    const availableAbove = Math.max(0, aboveBottom - viewportGap);
    const maxWidth = window.innerWidth - viewportGap * 2;
    const width = Math.min(maxWidth, Math.max(rect.width, estimatePopupWidth()));

    popup.style.width = `${width}px`;
    popup.style.left = `${Math.min(
      Math.max(rect.left, viewportGap),
      window.innerWidth - popup.offsetWidth - viewportGap
    )}px`;

    const naturalHeight = Math.min(defaultMaxHeight, popup.scrollHeight || popup.offsetHeight || defaultMaxHeight);
    const showBelow = availableBelow >= naturalHeight || availableBelow >= availableAbove;
    const availableSpace = showBelow ? availableBelow : availableAbove;
    const maxHeight = Math.max(32, Math.min(defaultMaxHeight, availableSpace || defaultMaxHeight));
    popup.style.maxHeight = `${maxHeight}px`;

    const popupHeight = Math.min(maxHeight, popup.offsetHeight || naturalHeight);
    popup.style.top = showBelow
      ? `${belowTop}px`
      : `${Math.max(viewportGap, aboveBottom - popupHeight)}px`;
  }

  function estimatePopupWidth() {
    const longest = matches.reduce((max, match) => Math.max(max, String(match.value || '').length), 0);
    const actionWidth = 150;
    const estimatedTextWidth = Math.min(720, longest * 15);
    return Math.max(320, estimatedTextWidth + actionWidth);
  }

  // --- 入力欄への反映 -------------------------------------------------------
  // 通常入力欄、textarea、contenteditable に値を入れ、サイト側が検知できる input/change も発火する。
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

  // --- 使用回数の記録 -------------------------------------------------------
  // 候補を選んだだけでは増やさず、検索・決定・送信などの実行時だけ+1する。
  function recordValue(rawValue) {
    const value = String(rawValue || '').trim();
    if (value.length < MIN_RECORD_LENGTH) return;

    addCurrentSitePhrase(value);

    const normalized = normalize(value);
    updateCurrentSiteHistory((siteHistory) => {
      const existingKey = Object.keys(siteHistory).find((key) => normalize(key) === normalized);
      const key = existingKey || value;
      const current = siteHistory[key] || { count: 0, lastUsed: 0 };

      siteHistory[key] = {
        count: (Number(current.count) || 0) + 1,
        lastUsed: Date.now(),
      };

      return siteHistory;
    });
  }

  function recordEntriesForAction(trigger) {
    const entries = findActionTextEntries(trigger);
    entries.forEach((entry) => recordValueOnce(getEntryValue(entry)));
  }

  function findActionTextEntries(trigger) {
    const result = [];
    const add = (entry) => {
      if (!entry || !isAutocompleteTarget(entry) || result.includes(entry)) return;
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

  // ポップアップを閉じる時は選択状態と開いている「…」メニューもリセットする。
  function hidePopup() {
    popup.hidden = true;
    matches = [];
    selectedIndex = 0;
    openPopupMenuKey = '';
  }
})();
