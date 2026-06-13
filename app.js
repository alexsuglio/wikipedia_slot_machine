const reels = [
  document.getElementById("reel-1"),
  document.getElementById("reel-2"),
  document.getElementById("reel-3")
];

const leverBtn = document.getElementById("leverBtn");
const themeSelect = document.getElementById("themeSelect");
const soundToggle = document.getElementById("soundToggle");
const titleEl = document.getElementById("articleTitle");
const extractEl = document.getElementById("articleExtract");
const linkEl = document.getElementById("articleLink");
const statusLine = document.getElementById("statusLine");

const wordsA = ["Quantum", "Forgotten", "Electric", "Ancient", "Invisible", "Solar", "Lost", "Golden"];
const wordsB = ["Library", "Penguin", "Cathedral", "Algorithm", "Volcano", "Railway", "Meteor", "Orchestra"];
const wordsC = ["Chronicles", "Theory", "Incident", "Paradox", "Archive", "Expedition", "Symphony", "Experiment"];

const THEME_MAP = {
  all: {
    label: "Anything",
    keywords: [],
    categories: []
  },
  history: {
    label: "History",
    keywords: ["history", "historical", "war", "empire", "ancient", "medieval"],
    categories: ["History", "Ancient_history", "Military_history"]
  },
  science: {
    label: "Science",
    keywords: ["science", "physics", "chemistry", "biology", "astronomy", "mathematics"],
    categories: ["Science", "Physics", "Biology", "Chemistry", "Astronomy"]
  },
  sports: {
    label: "Sports",
    keywords: ["sports", "sport", "athlete", "football", "basketball", "olympic"],
    categories: ["Sports", "Athletes", "Olympic_Games", "Team_sports"]
  },
  technology: {
    label: "Technology",
    keywords: ["technology", "software", "computer", "internet", "engineering", "electronics"],
    categories: ["Technology", "Software", "Computing", "Engineering"]
  },
  arts: {
    label: "Arts",
    keywords: ["art", "music", "film", "literature", "painting", "artist"],
    categories: ["Arts", "Music", "Film", "Literature"]
  }
};

const MAX_THEME_ATTEMPTS = 10;
const SOUND_STORAGE_KEY = "wiki-slot-sound-enabled";
const THEME_POOL_LIMIT = 140;
const THEME_POOL_TIMEOUT_MS = 1000;

let isSpinning = false;
let soundEnabled = localStorage.getItem(SOUND_STORAGE_KEY) !== "off";
let audioCtx = null;
const themePoolCache = new Map();
const themePoolInFlight = new Map();

function randomFrom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

function randomPlaceholderTitle() {
  return `${randomFrom(wordsA)} ${randomFrom(wordsB)} ${randomFrom(wordsC)}`;
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    delay(timeoutMs).then(() => {
      throw new Error("Timed out while loading themed article.");
    })
  ]);
}

function toWikiUrl(title) {
  const normalized = title.trim().replace(/\s+/g, "_");
  return `https://en.wikipedia.org/wiki/${encodeURIComponent(normalized)}`;
}

async function fetchRandomArticle() {
  const randomApi = "https://en.wikipedia.org/w/api.php?action=query&format=json&list=random&rnnamespace=0&rnlimit=1&origin=*";

  const randomRes = await fetch(randomApi);
  if (!randomRes.ok) {
    throw new Error("Wikipedia random API returned a bad response.");
  }

  const randomData = await randomRes.json();
  const randomItem = randomData?.query?.random?.[0];

  if (!randomItem?.title) {
    throw new Error("Wikipedia random API did not return a valid article.");
  }

  const title = randomItem.title;
  const pageId = randomItem.id;
  const url = toWikiUrl(title);

  let extract = "No preview available for this article yet.";

  try {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
    const summaryRes = await fetch(summaryUrl);

    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      if (summaryData?.extract) {
        extract = summaryData.extract;
      }
    }
  } catch {
    // Ignore summary errors and keep the fallback text.
  }

  return { title, pageId, url, extract };
}

async function fetchArticleCategories(pageId) {
  const categoriesUrl = `https://en.wikipedia.org/w/api.php?action=query&format=json&prop=categories&cllimit=max&clshow=!hidden&pageids=${encodeURIComponent(pageId)}&origin=*`;
  const res = await fetch(categoriesUrl);
  if (!res.ok) {
    throw new Error("Could not check article categories.");
  }

  const data = await res.json();
  const page = data?.query?.pages?.[String(pageId)] || Object.values(data?.query?.pages || {})[0];
  const categories = page?.categories || [];
  return categories.map((c) => String(c.title || "").replace(/^Category:/i, "").toLowerCase());
}

