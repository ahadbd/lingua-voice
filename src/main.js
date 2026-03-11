import './style.css'
import { Chart, registerables } from 'chart.js';
import Tesseract from 'tesseract.js';
import html2canvas from 'html2canvas';
import { DateTime } from 'luxon';

Chart.register(...registerables);

// DOM Elements
const body = document.body;
const h1 = document.querySelector('h1');
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
const toneToggle = document.getElementById('tone-toggle');

// Pro Elements
const dailyCountText = document.getElementById('daily-count');
const progressCircle = document.getElementById('progress-val');
const grammarHint = document.getElementById('grammar-hint');
const ocrBtn = document.getElementById('ocr-btn');
const learnBtn = document.getElementById('learn-btn');
const analyticsCanvas = document.getElementById('analytics-chart');
const proModal = document.getElementById('pro-modal');
const modalTitle = document.getElementById('modal-title');
const modalBody = document.getElementById('modal-body');
const closeModal = document.getElementById('close-modal');
const ocrUpload = document.getElementById('ocr-upload');
const convBtn = document.getElementById('conv-btn');
const shareImgBtn = document.getElementById('share-img-btn');
const visionBtn = document.getElementById('vision-btn');
const subtitleOverlay = document.getElementById('subtitle-overlay');
const subtitleContent = document.getElementById('subtitle-content');

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
let stats = JSON.parse(localStorage.getItem('trans_stats') || '{"dailyRange": [], "todayCount": 0, "lastDate": ""}');
let chartInstance = null;

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
  updateProStats();
};

const updateProStats = () => {
  const now = DateTime.now().toISODate();
  if (stats.lastDate !== now) {
    stats.todayCount = 0;
    stats.lastDate = now;
  }
  stats.todayCount++;

  // Track last 7 days for the chart
  const entryIdx = stats.dailyRange.findIndex(e => e.date === now);
  if (entryIdx > -1) stats.dailyRange[entryIdx].count = stats.todayCount;
  else stats.dailyRange.push({ date: now, count: stats.todayCount });

  if (stats.dailyRange.length > 7) stats.dailyRange.shift();

  localStorage.setItem('trans_stats', JSON.stringify(stats));
  renderProStats();
};

const renderProStats = () => {
  const dailyGoal = 10;
  const progress = Math.min((stats.todayCount / dailyGoal) * 100, 100);
  dailyCountText.textContent = stats.todayCount;
  progressCircle.style.strokeDasharray = `${progress}, 100`;

  if (chartInstance) {
    chartInstance.data.datasets[0].data = stats.dailyRange.map(e => e.count);
    chartInstance.update();
  }
  renderWordCloud();
};

const renderWordCloud = () => {
  // Simple word frequency from history
  const words = history.map(h => h.orig.split(/\s+/)).flat().filter(w => w.length > 3);
  const freq = {};
  words.forEach(w => freq[w] = (freq[w] || 0) + 1);
  const sorted = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 5);

  if (sorted.length > 0) {
    const cloudHTML = sorted.map(([w, f]) => `<span style="font-size: ${0.7 + (f * 0.2)}rem; margin-right: 5px; opacity: 0.8">${w}</span>`).join('');
    // Append to Pro Analytics card if we had a dedicated container, 
    // for now we'll just log or find a spot.
    console.log('Word Cloud:', sorted);
  }
};

const initAnalytics = () => {
  const ctx = analyticsCanvas.getContext('2d');
  chartInstance = new Chart(ctx, {
    type: 'line',
    data: {
      labels: stats.dailyRange.map(e => e.date.split('-').slice(1).join('/')),
      datasets: [{
        label: 'Phrases',
        data: stats.dailyRange.map(e => e.count),
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56, 189, 248, 0.1)',
        fill: true,
        tension: 0.4,
        pointRadius: 0
      }]
    },
    options: {
      responsive: true,
      plugins: { legend: { display: false } },
      scales: {
        x: { display: false },
        y: { display: false, beginAtZero: true }
      }
    }
  });
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
  if (history.length === 0) {
    historyList.innerHTML = '<div class="empty-state">No recent translations</div>';
    return;
  }
  historyList.innerHTML = history.map(item => `
    <div class="item-card" onclick="document.getElementById('original-text').textContent='${item.orig.replace(/'/g, "\\'")}'; document.getElementById('translated-text').textContent='${item.trans.replace(/'/g, "\\'")}';">
      <div class="orig">${item.orig}</div>
      <div class="trans">${item.trans}</div>
    </div>
  `).join('');
};

