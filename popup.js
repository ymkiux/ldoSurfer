// Linux DO 自动浏览 - Popup Script (极简风格)

const AVAILABLE_THEMES = [
  { id: 'system', name: '跟随系统' },
  { id: 'healing', name: '治愈' },
  { id: 'newyear', name: '新年' }
];

class ThemeManager {
  constructor() {
    this.storageKey = 'linuxDoTheme';
    this.themes = AVAILABLE_THEMES;
    this.currentThemeId = 'system';
    this.panelEl = null;
    this.openEl = null;
    this.closeEl = null;
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
    chrome.storage.local.get([this.storageKey], (result) => {
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
      chrome.storage.local.set({ [this.storageKey]: targetId });
    }

    // 重新渲染统计页面的图表以应用新主题颜色
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
    return new Promise(resolve => {
      chrome.storage.local.get([this.storageKey], (result) => {
        resolve(result[this.storageKey]);
      });
    });
  }

  async saveToStorage() {
    return new Promise(resolve => {
      chrome.storage.local.set({
        [this.storageKey]: this.useIdcflare
      }, resolve);
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
    this.config = {
      minScrollDelay: 800,
      maxScrollDelay: 3000,
      minPageStay: 5000,
      maxPageStay: 15000,
      readDepth: 0.7,
      clickProbability: 0.6,
      quickMode: false
    };

    this.themeManager = new ThemeManager();
    this.siteManager = new SiteManager();
    this.init();
  }

  init() {
    this.themeManager.init();
    this.siteManager.init();
    this.bindEvents();
    this.loadSettings();
    this.startTimer();
    this.checkStatus().then(() => {
      this.updateStatus();
    });
    // 初始化统计模块
    if (typeof statsTab !== 'undefined') {
      statsTab.init();
    }
  }

  async checkStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !this.siteManager.isCurrentSite(tab.url)) {
      return;
    }

    return new Promise((resolve) => {
      chrome.storage.local.get(['linux_do_auto_state'], (result) => {
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
        resolve();
      });
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
    
    document.getElementById('openLatest').addEventListener('click', (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: this.siteManager.getLatestUrl() });
    });
    const latestStats = document.getElementById('openLatestStats');
    if (latestStats) {
      latestStats.addEventListener('click', (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: this.siteManager.getLatestUrl() });
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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

  sendMessageWithRetry(tabId, message, callback, retries = 3) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        if (retries > 0) {
          setTimeout(() => {
            this.sendMessageWithRetry(tabId, message, callback, retries - 1);
          }, 500);
        } else {
          this.log('请刷新页面后重试', 'error');
        }
        return;
      }
      if (callback) callback(response);
    });
  }

  async stop() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    this.sendMessageWithRetry(tab.id, { action: 'stop' }, (response) => {
      if (response?.success) {
        this.isRunning = false;
        this.updateStatus();
        this.log('已停止浏览', 'warning');
      }
    });
  }

  async resetAndStart() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
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
      quickMode: document.getElementById('quickMode').checked
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

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateConfig',
      config: this.config
    });

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
    chrome.storage.local.get(['linux_do_auto_state'], (result) => {
      const state = result.linux_do_auto_state || {};
      state.accumulatedTime = this.accumulatedTime;
      state.lastStartTime = this.lastStartTime;
      chrome.storage.local.set({ linux_do_auto_state: state });
    });
  }

  log(message, type = 'info') {
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

  saveSettings() { chrome.storage.local.set({ linuxDoConfig: this.config }); }

  loadSettings() {
    chrome.storage.local.get(['linuxDoConfig'], (result) => {
      if (result.linuxDoConfig) {
        this.config = result.linuxDoConfig;
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
      }
    });
  }
}

const controller = new PopupController();

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
