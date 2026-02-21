// Linux DO 自动浏览 - Content Script
// 使用持久化存储，支持页面跳转后继续运行

const STORAGE_KEY = 'linux_do_auto_state';
const DAILY_AUTO_KEY = 'linuxDoDailyAuto';
const INTERNAL_LOG_KEY = 'linuxDoInternalLogs';
const INTERNAL_LOG_LIMIT = 50;
const STOP_SIGNAL_KEY = 'linuxDoStopSignalAt';
const DEFAULT_DAILY_AUTO = {
  enabled: true,
  target: 50,
  time: '09:00',
  endTime: '19:00',
  date: '',
  count: 0,
  running: false,
  requireHidden: true
};
const DAILY_AUTO_IDLE_WAIT_MS = 10 * 60 * 1000;
const SITE_ACTIVITY_REPORT_INTERVAL_MS = 15 * 1000;
const DEFAULT_DAILY_AUTO_IDLE = {
  lastActionAt: 0,
  waitUntil: 0,
  pending: false
};

const statsRecorder = typeof StatsRecorder === 'undefined' ? null : StatsRecorder;


class HumanBrowser {
  constructor() {
    this.currentUrl = window.location.href;
    this.config = {
      minScrollDelay: 800,
      maxScrollDelay: 3000,
      minPageStay: 5000,
      maxPageStay: 15000,
      minCommentRead: 1000,
      maxCommentRead: 4000,
      readDepth: 0.7,
      mouseMoveProbability: 0.3,
      clickProbability: 0.6,
      quickMode: false,
      skipDailyIdleWait: false
    };
    this.dailyAuto = { ...DEFAULT_DAILY_AUTO };
    this.dailyAutoWaitTimer = null;
    this.idleStateSaveTimer = null;
    this.activityHandler = null;
    this.lastActivityReportAt = 0;
    this.lastVisibilityReported = null;
    this.pendingSleeps = new Set();
    this.lastStopSignalAt = 0;
    this.storageChangeListenerAttached = false;
    this.handleStorageChangedBound = this.handleStorageChanged.bind(this);
    this.attachStorageChangeListener();

    this.init().catch((error) => {
      const messageText = error?.message || String(error);
      this.recordInternalError('init_failed', messageText);
    });
  }

  isContextValid() {
    return !!chrome?.runtime?.id;
  }

