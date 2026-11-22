const searchInput = document.querySelector("#book-search");
const searchBox = document.querySelector(".search-box");
const genreButtons = document.querySelectorAll(".genre-chip");
const bookGrid = document.querySelector("#book-grid");
const emptyState = document.querySelector("#empty-state");
const toast = document.querySelector("#toast");
const menuToggle = document.querySelector("#menu-toggle");
const mainNav = document.querySelector(".main-nav");
const accountButton = document.querySelector("#account-button");
const authDialog = document.querySelector("#auth-dialog");
const authForm = document.querySelector("#auth-form");
const authNameField = document.querySelector("#auth-name-field");
const authTitle = document.querySelector("#auth-title");
const authSubmit = document.querySelector("#auth-submit");
const emailVerificationDialog = document.querySelector("#email-verification-dialog");
const emailVerificationForm = document.querySelector("#email-verification-form");
const verificationEmailLabel = document.querySelector("#verification-email");
let pendingVerificationEmail = "";

const librarySection = document.querySelector("#my-library");
const libraryNavLink = document.querySelector("#library-nav-link");
const myBooksList = document.querySelector("#my-books-list");
const myBooksEmpty = document.querySelector("#my-books-empty");
const bookForm = document.querySelector("#book-form");
const chapterEditorList = document.querySelector("#chapter-editor-list");
const readerDialog = document.querySelector("#reader-dialog");
const bookDetailsDialog = document.querySelector("#book-details-dialog");
const confirmDialog = document.querySelector("#confirm-dialog");
const chapterEditorDialog = document.querySelector("#chapter-editor-dialog");
const chapterEditorForm = document.querySelector("#chapter-editor-form");

const DEFAULT_READING_SETTINGS = {
  theme: "light",
  font: "serif",
  font_size: 19,
  line_height: 1.8,
  width: "standard",
};
const DEFAULT_SITE_SETTINGS = { theme: "light", language: "ru" };
const GAME_STAT_FIELDS = [
  { key: "strength", label: "Сила", min: 1, max: 30, value: 10 },
  { key: "dexterity", label: "Ловкость", min: 1, max: 30, value: 10 },
  { key: "constitution", label: "Телосложение", min: 1, max: 30, value: 10 },
  { key: "intelligence", label: "Интеллект", min: 1, max: 30, value: 10 },
  { key: "wisdom", label: "Мудрость", min: 1, max: 30, value: 10 },
  { key: "charisma", label: "Харизма", min: 1, max: 30, value: 10 },
  { key: "hp", label: "HP", min: 0, max: 999, value: 10 },
  { key: "max_hp", label: "Макс. HP", min: 1, max: 999, value: 10 },
  { key: "armor_class", label: "КД", min: 0, max: 99, value: 10 },
];

function readStoredArray(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(stored) ? stored.map(String) : [];
  } catch {
    return [];
  }
}

function renderRatingStars(container, rating) {
    container.querySelectorAll("[data-rating]").forEach((button) => {
      const value = Number(button.dataset.rating);
      button.classList.toggle("is-selected", value <= Number(rating || 0));
      button.disabled = !currentUser;
    });
  }

function renderBookDetails(book, updateHash = true) {
    activeDetailsBook = book;
    document.querySelector("#book-details-title").textContent = book.title;
    const authorButton = document.querySelector("#book-details-author");
    authorButton.textContent = `${book.author} · ${book.genre}`;
    authorButton.dataset.author = book.author;
    document.querySelector("#book-details-description").textContent =
      book.description || "Автор пока не добавил описание.";

    const cover = document.querySelector("#book-details-cover");
    const coverColors = {
      Романы: "#b87561",
      Фантастика: "#465f72",
      "Нон-фикшн": "#78836c",
      Детективы: "#55504d",
      Поэзия: "#856b83",
      Другое: "#737a69",
    };
    cover.style.backgroundColor = coverColors[book.genre] || coverColors.Другое;
    cover.replaceChildren(createElement("span", "", "✳"));
    cover.append(createElement("strong", "", book.title));
    cover.append(createElement("small", "", book.author.toLocaleUpperCase("ru")));

    const meta = document.querySelector("#book-details-meta");
    meta.replaceChildren();
    [
      `${book.age_rating}`,
      `${book.page_count || 0} стр.`,
      book.language || "Русский",
      book.chapters.length === 1 ? "1 глава" : `${book.chapters.length} глав`,
      `★ ${Number(book.rating || 0).toFixed(1)} (${book.rating_count || 0})`,
    ].forEach((item) => meta.append(createElement("span", "", item)));

    const tags = document.querySelector("#book-details-tags");
    tags.replaceChildren();
    (book.tags || []).forEach((tag) => {
      const button = createElement("button", "catalog-tag", `#${tag}`);
      button.type = "button";
      button.addEventListener("click", () => {
        selectedTag = tag;
        renderTagFilters();
        currentPage = 1;
        filterBooks();
        document.querySelector("#book-details-dialog").close();
        document.querySelector("#popular").scrollIntoView({ behavior: "smooth" });
        location.hash = "popular";
      });
      tags.append(button);
    });

    const chapters = document.querySelector("#book-details-chapters");
    chapters.replaceChildren(createElement("h3", "", "Главы"));
    if (!book.chapters.length) {
      chapters.append(createElement("p", "", "Автор пока не добавил главы."));
    } else {
      const chapterList = createElement("ol", "book-chapter-list");
      book.chapters.forEach((chapter, index) => {
        const item = createElement("li");
        const button = createElement("button", "", `${index + 1}. ${chapter.title}`);
        button.type = "button";
        button.addEventListener("click", () => {
          openReader(book, true, `#book/${book.id}`, index);
          closeDialog(bookDetailsDialog);
        });
        item.append(button);
        chapterList.append(item);
      });
      chapters.append(chapterList);
    }

    const ratingMessage = document.querySelector("#rating-message");
    const ratingControl = document.querySelector("#book-rating-control");
    if (currentUser && book.owner_id !== currentUser.id) {
      ratingMessage.textContent = book.user_rating
        ? "Твоя оценка сохранена"
        : "Оцени книгу один раз, оценку можно изменить";
    } else if (currentUser) {
      ratingMessage.textContent = "Авторы не могут оценивать свои книги";
    } else {
      ratingMessage.textContent = "Войди, чтобы оставить оценку";
    }
    ratingControl.querySelectorAll("[data-rating]").forEach((button) => {
      button.disabled = !currentUser || book.owner_id === currentUser.id;
    });
    renderRatingStars(ratingControl, book.user_rating || book.rating);

    const similar = allBooks
      .filter((item) => String(item.id) !== String(book.id))
      .map((item) => ({
        book: item,
        relevance:
          (item.genre === book.genre ? 2 : 0) +
          (item.tags || []).filter((tag) => (book.tags || []).includes(tag)).length,
      }))
      .filter((item) => item.relevance > 0)
      .sort((a, b) => b.relevance - a.relevance || b.book.rating - a.book.rating)
      .slice(0, 4)
      .map((item) => item.book);
    const similarList = document.querySelector("#similar-books-list");
    similarList.replaceChildren();
    similar.forEach((item) => {
      const button = createElement("button", "similar-book", "");
      button.type = "button";
      button.append(createElement("strong", "", item.title));
      button.append(createElement("span", "", `${item.author} · ${item.genre}`));
      button.addEventListener("click", () => {
        showBookDetails(item.id).catch((error) => showToast(error.message));
      });
      similarList.append(button);
    });
    document.querySelector("#details-read-button").disabled = book.chapters.length === 0;
    document.querySelector("#details-read-button").textContent =
      book.chapters.length ? "Читать онлайн ↗" : "Пока нет глав";
    const favoriteButton = document.querySelector("#details-favorite-button");
    const isFavorite = favoriteIds.has(String(book.id));
    favoriteButton.textContent = isFavorite ? "Убрать из избранного" : "В избранное";
    favoriteButton.setAttribute("aria-pressed", String(isFavorite));
    openDialog(bookDetailsDialog);
    if (updateHash && location.hash !== `#book/${book.id}`) {
      location.hash = `book/${book.id}`;
    }
  }

async function showBookDetails(bookId, updateHash = true) {
  const existingBook = allBooksById.get(String(bookId));
  let book = existingBook;
  if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
    book = await fetchBookDetails(bookId);
  }
  if (!book) throw new Error("Книга не найдена.");
  renderBookDetails(book, updateHash);
}

function readStoredObject(key) {
  try {
    const stored = JSON.parse(localStorage.getItem(key) || "{}");
    return stored && typeof stored === "object" && !Array.isArray(stored) ? stored : {};
  } catch {
    return {};
  }
}

function readReadingLibraryState() {
  const storedState = readStoredObject("biblio-reading-state");
  const legacyProgress = readStoredObject("biblio-reading-progress");
  const state = {};
  for (const [bookId, entry] of Object.entries(storedState)) {
    if (!entry || typeof entry !== "object") continue;
    if (!["reading", "completed"].includes(entry.status)) continue;
    const chapter = Number(entry.chapter);
    state[bookId] = {
      chapter: Number.isInteger(chapter) && chapter >= 0 ? chapter : 0,
      status: entry.status,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : "",
    };
  }
  for (const [bookId, chapterValue] of Object.entries(legacyProgress)) {
    if (state[bookId]) continue;
    const chapter = Number(chapterValue);
    if (!Number.isInteger(chapter) || chapter < 0) continue;
    state[bookId] = { chapter, status: "reading", updatedAt: "" };
  }
  return state;
}

let activeGenre = "Все";
let selectedGenres = new Set();
let favoritesOnly = new URLSearchParams(location.search).get("favorites") === "1";
let selectedTag = "";
let currentPage = 1;
const pageSize = 8;
let serverPage = 1;
let serverPageCount = 1;
let serverBookTotal = 0;
let allBooks = [];
let allBooksById = new Map();
let allBooksByAuthor = new Map();
let searchableTextById = new Map();
const bookDetailRequests = new Map();
let activeDetailsBook = null;
let favoriteIds = new Set(readStoredArray("biblio-favorites"));
let readingLibraryState = readReadingLibraryState();
let searchHistory = readStoredArray("biblio-search-history");
let currentUser = null;
let pendingAvatarData = null;
let editingBookId = null;
let authMode = "login";
let activeReaderBook = null;
let activeReaderChapter = 0;
let gameCatalogGames = [];
let activeCatalogGameSlug = "";
let activeGameRoomId = "";
let activeGameRoomSnapshot = "";
let gameRoomSyncPending = false;
let catalogPresenceTimer = 0;
let catalogPresenceToken = "";
let catalogPresenceRequestPending = false;
let readerReturnHash = "#popular";
let toastTimeout;
let activeDialog = null;
const switchingDialogs = new WeakSet();
let confirmResolver = null;
let editingChapters = [];
let editingChapterIndex = -1;
let chapterDraftTimeout = 0;
let chapterDraftChanged = false;
let siteSettings = { ...DEFAULT_SITE_SETTINGS };
let readingSettings = { ...DEFAULT_READING_SETTINGS };
let followedAuthors = new Set(readStoredArray("biblio-followed-authors"));
let pendingAuthorName = "";

