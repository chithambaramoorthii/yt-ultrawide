const DEFAULTS = {
  enabled: true,
  fullscreenOnly: true,
  minRatio: 1.9,
  blackLevel: 24,
  maxCrop: 3,
  showToasts: true,
};
const $ = (id) => document.getElementById(id);

chrome.storage.sync.get(DEFAULTS, (s) => {
  for (const k of ['enabled', 'fullscreenOnly', 'showToasts']) {
    $(k).checked = !!s[k];
    $(k).addEventListener('change', () => chrome.storage.sync.set({ [k]: $(k).checked }));
  }
  for (const k of ['minRatio', 'maxCrop', 'blackLevel']) {
    const input = $(k), out = $(k + 'Out');
    const show = () => {
      out.textContent = k === 'minRatio' ? Number(input.value).toFixed(2)
        : k === 'maxCrop' ? Number(input.value).toFixed(1) + '%'
        : input.value;
    };
    input.value = s[k];
    show();
    input.addEventListener('input', show);
    input.addEventListener('change', () => chrome.storage.sync.set({ [k]: Number(input.value) }));
  }
});

const MODE_NAME = { auto: 'Auto', fill: 'Force fill', off: 'Off' };

function render(st) {
  if (!st) {
    for (const id of ['s-mode', 's-video', 's-bars', 's-content', 's-zoom']) $(id).textContent = '–';
    $('reason').textContent = 'Open a YouTube video.';
    return;
  }
  $('s-mode').textContent = MODE_NAME[st.mode] || st.mode;
  $('s-video').textContent = st.videoRatio ? st.videoRatio.toFixed(2) + ':1' : '–';
  $('s-bars').textContent = st.bar == null
    ? (st.blocked ? 'unreadable' : `analysing (${st.samples}/4)`)
    : (st.bar * 100).toFixed(1) + '% each' + (st.overlay ? ' (text in bar ignored)' : '');
  $('s-content').textContent = st.bar == null ? '–' : st.contentRatio.toFixed(2) + ':1';
  $('s-zoom').textContent = st.applied > 1 ? st.applied.toFixed(2) + '×' : 'none';
  $('reason').textContent = st.reason || '';
}

function refresh() {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) return render(null);
    chrome.tabs.sendMessage(tab.id, { type: 'ytuw-status' }, { frameId: 0 }, (res) => {
      if (chrome.runtime.lastError) return render(null);
      render(res);
    });
  });
}
refresh();
setInterval(refresh, 1000);
