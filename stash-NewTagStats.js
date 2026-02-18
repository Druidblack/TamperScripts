// ==UserScript==
// @name         StashNewTagStats
// @author       KennyG
// @namespace    http://localhost:9999/
// @version      0.8.1
// @description  Adds a Tag Stats button to the scenes page toolbar and shows tag counts
// @icon         https://docs.stashapp.cc/assets/images/favicon.ico
// @match        http://localhost:9999/scenes*
// @grant        none
// ==/UserScript==

(() => {
  "use strict";

  const BTN_ID = "stashnewtagstats-btn";
  const MODAL_ID = "stashnewtagstats-modal";
  const BACKDROP_ID = "stashnewtagstats-backdrop";
  const HIGHLIGHT_STYLE_ID = "stashnewtagstats-highlight-style";

  const TAG_SVG = `
    <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="tags"
      class="svg-inline--fa fa-tags fa-icon fa-fw" role="img"
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
      <path fill="currentColor"
        d="M345 39.1L472.8 168.4c52.4 53 52.4 138.2 0 191.2L360.8 472.9c-9.3 9.4-24.5 9.5-33.9 .2s-9.5-24.5-.2-33.9L438.6 325.9c33.9-34.3 33.9-89.4 0-123.7L310.9 72.9c-9.3-9.4-9.2-24.6 .2-33.9s24.6-9.2 33.9 .2zM0 229.5L0 80C0 53.5 21.5 32 48 32l149.5 0c17 0 33.3 6.7 45.3 18.7l168 168c25 25 25 65.5 0 90.5L277.3 442.7c-25 25-65.5 25-90.5 0l-168-168C6.7 262.7 0 246.5 0 229.5zM144 144a32 32 0 1 0 -64 0 32 32 0 1 0 64 0z">
      </path>
    </svg>
  `;
  const PLUS_SVG = `
    <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="plus"
      class="svg-inline--fa fa-plus fa-icon fa-fw" role="img"
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
      <path fill="currentColor"
        d="M256 80c0-17.7-14.3-32-32-32s-32 14.3-32 32l0 144L48 224c-17.7 0-32 14.3-32 32s14.3 32 32 32l144 0 0 144c0 17.7 14.3 32 32 32s32-14.3 32-32l0-144 144 0c17.7 0 32-14.3 32-32s-14.3-32-32-32l-144 0 0-144z">
      </path>
    </svg>
  `;
  const MINUS_SVG = `
    <svg aria-hidden="true" focusable="false" data-prefix="fas" data-icon="minus"
      class="svg-inline--fa fa-minus fa-icon fa-fw" role="img"
      xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 512">
      <path fill="currentColor"
        d="M16 256c0-17.7 14.3-32 32-32l352 0c17.7 0 32 14.3 32 32s-14.3 32-32 32L48 288c-17.7 0-32-14.3-32-32z">
      </path>
    </svg>
  `;

  // Default ignore list for Tag Stats. These are baked into the script but can
  // be overridden per-browser via localStorage (see IGNORE_TAGS_KEY below).
  const DEFAULT_IGNORE_TAGS = [
    // Examples (edit as desired, or manage via the modal UI):
    // "1080p",
    // "720p",
    // "2160p",
    // "mp4",
  ];
  const IGNORE_TAGS_KEY = "stashNewTagStatsIgnoreTags";

  function ensureHighlightStyles() {
    if (document.getElementById(HIGHLIGHT_STYLE_ID)) return;
    const style = document.createElement("style");
    style.id = HIGHLIGHT_STYLE_ID;
    style.textContent = `
      /* Highlight non-ignored tags directly on the scene tagger */
      span.tag-item.badge.badge-secondary.sns-tag-highlight {
        background-color: #ffcc4d !important;
        color: #222 !important;
        border-color: #e0b83c !important;
      }
    `;
    document.head.appendChild(style);
  }

  function normLabel(s) {
    return (s ?? "").replace(/\s+/g, " ").trim();
  }

  function loadIgnoreTagsFromStorage() {
    try {
      const raw = window.localStorage.getItem(IGNORE_TAGS_KEY);
      if (!raw) return [...DEFAULT_IGNORE_TAGS];
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return [...DEFAULT_IGNORE_TAGS];
      return parsed.map((v) => normLabel(String(v))).filter(Boolean);
    } catch {
      return [...DEFAULT_IGNORE_TAGS];
    }
  }

  function saveIgnoreTagsToStorage(list) {
    try {
      window.localStorage.setItem(IGNORE_TAGS_KEY, JSON.stringify(list));
    } catch (e) {
      console.warn("[StashNewTagStats] Failed to save ignore tags to localStorage", e);
    }
  }

  // Current in-memory ignore list (kept in sync with localStorage when the
  // modal opens or when the user edits it via the UI).
  let CURRENT_IGNORE_TAGS = loadIgnoreTagsFromStorage();

  function setCurrentIgnoreTags(list) {
    CURRENT_IGNORE_TAGS = list.map((v) => normLabel(String(v))).filter(Boolean);
    saveIgnoreTagsToStorage(CURRENT_IGNORE_TAGS);
  }

  function isIgnoredLabel(label) {
    const norm = normLabel(label).toLowerCase();
    if (!norm) return false;
    return CURRENT_IGNORE_TAGS.some((entry) => normLabel(entry).toLowerCase() === norm);
  }

  function addTagToIgnoreAndRefresh(label) {
    const norm = normLabel(label);
    if (!norm) return;
    const existing = loadIgnoreTagsFromStorage().map((v) => normLabel(v)).filter(Boolean);
    if (!existing.some((v) => v.toLowerCase() === norm.toLowerCase())) {
      existing.push(norm);
    }
    setCurrentIgnoreTags(existing);
    // Rebuild modal with updated ignore list applied
    showCountsModal();
  }

  // Returns true if a tag <span> is part of the Tagger "Blacklist" UI
  // (those entries should not be counted in the on-page tag stats).
  function isBlacklistTagSpan(el) {
    if (!el || !el.closest) return false;
    const container = el.closest("div");
    if (!container) return false;
    const h5 = container.querySelector("h5");
    if (!h5) return false;
    return (h5.textContent || "").trim().toLowerCase() === "blacklist";
  }

  function collectTagCounts() {
    const nodes = document.querySelectorAll('span.tag-item.badge.badge-secondary');
    const counts = new Map();

    nodes.forEach((n) => {
      // Skip any tag span that belongs to the Tagger "Blacklist" panel
      // (these are regex filters, not actual scene tags).
      if (isBlacklistTagSpan(n)) return;

      const label = normLabel(n.textContent);
      if (!label) return;
      if (isIgnoredLabel(label)) return;
      counts.set(label, (counts.get(label) ?? 0) + 1);
    });

    // Sort: count desc, then alpha asc (case-insensitive, stable for identical)
    const rows = Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => {
        if (b.count !== a.count) return b.count - a.count;
        const al = a.label.toLowerCase();
        const bl = b.label.toLowerCase();
        if (al < bl) return -1;
        if (al > bl) return 1;
        // if only case differs, fall back to original
        if (a.label < b.label) return -1;
        if (a.label > b.label) return 1;
        return 0;
      });

    return { totalTagSpans: nodes.length, uniqueTags: counts.size, rows };
  }

  // Apply highlight class to any on-page tag chip that is NOT in the ignore list.
  function applyTagHighlighting() {
    const spans = document.querySelectorAll('span.tag-item.badge.badge-secondary');

    spans.forEach((span) => {
      if (isBlacklistTagSpan(span)) return;

      // Clone so we can strip buttons and read only the visible text label
      const clone = span.cloneNode(true);
      clone.querySelectorAll("button").forEach((b) => b.remove());
      const label = normLabel(clone.textContent);
      if (!label) return;

      if (isIgnoredLabel(label)) {
        span.classList.remove("sns-tag-highlight");
      } else {
        span.classList.add("sns-tag-highlight");
      }
    });
  }

  // Given a tag label, try to locate the corresponding native tag chip on the
  // underlying page and return its "Create" button (if any).
  function findNativeCreateButton(label) {
    const target = normLabel(label).toLowerCase();
    if (!target) return null;

    const spans = document.querySelectorAll("span.tag-item.badge.badge-secondary");

    for (const span of spans) {
      if (isBlacklistTagSpan(span)) continue;

      // Clone so we can strip buttons and read only the visible text label
      const clone = span.cloneNode(true);
      clone.querySelectorAll("button").forEach((b) => b.remove());
      const spanLabel = normLabel(clone.textContent).toLowerCase();
      if (!spanLabel || spanLabel !== target) continue;

      const createBtn = span.querySelector('button[title="Create"]');
      if (createBtn) return createBtn;
    }

    return null;
  }

  function removeModal() {
    document.getElementById(MODAL_ID)?.remove();
    document.getElementById(BACKDROP_ID)?.remove();
    document.removeEventListener("keydown", onEscClose, true);
  }

  function onEscClose(e) {
    if (e.key === "Escape") removeModal();
  }

  function ensureStyles() {
    if (document.getElementById("stashnewtagstats-style")) return;

    const style = document.createElement("style");
    style.id = "stashnewtagstats-style";
    style.textContent = `
      #${BACKDROP_ID} {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,0.45);
        z-index: 9998;
      }
      #${MODAL_ID} {
        position: fixed;
        top: 10vh;
        left: 50%;
        transform: translateX(-50%);
        width: min(720px, calc(100vw - 32px));
        max-height: 80vh;
        overflow: hidden;
        z-index: 9999;
        background: #1f2327;
        color: #e8e8e8;
        border: 1px solid rgba(255,255,255,0.12);
        border-radius: 10px;
        box-shadow: 0 12px 30px rgba(0,0,0,0.45);
        font-family: inherit;
      }
      #${MODAL_ID} .sns-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid rgba(255,255,255,0.10);
      }
      #${MODAL_ID} .sns-title {
        display: flex;
        align-items: center;
        gap: 10px;
        font-size: 16px;
        font-weight: 600;
      }
      #${MODAL_ID} .sns-title svg { width: 18px; height: 18px; }
      #${MODAL_ID} .sns-meta {
        font-size: 12px;
        opacity: 0.85;
        margin-top: 2px;
        font-weight: 400;
      }
      #${MODAL_ID} .sns-body {
        padding: 12px 14px 14px 14px;
        max-height: calc(80vh - 56px);
        overflow: auto;
      }
      #${MODAL_ID} .sns-actions {
        display: flex;
        align-items: center;
        gap: 8px;
      }
      #${MODAL_ID} .sns-close {
        cursor: pointer;
        background: transparent;
        border: 1px solid rgba(255,255,255,0.20);
        color: #e8e8e8;
        border-radius: 8px;
        padding: 6px 10px;
        font-size: 13px;
      }
      #${MODAL_ID} .sns-close:hover {
        border-color: rgba(255,255,255,0.35);
      }
      #${MODAL_ID} .sns-taglist {
        display: block;
        font-size: 13px;
        line-height: 1.6;
      }
      #${MODAL_ID} .sns-taglist .tag-item {
        display: inline-block;
        margin: 0 6px 6px 0;
      }
      #${MODAL_ID} .sns-empty {
        padding: 10px 0;
        opacity: 0.9;
        font-size: 13px;
      }
      #${MODAL_ID} .sns-hint {
        opacity: 0.75;
        font-size: 12px;
        margin-top: 10px;
      }
    `;
    document.head.appendChild(style);
  }

  function showCountsModal() {
    // Refresh ignore list from storage each time modal is opened, so edits in
    // other tabs/windows are picked up.
    CURRENT_IGNORE_TAGS = loadIgnoreTagsFromStorage();
    removeModal();
    ensureStyles();

    const { totalTagSpans, uniqueTags, rows } = collectTagCounts();

    const backdrop = document.createElement("div");
    backdrop.id = BACKDROP_ID;
    backdrop.addEventListener("click", removeModal);

    const modal = document.createElement("div");
    modal.id = MODAL_ID;
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");

    const header = document.createElement("div");
    header.className = "sns-header";

    const titleWrap = document.createElement("div");
    titleWrap.innerHTML = `
      <div class="sns-title">${TAG_SVG}<div>
        <div>Candidate tags on this page</div>
        <div class="sns-meta">${uniqueTags} unique, ${totalTagSpans} total</div>
      </div></div>
    `;

    const actions = document.createElement("div");
    actions.className = "sns-actions";

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "sns-close";
    closeBtn.textContent = "Close";
    closeBtn.addEventListener("click", removeModal);

    actions.appendChild(closeBtn);
    header.appendChild(titleWrap);
    header.appendChild(actions);

    const body = document.createElement("div");
    body.className = "sns-body";

    if (!rows.length) {
      const empty = document.createElement("div");
      empty.className = "sns-empty";
      empty.textContent = "No tag spans found on this page.";
      body.appendChild(empty);
    } else {
      const tagList = document.createElement("div");
      tagList.className = "sns-taglist";

      rows.forEach(({ label, count }) => {
        const span = document.createElement("span");
        span.className = "tag-item badge badge-secondary";
        span.textContent = label;

        // "Ignore" button (red minus) – adds this tag to the ignore list and
        // removes it from the stats view.
        const ignoreBtn = document.createElement("button");
        ignoreBtn.type = "button";
        ignoreBtn.title = "Ignore this tag in stats";
        ignoreBtn.className = "minimal ml-2 btn btn-danger";
        ignoreBtn.innerHTML = MINUS_SVG;

        // "Create" button, matching native markup
        const createBtn = document.createElement("button");
        createBtn.type = "button";
        createBtn.title = "Create";
        createBtn.className = "minimal ml-2 btn btn-primary";
        createBtn.innerHTML = PLUS_SVG;

        // "Link to existing" style button, but showing the count instead of a link icon
        const countBtn = document.createElement("button");
        countBtn.type = "button";
        countBtn.title = `Count on page: ${count}`;
        countBtn.className = "minimal btn btn-primary";
        const countSpan = document.createElement("span");
        countSpan.textContent = String(count);
        countBtn.appendChild(countSpan);

        ignoreBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();
          addTagToIgnoreAndRefresh(label);
        });

        // Reuse native React/GraphQL behaviour by delegating to the existing
        // "Create" button for this tag on the underlying page (if present),
        // then remove this chip from the stats list once clicked.
        createBtn.addEventListener("click", (ev) => {
          ev.preventDefault();
          ev.stopPropagation();

          const nativeBtn = findNativeCreateButton(label);
          if (!nativeBtn) {
            createBtn.title = "No native Create button found for this tag on the page";
            return;
          }

          nativeBtn.click();
          // Optimistically remove the chip from the modal; the native UI will
          // show its own confirmation / error if something goes wrong.
          span.remove();
        });

        span.appendChild(createBtn);
        span.appendChild(countBtn);
        span.appendChild(ignoreBtn);
        tagList.appendChild(span);
      });

      body.appendChild(tagList);

      // Inline ignore-list editor (uses localStorage under the hood).
      const ignoreWrap = document.createElement("div");
      ignoreWrap.className = "sns-ignore";

      const ignoreLabel = document.createElement("div");
      ignoreLabel.className = "sns-ignore-label";
      ignoreLabel.textContent = "Ignored tags (comma-separated, case-insensitive):";

      const ignoreInputRow = document.createElement("div");
      ignoreInputRow.style.display = "flex";
      ignoreInputRow.style.gap = "6px";
      ignoreInputRow.style.marginTop = "4px";

      const ignoreInput = document.createElement("input");
      ignoreInput.type = "text";
      ignoreInput.className = "form-control form-control-sm";
      ignoreInput.value = CURRENT_IGNORE_TAGS.join(", ");
      ignoreInput.style.flex = "1 1 auto";

      const ignoreSave = document.createElement("button");
      ignoreSave.type = "button";
      ignoreSave.className = "btn btn-sm btn-secondary";
      ignoreSave.textContent = "Save & Refresh";

      ignoreSave.addEventListener("click", (ev) => {
        ev.preventDefault();
        const raw = ignoreInput.value || "";
        const list = raw
          .split(",")
          .map((s) => normLabel(s))
          .filter(Boolean);
        setCurrentIgnoreTags(list);
        // Rebuild modal with new ignore list applied
        showCountsModal();
      });

      ignoreInputRow.appendChild(ignoreInput);
      ignoreInputRow.appendChild(ignoreSave);
      ignoreWrap.appendChild(ignoreLabel);
      ignoreWrap.appendChild(ignoreInputRow);
      body.appendChild(ignoreWrap);

      const hint = document.createElement("div");
      hint.className = "sns-hint";
      hint.textContent = "Sorted by count (desc), then tag name (A–Z). Press Esc to close.";
      body.appendChild(hint);
    }

    modal.appendChild(header);
    modal.appendChild(body);

    document.body.appendChild(backdrop);
    document.body.appendChild(modal);

    document.addEventListener("keydown", onEscClose, true);
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function addButton() {
  if (document.getElementById(BTN_ID)) return;

  const toolbar = document.querySelector("div.ml-1");
  if (!toolbar) return;

  const btn = document.createElement("button");
  btn.type = "button";
  btn.id = BTN_ID;
  btn.className = "btn btn-primary ml-3";
  btn.title = "Tag Stats";
  btn.setAttribute("aria-label", "Tag Stats");
  btn.innerHTML = `${TAG_SVG}`;

    btn.addEventListener("click", (ev) => {
      ev.preventDefault();
      showCountsModal();
    });

    toolbar.appendChild(btn);
  }

  function init() {
    addButton();
    ensureHighlightStyles();
    applyTagHighlighting();

    // SPA-ish re-render resilience: re-add button and re-apply tag highlighting
    const obs = new MutationObserver(() => {
      addButton();
      applyTagHighlighting();
    });
    obs.observe(document.body, { childList: true, subtree: true });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
})();
