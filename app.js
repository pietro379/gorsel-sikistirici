/* ==========================================================
   Image Compressor – Uygulama mantığı
   Tüm işlemler tarayıcıda yapılır: FileReader ile okunur,
   Canvas ile yeniden kodlanır. Hiçbir veri ağa gönderilmez.
   ========================================================== */

'use strict';

const MIME_TYPES = {
  webp: 'image/webp',
  jpeg: 'image/jpeg',
  png: 'image/png',
};

const EXTENSIONS = {
  webp: 'webp',
  jpeg: 'jpg',
  png: 'png',
};

// --- DOM referansları ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');
const qualityInput = document.getElementById('quality');
const qualityValue = document.getElementById('quality-value');
const formatInputs = document.querySelectorAll('input[name="format"]');
const resultsSection = document.getElementById('results-section');
const resultsList = document.getElementById('results');
const downloadAllButton = document.getElementById('download-all');
const clearAllButton = document.getElementById('clear-all');
const zipBar = document.getElementById('zip-bar');
const zipSummary = document.getElementById('zip-summary');
const zipButton = document.getElementById('download-zip');
const zipButtonLabel = zipButton.querySelector('[data-role="label"]');

// Yüklenen görseller: { id, file, image, card, output }
let items = [];
let nextId = 1;
let recompressTimer = null;

// ---------- Yardımcılar ----------

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function getSettings() {
  const format = document.querySelector('input[name="format"]:checked').value;
  const quality = Number(qualityInput.value) / 100;
  return { format, quality };
}

// Data URL'deki base64 verisinden gerçek bayt boyutunu hesaplar
function dataUrlSize(dataUrl) {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function outputFileName(originalName, format) {
  const base = originalName.replace(/\.[^.]+$/, '') || 'gorsel';
  return `${base}-sikistirilmis.${EXTENSIONS[format]}`;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Görsel çözümlenemedi'));
    image.src = src;
  });
}

// ---------- Sıkıştırma ----------