async function api(path, options = {}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 15000);
  const startedAt = performance.now();
  try {
    const response = await fetch(path, {
      credentials: "same-origin",
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const elapsed = performance.now() - startedAt;
    if (elapsed >= 2000) {
      console.warn("[Biblio] Медленный API-ответ:", path, Math.round(elapsed) + " мс");
      if (elapsed >= 4000 && options.method && options.method !== "GET") {
        showToast("Сервер отвечает медленно. Не нажимай повторно — запрос ещё обрабатывается.");
      }
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(result.error || "Не удалось выполнить запрос.");
      error.status = response.status;
      throw error;
    }
    return result;
  } catch (error) {
    if (controller.signal.aborted && !options.signal) {
      throw new Error("Сервер не ответил за 15 секунд. Проверь соединение и попробуй ещё раз.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchBookDetails(bookId) {
  const key = String(bookId);
  if (!bookDetailRequests.has(key)) {
    const request = api(`/api/books/${encodeURIComponent(key)}`)
      .then((result) => result.book)
      .finally(() => bookDetailRequests.delete(key));
    bookDetailRequests.set(key, request);
  }
  return bookDetailRequests.get(key);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("is-visible");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => toast.classList.remove("is-visible"), 2600);
}

function openDialog(dialogOrId, trigger = document.activeElement) {
  const dialog =
    typeof dialogOrId === "string" ? document.getElementById(dialogOrId) : dialogOrId;
  if (!dialog) return;
  const previous = activeDialog?.open
    ? activeDialog
    : document.querySelector("dialog[open]");
  if (previous && previous !== dialog) {
    dialog.dataset.returnDialog = previous.id;
    switchingDialogs.add(previous);
    previous.close();
  } else if (!previous) {
    dialog.dataset.returnDialog = "";
  }
  if (dialog.id === "chapter-editor-dialog") {
    const opener = trigger instanceof HTMLElement ? trigger : null;
    openChapterEditor(Number(opener?.dataset.chapterIndex ?? -1), false);
  }
  activeDialog = dialog;
  if (!dialog.open) dialog.showModal();
  const backButton = dialog.querySelector("[data-back]");
  if (backButton) backButton.hidden = !dialog.dataset.returnDialog;
  if (dialog.id === "library-sort-dialog") syncFilterDialog();
  const firstField = dialog.querySelector("input:not([type=hidden]), select, textarea, button");
  firstField?.focus({ preventScroll: true });
  if (trigger instanceof HTMLElement && trigger !== document.body) {
    dialog.dataset.returnFocus = trigger.id || "";
  }
}

function closeDialog(dialog, restoreParent = false) {
  const parentId = dialog.dataset.returnDialog;
  if (dialog.open) {
    if (restoreParent && parentId) {
      switchingDialogs.add(dialog);
      if (dialog === readerDialog && location.hash.startsWith("#read/")) {
        history.replaceState(null, "", readerReturnHash);
      }
    }
    dialog.close();
  }
  if (restoreParent && parentId) {
    const parent = document.getElementById(parentId);
    if (parent) {
      activeDialog = parent;
      parent.showModal();
    }
  }
  if (activeDialog === dialog) activeDialog = null;
}

function askForConfirmation(message, title = "Вы уверены?", confirmLabel = "Подтвердить") {
  const previous = activeDialog?.open ? activeDialog : null;
  document.querySelector("#confirm-title").textContent = title;
  document.querySelector("#confirm-message").textContent = message;
  document.querySelector("#confirm-accept").textContent = confirmLabel;
  openDialog(confirmDialog);
  return new Promise((resolve) => {
    confirmResolver = (accepted) => {
      confirmResolver = null;
      closeDialog(confirmDialog);
      if (!accepted && previous?.isConnected && !previous.open) {
        activeDialog = previous;
        previous.showModal();
      }
      resolve(accepted);
    };
  });
}

document.addEventListener("click", (event) => {
  const opener = event.target.closest("[data-open]");
  if (opener) {
    event.preventDefault();
    openDialog(opener.dataset.open, opener);
    return;
  }
  const backButton = event.target.closest("[data-back]");
  if (backButton && activeDialog) {
    const parentId = activeDialog.dataset.returnDialog;
    const parent = parentId && document.getElementById(parentId);
    if (parent) {
      closeDialog(activeDialog);
      activeDialog = parent;
      parent.showModal();
    }
    return;
  }
  const closeButton = event.target.closest("[data-close]");
  if (closeButton) {
    const dialog = closeButton.closest("dialog");
    if (dialog) closeDialog(dialog, Boolean(dialog.dataset.returnDialog));
  }
});

document.querySelectorAll("dialog").forEach((dialog) => {
  dialog.addEventListener("click", (event) => {
    if (event.target !== dialog) return;
    if (dialog.id === "confirm-dialog") {
      confirmResolver?.(false);
      return;
    }
    closeDialog(dialog, Boolean(dialog.dataset.returnDialog));
  });
  dialog.addEventListener("cancel", (event) => {
    if (dialog.id !== "confirm-dialog" && dialog.dataset.returnDialog) {
      event.preventDefault();
      closeDialog(dialog, true);
    }
  });
  dialog.addEventListener("close", () => {
    if (activeDialog === dialog) activeDialog = null;
    if (switchingDialogs.has(dialog)) {
      queueMicrotask(() => switchingDialogs.delete(dialog));
    }
  });
});

document.querySelector("#confirm-cancel").addEventListener("click", () => {
  confirmResolver?.(false);
});
document.querySelector("#confirm-accept").addEventListener("click", () => {
  confirmResolver?.(true);
});
confirmDialog.addEventListener("cancel", () => {
  confirmResolver?.(false);
});
confirmDialog.addEventListener("close", () => {
  confirmResolver?.(false);
});
document.addEventListener("visibilitychange", () => {
  if (!activeCatalogGameSlug) return;
  if (document.hidden) stopCatalogPresence();
  else startCatalogPresence(activeCatalogGameSlug);
});
window.addEventListener("pagehide", stopCatalogPresence);

function filterBooks() {
  const query = searchInput.value.trim().toLocaleLowerCase("ru");
  const cards = [...bookGrid.querySelectorAll(".book-card")];
  // Search text is indexed once when the catalog loads, not on every filter keystroke.
  const ageRating = document.querySelector("#catalog-age").value;
  const language = document.querySelector("#catalog-language").value;
  const length = document.querySelector("#catalog-length").value;
  const minRating = Number(document.querySelector("#catalog-rating").value);
  const filtered = cards.filter((card) => {
    const book = allBooksById.get(card.dataset.bookId);
    if (!book) return false;
    const searchableText = searchableTextById.get(String(book.id)) || "";
    const matchesGenre =
      (activeGenre === "Все" || book.genre === activeGenre) &&
      (!selectedGenres.size || selectedGenres.has(book.genre));
    const matchesFavorites = !favoritesOnly || favoriteIds.has(String(book.id));
    const matchesAge = !ageRating || book.age_rating === ageRating;
    const matchesLanguage =
      !language ||
      (language === "Другой" ? book.language !== "Русский" && book.language !== "English" : book.language === language);
    const matchesLength =
      !length ||
      (length === "short" && book.page_count <= 100) ||
      (length === "medium" && book.page_count > 100 && book.page_count <= 300) ||
      (length === "long" && book.page_count > 300);
    const matchesRating = (Number(book.rating) || 0) >= minRating;
    const matchesTag = !selectedTag || (book.tags || []).includes(selectedTag);
    return (
      matchesGenre &&
      matchesFavorites &&
      matchesAge &&
      matchesLanguage &&
      matchesLength &&
      matchesRating &&
      matchesTag &&
      searchableText.includes(query)
    );
  });

  const sortBy = document.querySelector("#catalog-sort").value;
  filtered.sort((leftCard, rightCard) => {
    const left = allBooksById.get(leftCard.dataset.bookId);
    const right = allBooksById.get(rightCard.dataset.bookId);
    if (sortBy === "title") return left.title.localeCompare(right.title, "ru");
    if (sortBy === "rating") return right.rating - left.rating || right.rating_count - left.rating_count;
    if (sortBy === "newest") return String(right.created_at || "").localeCompare(String(left.created_at || ""));
    return right.rating * Math.log10((right.rating_count || 0) + 1) -
      left.rating * Math.log10((left.rating_count || 0) + 1);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const usingServerPagination = serverPageCount > 1;
  const visibleCards = usingServerPagination
    ? new Set(filtered)
    : new Set(filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize));
  cards.forEach((card) => {
    card.hidden = !visibleCards.has(card);
  });

  emptyState.hidden = filtered.length > 0;
  const catalogTotal = serverBookTotal || filtered.length;
  document.querySelector("#catalog-result-count").textContent =
    `Найдено книг: ${catalogTotal}${favoritesOnly ? " · избранное" : ""}`;
  const effectivePageCount = serverPageCount > 1 ? serverPageCount : pageCount;
  const effectivePage = serverPageCount > 1 ? serverPage : currentPage;
  document.querySelector("#page-indicator").textContent = `${effectivePage} / ${effectivePageCount}`;
  document.querySelector("#page-previous").disabled = effectivePage <= 1;
  document.querySelector("#page-next").disabled = effectivePage >= effectivePageCount;
  document.querySelector("#catalog-pagination").hidden = effectivePageCount <= 1;
  updateGenreCounts(cards);
}

function updateFavoriteButtons() {
  bookGrid.querySelectorAll(".book-card").forEach((card) => {
    const button = card.querySelector(".heart-button");
    if (!button) return;
    const isFavorite = favoriteIds.has(card.dataset.bookId);
    button.setAttribute("aria-pressed", String(isFavorite));
    button.setAttribute(
      "aria-label",
      `${isFavorite ? "Убрать из" : "Добавить в"} избранное: ${card.dataset.title}`,
    );
  });
}

function updateGenreCounts(cards) {
  const byGenre = new Map();
  cards.forEach((card) => {
    const book = allBooksById.get(card.dataset.bookId);
    if (book && (!favoritesOnly || favoriteIds.has(String(book.id)))) {
      byGenre.set(book.genre, (byGenre.get(book.genre) || 0) + 1);
    }
  });
  document.querySelectorAll("[data-genre-count]").forEach((counter) => {
    const genre = counter.dataset.genreCount;
    const count =
      genre === "Все"
        ? [...byGenre.values()].reduce((total, value) => total + value, 0)
        : byGenre.get(genre) || 0;
    counter.textContent = String(count).padStart(2, "0");
  });
}

function renderTagFilters() {
  const tags = [...new Set(allBooks.flatMap((book) => book.tags || []))].sort((a, b) =>
    a.localeCompare(b, "ru"),
  );
  const container = document.querySelector("#catalog-tags");
  container.replaceChildren();
  if (!tags.length) return;
  container.append(createElement("span", "catalog-tags__label", "Темы:"));
  tags.slice(0, 12).forEach((tag) => {
    const button = createElement("button", "catalog-tag", tag);
    button.type = "button";
    button.classList.toggle("is-active", tag === selectedTag);
    button.addEventListener("click", () => {
      selectedTag = selectedTag === tag ? "" : tag;
      currentPage = 1;
      renderTagFilters();
      filterBooks();
    });
    container.append(button);
  });
}

function renderSearchSuggestions(query) {
  const normalizedQuery = query.trim().toLocaleLowerCase("ru");
  const suggestions = new Set();
  if (normalizedQuery) {
    allBooks.forEach((book) => {
      for (const candidate of [book.title, book.author, ...(book.tags || [])]) {
        if (candidate.toLocaleLowerCase("ru").includes(normalizedQuery)) suggestions.add(candidate);
      }
    });
  }
  searchHistory.forEach((item) => suggestions.add(item));
  const datalist = document.querySelector("#search-suggestions");
  datalist.replaceChildren();
  [...suggestions].slice(0, 8).forEach((value) => {
    const option = document.createElement("option");
    option.value = value;
    datalist.append(option);
  });
  renderSearchHistory();
}

function renderSearchHistory() {
  const container = document.querySelector("#search-history");
  container.replaceChildren();
  if (!searchHistory.length || document.activeElement !== searchInput) {
    container.hidden = true;
    return;
  }
  container.hidden = false;
  container.append(createElement("span", "search-history__label", "Недавние запросы:"));
  searchHistory.slice(0, 5).forEach((query) => {
    const button = createElement("button", "search-history__item", query);
    button.type = "button";
    button.addEventListener("click", () => {
      searchInput.value = query;
      currentPage = 1;
      filterBooks();
      renderSearchSuggestions(query);
    });
    container.append(button);
  });
  const clear = createElement("button", "search-history__clear", "Очистить");
  clear.type = "button";
  clear.addEventListener("click", () => {
    searchHistory = [];
    localStorage.removeItem("biblio-search-history");
    renderSearchHistory();
    renderSearchSuggestions(searchInput.value);
  });
  container.append(clear);
}

function saveSearchQuery() {
  const query = searchInput.value.trim();
  if (query.length < 2) return;
  searchHistory = [query, ...searchHistory.filter((item) => item.toLocaleLowerCase("ru") !== query.toLocaleLowerCase("ru"))].slice(0, 8);
  localStorage.setItem("biblio-search-history", JSON.stringify(searchHistory));
  renderSearchSuggestions(query);
}

function persistFavorites() {
  persistFavorites();
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderReadingLibrary() {
  const booksById = allBooksById;
  const shelves = [
    {
      id: "reading-now",
      books: Object.entries(readingLibraryState)
        .filter(([, state]) => state.status === "reading")
        .map(([bookId]) => booksById.get(bookId))
        .filter(Boolean),
      emptyId: "reading-now-empty",
      countId: "reading-now-count",
    },
    {
      id: "reading-done",
      books: Object.entries(readingLibraryState)
        .filter(([, state]) => state.status === "completed")
        .map(([bookId]) => booksById.get(bookId))
        .filter(Boolean),
      emptyId: "reading-done-empty",
      countId: "reading-done-count",
    },
    {
      id: "favorites",
      books: [...favoriteIds].map((bookId) => booksById.get(bookId)).filter(Boolean),
      emptyId: "favorites-empty",
      countId: "favorites-count",
    },
  ];

  for (const shelf of shelves) {
    const list = document.querySelector(`#${shelf.id}-list`);
    list.replaceChildren();
    document.querySelector(`#${shelf.countId}`).textContent = String(shelf.books.length);
    document.querySelector(`#${shelf.emptyId}`).hidden = shelf.books.length > 0;
    for (const book of shelf.books) {
      const bookId = String(book.id);
      const state = readingLibraryState[bookId];
      const chapterCount = Array.isArray(book.chapters)
        ? book.chapters.length
        : Number(book.chapter_count) || 0;
      const chapter = state ? Math.min(state.chapter, Math.max(chapterCount - 1, 0)) : 0;
      const card = createElement("article", "library-book");
      const copy = createElement("div", "library-book__copy");
      const title = createElement("h3", "", book.title);
      const meta = createElement("p", "library-book__meta", `${book.author} · ${book.genre}`);
      copy.append(title, meta);

      if (shelf.id === "reading-now" || (shelf.id === "favorites" && state?.status === "reading")) {
        const progress = createElement("div", "library-book__progress");
        const label = createElement(
          "span",
          "",
          chapterCount
            ? `Глава ${chapter + 1} из ${chapterCount} · ${Math.round(((chapter + 1) / chapterCount) * 100)}%`
            : "Прогресс чтения сохранён",
        );
        const meter = document.createElement("progress");
        meter.max = 100;
        meter.value = chapterCount ? Math.round(((chapter + 1) / chapterCount) * 100) : 0;
        progress.append(label, meter);
        copy.append(progress);
      } else if (shelf.id === "reading-done") {
        copy.append(createElement("span", "library-book__status", "Прочитано"));
      }

      const actions = createElement("div", "library-book__actions");
      const openButton = createElement(
        "button",
        "button button--primary",
        shelf.id === "reading-now" || (shelf.id === "favorites" && state?.status === "reading")
          ? "Продолжить чтение"
          : shelf.id === "reading-done" || state?.status === "completed"
            ? "Перечитать"
            : "Читать",
      );
      openButton.type = "button";
      openButton.addEventListener("click", () => {
        if (shelf.id === "reading-done" || state?.status === "completed") {
          setBookCompleted(book, false, true);
        }
        openBookById(book.id, true).catch((error) => showToast(error.message));
      });
      actions.append(openButton);

      if (shelf.id === "reading-done") {
        const moveButton = createElement("button", "button button--secondary", "Вернуть в «Читаю сейчас»");
        moveButton.type = "button";
        moveButton.addEventListener("click", () => {
          setBookCompleted(book, false);
          showToast("Книга возвращена в «Читаю сейчас»");
        });
        actions.append(moveButton);
      }
      if (shelf.id === "favorites") {
        const removeButton = createElement("button", "row-button row-button--delete", "Убрать из избранного");
        removeButton.type = "button";
        removeButton.addEventListener("click", () => {
          favoriteIds.delete(bookId);
          persistFavorites();
          updateFavoriteButtons();
          renderReadingLibrary();
          showToast("Книга удалена из избранного");
        });
        actions.append(removeButton);
      }

      card.append(copy, actions);
      list.append(card);
    }
  }
}

function createCatalogCard(book) {
  const card = createElement("article", "book-card user-book-card");
  card.dataset.bookId = String(book.id);
  card.dataset.genre = book.genre;
  card.dataset.title = book.title;
  card.dataset.author = book.author;

  const cover = createElement("div", "book-cover cover--user");
  const colorByGenre = {
    "Романы": "#b87561",
    "Фантастика": "#465f72",
    "Нон-фикшн": "#78836c",
    "Детективы": "#55504d",
    "Поэзия": "#856b83",
    "Другое": "#737a69",
  };
  cover.style.backgroundColor = colorByGenre[book.genre] || colorByGenre.Другое;
  cover.append(createElement("span", "cover-label cover-label--light", "книга читателя"));
  cover.append(createElement("span", "user-cover-mark", "✳"));
  cover.append(createElement("span", "cover-title", book.title));
  cover.append(createElement("span", "cover-author", book.author.toLocaleUpperCase("ru")));
  const favoriteButton = createElement("button", "heart-button", "♡");
  favoriteButton.type = "button";
  cover.append(favoriteButton);

  const info = createElement("div", "book-info");
  const meta = createElement("div");
  meta.append(createElement("span", "book-category", `${book.genre} · ${book.age_rating}`));
  meta.append(
    createElement(
      "span",
      "book-rating",
      book.rating_count ? `★ ${Number(book.rating).toFixed(1)}` : "Новая книга",
    ),
  );
  const title = createElement("button", "book-title-link", book.title);
  title.type = "button";
  title.dataset.bookId = String(book.id);
  info.append(meta, title, createElement("p", "", book.author));

  const buy = createElement("div", "book-buy");
  buy.append(createElement("strong", "", "Бесплатно"));
  const detailsButton = createElement("button", "book-details-button", "Подробнее");
  detailsButton.type = "button";
  detailsButton.dataset.bookId = String(book.id);
  buy.append(detailsButton);
  info.append(buy);
  card.append(cover, info);
  return card;
}

function persistReadingLibraryState(progress) {
  try {
    localStorage.setItem("biblio-reading-progress", JSON.stringify(progress));
    localStorage.setItem("biblio-reading-state", JSON.stringify(readingLibraryState));
  } catch (error) {
    console.warn("Не удалось сохранить прогресс чтения:", error);
  }
}

function saveReadingPosition(book) {
  const bookId = String(book.id);
  const progress = readStoredObject("biblio-reading-progress");
  progress[bookId] = activeReaderChapter;
  const previous = readingLibraryState[bookId];
  readingLibraryState[bookId] = {
    chapter: activeReaderChapter,
    status: previous?.status === "completed" ? "completed" : "reading",
    updatedAt: new Date().toISOString(),
  };
  persistReadingLibraryState(progress);
  renderReadingLibrary();
}

function setBookCompleted(book, completed, restart = false) {
  const bookId = String(book.id);
  const chapterCount = Array.isArray(book.chapters)
    ? book.chapters.length
    : Number(book.chapter_count) || 0;
  const chapter = completed
    ? Math.max(0, chapterCount - 1)
    : restart
      ? 0
      : Math.min(readingLibraryState[bookId]?.chapter ?? 0, Math.max(0, chapterCount - 1));
  readingLibraryState[bookId] = {
    chapter,
    status: completed ? "completed" : "reading",
    updatedAt: new Date().toISOString(),
  };
  const progress = readStoredObject("biblio-reading-progress");
  progress[bookId] = chapter;
  persistReadingLibraryState(progress);
  if (activeReaderBook && String(activeReaderBook.id) === bookId) {
    activeReaderChapter = chapter;
    renderReaderChapter();
  }
  renderReadingLibrary();
}

function renderReaderChapter() {
  if (!activeReaderBook) return;
  const chapters = activeReaderBook.chapters;
  const chapter = chapters[activeReaderChapter];
  if (!chapter) return;
  const chapterList = document.querySelector("#reader-chapters");
  const section = createElement("section", "reader-chapter");
  const title = createElement("h3", "", chapter.title);
  const content = createElement("p", "", chapter.content);
  content.style.contentVisibility = "auto";
  content.style.containIntrinsicSize = "auto 800px";
  section.append(title, content);
  chapterList.replaceChildren(section);

  const chapterCount = chapters.length;
  document.querySelector("#reader-progress-label").textContent =
    `Глава ${activeReaderChapter + 1} из ${chapterCount}`;
  document.querySelector("#reader-progress").value =
    Math.round(((activeReaderChapter + 1) / chapterCount) * 100);
  document.querySelector("#reader-chapter-count").textContent =
    `${activeReaderChapter + 1} / ${chapterCount}`;
  document.querySelector("#previous-chapter").disabled = activeReaderChapter === 0;
  document.querySelector("#next-chapter").disabled = activeReaderChapter === chapterCount - 1;
  const isCompleted = readingLibraryState[String(activeReaderBook.id)]?.status === "completed";
  const isLastChapter = activeReaderChapter === chapters.length - 1;
  document.querySelector("#reader-mark-read").hidden = isCompleted || !isLastChapter;
  document.querySelector("#reader-mark-unread").hidden = !isCompleted;
  saveReadingPosition(activeReaderBook);
}

async function openReader(book, updateHash = true, returnHash = null, chapterIndex = null) {
  if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
    showToast("В этой книге пока нет глав для чтения.");
    return;
  }
  activeReaderBook = book;
  document.querySelector("#reader-title").textContent = book.title;
  document.querySelector("#reader-author").textContent =
    `${book.author} · ${book.genre} · ${book.age_rating}`;
  document.querySelector("#reader-description").textContent =
    book.description || "Автор пока не добавил описание.";
  const progress = readStoredObject("biblio-reading-progress");
  const savedState = readingLibraryState[String(book.id)];
  activeReaderChapter = Math.min(
    chapterIndex ?? savedState?.chapter ?? progress[String(book.id)] ?? 0,
    book.chapters.length - 1,
  );
  readerReturnHash =
    returnHash || (location.hash.startsWith("#book/") ? location.hash : `${location.pathname}${location.search}`);
  renderReaderChapter();
  openDialog(readerDialog);
  if (updateHash && location.hash !== `#read/${book.id}`) {
    location.hash = `read/${book.id}`;
  }
}

async function openBookById(bookId, updateHash = false) {
  if (readerDialog.open && activeReaderBook?.id === bookId) return;
  if (readerDialog.open && activeReaderBook?.id === Number(bookId)) return;
  const book = await fetchBookDetails(bookId);
  await openReader(book, updateHash);
}

function closeReaderRoute() {
  if (switchingDialogs.has(readerDialog)) return;
  if (!location.hash.startsWith("#read/")) return;
  history.replaceState(null, "", readerReturnHash);
  if (readerReturnHash.startsWith("#book/")) {
    showBookDetails(decodeURIComponent(readerReturnHash.slice("#book/".length)), false)
      .catch((error) => showToast(error.message));
  }
}

function readAppearance() {
  const legacy = readStoredObject("biblio-appearance");
  const storedReading = readStoredObject("biblio-reading-settings");
  readingSettings = {
    theme: ["light", "sepia", "dark"].includes(storedReading.theme || legacy.theme)
      ? storedReading.theme || legacy.theme
      : DEFAULT_READING_SETTINGS.theme,
    font: ["serif", "sans"].includes(storedReading.font) ? storedReading.font : DEFAULT_READING_SETTINGS.font,
    font_size: Math.max(16, Math.min(28, Number(storedReading.font_size ?? legacy.font_size) || 19)),
    line_height: Math.max(1.4, Math.min(2.4, Number(storedReading.line_height ?? legacy.line_height) || 1.8)),
    width: ["narrow", "standard", "wide"].includes(storedReading.width)
      ? storedReading.width
      : DEFAULT_READING_SETTINGS.width,
  };
  const storedSite = readStoredObject("biblio-site-settings");
  siteSettings = {
    theme: ["light", "sepia", "dark"].includes(storedSite.theme)
      ? storedSite.theme
      : ["light", "sepia", "dark"].includes(legacy.theme)
        ? legacy.theme
        : DEFAULT_SITE_SETTINGS.theme,
    language: "ru",
    email_digest: Boolean(storedSite.email_digest),
    push: Boolean(storedSite.push),
    reading_reminders: Boolean(storedSite.reading_reminders),
  };
  applySiteTheme();
  applyReadingSettings();
  fillSiteSettingsForm();
}

function applySiteTheme() {
  document.documentElement.dataset.theme = siteSettings.theme;
  document.querySelector("#site-settings-form").elements.theme.value = siteSettings.theme;
}

function applyReadingSettings() {
  document.documentElement.dataset.readerTheme = readingSettings.theme;
  document.documentElement.dataset.readerFont = readingSettings.font;
  document.documentElement.style.setProperty("--reader-font-size", `${readingSettings.font_size}px`);
  document.documentElement.style.setProperty("--reader-line-height", readingSettings.line_height);
  document.documentElement.style.setProperty(
    "--reader-column-width",
    { narrow: "480px", standard: "600px", wide: "760px" }[readingSettings.width],
  );
  const form = document.querySelector("#reading-settings-form");
  form.elements.theme.value = readingSettings.theme;
  form.elements.font.value = readingSettings.font;
  form.elements.font_size.value = readingSettings.font_size;
  form.elements.line_height.value = String(Math.round(readingSettings.line_height * 10));
  form.elements.width.value = readingSettings.width;
  document.querySelector("#font-size-value").textContent = `${readingSettings.font_size} px`;
  document.querySelector("#line-height-value").textContent =
    Number(readingSettings.line_height).toFixed(1);
  applyReadingPreview(readingSettings);
}

function applyReadingPreview(settings) {
  const preview = document.querySelector("#reading-preview");
  preview.dataset.readerTheme = settings.theme;
  preview.dataset.readerFont = settings.font;
  preview.dataset.readerWidth = settings.width;
  preview.style.setProperty("--preview-font-size", `${settings.font_size}px`);
  preview.style.setProperty("--preview-line-height", settings.line_height);
  preview.style.setProperty(
    "--preview-width",
    { narrow: "75%", standard: "90%", wide: "100%" }[settings.width],
  );
  document.querySelector("#font-size-value").textContent = `${settings.font_size} px`;
  document.querySelector("#line-height-value").textContent = Number(settings.line_height).toFixed(1);
}

function fillSiteSettingsForm() {
  const form = document.querySelector("#site-settings-form");
  form.elements.theme.value = siteSettings.theme;
  form.elements.language.value = siteSettings.language;
  for (const name of ["email_digest", "push", "reading_reminders"]) {
    form.elements[name].checked = Boolean(siteSettings[name]);
  }
}

function syncFilterDialog() {
  const form = document.querySelector("#library-sort-form");
  form.elements.age.value = document.querySelector("#catalog-age").value;
  form.elements.rating.value = document.querySelector("#catalog-rating").value;
  form.elements.length.value = document.querySelector("#catalog-length").value;
  form.elements.sort.value = document.querySelector("#catalog-sort").value;
  const active = selectedGenres.size ? selectedGenres : activeGenre === "Все" ? new Set() : new Set([activeGenre]);
  form.querySelectorAll('input[name="genre"]').forEach((input) => {
    input.checked = active.has(input.value);
  });
}

function showAuthor(authorName) {
  pendingAuthorName = authorName;
  const authorBooks = allBooksByAuthor.get(authorName) || [];
  const avatar = document.querySelector("#author-dialog-avatar");
  avatar.textContent = authorName.trim().charAt(0).toLocaleUpperCase("ru");
  document.querySelector("#author-dialog-name").textContent = authorName;
  document.querySelector("#author-dialog-bio").textContent =
    `Автор опубликованных книг Biblio · ${authorBooks.length} ${authorBooks.length === 1 ? "книга" : authorBooks.length < 5 ? "книги" : "книг"}`;
  const followButton = document.querySelector("#follow-author-button");
  const followed = followedAuthors.has(authorName);
  followButton.textContent = followed ? "Вы подписаны" : "Подписаться на автора";
  followButton.setAttribute("aria-pressed", String(followed));
  const list = document.querySelector("#author-books-list");
  list.replaceChildren();
  authorBooks.forEach((book) => {
    const button = createElement("button", "similar-book", "");
    button.type = "button";
    button.append(createElement("strong", "", book.title));
    button.append(createElement("span", "", `${book.genre} · ${book.age_rating}`));
    button.addEventListener("click", () => {
      showBookDetails(book.id).catch((error) => showToast(error.message));
    });
    list.append(button);
  });
  openDialog("author-dialog");
}

function downloadBook(book) {
  const contents = book.chapters
    .map((chapter, index) => `Глава ${index + 1}. ${chapter.title}\n\n${chapter.content}`)
    .join("\n\n");
  const blob = new Blob(
    [`${book.title}\n${book.author}\n\n${contents}`],
    { type: "text/plain;charset=utf-8" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${book.title.replace(/[\\/:*?"<>|]/g, "-")}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function setGenre(genre) {
  activeGenre = genre;
  selectedGenres.clear();
  currentPage = 1;
  genreButtons.forEach((button) => {
    button.classList.toggle("is-active", button.dataset.genre === genre);
  });
  refreshPublishedBooks(1).catch((error) => showToast(error.message));
}

function renderPublishedAuthors() {
  const container = document.querySelector("#published-author-list");
  if (!container) return;
  const authors = new Map();
  allBooks.forEach((book) => {
    const name = String(book.author || "").trim();
    if (name) authors.set(name, (authors.get(name) || 0) + 1);
  });
  const sortedAuthors = [...authors.entries()].sort(
    (a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ru"),
  );
  container.replaceChildren();
  if (!sortedAuthors.length) {
    container.append(createElement(
      "p",
      "author-empty",
      "Пока нет опубликованных книг. Здесь появятся настоящие авторы, когда пользователи поделятся своими историями.",
    ));
    return;
  }
  sortedAuthors.forEach(([name, count], index) => {
    const card = createElement("a", "author-card");
    card.href = "#popular";
    card.dataset.author = name;
    const avatar = createElement(
      "span",
      `author-avatar avatar--${["one", "two", "three", "four"][index % 4]}`,
      name.charAt(0).toLocaleUpperCase("ru"),
    );
    const details = createElement("span");
    const label = count === 1 ? "опубликованная книга" : count < 5 ? "опубликованные книги" : "опубликованных книг";
    details.append(createElement("strong", "", name), createElement("small", "", `${count} ${label}`));
    card.append(avatar, details, createElement("span", "author-arrow", "↗"));
    container.append(card);
  });
}

async function refreshPublishedBooks(page = serverPage) {
  const params = new URLSearchParams({
    page: String(page),
    limit: String(pageSize),
    q: searchInput.value.trim(),
    genre: activeGenre,
    genres: [...selectedGenres].join(","),
    sort: document.querySelector("#catalog-sort").value,
  });
  const data = await api(`/api/books?${params.toString()}`);
  const books = data.books || [];
  serverPage = Number(data.page) || 1;
  serverPageCount = Number(data.pages) || 1;
  serverBookTotal = Number(data.total) || books.length;
  allBooks = books;
  allBooksById = new Map(books.map((book) => [String(book.id), book]));
  searchableTextById = new Map(
    books.map((book) => [
      String(book.id),
      [book.title, book.author, book.description || "", ...(book.tags || [])]
        .join(" ")
        .toLocaleLowerCase("ru"),
    ]),
  );
  allBooksByAuthor = new Map();
  books.forEach((book) => {
    const author = String(book.author || "").trim();
    if (!author) return;
    const authorBooks = allBooksByAuthor.get(author) || [];
    authorBooks.push(book);
    allBooksByAuthor.set(author, authorBooks);
  });
  renderPublishedAuthors();
  bookGrid.replaceChildren();
  books.forEach((book) => bookGrid.append(createCatalogCard(book)));
  renderTagFilters();
  updateFavoriteButtons();
  renderReadingLibrary();
  filterBooks();
}

function renderChapterEditorList() {
  chapterEditorList.replaceChildren();
  editingChapters.forEach((chapter, index) => {
    const row = createElement("article", "chapter-summary");
    const title = createElement("strong", "", chapter.title || `Глава ${index + 1}`);
    const status = createElement(
      "small",
      "",
      chapter.content.trim() ? "Черновик сохранён в форме" : "Текст пока не добавлен",
    );
    const edit = createElement("button", "row-button", "Редактировать");
    edit.type = "button";
    edit.dataset.open = "chapter-editor-dialog";
    edit.dataset.chapterIndex = String(index);
    edit.setAttribute("aria-controls", "chapter-editor-dialog");
    const remove = createElement("button", "row-button row-button--delete", "Удалить");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!(await askForConfirmation(`Удалить главу «${chapter.title}»?`, "Удалить главу?"))) return;
      editingChapters.splice(index, 1);
      renderChapterEditorList();
    });
    row.append(title, status, edit, remove);
    chapterEditorList.append(row);
  });
}

function openChapterEditor(index = -1, show = true) {
  editingChapterIndex = index;
  const chapter = editingChapters[index] || {
    title: `Глава ${editingChapters.length + 1}`,
    content: "",
  };
  const storedDraft = readStoredObject("biblio-chapter-draft");
  const draftMatches =
    storedDraft.bookId === (editingBookId || `new-${currentUser?.id || "guest"}`) &&
    storedDraft.chapterIndex === index;
  chapterEditorForm.elements.title.value = draftMatches ? storedDraft.title : chapter.title;
  chapterEditorForm.elements.content.value = draftMatches ? storedDraft.content : chapter.content;
  document.querySelector("#chapter-editor-title").textContent =
    index < 0 ? "Новая глава" : "Редактировать главу";
  document.querySelector("#chapter-autosave-status").textContent = draftMatches
    ? "Черновик восстановлен"
    : "";
  chapterDraftChanged = false;
  if (show) openDialog(chapterEditorDialog);
}

function persistChapterDraft() {
  localStorage.setItem(
    "biblio-chapter-draft",
    JSON.stringify({
      bookId: editingBookId || `new-${currentUser?.id || "guest"}`,
      chapterIndex: editingChapterIndex,
      title: chapterEditorForm.elements.title.value,
      content: chapterEditorForm.elements.content.value,
    }),
  );
  chapterDraftChanged = false;
  document.querySelector("#chapter-autosave-status").textContent =
    "Черновик автоматически сохранён на этом устройстве";
}

function hasUnsavedChapterDraft() {
  const draft = readStoredObject("biblio-chapter-draft");
  if (!editingBookId || draft.bookId !== editingBookId) return false;
  const chapter = editingChapters[draft.chapterIndex] || {};
  return chapter.title !== draft.title || chapter.content !== draft.content;
}

function resetBookForm() {
  bookForm.elements.custom_genre.value = "";
  bookForm.elements.custom_genre.hidden = true;
  bookForm.elements.custom_genre.required = false;
  editingBookId = null;
  editingChapters = [];
  bookForm.reset();
  renderChapterEditorList();
  document.querySelector("#editor-title").textContent = "Создать книгу";
  document.querySelector("#cancel-edit").hidden = true;
  bookForm.dataset.initialState = "";
}

function fillBookForm(book) {
  editingBookId = book.id;
  for (const [name, value] of Object.entries({
    title: book.title,
    author: book.author,
    genre: book.genre,
    age_rating: book.age_rating,
    language: book.language,
    tags: book.tags.join(", "),
    description: book.description,
  })) {
    bookForm.elements[name].value = value;
  }
  editingChapters = book.chapters.map(({ title, content }) => ({ title, content }));
  renderChapterEditorList();
  bookForm.dataset.initialState = JSON.stringify({
    fields: [...new FormData(bookForm).entries()],
    chapters: editingChapters,
  });
  document.querySelector("#editor-title").textContent = "Редактировать книгу";
  document.querySelector("#cancel-edit").hidden = false;
  document.querySelector("#book-editor").scrollIntoView({ behavior: "smooth", block: "start" });
}

function renderMyBooks(books) {
  myBooksList.replaceChildren();
  document.querySelector("#my-books-count").textContent = String(books.length);
  myBooksEmpty.hidden = books.length > 0;
  books.forEach((book) => {
    const row = createElement("article", "my-book-row");
    const title = createElement("div", "my-book-row__title");
    title.append(createElement("strong", "", book.title));
    title.append(
      createElement(
        "small",
        "",
        `${book.author} · ${book.genre} · ${book.chapters.length} ${
          book.chapters.length === 1 ? "глава" : "глав"
        }`,
      ),
    );
    const status = createElement(
      "span",
      `book-status${book.status === "published" ? " book-status--published" : ""}`,
      book.status === "published" ? "Опубликована" : "Черновик",
    );
    const edit = createElement("button", "row-button", "Редактировать");
    edit.type = "button";
    edit.addEventListener("click", () => fillBookForm(book));
    const remove = createElement("button", "row-button row-button--delete", "Удалить");
    remove.type = "button";
    remove.addEventListener("click", async () => {
      if (!(await askForConfirmation(
        `Удалить книгу «${book.title}»? Это действие нельзя отменить.`,
        "Удалить книгу?",
      ))) return;
      try {
        await api(`/api/books/${book.id}`, { method: "DELETE" });
        if (editingBookId === book.id) {
          const draft = readStoredObject("biblio-chapter-draft");
          if (draft.bookId === book.id) localStorage.removeItem("biblio-chapter-draft");
          resetBookForm();
        }
        await refreshMyBooks();
        await refreshPublishedBooks();
        showToast("Книга удалена");
      } catch (error) {
        showToast(error.message);
      }
    });
    row.append(title, status, edit, remove);
    myBooksList.append(row);
  });
}

async function refreshMyBooks() {
  const { books } = await api("/api/my/books");
  renderMyBooks(books);
}

function updateAccountUI() {
  const isLoggedIn = Boolean(currentUser);
  accountButton.textContent = isLoggedIn ? currentUser.display_name : "Войти";
  accountButton.setAttribute(
    "aria-label",
    isLoggedIn ? `Аккаунт: ${currentUser.display_name}` : "Войти в аккаунт",
  );
  accountButton.setAttribute("aria-controls", isLoggedIn ? "profile-dialog" : "auth-dialog");
  accountButton.dataset.open = isLoggedIn ? "profile-dialog" : "auth-dialog";
  librarySection.hidden = !isLoggedIn;
  libraryNavLink.hidden = false;
  document.querySelector("#account-settings-card").hidden = !isLoggedIn;
  applyPageLayout();
  if (!isLoggedIn) return;

  document.querySelector("#profile-name").textContent = currentUser.display_name;
  document.querySelector("#profile-email").textContent = currentUser.email;
  document.querySelector("#profile-bio").textContent = currentUser.bio || "Пока без описания";
  ["#profile-avatar", "#profile-dialog-avatar"].forEach((selector) => {
    const avatar = document.querySelector(selector);
    if (!avatar) return;
    avatar.replaceChildren();
    if (currentUser.avatar_url) {
      const image = document.createElement("img");
      image.src = currentUser.avatar_url;
      image.alt = "Аватар профиля";
      image.decoding = "async";
      image.loading = "lazy";
      avatar.append(image);
    } else {
      avatar.textContent = currentUser.display_name.trim().charAt(0).toLocaleUpperCase("ru");
    }
  });
  const profileForm = document.querySelector("#profile-form");
  profileForm.elements.display_name.value = currentUser.display_name;
  profileForm.elements.email.value = currentUser.email;
  profileForm.elements.bio.value = currentUser.bio || "";
}

function renderGameCatalogCards() {
  const list = document.querySelector("#game-catalog-list");
  if (!list) return;
  list.replaceChildren();
  if (!gameCatalogGames.length) {
    list.append(createElement("p", "empty-state", "В каталоге пока нет игр."));
    return;
  }
  gameCatalogGames.forEach((game) => list.append(createGameCatalogCard(game)));
}

function createGameCatalogCard(game) {
  const card = createElement("button", "game-catalog-card", "");
  card.type = "button";
  card.dataset.slug = game.slug;
  card.setAttribute("aria-label", `Открыть игру: ${game.title}`);
  const cover = createElement("span", "game-catalog-card__cover");
  cover.dataset.theme = game.cover_theme;
  cover.append(
    createElement("span", "game-catalog-card__cover-mark", game.cover_symbol),
    createElement("strong", "game-catalog-card__cover-title", game.title),
  );
  const info = createElement("span", "game-catalog-card__info");
  info.append(createElement("strong", "game-catalog-card__title", game.title));
  info.append(createElement(
    "span",
    "game-catalog-card__rating",
    `★ ${game.rating_count ? Number(game.rating).toFixed(1) : "—"} · ${game.rating_count} оценок`,
  ));
  const players = createElement("span", "game-catalog-card__players");
  players.append(createElement("span", "game-catalog-card__online-dot", ""));
  players.append(createElement("span", "game-catalog-card__online-count", String(game.active_viewers || 0)));
  players.append(document.createTextNode(" сейчас в игре"));
  info.append(players);
  card.append(cover, info);
  card.addEventListener("click", () => {
    window.location.assign(game.slug === "bunker-online" ? "/games/bunker-online.html" : `/games/${encodeURIComponent(game.slug)}`);
  });
  return card;
}

async function refreshGameCatalog() {
  try {
    const result = await api("/api/catalog/games");
    gameCatalogGames = Array.isArray(result.games) ? result.games : [];
    renderGameCatalogCards();
  } catch (error) {
    showToast(error.message);
  }
}

async function openCatalogGame(slug) {
  try {
    const result = await api(`/api/catalog/games/${encodeURIComponent(slug)}`);
    const game = {
      ...result.game,
      rooms: result.rooms || [],
      private_rooms: result.private_rooms || [],
    };
    if (/\/play\/?$/.test(location.pathname)) renderGameRoomsPage(game);
    else renderCatalogGameDetail(game);
  } catch (error) {
    showToast(error.message);
  }
}

function renderCatalogGameDetail(game) {
  const panel = document.querySelector("#game-catalog-detail-panel");
  const catalogLayout = document.querySelector("#game-catalog-layout");
  if (!panel || !catalogLayout) return;
  stopCatalogPresence();
  activeCatalogGameSlug = game.slug;
  const listedGame = gameCatalogGames.find((item) => item.slug === game.slug);
  if (listedGame) Object.assign(listedGame, game);
  catalogLayout.hidden = true;
  document.querySelector("#game-detail-panel").hidden = true;
  panel.replaceChildren();

  const isDnd = game.slug === "dnd";
  if (!isDnd) {
    renderCommunityGameDetail(game, panel);
    return;
  }

  const title = game.title || "Dungeons & Dragons";
  const stories = [
    ["01", "Пепел у ворот", "В пограничном селении гаснут защитные огни. Следы ведут к старому дозорному посту.", "Уровень 1", "Исследование · Первая опасность"],
    ["02", "Шёпот затонувшего храма", "Из высохшего колодца доносится колокольный звон. Под землёй скрыт храм, которого нет ни на одной карте.", "Уровень 2", "Тайны · Древние загадки"],
    ["03", "Бал масок в Серебряном городе", "На королевском балу кто-то продаёт имена живых. У каждого гостя есть маска, но не у каждого — лицо.", "Уровень 3", "Интриги · Социальные сцены"],
    ["04", "Кровь ледяного дракона", "Горный перевал замерзает посреди лета. Дракон просит о помощи, но его кровь уже ищут охотники.", "Уровень 4", "Путешествие · Дилемма"],
    ["05", "Корона из пепла", "Пять следов ведут к трону забытого короля. В последней битве отряд узнает, кто направлял события.", "Уровень 5", "Финал · Судьба королевства"],
  ];

  const shell = createElement("div", "critical-dnd");
  const side = createElement("aside", "critical-dnd__side");
  const brand = createElement("a", "critical-dnd__brand", "КРИТИЧЕСКИЙ УСПЕХ");
  brand.href = "/games/dnd";
  brand.append(createElement("small", "", "REALMS · ADVENTURES · LEGENDS"));
  const profile = createElement("div", "critical-dnd__profile");
  profile.append(
    createElement("span", "critical-dnd__avatar", "✦"),
    createElement("span", "", currentUser ? (currentUser.username || currentUser.name || "Искатель приключений") : "Гость"),
  );
  const navLabel = createElement("span", "critical-dnd__nav-label", "ИГРОВОЙ МИР");
  const nav = createElement("nav", "critical-dnd__nav");
  const navItems = [
    ["overview", "⌂", "Обзор"],
    ["adventures", "▤", "Приключения"],
    ["rooms", "⚔", "Игровые комнаты"],
  ];
  navItems.forEach(([key, icon, label], index) => {
    const button = createElement("button", index === 0 ? "is-active" : "", "");
    button.type = "button";
    button.dataset.dndTab = key;
    button.append(createElement("span", "critical-dnd__nav-icon", icon), createElement("span", "", label));
    nav.append(button);
  });
  const sideNote = createElement("p", "critical-dnd__side-note", "ТВОЯ ИСТОРИЯ. ТВОИ РЕШЕНИЯ. ТВОЯ ЛЕГЕНДА.");
  side.append(brand, profile, navLabel, nav, sideNote);

  const main = createElement("div", "critical-dnd__main");
  const top = createElement("div", "critical-dnd__top");
  const crumb = createElement("div", "critical-dnd__crumb");
  crumb.append(createElement("a", "", "Игры"), createElement("span", "", "／"), createElement("strong", "", title));
  crumb.querySelector("a").href = "/games";
  const topStatus = createElement("span", "critical-dnd__status", "✦ ИГРОВОЙ МИР");
  top.append(crumb, topStatus);

  const content = createElement("div", "critical-dnd__content");
  const overviewPage = createElement("section", "critical-dnd__page is-active");
  overviewPage.dataset.dndPage = "overview";
  const hero = createElement("section", "critical-dnd__hero");
  hero.append(
    createElement("span", "critical-dnd__eyebrow", "ТВОЯ СЛЕДУЮЩАЯ ЛЕГЕНДА НАЧИНАЕТСЯ ЗДЕСЬ"),
    createElement("h1", "", "МИР ЖДЁТ. БРОСАЙ КУБИК."),
    createElement("p", "", "Создай героя, собери отряд и отправляйся навстречу историям, в которых каждое решение оставляет след. Выбирай формат игры — остальное станет легендой."),
  );
  const heroActions = createElement("div", "critical-dnd__actions");
  const startLink = createElement("a", "button button--primary critical-dnd__button", "Начать приключение ↗");
  startLink.href = "/games/dnd/play";
  const createLink = createElement("a", "button button--secondary critical-dnd__button", "Создать персонажа");
  createLink.href = "/games/dnd/play";
  heroActions.append(startLink, createLink);
  hero.append(heroActions);

  const modeHeading = createElement("div", "critical-dnd__section-head");
  modeHeading.append(
    createElement("div", "critical-dnd__eyebrow", "ВЫБЕРИ СВОЙ ПУТЬ"),
    createElement("h2", "", "Как будем играть?"),
    createElement("p", "", "Три формата — одна большая история."),
  );
  const modes = createElement("div", "critical-dnd__mode-grid");
  [
    ["🗡", "Один герой", "Проходи приключения самостоятельно и принимай решения от лица своего персонажа.", "Открыть игру"],
    ["⚔", "Отряд искателей", "Собери команду, создай комнату и проходи кампанию вместе с друзьями.", "Собрать отряд"],
    ["♛", "Игра с ведущим", "Создай комнату для партии, управляй историей и веди игроков через испытания.", "Стать ведущим"],
  ].forEach(([icon, heading, description, action]) => {
    const card = createElement("article", "critical-dnd__mode");
    card.append(createElement("span", "critical-dnd__mode-icon", icon), createElement("h3", "", heading), createElement("p", "", description));
    const link = createElement("a", "critical-dnd__text-link", action + " →");
    link.href = "/games/dnd/play";
    card.append(link);
    modes.append(card);
  });

  const stats = createElement("div", "critical-dnd__stats");
  const statItems = [
    [game.rating_count ? Number(game.rating).toFixed(1) : "—", "РЕЙТИНГ ИГРЫ"],
    [String(Number(game.active_viewers || 0)), "СЕЙЧАС СМОТРЯТ"],
    [String(stories.length), "ГЛАВ В КАМПАНИИ"],
  ];
  statItems.forEach(([value, label]) => {
    const item = createElement("div", "critical-dnd__stat");
    const number = createElement("strong", label === "СЕЙЧАС СМОТРЯТ" ? "game-catalog-active-count" : "", value);
    item.append(number, createElement("small", "", label));
    stats.append(item);
  });
  const ratingPanel = createElement("div", "critical-dnd__rating");
  ratingPanel.append(createElement("strong", "", "Оцени игровую зону"));
  const ratingStars = createElement("div", "game-catalog-rating-stars");
  ratingStars.setAttribute("role", "group");
  ratingStars.setAttribute("aria-label", "Оценка игры");
  for (let value = 1; value <= 5; value += 1) {
    const star = createElement("button", "", "★");
    star.type = "button";
    star.dataset.rating = String(value);
    star.setAttribute("aria-label", `${value} из 5`);
    star.classList.toggle("is-selected", value <= Number(game.user_rating || 0));
    star.addEventListener("click", () => rateCatalogGame(game.slug, value));
    ratingStars.append(star);
  }
  ratingPanel.append(ratingStars);
  const ratingMessage = createElement("small", "game-catalog-detail__rating-message",
    currentUser ? "Оценку можно изменить в любое время." : "Войди в Biblio, чтобы оставить оценку.");
  ratingPanel.append(ratingMessage);
  const section = createElement("section", "critical-dnd__campaign-preview");
  const sectionHead = createElement("div", "critical-dnd__section-head");
  sectionHead.append(
    createElement("div", "critical-dnd__eyebrow", "КАМПАНИЯ ИЗ ПЯТИ ГЛАВ"),
    createElement("h2", "", "Хроники Пепельной Короны"),
    createElement("p", "", "Пять связанных приключений — от первой тревоги у ворот до судьбы целого королевства."),
  );
  const storyList = createElement("div", "critical-dnd__story-list");
  stories.slice(0, 3).forEach(([number, heading, description, level, tags]) => {
    const row = createElement("article", "critical-dnd__story");
    row.append(createElement("span", "critical-dnd__story-number", number));
    const copy = createElement("div");
    copy.append(createElement("h3", "", heading), createElement("p", "", description), createElement("small", "", level + " · " + tags));
    row.append(copy);
    storyList.append(row);
  });
  const allStories = createElement("button", "button button--secondary critical-dnd__button", "Все пять глав →");
  allStories.type = "button";
  allStories.dataset.dndTab = "adventures";
  section.append(sectionHead, storyList, allStories);
  overviewPage.append(hero, modeHeading, modes, stats, ratingPanel, section);

  const adventuresPage = createElement("section", "critical-dnd__page");
  adventuresPage.dataset.dndPage = "adventures";
  adventuresPage.append(
    createElement("span", "critical-dnd__eyebrow", "КАМПАНИЯ · УРОВНИ 1–5"),
    createElement("h1", "critical-dnd__page-title", "Хроники Пепельной Короны"),
    createElement("p", "critical-dnd__lead", "Пять связанных историй. Исследование, социальные сцены, опасности, кульминация и последствия — решения отряда меняют ход кампании."),
  );
  const allStoryCards = createElement("div", "critical-dnd__full-stories");
  stories.forEach(([number, heading, description, level, tags]) => {
    const card = createElement("article", "critical-dnd__full-story");
    card.append(createElement("span", "critical-dnd__story-number", number), createElement("div", "critical-dnd__eyebrow", level), createElement("h2", "", heading), createElement("p", "", description), createElement("small", "", tags));
    const link = createElement("a", "button button--secondary critical-dnd__button", "Играть эту главу →");
    link.href = "/games/dnd/play";
    card.append(link);
    allStoryCards.append(card);
  });
  adventuresPage.append(allStoryCards);

  const roomsPage = createElement("section", "critical-dnd__page");
  roomsPage.dataset.dndPage = "rooms";
  roomsPage.append(
    createElement("span", "critical-dnd__eyebrow", "СОБЕРИ СВОЮ ПАРТИЮ"),
    createElement("h1", "critical-dnd__page-title", "Игровые комнаты"),
    createElement("p", "critical-dnd__lead", "Создавай публичные или закрытые комнаты, приглашай друзей по коду и продолжай кампанию вместе. Твоя партия и прогресс сохраняются на сервере."),
  );
  const roomLink = createElement("a", "button button--primary critical-dnd__button", currentUser ? "Открыть комнаты и создать свою ↗" : "Войти и открыть игровые комнаты ↗");
  roomLink.href = "/games/dnd/play";
  roomsPage.append(roomLink);

  content.append(overviewPage, adventuresPage, roomsPage);
  main.append(top, content);
  shell.append(side, main);
  const exitLink = createElement("a", "critical-dnd__exit", "← Вернуться в Biblio");
  exitLink.href = "/games";
  main.querySelector(".critical-dnd__top").append(exitLink);
  panel.append(shell);
  panel.hidden = false;
  panel.focus();
  document.title = "Критический успех — D&D";

  panel.querySelectorAll("[data-dnd-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      const target = button.dataset.dndTab;
      panel.querySelectorAll("[data-dnd-page]").forEach((page) => page.classList.toggle("is-active", page.dataset.dndPage === target));
      panel.querySelectorAll(".critical-dnd__nav [data-dnd-tab]").forEach((item) => item.classList.toggle("is-active", item.dataset.dndTab === target));
      if (target === "rooms") location.href = "/games/dnd/play";
      else window.scrollTo({ top: panel.getBoundingClientRect().top + window.scrollY, behavior: "smooth" });
    });
  });
  startCatalogPresence(game.slug);
}

function renderCommunityGameDetail(game, panel) {
  const title = game.title || "Игра сообщества";
  const hero = createElement("section", "game-page__hero");
  const copy = createElement("div", "game-page__hero-copy");
  copy.append(
    createElement("span", "game-page__eyebrow", "МИРЫ BIBLIO · ИГРОВАЯ ЗОНА"),
    createElement("h2", "", "Твоё следующее приключение начинается здесь."),
    createElement("p", "", game.description || "Открой игровые комнаты, собери компанию и создай собственную историю вместе с сообществом Biblio."),
  );
  const cta = createElement("a", "button button--primary game-page__primary-action", "Открыть игровые комнаты →");
  cta.href = `/games/${encodeURIComponent(game.slug)}/play`;
  panel.append(hero, cta);
  hero.append(copy);
  panel.hidden = false;
  panel.focus();
  document.title = `${title} — Игры | Biblio`;
  startCatalogPresence(game.slug);
}

function wrapDndWorkspace(panel, title, active = "rooms") {
  const existingContent = [...panel.childNodes];
  const shell = createElement("div", "dnd-workspace");
  const rail = createElement("aside", "dnd-workspace__rail");
  const brand = createElement("a", "dnd-workspace__brand");
  brand.href = "/games/dnd";
  brand.setAttribute("aria-label", "Критический успех — главная D&D");
  brand.append(createElement("span", "dnd-workspace__brand-mark", "✧"));
  const brandCopy = createElement("span", "", "КРИТИЧЕСКИЙ УСПЕХ");
  brandCopy.append(createElement("small", "", "DUNGEONS · DRAGONS · STORIES"));
  brand.append(brandCopy);
  const railLabel = createElement("span", "dnd-workspace__rail-label", "ТВОЙ МИР");
  const nav = createElement("nav", "dnd-workspace__nav");
  [
    ["overview", "✦", "Обзор", "/games/dnd"],
    ["rooms", "⚔", "Игровые комнаты", "/games/dnd/play"],
  ].forEach(([key, icon, label, href]) => {
    const link = createElement("a", active === key ? "is-active" : "");
    link.href = href;
    link.append(createElement("span", "dnd-workspace__nav-icon", icon), createElement("span", "", label));
    if (active === key) link.setAttribute("aria-current", "page");
    nav.append(link);
  });
  const railBottom = createElement("div", "dnd-workspace__rail-bottom");
  railBottom.append(createElement("span", "dnd-workspace__rail-seal", "D20"), createElement("span", "", "ТВОЯ ИСТОРИЯ. ТВОИ ПРАВИЛА."));
  rail.append(brand, railLabel, nav, railBottom);

  const main = createElement("div", "dnd-workspace__main");
  const topbar = createElement("header", "dnd-workspace__topbar");
  const crumbs = createElement("div", "dnd-workspace__crumbs");
  const home = createElement("a", "", "D&D");
  home.href = "/games/dnd";
  crumbs.append(home, createElement("span", "", "／"), createElement("strong", "", title));
  const topActions = createElement("div", "dnd-workspace__top-actions");
  const badge = createElement("span", "dnd-workspace__world-badge", "✦ МИР ПРИКЛЮЧЕНИЙ");
  const biblio = createElement("a", "dnd-workspace__top-back", "Biblio ↗");
  biblio.href = "/games";
  topActions.append(badge, biblio);
  topbar.append(crumbs, topActions);

  const body = createElement("div", "dnd-workspace__body");
  existingContent.forEach((node) => body.append(node));
  main.append(topbar, body);
  shell.append(rail, main);
  panel.replaceChildren(shell);
  panel.classList.add("dnd-workspace-panel");
}

function renderGameRoomsPage(game) {
  const panel = document.querySelector("#game-catalog-detail-panel");
  if (!panel) return;
  stopCatalogPresence();
  activeCatalogGameSlug = game.slug;
  const catalogLayout = document.querySelector("#game-catalog-layout");
  catalogLayout.hidden = true;
  document.querySelector("#game-detail-panel").hidden = true;
  panel.replaceChildren();

  const header = createElement("div", "game-detail__header");
  const heading = createElement("div");
  heading.append(
    createElement("span", "eyebrow", "Игровая зона"),
    createElement("h3", "", `${game.title} — игровые комнаты`),
  );
  const backButton = createElement("a", "button button--secondary", "← К игре");
  backButton.href = `/games/${encodeURIComponent(game.slug)}`;
  header.append(heading, backButton);

  const roomsSection = createElement("section", "game-catalog-rooms");
  const roomsHeading = createElement("div", "game-catalog-rooms__heading");
  roomsHeading.append(
    createElement("h4", "", "Публичные комнаты"),
    createElement("span", "", "Закрытые комнаты не отображаются здесь. Чтобы войти, понадобятся код и ник владельца."),
  );
  const roomsList = createElement("div", "game-catalog-rooms__list");
  if (game.rooms.length) {
    game.rooms.forEach((room) => roomsList.append(createCatalogRoomCard(room)));
  } else {
    roomsList.append(createElement("p", "empty-state", "Пока нет комнат. Создай первую для этой игры."));
  }
  roomsSection.append(roomsHeading, roomsList);
  if (currentUser) {
    roomsSection.append(createPrivateGameJoinForm());
    if (game.private_rooms?.length) {
      const privateHeading = createElement("div", "game-catalog-rooms__heading");
      privateHeading.append(
        createElement("h4", "", "Мои закрытые комнаты"),
        createElement("span", "", "Этот список виден только тебе как владельцу."),
      );
      const privateList = createElement("div", "game-catalog-rooms__list");
      game.private_rooms.forEach((room) => privateList.append(createCatalogRoomCard(room)));
      roomsSection.append(privateHeading, privateList);
    }
    roomsSection.append(createGameRoomForm());
  } else {
    const loginButton = createElement("button", "button button--primary", "Войти, чтобы создать комнату или вступить по коду");
    loginButton.type = "button";
    loginButton.addEventListener("click", () => openDialog("auth-dialog"));
    roomsSection.append(loginButton);
  }
  panel.append(header, roomsSection);
  wrapDndWorkspace(panel, "Игровые комнаты", "rooms");
  panel.hidden = false;
  panel.focus();
  document.title = `Игровые комнаты — ${game.title}`;
  startCatalogPresence(game.slug);
}

function createGameRoomForm() {
  const form = createElement("form", "games-form game-room-create");
  form.id = "game-room-create-form";
  form.addEventListener("submit", createGameRoom);

  const heading = createElement("div", "game-room-create__heading");
  heading.append(
    createElement("span", "game-room-create__eyebrow", "НОВАЯ ИГРА"),
    createElement("h4", "", "Создай свою комнату"),
    createElement("p", "", "Собери друзей, выбери формат доступа и начни собственное приключение."),
  );

  const details = createElement("div", "game-room-create__details");
  const nameLabel = createElement("label", "game-room-create__field", "Название комнаты");
  const nameInput = createElement("input");
  nameInput.name = "name";
  nameInput.maxLength = 80;
  nameInput.required = true;
  nameInput.placeholder = "Например, Кампания «Северный путь»";
  nameInput.autocomplete = "off";
  nameLabel.append(nameInput);

  const descriptionLabel = createElement("label", "game-room-create__field game-room-create__field--wide", "О чём будет приключение?");
  const descriptionInput = createElement("textarea");
  descriptionInput.name = "description";
  descriptionInput.maxLength = 500;
  descriptionInput.rows = 4;
  descriptionInput.placeholder = "Кратко опиши мир, сюжет или правила своей кампании…";
  descriptionLabel.append(descriptionInput);

  const accessLabel = createElement("label", "game-room-create__field", "Кто сможет присоединиться?");
  const accessSelect = createElement("select");
  accessSelect.name = "access";
  [
    ["public", "Публичная — открыта всем"],
    ["private", "По коду — для тех, у кого есть код"],
    ["invite_only", "По приглашениям — только выбранные игроки"],
  ].forEach(([value, label]) => {
    const option = createElement("option", "", label);
    option.value = value;
    accessSelect.append(option);
  });
  accessLabel.append(accessSelect);

  const codeLabel = createElement("label", "game-room-create__field", "Код доступа (необязательно)");
  const codeInput = createElement("input");
  codeInput.name = "join_code";
  codeInput.maxLength = 32;
  codeInput.placeholder = "Придумай свой или оставь пустым";
  codeInput.autocomplete = "off";
  codeLabel.append(codeInput);

  details.append(nameLabel, descriptionLabel, accessLabel, codeLabel);

  const footer = createElement("div", "game-room-create__footer");
  const note = createElement("p", "game-room-create__note", "Настройки доступа можно будет сообщить игрокам после создания комнаты.");
  const submit = createElement("button", "button button--primary game-room-create__submit", "✦  Создать комнату");
  submit.type = "submit";
  footer.append(note, submit);

  form.append(heading, details, footer);
  return form;
}

function createPrivateGameJoinForm() {
  const form = createElement("form", "games-form");
  form.id = "game-private-join-form";
  form.addEventListener("submit", joinPrivateGame);
  form.append(
    createElement("h4", "", "Войти в закрытую комнату"),
  );
  const codeLabel = createElement("label", "", "Код комнаты");
  const codeInput = createElement("input");
  codeInput.name = "code";
  codeInput.maxLength = 32;
  codeInput.autocomplete = "off";
  codeInput.required = true;
  codeInput.placeholder = "Например, A1B2C3D4";
  codeLabel.append(codeInput);
  const ownerLabel = createElement("label", "", "Ник владельца");
  const ownerInput = createElement("input");
  ownerInput.name = "owner_name";
  ownerInput.maxLength = 60;
  ownerInput.autocomplete = "off";
  ownerInput.required = true;
  ownerInput.placeholder = "Имя, указанное в профиле владельца";
  ownerLabel.append(ownerInput);
  const submit = createElement("button", "button button--primary", "Найти и войти");
  submit.type = "submit";
  form.append(codeLabel, ownerLabel, submit);
  return form;
}

function createCatalogRoomCard(room) {
  const card = createElement("article", "game-catalog-room");
  const openButton = createElement("button", "game-catalog-room__open");
  openButton.type = "button";
  const roomName = createElement("strong", "", room.title || room.name || "Новая комната");
  openButton.append(
    roomName,
    createElement(
      "span",
      "",
      `${room.access === "public" ? "Публичная" : room.access === "private" ? "По коду" : "По приглашениям"} · ${room.member_count || 0} участников · ${room.hero_count || 0} героев`,
    ),
  );
  openButton.addEventListener("click", () => openGameRoom(room.id));
  card.append(openButton);
  if (room.is_owner) {
    const deleteButton = createElement("button", "game-catalog-room__delete", "Удалить");
    deleteButton.type = "button";
    deleteButton.addEventListener("click", async () => {
      const confirmed = await askForConfirmation(
        `Комната «${room.title || room.name}» и её данные будут удалены без возможности восстановления.`,
        "Удалить комнату?",
        "Удалить",
      );
      if (!confirmed) return;
      try {
        await api(`/api/games/${room.id}`, { method: "DELETE" });
        await openCatalogGame(activeCatalogGameSlug);
        showToast("Комната удалена");
      } catch (error) {
        showToast(error.message);
      }
    });
    card.append(deleteButton);
  }
  return card;
}

function getCatalogPresenceToken() {
  if (catalogPresenceToken) return catalogPresenceToken;
  const storageKey = "biblio-game-catalog-viewer-token";
  const storedToken = localStorage.getItem(storageKey);
  if (
    typeof storedToken === "string" &&
    /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(storedToken)
  ) {
    catalogPresenceToken = storedToken;
    return catalogPresenceToken;
  }
  const bytes = new Uint8Array(16);
  window.crypto.getRandomValues(bytes);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
  catalogPresenceToken = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
  localStorage.setItem(storageKey, catalogPresenceToken);
  return catalogPresenceToken;
}

async function updateCatalogPresence(slug) {
  if (catalogPresenceRequestPending || document.hidden || activeCatalogGameSlug !== slug) return;
  catalogPresenceRequestPending = true;
  try {
    const result = await api(`/api/catalog/games/${encodeURIComponent(slug)}/presence`, {
      method: "POST",
      body: JSON.stringify({ viewer_token: getCatalogPresenceToken() }),
    });
    const game = gameCatalogGames.find((item) => item.slug === slug);
    if (game && activeCatalogGameSlug === slug) {
      game.active_viewers = result.active_viewers;
      const activeCount = document.querySelector(".game-catalog-active-count");
      if (activeCount) activeCount.textContent = String(result.active_viewers);
      const card = [...document.querySelectorAll(".game-catalog-card")]
        .find((item) => item.dataset.slug === slug)
        ?.querySelector(".game-catalog-card__online-count");
      if (card) card.textContent = String(result.active_viewers);
    }
  } catch (error) {
    window.clearInterval(catalogPresenceTimer);
    catalogPresenceTimer = 0;
    showToast(error.message);
  } finally {
    catalogPresenceRequestPending = false;
  }
}

function startCatalogPresence(slug) {
  stopCatalogPresence();
  activeCatalogGameSlug = slug;
  updateCatalogPresence(slug);
  catalogPresenceTimer = window.setInterval(
    () => updateCatalogPresence(slug),
    Math.floor(GAME_CATALOG_PRESENCE_INTERVAL_MS),
  );
}

function stopCatalogPresence() {
  window.clearInterval(catalogPresenceTimer);
  catalogPresenceTimer = 0;
}

async function rateCatalogGame(slug, rating) {
  if (!currentUser) {
    openDialog("auth-dialog");
    return;
  }
  try {
    const result = await api(`/api/catalog/games/${encodeURIComponent(slug)}/rating`, {
      method: "POST",
      body: JSON.stringify({ rating }),
    });
    const game = gameCatalogGames.find((item) => item.slug === slug);
    if (game) Object.assign(game, result);
    renderGameCatalogCards();
    const currentGame = gameCatalogGames.find((item) => item.slug === slug);
    if (currentGame && activeCatalogGameSlug === slug) {
      const ratingValue = document.querySelector(".critical-dnd__stat strong");
      if (ratingValue) ratingValue.textContent = Number(result.rating).toFixed(1);
      const ratingCaption = [...document.querySelectorAll(".critical-dnd__stat small")]
        .find((item) => item.textContent.startsWith("РЕЙТИНГ"));
      if (ratingCaption) ratingCaption.textContent = `РЕЙТИНГ · ${result.rating_count} ОЦЕНОК`;
      document.querySelectorAll(".game-catalog-rating-stars [data-rating]").forEach((button) => {
        button.classList.toggle("is-selected", Number(button.dataset.rating) <= rating);
      });
      const ratingMessage = document.querySelector(".game-catalog-detail__rating-message");
      if (ratingMessage) ratingMessage.textContent = "Твоя оценка сохранена.";
    }
  } catch (error) {
    showToast(error.message);
  }
}

const GAME_CATALOG_PRESENCE_INTERVAL_MS = 15_000;
window.setInterval(() => {
  const catalogLayout = document.querySelector("#game-catalog-layout");
  if (
    document.body.dataset.page === "games" &&
    !document.hidden &&
    catalogLayout &&
    !catalogLayout.hidden
  ) {
    refreshGameCatalog();
  }
}, GAME_CATALOG_PRESENCE_INTERVAL_MS);

window.setInterval(async () => {
  const panel = document.querySelector("#game-detail-panel");
  if (!activeGameRoomId || document.hidden || !panel || panel.hidden || gameRoomSyncPending) return;
  const focused = panel.querySelector(":focus");
  if (focused && focused.matches("input, textarea, select, [contenteditable='true']")) return;
  gameRoomSyncPending = true;
  try {
    const result = await api("/api/games/" + encodeURIComponent(activeGameRoomId));
    if (String(result.game?.id) !== activeGameRoomId) return;
    const snapshot = JSON.stringify(result.game);
    if (snapshot !== activeGameRoomSnapshot) {
      const scrollPosition = window.scrollY;
      renderGameDetail(result.game);
      window.scrollTo(0, scrollPosition);
    }
  } catch {
    // A temporary network interruption must not interrupt the game.
  } finally {
    gameRoomSyncPending = false;
  }
}, 3000);

window.addEventListener("pagehide", () => {
  activeGameRoomId = "";
  activeGameRoomSnapshot = "";
});

async function openGameRoom(gameId) {
  try {
    const result = await api(`/api/games/${gameId}`);
    renderGameDetail(result.game);
  } catch (error) {
    showToast(error.message);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function renderGameDetail(game) {
  const panel = document.querySelector("#game-detail-panel");
  if (!panel) return;
  activeGameRoomId = String(game.id);
  activeGameRoomSnapshot = JSON.stringify(game);
  panel._dndSectionObserver?.disconnect();
  panel._dndSectionObserver = null;
  document.querySelector("#game-catalog-layout").hidden = true;
  document.querySelector("#game-catalog-detail-panel").hidden = true;
  panel.hidden = false;
  const title = game.title || game.name || "Новая комната";
  const members = Array.isArray(game.participants) ? game.participants : [];
  const heroes = Array.isArray(game.heroes) ? game.heroes : [];
  const sessions = Array.isArray(game.sessions) ? game.sessions : [];
  const isGameMaster = !!currentUser && Number(game.owner_id) === Number(currentUser.id);
  const currentHero = currentUser && Array.isArray(heroes)
    ? heroes.find((hero) => Number(hero.user_id) === Number(currentUser.id)) || null
    : null;
  const canJoin = !!currentUser && !game.is_member && Number(game.owner_id) !== Number(currentUser.id);
  const canLeave = !!currentUser && game.is_member && Number(game.owner_id) !== Number(currentUser.id);
  const heroName = currentHero?.name || "";
  const heroClass = currentHero?.class_name || "";
  const heroRace = currentHero?.race || "";
  const rankedHeroes = [...heroes].sort((first, second) => (second.xp || 0) - (first.xp || 0) || (second.level || 0) - (first.level || 0));
  const ownerOptions = members.length
    ? members
        .filter((member) => Number(member.user_id) !== Number(game.owner_id))
        .map((member) => {
          const hero = heroes.find((item) => Number(item.user_id) === Number(member.user_id));
          const label = hero ? `${hero.name} (${hero.level} ур.)` : `Игрок #${member.user_id}`;
          return `<option value="${member.user_id}">${escapeHtml(label)}</option>`;
        })
        .join("")
    : "<option value=\"\">Нет участников</option>";
  const statInputs = (hero = {}) => GAME_STAT_FIELDS.map((field) => `
    <label>${field.label}
      <input type="number" name="${field.key}" min="${field.min}" max="${field.max}" value="${Number(hero[field.key] ?? field.value)}" required />
    </label>
  `).join("");
  const races = ["Человек","Эльф","Высший эльф","Лесной эльф","Дроу","Полуэльф","Дварф","Холмовой дварф","Горный дварф","Дуэргар","Халфлинг","Легконогий халфлинг","Коренастый халфлинг","Гном","Лесной гном","Скальный гном","Глубинный гном","Полуорк","Орк","Тифлинг","Аасимар","Драконорождённый","Гитъянки","Гитцерай","Табакси","Кенку","Ааракокра","Генази воздуха","Генази воды","Генази земли","Генази огня","Голиаф","Фирболг","Сатир","Кентавр","Минотавр","Леонин","Тритон","Локсодон","Ведалкен","Симик-гибрид","Калаштар","Перевёртыш","Шифтер","Варфорджед","Черепаха-тортл","Грунг","Харенгон","Аулин","Фея","Плазмоид","Автогном","Возрождённый","Дампир","Хексблад","Астральный эльф","Арлинг","Хобгоблин","Багбир","Кобольд","Гоблин","Юань-ти","Ящеролюд","Тэнгу","Огненный генази","Морской эльф","Эладрин","Морской полуэльф","Крылатый тифлинг","Сумеречный эльф"];
  const heroStats = (hero) => GAME_STAT_FIELDS.map((field) =>
    `<span>${field.label}: ${Number(hero[field.key] ?? field.value)}</span>`
  ).join("");

  const gmRosterMarkup = members
    .filter((member) => Number(member.user_id) !== Number(game.owner_id))
    .map((member) => {
      const hero = heroes.find((item) => Number(item.user_id) === Number(member.user_id));
      const status = member.status === "active" ? "В комнате" : (member.status || "Участник");
      return `<li class="dnd-gm-roster__item">
        <span class="dnd-gm-roster__avatar">${escapeHtml((hero?.name || "И").slice(0, 1).toUpperCase())}</span>
        <span class="dnd-gm-roster__identity"><strong>${escapeHtml(hero?.name || ("Игрок #" + member.user_id))}</strong><small>${escapeHtml(hero ? [hero.class_name, hero.race].filter(Boolean).join(" · ") || "Класс не указан" : "Персонаж ещё не создан")} · ${escapeHtml(status)}</small></span>
        ${hero ? `<span class="dnd-gm-roster__vitals">${Number(hero.hp || 0)}/${Number(hero.max_hp || 10)} HP · ур. ${Number(hero.level || 1)}</span>` : "<span class=\"dnd-gm-roster__vitals\">Ожидает героя</span>"}
      </li>`;
    }).join("");
  const gmRewardOptions = heroes.map((hero) => `<option value="${Number(hero.user_id)}">${escapeHtml(hero.name || ("Герой #" + hero.user_id))} · ${Number(hero.level || 1)} ур.</option>`).join("");
  const gmCombatants = game.combat?.active ? (game.combat.combatants || []) : [];
  const gmCurrentFighter = gmCombatants[Number(game.combat?.current_index || 0)];
  const gmNotesKey = "biblio-dnd-gm-notes-" + game.id;
  const gmSceneKey = "biblio-dnd-gm-scene-" + game.id;
  let gmPrivateNotes = "";
  let gmSceneTitle = "";
  try {
    gmPrivateNotes = localStorage.getItem(gmNotesKey) || "";
    gmSceneTitle = localStorage.getItem(gmSceneKey) || "";
  } catch {}
  const gmDashboardMarkup = isGameMaster ? `
    <section class="game-detail__section dnd-gm-dashboard" aria-label="Панель ведущего">
      <div class="dnd-gm-dashboard__heading">
        <div><span class="eyebrow">DUNGEON MASTER</span><strong>Панель ведущего</strong><p>Управляй партией, сценой и ходом приключения из одного места</p></div>
        <span class="dnd-gm-dashboard__role">♛ Ведущий</span>
      </div>
      <div class="dnd-gm-dashboard__stats">
        <div><span>Игроки</span><strong>${Math.max(0, members.length - 1)}</strong><small>в комнате</small></div>
        <div><span>Персонажи</span><strong>${heroes.length}</strong><small>создано героя</small></div>
        <div><span>Сессии</span><strong>${sessions.length}</strong><small>проведено</small></div>
        <div><span>Сражение</span><strong>${game.combat?.active ? "Идёт" : "Не начато"}</strong><small>${game.combat?.active ? "Раунд " + Number(game.combat.round || 1) : "Можно подготовить"}</small></div>
      </div>
      <div class="dnd-gm-dashboard__columns">
        <section class="dnd-gm-box">
          <div class="dnd-gm-box__heading"><strong>Твоя партия</strong><a href="#dnd-area-party">Все персонажи →</a></div>
          ${gmRosterMarkup ? `<ul class="dnd-gm-roster">${gmRosterMarkup}</ul>` : "<p class=\"dnd-gm-empty\">Пока нет игроков. Отправь друзьям ссылку или код комнаты.</p>"}
        </section>
        <section class="dnd-gm-box dnd-gm-encounter">
          <div class="dnd-gm-box__heading"><strong>Контроль игры</strong><a href="#dnd-area-combat">Боевая сцена →</a></div>
          ${game.combat?.active ? `
            <div class="dnd-gm-encounter__current"><span>Сейчас ходит</span><strong>${escapeHtml(gmCurrentFighter?.name || "—")}</strong><small>Раунд ${Number(game.combat.round || 1)} · ${gmCombatants.length} участников боя</small></div>
            <div class="dnd-gm-quick-actions"><button class="button button--primary" type="button" data-combat-action="next">Следующий ход</button><button class="button button--secondary" type="button" data-combat-action="end">Завершить бой</button></div>
          ` : `
            <p class="dnd-gm-empty">Боевая сцена ещё не запущена. Добавь противников и определи инициативу.</p>
            <a class="button button--primary" href="#dnd-area-combat">Подготовить бой</a>
          `}
          <div class="dnd-gm-shortcuts"><a href="#dnd-area-session">Записать сессию и XP</a><a href="#dnd-area-access">Настроить доступ к комнате</a></div>
        </section>
      </div>
      <section class="dnd-gm-box dnd-gm-notes">
        <div class="dnd-gm-box__heading"><strong>Заметки ведущего</strong><span>Личные · только в этом браузере</span></div>
        <label>Текущая сцена<input type="text" maxlength="120" data-gm-scene value="${escapeHtml(gmSceneTitle)}" placeholder="Например: Заброшенная башня у Чёрного леса"></label>
        <label>Сюжет, NPC, секреты и подсказки<textarea rows="4" maxlength="8000" data-gm-notes placeholder="Записывай здесь то, что не должны видеть игроки…">${escapeHtml(gmPrivateNotes)}</textarea></label>
        <small data-gm-save-status>Заметки сохраняются автоматически на этом устройстве и не видны игрокам.</small>
      </section>
      <section class="dnd-gm-box dnd-gm-reward">
        <div class="dnd-gm-box__heading"><strong>Быстрая награда</strong><a href="#dnd-area-session">Журнал сессий →</a></div>
        <form class="games-form dnd-gm-reward__form" id="game-gm-xp-form">
          <label>Кому<select name="user_id">${gmRewardOptions}</select></label>
          <label>Количество XP<input type="number" name="amount" min="1" max="5000" value="25" required></label>
          <label>За что<input type="text" name="reason" maxlength="200" value="Награда за приключение" required></label>
          <button class="button button--primary" type="submit" ${heroes.length ? "" : "disabled"}>Выдать опыт</button>
        </form>
        ${heroes.length ? "" : "<small>Сначала игрокам нужно создать персонажей.</small>"}
      </section>
    </section>
  ` : "";
  
  panel.innerHTML = `
    <div class="game-detail__header">
      <div><span class="eyebrow">${isGameMaster ? "Ведущий" : "Игрок"} · Игровая комната</span><h3>${escapeHtml(title)}</h3></div>
      <div class="game-detail__header-actions">
        ${canJoin && !currentHero ? `<button class="button button--primary" type="button" data-game-action="create-hero">✦ Создать персонажа</button>` : ""}
        ${canJoin && game.access === "public" ? `<button class="button button--primary" type="button" data-game-action="join" ${currentHero ? "" : "disabled title=\"Сначала создай героя\""}>${currentHero ? "Вступить" : "Сначала создай героя"}</button>` : ""}
        ${canLeave ? `<button class="button button--secondary" type="button" data-game-action="leave">Покинуть</button>` : ""}
        <button class="button button--secondary" type="button" data-game-action="back">${/\/play\/?$/.test(location.pathname) ? "← К комнатам" : "← К игре"}</button>
      </div>
    </div>
    ${gmDashboardMarkup}
    <p>${escapeHtml(game.description || "Без описания.")}</p>
    <ul class="game-detail-list">
      <li>Доступ: ${game.access === "public" ? "Публичная" : game.access === "private" ? "По коду" : "По приглашениям"}</li>
      <li>Участников: ${game.member_count || members.length || 0}</li>
      <li>Героев: ${game.hero_count || heroes.length || 0}</li>
      <li>Сессий: ${sessions.length}</li>
    </ul>
    <div class="game-detail__section">
      <strong>Лидерборд</strong>
      ${rankedHeroes.length ? `<ol class="game-leaderboard">${rankedHeroes.slice(0, 5).map((hero, index) => `<li><span>#${index + 1}</span><strong>${escapeHtml(hero.name || "Герой")}</strong><em>${hero.level || 1} ур. · ${hero.xp || 0} XP</em></li>`).join("")}</ol>` : "<p>Пока нет лидеров. Стань первым, кто создаст героя.</p>"}
    </div>
    <div class="game-detail__section">
      <strong>Герои</strong>
      ${heroes.length ? `<div class="game-heroes">${heroes.map((hero) => `
        <article class="game-hero-card">
          <div class="game-hero-card__heading">
            <strong>${escapeHtml(hero.name)} · ${hero.level} ур. · ${hero.xp} XP</strong>
            <span>${escapeHtml([hero.class_name, hero.race].filter(Boolean).join(" · ") || "Класс и раса не указаны")}</span>
          </div>
          <div class="game-hero-card__vitals">
            <div class="game-hero-card__vitals-heading"><span>Здоровье</span><strong>${Number(hero.hp || 0)} / ${Number(hero.max_hp || 10)} HP</strong></div>
            <div class="game-hero-card__hp-track" role="progressbar" aria-label="Здоровье персонажа" aria-valuemin="0" aria-valuemax="${Number(hero.max_hp || 10)}" aria-valuenow="${Number(hero.hp || 0)}"><span style="width:${Math.max(0, Math.min(100, Number(hero.hp || 0) / Math.max(1, Number(hero.max_hp || 10)) * 100))}%"></span></div>
            <div class="game-hero-card__stats">${heroStats(hero)}</div>
          </div>
          ${(isGameMaster || Number(hero.user_id) === Number(currentUser?.id)) ? `
            <form class="games-form game-hero-card__loadout" data-hero-user-id="${Number(hero.user_id)}">
              <label>Инвентарь <small>Один предмет на строку</small><textarea name="inventory" rows="3" maxlength="4000" placeholder="Зелье лечения&#10;Верёвка 15 м&#10;Факел">${escapeHtml((hero.inventory || []).join("\n"))}</textarea></label>
              <label>Заклинания <small>Одно заклинание на строку</small><textarea name="spells" rows="3" maxlength="4000" placeholder="Волшебная стрела&#10;Щит&#10;Лечение ран">${escapeHtml((hero.spells || []).join("\n"))}</textarea></label>
              <button class="button button--secondary" type="submit">Сохранить инвентарь и заклинания</button>
            </form>
          ` : `<div class="game-hero-card__loadout-preview">
            <strong>Инвентарь</strong><p>${(hero.inventory || []).length ? (hero.inventory || []).map(escapeHtml).join(" · ") : "Пока пусто"}</p>
            <strong>Заклинания</strong><p>${(hero.spells || []).length ? (hero.spells || []).map(escapeHtml).join(" · ") : "Нет записанных заклинаний"}</p>
          </div>`}
          <section class="game-spellbook">
            <div class="game-spellbook__heading"><strong>Магия и ячейки</strong><span>Уровни заклинаний: 1–9</span></div>
            <div class="game-spellbook__slots">
              ${Array.from({ length: 9 }, (_, index) => `<div class="game-spellbook__slot"><span>${index + 1} ур.</span><strong>${Number((hero.spell_slots || [])[index] || 0)} / ${Number((hero.spell_slots_max || [])[index] || 0)}</strong></div>`).join("")}
            </div>
            ${(isGameMaster || Number(hero.user_id) === Number(currentUser?.id)) && (hero.spells || []).length ? `
              <form class="games-form game-spellbook__cast" data-hero-user-id="${Number(hero.user_id)}">
                <label>Заклинание<select name="spell">${(hero.spells || []).map((spell) => `<option value="${escapeHtml(spell)}">${escapeHtml(spell)}</option>`).join("")}</select></label>
                <label>Уровень ячейки<select name="level"><option value="0">Заговор — без ячейки</option>${Array.from({length:9},(_,i)=>`<option value="${i+1}">${i+1}-й уровень</option>`).join("")}</select></label>
                <button class="button button--primary" type="submit">Использовать заклинание</button>
              </form>` : ""}
            ${isGameMaster ? `
              <form class="games-form game-spellbook__configure" data-hero-user-id="${Number(hero.user_id)}">
                <strong>Максимум и остаток ячеек</strong>
                <div class="game-spellbook__config-grid">
                  ${Array.from({length:9},(_,i)=>`<label>${i+1} ур.<input type="number" min="0" max="20" name="max_${i+1}" value="${Number((hero.spell_slots_max || [])[i] || 0)}"><input type="number" min="0" max="20" name="left_${i+1}" value="${Number((hero.spell_slots || [])[i] || 0)}" aria-label="Остаток ячеек ${i+1}-го уровня"></label>`).join("")}
                </div>
                <button class="button button--secondary" type="submit">Сохранить ячейки</button>
              </form>
              <button class="button button--secondary game-spellbook__rest" type="button" data-spell-rest-user-id="${Number(hero.user_id)}">Продолжительный отдых · восстановить ячейки</button>
            ` : ""}
          </section>
          ${isGameMaster ? `
            <form class="games-form game-hero-card__hp-form" data-hero-user-id="${Number(hero.user_id)}">
              <label>Текущее HP<input type="number" name="hp" min="0" max="${Number(hero.max_hp || 10)}" value="${Number(hero.hp || 0)}" required /></label>
              <button class="button button--secondary" type="submit">Обновить здоровье</button>
            </form>
            <form class="games-form game-hero-card__form" data-hero-user-id="${Number(hero.user_id)}">
              <strong>Изменить параметры</strong>
              <div class="game-stat-grid">${statInputs(hero)}</div>
              <button class="button button--secondary" type="submit">Сохранить параметры</button>
            </form>
          ` : ""}
        </article>
      `).join("")}</div>` : isGameMaster ? "<p>Пока никто не создал персонажа. Игроки могут вступить в комнату и создать героя.</p>" : "<p>Пока нет героев. Создай персонажа, чтобы начать игру.</p>"}
      ${isGameMaster ? "<p class=\"game-host-note\">Ты ведущий: управляй ходом игры и параметрами героев. Ведущий не создаёт персонажа.</p>" : ""}
    </div>
    <div class="game-detail__section">
      <strong>Бросок кубика</strong>
      <div class="game-dice" aria-label="Бросок игрового кубика">
        <div class="game-dice__controls" role="group" aria-label="Выбери кубик">
          ${[4, 6, 8, 10, 12, 20, 100].map((sides) => `
            <button type="button" class="game-dice__type${sides === 20 ? " is-selected" : ""}" data-die-sides="${sides}" aria-pressed="${sides === 20}">d${sides}</button>
          `).join("")}
        </div>
        <div class="game-dice__roll">
          <div class="game-dice__advanced-controls">
            <label>Модификатор
              <input type="number" min="-30" max="30" value="0" data-dice-modifier aria-label="Модификатор броска" />
            </label>
            <div class="game-dice__modes" role="group" aria-label="Режим броска">
              <button type="button" class="is-selected" data-dice-mode="normal" aria-pressed="true">Обычный</button>
              <button type="button" data-dice-mode="advantage" aria-pressed="false">Преимущество</button>
              <button type="button" data-dice-mode="disadvantage" aria-pressed="false">Помеха</button>
            </div>
          </div>
          <div class="game-dice__face" aria-live="polite" aria-atomic="true">—</div>
          <div class="game-dice__result" role="status">Выбери кубик и брось его</div>
          <button type="button" class="button button--primary" data-dice-roll>Бросить d20</button>
          <div class="game-dice__history-wrap"><strong>Последние броски</strong><div class="game-dice__history" data-dice-history></div></div>
        </div>
      </div>
    </div>
    <div class="game-detail__section game-combat">
      <div class="game-combat__heading"><div><strong>Боевая сцена</strong><p>Инициатива и очерёдность ходов в текущем бою</p></div>
        ${game.combat?.active ? `<span class="game-combat__round">Раунд ${Number(game.combat.round || 1)}</span>` : ""}
      </div>
      ${game.combat?.active ? `
        <ol class="game-combat__order">
          ${(game.combat.combatants || []).map((fighter, index) => `
            <li class="${index === Number(game.combat.current_index || 0) ? "is-current" : ""} ${fighter.hp === 0 ? "is-defeated" : ""}">
              <span class="game-combat__initiative">${Number(fighter.initiative)}</span>
              <span class="game-combat__fighter"><strong>${escapeHtml(fighter.name)}</strong><small>${fighter.kind === "hero" ? "Герой" : "Противник"}${fighter.hp !== null && fighter.hp !== undefined ? ` · ${Number(fighter.hp)}/${Number(fighter.max_hp)} HP` : ""}</small></span>
              ${index === Number(game.combat.current_index || 0) ? "<em>Ход сейчас</em>" : ""}
              ${isGameMaster && fighter.hp !== null && fighter.hp !== undefined ? "<span class=\"game-combat__hp-controls\"><input type=\"number\" min=\"1\" max=\"1000\" value=\"1\" aria-label=\"Количество HP\" data-combat-amount=\"" + escapeHtml(fighter.id) + "\"><button type=\"button\" class=\"button button--secondary\" data-combat-adjust=\"damage\" data-combat-target=\"" + escapeHtml(fighter.id) + "\">− Урон</button><button type=\"button\" class=\"button button--secondary\" data-combat-adjust=\"heal\" data-combat-target=\"" + escapeHtml(fighter.id) + "\">+ Лечение</button></span>" : ""}
            </li>
          `).join("")}
        </ol>
        ${(game.combat.events || []).length ? `<div class="game-combat__log"><strong>Журнал боя</strong><ol>${game.combat.events.slice().reverse().map((entry) => `<li><span>${escapeHtml(entry.message)}</span><time>${new Date(entry.created_at).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })}</time></li>`).join("")}</ol></div>` : ""}
        ${isGameMaster ? `<div class="game-combat__actions"><button class="button button--primary" type="button" data-combat-action="next">Следующий ход →</button><button class="button button--secondary" type="button" data-combat-action="end">Завершить бой</button></div>` : ""}
        ${isGameMaster ? `<form class="games-form game-combat__attack" id="game-combat-attack-form">
          <strong>Атака</strong>
          <div class="game-combat__attack-fields">
            <label>Атакующий<select name="attacker_id">${game.combat.combatants.map((fighter) => `<option value="${escapeHtml(fighter.id)}">${escapeHtml(fighter.name)}</option>`).join("")}</select></label>
            <label>Цель<select name="target_id">${game.combat.combatants.map((fighter) => `<option value="${escapeHtml(fighter.id)}">${escapeHtml(fighter.name)}</option>`).join("")}</select></label>
            <label>Бонус атаки<input type="number" name="attack_bonus" min="-20" max="30" value="0" required></label>
            <label>Урон при попадании<input type="number" name="damage" min="1" max="1000" value="1" required></label>
          </div>
          <button class="button button--primary" type="submit">Бросить атаку d20</button>
        </form>` : ""}
      ` : isGameMaster ? `
        <form class="games-form game-combat__start" id="game-combat-form">
          <label>Противники <small>Каждый с новой строки: «Гоблин | 14 | 7 | 15» (имя | инициатива | HP | КБ). Инициативу можно пропустить; HP и КБ необязательны.</small>
            <textarea name="monsters" rows="3" maxlength="1400" placeholder="Гоблин | 14 | 7 | 15&#10;Орк | | 15/18 | 13&#10;Скелет"></textarea>
          </label>
          <button class="button button--primary" type="submit">Начать бой и бросить инициативу</button>
        </form>
      ` : "<p>Ведущий ещё не начал бой.</p>"}
    </div>
    <div class="game-detail__section">
      <strong>Недавние сессии</strong>
      ${sessions.length ? `<ul>${sessions.map((session) => `<li>${escapeHtml(session.title || "Сессия")} · ${session.xp_awarded || 0} XP${session.notes ? ` · ${escapeHtml(session.notes)}` : ""}</li>`).join("")}</ul>` : "<p>Сессий ещё не было.</p>"}
    </div>
    ${(game.access !== "public" && currentUser && (game.is_member || game.is_owner)) ? `
      <div class="game-detail__section">
        <strong>Код доступа</strong>
        <div class="game-access-code">
          <code>${escapeHtml(game.join_code || "Не назначен")}</code>
          ${game.is_owner ? `<button class="button button--secondary" type="button" data-game-action="regenerate-code">Сгенерировать новый</button>` : ""}
        </div>
        ${game.is_owner ? `<p>Чтобы участники нашли комнату, сообщи им также свой ник: ${escapeHtml(currentUser.display_name)}.</p>` : ""}
      </div>
    ` : ""}
    ${currentUser && (game.is_member || canJoin) && !isGameMaster ? `
      <div class="game-detail__section" id="game-hero-section">
        <strong>${currentHero ? "Мой персонаж" : "Создание персонажа"}</strong>
        ${canJoin && !currentHero ? "<p>Чтобы вступить в приключение, сначала создай персонажа. Ведущий комнаты исключение — ему герой не нужен.</p>" : ""}
        <form id="game-hero-form" class="games-form game-hero-create-form">
          <div class="game-hero-account"><span>НИК АККАУНТА BIBLIO</span><strong>${escapeHtml(currentUser.display_name || currentUser.username || "Игрок")}</strong><small>Подставлен автоматически из твоего профиля</small></div>
          <label>Имя героя<input name="hero_name" maxlength="80" value="${escapeHtml(heroName)}" placeholder="Например, Элиан Серебряный Лист" required /></label>
          <label>Раса <small>Выбери одну из 70 рас</small><select name="race" required>${races.map((race) => `<option value="${escapeHtml(race)}" ${heroRace === race ? "selected" : ""}>${escapeHtml(race)}</option>`).join("")}</select></label>
          <p class="game-hero-random-note">✦ Характеристики и очки навыков будут распределены случайно при создании. Повторно они не перебрасываются.</p>
          <button class="button button--primary" type="submit">${currentHero ? "Сохранить имя и расу" : "✦ Создать персонажа"}</button>
        </form>
      </div>
    ` : ""}
    ${canJoin && game.access !== "public" && !currentHero ? `<div class="game-detail__section"><strong>Вступление пока закрыто</strong><p>Сохрани героя выше — после этого появится форма входа.</p></div>` : ""}
    ${canJoin && game.access !== "public" && currentHero ? `
      <div class="game-detail__section">
        <strong>Вступить в комнату</strong>
        <form id="game-join-form" class="games-form">
          <label>Код доступа<input name="join_code" maxlength="32" placeholder="Введите код" required /></label>
          <label>Ник владельца<input name="owner_name" maxlength="60" placeholder="Имя из профиля владельца" required /></label>
          <button class="button button--primary" type="submit">Подтвердить вход</button>
        </form>
      </div>
    ` : ""}
    ${currentUser && Number(game.owner_id) === Number(currentUser.id) ? `
      <div class="game-detail__section">
        <strong>Провести сессию</strong>
        <form id="game-session-form" class="games-form">
          <label>Игрок
            <select name="user_id">${ownerOptions}</select>
          </label>
          <label>Название сессии<input name="title" maxlength="120" value="Сессия" required /></label>
          <label>XP<input name="xp_awarded" type="number" min="0" max="5000" value="25" /></label>
          <label>Заметки<textarea name="notes" maxlength="500" rows="2" placeholder="Что произошло?"></textarea></label>
          <button class="button button--primary" type="submit">Записать сессию</button>
        </form>
      </div>
    ` : ""}

  `;
  const introText = panel.querySelector(":scope > p");
  const detailList = panel.querySelector(":scope > .game-detail-list");
  if (introText || detailList) {
    const summary = createElement("section", "dnd-play-summary");
    summary.setAttribute("aria-label", "Сводка игровой комнаты");
    if (introText) summary.append(introText);
    if (detailList) summary.append(detailList);
    panel.insertBefore(summary, panel.querySelector(":scope > .game-detail__section"));
  }

  const dndAreaSpecs = [
    { key: "gm", label: "Панель ведущего", icon: "♛", match: /панель ведущего/i },
    { key: "progress", label: "Прогресс", icon: "✦", match: /лидерборд|прогресс|уровень/i },
    { key: "party", label: "Персонажи", icon: "♙", match: /герои|персонаж/i },
    { key: "dice", label: "Кубики", icon: "⚄", match: /кубик|бросок/i },
    { key: "combat", label: "Сражение", icon: "⚔", match: /боевая сцена|сражение|бой/i },
    { key: "journal", label: "Журнал", icon: "▤", match: /сессии|журнал/i },
    { key: "access", label: "Доступ", icon: "⌑", match: /код доступа|вступить в комнату/i },
    { key: "hero", label: "Мой герой", icon: "♟", match: /мой персонаж|создать персонажа/i },
    { key: "session", label: "Сессия", icon: "✎", match: /провести сессию/i },
  ];
  const detailSections = [...panel.querySelectorAll(":scope > .game-detail__section")];
  const usedKeys = new Set();
  const sectionEntries = detailSections.map((section, index) => {
    const heading = section.querySelector(":scope > strong, :scope > .game-combat__heading strong, :scope > .dnd-gm-dashboard__heading strong");
    const headingText = (heading?.textContent || "").trim();
    let spec = dndAreaSpecs.find((item) => item.match.test(headingText));
    if (!spec) spec = { key: "extra-" + index, label: headingText || "Дополнительно", icon: "·" };
    let key = spec.key;
    if (usedKeys.has(key)) key = key + "-" + index;
    usedKeys.add(key);
    const entry = { ...spec, key, section };
    section.id = "dnd-area-" + key;
    section.dataset.dndArea = key;
    section.classList.add("dnd-play-card");
    if (["party", "combat", "journal", "session"].includes(spec.key)) section.classList.add("dnd-play-card--wide");
    return entry;
  });
  const playNav = createElement("nav", "dnd-play-nav");
  playNav.setAttribute("aria-label", "Разделы игрового стола");
  const navLinks = [];
  sectionEntries.forEach(({ key, label, icon, section }, index) => {
    const link = createElement("a", index === 0 ? "is-active" : "");
    link.href = "#dnd-area-" + key;
    link.setAttribute("aria-controls", section.id);
    if (index === 0) link.setAttribute("aria-current", "location");
    link.append(createElement("span", "dnd-play-nav__icon", icon), createElement("span", "", label));
    link.addEventListener("click", () => {
      playNav.querySelectorAll("a").forEach((item) => {
        const active = item === link;
        item.classList.toggle("is-active", active);
        if (active) item.setAttribute("aria-current", "location");
        else item.removeAttribute("aria-current");
      });
    });
    navLinks.push(link);
    playNav.append(link);
  });
  const playGrid = createElement("div", "dnd-play-grid");
  detailSections.forEach((section) => playGrid.append(section));
  panel.append(playNav, playGrid);

  if ("IntersectionObserver" in window && sectionEntries.length) {
    panel._dndSectionObserver = new IntersectionObserver((entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((first, second) => second.intersectionRatio - first.intersectionRatio)[0];
      if (!visible) return;
      const activeKey = visible.target.dataset.dndArea;
      navLinks.forEach((link) => {
        const active = link.getAttribute("href") === "#dnd-area-" + activeKey;
        link.classList.toggle("is-active", active);
        if (active) link.setAttribute("aria-current", "location");
        else link.removeAttribute("aria-current");
      });
    }, { rootMargin: "-18% 0px -62% 0px", threshold: [0, 0.15, 0.35, 0.6] });
    sectionEntries.forEach(({ section }) => panel._dndSectionObserver.observe(section));
  }
  wrapDndWorkspace(panel, title, "rooms");

  if (isGameMaster) {
    const sceneInput = panel.querySelector("[data-gm-scene]");
    const notesInput = panel.querySelector("[data-gm-notes]");
    const saveStatus = panel.querySelector("[data-gm-save-status]");
    const savePrivateNotes = () => {
      try {
        localStorage.setItem(gmSceneKey, sceneInput?.value || "");
        localStorage.setItem(gmNotesKey, notesInput?.value || "");
        if (saveStatus) saveStatus.textContent = "Сохранено на этом устройстве · " + new Date().toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"});
      } catch {
        if (saveStatus) saveStatus.textContent = "Браузер не разрешил сохранить заметки. Скопируй их отдельно.";
      }
    };
    sceneInput?.addEventListener("input", savePrivateNotes);
    notesInput?.addEventListener("input", savePrivateNotes);
    const xpForm = panel.querySelector("#game-gm-xp-form");
    xpForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(xpForm);
      const amount = Number(data.get("amount"));
      if (!Number.isInteger(amount) || amount < 1 || amount > 5000) {
        showToast("Количество XP должно быть от 0 до 5000");
        return;
      }
      try {
        await api("/api/games/" + game.id + "/xp", {
          method: "POST",
          body: JSON.stringify({ user_id: Number(data.get("user_id")), amount, reason: String(data.get("reason") || "Награда").trim() }),
        });
        const refreshedGame = await api("/api/games/" + game.id);
        renderGameDetail(refreshedGame.game);
        showToast("Опыт выдан персонажу");
      } catch (error) {
        showToast(error.message);
      }
    });
  }

    panel.querySelector('[data-game-action="back"]')?.addEventListener("click", () => {
    const gamePath = game.catalog_game_slug
      ? `/games/${encodeURIComponent(game.catalog_game_slug)}`
      : "/games";
    const destination = game.catalog_game_slug && /\/play\/?$/.test(location.pathname)
      ? `${gamePath}/play`
      : gamePath;
    window.location.assign(destination);
  });

  const combatForm = panel.querySelector("#game-combat-form");
  combatForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const monsters = String(new FormData(combatForm).get("monsters") || "").split(/\\r?\\n/).map((line) => line.trim()).filter(Boolean);
    if (monsters.length > 12 || monsters.some((line) => line.length > 100)) {
      showToast("Добавь не более 12 противников, до 100 символов каждый");
      return;
    }
    try {
      await api(`/api/games/${game.id}/combat`, { method: "POST", body: JSON.stringify({ action: "start", monsters }) });
      const refreshedGame = await api(`/api/games/${game.id}`);
      renderGameDetail(refreshedGame.game);
      showToast("Бой начался — инициатива определена");
    } catch (error) {
      showToast(error.message);
    }
  });
  panel.querySelectorAll("[data-combat-action]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/games/${game.id}/combat`, { method: "POST", body: JSON.stringify({ action: button.dataset.combatAction }) });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast(button.dataset.combatAction === "next" ? "Ход передан следующему участнику" : "Бой завершён");
      } catch (error) {
        showToast(error.message);
      }
    });
  });
  panel.querySelectorAll("[data-combat-adjust]").forEach((button) => {
    button.addEventListener("click", async () => {
      const amountInput = panel.querySelector('[data-combat-amount="' + button.dataset.combatTarget + '"]');
      const amount = Number(amountInput?.value || 0);
      if (!Number.isInteger(amount) || amount < 1 || amount > 1000) {
        showToast("Укажи значение от 1 до 1000");
        return;
      }
      try {
        await api("/api/games/" + game.id + "/combat", {
          method: "POST",
          body: JSON.stringify({ action: button.dataset.combatAdjust, target_id: button.dataset.combatTarget, amount }),
        });
        const refreshedGame = await api("/api/games/" + game.id);
        renderGameDetail(refreshedGame.game);
        showToast(button.dataset.combatAdjust === "damage" ? "Урон применён" : "Здоровье восстановлено");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  const combatAttackForm = panel.querySelector("#game-combat-attack-form");
  combatAttackForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const formData = new FormData(combatAttackForm);
    const payload = {
      action: "attack",
      attacker_id: formData.get("attacker_id"),
      target_id: formData.get("target_id"),
      attack_bonus: Number(formData.get("attack_bonus")),
      damage: Number(formData.get("damage")),
    };
    try {
      await api("/api/games/" + game.id + "/combat", { method: "POST", body: JSON.stringify(payload) });
      const refreshedGame = await api("/api/games/" + game.id);
      renderGameDetail(refreshedGame.game);
      showToast("Результат атаки добавлен в журнал боя");
    } catch (error) {
      showToast(error.message);
    }
  });

  const createHeroButton = panel.querySelector('[data-game-action="create-hero"]');
  if (createHeroButton) {
    createHeroButton.addEventListener("click", () => {
      const heroSection = panel.querySelector("#game-hero-section");
      heroSection?.scrollIntoView({ behavior: "smooth", block: "center" });
      heroSection?.querySelector('input[name="hero_name"]')?.focus({ preventScroll: true });
    });
  }

  const joinButton = panel.querySelector('[data-game-action="join"]');
  if (joinButton) {
    joinButton.addEventListener("click", async () => {
      try {
        const payload = game.access === "public" ? {} : { join_code: window.prompt("Введи код доступа к комнате", "") || "" };
        await api(`/api/games/${game.id}/join`, { method: "POST", body: JSON.stringify(payload) });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast("Ты вступил в комнату");
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const joinForm = panel.querySelector("#game-join-form");
  if (joinForm) {
    joinForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      try {
        const formData = new FormData(joinForm);
        await api(`/api/games/${game.id}/join`, {
          method: "POST",
          body: JSON.stringify({
            join_code: formData.get("join_code") || "",
            owner_name: formData.get("owner_name") || "",
          }),
        });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast("Ты вступил в комнату");
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const leaveButton = panel.querySelector('[data-game-action="leave"]');
  if (leaveButton) {
    leaveButton.addEventListener("click", async () => {
      try {
        await api(`/api/games/${game.id}/leave`, { method: "DELETE" });
        const gamePath = game.catalog_game_slug
          ? `/games/${encodeURIComponent(game.catalog_game_slug)}`
          : "/games";
        window.location.assign(game.catalog_game_slug ? `${gamePath}/play` : gamePath);
        showToast("Ты покинул комнату");
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const regenerateCodeButton = panel.querySelector('[data-game-action="regenerate-code"]');
  if (regenerateCodeButton) {
    regenerateCodeButton.addEventListener("click", async () => {
      try {
        const result = await api(`/api/games/${game.id}/join-code`, { method: "POST", body: JSON.stringify({}) });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast(result.game?.join_code ? `Новый код: ${result.game.join_code}` : "Код доступа обновлён");
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  const heroForm = panel.querySelector("#game-hero-form");
  if (heroForm) {
    heroForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(heroForm);
      try {
        const payload = {
          name: formData.get("hero_name") || "",
          race: formData.get("race") || "",
        };
        const result = await api(`/api/games/${game.id}/characters`, { method: "POST", body: JSON.stringify(payload) });
        if (result.character) {
          const refreshedGame = await api(`/api/games/${game.id}`);
          renderGameDetail(refreshedGame.game);
          showToast("Герой сохранён");
        }
      } catch (error) {
        showToast(error.message);
      }
    });
  }

  panel.querySelectorAll(".game-spellbook__configure").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const data = new FormData(form);
      const spell_slots_max = Array.from({length:9},(_,i)=>Number(data.get("max_"+(i+1))));
      const spell_slots = Array.from({length:9},(_,i)=>Number(data.get("left_"+(i+1))));
      if ([...spell_slots_max, ...spell_slots].some((value) => !Number.isInteger(value) || value < 0 || value > 20) || spell_slots.some((value,index)=>value>spell_slots_max[index])) {
        showToast("Проверь ячейки: остаток не может превышать максимум"); return;
      }
      try {
        await api("/api/games/"+game.id+"/characters/"+form.dataset.heroUserId, {method:"PATCH",body:JSON.stringify({spell_slots_max,spell_slots})});
        const refreshedGame = await api("/api/games/"+game.id); renderGameDetail(refreshedGame.game); showToast("Ячейки заклинаний сохранены");
      } catch (error) { showToast(error.message); }
    });
  });

  panel.querySelectorAll(".game-spellbook__cast").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault(); const data = new FormData(form);
      try {
        const result = await api("/api/games/"+game.id+"/characters/"+form.dataset.heroUserId+"/cast", {method:"POST",body:JSON.stringify({spell:data.get("spell"),level:Number(data.get("level"))})});
        const refreshedGame = await api("/api/games/"+game.id); renderGameDetail(refreshedGame.game);
        showToast(result.cast.effect === "healing" ? "Заклинание восстановило " + result.cast.healing + " HP" : (result.cast.level === 0 ? "Заговор использован" : "Заклинание использовано · ячейка списана"));
      } catch (error) { showToast(error.message); }
    });
  });

  panel.querySelectorAll("[data-spell-rest-user-id]").forEach((button) => {
    button.addEventListener("click", async () => {
      if (!window.confirm("Восстановить все ячейки заклинаний этого персонажа?")) return;
      try {
        await api("/api/games/"+game.id+"/characters/"+button.dataset.spellRestUserId+"/rest", {method:"POST",body:JSON.stringify({type:"long"})});
        const refreshedGame = await api("/api/games/"+game.id); renderGameDetail(refreshedGame.game); showToast("Ячейки восстановлены после продолжительного отдыха");
      } catch (error) { showToast(error.message); }
    });
  });

  panel.querySelectorAll(".game-hero-card__loadout").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const toList = (value) => String(value || "").split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
      const inventory = toList(formData.get("inventory"));
      const spells = toList(formData.get("spells"));
      if (inventory.length > 40 || spells.length > 40 || [...inventory, ...spells].some((item) => item.length > 100)) {
        showToast("Максимум 40 записей в каждом списке, до 100 символов каждая");
        return;
      }
      try {
        await api(`/api/games/${game.id}/characters/${form.dataset.heroUserId}`, {
          method: "PATCH",
          body: JSON.stringify({ inventory, spells }),
        });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast("Инвентарь и заклинания сохранены");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  panel.querySelectorAll(".game-hero-card__hp-form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const hp = Number(new FormData(form).get("hp"));
      const hero = heroes.find((item) => Number(item.user_id) === Number(form.dataset.heroUserId));
      if (!hero || !Number.isInteger(hp) || hp < 0 || hp > Number(hero.max_hp || 10)) {
        showToast("Проверь значение здоровья");
        return;
      }
      try {
        await api(`/api/games/${game.id}/characters/${form.dataset.heroUserId}`, {
          method: "PATCH",
          body: JSON.stringify({ hp }),
        });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast("Здоровье персонажа обновлено");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  panel.querySelectorAll(".game-hero-card__form").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(form);
      const payload = Object.fromEntries(GAME_STAT_FIELDS.map((field) => [
        field.key,
        Number(formData.get(field.key)),
      ]));
      try {
        await api(`/api/games/${game.id}/characters/${form.dataset.heroUserId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
        });
        const refreshedGame = await api(`/api/games/${game.id}`);
        renderGameDetail(refreshedGame.game);
        showToast("Параметры персонажа обновлены");
      } catch (error) {
        showToast(error.message);
      }
    });
  });

  const dicePanel = panel.querySelector(".game-dice");
  if (dicePanel) {
    let selectedSides = 20;
    let selectedMode = "normal";
    let rolling = false;
    const face = dicePanel.querySelector(".game-dice__face");
    const result = dicePanel.querySelector(".game-dice__result");
    const rollButton = dicePanel.querySelector("[data-dice-roll]");
    const modifierInput = dicePanel.querySelector("[data-dice-modifier]");
    const historyNode = dicePanel.querySelector("[data-dice-history]");
    const historyKey = "biblio-dnd-roll-history-" + game.id;
    let history = [];
    try {
      const saved = JSON.parse(localStorage.getItem(historyKey) || "[]");
      if (Array.isArray(saved)) history = saved.slice(0, 12);
    } catch { history = []; }
    const randomDie = (sides) => {
      if (globalThis.crypto?.getRandomValues) {
        const limit = Math.floor(0x100000000 / sides) * sides;
        const randomValue = new Uint32Array(1);
        do { globalThis.crypto.getRandomValues(randomValue); } while (randomValue[0] >= limit);
        return (randomValue[0] % sides) + 1;
      }
      return Math.floor(Math.random() * sides) + 1;
    };
    const renderHistory = () => {
      if (!historyNode) return;
      historyNode.replaceChildren();
      if (!history.length) {
        historyNode.append(createElement("p", "game-dice__history-empty", "Здесь появятся последние броски на этом устройстве."));
        return;
      }
      history.forEach((entry) => {
        const item = createElement("div", "game-dice__history-item");
        item.append(createElement("span", "", entry.label), createElement("strong", "", String(entry.total)), createElement("small", "", entry.time));
        historyNode.append(item);
      });
    };
    renderHistory();
    dicePanel.querySelectorAll("[data-die-sides]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedSides = Number(button.dataset.dieSides);
        dicePanel.querySelectorAll("[data-die-sides]").forEach((option) => {
          const selected = option === button;
          option.classList.toggle("is-selected", selected);
          option.setAttribute("aria-pressed", String(selected));
        });
        rollButton.textContent = "Бросить d" + selectedSides;
      });
    });
    dicePanel.querySelectorAll("[data-dice-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        selectedMode = button.dataset.diceMode;
        dicePanel.querySelectorAll("[data-dice-mode]").forEach((option) => {
          const selected = option === button;
          option.classList.toggle("is-selected", selected);
          option.setAttribute("aria-pressed", String(selected));
        });
      });
    });
    rollButton.addEventListener("click", () => {
      if (rolling) return;
      const modifier = Number(modifierInput?.value || 0);
      if (!Number.isInteger(modifier) || modifier < -30 || modifier > 30) {
        showToast("Модификатор должен быть от −30 до +30");
        return;
      }
      rolling = true;
      rollButton.disabled = true;
      result.textContent = "Кубик катится…";
      face.classList.remove("is-rolling");
      void face.offsetWidth;
      face.classList.add("is-rolling");
      const rolls = selectedMode === "normal" ? [randomDie(selectedSides)] : [randomDie(selectedSides), randomDie(selectedSides)];
      const value = selectedMode === "advantage" ? Math.max(...rolls) : selectedMode === "disadvantage" ? Math.min(...rolls) : rolls[0];
      const total = value + modifier;
      const modifierLabel = modifier > 0 ? " + " + modifier : modifier < 0 ? " − " + Math.abs(modifier) : "";
      const modeLabel = selectedMode === "advantage" ? " · преимущество" : selectedMode === "disadvantage" ? " · помеха" : "";
      const rollLabel = "d" + selectedSides + (rolls.length > 1 ? " [" + rolls.join(", ") + "]" : "") + modifierLabel + modeLabel;
      window.setTimeout(() => {
        face.classList.remove("is-rolling");
        face.textContent = String(total);
        result.textContent = "Бросок " + rollLabel + " = " + total + (selectedSides === 20 && value === 20 ? " · критический успех!" : selectedSides === 20 && value === 1 ? " · критический провал!" : "");
        history.unshift({ label: rollLabel, total, time: new Date().toLocaleTimeString("ru-RU", {hour:"2-digit",minute:"2-digit"}) });
        history = history.slice(0, 12);
        try { localStorage.setItem(historyKey, JSON.stringify(history)); } catch {}
        renderHistory();
        rolling = false;
        rollButton.disabled = false;
      }, 650);
    });
  }

  const sessionForm = panel.querySelector("#game-session-form");
  if (sessionForm) {
    sessionForm.addEventListener("submit", async (event) => {
      event.preventDefault();
      const formData = new FormData(sessionForm);
      const userId = formData.get("user_id");
      try {
        const payload = {
          user_id: userId ? Number(userId) : null,
          title: formData.get("title") || "Сессия",
          xp_awarded: Number(formData.get("xp_awarded") || 0),
          notes: formData.get("notes") || "",
        };
        const result = await api(`/api/games/${game.id}/sessions`, { method: "POST", body: JSON.stringify(payload) });
        if (result.session) {
          const refreshedGame = await api(`/api/games/${game.id}`);
          renderGameDetail(refreshedGame.game);
          showToast("Сессия сохранена и XP начислен");
        }
      } catch (error) {
        showToast(error.message);
      }
    });
  }
}

async function createGameRoom(event) {
  event.preventDefault();
  if (!currentUser) {
    openDialog("auth-dialog");
    return;
  }
  const form = event.currentTarget;
  const formData = new FormData(form);
  const payload = {
    name: formData.get("name") || "",
    description: formData.get("description") || "",
    access: formData.get("access") || "public",
    join_code: formData.get("join_code") || "",
    catalog_game_slug: activeCatalogGameSlug,
  };
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/games", { method: "POST", body: JSON.stringify(payload) });
    await openCatalogGame(activeCatalogGameSlug);
    showToast("Комната создана");
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

async function joinPrivateGame(event) {
  event.preventDefault();
  if (!currentUser) {
    openDialog("auth-dialog");
    return;
  }
  const form = event.currentTarget;
  const formData = new FormData(form);
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const result = await api("/api/games/enter", {
      method: "POST",
      body: JSON.stringify({
        code: formData.get("code") || "",
        owner_name: formData.get("owner_name") || "",
      }),
    });
    const gameResult = await api(`/api/games/${result.game_id}`);
    renderGameDetail(gameResult.game);
    showToast("Ты вступил в закрытую комнату");
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
}

function applyPageLayout() {
  const routes = {
    "/": "home",
    "/catalog": "catalog",
    "/authors": "authors",
    "/club": "club",
    "/games": "games",
    "/library": "library",
    "/settings": "settings",
  };
  const path = location.pathname.replace(/\/+$/, "") || "/";
  const page = routes[path] || (/^\/games\/[a-z0-9-]+(?:\/play)?$/.test(path) ? "games" : "home");
  const visibleSections = {
    home: [".hero", ".benefits", "#genres", "#popular", "#club", "#authors", ".newsletter"],
    catalog: ["#genres", "#popular"],
    authors: ["#authors"],
    club: ["#club", ".newsletter"],
    games: ["#games-page"],
    library: ["#reading-library", "#my-library", "#library-login-page"],
    settings: ["#settings-page"],
  };
  const currentUserIsLoggedIn = Boolean(currentUser);

  document.body.dataset.page = page;
  document.body.dataset.gameSite = /^\/games\/dnd(?:\/play)?\/?$/.test(path) ? "true" : "false";
  if (page !== "games" && activeCatalogGameSlug) {
    stopCatalogPresence();
    activeCatalogGameSlug = "";
  }
  document.querySelectorAll("main > section").forEach((section) => {
    const shouldShow = visibleSections[page].some((selector) => section.matches(selector));
    if (section.id === "my-library") {
      section.hidden = page !== "library" || !currentUserIsLoggedIn;
    } else if (section.id === "library-login-page") {
      section.hidden = page !== "library" || currentUserIsLoggedIn;
    } else {
      section.hidden = !shouldShow;
    }
  });
  document.querySelectorAll("[data-page-link]").forEach((link) => {
    if (link.dataset.pageLink === page) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  });

  const pageTitles = {
    home: "Biblio — истории, которые остаются",
    catalog: "Каталог книг — Biblio",
    authors: "Авторы — Biblio",
    club: "Книжный клуб — Biblio",
    games: "Каталог игр — Biblio",
    library: "Моя библиотека — Biblio",
    settings: "Настройки — Biblio",
  };
  document.title = pageTitles[page];
  if (page === "settings" && location.hash) {
    requestAnimationFrame(() => {
      document.getElementById(location.hash.slice(1))?.scrollIntoView();
    });
  }
}

async function setAuthMode(mode) {
  authMode = mode;
  const isRegister = mode === "register";
  authTitle.textContent = isRegister ? "Создать аккаунт" : "Войти в аккаунт";
  authSubmit.textContent = isRegister ? "Зарегистрироваться" : "Войти";
  authNameField.hidden = !isRegister;
  authForm.elements.display_name.required = isRegister;
  authForm.elements.password.autocomplete = isRegister ? "new-password" : "current-password";
  authForm.querySelectorAll("[data-auth-mode]").forEach((tab) => {
    tab.classList.toggle("is-active", tab.dataset.authMode === mode);
  });
}

genreButtons.forEach((button) => {
  button.addEventListener("click", () => {
    setGenre(button.dataset.genre);
  });
});

let catalogSearchFrame = 0;
let catalogSearchTimer = 0;
searchInput.addEventListener("input", () => {
  currentPage = 1;
  if (catalogSearchFrame) cancelAnimationFrame(catalogSearchFrame);
  catalogSearchFrame = requestAnimationFrame(() => {
    catalogSearchFrame = 0;
    filterBooks();
    renderSearchSuggestions(searchInput.value);
  });
  window.clearTimeout(catalogSearchTimer);
  catalogSearchTimer = window.setTimeout(() => {
    refreshPublishedBooks(1).catch((error) => showToast(error.message));
  }, 300);
});
searchInput.addEventListener("focus", () => renderSearchSuggestions(searchInput.value));
searchInput.addEventListener("blur", () => {
  window.setTimeout(renderSearchHistory, 120);
});
searchInput.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    searchInput.value = "";
    searchBox.classList.remove("is-open");
    filterBooks();
    searchInput.blur();
  }
  if (event.key === "Enter") {
    saveSearchQuery();
    if (!["/", "/catalog"].includes(location.pathname)) {
      const query = new URLSearchParams({ q: searchInput.value.trim() });
      location.assign(`/catalog?${query}`);
    }
  }
});

[
  "#catalog-age",
  "#catalog-language",
  "#catalog-length",
  "#catalog-rating",
].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", () => {
    currentPage = 1;
    filterBooks();
  });
});

document.querySelector("#catalog-sort").addEventListener("change", () => {
  currentPage = 1;
  refreshPublishedBooks(1).catch((error) => showToast(error.message));
});

document.querySelector("#catalog-reset").addEventListener("click", () => {
  searchInput.value = "";
  document.querySelector("#catalog-age").value = "";
  document.querySelector("#catalog-language").value = "";
  document.querySelector("#catalog-length").value = "";
  document.querySelector("#catalog-rating").value = "0";
  document.querySelector("#catalog-sort").value = "popular";
  selectedTag = "";
  favoritesOnly = false;
  document.querySelector("#favorite-button").setAttribute("aria-pressed", "false");
  setGenre("Все");
  renderTagFilters();
  renderSearchSuggestions("");
});

document.querySelector("#page-previous").addEventListener("click", () => {
  if (serverPage <= 1) return;
  refreshPublishedBooks(serverPage - 1)
    .then(() => document.querySelector("#popular").scrollIntoView({ behavior: "smooth" }))
    .catch((error) => showToast(error.message));
});
document.querySelector("#page-next").addEventListener("click", () => {
  if (serverPage >= serverPageCount) return;
  refreshPublishedBooks(serverPage + 1)
    .then(() => document.querySelector("#popular").scrollIntoView({ behavior: "smooth" }))
    .catch((error) => showToast(error.message));
});

bookGrid.addEventListener("click", (event) => {
  const clickedFavorite = event.target.closest(".heart-button");
  if (!clickedFavorite && event.target.closest(".book-cover")) {
    const coverCard = event.target.closest(".book-card");
    showBookDetails(coverCard.dataset.bookId).catch((error) => showToast(error.message));
    return;
  }
  const detailButton = event.target.closest(".book-details-button, .book-title-link");
  const title = event.target.closest(".book-info h3");
  const catalogCard = detailButton?.closest(".book-card") || title?.closest(".book-card");
  const bookId = detailButton?.dataset.bookId || catalogCard?.dataset.bookId;
  if (bookId) {
    showBookDetails(bookId).catch((error) => showToast(error.message));
    return;
  }

  const button = clickedFavorite;
  if (!button) return;
  const favoriteCard = button.closest(".book-card");
  const favoriteBookId = favoriteCard.dataset.bookId;
  const isFavorite = !favoriteIds.has(favoriteBookId);
  if (isFavorite) favoriteIds.add(favoriteBookId);
  else favoriteIds.delete(favoriteBookId);
  persistFavorites();
  updateFavoriteButtons();
  renderReadingLibrary();
  filterBooks();
  showToast(isFavorite ? "Книга добавлена в избранное" : "Книга удалена из избранного");
});

document.querySelector("#favorite-button").addEventListener("click", () => {
  if (location.pathname !== "/catalog") {
    location.assign("/library#favorites");
    return;
  }
  favoritesOnly = !favoritesOnly;
  document.querySelector("#favorite-button").setAttribute("aria-pressed", String(favoritesOnly));
  document.querySelector("#favorite-button").setAttribute(
    "aria-label",
    favoritesOnly ? "Показать все книги" : "Показать избранное",
  );
  setGenre("Все");
  document.querySelector("#popular").scrollIntoView({ behavior: "smooth" });
  if (favoritesOnly && favoriteIds.size === 0) showToast("Нажми ♡ на книге, чтобы добавить её в избранное");
});

document.querySelector("#all-books-link").addEventListener("click", () => {
  searchInput.value = "";
  favoritesOnly = false;
  document.querySelector("#favorite-button").setAttribute("aria-pressed", "false");
  selectedTag = "";
  document.querySelector("#catalog-age").value = "";
  document.querySelector("#catalog-language").value = "";
  document.querySelector("#catalog-length").value = "";
  document.querySelector("#catalog-rating").value = "0";
  setGenre("Все");
  renderTagFilters();
});

document.querySelector("#all-genres-link").addEventListener("click", () => setGenre("Все"));

document.querySelector("#all-authors-link").addEventListener("click", () => {
  searchInput.value = "";
  favoritesOnly = false;
  setGenre("Все");
});

document.querySelectorAll(".author-card[data-author]").forEach((link) => {
  link.addEventListener("click", (event) => {
    event.preventDefault();
    showAuthor(link.dataset.author);
  });
});

searchBox.addEventListener("click", () => {
  if (window.matchMedia("(max-width: 760px)").matches) {
    searchBox.classList.add("is-open");
    searchInput.focus();
  }
});

menuToggle.addEventListener("click", () => {
  const isOpen = menuToggle.getAttribute("aria-expanded") !== "true";
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  mainNav.classList.toggle("is-open", isOpen);
});

mainNav.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    mainNav.classList.remove("is-open");
    menuToggle.setAttribute("aria-expanded", "false");
  });
});

readerDialog.addEventListener("close", closeReaderRoute);
bookDetailsDialog.addEventListener("close", () => {
  if (!switchingDialogs.has(bookDetailsDialog) && location.hash.startsWith("#book/")) {
    history.replaceState(null, "", "#popular");
  }
});
document.querySelector("#details-read-button").addEventListener("click", () => {
  if (!activeDetailsBook) return;
  const book = activeDetailsBook;
  openReader(book, true, `#book/${book.id}`);
  closeDialog(bookDetailsDialog);
});
document.querySelector("#details-favorite-button").addEventListener("click", () => {
  if (!activeDetailsBook) return;
  const id = String(activeDetailsBook.id);
  if (favoriteIds.has(id)) favoriteIds.delete(id);
  else favoriteIds.add(id);
  persistFavorites();
  updateFavoriteButtons();
  renderReadingLibrary();
  renderBookDetails(activeDetailsBook, false);
  showToast(favoriteIds.has(id) ? "Книга добавлена в избранное" : "Книга удалена из избранного");
});
document.querySelector("#details-download-button").addEventListener("click", () => {
  if (activeDetailsBook) downloadBook(activeDetailsBook);
});
document.querySelector("#book-details-author").addEventListener("click", (event) => {
  showAuthor(event.currentTarget.dataset.author);
});
document.querySelector("#follow-author-button").addEventListener("click", (event) => {
  if (followedAuthors.has(pendingAuthorName)) followedAuthors.delete(pendingAuthorName);
  else followedAuthors.add(pendingAuthorName);
  localStorage.setItem("biblio-followed-authors", JSON.stringify([...followedAuthors]));
  const followed = followedAuthors.has(pendingAuthorName);
  event.currentTarget.textContent = followed ? "Вы подписаны" : "Подписаться на автора";
  event.currentTarget.setAttribute("aria-pressed", String(followed));
  showToast(followed ? "Вы подписались на автора" : "Подписка отменена");
});
document.querySelector("#profile-library-button").addEventListener("click", () => {
  closeDialog(document.querySelector("#profile-dialog"));
  location.assign("/library");
});
document.querySelectorAll(".rating-stars [data-rating]").forEach((button) => {
  button.addEventListener("click", async () => {
    if (!activeDetailsBook || !currentUser) {
      if (!currentUser) openDialog(authDialog, button);
      return;
    }
    try {
      await api(`/api/books/${activeDetailsBook.id}/rating`, {
        method: "POST",
        body: JSON.stringify({ rating: Number(button.dataset.rating) }),
      });
      await refreshPublishedBooks();
      await showBookDetails(activeDetailsBook.id, false);
      showToast("Твоя оценка сохранена");
    } catch (error) {
      showToast(error.message);
    }
  });
});
document.querySelector("#previous-chapter").addEventListener("click", () => {
  if (activeReaderChapter === 0) return;
  activeReaderChapter -= 1;
  renderReaderChapter();
  document.querySelector("#reader-chapters").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#next-chapter").addEventListener("click", () => {
  if (!activeReaderBook || activeReaderChapter >= activeReaderBook.chapters.length - 1) return;
  activeReaderChapter += 1;
  renderReaderChapter();
  document.querySelector("#reader-chapters").scrollIntoView({ behavior: "smooth", block: "start" });
});
document.querySelector("#reader-mark-read").addEventListener("click", () => {
  if (!activeReaderBook) return;
  setBookCompleted(activeReaderBook, true);
  showToast("Книга добавлена в «Прочитано»");
});
document.querySelector("#reader-mark-unread").addEventListener("click", () => {
  if (!activeReaderBook) return;
  setBookCompleted(activeReaderBook, false);
  showToast("Книга возвращена в «Читаю сейчас»");
});
function updateReadingPreview(event) {
  const form = event.currentTarget;
  const previewSettings = {
    ...DEFAULT_READING_SETTINGS,
    theme: form.elements.theme.value,
    font: form.elements.font.value,
    font_size: Number(form.elements.font_size.value),
    line_height: Number(form.elements.line_height.value) / 10,
    width: form.elements.width.value,
  };
  applyReadingPreview(previewSettings);
}
document.querySelector("#reading-settings-form").addEventListener("input", updateReadingPreview);
document.querySelector("#reading-settings-form").addEventListener("change", updateReadingPreview);
document.querySelector("#reading-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  readingSettings = {
    theme: form.elements.theme.value,
    font: form.elements.font.value,
    font_size: Number(form.elements.font_size.value),
    line_height: Number(form.elements.line_height.value) / 10,
    width: form.elements.width.value,
  };
  localStorage.setItem("biblio-reading-settings", JSON.stringify(readingSettings));
  applyReadingSettings();
  showToast("Настройки чтения сохранены");
});
document.querySelector("#reset-reading-settings").addEventListener("click", () => {
  const form = document.querySelector("#reading-settings-form");
  for (const [name, value] of Object.entries({
    theme: DEFAULT_READING_SETTINGS.theme,
    font: DEFAULT_READING_SETTINGS.font,
    font_size: DEFAULT_READING_SETTINGS.font_size,
    line_height: DEFAULT_READING_SETTINGS.line_height * 10,
    width: DEFAULT_READING_SETTINGS.width,
  })) form.elements[name].value = String(value);
  applyReadingPreview(DEFAULT_READING_SETTINGS);
});
document.querySelector("#site-settings-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  siteSettings = {
    theme: form.elements.theme.value,
    language: "ru",
    email_digest: form.elements.email_digest.checked,
    push: form.elements.push.checked,
    reading_reminders: form.elements.reading_reminders.checked,
  };
  localStorage.setItem("biblio-site-settings", JSON.stringify(siteSettings));
  applySiteTheme();
  showToast("Настройки сайта сохранены на этом устройстве");
});
document.querySelector("#library-sort-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  selectedGenres = new Set(
    [...form.querySelectorAll('input[name="genre"]:checked')].map((input) => input.value),
  );
  activeGenre = "Все";
  genreButtons.forEach((button) => button.classList.toggle("is-active", button.dataset.genre === "Все"));
  document.querySelector("#catalog-age").value = form.elements.age.value;
  document.querySelector("#catalog-rating").value = form.elements.rating.value;
  document.querySelector("#catalog-length").value = form.elements.length.value;
  document.querySelector("#catalog-sort").value = form.elements.sort.value;
  currentPage = 1;
  refreshPublishedBooks(1).catch((error) => showToast(error.message));
  closeDialog(document.querySelector("#library-sort-dialog"));
});
document.querySelector("#reset-library-filters").addEventListener("click", () => {
  const form = document.querySelector("#library-sort-form");
  form.reset();
  document.querySelector("#catalog-reset").click();
  syncFilterDialog();
});
document.querySelector("#author-dialog").addEventListener("close", () => {
  if (!switchingDialogs.has(document.querySelector("#author-dialog")) && location.hash.startsWith("#author/")) {
    history.replaceState(null, "", "#popular");
  }
});
document.querySelectorAll("[data-auth-mode]").forEach((button) => {
  button.addEventListener("click", () => {
    setAuthMode(button.dataset.authMode);
    authForm.reset();
  });
});

authForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(authForm);
  const payload = {
    email: formData.get("email"),
    password: formData.get("password"),
  };
  if (authMode === "register") payload.display_name = formData.get("display_name");

  try {
    const result = await api(authMode === "register" ? "/api/register" : "/api/login", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    if (result.verification_required) {
      pendingVerificationEmail = result.email;
      verificationEmailLabel.textContent = result.email;
      emailVerificationForm.reset();
      openDialog(emailVerificationDialog, authDialog);
      document.querySelector("#email-verification-code").focus();
      showToast("Письмо с кодом отправлено");
      return;
    }
    currentUser = result.user;
    updateAccountUI();
    closeDialog(authDialog);
    authForm.reset();
    resetBookForm();
    const gamePageMatch = location.pathname.match(/^\/games\/([a-z0-9-]+)(?:\/play)?\/?$/);
    if (gamePageMatch) await openCatalogGame(decodeURIComponent(gamePageMatch[1]));
    await refreshMyBooks();
    await refreshPublishedBooks();
    showToast(`Рады видеть тебя, ${currentUser.display_name}!`);
  } catch (error) {
    showToast(error.message);
  }
});

emailVerificationForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submit = emailVerificationForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    const code = new FormData(emailVerificationForm).get("code").trim();
    const result = await api("/api/verify-email", {
      method: "POST",
      body: JSON.stringify({ email: pendingVerificationEmail, code }),
    });
    currentUser = result.user;
    pendingVerificationEmail = "";
    closeDialog(emailVerificationDialog);
    updateAccountUI();
    authForm.reset();
    resetBookForm();
    const gamePageMatch = location.pathname.match(/^\/games\/([a-z0-9-]+)(?:\/play)?\/?$/);
    if (gamePageMatch) await openCatalogGame(decodeURIComponent(gamePageMatch[1]));
    await refreshMyBooks();
    await refreshPublishedBooks();
    showToast(`Почта подтверждена! Добро пожаловать, ${currentUser.display_name}!`);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#email-verification-code").addEventListener("input", (event) => {
  event.currentTarget.value = event.currentTarget.value.replace(/\D/g, "").slice(0, 6);
});

async function logoutCurrentUser() {
  if (!(await askForConfirmation("Выйти из аккаунта на этом устройстве?", "Выйти из аккаунта?"))) {
    return;
  }
  try {
    await api("/api/logout", { method: "POST", body: "{}" });
    currentUser = null;
    updateAccountUI();
    renderMyBooks([]);
    resetBookForm();
    await refreshPublishedBooks();
    showToast("Ты вышел из аккаунта");
  } catch (error) {
    showToast(error.message);
  }
}

document.querySelector("#logout-button").addEventListener("click", logoutCurrentUser);
document.querySelector("#profile-logout-button").addEventListener("click", logoutCurrentUser);

document.querySelector("#chapter-editor-form").addEventListener("input", () => {
  chapterDraftChanged = true;
  window.clearTimeout(chapterDraftTimeout);
  document.querySelector("#chapter-autosave-status").textContent = "Сохраняем черновик…";
  chapterDraftTimeout = window.setTimeout(persistChapterDraft, 400);
});
chapterEditorDialog.addEventListener("close", () => {
  window.clearTimeout(chapterDraftTimeout);
  if (chapterDraftChanged) persistChapterDraft();
});
document.querySelector("#chapter-editor-cancel").addEventListener("click", () => {
  closeDialog(chapterEditorDialog);
});
chapterEditorForm.addEventListener("submit", (event) => {
  event.preventDefault();
  window.clearTimeout(chapterDraftTimeout);
  const chapter = {
    title: chapterEditorForm.elements.title.value.trim(),
    content: chapterEditorForm.elements.content.value,
  };
  if (editingChapterIndex < 0) editingChapters.push(chapter);
  else editingChapters[editingChapterIndex] = chapter;
  localStorage.removeItem("biblio-chapter-draft");
  chapterDraftChanged = false;
  renderChapterEditorList();
  closeDialog(chapterEditorDialog);
});

document.querySelector("#cancel-edit").addEventListener("click", async () => {
  const currentState = JSON.stringify({
    fields: [...new FormData(bookForm).entries()],
    chapters: editingChapters,
  });
  if (
    editingBookId &&
    ((bookForm.dataset.initialState && currentState !== bookForm.dataset.initialState) ||
      hasUnsavedChapterDraft()) &&
    !(await askForConfirmation("Отменить изменения книги? Несохранённые правки будут потеряны."))
  ) {
    return;
  }
  if (editingBookId) {
    const draft = readStoredObject("biblio-chapter-draft");
    if (draft.bookId === editingBookId) localStorage.removeItem("biblio-chapter-draft");
  }
  resetBookForm();
});

bookForm.elements.genre.addEventListener("change", () => {
  const custom = bookForm.elements.custom_genre;
  const isOther = bookForm.elements.genre.value === "Другое";
  custom.hidden = !isOther;
  custom.required = isOther;
  if (!isOther) custom.value = "";
});

bookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const chapters = editingChapters
    .map(({ title, content }) => ({ title: title.trim(), content }))
    .filter((chapter) => chapter.title || chapter.content);
  const payload = {
    title: bookForm.elements.title.value,
    author: bookForm.elements.author.value,
    genre: bookForm.elements.genre.value === "Другое"
      ? bookForm.elements.custom_genre.value.trim()
      : bookForm.elements.genre.value,
    age_rating: bookForm.elements.age_rating.value,
    language: bookForm.elements.language.value,
    tags: bookForm.elements.tags.value.split(",").map((tag) => tag.trim()).filter(Boolean),
    description: bookForm.elements.description.value,
    status: submitter.value,
    chapters,
  };
  const path = editingBookId ? `/api/books/${editingBookId}` : "/api/books";

  try {
    const result = await api(path, {
      method: editingBookId ? "PUT" : "POST",
      body: JSON.stringify(payload),
    });
    const action = payload.status === "published" ? "опубликована" : "сохранена в черновиках";
    const draft = readStoredObject("biblio-chapter-draft");
    if (draft.bookId === (editingBookId || `new-${currentUser?.id || "guest"}`)) {
      localStorage.removeItem("biblio-chapter-draft");
    }
    resetBookForm();
    await refreshMyBooks();
    await refreshPublishedBooks();
    showToast(`Книга «${result.book.title}» ${action}`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#profile-avatar-file").addEventListener("change", async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  if (!["image/png", "image/jpeg", "image/webp"].includes(file.type)) {
    showToast("Выбери изображение PNG, JPG или WebP.");
    input.value = "";
    return;
  }
  if (file.size > 8 * 1024 * 1024) {
    showToast("Исходное изображение должно быть не больше 8 МБ.");
    input.value = "";
    return;
  }

  try {
    let avatarData;
    if ("createImageBitmap" in window) {
      const bitmap = await createImageBitmap(file);
      const maxSide = 256;
      const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Не удалось обработать изображение.");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      avatarData = canvas.toDataURL("image/webp", 0.82);
      if (!avatarData.startsWith("data:image/webp,")) {
        avatarData = canvas.toDataURL("image/jpeg", 0.82);
      }
    } else {
      if (file.size > 550 * 1024) {
        throw new Error("В этом браузере аватарка должна быть не больше 550 КБ.");
      }
      avatarData = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(new Error("Не удалось прочитать изображение."));
        reader.readAsDataURL(file);
      });
    }
    if (avatarData.length > 760000) {
      throw new Error("Не удалось достаточно сжать изображение. Выбери другое фото.");
    }
    pendingAvatarData = avatarData;
    const avatar = document.querySelector("#profile-avatar");
    avatar.replaceChildren();
    const image = document.createElement("img");
    image.src = pendingAvatarData;
    image.alt = "Предпросмотр аватарки";
    image.decoding = "async";
    avatar.append(image);
  } catch (error) {
    showToast(error.message || "Не удалось обработать аватарку.");
    input.value = "";
  }
});

