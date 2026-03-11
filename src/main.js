import './style.css'

// DOM Elements
const body = document.body;
const listenBtn = document.getElementById('listen-btn');
const btnText = document.getElementById('btn-text');
const langToggle = document.getElementById('lang-toggle');
const labelEn = document.getElementById('label-en');
const labelFi = document.getElementById('label-fi');
const originalDisplay = document.getElementById('original-text');
const translatedDisplay = document.getElementById('translated-text');
const phoneticDisplay = document.getElementById('phonetic-text');
const transBox = document.getElementById('trans-box');
const historyList = document.getElementById('history-list');
const favoritesList = document.getElementById('favorites-list');
const toast = document.getElementById('toast');
const visualizerCanvas = document.getElementById('visualizer');

// PWA Registration
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').then(reg => {
      console.log('SW Registered', reg.scope);
    }).catch(err => {
      console.log('SW Registration failed', err);
    });
  });
}

// Control Toggles
const autoSpeakToggle = document.getElementById('auto-speak-toggle');
const autoDetectToggle = document.getElementById('auto-detect-toggle');

// Action Buttons
const copyOrigBtn = document.getElementById('copy-orig');
const playOrigBtn = document.getElementById('play-orig');
const speakBtn = document.getElementById('speak-btn');
const downloadBtn = document.getElementById('download-btn');
const copyTransBtn = document.getElementById('copy-trans');
const starBtn = document.getElementById('star-btn');
const exportBtn = document.getElementById('export-btn');

// State
let isListening = false;
let recognition = null;
let audioContext = null;
let analyser = null;
let dataArray = null;
let animationId = null;

let history = JSON.parse(localStorage.getItem('trans_history') || '[]');
let favorites = JSON.parse(localStorage.getItem('trans_favorites') || '[]');

// --- UTILS ---

const showToast = (message) => {
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 2000);
};

const copyToClipboard = (text) => {
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => showToast('Copied to clipboard!'));
};

const speak = (text, isSource = false) => {
  if (!text || !window.speechSynthesis) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);

  // Set language based on toggle and whether it's source or target
  if (isSource) {
    utterance.lang = langToggle.checked ? 'fi-FI' : 'en-US';
  } else {
    utterance.lang = langToggle.checked ? 'en-US' : 'fi-FI';
  }

  window.speechSynthesis.speak(utterance);
};

const exportHistory = () => {
  const content = history.map(h => `[${h.source} -> ${h.target}] \nOrig: ${h.orig}\nTrans: ${h.trans}\n`).join('\n---\n');
  const blob = new Blob([content], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'lingua-voice-history.txt';
  a.click();
};

// --- DATA PERSISTENCE ---

const saveToHistory = (orig, trans) => {
  const source = langToggle.checked ? 'fi' : 'en';
  const target = langToggle.checked ? 'en' : 'fi';
  const newItem = { orig, trans, source, target, id: Date.now() };
  history = [newItem, ...history].slice(0, 10);
  localStorage.setItem('trans_history', JSON.stringify(history));
  renderHistory();
};

const toggleFavorite = () => {
  const orig = originalDisplay.textContent;
  const trans = translatedDisplay.textContent;
  if (!orig || !trans) return;

  const existingIndex = favorites.findIndex(f => f.orig === orig);
  if (existingIndex > -1) {
    favorites.splice(existingIndex, 1);
    starBtn.classList.remove('active');
    showToast('Removed from favorites');
  } else {
    favorites.push({ orig, trans, id: Date.now() });
    starBtn.classList.add('active');
    showToast('Added to favorites');
  }
  localStorage.setItem('trans_favorites', JSON.stringify(favorites));
  renderFavorites();
};

const renderHistory = () => {
  historyList.innerHTML = history.map(item => `
    <div class="item-card" onclick="document.getElementById('original-text').textContent='${item.orig.replace(/'/g, "\\'")}'; document.getElementById('translated-text').textContent='${item.trans.replace(/'/g, "\\'")}';">
      <div class="orig">${item.orig}</div>
      <div class="trans">${item.trans}</div>
    </div>
  `).join('');
};

const renderFavorites = () => {
  favoritesList.innerHTML = favorites.map(item => `
    <div class="item-card">
      <div class="orig">${item.orig}</div>
      <div class="trans">${item.trans}</div>
      <button class="star-btn active" onclick="window.removeFavorite(${item.id})">★</button>
    </div>
  `).join('');
};

window.removeFavorite = (id) => {
  favorites = favorites.filter(f => f.id !== id);
  localStorage.setItem('trans_favorites', JSON.stringify(favorites));
  renderFavorites();
};

const downloadAudio = (text, lang) => {
  if (!text || !window.speechSynthesis) return;
  // Fallback to text file for "audio" download in browser
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `lingua-${lang}-${Date.now()}.txt`;
  a.click();
  showToast('Download started (Transcript)');
};

// --- VISUALIZER ---

const initVisualizer = async () => {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    dataArray = new Uint8Array(analyser.frequencyBinCount);
  }
  draw();
};

