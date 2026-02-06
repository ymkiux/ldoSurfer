# ldoSurfer - Linux DO 自动浏览工具

<div align="center">

<img src="icons/logo.png" alt="logo" width="96">

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

**模拟人类浏览行为，自动浏览 linux.do 帖子 | Chrome 浏览器自动化扩展**
</div>

---

<p align="center">中文版 · <a href="README.md">English</a></p>

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
| 切换自动执行 | 切换为直接执行模式，跳过等待 10 分钟 | 关闭 |

## 使用指南

### 前置条件

- 仅在 `linux.do` 或 `idcflare.com` 页面内可执行，其他页面按钮无效。

### 界面说明

| 功能 | 位置 | 说明 |
|------|------|------|
| 开始/停止 | 控制中心顶部 | 主开关，启动/暂停自动浏览 |
| 浏览统计 | 控制中心顶部 | 显示已浏览帖子数和运行时长 |
| 高级设置 | 点击展开「高级浏览设置」 | 调整阅读时长、停留时间、点击概率等 |
| 运行日志 | 控制中心下半部分 | 实时查看浏览活动，支持复制/清空 |
| 数据统计 | 点击「数据统计」标签 | 查看历史浏览记录和图表分析 |
| 主题切换 | 底部调色板图标 | 切换 默认/治愈/新年 主题 |
| 站点切换 | 「高级浏览设置」内 | 支持 linux.do 与 idcflare.com 双站点 |

### 操作步骤

1. **安装登录**：加载扩展后访问目标站点并登录
2. **调整参数**：展开「高级浏览设置」根据需要配置
3. **开始浏览**：点击「开始浏览」按钮
4. **查看数据**：切换到「数据统计」标签查看历史记录

### 切换站点

1. 打开扩展弹窗
2. 展开 **高级浏览设置**
3. 使用 **站点切换** 选择 Linux DO / IDCFlare
4. 点击 **打开最新帖** 确认当前站点

### 定时任务（每日自动浏览）

位置：**高级浏览设置** 内

1. 打开扩展弹窗并展开 **高级浏览设置**
2. 启用 **每日自动浏览**
3. 设置每日开始时间（HH:MM）
4. 每日结束时间固定为开始时间 + 10 小时
5. 到点后自动打开 `/latest` 并开始浏览

**注意**
- 必须开启开关，关闭即取消定时
- 必须处于 linux.do 或 idcflare.com 页面才能执行

### 注意事项

- 切换站点前请确保已在对应网站登录
- 快速模式会跳过评论，仅浏览帖子正文
- 历史记录自动保存，关闭浏览器不丢失
- 说明：插件里的「帖子」对应论坛里的「话题」（文章）；插件里的「评论」对应论坛里的「帖子」

## 技术栈

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- Chrome Storage API & Message Passing

---

<div align="center">

[MIT License](LICENSE) · **[Report Issue](https://github.com/ymkiux/ldoSurfer/issues)**

If you find this project helpful, consider giving it a star ⭐

</div>