document.querySelector("#remove-profile-avatar").addEventListener("click", () => {
  pendingAvatarData = "";
  const avatar = document.querySelector("#profile-avatar");
  avatar.textContent = currentUser?.display_name?.trim().charAt(0).toLocaleUpperCase("ru") || "B";
  document.querySelector("#profile-avatar-file").value = "";
});

document.querySelector("#profile-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  try {
    const result = await api("/api/account", {
      method: "PATCH",
      body: JSON.stringify({
        display_name: formData.get("display_name"),
        email: formData.get("email"),
        bio: formData.get("bio"),
        avatar_url: pendingAvatarData === null ? (currentUser.avatar_url || "") : pendingAvatarData,
        current_password: formData.get("current_password"),
      }),
    });
    currentUser = result.user;
    pendingAvatarData = null;
    form.elements.avatar_file.value = "";
    form.elements.current_password.value = "";
    updateAccountUI();
    showToast("Настройки аккаунта сохранены");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#open-delete-account").addEventListener("click", () => {
  const dialog = document.querySelector("#delete-account-dialog");
  document.querySelector("#delete-account-form").reset();
  dialog.showModal();
});

document.querySelector("#delete-account-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const submit = form.querySelector('button[type="submit"]');
  submit.disabled = true;
  try {
    await api("/api/account", {
      method: "DELETE",
      body: JSON.stringify({ current_password: new FormData(form).get("current_password") }),
    });
    document.querySelector("#delete-account-dialog").close();
    document.querySelector("#profile-dialog").close();
    currentUser = null;
    pendingAvatarData = null;
    form.reset();
    updateAccountUI();
    showToast("Аккаунт и ваши книги удалены");
    await refreshPublishedBooks(1);
  } catch (error) {
    showToast(error.message);
  } finally {
    submit.disabled = false;
  }
});

