function pickText(...selectors) {
  for (const selector of selectors) {
    const node = document.querySelector(selector);
    const text = node?.textContent?.trim();
    if (text) return text;
  }
  return '';
}

function extractNote() {
  const title =
    pickText('h1', '[class*="title"]', '[data-testid="note-title"]') ||
    document.title.replace(/\s*[-_|].*$/, '').trim();
  const author = pickText('[class*="author"]', '[class*="username"]', '[class*="nickname"]');
  const body = document.body.innerText.replace(/\n{3,}/g, '\n\n').slice(0, 8000);
  const cover = document.querySelector('img')?.src || '';
  const noteUrl = location.href;
  const collectedAt = new Date().toISOString();
  return { title, author, body, cover, noteUrl, collectedAt };
}

function collectSearchSuggestions() {
  const selectors = [
    '[class*="suggest"]',
    '[class*="suggestion"]',
    '[class*="keyword"]',
    '[class*="dropdown"] li',
    '[class*="search"] li',
    '[class*="search"] a',
    '[class*="auto"] li',
  ];
  const seen = new Set();
  const keywords = [];

  for (const selector of selectors) {
    document.querySelectorAll(selector).forEach((node) => {
      const text = node.textContent?.trim() || '';
      const clean = text.replace(/\s+/g, ' ').trim();
      if (!clean || clean.length > 40 || clean.length < 2) return;
      if (/[\u4e00-\u9fa5]/.test(clean) === false) return;
      const key = clean.toLowerCase();
      if (seen.has(key)) return;
      seen.add(key);
      keywords.push(clean);
    });
  }

  return keywords.slice(0, 50);
}

function detectCurrentKeyword() {
  const input = document.querySelector(
    'input[type="search"], input[placeholder*="搜索"], input[class*="search"], input[class*="Search"]',
  );
  const inputValue = input?.value?.trim();
  if (inputValue) return inputValue;
  return new URLSearchParams(location.search).get('keyword') || '';
}

function createButton(id, text, bottom, background) {
  const button = document.createElement('button');
  button.id = id;
  button.textContent = text;
  button.type = 'button';
  button.style.cssText = [
    'position:fixed',
    'right:18px',
    `bottom:${bottom}px`,
    'z-index:999999',
    `background:${background}`,
    'color:#fff',
    'border:none',
    'border-radius:20px',
    'padding:10px 14px',
    'font-size:13px',
    'cursor:pointer',
    'box-shadow:0 8px 20px rgba(0,0,0,0.2)',
  ].join(';');
  document.body.appendChild(button);
  return button;
}

function addCollectButton() {
  if (document.getElementById('xhs-collector-button')) return;

  const noteButton = createButton('xhs-collector-button', '采集此笔记', 90, '#ff2442');
  noteButton.addEventListener('click', async () => {
    const note = extractNote();
    if (!note.title && !note.body) {
      alert('没有识别到笔记内容，请打开一篇具体的小红书笔记后再试。');
      return;
    }
    const stored = await chrome.storage.local.get({ notes: [], lastSearchKeyword: '' });
    const notes = Array.isArray(stored.notes) ? stored.notes : [];
    note.searchKeyword = stored.lastSearchKeyword || '';
    if (notes.some((n) => n.noteUrl && n.noteUrl === note.noteUrl)) {
      noteButton.textContent = '已采集';
      setTimeout(() => (noteButton.textContent = '采集此笔记'), 1200);
      return;
    }
    notes.unshift(note);
    await chrome.storage.local.set({ notes: notes.slice(0, 200) });
    noteButton.textContent = '已保存';
    setTimeout(() => (noteButton.textContent = '采集此笔记'), 1200);
  });

  const keywordButton = createButton('xhs-keyword-button', '采集下拉词', 140, '#1677ff');
  keywordButton.addEventListener('click', async () => {
    const keywords = collectSearchSuggestions();
    if (!keywords.length) {
      alert('没有识别到搜索下拉词，请先在小红书搜索框输入关键词，让候选词显示出来。');
      return;
    }
    const currentKeyword = detectCurrentKeyword();
    const stored = await chrome.storage.local.get({ searchKeywords: [] });
    const old = Array.isArray(stored.searchKeywords) ? stored.searchKeywords : [];
    const merged = Array.from(new Set([...keywords, ...old])).slice(0, 300);
    await chrome.storage.local.set({
      searchKeywords: merged,
      lastSearchKeyword: currentKeyword || keywords[0] || '',
    });
    keywordButton.textContent = `已采集 ${keywords.length} 个`;
    setTimeout(() => (keywordButton.textContent = '采集下拉词'), 1500);
  });
}

addCollectButton();
