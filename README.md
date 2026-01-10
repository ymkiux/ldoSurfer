# ldoSurfer - Linux DO Auto Browse Tool

<div align="center">

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-green?logo=google-chrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-blue.svg)
![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-orange.svg)

**Simulate human browsing behavior, automatically browse linux.do posts | Chrome Browser Automation Extension**

</div>

---

## Overview

ldoSurfer is a Chrome browser extension that automatically browses linux.do community posts by simulating real human browsing behavior (smooth scrolling, random dwell time, mouse movement, etc.).

> **Disclaimer**: This project is for learning and communication purposes only. Please comply with [Linux DO Terms of Service](https://linux.do/tos) and community rules.

## Features

- **Human-like Browsing Simulation** - Multi-step smooth scrolling, random mouse movement, configurable dwell time
- **Smart Browsing Management** - Automatic history recording, avoid duplicates, cross-page state persistence
- **Quick Browse Mode** - Optionally skip comment browsing, browse more posts quickly (disabled by default)
- **Real-time Monitoring Panel** - Browse statistics, activity logs, parameter configuration
- **Minimalist UI Design** - Compact window, modern black & white color scheme

## Quick Start

```bash
git clone https://github.com/ymkiux/ldoSurfer.git
cd ldoSurfer
```

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked" and select the project folder
4. Visit https://linux.do and log in
5. Click the extension icon to start

## Configuration

| Parameter | Description | Default Value |
|-----------|-------------|---------------|
| Dwell Time | Duration per post | 5-15 seconds |
| Comment Read Time | Duration per comment | 1-4 seconds |
| Scroll Depth | Page scroll depth ratio | 0.7 |
| Click Probability | Probability to click into posts | 0.6 |
| Quick Browse Mode | Skip comments, fast browse (5-10s dwell) | Disabled |

## Tech Stack

- Chrome Extension Manifest V3
- Vanilla JavaScript (ES6+)
- Chrome Storage API & Message Passing

---

<div align="center">

[MIT License](LICENSE) · **[Report Issue](https://github.com/ymkiux/ldoSurfer/issues)**

If you find this project helpful, consider giving it a star ⭐

</div>