function compress(image, { format, quality }) {
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const ctx = canvas.getContext('2d');

  // JPEG şeffaflığı desteklemez; şeffaf alanlar siyah yerine beyaz olsun
  if (format === 'jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(image, 0, 0);

  const mime = MIME_TYPES[format];
  const dataUrl = canvas.toDataURL(mime, quality);

  // Tarayıcı formatı desteklemiyorsa (ör. eski Safari'de WebP) PNG döner
  const actualFormat = dataUrl.startsWith(`data:${mime}`) ? format : 'png';

  return { dataUrl, size: dataUrlSize(dataUrl), format: actualFormat };
}

// ---------- Sonuç kartı ----------

function createCard(file) {
  const card = document.createElement('li');
  card.className =
    'result-card flex flex-col gap-4 rounded-2xl border border-white/5 bg-surface-800/80 p-4 sm:flex-row sm:items-center';

  card.innerHTML = `
    <img data-role="thumb" alt="" class="h-16 w-16 shrink-0 rounded-xl bg-surface-700 object-cover ring-1 ring-white/10">
    <div class="min-w-0 flex-1">
      <p data-role="name" class="truncate text-sm font-medium text-white"></p>
      <p data-role="dimensions" class="mt-0.5 text-xs text-slate-500">Yükleniyor…</p>
    </div>
    <div class="flex items-center gap-3 text-sm">
      <div class="text-right">
        <p class="text-xs text-slate-500">Orijinal</p>
        <p data-role="original-size" class="font-mono text-slate-300"></p>
      </div>
      <svg class="h-4 w-4 text-slate-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"/>
      </svg>
      <div>
        <p class="text-xs text-slate-500">Yeni</p>
        <p data-role="new-size" class="font-mono font-semibold text-white">—</p>
      </div>
      <span data-role="saving" class="saving-badge">—</span>
    </div>
    <a data-role="download" class="download-btn is-disabled" aria-disabled="true">
      <svg class="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3"/>
      </svg>
      İndir
    </a>
  `;

  // Dosya adı kullanıcı verisidir; innerHTML yerine textContent ile yazılır
  card.querySelector('[data-role="name"]').textContent = file.name;
  card.querySelector('[data-role="original-size"]').textContent = formatBytes(file.size);

  return card;
}

function renderResult(item) {
  const { card, file, output } = item;
  const saving = 1 - output.size / file.size;
  const savingBadge = card.querySelector('[data-role="saving"]');
  const download = card.querySelector('[data-role="download"]');

  card.querySelector('[data-role="new-size"]').textContent = formatBytes(output.size);

  savingBadge.textContent =
    saving >= 0 ? `−%${Math.round(saving * 100)}` : `+%${Math.round(-saving * 100)}`;
  savingBadge.classList.toggle('is-worse', saving < 0);

  download.href = output.dataUrl;
  download.download = outputFileName(file.name, output.format);
  download.classList.remove('is-disabled');
  download.removeAttribute('aria-disabled');
}

function renderError(card, message) {
  card.classList.add('is-error');
  card.querySelector('[data-role="dimensions"]').textContent = message;
  card.querySelector('[data-role="saving"]').remove();
  card.querySelector('[data-role="download"]').remove();
}

function updateToolbar() {
  const ready = items.filter((item) => item.output);
  resultsSection.classList.toggle('hidden', resultsList.children.length === 0);
  downloadAllButton.disabled = ready.length === 0;
  downloadAllButton.textContent =
    ready.length === 0
      ? 'Önce görsel ekleyin'
      : ready.length === 1
        ? 'İndir'
        : `ZIP Olarak İndir (${ready.length})`;

  // ZIP çubuğu yalnızca birden fazla hazır görsel varsa görünür
  const showZip = ready.length > 1;
  zipBar.classList.toggle('hidden', !showZip);
  zipBar.classList.toggle('flex', showZip);
  if (showZip) {
    const originalTotal = ready.reduce((sum, item) => sum + item.file.size, 0);
    const newTotal = ready.reduce((sum, item) => sum + item.output.size, 0);
    zipSummary.textContent =
      `${ready.length} görsel · ${formatBytes(originalTotal)} → ${formatBytes(newTotal)}`;
  }
}

// ---------- Dosya işleme ----------

async function handleFiles(fileList) {
  const files = Array.from(fileList);
  if (files.length === 0) return;

  for (const file of files) {
    const card = createCard(file);
    resultsList.append(card); // kartlar yükleme sırasıyla alt alta dizilir
    updateToolbar();

    if (!file.type.startsWith('image/')) {
      renderError(card, 'Desteklenmeyen dosya türü');
      continue;
    }

    try {
      const src = await readFileAsDataUrl(file);
      const image = await loadImage(src);

      card.querySelector('[data-role="thumb"]').src = src;
      card.querySelector('[data-role="dimensions"]').textContent =
        `${image.naturalWidth} × ${image.naturalHeight} px`;

      const item = { id: nextId++, file, image, card, output: null };
      item.output = compress(image, getSettings());
      items.push(item);
      renderResult(item);
    } catch (error) {
      renderError(card, 'Görsel okunamadı');
    }
    updateToolbar();
  }
}

// Ayar değişince tüm görselleri yeniden sıkıştır
function recompressAll() {
  const settings = getSettings();
  for (const item of items) {
    item.output = compress(item.image, settings);
    renderResult(item);
  }
  updateToolbar(); // ZIP özetindeki toplam boyutlar da güncellensin
}

function scheduleRecompress() {
  clearTimeout(recompressTimer);
  recompressTimer = setTimeout(recompressAll, 150);
}

// ---------- Ayar paneli ----------

function syncQualityLabel() {
  const value = qualityInput.value;
  qualityValue.textContent = `%${value}`;
  // Slider'ın dolu kısmı; min=1 olduğu için oran hesaplanır
  const percent = ((value - qualityInput.min) / (qualityInput.max - qualityInput.min)) * 100;
  qualityInput.style.setProperty('--value', `${percent}%`);
}

qualityInput.addEventListener('input', () => {
  syncQualityLabel();
  scheduleRecompress();
});

formatInputs.forEach((input) => input.addEventListener('change', recompressAll));

// ---------- Dosya seçimi ve sürükle-bırak ----------

fileInput.addEventListener('change', () => {
  handleFiles(fileInput.files);
  fileInput.value = ''; // aynı dosya tekrar seçilebilsin
});

// Sürüklenen şey dosya mı? (sayfadan sürüklenen metin/link vurgulanmasın)
function isFileDrag(event) {
  return Array.from(event.dataTransfer?.types || []).includes('Files');
}

dropzone.addEventListener('dragover', (event) => {
  if (!isFileDrag(event)) return;
  event.preventDefault(); // drop'a izin vermek için gerekli
  event.dataTransfer.dropEffect = 'copy';
  dropzone.classList.add('is-dragover');
});

dropzone.addEventListener('dragleave', (event) => {
  // Alt öğeler arasında gezinirken titremeyi önle
  if (!dropzone.contains(event.relatedTarget)) {
    dropzone.classList.remove('is-dragover');
  }
});

dropzone.addEventListener('drop', (event) => {
  event.preventDefault();
  dropzone.classList.remove('is-dragover');
  if (event.dataTransfer.files.length > 0) {
    handleFiles(event.dataTransfer.files);
  }
});

// Alanın dışına bırakılan dosyanın tarayıcıda açılmasını engelle
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

// ---------- Toplu işlemler ----------

// Aynı ada sahip dosyalar ZIP içinde birbirini ezmesin: "ad (2).webp"
function uniqueName(name, usedNames) {
  if (!usedNames.has(name)) {
    usedNames.add(name);
    return name;
  }
  const dot = name.lastIndexOf('.');
  const base = name.slice(0, dot);
  const ext = name.slice(dot);
  let counter = 2;
  while (usedNames.has(`${base} (${counter})${ext}`)) counter++;
  const unique = `${base} (${counter})${ext}`;
  usedNames.add(unique);
  return unique;
}

async function downloadZip() {
  const ready = items.filter((item) => item.output);
  if (ready.length === 0) return;

  if (typeof JSZip === 'undefined') {
    alert('ZIP kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.');
    return;
  }

  zipButton.disabled = true;
  downloadAllButton.disabled = true;
  zipButtonLabel.textContent = 'ZIP hazırlanıyor…';

  try {
    const zip = new JSZip();
    const usedNames = new Set();

    for (const { file, output } of ready) {
      const base64 = output.dataUrl.slice(output.dataUrl.indexOf(',') + 1);
      const name = uniqueName(outputFileName(file.name, output.format), usedNames);
      zip.file(name, base64, { base64: true });
    }

    // Görseller zaten sıkıştırılmış; tekrar deflate etmek boşuna CPU harcar
    const blob = await zip.generateAsync({ type: 'blob', compression: 'STORE' });

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `sikistirilmis-gorseller-${ready.length}.zip`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    alert('ZIP dosyası oluşturulurken bir hata oluştu.');
  } finally {
    zipButton.disabled = false;
    zipButtonLabel.textContent = 'Tümünü ZIP Olarak İndir';
    updateToolbar();
  }
}

zipButton.addEventListener('click', downloadZip);

// Ayar panelindeki buton: tek görselde doğrudan indirir, birden fazlasında ZIP
downloadAllButton.addEventListener('click', () => {
  const ready = items.filter((item) => item.output);
  if (ready.length === 1) {
    ready[0].card.querySelector('[data-role="download"]').click();
  } else if (ready.length > 1) {
    downloadZip();
  }
});

clearAllButton.addEventListener('click', () => {
  items = [];
  resultsList.replaceChildren();
  updateToolbar();
});

syncQualityLabel();
