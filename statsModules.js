/**
 * 统计模块入口 (Refined Aesthetic)
 * 修复：移除重复渲染的底部开关，只渲染数据卡片和图表
 */

// ============== statsStorage.js ==============
class StatsStorage {
  static STORAGE_KEY = 'linuxDoStats';
  static DATA_VERSION = 1;
  static RETENTION_DAYS = 30;

  static async get() {
    return new Promise((resolve) => {
      chrome.storage.local.get(this.STORAGE_KEY, (result) => {
        const data = result[this.STORAGE_KEY] || this._createEmpty();
        resolve(data);
      });
    });
  }

  static async set(data) {
    return new Promise((resolve) => {
      chrome.storage.local.set({ [this.STORAGE_KEY]: data }, () => resolve());
    });
  }

  static _createEmpty() {
    return {
      version: this.DATA_VERSION,
      days: {},
      lastPruneAt: Date.now()
    };
  }

  static async record(event) {
    const data = await this.get();
    const now = new Date();
    const dateKey = this._getDateKey(now);
    const hourKey = now.getHours().toString();

    if (!data.days[dateKey]) {
      data.days[dateKey] = {
        totals: { posts: 0, durationMs: 0, errors: 0 },
        hours: {},
        updatedAt: now.getTime()
      };
    }

    const day = data.days[dateKey];

    if (!day.hours[hourKey]) {
      day.hours[hourKey] = { posts: 0, durationMs: 0, errors: 0 };
    }

    day.hours[hourKey].posts += event.posts;
    day.hours[hourKey].durationMs += event.durationMs;
    if (event.hasError) {
      day.hours[hourKey].errors += 1;
    }

    day.totals.posts += event.posts;
    day.totals.durationMs += event.durationMs;
    if (event.hasError) {
      day.totals.errors += 1;
    }

    day.updatedAt = now.getTime();

    const shouldPrune = !data.lastPruneAt || (now.getTime() - data.lastPruneAt > 86400000);
    if (shouldPrune) {
      this._pruneOldDays(data);
      data.lastPruneAt = now.getTime();
    }

    await this.set(data);
  }

  static _pruneOldDays(data) {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - this.RETENTION_DAYS);
    const cutoffKey = this._getDateKey(cutoffDate);

    for (const dateKey in data.days) {
      if (dateKey < cutoffKey) {
        delete data.days[dateKey];
      }
    }
  }

  static _getDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  static async clear() {
    await this.set(this._createEmpty());
  }

  static async prune() {
    const data = await this.get();
    this._pruneOldDays(data);
    data.lastPruneAt = Date.now();
    await this.set(data);
  }
}

// ============== statsRecorder.js ==============
class StatsRecorder {
  static async record(options = {}) {
    const { posts = 1, durationMs = 0, hasError = false } = options;
    await StatsStorage.record({ posts, durationMs, hasError });
  }

  static async recordPost(durationMs = 0) {
    await this.record({ posts: 1, durationMs, hasError: false });
  }

  static async recordError() {
    await this.record({ posts: 0, durationMs: 0, hasError: true });
  }
}

// ============== statsAggregator.js ==============
class StatsAggregator {
  static async getRecentDays(days = 7) {
    const data = await StatsStorage.get();
    const result = [];
    const now = new Date();

    for (let i = days - 1; i >= 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);
      const dateKey = StatsStorage._getDateKey(date);
      const dayData = data.days[dateKey];

      result.push({
        date: dateKey,
        dateObj: date,
        displayDate: `${date.getMonth() + 1}/${date.getDate()}`,
        posts: dayData?.totals?.posts || 0,
        durationMs: dayData?.totals?.durationMs || 0,
        errors: dayData?.totals?.errors || 0
      });
    }