const renderFavorites = () => {
  if (favorites.length === 0) {
    favoritesList.innerHTML = '<div class="empty-state">No favorites yet</div>';
    return;
  }
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

// --- PRO MODAL LOGIC ---

const openModal = (title, contentHTML) => {
  modalTitle.textContent = title;
  modalBody.innerHTML = contentHTML;
  proModal.classList.add('active');
};

closeModal.onclick = () => proModal.classList.remove('active');
window.onclick = (e) => { if (e.target === proModal) proModal.classList.remove('active'); };

// OCR Logic
ocrBtn.onclick = () => ocrUpload.click();

ocrUpload.onchange = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  openModal('Scanning Image...', `
    <div style="text-align:center; padding: 2rem;">
      <div class="shimmer" style="height: 100px; border-radius: 12px; margin-bottom: 1rem;"></div>
      <p>Analyzing text with OCR...</p>
    </div>
  `);

  try {
    const result = await Tesseract.recognize(file, 'eng+fin', {
      logger: m => console.log(m)
    });
    const text = result.data.text.trim();
    if (text) {
      originalDisplay.textContent = text;
      const source = langToggle.checked ? 'fi' : 'en';
      const target = langToggle.checked ? 'en' : 'fi';
      translateText(text, source, target);
      proModal.classList.remove('active');
      showToast('Text extracted successfully!');
    } else {
      modalBody.innerHTML = '<p style="color:var(--error)">No text found in image.</p>';
    }
  } catch (err) {
    modalBody.innerHTML = `<p style="color:var(--error)">OCR Error: ${err.message}</p>`;
  }
};

// Study Space (Flashcards)
let currentCardIdx = 0;
learnBtn.onclick = () => {
  if (favorites.length === 0) {
    showToast('Add some favorites first!');
    return;
  }
  currentCardIdx = 0;
  renderFlashcard();
};

const renderFlashcard = () => {
  const card = favorites[currentCardIdx];
  const content = `
    <div class="flashcard" id="current-flashcard">
      <div class="flashcard-inner">
        <div class="card-front">${card.orig}</div>
        <div class="card-back">${card.trans}</div>
      </div>
    </div>
    <div class="modal-footer">
      <button class="pro-btn" id="prev-card">←</button>
      <span>${currentCardIdx + 1} / ${favorites.length}</span>
      <button class="pro-btn" id="next-card">→</button>
    </div>
  `;
  openModal('Study Space', content);

  const fc = document.getElementById('current-flashcard');
  fc.onclick = () => fc.classList.toggle('flipped');

  document.getElementById('prev-card').onclick = () => {
    currentCardIdx = (currentCardIdx - 1 + favorites.length) % favorites.length;
    renderFlashcard();
  };
  document.getElementById('next-card').onclick = () => {
    currentCardIdx = (currentCardIdx + 1) % favorites.length;
    renderFlashcard();
  };
};

// Conversation Mode
convBtn.onclick = () => {
  body.classList.toggle('conversation-active');
  if (body.classList.contains('conversation-active')) {
    showToast('Conversation Mode Active - Mic handles bi-directional flow');
    // In this mode, we could potentially use two mic buttons,
    // but for now, we'll just make the UI more "immersive".
    h1.style.display = 'none';
  } else {
    h1.style.display = 'block';
  }
};

// Quote Card Generator
shareImgBtn.onclick = async () => {
  const box = document.getElementById('trans-box');
  showToast('Generating Quote Card...');
  const canvas = await html2canvas(box, {
    backgroundColor: '#0f172a',
    scale: 2
  });
  const link = document.createElement('a');
  link.download = `lingua-quote-${Date.now()}.png`;
  link.href = canvas.toDataURL();
  link.click();
  showToast('Card saved to gallery!');
};

