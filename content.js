// Linux DO 自动浏览 - Content Script
// 使用持久化存储，支持页面跳转后继续运行

const STORAGE_KEY = 'linux_do_auto_state';

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
      quickMode: false
    };

    this.init();
  }

  // 从存储加载状态
  async loadState() {
    return new Promise((resolve) => {
      chrome.storage.local.get([STORAGE_KEY], (result) => {
        const state = result[STORAGE_KEY] || {
          isRunning: false,
          browsedPosts: [],
          stats: {
            totalBrowsed: 0,
            startTime: null,
            errors: 0
          },
          accumulatedTime: 0,
          lastStartTime: null,
          config: this.config
        };
        resolve(state);
      });
    });
  }

  // 保存状态到存储
  async saveState(state) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [STORAGE_KEY]: state }, () => resolve());
    });
  }

  // 清除状态
  async clearState() {
    return new Promise((resolve) => {
      chrome.storage.local.remove([STORAGE_KEY], () => resolve());
    });
  }

  async init() {
    console.log('[Linux DO Auto] 初始化', window.location.pathname);

    // 加载保存的状态
    const state = await this.loadState();
    this.state = state;
    this.config = state.config || this.config;

    console.log('[Linux DO Auto] 状态加载完成', {
      isRunning: state.isRunning,
      isPostPage: this.isPostPage(),
      isListPage: this.isListPage()
    });

    // 如果正在运行，根据当前页面类型继续执行
    if (state.isRunning) {
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
    return new Promise(resolve => setTimeout(resolve, ms));
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
    return Array.from(comments);
  }

  // 逐个浏览评论（模拟人类阅读），支持动态加载
  async browseCommentsSlowly() {
    let lastCommentCount = 0;
    let noNewCommentsCount = 0;
    const maxNoNewComments = 3; // 连续3次没有新评论才停止

    while (noNewCommentsCount < maxNoNewComments) {
      // 检查是否已停止或切换到快速模式
      if (!this.state.isRunning || this.config.quickMode) {
        if (this.config.quickMode) {
          this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
        } else {
          this.sendMessage({ type: 'log', message: '浏览已停止' });
        }
        return;
      }

      // 每次循环都重新获取评论（处理动态加载）
      const comments = this.getPostComments();
      const currentCount = comments.length;

      if (currentCount > lastCommentCount) {
        // 有新评论加载
        this.sendMessage({ type: 'log', message: `发现新评论，总计 ${currentCount} 条` });
        lastCommentCount = currentCount;
        noNewCommentsCount = 0;

        // 从上次浏览的位置继续
        const startIndex = this.state.lastCommentIndex || 0;

        for (let i = startIndex; i < comments.length; i++) {
          // 每次循环都检查状态和配置
          if (!this.state.isRunning || this.config.quickMode) {
            if (this.config.quickMode) {
              this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
            } else {
              this.sendMessage({ type: 'log', message: '浏览已停止' });
            }
            return;
          }

          const comment = comments[i];
          const postNumber = comment.getAttribute('data-post-number');

          // 滚动到评论位置
          comment.scrollIntoView({ behavior: 'smooth', block: 'center' });
          await this.sleep(500); // 等待滚动完成

          // 滚动后再次检查状态
          if (!this.state.isRunning || this.config.quickMode) {
            if (this.config.quickMode) {
              this.sendMessage({ type: 'log', message: '检测到快速模式，停止浏览评论' });
            } else {
              this.sendMessage({ type: 'log', message: '浏览已停止' });
            }
            return;
          }

          // 使用配置的阅读时间范围
          const readTime = this.random(this.config.minCommentRead, this.config.maxCommentRead);

          this.sendMessage({ type: 'log', message: `阅读评论 ${postNumber}/${currentCount}` });
          await this.sleep(readTime);

          // 偶尔移动鼠标
          if (Math.random() < this.config.mouseMoveProbability) {
            this.randomMouseMove();
          }

          // 保存当前浏览位置
          this.state.lastCommentIndex = i + 1;
        }

        // 浏览完当前所有评论后，尝试加载更多
        this.sendMessage({ type: 'log', message: '尝试加载更多评论...' });

        // 滚动到页面底部触发加载
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });

        // 等待可能的动态加载
        await this.sleep(3000);

      } else {
        // 没有新评论
        noNewCommentsCount++;
        this.sendMessage({ type: 'log', message: `等待新评论... (${noNewCommentsCount}/${maxNoNewComments})` });

        // 再次滚动到底部尝试触发加载
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });

        await this.sleep(3000);
      }
    }

    // 重置浏览位置
    this.state.lastCommentIndex = 0;
    this.sendMessage({ type: 'log', message: '所有评论已浏览完毕' });
  }

  // 处理帖子页面
  async handlePostPage() {
    const postUrl = window.location.pathname;

    this.sendMessage({ type: 'log', message: `正在浏览帖子: ${postUrl}` });

    // 检查是否已浏览
    if (this.state.browsedPosts.includes(postUrl)) {
      this.sendMessage({ type: 'log', message: '已浏览过，返回列表' });
      if (this.state.isRunning) {
        this.navigateToLatest();
      }
      return;
    }

    // 添加到已浏览列表
    if (!this.state.browsedPosts.includes(postUrl)) {
      this.state.browsedPosts.push(postUrl);
      this.state.stats.totalBrowsed++;
    }

    // 等待页面稳定
    await this.sleep(this.random(1500, 2500));

    // 随机鼠标移动
    this.randomMouseMove();

    // 快速浏览模式：跳过评论，停留5-10秒
    if (this.config.quickMode) {
      this.sendMessage({ type: 'log', message: '快速浏览模式：跳过评论' });

      // 检查是否已停止（在输出日志后、sleep前检查）
      if (!this.state.isRunning) {
        this.sendMessage({ type: 'log', message: '已停止' });
        return;
      }

      const stayTime = this.random(5000, 10000);
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
      const stayTime = this.random(this.config.minPageStay, this.config.maxPageStay);

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

  navigateToLatest() {
    window.location.href = 'https://linux.do/latest';
  }

  // 开始浏览（不清空历史记录）
  async start() {
    console.log('[Linux DO Auto] 开始浏览，保留历史记录');

    this.state.isRunning = true;

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
    this.state.lastStartTime = null;

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
    await this.saveState(this.state);

    this.sendMessage({ type: 'stopped' });
    console.log('[Linux DO Auto] 停止完成');
  }

  // 更新配置
  async updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };
    this.state.config = this.config;
    await this.saveState(this.state);
    this.sendMessage({ type: 'configUpdated', config: this.config });
  }

  sendMessage(message) {
    chrome.runtime.sendMessage({
      ...message,
      source: 'content',
      url: window.location.href
    }).catch(() => {});
  }
}

// 创建实例
let browser = null;

// 页面加载完成后初始化
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    browser = new HumanBrowser();
  });
} else {
  browser = new HumanBrowser();
}

// 监听来自 popup 的消息
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!browser) {
    sendResponse({ success: false, error: 'Browser not initialized' });
    return true;
  }

  switch (message.action) {
    case 'start':
      browser.start().then(() => sendResponse({ success: true }));
      break;

    case 'resetAndStart':
      browser.resetAndStart().then(() => sendResponse({ success: true }));
      break;

    case 'resetHistory':
      browser.state.browsedPosts = [];
      browser.state.stats.totalBrowsed = 0;
      browser.saveState(browser.state).then(() => sendResponse({ success: true }));
      break;

    case 'stop':
      browser.stop().then(() => sendResponse({ success: true }));
      break;

    case 'getConfig':
      sendResponse({ config: browser.config });
      break;

    case 'updateConfig':
      browser.updateConfig(message.config).then(() => sendResponse({ success: true }));
      break;

    case 'getStats':
      browser.loadState().then(state => {
        sendResponse({ stats: state.stats });
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