    return result;
  }

  static async getHourlyHeatmap() {
    const recentDays = await this.getRecentDays(7);
    const data = await StatsStorage.get();

    const hourlyBuckets = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      posts: 0,
      durationMs: 0,
      intensity: 0
    }));

    let maxPosts = 0;

    for (const day of recentDays) {
      const dayData = data.days[day.date];
      if (dayData?.hours) {
        for (const [hourStr, hourData] of Object.entries(dayData.hours)) {
          const hour = parseInt(hourStr, 10);
          if (hour >= 0 && hour < 24) {
            hourlyBuckets[hour].posts += hourData.posts;
            hourlyBuckets[hour].durationMs += hourData.durationMs;
            maxPosts = Math.max(maxPosts, hourlyBuckets[hour].posts);
          }
        }
      }
    }

    if (maxPosts > 0) {
      for (const bucket of hourlyBuckets) {
        bucket.intensity = bucket.posts / maxPosts;
      }
    }

    return hourlyBuckets;
  }

  static async getOverview() {
    const recentDays = await this.getRecentDays(7);

    return {
      totalPosts: recentDays.reduce((sum, d) => sum + d.posts, 0),
      totalDurationMs: recentDays.reduce((sum, d) => sum + d.durationMs, 0),
      totalErrors: recentDays.reduce((sum, d) => sum + d.errors, 0),
      activeDays: recentDays.filter(d => d.posts > 0).length,
      avgDailyPosts: recentDays.reduce((sum, d) => sum + d.posts, 0) / 7
    };
  }

  static async getAllTimeTotals() {
    const data = await StatsStorage.get();
    let totalPosts = 0;
    let totalDurationMs = 0;
    let totalErrors = 0;

    for (const dayData of Object.values(data.days)) {
      totalPosts += dayData.totals?.posts || 0;
      totalDurationMs += dayData.totals?.durationMs || 0;
      totalErrors += dayData.totals?.errors || 0;
    }

    return { totalPosts, totalDurationMs, totalErrors };
  }

  static formatDuration(ms) {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);

    if (hours > 0) {
      return `${hours}.${Math.round(minutes / 6)}h`;
    }
    return `${minutes}m`;
  }
}

// ============== statsCharts.js ==============
class StatsCharts {
  static getPalette() {
    return {
      bg: '#ffffff',
      text: '#1f2329',
      textMuted: '#8f959e',
      line: '#3370ff',
      fill: 'rgba(51, 112, 255, 0.1)',
      grid: '#f0f1f5',
      heatLow: '#f0f1f5',
      heatMid: '#94b5ff',
      heatHigh: '#3370ff'
    };
  }

  static renderLineChart(data) {
    const palette = this.getPalette();
    const width = 232;
    const height = 120;
    const padding = { top: 35, right: 10, bottom: 20, left: 30 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    const maxPosts = Math.max(5, ...data.map(d => d.posts));

    const points = data.map((d, i) => {
      const x = padding.left + (i / (data.length - 1)) * chartWidth;
      const y = padding.top + chartHeight - (d.posts / maxPosts) * chartHeight;
      return { x, y, posts: d.posts, date: d.displayDate };
    });

    const linePath = points.map((p, i) => (i === 0 ? 'M' : 'L') + `${p.x},${p.y}`).join(' ');
    const areaPath = `${linePath} L${points[points.length - 1].x},${padding.top + chartHeight} L${points[0].x},${padding.top + chartHeight} Z`;

    const yTicks = this._generateYTicks(maxPosts, 3);
    const yTickElements = yTicks.map((val) => {
      const y = padding.top + chartHeight - (val / maxPosts) * chartHeight;
      return `
        <line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="${palette.grid}" stroke-width="1" stroke-dasharray="3,3"/>
        <text x="${padding.left - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="${palette.textMuted}" font-family="sans-serif">${val}</text>
      `;
    }).join('');

    const xLabels = points.map((p, i) => {
      if (data.length > 5 && i % 2 !== 0 && i !== data.length - 1) return '';
      return `<text x="${p.x}" y="${height}" text-anchor="middle" font-size="9" fill="${palette.textMuted}" font-family="sans-serif">${p.date}</text>`;
    }).join('');

    const dots = points.map(p => `
      <circle cx="${p.x}" cy="${p.y}" r="2.5" fill="${palette.bg}" stroke="${palette.line}" stroke-width="1.5"/>
    `).join('');

    return `
      <svg width="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
        <text x="${padding.left}" y="20" text-anchor="start" font-size="9" fill="${palette.textMuted}" font-weight="500">Posts</text>
        ${yTickElements}
        <path d="${areaPath}" fill="${palette.fill}" stroke="none"/>
        <path d="${linePath}" fill="none" stroke="${palette.line}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        ${dots}
        ${xLabels}
      </svg>
    `;
  }

  static renderHeatmap(data) {
    const palette = this.getPalette();
    const width = 232;
    const height = 80;
    const padding = { top: 0, right: 0, bottom: 15, left: 30 };
    const cellWidth = (width - padding.left) / 24;
    const cellHeight = height - padding.bottom;

    const bars = data.map((bucket, i) => {
      const x = padding.left + i * cellWidth;
      const barHeight = (bucket.intensity || 0.05) * cellHeight;
      const y = height - padding.bottom - barHeight;
      let fill = bucket.intensity > 0.5 ? palette.heatHigh : (bucket.intensity > 0.1 ? palette.heatMid : palette.heatLow);

      return `
        <rect x="${x + 1}" y="${y}" width="${cellWidth - 2}" height="${barHeight}" rx="1" fill="${fill}">
          <title>${bucket.hour}:00 - ${bucket.posts} 帖</title>
        </rect>
      `;
    }).join('');

    const timeLabels = [0, 6, 12, 18].map(h => {
      const x = padding.left + h * cellWidth + cellWidth / 2;
      return `<text x="${x}" y="${height}" text-anchor="middle" font-size="9" fill="${palette.textMuted}">${h}</text>`;
    }).join('');

    return `
      <svg width="100%" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg" style="overflow: visible;">
        <text x="0" y="${height/2}" font-size="9" fill="${palette.textMuted}" transform="rotate(-90, 8, ${height/2})">Activity</text>
        ${bars}
        ${timeLabels}
      </svg>
    `;
  }

  static renderOverviewCards(overview, allTime) {
    return `
      <div class="overview-card">
        <div class="overview-value">${overview.totalPosts}</div>
        <div class="overview-label">本周帖子</div>
      </div>
      <div class="overview-card">
        <div class="overview-value">${StatsAggregator.formatDuration(overview.totalDurationMs).replace('h','h').replace('m','m')}</div>
        <div class="overview-label">本周时长</div>
      </div>
      <div class="overview-card">
        <div class="overview-value">${allTime.totalPosts}</div>
        <div class="overview-label">累计帖子</div>
      </div>
    `;
  }

  static _generateYTicks(maxValue, count) {
    const ticks = [];
    const step = Math.ceil(maxValue / count);
    for (let i = 0; i <= count; i++) {
      ticks.push(Math.round(i * step * maxValue / (count * step)));
    }
    return [...new Set(ticks)].filter(v => v <= maxValue).sort((a, b) => a - b);
  }
}

// ============== statsTab.js ==============
class StatsTab {
  constructor() {
    this.isInitialized = false;
    this.currentTab = 'control';
  }