// --- UTILITIES ---
const getSimilarity = (s1, s2) => {
  if (!s1 || !s2) return 0;
  let longer = s1.length > s2.length ? s1 : s2;
  let shorter = s1.length > s2.length ? s2 : s1;
  let longerLength = longer.length;
  if (longerLength === 0) return 1.0;
  return (longerLength - editDistance(longer, shorter)) / parseFloat(longerLength);
};

const editDistance = (s1, s2) => {
  s1 = s1.toLowerCase(); s2 = s2.toLowerCase();
  let costs = [];
  for (let i = 0; i <= s1.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= s2.length; j++) {
      if (i === 0) costs[j] = j;
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (s1.charAt(i - 1) !== s2.charAt(j - 1)) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[s2.length] = lastValue;
  }
  return costs[s2.length];
};

// --- LIVE VISION & SUBTITLES (v6.0) ---

let cameraStream = null;
let visionInterval = null;
let lastVisionText = '';
let stableCount = 0;

const updateSubtitles = (text, isInterim = false) => {
  if (!text) {
    subtitleOverlay.classList.remove('active');
    return;
  }
  subtitleOverlay.classList.add('active');
  subtitleContent.innerHTML = isInterim ? `<span class="interim">${text}...</span>` : text;

  // Auto-hide after 5s if final
  if (!isInterim) {
    clearTimeout(subtitleContent.timer);
    subtitleContent.timer = setTimeout(() => subtitleOverlay.classList.remove('active'), 5000);
  }
};

visionBtn.onclick = () => {
  openModal('Live Vision 2.0', `
    <div class="vision-container">
      <video id="vision-video" autoplay playsinline muted></video>
      <div class="vision-focus-frame"></div>
      <div id="vision-ar" class="vision-ar-layer"></div>
    </div>
    <div style="margin-top: 1rem; text-align: center; color: var(--text-secondary); font-size: 0.85rem">
      Align text inside the focus box for pro results
    </div>
  `);
  startCamera();
};

const startCamera = async () => {
  try {
    const video = document.getElementById('vision-video');
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' }
    });
    video.srcObject = cameraStream;

    // Start OCR loop
    visionInterval = setInterval(captureVisionFrame, 2000);
  } catch (err) {
    console.error('Camera Error:', err);
    showToast('Camera access denied');
  }
};