function hasThemeMatch(categories, keywords) {
  if (!keywords.length) {
    return true;
  }

  return keywords.some((keyword) => categories.some((cat) => cat.includes(keyword)));
}

async function fetchCategoryMembers(categoryName, limit = THEME_POOL_LIMIT) {
  const categoryApi = `https://en.wikipedia.org/w/api.php?action=query&format=json&list=categorymembers&cmtype=page&cmnamespace=0&cmlimit=${limit}&cmtitle=Category:${encodeURIComponent(categoryName)}&origin=*`;
  const res = await fetch(categoryApi);
  if (!res.ok) {
    throw new Error(`Category lookup failed for ${categoryName}.`);
  }

  const data = await res.json();
  return data?.query?.categorymembers || [];
}

async function fetchCategoryFallbackArticle(categoryName) {
  const members = await fetchCategoryMembers(categoryName, 300);
  if (!members.length) {
    throw new Error(`No pages found in Category:${categoryName}.`);
  }

  const pick = members[Math.floor(Math.random() * members.length)];
  const basic = {
    title: pick.title,
    pageId: pick.pageid,
    url: toWikiUrl(pick.title),
    extract: "No preview available for this article yet."
  };

  try {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(pick.title)}`;
    const summaryRes = await fetch(summaryUrl);
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      if (summaryData?.extract) {
        basic.extract = summaryData.extract;
      }
    }
  } catch {
    // Keep fallback extract if summary call fails.
  }

  return basic;
}

async function hydrateArticleFromCandidate(candidate) {
  const base = {
    title: candidate.title,
    pageId: candidate.pageid,
    url: toWikiUrl(candidate.title),
    extract: "No preview available for this article yet."
  };

  try {
    const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(candidate.title)}`;
    const summaryRes = await fetch(summaryUrl);
    if (summaryRes.ok) {
      const summaryData = await summaryRes.json();
      if (summaryData?.extract) {
        base.extract = summaryData.extract;
      }
    }
  } catch {
    // Keep fallback extract if summary call fails.
  }

  return base;
}

async function buildThemePool(themeKey) {
  const theme = THEME_MAP[themeKey] || THEME_MAP.all;
  if (!theme.categories.length) {
    return [];
  }

  const chosenCategories = [...theme.categories]
    .sort(() => Math.random() - 0.5)
    .slice(0, 2);

  const batches = await Promise.allSettled(chosenCategories.map((name) => fetchCategoryMembers(name)));
  const merged = [];
  const seen = new Set();

  batches.forEach((result) => {
    if (result.status !== "fulfilled") {
      return;
    }

    result.value.forEach((item) => {
      if (!item?.pageid || !item?.title) {
        return;
      }

      if (seen.has(item.pageid)) {
        return;
      }

      seen.add(item.pageid);
      merged.push(item);
    });
  });

  return merged;
}

async function getThemePool(themeKey) {
  if (themePoolCache.has(themeKey)) {
    return themePoolCache.get(themeKey);
  }

  if (themePoolInFlight.has(themeKey)) {
    return themePoolInFlight.get(themeKey);
  }

  const loading = buildThemePool(themeKey)
    .then((pool) => {
      themePoolCache.set(themeKey, pool);
      themePoolInFlight.delete(themeKey);
      return pool;
    })
    .catch((error) => {
      themePoolInFlight.delete(themeKey);
      throw error;
    });

  themePoolInFlight.set(themeKey, loading);
  return loading;
}

function prefetchThemePool(themeKey) {
  if (themeKey === "all") {
    return;
  }

  if (themePoolCache.has(themeKey) || themePoolInFlight.has(themeKey)) {
    return;
  }

  getThemePool(themeKey).catch(() => {
    // Ignore warmup failures; runtime fetch still has fallbacks.
  });
}

async function fetchRandomArticleByTheme(themeKey) {
  const theme = THEME_MAP[themeKey] || THEME_MAP.all;

  if (themeKey === "all") {
    return fetchRandomArticle();
  }

  try {
    const pool = await withTimeout(getThemePool(themeKey), THEME_POOL_TIMEOUT_MS);
    if (pool.length) {
      return hydrateArticleFromCandidate(randomFrom(pool));
    }
  } catch {
    // If pool load is slow or fails, fallback to random flow below.
  }

  try {
    const candidate = await fetchRandomArticle();
    const categories = await fetchArticleCategories(candidate.pageId);
    if (hasThemeMatch(categories, theme.keywords)) {
      return candidate;
    }
  } catch {
    // Continue to category fallback.
  }

  if (theme.categories.length) {
    return fetchCategoryFallbackArticle(randomFrom(theme.categories));
  }

  return fetchRandomArticle();
}