const draw = () => {
  const ctx = visualizerCanvas.getContext('2d');
  const width = visualizerCanvas.width;
  const height = visualizerCanvas.height;

  animationId = requestAnimationFrame(draw);
  analyser.getByteFrequencyData(dataArray);

  ctx.clearRect(0, 0, width, height);
  const barWidth = (width / dataArray.length) * 2.5;
  let x = 0;

  for (let i = 0; i < dataArray.length; i++) {
    const barHeight = (dataArray[i] / 255) * height;
    ctx.fillStyle = getComputedStyle(body).getPropertyValue('--accent-color');
    ctx.fillRect(x, height - barHeight, barWidth, barHeight);
    x += barWidth + 1;
  }
};

// --- CORE LOGIC ---

const translateText = async (text, source, target) => {
  if (!text.trim()) return;

  transBox.classList.add('shimmer');
  try {
    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`);
    const data = await response.json();

    if (data.responseData) {
      const translated = data.responseData.translatedText;
      translatedDisplay.textContent = translated;

      // Auto-Detect & Auto-Switch
      if (autoDetectToggle.checked) {
        // Simple heuristic: if we speak English but toggle is on Finnish, switch it.
        // MyMemory doesn't return source lang consistently in free tier, 
        // but we'll simulate the UX here.
      }

      // Phonetics Mock
      if (target === 'fi') {
        phoneticDisplay.textContent = `Phonetic: [${translated.toLowerCase().replace(/j/g, 'y').replace(/ä/g, 'ae').replace(/ö/g, 'oe')}]`;
      } else {
        phoneticDisplay.textContent = '';
      }

      saveToHistory(text, translated);
      if (autoSpeakToggle.checked) speak(translated);
    }
  } catch (error) {
    console.error('Translation error:', error);
  } finally {
    transBox.classList.remove('shimmer');
  }
};

const updateLabels = () => {
  if (langToggle.checked) {
    labelFi.classList.add('active');
    labelEn.classList.remove('active');
    recognition.lang = 'fi-FI';
  } else {
    labelEn.classList.add('active');
    labelFi.classList.remove('active');
    recognition.lang = 'en-US';
  }
};

// --- INITIALIZATION ---

if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;

  recognition.onstart = () => {
    isListening = true;
    listenBtn.classList.add('listening');
    btnText.textContent = 'Stop Listening';
    initVisualizer();
  };

  recognition.onend = () => {
    isListening = false;
    listenBtn.classList.remove('listening');
    btnText.textContent = 'Start Listening';
    cancelAnimationFrame(animationId);
  };

  recognition.onresult = (event) => {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; ++i) {
      if (event.results[i].isFinal) {
        finalTranscript += event.results[i][0].transcript;
      } else {
        interimTranscript += event.results[i][0].transcript;
      }
    }

    originalDisplay.textContent = finalTranscript || interimTranscript;

    if (finalTranscript) {
      // Voice Commands Check
      const cmd = finalTranscript.toLowerCase();
      if (cmd.includes('clear history')) {
        history = [];
        localStorage.setItem('trans_history', '[]');
        renderHistory();
        showToast('History cleared');
        return;
      }
      if (cmd.includes('clear favorites')) {
        favorites = [];
        localStorage.setItem('trans_favorites', '[]');
        renderFavorites();
        showToast('Favorites cleared');
        return;
      }
      if (cmd.includes('switch theme')) {
        const themes = ['midnight', 'forest', 'arctic', 'obsidian'];
        const current = body.getAttribute('data-theme');
        const next = themes[(themes.indexOf(current) + 1) % themes.length];
        body.setAttribute('data-theme', next);
        document.querySelectorAll('.theme-opt').forEach(opt => {
          opt.classList.toggle('active', opt.dataset.theme === next);
        });
        showToast(`Switched to ${next} theme`);
        return;
      }

      const source = langToggle.checked ? 'fi' : 'en';
      const target = langToggle.checked ? 'en' : 'fi';
      translateText(finalTranscript, source, target);
    }
  };
}

// --- EVENT LISTENERS ---

listenBtn.addEventListener('click', () => {
  if (isListening) recognition.stop();
  else {
    updateLabels();
    originalDisplay.textContent = '';
    translatedDisplay.textContent = '';
    starBtn.classList.remove('active');
    recognition.start();
  }
});

langToggle.addEventListener('change', () => {
  updateLabels();
  if (isListening) {
    recognition.stop();
    setTimeout(() => recognition.start(), 200);
  }
});

// Theme Switching
document.querySelectorAll('.theme-opt').forEach(opt => {
  opt.addEventListener('click', () => {
    document.querySelectorAll('.theme-opt').forEach(o => o.classList.remove('active'));
    opt.classList.add('active');
    body.setAttribute('data-theme', opt.dataset.theme);
  });
});

copyOrigBtn.addEventListener('click', () => copyToClipboard(originalDisplay.textContent));
playOrigBtn.addEventListener('click', () => speak(originalDisplay.textContent, true));
speakBtn.addEventListener('click', () => speak(translatedDisplay.textContent));
downloadBtn.addEventListener('click', () => {
  const target = langToggle.checked ? 'en' : 'fi';
  downloadAudio(translatedDisplay.textContent, target);
});
copyTransBtn.addEventListener('click', () => copyToClipboard(translatedDisplay.textContent));
starBtn.addEventListener('click', toggleFavorite);
exportBtn.addEventListener('click', exportHistory);

// Initial Load
renderHistory();
renderFavorites();
