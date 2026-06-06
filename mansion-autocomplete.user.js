// ==UserScript==
// @name         Mansion Name Autocomplete
// @namespace    local.mansion-autocomplete
// @version      1.1.0
// @description  Add a custom autocomplete picker with site-specific usage history.
// @match        http://*/*
// @match        https://*/*
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
  const MAX_RESULTS = 12;
  const MAX_HISTORY_PER_SITE = 200;
  const MIN_RECORD_LENGTH = 2;

  const DEFAULT_PHRASES = [
    'パークハウス板橋',
    'パークハウス松濤',
    'パークハウス中目黒',
    'パークハウス代々木公園',
  ];

  const siteKey = location.hostname || location.host || 'unknown-site';
  let phrases = loadPhrases();
  let history = loadHistory();
  let activeInput = null;
  let selectedIndex = 0;
  let matches = [];

  const popup = document.createElement('div');
  popup.id = 'mansion-autocomplete-popup';
  popup.hidden = true;
  popup.setAttribute('role', 'listbox');

  const style = document.createElement('style');
  style.textContent = `
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
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      font-size: 14px;
      line-height: 1.35;
    }
    #mansion-autocomplete-popup .mac-item {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 10px;
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
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] {
      background: #1d4ed8;
      color: #fff;
    }
    #mansion-autocomplete-popup .mac-item[aria-selected="true"] .mac-meta {
      color: #dbeafe;
    }
    #mansion-autocomplete-popup .mac-help {
      padding: 5px 9px 3px;
      color: #6b7280;
      font-size: 12px;
      border-top: 1px solid #e5e7eb;
      margin-top: 3px;
    }
  `;

  document.documentElement.appendChild(style);
  document.documentElement.appendChild(popup);

  if (typeof GM_registerMenuCommand === 'function') {
    GM_registerMenuCommand('候補リストを編集', editPhrases);
    GM_registerMenuCommand('候補リストを初期化', resetPhrases);
    GM_registerMenuCommand('このサイトの入力履歴を削除', clearSiteHistory);
  }

  document.addEventListener('focusin', (event) => {
    if (isTextEntry(event.target)) {
      activeInput = event.target;
      updatePopup();
    }
  });

  document.addEventListener('input', (event) => {
    if (event.target === activeInput) {
      updatePopup();
    }
  });

  document.addEventListener('change', (event) => {
    if (isTextEntry(event.target)) {
      recordValue(event.target.value);
    }
  }, true);

  document.addEventListener('blur', (event) => {
    if (event.target === activeInput) {
      recordValue(activeInput.value);
    }
  }, true);

  document.addEventListener('compositionend', (event) => {
    if (event.target === activeInput) {
      updatePopup();
    }
  });

  document.addEventListener('keydown', (event) => {
    if (event.isComposing || !activeInput || popup.hidden) return;

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
    if (!popup.contains(event.target) && event.target !== activeInput) {
      hidePopup();
    }
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

  function uniqueNonEmpty(items) {
    return [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  }

  function isTextEntry(element) {
    if (!element || element.disabled || element.readOnly) return false;
    if (element instanceof HTMLTextAreaElement) return true;
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

    matches = buildMatches(activeInput.value);
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

      item.appendChild(name);
      item.appendChild(meta);
      item.addEventListener('mouseenter', () => {
        selectedIndex = index;
        renderPopup();
      });
      item.addEventListener('mousedown', (event) => {
        event.preventDefault();
        commit(match.value);
      });
      popup.appendChild(item);
    });

    const help = document.createElement('div');
    help.className = 'mac-help';
    help.textContent = '↑↓で選択 / Enter・Tabで決定 / 入力内容はこのサイトの履歴に保存';
    popup.appendChild(help);
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
    const fitsBelow = belowTop + popupHeight < window.innerHeight - viewportGap;
    popup.style.top = fitsBelow
      ? `${belowTop}px`
      : `${Math.max(viewportGap, rect.top - popupHeight - 4)}px`;
  }

  function commit(value) {
    if (!activeInput) return;

    activeInput.value = value;
    activeInput.dispatchEvent(new Event('input', { bubbles: true }));
    activeInput.dispatchEvent(new Event('change', { bubbles: true }));
    recordValue(value);
    hidePopup();
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
