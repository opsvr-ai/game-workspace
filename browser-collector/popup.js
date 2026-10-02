const listEl = document.getElementById('list');
const jsonEl = document.getElementById('json');
const keywordListEl = document.getElementById('keywordList');

async function load() {
  const stored = await chrome.storage.local.get({ notes: [], searchKeywords: [] });
  const notes = Array.isArray(stored.notes) ? stored.notes : [];
  const keywords = Array.isArray(stored.searchKeywords) ? stored.searchKeywords : [];
  jsonEl.value = JSON.stringify(notes, null, 2);
  keywordListEl.innerHTML = keywords.length
    ? `<textarea style="width:100%;height:120px">${keywords.join('\n')}</textarea>`
    : '<div style="color:#999;padding:12px 0;text-align:center">还没有采集长尾词</div>';

  listEl.innerHTML = notes.length
    ? notes
        .map(
          (n, i) => `
            <div class="note">
              <a href="${n.noteUrl || '#'}" target="_blank">${n.title || `笔记 ${i + 1}`}</a>
              <div class="meta">${n.searchKeyword ? `长尾词：${n.searchKeyword} · ` : ''}${n.author || '未知作者'} · ${n.collectedAt?.slice(0, 16) || ''}</div>
            </div>
          `,
        )
        .join('')
    : '<div style="color:#999;padding:20px 0;text-align:center">还没有采集笔记</div>';
}

document.getElementById('copyKeywords').addEventListener('click', async () => {
  const stored = await chrome.storage.local.get({ searchKeywords: [] });
  const keywords = Array.isArray(stored.searchKeywords) ? stored.searchKeywords : [];
  if (!keywords.length) return;
  await navigator.clipboard.writeText(keywords.join('\n'));
  const btn = document.getElementById('copyKeywords');
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = '复制长尾词'), 1200);
});

document.getElementById('clearKeywords').addEventListener('click', async () => {
  await chrome.storage.local.set({ searchKeywords: [] });
  await load();
});

document.getElementById('copy').addEventListener('click', async () => {
  await navigator.clipboard.writeText(jsonEl.value);
  const btn = document.getElementById('copy');
  btn.textContent = '已复制';
  setTimeout(() => (btn.textContent = '复制 JSON'), 1200);
});

document.getElementById('clear').addEventListener('click', async () => {
  await chrome.storage.local.set({ notes: [] });
  await load();
});

load();