const captureVisionFrame = async () => {
  const video = document.getElementById('vision-video');
  const arLayer = document.getElementById('vision-ar');
  if (!video || video.paused || video.readyState < 2) return;

  if (video.videoWidth < 100 || video.videoHeight < 100) return;

  // --- Center-Weighted ROI (Crop to 60% of center) ---
  const canvas = document.createElement('canvas');
  const cropSize = 0.6;
  const sw = video.videoWidth * cropSize;
  const sh = video.videoHeight * cropSize;
  const sx = (video.videoWidth - sw) / 2;
  const sy = (video.videoHeight - sh) / 2;

  canvas.width = sw;
  canvas.height = sh;
  const ctx = canvas.getContext('2d');

  ctx.filter = 'grayscale(1) contrast(1.6) brightness(1.2)';
  ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);

  try {
    const result = await Tesseract.recognize(canvas, 'eng+fin');
    let text = result.data.text.trim()
      .replace(/[\n\r]+/g, ' ')
      .replace(/[^a-zA-Z0-9 äöåÄÖÅ,.!?']/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    if (text.length > 3 && /[a-zA-Zäöå]/.test(text)) {
      updateSubtitles(text, true);

      // --- Fuzzy Stability (80% similarity threshold) ---
      const similarity = getSimilarity(text, lastVisionText);
      if (similarity > 0.8) {
        stableCount++;
      } else {
        stableCount = 0;
        lastVisionText = text;
        return;
      }

      if (stableCount >= 1) {
        const source = langToggle.checked ? 'fi' : 'en';
        const target = langToggle.checked ? 'en' : 'fi';
        const targetLabel = langToggle.checked ? 'EN' : 'FI';

        arLayer.innerHTML = `<div class="ar-tag" style="top:40%; left:10%">🔄 Interpreting...</div>`;

        const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${source}|${target}`);
        const data = await response.json();

        if (data.responseData) {
          let translated = data.responseData.translatedText;

          if (!translated || translated.toLowerCase().includes('unknown') || translated === text) {
            arLayer.innerHTML = `<div class="ar-tag" style="top:40%; left:10%; background:rgba(255,165,0,0.5)">⚠️ Retrying...</div>`;
            return;
          }

          // Force update AR Tag and Subtitles
          arLayer.innerHTML = `
            <div class="ar-tag" style="top:35%; left:10%">
              <span style="font-size:0.6rem; opacity:0.8; display:block; margin-bottom:2px">TRANSLATED TO ${targetLabel}</span>
              ✨ ${translated}
            </div>`;

          updateSubtitles(translated, false);
          console.log(`Vision translated: ${text} -> ${translated}`);
        }
      }
    } else if (text.length === 0) {
      stableCount = 0;
    }
  } catch (err) {
    console.warn('Vision OCR error', err);
  }
};

// Cleanup camera on modal close
const originalClose = closeModal.onclick;
closeModal.onclick = () => {
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  clearInterval(visionInterval);
  originalClose();
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

    // Gradient Glow
    const gradient = ctx.createLinearGradient(0, height - barHeight, 0, height);
    gradient.addColorStop(0, getComputedStyle(body).getPropertyValue('--accent-color'));
    gradient.addColorStop(1, getComputedStyle(body).getPropertyValue('--accent-secondary'));

    ctx.fillStyle = gradient;
    ctx.shadowBlur = 10;
    ctx.shadowColor = getComputedStyle(body).getPropertyValue('--accent-color');

    // Rounded bars
    const radius = 4;
    ctx.beginPath();
    ctx.roundRect(x, height - barHeight, barWidth, barHeight, [radius, radius, 0, 0]);
    ctx.fill();

    ctx.shadowBlur = 0; // Reset for next bar
    x += barWidth + 2;
  }
};

// --- CORE LOGIC ---

const translateText = async (text, source, target) => {
  if (!text.trim()) return;

  transBox.classList.add('shimmer');
  try {
    let query = text;
    if (target === 'fi' && toneToggle.checked) {
      // Logic for Finnish Spoken flair (Puhekieli)
      // This is a mock/simple text replacement to simulate "spoken" style
      // e.g. replacing common endings or words if they match patterns
    }

    const response = await fetch(`https://api.mymemory.translated.net/get?q=${encodeURIComponent(query)}&langpair=${source}|${target}`);
    const data = await response.json();

    if (data.responseData) {
      let translated = data.responseData.translatedText;

      // Post-process for Tone (Puhekieli mock)
      if (target === 'fi' && toneToggle.checked) {
        translated = translated
          .replace(/minä olen/gi, 'mä oon')
          .replace(/sinä olet/gi, 'sä oot')
          .replace(/hän on/gi, 'se on')
          .replace(/me olemme/gi, 'me ollaan')
          .replace(/te olette/gi, 'te ootte')
          .replace(/he ovat/gi, 'ne on');
      }

      translatedDisplay.textContent = translated;

      // Grammar Insights (Pro feature)
      if (target === 'fi') {
        const cases = ['ssa', 'lla', 'sta', 'lta', 'lla', 'ksi', 'hän', 'ko'];
        const found = cases.filter(c => translated.toLowerCase().includes(c));
        if (found.length > 0) {
          grammarHint.style.display = 'block';
          grammarHint.textContent = `💡 Hint: Uses '${found[0]}' ending for context.`;
        } else {
          grammarHint.style.display = 'none';
        }
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

      // Toggle Checked: Finnish -> English
      // Toggle Unchecked: English -> Finnish
      const source = langToggle.checked ? 'fi' : 'en';
      const target = langToggle.checked ? 'en' : 'fi';
      translateText(finalTranscript, source, target);
      updateSubtitles(finalTranscript, false);
    } else {
      updateSubtitles(interimTranscript, true);
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

// Keyboard Shortcuts
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space' && e.target === document.body) {
    e.preventDefault();
    listenBtn.click();
  }
  if (e.ctrlKey && e.key === 'c' && translatedDisplay.textContent) {
    copyToClipboard(translatedDisplay.textContent);
  }
});

// Initial Load
renderHistory();
renderFavorites();
initAnalytics();
renderProStats();
