// Linux DO 自动浏览 - Popup Script (极简风格)

const AVAILABLE_THEMES = [
  { id: 'system', name: '跟随系统' },
  { id: 'healing', name: '治愈' },
  { id: 'newyear', name: '新年' }
];
const DAILY_AUTO_KEY = 'linuxDoDailyAuto';
const DEFAULT_DAILY_AUTO = {
  enabled: true,
  target: 50,
  time: '09:00',
  endTime: '19:00',
  date: '',
  count: 0,
  running: false
};
const INTERNAL_LOG_KEY = 'linuxDoInternalLogs';
const INTERNAL_LOG_UI_KEY = 'linuxDoDebugUi';

function safeStorageGet(keys) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve({});
      return;
    }
    try {
      chrome.storage.local.get(keys, (result) => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Popup] storage.get failed', lastError.message);
          resolve({});
          return;
        }
        resolve(result || {});
      });
    } catch (error) {
      console.warn('[Popup] storage.get threw', error);
      resolve({});
    }
  });
}

function safeStorageSet(payload) {
  return new Promise((resolve) => {
    if (!chrome?.storage?.local) {
      resolve();
      return;
    }
    try {
      chrome.storage.local.set(payload, () => {
        const lastError = chrome.runtime?.lastError;
        if (lastError) {
          console.warn('[Popup] storage.set failed', lastError.message);
        }
        resolve();
      });
    } catch (error) {
      console.warn('[Popup] storage.set threw', error);
      resolve();
    }
  });
}

function safeChromePromise(promise, fallback) {
  return Promise.resolve(promise).catch((error) => {
    console.warn('[Popup] chrome promise rejected', error);
    return fallback;
  });
}

function safeTabsQuery(queryInfo) {
  try {
    return safeChromePromise(chrome.tabs.query(queryInfo), []);
  } catch (error) {
    console.warn('[Popup] tabs.query threw', error);
    return Promise.resolve([]);
  }
}

function safeTabsCreate(createProperties) {
  try {
    safeChromePromise(chrome.tabs.create(createProperties), null);
  } catch (error) {
    console.warn('[Popup] tabs.create threw', error);
  }
}

function safeRuntimeSendMessage(message, fallback) {
  try {
    return safeChromePromise(chrome.runtime.sendMessage(message), fallback);
  } catch (error) {
    console.warn('[Popup] runtime.sendMessage threw', error);
    return Promise.resolve(fallback);
  }
}

class PopupPluginHost {
  constructor() {
    this.m_plugins = [];
  }

  register(plugin) {
    if (!plugin || this.m_plugins.includes(plugin)) return;
    this.m_plugins.push(plugin);
  }

  emitTabChanged(tabName) {
    this.m_plugins.forEach((plugin) => {
      if (typeof plugin.onTabChanged === 'function') {
        plugin.onTabChanged(tabName);
      }
    });
  }

  emitThemeChanged(themeId) {
    this.m_plugins.forEach((plugin) => {
      if (typeof plugin.onThemeChanged === 'function') {
        plugin.onThemeChanged(themeId);
      }
    });
  }
}

class ThemeManager {
  constructor(options = {}) {
    this.storageKey = 'linuxDoTheme';
    this.themes = AVAILABLE_THEMES;
    this.currentThemeId = 'system';
    this.panelEl = null;
    this.openEl = null;
    this.closeEl = null;
    this.m_onThemeChanged = typeof options.onThemeChanged === 'function' ? options.onThemeChanged : null;
  }

  init() {
    this.panelEl = document.getElementById('themePanel');
    this.openEl = document.getElementById('openThemePanel');
    this.closeEl = document.getElementById('closeThemePanel');
    if (!this.panelEl || !this.openEl || !this.closeEl) return;
    this.bindEvents();
    this.loadStoredTheme();
  }

  loadStoredTheme() {
    safeStorageGet([this.storageKey]).then((result) => {
      const storedId = result[this.storageKey];
      this.setTheme(this.isSupported(storedId) ? storedId : 'system', false);
    });
  }

  bindEvents() {
    this.openEl.addEventListener('click', () => this.openPanel());
    this.closeEl.addEventListener('click', () => this.closePanel());

    this.panelEl.addEventListener('click', (event) => {
      if (event.target.classList.contains('theme-modal__backdrop')) {
        this.closePanel();
      }
    });

    this.panelEl.querySelectorAll('.theme-card').forEach((card) => {
      card.addEventListener('click', () => {
        const themeId = card.getAttribute('data-theme-id');
        this.setTheme(themeId);
        this.closePanel();
      });
    });
  }

  setTheme(themeId, persist = true) {
    const targetId = this.isSupported(themeId) ? themeId : 'system';
    if (targetId === 'system') {
      document.body.removeAttribute('data-theme');
    } else {
      document.body.setAttribute('data-theme', targetId);
    }
    this.currentThemeId = targetId;
    this.markActiveCard(targetId);
    if (persist) {
      safeStorageSet({ [this.storageKey]: targetId });
    }

    // 重新渲染统计页面的图表以应用新主题颜色
    if (this.m_onThemeChanged) {
      this.m_onThemeChanged(targetId);
      return;
    }
    const statsPanel = document.querySelector('[data-panel="stats"]');
    if (statsPanel && statsPanel.classList.contains('active') && typeof statsTab !== 'undefined') {
      statsTab._renderStats();
    }
  }

  isSupported(themeId) {
    return this.themes.some((theme) => theme.id === themeId);
  }