  safeStorageGet(keys) {
    if (!chrome?.storage?.local) return Promise.resolve({});
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(keys, (result) => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            this.recordInternalError('storage_get_failed', lastError.message || 'unknown');
            resolve({});
            return;
          }
          resolve(result || {});
        });
      } catch (error) {
        const messageText = error?.message || String(error);
        this.recordInternalError('storage_get_threw', messageText);
        resolve({});
      }
    });
  }

  safeStorageSet(payload) {
    if (!chrome?.storage?.local) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.set(payload, () => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            this.recordInternalError('storage_set_failed', lastError.message || 'unknown');
          }
          resolve();
        });
      } catch (error) {
        const messageText = error?.message || String(error);
        this.recordInternalError('storage_set_threw', messageText);
        resolve();
      }
    });
  }

  safeStorageRemove(keys) {
    if (!chrome?.storage?.local) return Promise.resolve();
    return new Promise((resolve) => {
      try {
        chrome.storage.local.remove(keys, () => {
          const lastError = chrome.runtime?.lastError;
          if (lastError) {
            this.recordInternalError('storage_remove_failed', lastError.message || 'unknown');
          }
          resolve();
        });
      } catch (error) {
        const messageText = error?.message || String(error);
        this.recordInternalError('storage_remove_threw', messageText);
        resolve();
      }
    });
  }

  // 从存储加载状态
  async loadState() {
    const result = await this.safeStorageGet([STORAGE_KEY]);
    return result[STORAGE_KEY] || {
      isRunning: false,
      browsedPosts: [],
      stats: {
        totalBrowsed: 0,
        startTime: null,
        errors: 0
      },
      accumulatedTime: 0,
      lastStartTime: null,
      config: this.config,
      dailyAutoIdle: { ...DEFAULT_DAILY_AUTO_IDLE }
    };
  }

  // 保存状态到存储
  async saveState(state) {
    await this.safeStorageSet({ [STORAGE_KEY]: state });
  }

  getTodayString() {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  parseDateString(dateStr) {
    if (!dateStr || typeof dateStr !== 'string') return null;
    const parts = dateStr.split('-');
    if (parts.length !== 3) return null;
    const year = Number(parts[0]);
    const month = Number(parts[1]);
    const day = Number(parts[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return new Date(year, month - 1, day, 0, 0, 0, 0);
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

  getDailyAutoWindow(dateStr, startTime, endTime) {
    const baseDate =
      this.parseDateString(dateStr) || this.parseDateString(this.getTodayString()) || new Date();
    const startParts = this.parseDailyTime(startTime);
    const endParts = this.parseDailyTime(endTime);
    const startDate = new Date(baseDate);
    startDate.setHours(startParts.hour, startParts.minute, 0, 0);
    const endDate = new Date(baseDate);
    endDate.setHours(endParts.hour, endParts.minute, 0, 0);
    if (endDate <= startDate) {
      endDate.setDate(endDate.getDate() + 1);
    }
    return { startMs: startDate.getTime(), endMs: endDate.getTime() };
  }

  normalizeDailyAuto(raw) {
    const today = this.getTodayString();
    const config = { ...DEFAULT_DAILY_AUTO, ...(raw || {}) };
    config.time = this.normalizeDailyTime(config.time);
    config.endTime = this.defaultDailyEndTime(config.time);
    config.requireHidden = config.requireHidden === true;
    const normalizedDate = this.parseDateString(config.date) ? config.date : today;
    config.date = normalizedDate;
    const window = this.getDailyAutoWindow(config.date, config.time, config.endTime);
    const now = Date.now();
    if (config.date !== today && (!config.running || now >= window.endMs)) {
      config.date = today;
      config.count = 0;
      config.running = false;
    }
    if (!config.target || config.target < 1) {
      config.target = DEFAULT_DAILY_AUTO.target;
    }
    return config;
  }

  normalizeDailyAutoIdle(raw) {
    const base = raw && typeof raw === 'object' ? raw : {};
    return {
      lastActionAt: Number.isFinite(base.lastActionAt) ? base.lastActionAt : 0,
      waitUntil: Number.isFinite(base.waitUntil) ? base.waitUntil : 0,
      pending: base.pending === true
    };
  }

  getDailyAutoWaitMs() {
    return this.config.skipDailyIdleWait ? 0 : DAILY_AUTO_IDLE_WAIT_MS;
  }

  async loadDailyAuto() {
    const result = await this.safeStorageGet([DAILY_AUTO_KEY]);
    const stored = result[DAILY_AUTO_KEY];
    const normalized = this.normalizeDailyAuto(stored);
    const shouldSave =
      !stored ||
      stored.time !== normalized.time ||
      stored.endTime !== normalized.endTime ||
      stored.date !== normalized.date ||
      stored.enabled !== normalized.enabled;
    if (shouldSave) {
      await this.safeStorageSet({ [DAILY_AUTO_KEY]: normalized });
    }
    return normalized;
  }

  async saveDailyAuto(config) {
    await this.safeStorageSet({ [DAILY_AUTO_KEY]: config });
  }

  isDailyAutoRunning() {
    return this.dailyAuto?.running === true;
  }

  isQuickModeEnabled() {
    return this.config.quickMode && !this.isDailyAutoRunning();
  }

  initUserActivityTracking() {
    if (this.activityHandler) return;
    this.activityHandler = () => this.recordUserActivity();
    const events = ['pointerdown', 'keydown', 'wheel', 'scroll', 'touchstart', 'mousedown'];
    events.forEach((eventName) => {
      window.addEventListener(eventName, this.activityHandler, { passive: true, capture: true });
    });
    document.addEventListener('visibilitychange', () => {
      this.reportVisibilityState();
      if (document.visibilityState === 'visible') {
        this.recordUserActivity();
      }
    });
    this.reportVisibilityState(true);
  }

  recordUserActivity() {
    if (!this.state?.dailyAutoIdle) return;
    this.reportSiteActivity();
    const now = Date.now();
    this.state.dailyAutoIdle.lastActionAt = now;
    if (this.state.dailyAutoIdle.pending) {
      const waitMs = this.getDailyAutoWaitMs();
      if (waitMs <= 0) {
        this.tryStartPendingDailyAuto();
      } else {
        this.state.dailyAutoIdle.waitUntil = now + waitMs;
        this.scheduleIdleStateSave();
        this.scheduleDailyAutoWaitCheck();
      }
    }
  }

  reportVisibilityState(force = false) {
    const visible = document.visibilityState === 'visible';
    if (!force && this.lastVisibilityReported === visible) return;
    this.lastVisibilityReported = visible;
    this.sendMessage({ type: 'siteVisibility', visible, at: Date.now() });
  }

  reportSiteActivity() {
    const now = Date.now();
    if (now - this.lastActivityReportAt < SITE_ACTIVITY_REPORT_INTERVAL_MS) return;
    this.lastActivityReportAt = now;
    this.sendMessage({ type: 'siteActivity', at: now });
  }

  scheduleIdleStateSave() {
    if (this.idleStateSaveTimer) return;
    this.idleStateSaveTimer = setTimeout(() => {
      this.idleStateSaveTimer = null;
      if (this.state) {
        this.saveState(this.state);
      }
    }, 500);
  }

  clearDailyAutoWaitTimer() {
    if (this.dailyAutoWaitTimer) {
      clearTimeout(this.dailyAutoWaitTimer);
      this.dailyAutoWaitTimer = null;
    }
  }

  scheduleDailyAutoWaitCheck() {
    if (!this.state?.dailyAutoIdle?.pending) return;
    const waitUntil = this.state.dailyAutoIdle.waitUntil;
    if (!waitUntil) return;
    this.clearDailyAutoWaitTimer();
    const delay = Math.max(0, waitUntil - Date.now());
    this.dailyAutoWaitTimer = setTimeout(() => {
      this.tryStartPendingDailyAuto();
    }, delay);
  }

  async tryStartPendingDailyAuto() {
    if (!this.state?.dailyAutoIdle?.pending) return;
    const waitMs = this.getDailyAutoWaitMs();
    if (waitMs <= 0) {
      await this.beginDailyAuto();
      return;
    }
    const lastActionAt = this.state.dailyAutoIdle.lastActionAt || 0;
    const waitUntil = Math.max(this.state.dailyAutoIdle.waitUntil || 0, lastActionAt + waitMs);
    if (Date.now() < waitUntil) {
      this.state.dailyAutoIdle.waitUntil = waitUntil;
      this.scheduleIdleStateSave();
      this.scheduleDailyAutoWaitCheck();
      return;
    }
    await this.beginDailyAuto();
  }

  async beginDailyAuto() {
    if (!this.state?.dailyAutoIdle) return;
    this.state.dailyAutoIdle.pending = false;
    this.state.dailyAutoIdle.waitUntil = 0;
    this.clearDailyAutoWaitTimer();
    await this.saveState(this.state);
    if (!this.dailyAuto?.enabled) {
      this.dailyAuto.running = false;
      await this.saveDailyAuto(this.dailyAuto);
      return;
    }
    if (await this.checkDailyAutoDeadline()) return;
    if (!this.state.isRunning) {
      await this.start();
    }
  }

  async armDailyAutoWait(skipIdleWait = false) {
    const waitMs = skipIdleWait ? 0 : this.getDailyAutoWaitMs();
    if (waitMs <= 0) {
      if (skipIdleWait) {
        this.sendMessage({ type: 'log', message: '后台静置条件已满足，开始执行每日任务' });
      }
      await this.beginDailyAuto();
      return;
    }
    if (!this.state?.dailyAutoIdle) return;
    this.state.dailyAutoIdle.pending = true;
    const now = Date.now();
    const lastActionAt = this.state.dailyAutoIdle.lastActionAt || now;
    if (!this.state.dailyAutoIdle.lastActionAt) {
      this.state.dailyAutoIdle.lastActionAt = now;
    }
    const elapsed = now - lastActionAt;
    if (elapsed >= waitMs) {
      await this.beginDailyAuto();
      return;
    }
    this.state.dailyAutoIdle.waitUntil = lastActionAt + waitMs;
    await this.saveState(this.state);
    this.scheduleDailyAutoWaitCheck();
    this.sendMessage({ type: 'log', message: '等待 10 分钟无操作后执行每日任务' });
  }

  async resumePendingDailyAuto() {
    if (!this.state?.dailyAutoIdle?.pending) return;
    if (this.state.isRunning) {
      this.state.dailyAutoIdle.pending = false;
      this.state.dailyAutoIdle.waitUntil = 0;
      this.scheduleIdleStateSave();
      return;
    }
    await this.tryStartPendingDailyAuto();
  }

  async updateDailyAutoProgress(isNewPost) {
    if (!this.isDailyAutoRunning()) return false;
    if (await this.checkDailyAutoDeadline()) return true;
    if (isNewPost) {
      this.dailyAuto.count += 1;
      await this.saveDailyAuto(this.dailyAuto);
    }
    return false;
  }

  async finishDailyAuto(reason = '每日任务完成，已停止') {
    this.dailyAuto.running = false;
    await this.saveDailyAuto(this.dailyAuto);
    this.state.isRunning = false;
    this.releasePendingSleeps();
    this.stopRunTimer();
    if (this.state.dailyAutoIdle) {
      this.state.dailyAutoIdle.pending = false;
      this.state.dailyAutoIdle.waitUntil = 0;
    }
    this.clearDailyAutoWaitTimer();
    await this.saveState(this.state);
    this.sendMessage({ type: 'log', message: reason });
    this.sendMessage({ type: 'stopped' });
  }

  async checkDailyAutoDeadline() {
    if (!this.isDailyAutoRunning()) return false;
    this.dailyAuto.endTime = this.defaultDailyEndTime(this.dailyAuto.time);
    const window = this.getDailyAutoWindow(
      this.dailyAuto.date || this.getTodayString(),
      this.dailyAuto.time,
      this.dailyAuto.endTime
    );
    if (Date.now() < window.endMs) return false;
    await this.finishDailyAuto('已到每日结束时间，已停止');
    return true;
  }

  startRunTimer() {
    if (!this.state.lastStartTime) {
      this.state.lastStartTime = Date.now();
    }
  }

  stopRunTimer() {
    if (this.state.lastStartTime) {
      this.state.accumulatedTime += Date.now() - this.state.lastStartTime;
      this.state.lastStartTime = null;
    }
  }

  // 清除状态
  async clearState() {
    await this.safeStorageRemove([STORAGE_KEY]);
  }

  async init() {
    console.log('[Linux DO Auto] 初始化', window.location.pathname);

    // 加载保存的状态
    const state = await this.loadState();
    this.state = state;
    const stopSignalResult = await this.safeStorageGet([STOP_SIGNAL_KEY]);
    this.lastStopSignalAt = Number(stopSignalResult[STOP_SIGNAL_KEY]) || 0;
    if (this.state.isRunning && this.lastStopSignalAt && this.state.lastStartTime && this.lastStopSignalAt >= this.state.lastStartTime) {
      await this.stop();
    }
    this.state.dailyAutoIdle = this.normalizeDailyAutoIdle(this.state.dailyAutoIdle);
    this.config = { ...this.config, ...(state.config || {}) };
    this.dailyAuto = await this.loadDailyAuto();
    this.initUserActivityTracking();
    if (this.state.isRunning && !this.state.lastStartTime) {
      this.state.lastStartTime = Date.now();
      await this.saveState(this.state);
    }
    await this.checkDailyAutoDeadline();
    await this.resumePendingDailyAuto();

    console.log('[Linux DO Auto] 状态加载完成', {
      isRunning: state.isRunning,
      isPostPage: this.isPostPage(),
      isListPage: this.isListPage()
    });

    // 如果正在运行，根据当前页面类型继续执行
    if (this.state.isRunning) {
      console.log('[Linux DO Auto] 检测到正在运行，继续执行');

      if (this.isPostPage()) {
        await this.handlePostPage();
      } else if (this.isListPage()) {
        await this.handleListPage();
      }
    }

    this.sendMessage({ type: 'ready', url: this.currentUrl });
    console.log('[Linux DO Auto] 初始化完成，等待指令');
  }

  // 判断是否是帖子页面
  isPostPage() {
    // 匹配 /t/topic/数字 或 /t/topic/数字/数字 格式
    return window.location.pathname.match(/^\/t\/topic\/\d+(\/\d+)?$/);
  }

  // 判断是否是列表页面
  isListPage() {
    return window.location.pathname.match(/^\/(latest|top|hot)?$/);
  }

  random(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  randomFloat(min, max) {
    return Math.random() * (max - min) + min;
  }

  async humanScroll() {
    const scrollHeight = document.body.scrollHeight;
    const targetScroll = Math.floor(scrollHeight * this.config.readDepth);

    let currentScroll = window.scrollY;
    const scrollSteps = this.random(4, 8);

    for (let i = 0; i < scrollSteps; i++) {
      const stepSize = Math.floor((targetScroll - currentScroll) / (scrollSteps - i));
      const randomStep = Math.floor(stepSize * this.randomFloat(0.6, 1.4));
      currentScroll += randomStep;

      window.scrollTo({
        top: currentScroll,
        behavior: 'smooth'
      });

      await this.sleep(this.random(this.config.minScrollDelay, this.config.maxScrollDelay));

      if (Math.random() < this.config.mouseMoveProbability) {
        this.randomMouseMove();
      }
    }
  }

  randomMouseMove() {
    const x = this.random(100, window.innerWidth - 100);
    const y = this.random(100, window.innerHeight - 100);
    const event = new MouseEvent('mousemove', {
      bubbles: true,
      clientX: x,
      clientY: y
    });
    document.dispatchEvent(event);
  }

  sleep(ms) {
    return new Promise((resolve) => {
      const sleepHandle = {
        timerId: null,
        resolve
      };
      sleepHandle.timerId = setTimeout(() => {
        if (!this.pendingSleeps.delete(sleepHandle)) {
          return;
        }
        resolve();
      }, ms);
      this.pendingSleeps.add(sleepHandle);
    });
  }

  releasePendingSleeps() {
    if (!this.pendingSleeps.size) return;
    const pending = Array.from(this.pendingSleeps);
    this.pendingSleeps.clear();
    pending.forEach((sleepHandle) => {
      clearTimeout(sleepHandle.timerId);
      sleepHandle.resolve();
    });
  }

  attachStorageChangeListener() {
    if (this.storageChangeListenerAttached || !chrome?.storage?.onChanged) return;
    chrome.storage.onChanged.addListener(this.handleStorageChangedBound);
    this.storageChangeListenerAttached = true;
  }

  handleStorageChanged(changes, area) {
    if (area !== 'local' || !changes?.[STOP_SIGNAL_KEY]) return;
    const signal = Number(changes[STOP_SIGNAL_KEY].newValue) || 0;
    if (!signal || signal <= this.lastStopSignalAt) return;
    this.lastStopSignalAt = signal;
    if (!this.state || (!this.state.isRunning && !this.isDailyAutoRunning())) return;
    this.stop().catch((error) => {
      const messageText = error?.message || String(error);
      this.recordInternalError('stop_from_signal_failed', messageText);
    });
  }

  getPostLinks() {
    const links = new Set();
    const topicLinks = document.querySelectorAll('a[href^="/t/topic/"]');

    topicLinks.forEach(link => {
      const href = link.getAttribute('href');
      if (href && href.match(/^\/t\/topic\/\d+$/)) {
        links.add(href);
      }
    });

    return Array.from(links);
  }

  // 获取帖子内所有评论
  getPostComments() {
    // linux.do 使用 data-post-number 属性标识每个评论
    const comments = document.querySelectorAll('[data-post-number]');
    return Array.from(comments)
      // 按 postNumber 升序排序，确保顺序处理
      .sort((a, b) => {
        const numA = parseInt(a.getAttribute('data-post-number') || '0');
        const numB = parseInt(b.getAttribute('data-post-number') || '0');
        return numA - numB;
      });
  }

  // 检查评论是否有未读标记（小蓝点）
  checkCommentUnread(commentElement) {
    // linux.do 可能的未读标记位置：
    // 1. 评论内部的 .new-indicator 元素
    // 2. 评论本身的 .unread 类
    // 3. data-unread 属性
    // 4. 评论时间旁边的未读图标
    // 5. Discourse 的 new-user-posts 或 new-posts

    // 方法1: 检查评论内是否有 .new-indicator
    const newIndicator = commentElement.querySelector('.new-indicator');
    if (newIndicator) {
      return true;
    }

    // 方法2: 检查评论本身是否有 .unread 类
    if (commentElement.classList.contains('unread')) {
      return true;
    }

    // 方法3: 检查 data-unread 属性
    if (commentElement.hasAttribute('data-unread') &&
        commentElement.getAttribute('data-unread') !== 'false') {
      return true;
    }

    // 方法4: 检查常见的未读图标类名（Discourse 常见）
    const unreadBadge = commentElement.querySelector('.badge-notification.unread, .new-posts, .new-user-posts');
    if (unreadBadge) {
      return true;
    }

    // 方法5: 检查评论的父级是否有未读标记（有时标记在容器上）
    const parent = commentElement.closest('.topic-post, .post, article');
    if (parent) {
      const parentUnread = parent.querySelector('.new-indicator, .badge-notification.unread, .new-posts, .new-user-posts');
      if (parentUnread) {
        return true;
      }
    }

    // 方法6: 检查时间戳附近是否有未读标记（常见 Discourse 结构）
    const postInfo = commentElement.querySelector('.post-info, .topic-meta, .map');
    if (postInfo) {
      const infoUnread = postInfo.querySelector('.new-posts, .unread, .new-indicator');
      if (infoUnread) {
        return true;
      }
    }

    // 方法7: 检查评论ID链接是否有未读类
    const postLink = commentElement.querySelector('a[href*="/p/"], .post-number');
    if (postLink && (postLink.classList.contains('unread') ||
                      postLink.querySelector('.unread, .new-indicator'))) {
      return true;
    }

    return false;
  }

  // 逐个浏览评论（模拟人类阅读），支持动态加载
  async browseCommentsSlowly() {
    // 记录最后浏览的评论 postNumber，而不是 index（更可靠）
    let lastPostNumber = this.state.lastPostNumber || null;
    let lastCommentCount = 0;
    let noNewCommentsCount = 0;
    const maxNoNewComments = 2; // 连续2次没有新评论就停止（减少等待）
    let sameLocationCount = 0; // 检测是否卡在同一位置

    while (noNewCommentsCount < maxNoNewComments) {
      if (await this.checkDailyAutoDeadline()) return;
      // 检查是否已停止或切换到快速模式
      if (!this.state.isRunning || this.isQuickModeEnabled()) {
        if (this.isQuickModeEnabled()) {
          this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
        } else {
          this.sendMessage({ type: 'log', message: '浏览已停止' });
        }
        return;
      }

      // 检查是否离开了当前帖子（允许URL中添加页码，如 /t/topic/123 -> /t/topic/123/45）
      const currentPath = window.location.pathname;
      const currentTopicMatch = currentPath.match(/^\/t\/topic\/(\d+)/);
      const originalTopicMatch = this.currentUrl.match(/^\/t\/topic\/(\d+)/);

      if (currentTopicMatch && originalTopicMatch) {
        // 都在帖子页面，检查帖子ID是否相同
        if (currentTopicMatch[1] !== originalTopicMatch[1]) {
          this.sendMessage({ type: 'log', message: `已切换到不同帖子 ${currentTopicMatch[1]}，停止浏览` });
          return;
        }
        // 帖子ID相同，更新当前URL（允许页码变化）
        if (currentPath !== this.currentUrl) {
          this.currentUrl = currentPath;
          this.sendMessage({ type: 'log', message: `URL更新为: ${currentPath}` });
        }
      } else {
        // 不在帖子页面了
        if (!currentPath.match(/^\/t\/topic\//)) {
          this.sendMessage({ type: 'log', message: '已离开帖子页面，停止浏览' });
          return;
        }
      }

      // 每次循环都重新获取评论（处理动态加载）
      const comments = this.getPostComments();
      const currentCount = comments.length;

      if (currentCount > lastCommentCount) {
        // 有新评论加载
        this.sendMessage({ type: 'log', message: `发现新评论，总计 ${currentCount} 条` });
        lastCommentCount = currentCount;
        noNewCommentsCount = 0;

        // 找到上次浏览位置的索引
        let startIndex = 0;
        if (lastPostNumber) {
          for (let i = 0; i < comments.length; i++) {
            if (comments[i].getAttribute('data-post-number') === lastPostNumber) {
              startIndex = i + 1; // 从下一条开始
              break;
            }
          }
        }

        this.sendMessage({ type: 'log', message: `从第 ${startIndex + 1} 条评论开始浏览` });

        for (let i = startIndex; i < comments.length; i++) {
          if (await this.checkDailyAutoDeadline()) return;
          // 每次循环都检查状态和配置
          if (!this.state.isRunning || this.isQuickModeEnabled()) {
            if (this.isQuickModeEnabled()) {
              this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
            } else {
              this.sendMessage({ type: 'log', message: '浏览已停止' });
            }
            return;
          }

          const comment = comments[i];
          const postNumber = comment.getAttribute('data-post-number');

          // 检查是否已经处理过这条评论（防止倒退）
          if (lastPostNumber && parseInt(postNumber) <= parseInt(lastPostNumber)) {
            this.sendMessage({ type: 'log', message: `跳过评论 ${postNumber}` });
            continue;
          }

          // 获取评论位置信息
          const commentRect = comment.getBoundingClientRect();
          const isVisible = commentRect.top < window.innerHeight && commentRect.bottom > 0;

          this.sendMessage({ type: 'log', message: `浏览评论 ${postNumber}` });

          // 只有当评论不可见时才滚动
          if (!isVisible || commentRect.top < 100 || commentRect.top > window.innerHeight - 100) {
            const targetY = window.scrollY + commentRect.top - window.innerHeight / 2;
            window.scrollTo({
              top: Math.max(0, targetY),
              behavior: 'instant'
            });
            await this.sleep(300);
          }

          // 滚动后再次检查状态
          if (!this.state.isRunning || this.isQuickModeEnabled()) {
            if (this.isQuickModeEnabled()) {
              this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
            } else {
              this.sendMessage({ type: 'log', message: '浏览已停止' });
            }
            return;
          }

          // 等待未读标记渲染（关键修复：给页面时间渲染未读状态）
          await this.sleep(1200);

          // 再次检查状态（等待期间可能被停止）
          if (!this.state.isRunning || this.isQuickModeEnabled()) {
            if (this.isQuickModeEnabled()) {
              this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
            } else {
              this.sendMessage({ type: 'log', message: '浏览已停止' });
            }
            return;
          }

          // 检查是否有未读标记（小蓝点）
          const hasUnreadMarker = this.checkCommentUnread(comment);

          if (!hasUnreadMarker) {
            // 已读评论，跳过等待但仍标记为已处理
            this.sendMessage({ type: 'log', message: `评论 ${postNumber} 已读` });
            lastPostNumber = postNumber;
            this.state.lastPostNumber = lastPostNumber;
            await this.saveState(this.state);
            continue;
          }

          // 使用配置的阅读时间范围
          const readTime = this.random(this.config.minCommentRead, this.config.maxCommentRead);

          this.sendMessage({ type: 'log', message: `阅读评论 ${postNumber}/${currentCount} (${Math.round(readTime / 1000)}秒)` });
          await this.sleep(readTime);

          // 偶尔移动鼠标
          if (Math.random() < this.config.mouseMoveProbability) {
            this.randomMouseMove();
          }

          // 保存当前浏览位置
          lastPostNumber = postNumber;
          this.state.lastPostNumber = lastPostNumber;
          await this.saveState(this.state);
        }

        // 浏览完当前所有评论后，尝试加载更多
        this.sendMessage({ type: 'log', message: '尝试加载更多评论...' });

        // 记录当前滚动位置
        const beforeBottomScroll = window.scrollY;
        const scrollHeight = document.body.scrollHeight;

        // 小幅滚动到底部触发加载
        window.scrollTo({
          top: scrollHeight - window.innerHeight - 100,
          behavior: 'instant'
        });

        // 等待可能的动态加载
        await this.sleep(2000);

        // 检查是否有新内容加载
        const newComments = this.getPostComments();
        if (newComments.length <= currentCount) {
          // 没有新内容，检测是否卡在同一位置
          const afterScrollY = window.scrollY;
          if (Math.abs(afterScrollY - beforeBottomScroll) < 50) {
            sameLocationCount++;
            if (sameLocationCount >= 2) {
              this.sendMessage({ type: 'log', message: '检测到无法加载更多，停止' });
              break;
            }
          }
        } else {
          sameLocationCount = 0;
        }

      } else {
        // 没有新评论
        noNewCommentsCount++;
        this.sendMessage({ type: 'log', message: `等待新评论... (${noNewCommentsCount}/${maxNoNewComments})` });

        // 等待后再检查
        await this.sleep(2000);
      }
    }

    // 重置浏览位置
    this.state.lastPostNumber = null;
    this.state.lastCommentIndex = 0;
    await this.saveState(this.state);
    this.sendMessage({ type: 'log', message: '所有评论已浏览完毕' });
  }

  // 处理帖子页面
  async handlePostPage() {
    const postUrl = window.location.pathname;

    this.sendMessage({ type: 'log', message: `正在浏览帖子: ${postUrl}` });
    if (await this.checkDailyAutoDeadline()) return;

    // 检查是否已浏览
    if (this.state.browsedPosts.includes(postUrl)) {
      this.sendMessage({ type: 'log', message: '已浏览过，返回列表' });
      if (this.state.isRunning) {
        this.navigateToLatest();
      }
      return;
    }

    // 新帖子：重置浏览位置，确保从头开始
    this.state.lastPostNumber = null;
    this.state.lastCommentIndex = 0;
    await this.saveState(this.state);

    // 添加到已浏览列表
    const isNewPost = !this.state.browsedPosts.includes(postUrl);
    if (isNewPost) {
      this.state.browsedPosts.push(postUrl);
      this.state.stats.totalBrowsed++;
    }

    // 等待页面稳定
    await this.sleep(this.random(1500, 2500));

    // 随机鼠标移动
    this.randomMouseMove();

    // 快速浏览模式：跳过评论，停留5-10秒
    let stayTime = 0; // 用于统计记录
    if (this.isQuickModeEnabled()) {
      this.sendMessage({ type: 'log', message: '快速浏览模式：跳过评论' });

      // 检查是否已停止（在输出日志后、sleep前检查）
      if (!this.state.isRunning) {
        this.sendMessage({ type: 'log', message: '已停止' });
        return;
      }

      stayTime = this.random(5000, 10000);
      this.sendMessage({ type: 'log', message: `停留阅读 ${Math.floor(stayTime / 1000)}秒` });
      await this.sleep(stayTime);
    } else {
      // 正常模式：逐个浏览评论（模拟人类阅读）
      await this.browseCommentsSlowly();

      // 检查是否还在运行
      if (!this.state.isRunning) {
        this.sendMessage({ type: 'log', message: '已停止，不跳转' });
        return;
      }

      // 停留阅读时间
      stayTime = this.random(this.config.minPageStay, this.config.maxPageStay);

      // 在输出日志和 sleep 前再次检查
      if (!this.state.isRunning) {
        this.sendMessage({ type: 'log', message: '已停止' });
        return;
      }

      this.sendMessage({ type: 'log', message: `停留阅读 ${Math.floor(stayTime / 1000)}秒` });
      await this.sleep(stayTime);
    }

    // 再次检查是否还在运行
    if (!this.state.isRunning) {
      this.sendMessage({ type: 'log', message: '已停止，不跳转' });
      return;
    }

    if (await this.checkDailyAutoDeadline()) return;

    // 更新统计
    this.sendMessage({
      type: 'stats',
      stats: {
        ...this.state.stats,
        currentPost: postUrl
      }
    });

    // 保存状态
    await this.saveState(this.state);

    // 记录到统计数据（新增）
    if (statsRecorder && isNewPost) {
      try {
        // 使用停留时间作为浏览时长（包含评论阅读时间）
        await statsRecorder.record({ posts: 1, durationMs: stayTime, hasError: false });
      } catch (e) {
        console.warn('[Stats] 记录失败:', e);
      }
    }

    const dailyDone = await this.updateDailyAutoProgress(isNewPost);
    if (dailyDone) return;

    // 返回列表
    this.sendMessage({ type: 'log', message: '返回列表继续' });
    if (this.state.isRunning) {
      this.navigateToLatest();
    }
  }

  // 处理列表页面
  async handleListPage() {
    await this.sleep(this.random(1500, 2500));

    // 检查是否还在运行
    if (!this.state.isRunning) {
      this.sendMessage({ type: 'log', message: '已停止' });
      return;
    }

    if (await this.checkDailyAutoDeadline()) return;

    const posts = this.getPostLinks();
    this.sendMessage({ type: 'log', message: `找到 ${posts.length} 个帖子` });

    // 过滤已浏览的帖子
    const unbrowsed = posts.filter(url => !this.state.browsedPosts.includes(url));

    if (unbrowsed.length === 0) {
      this.sendMessage({ type: 'log', message: '当前页所有帖子已浏览，等待60秒后刷新...' });

      // 等待60秒（给服务器喘息时间）
      for (let i = 0; i < 60; i++) {
        if (!this.state.isRunning) {
          this.sendMessage({ type: 'log', message: '已停止，不刷新' });
          return;
        }
        if (await this.checkDailyAutoDeadline()) return;
        await this.sleep(1000);
      }

      // 刷新页面继续
      this.sendMessage({ type: 'log', message: '刷新页面获取新内容' });
      if (this.state.isRunning) {
        location.reload();
      }
      return;
    }

    // 按顺序选择下一个未浏览帖子（更稳定）
    const nextPost = unbrowsed[0];

    // 检查是否还在运行
    if (!this.state.isRunning) {
      this.sendMessage({ type: 'log', message: '已停止' });
      return;
    }

    this.sendMessage({ type: 'log', message: `跳转到: ${nextPost} (剩余 ${unbrowsed.length - 1} 个)` });
    await this.sleep(this.random(1000, 2000));

    if (this.state.isRunning) {
      this.navigateToPost(nextPost);
    }
  }

  navigateToPost(url) {
    window.location.href = url;
  }

  async navigateToLatest() {
    const baseUrl = await this.getCurrentBaseUrl();
    window.location.href = `${baseUrl}/latest`;
  }

  async getCurrentBaseUrl() {
    const result = await this.safeStorageGet(['useIdcflareSite']);
    const useIdcflare = result.useIdcflareSite || false;
    return useIdcflare ? 'https://idcflare.com' : 'https://linux.do';
  }

  // 开始浏览（不清空历史记录）
  async startDaily(target, date, options = {}) {
    this.dailyAuto = await this.loadDailyAuto();
    if (!this.dailyAuto.enabled) {
      this.sendMessage({ type: 'log', message: '每日自动浏览已关闭' });
      return;
    }
    const today = this.getTodayString();
    this.dailyAuto.date = date || today;
    this.dailyAuto.count = 0;
    this.dailyAuto.time = this.normalizeDailyTime(this.dailyAuto.time);
    this.dailyAuto.endTime = this.defaultDailyEndTime(this.dailyAuto.time);
    this.dailyAuto.running = true;
    await this.saveDailyAuto(this.dailyAuto);
    await this.armDailyAutoWait(options.skipIdleWait === true);
  }
  async start() {
    console.log('[Linux DO Auto] 开始浏览，保留历史记录');

    this.state.isRunning = true;
    this.startRunTimer();

    // 只有第一次运行或重置后才设置开始时间
    if (!this.state.stats.startTime) {
      this.state.stats.startTime = Date.now();
    }

    await this.saveState(this.state);

    this.sendMessage({ type: 'started' });

    // 根据当前页面类型处理
    if (this.isPostPage()) {
      await this.handlePostPage();
    } else {
      await this.handleListPage();
    }
  }

  // 重置并开始新的一轮浏览
  async resetAndStart() {
    console.log('[Linux DO Auto] 重置并开始新浏览');

    this.state.isRunning = true;
    this.state.stats.startTime = Date.now();
    this.state.browsedPosts = [];
    this.state.stats.totalBrowsed = 0;
    this.state.stats.errors = 0;
    // 重置累积运行时间
    this.state.accumulatedTime = 0;
    this.state.lastStartTime = Date.now();

    await this.saveState(this.state);

    this.sendMessage({ type: 'started' });

    // 根据当前页面类型处理
    if (this.isPostPage()) {
      await this.handlePostPage();
    } else {
      await this.handleListPage();
    }
  }

  // 停止浏览
  async stop() {
    console.log('[Linux DO Auto] 停止浏览');

    this.state.isRunning = false;
    this.releasePendingSleeps();
    this.stopRunTimer();
    if (this.state.dailyAutoIdle) {
      this.state.dailyAutoIdle.pending = false;
      this.state.dailyAutoIdle.waitUntil = 0;
    }
    this.clearDailyAutoWaitTimer();
    await this.saveState(this.state);
    if (this.isDailyAutoRunning()) {
      this.dailyAuto.running = false;
      await this.saveDailyAuto(this.dailyAuto);
    }

    this.sendMessage({ type: 'stopped' });
    console.log('[Linux DO Auto] 停止完成');
  }

  // 更新配置
  async updateConfig(newConfig) {
    const wasSkipDailyIdleWait = this.config.skipDailyIdleWait;
    this.config = { ...this.config, ...newConfig };
    this.state.config = this.config;
    await this.saveState(this.state);
    this.sendMessage({ type: 'configUpdated', config: this.config });
    if (!wasSkipDailyIdleWait && this.config.skipDailyIdleWait && this.state?.dailyAutoIdle?.pending) {
      await this.beginDailyAuto();
    }
  }

  recordInternalError(reason, detail) {
    if (!chrome?.storage?.local) return;
    const entry = {
      at: Date.now(),
      reason,
      detail,
      url: window.location.href
    };
    try {
      chrome.storage.local.get([INTERNAL_LOG_KEY], (result) => {
        const lastError = chrome.runtime?.lastError;
        const baseLogs = lastError ? [] : (Array.isArray(result[INTERNAL_LOG_KEY]) ? result[INTERNAL_LOG_KEY] : []);
        baseLogs.unshift(entry);
        if (baseLogs.length > INTERNAL_LOG_LIMIT) baseLogs.length = INTERNAL_LOG_LIMIT;
        try {
          chrome.storage.local.set({ [INTERNAL_LOG_KEY]: baseLogs }, () => {
            const setError = chrome.runtime?.lastError;
            if (setError) {
              return;
            }
          });
        } catch (error) {
          return;
        }
      });
    } catch (error) {
      return;
    }
  }

  sendMessage(message) {
    handleLocalStatusMessage(this, message);
    if (!chrome?.runtime?.id) {
      this.recordInternalError('runtime_unavailable', 'runtime.id missing');
      return;
    }

    try {
      chrome.runtime.sendMessage({
        ...message,
        source: 'content',
        url: window.location.href
      }, () => {
        const lastError = chrome.runtime.lastError;
        if (lastError) {
          this.recordInternalError('runtime_send_failed', lastError.message || 'unknown');
        }
      });
    } catch (error) {
      const messageText = error?.message || String(error);
      this.recordInternalError('runtime_send_threw', messageText);
    }
  }
}

const LOGO_BADGE_ID = 'ldo-logo-badge';
const LOGO_BADGE_LOG_ID = 'ldo-logo-badge-log';
const LOGO_BADGE_MARGIN = 16;
const LOGO_BADGE_SIZE = 96;

const logoBadgeState = {
  badge: null,
  logEl: null,
  running: false
};

const ensureLogoBadge = () => {
  if (window.top !== window) return;
  if (logoBadgeState.badge) return;
  if (!chrome?.runtime?.id) return;

  const mount = document.body || document.documentElement;
  if (!mount) return;

  const badge = document.createElement('div');
  badge.id = LOGO_BADGE_ID;
  badge.style.position = 'absolute';
  badge.style.zIndex = '2147483647';
  badge.style.width = `${LOGO_BADGE_SIZE}px`;
  badge.style.height = 'auto';
  badge.style.pointerEvents = 'none';
  badge.style.userSelect = 'none';
  badge.style.opacity = '0.9';
  badge.style.left = '0px';
  badge.style.top = '0px';

  const img = document.createElement('img');
  img.src = chrome.runtime.getURL('icons/logo.png');
  img.alt = 'Linux DO Logo';
  img.decoding = 'async';
  img.loading = 'lazy';
  img.style.width = '100%';
  img.style.height = 'auto';
  img.style.display = 'block';

  const log = document.createElement('div');
  log.id = LOGO_BADGE_LOG_ID;
  log.style.position = 'absolute';
  log.style.left = '6px';
  log.style.right = '6px';
  log.style.bottom = '6px';
  log.style.padding = '4px 6px';
  log.style.borderRadius = '8px';
  log.style.background = 'linear-gradient(180deg, rgba(0,0,0,0.25), rgba(0,0,0,0.75))';
  log.style.color = '#f8f8f8';
  log.style.fontSize = '10px';
  log.style.lineHeight = '1.3';
  log.style.textAlign = 'center';
  log.style.textShadow = '0 1px 2px rgba(0,0,0,0.6)';
  log.style.opacity = '0';
  log.style.transition = 'opacity 160ms ease';
  log.style.pointerEvents = 'none';
  log.style.display = '-webkit-box';
  log.style.WebkitLineClamp = '2';
  log.style.WebkitBoxOrient = 'vertical';
  log.style.overflow = 'hidden';

  badge.appendChild(img);
  badge.appendChild(log);
  mount.appendChild(badge);

  logoBadgeState.badge = badge;
  logoBadgeState.logEl = log;

  let rafId = null;
  const updatePosition = () => {
    rafId = null;
    const rect = badge.getBoundingClientRect();
    const width = rect.width || LOGO_BADGE_SIZE;
    const height = rect.height || LOGO_BADGE_SIZE;
    const left = window.scrollX + window.innerWidth - width - LOGO_BADGE_MARGIN;
    const top = window.scrollY + window.innerHeight - height - LOGO_BADGE_MARGIN;
    badge.style.left = `${Math.max(window.scrollX + LOGO_BADGE_MARGIN, left)}px`;
    badge.style.top = `${Math.max(window.scrollY + LOGO_BADGE_MARGIN, top)}px`;
  };

  const requestUpdate = () => {
    if (rafId !== null) return;
    rafId = window.requestAnimationFrame(updatePosition);
  };

  window.addEventListener('scroll', requestUpdate, { passive: true });
  window.addEventListener('resize', requestUpdate);
  img.addEventListener('load', requestUpdate, { once: true });
  requestUpdate();
};

const getLogoLogColor = (type) => {
  switch (type) {
    case 'success':
      return '#b7f7d9';
    case 'warning':
      return '#ffe1a6';
    case 'error':
      return '#ffb1b1';
    default:
      return '#f8f8f8';
  }
};

const setLogoBadgeRunning = (running) => {
  logoBadgeState.running = running;
  if (!logoBadgeState.logEl) return;
  logoBadgeState.logEl.style.opacity = running ? '1' : '0';
  if (!running) {
    logoBadgeState.logEl.textContent = '';
  }
};

const setLogoBadgeLog = (message, type = 'info') => {
  if (!message) return;
  ensureLogoBadge();
  if (!logoBadgeState.logEl) return;
  logoBadgeState.logEl.textContent = message;
  logoBadgeState.logEl.style.color = getLogoLogColor(type);
  if (logoBadgeState.running) {
    logoBadgeState.logEl.style.opacity = '1';
  }
};

function handleLocalStatusMessage(context, message) {
  if (!message || typeof message !== 'object') return;
  if (window.top !== window) return;

  const isRunning =
    !!context?.state?.isRunning ||
    (typeof context?.isDailyAutoRunning === 'function' && context.isDailyAutoRunning());

  ensureLogoBadge();
  setLogoBadgeRunning(isRunning);

  if (message.type === 'log') {
    if (isRunning) {
      setLogoBadgeLog(message.message, 'info');
    }
    return;
  }
  if (message.type === 'error') {
    if (isRunning) {
      setLogoBadgeLog(message.message, 'error');
    }
    return;
  }
  if (message.type === 'started') {
    setLogoBadgeRunning(true);
    setLogoBadgeLog('自动浏览已启动', 'success');
    return;
  }
  if (message.type === 'stopped') {
    setLogoBadgeRunning(false);
    return;
  }
  if (message.type === 'ready' && isRunning && logoBadgeState.logEl && !logoBadgeState.logEl.textContent) {
    setLogoBadgeLog('自动浏览中', 'info');
  }
}

// 创建实例
let browser = null;

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    browser = new HumanBrowser();
    ensureLogoBadge();
  });
} else {
  browser = new HumanBrowser();
  ensureLogoBadge();
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!browser) {
    sendResponse({ success: false, error: 'Browser not initialized' });
    return true;
  }

  const safeReply = (promise, action) => {
    promise.then(() => sendResponse({ success: true }))
      .catch((error) => {
        const messageText = error?.message || String(error);
        browser.recordInternalError(`action_${action}_failed`, messageText);
        sendResponse({ success: false, error: `${action}_failed` });
      });
  };

  switch (message.action) {
    case 'start':
      safeReply(browser.start(), 'start');
      break;

    case 'resetAndStart':
      safeReply(browser.resetAndStart(), 'resetAndStart');
      break;

    case 'resetHistory':
      browser.state.browsedPosts = [];
      browser.state.stats.totalBrowsed = 0;
      safeReply(browser.saveState(browser.state), 'resetHistory');
      break;

    case 'stop':
      safeReply(browser.stop(), 'stop');
      break;

    case 'startDaily':
      safeReply(browser.startDaily(message.target, message.date, { skipIdleWait: message.skipIdleWait }), 'startDaily');
      break;

    case 'getConfig':
      sendResponse({ config: browser.config });
      break;

    case 'updateConfig':
      safeReply(browser.updateConfig(message.config), 'updateConfig');
      break;

    case 'getStats':
      browser.loadState().then(state => {
        sendResponse({ stats: state.stats });
      }).catch((error) => {
        const messageText = error?.message || String(error);
        browser.recordInternalError('action_getStats_failed', messageText);
        sendResponse({ success: false, error: 'getStats_failed' });
      });
      break;

    default:
      sendResponse({ success: false, error: 'Unknown action' });
  }

  return true;
});

// 页面卸载前保存状态
window.addEventListener('beforeunload', () => {
  if (browser && browser.state) {
    browser.saveState(browser.state);
  }
});