document.querySelector("#password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  if (formData.get("new_password") !== formData.get("confirm_password")) {
    showToast("Новый пароль и подтверждение не совпадают");
    form.elements.confirm_password.focus();
    return;
  }
  try {
    await api("/api/account/password", {
      method: "POST",
      body: JSON.stringify({
        current_password: formData.get("current_password"),
        new_password: formData.get("new_password"),
      }),
    });
    form.reset();
    closeDialog(document.querySelector("#password-dialog"), true);
    showToast("Пароль обновлён");
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelector("#newsletter-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const email = document.querySelector("#email");
  const message = document.querySelector("#newsletter-message");
  try {
    await api("/api/newsletter", {
      method: "POST",
      body: JSON.stringify({ email: email.value }),
    });
    message.textContent = "Готово! Ты подписан на книжные новости.";
    email.value = "";
  } catch (error) {
    message.textContent = error.message;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "/" && !["INPUT", "TEXTAREA"].includes(document.activeElement.tagName)) {
    event.preventDefault();
    if (window.matchMedia("(max-width: 760px)").matches) searchBox.classList.add("is-open");
    searchInput.focus();
  }
});

window.addEventListener("hashchange", () => {
  const readerMatch = location.hash.match(/^#read\/([^/]+)$/);
  if (readerMatch) {
    openBookById(decodeURIComponent(readerMatch[1])).catch((error) => {
      showToast(error.message);
      history.replaceState(null, "", "#popular");
    });
    return;
  }
  const bookMatch = location.hash.match(/^#book\/([^/]+)$/);
  if (bookMatch) {
    showBookDetails(decodeURIComponent(bookMatch[1]), false).catch((error) => {
      showToast(error.message);
      history.replaceState(null, "", "#popular");
    });
    return;
  }
  if (readerDialog.open) closeDialog(readerDialog);
  if (bookDetailsDialog.open) closeDialog(bookDetailsDialog);
});

async function loadRegisteredAccountCount() {
  const counter = document.querySelector("#registered-account-count");
  if (!counter) return;
  try {
    const result = await api("/api/stats");
    const count = Number(result.registered_accounts);
    if (Number.isFinite(count) && count >= 0) {
      counter.textContent = new Intl.NumberFormat("ru-RU").format(count);
    }
  } catch (error) {
    counter.textContent = "—";
  }
}

// Automatically reload the page once every hour.
const HOURLY_PAGE_RELOAD_MS = 60 * 60 * 1000;
window.setInterval(() => {
  window.location.reload();
}, HOURLY_PAGE_RELOAD_MS);

async function initialize() {
  resetBookForm();
  readAppearance();
  searchInput.value = new URLSearchParams(location.search).get("q") || "";
  applyPageLayout();
  const page = document.body.dataset.page;
  if (page === "home") loadRegisteredAccountCount();
  document.querySelector("#favorite-button").setAttribute("aria-pressed", String(favoritesOnly));
  updateFavoriteButtons();
  try {
    const result = await api("/api/me");
    currentUser = result.user;
    updateAccountUI();
    if (["home", "catalog", "authors"].includes(page)) {
      await refreshPublishedBooks();
    }
    if (page === "games") {
      await refreshGameCatalog();
      const gamePageMatch = location.pathname.match(/^\/games\/([a-z0-9-]+)(?:\/play)?\/?$/);
      if (gamePageMatch) await openCatalogGame(decodeURIComponent(gamePageMatch[1]));
    }
    if (page === "library" && currentUser) await refreshMyBooks();
    const readerRoute = location.hash.match(/^#read\/([^/]+)$/);
    const bookRoute = location.hash.match(/^#book\/([^/]+)$/);
    if (readerRoute) {
      await openBookById(decodeURIComponent(readerRoute[1]));
    } else if (bookRoute) {
      await showBookDetails(decodeURIComponent(bookRoute[1]), false);
    }
  } catch (error) {
    showToast(error.message || "Не удалось связаться с сервером. Проверь соединение и попробуй ещё раз.");
    applyPageLayout();
    if (page === "library") renderReadingLibrary();
  }
}

initialize();