  markActiveCard(themeId) {
    const cards = this.panelEl?.querySelectorAll('.theme-card');
    if (!cards) return;
    cards.forEach((card) => {
      const isActive = card.getAttribute('data-theme-id') === themeId;
      card.classList.toggle('active', isActive);
    });
  }

  openPanel() {
    this.panelEl?.removeAttribute('hidden');
    this.markActiveCard(this.currentThemeId);
  }

  closePanel() {
    this.panelEl?.setAttribute('hidden', '');
  }
}

class SiteManager {
  constructor() {
    this.storageKey = 'useIdcflareSite';
    this.useIdcflare = false;
    this.checkboxEl = null;
  }

  async init() {
    this.checkboxEl = document.getElementById('useIdcflareSite');
    if (!this.checkboxEl) return;

    const data = await this.loadFromStorage();
    this.useIdcflare = data || false;
    this.updateUI();
    this.bindEvents();
  }

  getBaseUrl() {
    return this.useIdcflare ? 'https://idcflare.com' : 'https://linux.do';
  }

  getLatestUrl() {
    return `${this.getBaseUrl()}/latest`;
  }

  isCurrentSite(tabUrl) {
    if (this.useIdcflare) {
      return /idcflare\.com/.test(tabUrl);
    }
    return /linux\.do/.test(tabUrl);
  }

  getSiteName() {
    return this.useIdcflare ? 'IDCFlare' : 'Linux DO';
  }

  async toggle(value) {
    this.useIdcflare = value;
    await this.saveToStorage();
    this.updateUI();
  }

  updateUI() {
    const nameEl = document.getElementById('currentSiteName');
    if (nameEl) {
      nameEl.textContent = this.getSiteName();
    }
    if (this.checkboxEl) {
      this.checkboxEl.checked = this.useIdcflare;
    }
  }

  bindEvents() {
    this.checkboxEl.addEventListener('change', (e) => {
      this.toggle(e.target.checked);
    });
  }

  async loadFromStorage() {
    const result = await safeStorageGet([this.storageKey]);
    return result[this.storageKey];
  }

  async saveToStorage() {
    await safeStorageSet({
      [this.storageKey]: this.useIdcflare
    });
  }
}

class PopupController {
  constructor() {
    this.isRunning = false;
    this.stats = {
      totalBrowsed: 0,
      startTime: null,
      errors: 0,
      currentPost: null
    };
    this.accumulatedTime = 0;
    this.lastStartTime = null;
    this.logs = [];
    this.lastLogTimes = {};
    this.dailyAutoToggleEl = null;
    this.dailyAutoTimeEl = null;
    this.guidePanelEl = null;
    this.guideOpenEl = null;
    this.guideCloseEl = null;
    this.config = {
      minScrollDelay: 800,
      maxScrollDelay: 3000,
      minPageStay: 5000,
      maxPageStay: 15000,
      readDepth: 0.7,
      clickProbability: 0.6,
      quickMode: false,
      skipDailyIdleWait: false
    };

    this.pluginHost = new PopupPluginHost();
    this.themeManager = new ThemeManager({
      onThemeChanged: (themeId) => this.pluginHost.emitThemeChanged(themeId)
    });
    this.siteManager = new SiteManager();
    this.init();
  }

  registerPlugin(plugin) {
    this.pluginHost.register(plugin);
  }

  init() {
    this.themeManager.init();
    this.siteManager.init();
    this.initGuidePanel();
    this.bindEvents();
    this.initInternalLogTools();
    this.initDailyAutoToggle();
    this.loadSettings();
    this.startTimer();
    this.checkStatus().then(() => {
      this.updateStatus();
    });
    // 初始化统计模块
    if (typeof statsTab !== 'undefined') {
      if (typeof statsTab.setTabChangeHandler === 'function') {
        statsTab.setTabChangeHandler((tabName) => this.pluginHost.emitTabChanged(tabName));
      }
      statsTab.init();
      this.pluginHost.register(statsTab);
    }
  }

  async checkStatus() {
    const [tab] = await safeTabsQuery({ active: true, currentWindow: true });

    if (!tab.url || !this.siteManager.isCurrentSite(tab.url)) {
      return;
    }

    const result = await safeStorageGet(['linux_do_auto_state']);
    if (result.linux_do_auto_state) {
      const state = result.linux_do_auto_state;
      this.isRunning = state.isRunning || false;
      if (state.stats) {
        this.stats.totalBrowsed = state.stats.totalBrowsed || 0;
        this.stats.startTime = state.stats.startTime || null;
        this.stats.errors = state.stats.errors || 0;
      }
      this.accumulatedTime = state.accumulatedTime || 0;
      this.lastStartTime = state.lastStartTime || null;
      this.updateStats();
    }
  }

  initInternalLogTools() {
    const toolsEl = document.getElementById('internalLogTools');
    if (!toolsEl) return;
    safeStorageGet([INTERNAL_LOG_UI_KEY]).then((result) => {
      if (result[INTERNAL_LOG_UI_KEY]) {
        toolsEl.removeAttribute('hidden');
      }
    });
  }