  async init() {
    if (this.isInitialized) return;
    this._bindTabEvents();
    this.isInitialized = true;
  }

  _bindTabEvents() {
    const tabButtons = document.querySelectorAll('[data-tab]');
    const tabPanels = document.querySelectorAll('[data-panel]');

    tabButtons.forEach(button => {
      button.addEventListener('click', () => {
        const tabName = button.dataset.tab;
        this._switchTab(tabName, tabButtons, tabPanels);
      });
    });
  }

  _switchTab(tabName, tabButtons, tabPanels) {
    this.currentTab = tabName;

    tabButtons.forEach(btn => {
      if (btn.dataset.tab === tabName) {
        btn.setAttribute('aria-selected', 'true');
        btn.classList.add('active');
      } else {
        btn.setAttribute('aria-selected', 'false');
        btn.classList.remove('active');
      }
    });

    tabPanels.forEach(panel => {
      if (panel.dataset.panel === tabName) {
        panel.classList.add('active');
        if (tabName === 'stats') {
          this._renderStats();
        }
      } else {
        panel.classList.remove('active');
      }
    });
  }

  async _renderStats() {
    const container = document.getElementById('statsContent');
    if (!container) return;

    if (!container.innerHTML.trim()) {
       container.innerHTML = '<div style="padding:20px;text-align:center;color:#999;font-size:12px;">加载中...</div>';
    }

    try {
      const [recentDays, hourlyHeatmap, overview, allTime] = await Promise.all([
        StatsAggregator.getRecentDays(7),
        StatsAggregator.getHourlyHeatmap(),
        StatsAggregator.getOverview(),
        StatsAggregator.getAllTimeTotals()
      ]);

      const overviewHtml = StatsCharts.renderOverviewCards(overview, allTime);
      const lineChartHtml = StatsCharts.renderLineChart(recentDays);
      const heatmapHtml = StatsCharts.renderHeatmap(hourlyHeatmap);

      container.innerHTML = `
        <div class="overview-cards">
          ${overviewHtml}
        </div>
        <div class="chart-section">
          <div class="chart-title">
            <span>浏览趋势</span>
            <span style="font-size:10px; font-weight:400; opacity:0.6;">7 Days</span>
          </div>
          ${lineChartHtml}
        </div>
        <div class="chart-section">
          <div class="chart-title">
            <span>活跃时段</span>
            <span style="font-size:10px; font-weight:400; opacity:0.6;">24h</span>
          </div>
          ${heatmapHtml}
        </div>
      `;
    } catch (error) {
      console.error(error);
      container.innerHTML = `<div style="padding:20px;text-align:center;color:red;font-size:12px;">加载失败</div>`;
    }
  }
}

// 创建全局实例，供 popup.js 使用
const statsTab = new StatsTab();

// 导出到全局作用域（供 popup.js 使用）
window.StatsRecorder = StatsRecorder;
window.StatsStorage = StatsStorage;
window.StatsAggregator = StatsAggregator;
window.StatsCharts = StatsCharts;
window.StatsTab = StatsTab;
window.statsTab = statsTab;