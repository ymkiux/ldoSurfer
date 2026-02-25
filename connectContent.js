(() => {
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const PATTERNS = {
    TRUST_LEVEL: /(.*) - 信任级别 (\d+)/,
    TRUST_LEVEL_H1: /你好，.*?\(([^)]+)\)\s*(\d+)级用户/
  };

  const getText = (el) => (el?.textContent || '').trim();

  const findSection = () => {
    const candidates = Array.from(document.querySelectorAll('.bg-white.p-6.rounded-lg, .card'));
    return candidates.find((d) => {
      const titleText = getText(d.querySelector('h2, .card-title'));
      return /信任级别|trust\s*level/i.test(titleText) || !!d.querySelector('.tl3-rings, .tl3-bars, .tl3-quota, .tl3-veto');
    }) || null;
  };

  const extractSummary = () => {
    const pageTitle = document.querySelector('title')?.textContent || document.title || '';
    let username = null;
    let level = null;

    const h1El = document.querySelector('h1');
    if (h1El) {
      const h1Match = getText(h1El).match(PATTERNS.TRUST_LEVEL_H1);
      if (h1Match) {
        username = h1Match[1];
        level = h1Match[2];
      }
    }

    const userInfoText = getText(document.querySelector('.user-menu-info div:last-child')) || getText(document.querySelector('.user-menu-info'));
    if (userInfoText) {
      const userInfoMatch = userInfoText.match(/@([^@\s·|]+).*?(?:信任级别|trust\s*level)\s*(\d+)/i);
      if (userInfoMatch) {
        if (!username) username = userInfoMatch[1];
        if (!level) level = userInfoMatch[2];
      }
    }

    const section = findSection();
    const heading = getText(section?.querySelector('h2, .card-title'));
    if (heading) {
      const oldMatch = heading.match(PATTERNS.TRUST_LEVEL);
      if (oldMatch) {
        if (!username) username = oldMatch[1].trim();
        if (!level) level = oldMatch[2];
      }
      const levelMatch = heading.match(/(?:信任级别|trust\s*level)\s*(\d+)/i);
      if (levelMatch && !level) level = levelMatch[1];
    }

    const subtitle = getText(section?.querySelector('.card-subtitle'));
    if (!username && subtitle) {
      const subtitleMatch = subtitle.match(/@([^@\s·|]+)/);
      if (subtitleMatch) username = subtitleMatch[1];
    }

    const metrics = {};
    document.querySelectorAll('.tl3-ring').forEach((ring) => {
      const labelEl = ring.querySelector('.tl3-ring-label');
      const currentEl = ring.querySelector('.tl3-ring-current');
      const targetEl = ring.querySelector('.tl3-ring-target');
      if (!labelEl || !currentEl || !targetEl) return;
      const label = getText(labelEl);
      const current = getText(currentEl);
      const target = getText(targetEl).replace('/', '').trim();
      if (!label) return;
      metrics[label] = { current, target };
    });

    const badgeEl = section?.querySelector('.badge, .status-met, .status-unmet, p[class*="status"]')
      || document.querySelector('.page-content .card .badge') || document.querySelector('.card .badge');

    const titleText = heading ? heading.replace('的要求', '').trim() : (level ? `信任级别 ${level}` : '');
    const subtitleText = subtitle || userInfoText || (username ? `@${username}` : '');
    const loggedIn = !!(level || username || subtitleText || Object.keys(metrics).length > 0);

    return {
      title: titleText,
      subtitle: subtitleText,
      badge: getText(badgeEl),
      loggedIn,
      metrics,
      pageTitle
    };
  };

  const waitForSummary = async (timeoutMs = 8000) => {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const data = extractSummary();
      const hasMetrics = Object.keys(data.metrics || {}).length > 0;
      const isLoginPage = /登录|Login|Sign in/i.test(data.pageTitle);
      if (hasMetrics || isLoginPage) return data;
      await wait(300);
    }
    return extractSummary();
  };

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || message.source !== 'background' || message.type !== 'getConnectSummary') {
      return false;
    }

    waitForSummary()
      .then((data) => {
        sendResponse({ ok: true, data });
      })
      .catch((error) => {
        sendResponse({ ok: false, error: error?.message || 'Unknown error' });
      });

    return true;
  });
})();
