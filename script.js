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
  const existingBook = allBooks.find((item) => String(item.id) === String(bookId));
  let book = existingBook;
  if (!book || !Array.isArray(book.chapters) || !book.chapters.length) {
    book = (await api(`/api/books/${encodeURIComponent(bookId)}`)).book;
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
let allBooks = [];
let activeDetailsBook = null;
let favoriteIds = new Set(readStoredArray("biblio-favorites"));
let readingLibraryState = readReadingLibraryState();
let searchHistory = readStoredArray("biblio-search-history");
let currentUser = null;
let editingBookId = null;
let authMode = "login";
let activeReaderBook = null;
let activeReaderChapter = 0;
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
  const response = await fetch(path, {
    credentials: "same-origin",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error || "Не удалось выполнить запрос.");
  return result;
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

function filterBooks() {
  const query = searchInput.value.trim().toLocaleLowerCase("ru");
  const cards = [...bookGrid.querySelectorAll(".book-card")];
  const ageRating = document.querySelector("#catalog-age").value;
  const language = document.querySelector("#catalog-language").value;
  const length = document.querySelector("#catalog-length").value;
  const minRating = Number(document.querySelector("#catalog-rating").value);
  const filtered = cards.filter((card) => {
    const book = allBooks.find((item) => String(item.id) === card.dataset.bookId);
    if (!book) return false;
    const searchableText = `${book.title} ${book.author} ${book.description || ""} ${(book.tags || []).join(" ")}`.toLocaleLowerCase("ru");
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
    const left = allBooks.find((item) => String(item.id) === leftCard.dataset.bookId);
    const right = allBooks.find((item) => String(item.id) === rightCard.dataset.bookId);
    if (sortBy === "title") return left.title.localeCompare(right.title, "ru");
    if (sortBy === "rating") return right.rating - left.rating || right.rating_count - left.rating_count;
    if (sortBy === "newest") return String(right.created_at || "").localeCompare(String(left.created_at || ""));
    return right.rating * Math.log10((right.rating_count || 0) + 1) -
      left.rating * Math.log10((left.rating_count || 0) + 1);
  });

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  currentPage = Math.min(currentPage, pageCount);
  const pageStart = (currentPage - 1) * pageSize;
  const visibleCards = new Set(filtered.slice(pageStart, pageStart + pageSize));
  cards.forEach((card) => {
    card.hidden = !visibleCards.has(card);
  });

  emptyState.hidden = filtered.length > 0;
  document.querySelector("#catalog-result-count").textContent =
    `Найдено книг: ${filtered.length}${favoritesOnly ? " · избранное" : ""}`;
  document.querySelector("#page-indicator").textContent = `${currentPage} / ${pageCount}`;
  document.querySelector("#page-previous").disabled = currentPage <= 1;
  document.querySelector("#page-next").disabled = currentPage >= pageCount;
  document.querySelector("#catalog-pagination").hidden = filtered.length <= pageSize;
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
    const book = allBooks.find((item) => String(item.id) === card.dataset.bookId);
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

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text;
  return element;
}

function renderReadingLibrary() {
  const booksById = new Map(allBooks.map((book) => [String(book.id), book]));
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
          localStorage.setItem("biblio-favorites", JSON.stringify([...favoriteIds]));
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

function saveReadingPosition(book) {
  const bookId = String(book.id);
  const progress = readStoredObject("biblio-reading-progress");
  progress[bookId] = activeReaderChapter;
  localStorage.setItem("biblio-reading-progress", JSON.stringify(progress));
  const previous = readingLibraryState[bookId];
  readingLibraryState[bookId] = {
    chapter: activeReaderChapter,
    status: previous?.status === "completed" ? "completed" : "reading",
    updatedAt: new Date().toISOString(),
  };
  localStorage.setItem("biblio-reading-state", JSON.stringify(readingLibraryState));
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
  localStorage.setItem("biblio-reading-progress", JSON.stringify(progress));
  localStorage.setItem("biblio-reading-state", JSON.stringify(readingLibraryState));
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
  section.append(createElement("h3", "", chapter.title));
  section.append(createElement("p", "", chapter.content));
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
  document.querySelector("#reader-mark-read").hidden = isCompleted;
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
  const book = (await api(`/api/books/${encodeURIComponent(bookId)}`)).book;
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
  const authorBooks = allBooks.filter((book) => book.author === authorName);
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
  filterBooks();
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

async function refreshPublishedBooks() {
  const { books } = await api("/api/books");
  allBooks = books;
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
  document.querySelector("#profile-avatar").textContent =
    currentUser.display_name.trim().charAt(0).toLocaleUpperCase("ru");
  const profileForm = document.querySelector("#profile-form");
  profileForm.elements.display_name.value = currentUser.display_name;
  profileForm.elements.email.value = currentUser.email;
}

function applyPageLayout() {
  const routes = {
    "/": "home",
    "/catalog": "catalog",
    "/authors": "authors",
    "/club": "club",
    "/library": "library",
    "/settings": "settings",
  };
  const page = routes[location.pathname.replace(/\/+$/, "") || "/"] || "home";
  const visibleSections = {
    home: [".hero", ".benefits", "#genres", "#popular", "#club", "#authors", ".newsletter"],
    catalog: ["#genres", "#popular"],
    authors: ["#authors"],
    club: ["#club", ".newsletter"],
    library: ["#reading-library", "#my-library", "#library-login-page"],
    settings: ["#settings-page"],
  };
  const currentUserIsLoggedIn = Boolean(currentUser);

  document.body.dataset.page = page;
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

searchInput.addEventListener("input", filterBooks);
searchInput.addEventListener("input", () => {
  currentPage = 1;
  renderSearchSuggestions(searchInput.value);
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
  "#catalog-sort",
].forEach((selector) => {
  document.querySelector(selector).addEventListener("change", () => {
    currentPage = 1;
    filterBooks();
  });
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
  if (currentPage <= 1) return;
  currentPage -= 1;
  filterBooks();
  document.querySelector("#popular").scrollIntoView({ behavior: "smooth" });
});
document.querySelector("#page-next").addEventListener("click", () => {
  currentPage += 1;
  filterBooks();
  document.querySelector("#popular").scrollIntoView({ behavior: "smooth" });
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
  localStorage.setItem("biblio-favorites", JSON.stringify([...favoriteIds]));
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
  localStorage.setItem("biblio-favorites", JSON.stringify([...favoriteIds]));
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
  filterBooks();
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
    currentUser = result.user;
    updateAccountUI();
    closeDialog(authDialog);
    authForm.reset();
    resetBookForm();
    await refreshMyBooks();
    await refreshPublishedBooks();
    showToast(`Рады видеть тебя, ${currentUser.display_name}!`);
  } catch (error) {
    showToast(error.message);
  }
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

bookForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const submitter = event.submitter;
  const chapters = editingChapters
    .map(({ title, content }) => ({ title: title.trim(), content }))
    .filter((chapter) => chapter.title || chapter.content);
  const payload = {
    title: bookForm.elements.title.value,
    author: bookForm.elements.author.value,
    genre: bookForm.elements.genre.value,
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
        current_password: formData.get("current_password"),
      }),
    });
    currentUser = result.user;
    form.elements.current_password.value = "";
    updateAccountUI();
    showToast("Настройки аккаунта сохранены");
  } catch (error) {
    showToast(error.message);
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
  loadRegisteredAccountCount();
  resetBookForm();
  readAppearance();
  searchInput.value = new URLSearchParams(location.search).get("q") || "";
  document.querySelector("#favorite-button").setAttribute("aria-pressed", String(favoritesOnly));
  applyPageLayout();
  updateFavoriteButtons();
  try {
    const result = await api("/api/me");
    currentUser = result.user;
    updateAccountUI();
    await refreshPublishedBooks();
    if (currentUser) await refreshMyBooks();
    const readerRoute = location.hash.match(/^#read\/([^/]+)$/);
    const bookRoute = location.hash.match(/^#book\/([^/]+)$/);
    if (readerRoute) {
      await openBookById(decodeURIComponent(readerRoute[1]));
    } else if (bookRoute) {
      await showBookDetails(decodeURIComponent(bookRoute[1]), false);
    }
  } catch (error) {
    showToast("Не удалось связаться с сервером. Запусти сайт командой python3 server.py.");
    applyPageLayout();
    renderReadingLibrary();
  }
}

initialize();

// Automatically refresh the page once every hour.
window.setInterval(() => {
  window.location.reload();
}, 60 * 60 * 1000);