  bindEvents() {
    document.getElementById('startBtn').addEventListener('click', () => this.start());
    document.getElementById('stopBtn').addEventListener('click', () => this.stop());
    document.getElementById('resetBtn').addEventListener('click', () => this.resetAndStart());
    document.getElementById('clearHistoryBtn').addEventListener('click', () => this.clearHistory());
    document.getElementById('applySettings').addEventListener('click', () => this.applySettings());
    document.getElementById('clearLogs').addEventListener('click', () => this.clearLogs());
    document.getElementById('copyLogs').addEventListener('click', () => this.copyLogs());
    const exportInternalLogs = document.getElementById('exportInternalLogs');
    if (exportInternalLogs) {
      exportInternalLogs.addEventListener('click', () => this.exportInternalLogs());
    }
    const clearInternalLogs = document.getElementById('clearInternalLogs');
    if (clearInternalLogs) {
      clearInternalLogs.addEventListener('click', () => this.clearInternalLogs());
    }
    
    document.getElementById('openLatest').addEventListener('click', (e) => {
      e.preventDefault();
      safeTabsCreate({ url: this.siteManager.getLatestUrl() });
    });
    const latestStats = document.getElementById('openLatestStats');
    if (latestStats) {
      latestStats.addEventListener('click', (e) => {
        e.preventDefault();
        safeTabsCreate({ url: this.siteManager.getLatestUrl() });
      });
    }

    // [交互增强] 监听设置面板展开事件，自动滚动到底部
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) {
      settingsPanel.addEventListener('toggle', (e) => {
        if (settingsPanel.open) {
          // 给一点时间让浏览器渲染展开动画
          setTimeout(() => {
            // 平滑滚动到底部
            window.scrollTo({
              top: document.body.scrollHeight,
              behavior: 'smooth'
            });
          }, 150);
        }
      });
    }
  }

  async start() {
    const [tab] = await safeTabsQuery({ active: true, currentWindow: true });
    if (!tab.url || !this.siteManager.isCurrentSite(tab.url)) {
      this.log(`请在 ${this.siteManager.getSiteName()} 页面使用`, 'error');
      return;
    }
    this.sendMessageWithRetry(tab.id, { action: 'start' }, (response) => {
      if (response?.success && this.isRunning) {
        this.updateStatus();
        this.log('开始自动浏览', 'info');
      }
    });
  }

  sendMessageWithRetry(tabId, message, callback, retries = 3, silent = false) {
    try {
      chrome.tabs.sendMessage(tabId, message, (response) => {
        if (chrome.runtime.lastError) {
          if (retries > 0) {
            setTimeout(() => {
              this.sendMessageWithRetry(tabId, message, callback, retries - 1, silent);
            }, 500);
          } else {
            if (!silent) {
              this.log('请刷新页面后重试', 'error');
            }
          }
          return;
        }
        if (callback) callback(response);
      });
    } catch (error) {
      if (retries > 0) {
        setTimeout(() => {
          this.sendMessageWithRetry(tabId, message, callback, retries - 1, silent);
        }, 500);
      } else if (!silent) {
        this.log('请刷新页面后重试', 'error');
      }
    }
  }

  async stop() {
    const tabs = await safeTabsQuery({
      url: ['https://linux.do/*', 'https://idcflare.com/*']
    });
    if (!tabs.length) {
      this.isRunning = false;
      this.updateStatus();
      this.log('没有可停止的浏览任务', 'warning');
      return;
    }
    tabs.forEach((tab) => {
      if (!tab?.id) return;
      this.sendMessageWithRetry(tab.id, { action: 'stop' }, null, 3, true);
    });
    this.isRunning = false;
    this.updateStatus();
    this.log('已发送停止指令', 'warning');
  }

  initGuidePanel() {
    this.guidePanelEl = document.getElementById('guidePanel');
    this.guideOpenEl = document.getElementById('openGuidePanel');
    this.guideCloseEl = document.getElementById('closeGuidePanel');
    if (!this.guidePanelEl || !this.guideOpenEl || !this.guideCloseEl) return;
    this.guideOpenEl.addEventListener('click', () => this.openGuidePanel());
    this.guideCloseEl.addEventListener('click', () => this.closeGuidePanel());
    this.guidePanelEl.addEventListener('click', (event) => {
      if (event.target.classList.contains('theme-modal__backdrop')) {
        this.closeGuidePanel();
      }
    });
  }

  openGuidePanel() {
    this.guidePanelEl?.removeAttribute('hidden');
  }

  closeGuidePanel() {
    this.guidePanelEl?.setAttribute('hidden', '');
  }

  async resetAndStart() {
    const [tab] = await safeTabsQuery({ active: true, currentWindow: true });
    if (!tab.url || !this.siteManager.isCurrentSite(tab.url)) {
      this.log(`请在 ${this.siteManager.getSiteName()} 页面使用`, 'error');
      return;
    }
    this.sendMessageWithRetry(tab.id, { action: 'resetAndStart' }, (response) => {
      if (response?.success && this.isRunning) {
        this.stats.totalBrowsed = 0;
        this.updateStatus();
        this.updateStats();
        this.log('重置并重新开始浏览', 'warning');
      }
    });
  }

  async clearHistory() {
    const [tab] = await safeTabsQuery({ active: true, currentWindow: true });
    this.sendMessageWithRetry(tab.id, { action: 'resetHistory' }, (response) => {
      if (response?.success) {
        this.stats.totalBrowsed = 0;
        this.updateStats();
        this.log('已清空浏览历史', 'info');
      }
    });
  }

  async applySettings() {
    let minCommentRead = parseFloat(document.getElementById('minCommentRead').value) * 1000;
    let maxCommentRead = parseFloat(document.getElementById('maxCommentRead').value) * 1000;
    let minPageStay = parseInt(document.getElementById('minPageStay').value) * 1000;
    let maxPageStay = parseInt(document.getElementById('maxPageStay').value) * 1000;

    if (minCommentRead > maxCommentRead) [minCommentRead, maxCommentRead] = [maxCommentRead, minCommentRead];
    if (minPageStay > maxPageStay) [minPageStay, maxPageStay] = [maxPageStay, minPageStay];

    const newConfig = {
      minScrollDelay: 800,
      maxScrollDelay: 3000,
      minCommentRead: minCommentRead,
      maxCommentRead: maxCommentRead,
      minPageStay: minPageStay,
      maxPageStay: maxPageStay,
      readDepth: 0.7,
      clickProbability: parseFloat(document.getElementById('clickProbability').value),
      quickMode: document.getElementById('quickMode').checked,
      skipDailyIdleWait: document.getElementById('skipDailyIdleWait').checked
    };

    if (newConfig.minCommentRead >= newConfig.maxCommentRead) {
      this.log('最小评论阅读时间必须小于最大评论阅读时间', 'error');
      return;
    }
    if (newConfig.minPageStay >= newConfig.maxPageStay) {
      this.log('最小页面停留时间必须小于最大页面停留时间', 'error');
      return;
    }

    this.config = newConfig;
    this.saveSettings();

    const [tab] = await safeTabsQuery({ active: true, currentWindow: true });
    if (tab?.id) {
      this.sendMessageWithRetry(tab.id, {
        action: 'updateConfig',
        config: this.config
      });
    }

    this.log('设置已更新', 'info');
    
    // 应用后自动收起
    const settingsPanel = document.getElementById('settingsPanel');
    if (settingsPanel) settingsPanel.removeAttribute('open');
  }

  updateStatus() {
    const statusBadge = document.getElementById('statusBadge');
    const statusText = statusBadge.querySelector('.status-text');
    const startBtn = document.getElementById('startBtn');
    const stopBtn = document.getElementById('stopBtn');

    if (this.isRunning) {
      statusBadge.classList.add('running');
      statusText.textContent = '运行中';
      startBtn.disabled = true;
      stopBtn.disabled = false;
    } else {
      statusBadge.classList.remove('running');
      statusText.textContent = '未运行';
      startBtn.disabled = false;
      stopBtn.disabled = true;
    }
  }

  updateStats() {
    document.getElementById('browsedCount').textContent = this.stats.totalBrowsed;
  }

  startTimer() {
    setInterval(() => {
      let totalTime = this.accumulatedTime;
      if (this.isRunning && this.lastStartTime) {
        totalTime += Date.now() - this.lastStartTime;
      }
      const minutes = Math.floor(totalTime / 60000);
      const seconds = Math.floor((totalTime % 60000) / 1000);
      document.getElementById('runTime').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  saveRunTimeState() {
    safeStorageGet(['linux_do_auto_state']).then((result) => {
      const state = result.linux_do_auto_state || {};
      state.accumulatedTime = this.accumulatedTime;
      state.lastStartTime = this.lastStartTime;
      safeStorageSet({ linux_do_auto_state: state });
    });
  }

  log(message, type = 'info') {
    const now = Date.now();
    const key = `${type}:${message}`;
    const lastAt = this.lastLogTimes[key] || 0;
    if (now - lastAt < 1500) {
      return;
    }
    this.lastLogTimes[key] = now;
    const timestamp = new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    this.logs.unshift({ message, type, timestamp });
    if (this.logs.length > 30) this.logs.pop();
    this.renderLogs();
  }

  renderLogs() {
    const logsContent = document.getElementById('logsContent');
    if (this.logs.length === 0) {
      logsContent.innerHTML = `
        <div class="log-empty">
          <div class="log-illustration" aria-hidden="true">${this.getSquirrelSvg()}</div>
          <span style="font-size:10px;margin-top:4px;">暂无活动</span>
        </div>`;
      return;
    }
    logsContent.innerHTML = this.logs.map(log => `
      <div class="log-entry log-${log.type}">
        <span class="log-time">${log.timestamp}</span>
        <span class="log-message" title="${log.message}">${log.message}</span>
      </div>
    `).join('');
  }

  getSquirrelSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z"/>
      <path d="M19 10v2a7 7 0 0 1-14 0v-2"/>
      <line x1="12" y1="19" x2="12" y2="22"/>
      <line x1="8" y1="22" x2="16" y2="22"/>
    </svg>`;
  }

  clearLogs() {
    this.logs = [];
    this.renderLogs();
  }

  copyLogs() {
    if (this.logs.length === 0) return;
    const logText = this.logs.map(log => `[${log.timestamp}] ${log.message}`).join('\n');
    const textarea = document.createElement('textarea');
    textarea.value = logText;
    textarea.style.position = 'fixed'; textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try { document.execCommand('copy'); this.log('日志已复制', 'success'); } catch (err) {}
    document.body.removeChild(textarea);
  }

  exportInternalLogs() {
    safeStorageGet([INTERNAL_LOG_KEY]).then((result) => {
      const rawLogs = Array.isArray(result[INTERNAL_LOG_KEY]) ? result[INTERNAL_LOG_KEY] : [];
      const lines = rawLogs.map((entry) => {
        const at = entry?.at ? new Date(entry.at).toISOString() : '';
        const reason = entry?.reason || 'unknown';
        const detail = entry?.detail || '';
        const url = entry?.url || '';
        return `[${at}] ${reason} ${detail} ${url}`.trim();
      });
      const payload = lines.length ? lines.join('\n') : '[]';
      const textarea = document.createElement('textarea');
      textarea.value = payload;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      try { document.execCommand('copy'); this.log('内部日志已复制', 'success'); } catch (err) {}
      document.body.removeChild(textarea);
    });
  }

  clearInternalLogs() {
    safeStorageSet({ [INTERNAL_LOG_KEY]: [] }).then(() => {
      this.log('内部日志已清空', 'info');
    });
  }

  initDailyAutoToggle() {
    this.dailyAutoToggleEl = document.getElementById('dailyAutoEnabled');
    this.dailyAutoTimeEl = document.getElementById('dailyAutoTime');
    if (!this.dailyAutoToggleEl || !this.dailyAutoTimeEl) return;
    this.loadDailyAutoConfig();
    this.dailyAutoToggleEl.addEventListener('change', (e) => {
      this.saveDailyAutoConfig(e.target.checked);
    });
    this.dailyAutoTimeEl.addEventListener('change', (e) => {
      this.saveDailyAutoTime(e.target.value);
    });
  }

  loadDailyAutoConfig() {
    safeStorageGet([DAILY_AUTO_KEY]).then((result) => {
      const config = { ...DEFAULT_DAILY_AUTO, ...(result[DAILY_AUTO_KEY] || {}) };
      this.dailyAutoToggleEl.checked = config.enabled !== false;
      config.time = this.normalizeDailyTime(config.time);
      config.endTime = this.defaultDailyEndTime(config.time);
      this.dailyAutoTimeEl.value = config.time;
      const stored = result[DAILY_AUTO_KEY];
      const shouldSave =
        !stored ||
        stored.time !== config.time ||
        stored.endTime !== config.endTime ||
        stored.enabled !== config.enabled;
      if (shouldSave) {
        safeStorageSet({ [DAILY_AUTO_KEY]: config });
      }
    });
  }

  parseDailyTime(time) {
    if (!time || typeof time !== 'string') return { hour: 9, minute: 0, valid: false };
    const parts = time.split(':');
    if (parts.length !== 2) return { hour: 9, minute: 0, valid: false };
    const hour = Number(parts[0]);
    const minute = Number(parts[1]);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return { hour: 9, minute: 0, valid: false };
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return { hour: 9, minute: 0, valid: false };
    return { hour, minute, valid: true };
  }

  formatDailyTime(hour, minute) {
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  normalizeDailyTime(time) {
    const parsed = this.parseDailyTime(time);
    return this.formatDailyTime(parsed.hour, parsed.minute);
  }

  defaultDailyEndTime(startTime) {
    const parsed = this.parseDailyTime(startTime);
    const totalMinutes = parsed.hour * 60 + parsed.minute + 600;
    const normalizedMinutes = totalMinutes % (24 * 60);
    return this.formatDailyTime(Math.floor(normalizedMinutes / 60), normalizedMinutes % 60);
  }

  saveDailyAutoTime(time) {
    const normalized = this.normalizeDailyTime(time);
    safeStorageGet([DAILY_AUTO_KEY]).then((result) => {
      const config = { ...DEFAULT_DAILY_AUTO, ...(result[DAILY_AUTO_KEY] || {}) };
      config.time = normalized;
      config.endTime = this.defaultDailyEndTime(normalized);
      safeStorageSet({ [DAILY_AUTO_KEY]: config });
    });
  }

  saveDailyAutoConfig(enabled) {
    safeStorageGet([DAILY_AUTO_KEY]).then((result) => {
      const config = { ...DEFAULT_DAILY_AUTO, ...(result[DAILY_AUTO_KEY] || {}) };
      config.enabled = enabled;
      config.time = this.normalizeDailyTime(this.dailyAutoTimeEl.value);
      config.endTime = this.defaultDailyEndTime(config.time);
      if (!enabled) {
        config.running = false;
      }
      safeStorageSet({ [DAILY_AUTO_KEY]: config });
    });
  }

  saveSettings() { safeStorageSet({ linuxDoConfig: this.config }); }

  loadSettings() {
    safeStorageGet(['linuxDoConfig']).then((result) => {
      if (result.linuxDoConfig) {
        this.config = { ...this.config, ...result.linuxDoConfig };
        const comment1 = (this.config.minCommentRead || 1000) / 1000;
        const comment2 = (this.config.maxCommentRead || 4000) / 1000;
        document.getElementById('minCommentRead').value = Math.min(comment1, comment2);
        document.getElementById('maxCommentRead').value = Math.max(comment1, comment2);
        const page1 = Math.floor((this.config.minPageStay || 5000) / 1000);
        const page2 = Math.floor((this.config.maxPageStay || 15000) / 1000);
        document.getElementById('minPageStay').value = Math.min(page1, page2);
        document.getElementById('maxPageStay').value = Math.max(page1, page2);
        document.getElementById('clickProbability').value = this.config.clickProbability;
        document.getElementById('quickMode').checked = this.config.quickMode || false;
        document.getElementById('skipDailyIdleWait').checked = this.config.skipDailyIdleWait || false;
      }
    });
  }
}

const INVITES_URL = 'https://connect.linux.do/dash/invites';

function parseInviteTime(text) {
  const match = text.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6] || 0);
  return new Date(year, month - 1, day, hour, minute, second).getTime();
}

function parseInviteUsage(text) {
  const numbers = text.match(/\d+/g) || [];
  return {
    used: Number(numbers[0] || 0),
    capacity: Number(numbers[1] || 0)
  };
}

function parseInvitesHtml(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const rows = Array.from(doc.querySelectorAll('table tbody tr'));
  const records = [];
  rows.forEach((row) => {
    const cells = row.querySelectorAll('td');
    if (cells.length < 4) return;
    const userLink = cells[0].querySelector('a');
    const userName = (userLink?.textContent || cells[0].textContent || '').trim();
    const userUrl = userLink?.getAttribute('href') || '';
    const createdAt = (cells[1].textContent || '').trim();
    const expiresAt = (cells[2].textContent || '').trim();
    const usageText = (cells[3].textContent || '').replace(/\s+/g, ' ').trim();
    const usage = parseInviteUsage(usageText);
    if (!userName) return;
    records.push({
      userName,
      userUrl,
      createdAt,
      expiresAt,
      used: usage.used,
      capacity: usage.capacity
    });
  });
  return records;
}

function buildInviteLeaderboard(records) {
  const map = new Map();
  records.forEach((record) => {
    const key = record.userName;
    const existing = map.get(key) || {
      userName: record.userName,
      userUrl: record.userUrl,
      totalUsed: 0,
      totalCapacity: 0,
      invites: 0,
      latestCreatedAt: record.createdAt,
      latestCreatedAtMs: 0
    };
    existing.totalUsed += record.used;
    existing.totalCapacity += record.capacity;
    existing.invites += 1;
    const createdAtMs = parseInviteTime(record.createdAt);
    if (createdAtMs >= existing.latestCreatedAtMs) {
      existing.latestCreatedAtMs = createdAtMs;
      existing.latestCreatedAt = record.createdAt;
    }
    if (!existing.userUrl && record.userUrl) {
      existing.userUrl = record.userUrl;
    }
    map.set(key, existing);
  });

  return Array.from(map.values());
}

function getInviteRate(item) {
  if (!item.totalCapacity) return 0;
  return item.totalUsed / item.totalCapacity;
}

function sortInviteLeaderboard(list, sortKey) {
  const sorted = [...list];
  sorted.sort((a, b) => {
    switch (sortKey) {
      case 'rate': {
        const rateDiff = getInviteRate(b) - getInviteRate(a);
        if (rateDiff !== 0) return rateDiff;
        if (b.totalUsed !== a.totalUsed) return b.totalUsed - a.totalUsed;
        return b.latestCreatedAtMs - a.latestCreatedAtMs;
      }
      case 'recent': {
        if (b.latestCreatedAtMs !== a.latestCreatedAtMs) return b.latestCreatedAtMs - a.latestCreatedAtMs;
        return b.totalUsed - a.totalUsed;
      }
      case 'used':
      default:
        if (b.totalUsed !== a.totalUsed) return b.totalUsed - a.totalUsed;
        if (b.totalCapacity !== a.totalCapacity) return b.totalCapacity - a.totalCapacity;
        return b.latestCreatedAtMs - a.latestCreatedAtMs;
    }
  });
  return sorted;
}

class InvitesBoard {
  constructor() {
    this.m_bodyEl = null;
    this.m_statusEl = null;
    this.m_refreshBtn = null;
    this.m_sortEl = null;
    this.m_filterEl = null;
    this.m_scrollTimer = null;
    this.m_isScrolling = false;
    this.m_scrollHandler = null;
    this.m_hasScrollListener = false;
    this.m_isActive = false;
    this.m_refreshTimer = null;
    this.m_countdownTimer = null;
    this.m_lastFetchAt = 0;
    this.m_lastRecords = [];
    this.m_lastUpdatedAt = 0;
    this.m_statusBaseText = '';
    this.m_nextRefreshAt = 0;
    this.m_sortKey = 'used';
    this.m_filterUsed = false;
    this.m_refreshIntervalMs = 5 * 60 * 1000;
  }

  init() {
    this.m_bodyEl = document.getElementById('invitesBody');
    this.m_statusEl = document.getElementById('invitesStatus');
    this.m_refreshBtn = document.getElementById('invitesRefresh');
    this.m_sortEl = document.getElementById('invitesSort');
    this.m_filterEl = document.getElementById('invitesFilterUsed');
    if (!this.m_bodyEl || !this.m_statusEl || !this.m_refreshBtn || !this.m_sortEl || !this.m_filterEl) return;
    this.m_statusBaseText = (this.m_statusEl.textContent || '').trim();
    this.m_sortEl.value = this.m_sortKey;
    this.m_filterEl.checked = this.m_filterUsed;
    this.m_refreshBtn.addEventListener('click', () => this.refresh(true));
    this.m_sortEl.addEventListener('change', () => {
      this.m_sortKey = this.m_sortEl.value;
      this.renderFromCache();
    });
    this.m_filterEl.addEventListener('change', () => {
      this.m_filterUsed = this.m_filterEl.checked;
      this.renderFromCache();
    });
    this.m_scrollHandler = () => this.handleScroll();
  }

  setActive(active) {
    if (this.m_isActive === active) return;
    this.m_isActive = active;
    if (active) {
      this.enableScrollTracking();
      this.refresh(true);
      this.startAutoRefresh();
      return;
    }
    this.stopAutoRefresh();
    this.disableScrollTracking();
    this.clearScrolling();
  }

  onTabChanged(tabName) {
    this.setActive(tabName === 'invites');
  }

  startAutoRefresh() {
    if (!this.m_refreshTimer) {
      this.m_refreshTimer = setInterval(() => this.refresh(false), this.m_refreshIntervalMs);
    }
    if (!this.m_countdownTimer) {
      this.m_countdownTimer = setInterval(() => this.renderStatus(), 1000);
    }
  }

  stopAutoRefresh() {
    if (this.m_refreshTimer) {
      clearInterval(this.m_refreshTimer);
      this.m_refreshTimer = null;
    }
    if (this.m_countdownTimer) {
      clearInterval(this.m_countdownTimer);
      this.m_countdownTimer = null;
    }
    this.m_nextRefreshAt = 0;
    this.renderStatus();
  }

  handleScroll() {
    if (!this.m_isActive) return;
    if (!this.m_isScrolling) {
      this.m_isScrolling = true;
      document.body.classList.add('invites-scrolling');
    }
    if (this.m_scrollTimer) {
      clearTimeout(this.m_scrollTimer);
    }
    this.m_scrollTimer = setTimeout(() => this.clearScrolling(), 180);
  }

  clearScrolling() {
    if (this.m_scrollTimer) {
      clearTimeout(this.m_scrollTimer);
      this.m_scrollTimer = null;
    }
    if (!this.m_isScrolling) return;
    this.m_isScrolling = false;
    document.body.classList.remove('invites-scrolling');
  }

  enableScrollTracking() {
    if (this.m_hasScrollListener || !this.m_scrollHandler) return;
    document.addEventListener('scroll', this.m_scrollHandler, true);
    this.m_hasScrollListener = true;
  }

  disableScrollTracking() {
    if (!this.m_hasScrollListener || !this.m_scrollHandler) return;
    document.removeEventListener('scroll', this.m_scrollHandler, true);
    this.m_hasScrollListener = false;
  }

  prepareLeaderboard(records) {
    let list = buildInviteLeaderboard(records);
    if (this.m_filterUsed) {
      list = list.filter(item => item.totalUsed > 0);
    }
    return sortInviteLeaderboard(list, this.m_sortKey);
  }

  renderFromCache() {
    if (!this.m_lastRecords || this.m_lastRecords.length === 0) return;
    const leaderboard = this.prepareLeaderboard(this.m_lastRecords);
    this.renderTable(leaderboard, this.m_lastRecords.length, this.m_lastUpdatedAt || Date.now());
  }

  async refresh(force) {
    if (!this.m_isActive) return;
    const now = Date.now();
    if (!force && now - this.m_lastFetchAt < 1000) return;
    this.m_lastFetchAt = now;
    this.m_nextRefreshAt = now + this.m_refreshIntervalMs;
    this.renderStatus();
    this.renderLoading();
    try {
      const html = await this.fetchInvitesHtmlWithFallback();
      const records = parseInvitesHtml(html);
      this.m_lastRecords = records;
      this.m_lastUpdatedAt = now;
      if (records.length === 0) {
        this.renderEmpty('未找到邀请记录，可能未登录或无权限');
      this.updateStatus('打开邀请页');
        return;
      }
      const leaderboard = this.prepareLeaderboard(records);
      this.renderTable(leaderboard, records.length, now);
    } catch (error) {
      this.renderError(error);
    }
  }

  async fetchInvitesHtml() {
    const response = await fetch(INVITES_URL, {
      credentials: 'include',
      cache: 'no-store'
    });
    if (!response.ok) {
      throw new Error(`请求失败: ${response.status} ${response.statusText}`);
    }
    return response.text();
  }

  async fetchInvitesHtmlWithFallback() {
    try {
      return await this.fetchInvitesHtml();
    } catch (popupError) {
      const tries = [1, 2];
      let lastResult = null;
      for (const tryNo of tries) {
        lastResult = await safeRuntimeSendMessage({
          source: 'popup',
          type: 'fetchInvitesHtml',
          url: INVITES_URL
        }, null);

        if (lastResult && lastResult.ok && typeof lastResult.html === 'string') {
          return lastResult.html;
        }

        if (tryNo < tries.length) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      const backgroundMessage = lastResult?.error || 'Background fetch failed';
      const error = new Error(`Invites fetch failed. popup=${popupError?.message || 'unknown'}; background=${backgroundMessage}`);
      error.cause = { popupError, backgroundResult: lastResult };
      throw error;
    }
  }

  renderLoading() {
    if (!this.m_bodyEl) return;
    this.m_bodyEl.innerHTML = '<div class="invites-loading">加载中...</div>';
  }

  renderEmpty(message) {
    if (!this.m_bodyEl) return;
    this.m_bodyEl.innerHTML = `
      <div class="invites-empty">
        <div>${message}</div>
        <a class="invites-action" href="${INVITES_URL}" target="_blank">打开邀请页</a>
      </div>
    `;
  }

  renderError(error) {
    console.error('[Invites] 加载失败', error);
    if (!this.m_bodyEl) return;
    this.m_bodyEl.innerHTML = `
      <div class="invites-error">
        <a class="invites-action" href="${INVITES_URL}" target="_blank">打开邀请页</a>
      </div>
    `;
    this.updateStatus('打开邀请页');
  }

  renderTable(leaderboard, totalRecords, now) {
    if (!this.m_bodyEl) return;
    if (leaderboard.length === 0) {
      const message = this.m_filterUsed ? '筛选后无数据' : '暂无榜单数据';
      this.renderEmpty(message);
      this.updateStatus(`更新 ${this.formatTime(now)}`);
      return;
    }
    const rows = leaderboard.map((item, index) => {
      const rate = item.totalCapacity > 0 ? Math.round((item.totalUsed / item.totalCapacity) * 100) : 0;
      const rateClass = rate >= 100 ? 'invites-rate--high' : rate >= 50 ? 'invites-rate--mid' : 'invites-rate--low';
      const rateLevel = rate >= 100 ? 'high' : rate >= 50 ? 'mid' : 'low';
      const rateWidth = Math.min(rate, 100);
      const userCell = item.userUrl
        ? `<a href="${item.userUrl}" target="_blank">${item.userName}</a>`
        : item.userName;
      return `
        <tr>
          <td class="invites-rank" data-label="#">${index + 1}</td>
          <td class="invites-user" data-label="用户">${userCell}</td>
          <td data-label="已用/容量"><span class="invites-used">${item.totalUsed}</span><span class="invites-capacity"> / ${item.totalCapacity}</span></td>
          <td class="${rateClass}" data-label="使用率">${rate}%</td>
          <td data-label="邀请数">${item.invites}</td>
          <td data-label="最近创建">${item.latestCreatedAt || '-'}</td>
        </tr>
      `;
    }).join('');

    const cards = leaderboard.map((item, index) => {
      const rate = item.totalCapacity > 0 ? Math.round((item.totalUsed / item.totalCapacity) * 100) : 0;
      const rateClass = rate >= 100 ? 'invites-rate--high' : rate >= 50 ? 'invites-rate--mid' : 'invites-rate--low';
      const rateLevel = rate >= 100 ? 'high' : rate >= 50 ? 'mid' : 'low';
      const rateWidth = Math.min(rate, 100);
      const userCell = item.userUrl
        ? `<a href="${item.userUrl}" target="_blank">${item.userName}</a>`
        : item.userName;
      return `
        <div class="invite-card">
          <div class="invite-card__header">
            <span class="invite-rank">#${index + 1}</span>
            <span class="invite-user">${userCell}</span>
            <span class="invite-rate ${rateClass}">${rate}%</span>
          </div>
          <div class="invite-card__bar">
            <div class="invite-bar">
              <span class="invite-bar__fill invite-bar__fill--${rateLevel}" style="width:${rateWidth}%"></span>
            </div>
            <div class="invite-bar__text">
              <span class="invites-used">${item.totalUsed}</span><span class="invites-capacity"> / ${item.totalCapacity}</span>
            </div>
          </div>
          <div class="invite-card__meta">
            <span>邀请数 ${item.invites}</span>
            <span>最近创建 ${item.latestCreatedAt || '-'}</span>
          </div>
        </div>
      `;
    }).join('');

    this.m_bodyEl.innerHTML = `
      <div class="invites-summary">
        <span>记录 ${totalRecords} · 用户 ${leaderboard.length}</span>
        <span>更新于 ${this.formatTime(now)}</span>
      </div>
      <div class="invites-cards">
        ${cards}
      </div>
      <table class="invites-table">
        <thead>
          <tr>
            <th class="invites-rank">#</th>
            <th>用户</th>
            <th>已用 / 容量</th>
            <th>使用率</th>
            <th>邀请数</th>
            <th>最近创建</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
    `;
    this.updateStatus(`更新 ${this.formatTime(now)}`);
  }

  updateStatus(text) {
    this.m_statusBaseText = text;
    this.renderStatus();
  }

  renderStatus() {
    if (!this.m_statusEl) return;
    let text = this.m_statusBaseText || '';
    if (this.m_isActive && this.m_nextRefreshAt) {
      const countdown = this.formatCountdown(this.m_nextRefreshAt - Date.now());
      const suffix = `下次 ${countdown}`;
      text = text ? `${text} · ${suffix}` : suffix;
    }
    this.m_statusEl.textContent = text || '等待加载...';
  }

  formatTime(timestamp) {
    const date = new Date(timestamp);
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    return `${hours}:${minutes}`;
  }

  formatCountdown(ms) {
    const totalSeconds = Math.max(0, Math.ceil(ms / 1000));
    const seconds = totalSeconds % 60;
    const totalMinutes = Math.floor(totalSeconds / 60);
    const minutes = totalMinutes % 60;
    const hours = Math.floor(totalMinutes / 60);
    if (hours > 0) {
      return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
}

const controller = new PopupController();
const g_invitesBoard = new InvitesBoard();
g_invitesBoard.init();
controller.registerPlugin(g_invitesBoard);
window.g_invitesBoard = g_invitesBoard;

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'content') {
    switch (message.type) {
      case 'ready': console.log('[Popup] Ready'); break;
      case 'started':
        controller.isRunning = true;
        controller.stats.startTime = Date.now();
        controller.lastStartTime = Date.now();
        controller.saveRunTimeState();
        controller.updateStatus();
        controller.log('自动浏览已启动', 'success');
        break;
      case 'stopped':
        controller.isRunning = false;
        if (controller.lastStartTime) {
          controller.accumulatedTime += Date.now() - controller.lastStartTime;
          controller.lastStartTime = null;
          controller.saveRunTimeState();
        }
        controller.updateStatus();
        controller.log('自动浏览已停止', 'warning');
        break;
      case 'stats':
        controller.stats = { ...controller.stats, ...message.stats };
        controller.updateStats();
        break;
      case 'log': controller.log(message.message, 'info'); break;
      case 'error': controller.log(message.message, 'error'); controller.stats.errors++; break;
      case 'configUpdated': controller.log('配置已更新', 'info'); break;
    }
  }

  return true;
});
