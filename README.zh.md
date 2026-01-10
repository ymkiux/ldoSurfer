# ldoSurfer - Linux DO 自动浏览工具

<div align="center">

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

**模拟人类浏览行为，自动浏览 linux.do 帖子 | Chrome 浏览器自动化扩展**
</div>

---

## 简介

ldoSurfer 是一个 Chrome 浏览器扩展，通过模拟真实人类的浏览行为（平滑滚动、随机停留、鼠标移动等）自动浏览 linux.do 社区帖子。

> **免责声明**：本项目仅供学习交流使用。请遵守 [Linux DO 服务条款](https://linux.do/tos) 和社区规则。

## 功能特性

- **人类化浏览模拟** - 多步平滑滚动、随机鼠标移动、可配置停留时间
- **智能浏览管理** - 自动记录历史、避免重复、跨页面状态持久化
- **快速浏览模式** - 可选跳过评论浏览，快速浏览更多帖子（默认关闭）
- **实时监控面板** - 浏览统计、活动日志、参数配置
- **极简 UI 设计**   - 紧凑窗口、现代黑白配色

## 快速开始

```bash
git clone https://github.com/ymkiux/ldoSurfer.git
cd ldoSurfer
```

1. 打开 `chrome://extensions/`
2. 启用「开发者模式」
3. 点击「加载已解压的扩展程序」，选择项目文件夹
4. 访问 https://linux.do 并登录
5. 点击扩展图标启动

## 配置说明

| 参数 | 说明 | 默认值 |
|------|------|--------|
| 停留时间 | 每个帖子的停留时长 | 5-15秒 |
| 评论阅读 | 每条评论的阅读时长 | 1-4秒 |
| 滚动深度 | 滚动到页面的深度比例 | 0.7 |
| 点击概率 | 点击进入帖子的概率 | 0.6 |
| 快速浏览模式 | 跳过评论，快速浏览帖子（停留5-10秒） | 关闭 |

## 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- Chrome Storage API & Message Passing

---

<div align="center">

[MIT License](LICENSE) · **[Report Issue](https://github.com/ymkiux/ldoSurfer/issues)**

If you find this project helpful, consider giving it a star ⭐

</div>

