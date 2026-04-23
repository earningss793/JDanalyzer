chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // ── 텍스트 긁기 ──
  if (message.type === 'GET_PAGE_TEXT') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ text: '', url: '', title: '' }); return; }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const selectors = [
            'article', '[class*="job"]', '[class*="posting"]',
            '[class*="description"]', '[class*="recruit"]',
            '[id*="job"]', '[id*="content"]', 'main', '.container'
          ];
          let el = null;
          for (const sel of selectors) {
            el = document.querySelector(sel);
            if (el && el.innerText.trim().length > 200) break;
          }
          const text = (el ? el.innerText : document.body.innerText)
            .replace(/\s+/g, ' ').trim().slice(0, 8000);
          return { text, url: location.href, title: document.title };
        }
      }, (results) => {
        const r = results?.[0]?.result || {};
        sendResponse({ text: r.text || '', url: r.url || '', title: r.title || '' });
      });
    });
    return true;
  }

  // ── 페이지 내 이미지 URL 수집 ──
  if (message.type === 'GET_PAGE_IMAGES') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ images: [] }); return; }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: () => {
          const imgs = Array.from(document.querySelectorAll('img'))
            .map(img => img.src)
            .filter(src => src && src.startsWith('http') && !src.includes('icon') && !src.includes('logo') && !src.includes('avatar'))
            .slice(0, 5); // 최대 5개
          return imgs;
        }
      }, (results) => {
        sendResponse({ images: results?.[0]?.result || [] });
      });
    });
    return true;
  }

  // ── 이미지 URL → base64 변환 ──
  if (message.type === 'FETCH_IMAGE_BASE64') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) { sendResponse({ base64: null }); return; }
      chrome.scripting.executeScript({
        target: { tabId: tabs[0].id },
        func: async (url) => {
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            return await new Promise((resolve) => {
              const reader = new FileReader();
              reader.onloadend = () => resolve(reader.result);
              reader.readAsDataURL(blob);
            });
          } catch { return null; }
        },
        args: [message.url]
      }, (results) => {
        sendResponse({ base64: results?.[0]?.result || null });
      });
    });
    return true;
  }

});
