---
slug: localstorage-state-useref-api
type: feedback
title: 角标/通知计数绝对不要用localStorage缓存或state闭包—用useRef+直接API轮询
source: session
date: 2026-07-22
keywords: localstorage, state, useref, pendingbadge, seenref, localstorage, http, badge, -seenref, current
sessionId: 63d794bd-7ec0-4c2b-b642-1bfdb740cbb9
---

# 角标/通知计数绝对不要用localStorage缓存或state闭包—用useRef+直接API轮询

pendingBadge等通知计数器的实现规则：1) seenRef初始化为0(不读localStorage)，2) 用http.get轮询API获取实际数量，3) badge=API数量-seenRef.current，4) 点击时markSeen设置seenRef=total使badge归零。绝对不要用useState存计数、不要从localStorage恢复计数、不要依赖authStore的user对象。

## Details


