---
slug: authstore
type: feedback
title: 实时计数器必须用直接轮询而非authStore缓存
source: session
date: 2026-07-22
keywords: authstore, pendingreviewcount, authstore, user, fetch, setinterval, authstore, role, username
sessionId: 63d794bd-7ec0-4c2b-b642-1bfdb740cbb9
---

# 实时计数器必须用直接轮询而非authStore缓存

pendingReviewCount等会频繁变化的计数器，不能存在authStore的user对象里依赖登录时的一次性写入。必须用原生fetch()+setInterval()直接轮询API端点，绕过所有缓存层。authStore只存登录后的静态用户信息(role/username/id)，不存动态计数。

## Details


