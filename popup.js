// Linux DO 自动浏览 - Popup Script (极简风格)

class PopupController {
  constructor() {
    this.isRunning = false;
    this.stats = {
      totalBrowsed: 0,
      startTime: null,
      errors: 0,
      currentPost: null
    };
    this.accumulatedTime = 0; // 累积运行时间（毫秒）
    this.lastStartTime = null; // 最后一次开始时间
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

    this.init();
  }

  init() {
    this.bindEvents();
    this.loadSettings();
    this.startTimer();
    // 检查状态后更新UI
    this.checkStatus().then(() => {
      this.updateStatus();
    });
  }

  // 检查当前运行状态
  async checkStatus() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('linux.do')) {
      return;
    }

    // 获取存储的状态
    return new Promise((resolve) => {
      chrome.storage.local.get(['linux_do_auto_state'], (result) => {
        if (result.linux_do_auto_state) {
          const state = result.linux_do_auto_state;

          // 同步运行状态
          this.isRunning = state.isRunning || false;

          // 同步统计数据
          if (state.stats) {
            this.stats.totalBrowsed = state.stats.totalBrowsed || 0;
            this.stats.startTime = state.stats.startTime || null;
            this.stats.errors = state.stats.errors || 0;
          }

          // 同步累积运行时间
          this.accumulatedTime = state.accumulatedTime || 0;
          this.lastStartTime = state.lastStartTime || null;
          this.updateStats();

          console.log('[Popup] 恢复状态:', this.isRunning);
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
      chrome.tabs.create({ url: 'https://linux.do/latest' });
    });
  }

  async start() {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab.url || !tab.url.includes('linux.do')) {
      this.log('请在 linux.do 页面使用', 'error');
      return;
    }

    // 发送启动消息到 content script，带重试
    this.sendMessageWithRetry(tab.id, { action: 'start' }, (response) => {
      // 延迟检查：确保响应处理时没有同时执行停止操作
      if (response?.success && this.isRunning) {
        this.updateStatus();
        this.log('开始自动浏览', 'info');
      }
    });
  }

  // 带重试的消息发送
  sendMessageWithRetry(tabId, message, callback, retries = 3) {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        if (retries > 0) {
          // 等待后重试
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

    if (!tab.url || !tab.url.includes('linux.do')) {
      this.log('请在 linux.do 页面使用', 'error');
      return;
    }

    this.sendMessageWithRetry(tab.id, { action: 'resetAndStart' }, (response) => {
      // 延迟检查：确保响应处理时没有同时执行停止操作
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
    // 输入值是秒，转换为毫秒（确保 min < max）
    let minCommentRead = parseFloat(document.getElementById('minCommentRead').value) * 1000;
    let maxCommentRead = parseFloat(document.getElementById('maxCommentRead').value) * 1000;
    let minPageStay = parseInt(document.getElementById('minPageStay').value) * 1000;
    let maxPageStay = parseInt(document.getElementById('maxPageStay').value) * 1000;

    // 确保 min < max
    if (minCommentRead > maxCommentRead) {
      [minCommentRead, maxCommentRead] = [maxCommentRead, minCommentRead];
    }
    if (minPageStay > maxPageStay) {
      [minPageStay, maxPageStay] = [maxPageStay, minPageStay];
    }

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

    // 验证设置
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

    // 发送到 content script
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    chrome.tabs.sendMessage(tab.id, {
      action: 'updateConfig',
      config: this.config
    });

    this.log('设置已更新', 'info');
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

      // 只有在运行时才加上当前这次运行的时间
      if (this.isRunning && this.lastStartTime) {
        totalTime += Date.now() - this.lastStartTime;
      }

      const minutes = Math.floor(totalTime / 60000);
      const seconds = Math.floor((totalTime % 60000) / 1000);

      document.getElementById('runTime').textContent =
        `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }, 1000);
  }

  // 保存运行时间状态
  saveRunTimeState() {
    chrome.storage.local.get(['linux_do_auto_state'], (result) => {
      const state = result.linux_do_auto_state || {};
      state.accumulatedTime = this.accumulatedTime;
      state.lastStartTime = this.lastStartTime;
      chrome.storage.local.set({ linux_do_auto_state: state });
    });
  }

  log(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString('zh-CN', {
      hour: '2-digit',
      minute: '2-digit'
    });

    this.logs.unshift({ message, type, timestamp });

    // 最多保留 30 条日志
    if (this.logs.length > 30) {
      this.logs.pop();
    }

    this.renderLogs();
  }

  renderLogs() {
    const logsContent = document.getElementById('logsContent');

    if (this.logs.length === 0) {
      logsContent.innerHTML = '<div class="log-empty">暂无日志</div>';
      return;
    }

    logsContent.innerHTML = this.logs.map(log => `
      <div class="log-entry log-${log.type}">
        <span class="log-time">${log.timestamp}</span>
        <span class="log-message">${log.message}</span>
      </div>
    `).join('');
  }

  clearLogs() {
    this.logs = [];
    this.renderLogs();
  }

  copyLogs() {
    if (this.logs.length === 0) {
      this.log('没有日志可复制', 'warning');
      return;
    }

    // 将日志转换为文本格式
    const logText = this.logs.map(log => {
      return `[${log.timestamp}] ${log.message}`;
    }).join('\n');

    // 使用不需要授权的复制方式（临时 textarea）
    const textarea = document.createElement('textarea');
    textarea.value = logText;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.select();

    try {
      const successful = document.execCommand('copy');
      document.body.removeChild(textarea);

      if (successful) {
        this.log(`已复制 ${this.logs.length} 条日志`, 'success');
      } else {
        this.log('复制失败', 'error');
      }
    } catch (err) {
      document.body.removeChild(textarea);
      this.log('复制失败: ' + err.message, 'error');
    }
  }

  saveSettings() {
    chrome.storage.local.set({ linuxDoConfig: this.config });
  }

  loadSettings() {
    chrome.storage.local.get(['linuxDoConfig'], (result) => {
      if (result.linuxDoConfig) {
        this.config = result.linuxDoConfig;

        // 更新 UI（转换为秒显示，确保小数显示在前面）
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

// 创建控制器
const controller = new PopupController();

// 监听来自 content script 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.source === 'content') {
    switch (message.type) {
      case 'ready':
        console.log('[Popup] Content script ready');
        break;

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
        // 累积本次运行时间
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

      case 'log':
        controller.log(message.message, 'info');
        break;

      case 'error':
        controller.log(message.message, 'error');
        controller.stats.errors++;
        break;

      case 'configUpdated':
        controller.log('浏览配置已更新', 'info');
        break;
    }
  }

  return true;
});