function ensureAudioContext() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (AC) {
      audioCtx = new AC();
    }
  }

  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }

  return audioCtx;
}

function playTone({ frequency, duration, type = "sine", volume = 0.08, detune = 0, when = 0 }) {
  if (!soundEnabled) {
    return;
  }

  const ctx = ensureAudioContext();
  if (!ctx) {
    return;
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const start = ctx.currentTime + when;
  const end = start + duration;

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, start);
  osc.detune.setValueAtTime(detune, start);

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(volume, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, end);

  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(start);
  osc.stop(end + 0.01);
}

function playLeverSound() {
  playTone({ frequency: 140, duration: 0.11, type: "triangle", volume: 0.09 });
  playTone({ frequency: 72, duration: 0.08, type: "square", volume: 0.045, when: 0.03 });
}

function startSpinAudio(durationMs) {
  if (!soundEnabled) {
    return () => {};
  }

  const tickTimer = setInterval(() => {
    const pitch = 260 + Math.random() * 160;
    playTone({ frequency: pitch, duration: 0.04, type: "square", volume: 0.035 });
  }, 95);

  const finishTimer = setTimeout(() => {
    playTone({ frequency: 330, duration: 0.08, type: "triangle", volume: 0.06 });
    playTone({ frequency: 440, duration: 0.09, type: "triangle", volume: 0.065, when: 0.08 });
    playTone({ frequency: 660, duration: 0.12, type: "triangle", volume: 0.07, when: 0.18 });
  }, Math.max(0, durationMs - 240));

  return () => {
    clearInterval(tickTimer);
    clearTimeout(finishTimer);
  };
}

function applySoundUiState() {
  soundToggle.setAttribute("aria-pressed", String(soundEnabled));
  soundToggle.textContent = soundEnabled ? "Sound: On" : "Sound: Off";
}

function startVisualSpin(durationMs = 2200, intervalMs = 95) {
  reels.forEach((reel) => reel.classList.add("spinning"));

  const ticker = setInterval(() => {
    reels.forEach((reel) => {
      reel.textContent = randomPlaceholderTitle();
    });
  }, intervalMs);

  return delay(durationMs).then(() => {
    clearInterval(ticker);
    reels.forEach((reel) => reel.classList.remove("spinning"));
  });
}

function setResult(article) {
  titleEl.textContent = article.title;
  extractEl.textContent = article.extract;
  linkEl.href = article.url;
  linkEl.textContent = "Open Article on Wikipedia";

  reels[0].textContent = "Wikipedia";
  reels[1].textContent = "says";
  reels[2].textContent = article.title;

  statusLine.textContent = `Hit! Page ID: ${article.pageId}`;
}

function setError(err) {
  titleEl.textContent = "Spin failed";
  extractEl.textContent = "Could not fetch a random article right now. Try another pull.";
  linkEl.href = "https://en.wikipedia.org/wiki/Special:Random";
  linkEl.textContent = "Open Random Article Manually";
  statusLine.textContent = err.message;
}

async function pullLever() {
  if (isSpinning) {
    return;
  }

  const themeKey = themeSelect.value in THEME_MAP ? themeSelect.value : "all";
  const spinDurationMs = 2200;

  isSpinning = true;
  leverBtn.disabled = true;
  leverBtn.classList.add("pulled");
  themeSelect.disabled = true;
  statusLine.textContent = `Spinning (${THEME_MAP[themeKey].label})...`;

  playLeverSound();
  const stopSpinAudio = startSpinAudio(spinDurationMs);

  try {
    const [article] = await Promise.all([fetchRandomArticleByTheme(themeKey), startVisualSpin(spinDurationMs, 90)]);
    setResult(article);
  } catch (err) {
    setError(err instanceof Error ? err : new Error("Unknown error while spinning."));
  } finally {
    stopSpinAudio();
    await delay(180);
    leverBtn.classList.remove("pulled");
    leverBtn.disabled = false;
    themeSelect.disabled = false;
    isSpinning = false;
  }
}

leverBtn.addEventListener("click", pullLever);

soundToggle.addEventListener("click", () => {
  soundEnabled = !soundEnabled;
  localStorage.setItem(SOUND_STORAGE_KEY, soundEnabled ? "on" : "off");
  applySoundUiState();
});

themeSelect.addEventListener("change", () => {
  prefetchThemePool(themeSelect.value);
});

applySoundUiState();

Object.keys(THEME_MAP).forEach((themeKey) => {
  prefetchThemePool(themeKey);
});
