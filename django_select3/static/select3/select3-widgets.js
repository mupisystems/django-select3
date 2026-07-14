/*
  Select3 Widgets JS (framework-free; no Alpine, no jQuery).
  ---------------------------------------------------------
  Contract:
  - Initializes elements with `data-select3`.
  - Uses hidden inputs for POST values (single: one hidden; multi: repeated hidden inputs).
  - AJAX endpoints return JSON like:
      { results: [{ id, text, ... }], pagination?: { more?: boolean }, next?: string|null, next_page?: number|null }
    If no pagination metadata is returned, widgets fall back to a length-based heuristic.

  Configuration (optional), set BEFORE this script loads:
    window.select3WidgetsConfig = {
      observe: false,            // disable the MutationObserver auto-init
      i18n: { noResults: '...' } // override any UI string (see I18N below)
    };
*/

(function () {
  const NS = (window.select3Widgets = window.select3Widgets || {});
  const CONFIG = (window.select3WidgetsConfig = window.select3WidgetsConfig || {});

  const I18N = Object.assign(
    {
      selectPlaceholder: 'Select an option',
      searchPlaceholder: 'Search...',
      multiPlaceholder: 'Type to search...',
      noResults: 'No results found',
      noOptions: 'No options available',
      searching: 'Searching...',
      minChars: 'Type at least {n} characters to search',
      loadingMore: 'Loading more...',
      scrollForMore: 'Scroll to load more...',
      remove: 'Remove',
      loading: 'Loading...',
    },
    CONFIG.i18n || {}
  );

  function t(key, vars) {
    let s = I18N[key] != null ? String(I18N[key]) : String(key);
    if (vars) {
      for (const k in vars) s = s.replace('{' + k + '}', String(vars[k]));
    }
    return s;
  }

  let listIdSeq = 0;

  function cssEscape(value) {
    if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
    return String(value).replace(/["\\\]]/g, '\\$&');
  }

  function parseJsonSafe(raw, fallback) {
    if (!raw) return fallback;
    try {
      return JSON.parse(raw);
    } catch {
      return fallback;
    }
  }

  function normalizeOptionsFromDal(data) {
    const results = data && data.results ? data.results : Array.isArray(data) ? data : [];
    return results
      .map((item) => ({
        value: String(item.id ?? item.value ?? ''),
        label: String(item.text ?? item.label ?? ''),
      }))
      .filter((o) => o.value !== '');
  }

  function getPaginationState(data, incomingCount, requestedPage, defaultPageSize) {
    const count = typeof incomingCount === 'number' ? incomingCount : 0;
    const page = typeof requestedPage === 'number' ? requestedPage : parseInt(String(requestedPage || '1'), 10) || 1;
    const pageSize =
      data && typeof data.page_size === 'number' && data.page_size > 0 && data.page_size < 1000
        ? data.page_size
        : typeof defaultPageSize === 'number' && defaultPageSize > 0
        ? defaultPageSize
        : 20;

    // 1) Explicit boolean flag.
    if (data && data.pagination && typeof data.pagination.more === 'boolean') {
      return { more: data.pagination.more, nextUrl: null, nextPage: null, pageSize };
    }
    // 2) DRF-style next URL.
    if (data && Object.prototype.hasOwnProperty.call(data, 'next')) {
      const nextUrl = typeof data.next === 'string' && data.next ? data.next : null;
      return { more: !!nextUrl, nextUrl, nextPage: null, pageSize };
    }
    // 3) Next page number.
    if (data && Object.prototype.hasOwnProperty.call(data, 'next_page')) {
      const nextPage = typeof data.next_page === 'number' ? data.next_page : null;
      return { more: typeof nextPage === 'number' && !Number.isNaN(nextPage), nextUrl: null, nextPage, pageSize };
    }
    // 4) Total pages.
    if (data && typeof data.page === 'number' && typeof data.total_pages === 'number') {
      return { more: data.page < data.total_pages, nextUrl: null, nextPage: null, pageSize };
    }
    // 5) Count-based.
    if (data && typeof data.count === 'number' && typeof data.page === 'number' && typeof data.page_size === 'number') {
      return { more: data.page * data.page_size < data.count, nextUrl: null, nextPage: null, pageSize };
    }
    // 6) Fallback heuristic: a "full page" implies there might be more.
    if (count <= 0) return { more: false, nextUrl: null, nextPage: null, pageSize };
    if (count < pageSize) return { more: false, nextUrl: null, nextPage: null, pageSize };
    return { more: true, nextUrl: null, nextPage: page + 1, pageSize };
  }

  function mergeUniqueByValue(existing, incoming) {
    const seen = new Set(existing.map((o) => String(o.value)));
    const out = existing.slice();
    for (const opt of incoming || []) {
      const v = String(opt && opt.value);
      if (!v || seen.has(v)) continue;
      seen.add(v);
      out.push(opt);
    }
    return out;
  }

  function isNearBottom(el, thresholdPx) {
    const th = typeof thresholdPx === 'number' ? thresholdPx : 40;
    return el.scrollTop + el.clientHeight >= el.scrollHeight - th;
  }

  function preserveScrollTop(scrollEl, fn) {
    const prev = scrollEl.scrollTop;
    fn();
    scrollEl.scrollTop = prev;
  }

  function calculateDropdownStyle(anchorEl, dropDirection) {
    const rect = anchorEl.getBoundingClientRect();
    const width = rect.width;
    const left = rect.left;
    if (dropDirection === 'up') {
      const bottom = window.innerHeight - rect.top + 4;
      return `width: ${width}px; left: ${left}px; bottom: ${bottom}px; top: auto;`;
    }
    const top = rect.bottom + 4;
    return `width: ${width}px; left: ${left}px; top: ${top}px; bottom: auto;`;
  }

  function chooseDropDirection(anchorEl, dropdownHeight) {
    const rect = anchorEl.getBoundingClientRect();
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    return spaceBelow < dropdownHeight && spaceAbove > spaceBelow ? 'up' : 'down';
  }

  // Reads the current value(s) of a forwarded field. Collects ALL matching
  // inputs (so multi-value parents forward an array, not just the first value).
  function buildForwardData(forwardConfig) {
    if (!forwardConfig) return null;
    const data = {};
    for (const [key, fieldName] of Object.entries(forwardConfig)) {
      const nodes = document.querySelectorAll(`[name="${cssEscape(fieldName)}"]`);
      const values = [];
      nodes.forEach((node) => {
        if (node && node.value != null && node.value !== '') values.push(node.value);
      });
      if (!values.length) continue;
      data[key] = values.length === 1 ? values[0] : values;
    }
    return Object.keys(data).length > 0 ? data : null;
  }

  function onClickOutside(targetEls, handler) {
    function listener(ev) {
      for (const el of targetEls) {
        if (el && el.contains(ev.target)) return;
      }
      handler(ev);
    }
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }

  function createDropdownPanel() {
    const panel = document.createElement('div');
    panel.className = 's3-panel';
    panel.style.display = 'none';
    const ul = document.createElement('ul');
    ul.className = 's3-list';
    ul.id = 's3-list-' + ++listIdSeq;
    ul.setAttribute('role', 'listbox');
    panel.appendChild(ul);
    return { panel, ul };
  }

  function setExpanded(inputEl, ul, open) {
    if (!inputEl) return;
    inputEl.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open && ul && ul.id) inputEl.setAttribute('aria-controls', ul.id);
  }

  function setHiddenValue(hiddenInput, value) {
    hiddenInput.value = value == null ? '' : String(value);
    hiddenInput.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function makeMessageLi(text) {
    const li = document.createElement('li');
    li.className = 's3-empty';
    li.textContent = text;
    return li;
  }

  const CHECK_SVG =
    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M5 13l4 4L19 7"></path></svg>';
  const X_SVG =
    '<svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="3" d="M6 18L18 6M6 6l12 12"></path></svg>';

  // A single-select option row (plain label).
  function buildSingleOption(opt, isSelected, onPick) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 's3-option';
    btn.setAttribute('role', 'option');
    if (isSelected) btn.setAttribute('aria-selected', 'true');
    const label = document.createElement('span');
    label.className = 's3-option-label';
    label.textContent = opt.label;
    btn.appendChild(label);
    btn.addEventListener('click', () => onPick(opt));
    li.appendChild(btn);
    return li;
  }

  // A multi-select option row (checkbox + label).
  function buildMultiOption(opt, checked, onToggle) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 's3-option' + (checked ? ' s3-option--checked' : '');
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-selected', checked ? 'true' : 'false');

    const box = document.createElement('span');
    box.className = 's3-checkbox' + (checked ? ' s3-checkbox--checked' : '');
    if (checked) box.innerHTML = CHECK_SVG;

    const label = document.createElement('span');
    label.className = 's3-option-label';
    label.textContent = opt.label;

    btn.appendChild(box);
    btn.appendChild(label);
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onToggle(opt);
    });
    li.appendChild(btn);
    return li;
  }

  function buildBadge(labelText, onRemove) {
    const badge = document.createElement('span');
    badge.className = 's3-badge';

    const text = document.createElement('span');
    text.className = 's3-badge-text';
    text.textContent = labelText;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 's3-badge-remove';
    btn.title = t('remove');
    btn.setAttribute('aria-label', t('remove'));
    btn.innerHTML = X_SVG;
    btn.addEventListener('click', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      onRemove();
    });

    badge.appendChild(text);
    badge.appendChild(btn);
    return badge;
  }

  function makeFooterFactory(ul) {
    function removeFooter() {
      const footer = ul.querySelector('[data-select3-footer]');
      if (footer) footer.remove();
    }
    function setFooter(text) {
      removeFooter();
      if (!text) return;
      const li = document.createElement('li');
      li.setAttribute('data-select3-footer', '1');
      li.className = 's3-footer';
      li.textContent = text;
      ul.appendChild(li);
    }
    return { removeFooter, setFooter };
  }

  /* ----------------------------- Combobox (static) ----------------------------- */

  function initComboboxStatic(root) {
    const hiddenInput = root.querySelector('[data-select3-hidden]');
    const searchInput = root.querySelector('[data-select3-input]');
    const display = root.querySelector('[data-select3-display]');
    const displayText = root.querySelector('[data-select3-display-text]');
    const clearBtn = root.querySelector('[data-select3-clear]');

    const placeholder = root.dataset.placeholder || t('selectPlaceholder');
    const allowClear = root.dataset.allowClear !== 'false';

    let options = [];
    const optionsElementId = root.dataset.optionsElementId || '';
    if (optionsElementId) {
      const el = document.getElementById(optionsElementId);
      if (el && el.textContent) options = parseJsonSafe(el.textContent, []);
    }
    if (!options.length) options = parseJsonSafe(root.dataset.optionsJson || '[]', []);

    let isOpen = false;
    let selected = hiddenInput.value ? String(hiddenInput.value) : '';
    let selectedLabel = '';
    const initial = options.find((o) => String(o.value) === selected);
    if (initial) selectedLabel = String(initial.label);

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      setExpanded(searchInput, ul, false);
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) displayText.textContent = selectedLabel;
      searchInput.value = '';
    }

    function open() {
      isOpen = true;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
      display.hidden = true;
      searchInput.hidden = false;
      searchInput.placeholder = placeholder;
      searchInput.focus();
      setExpanded(searchInput, ul, true);
      renderList(searchInput.value || '');
    }

    function renderList(q) {
      const qLower = (q || '').toLowerCase();
      const filtered = options.filter((o) => (o.label || '').toLowerCase().includes(qLower));
      ul.innerHTML = '';
      if (!filtered.length) {
        ul.appendChild(makeMessageLi(q ? t('noResults') : t('noOptions')));
        return;
      }
      for (const opt of filtered) {
        ul.appendChild(
          buildSingleOption(opt, String(opt.value) === selected, (picked) => {
            selected = String(picked.value);
            selectedLabel = String(picked.label);
            setHiddenValue(hiddenInput, selected);
            if (allowClear) clearBtn.hidden = !selected;
            close();
          })
        );
      }
    }

    function updateUIInitial() {
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) displayText.textContent = selectedLabel;
      clearBtn.hidden = !(allowClear && selected);
    }

    display.addEventListener('click', () => open());
    searchInput.addEventListener('focus', () => open());
    searchInput.addEventListener('input', () => renderList(searchInput.value));
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen) {
        ev.preventDefault();
        close();
      }
    });
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = '';
        selectedLabel = '';
        setHiddenValue(hiddenInput, '');
        updateUIInitial();
      });
    }

    root.addEventListener('combobox:set-value', (e) => {
      const { value, label } = e.detail || {};
      if (value === undefined) return;
      selected = String(value);
      selectedLabel = label || '';
      setHiddenValue(hiddenInput, selected);
      updateUIInitial();
      close();
    });

    const removeOutside = onClickOutside([display, searchInput, panel], () => close());
    const onReposition = () => {
      if (!isOpen) return;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      panel.remove();
    };

    updateUIInitial();
    root.removeAttribute('data-select3-cloak');
  }

  /* ----------------------------- Combobox (AJAX) ----------------------------- */

  function initComboboxAjax(root) {
    const hiddenInput = root.querySelector('[data-select3-hidden]');
    const searchInput = root.querySelector('[data-select3-input]');
    const display = root.querySelector('[data-select3-display]');
    const displayText = root.querySelector('[data-select3-display-text]');
    const clearBtn = root.querySelector('[data-select3-clear]');
    const spinner = root.querySelector('[data-select3-loading]');

    const placeholder = root.dataset.placeholder || t('searchPlaceholder');
    const allowClear = root.dataset.allowClear !== 'false';
    const ajaxUrl = root.dataset.ajaxUrl || '';
    const minSearchLength = parseInt(root.dataset.minSearchLength || '0', 10);
    const forwardConfig = parseJsonSafe(root.dataset.forwardJson || '', null);
    const initialLabel = root.dataset.initialLabel || '';

    let isOpen = false;
    let selected = hiddenInput.value ? String(hiddenInput.value) : '';
    let selectedLabel = selected ? initialLabel : '';
    let debounceTimer = null;
    let loading = false;
    let filteredOptions = [];
    let page = 1;
    let more = false;
    let nextPage = null;
    let nextUrl = null;
    let lastQuery = '';

    const { panel, ul } = createDropdownPanel();
    ul.style.maxHeight = '200px';
    document.body.appendChild(panel);
    const { removeFooter, setFooter } = makeFooterFactory(ul);

    function setLoading(v) {
      loading = v;
      if (spinner) spinner.hidden = !v;
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      setExpanded(searchInput, ul, false);
      display.hidden = !(selected && !isOpen);
      searchInput.hidden = !!(selected && !isOpen);
      if (selected && !isOpen) displayText.textContent = selectedLabel;
      clearBtn.hidden = !(allowClear && selected && !loading);
    }

    function pickOption(opt) {
      selected = String(opt.value);
      selectedLabel = String(opt.label);
      setHiddenValue(hiddenInput, selected);
      clearBtn.hidden = !(allowClear && selected && !loading);
      searchInput.value = '';
      close();
    }

    function renderListEmptyState() {
      ul.innerHTML = '';
      if (loading) {
        ul.appendChild(makeMessageLi(t('searching')));
        return;
      }
      const q = searchInput.value || '';
      if (minSearchLength > 0 && q.length < minSearchLength) {
        ul.appendChild(makeMessageLi(t('minChars', { n: minSearchLength })));
        return;
      }
      if (!filteredOptions.length) {
        ul.appendChild(makeMessageLi(q ? t('noResults') : t('noOptions')));
        return;
      }
      for (const opt of filteredOptions) {
        ul.appendChild(buildSingleOption(opt, String(opt.value) === selected, pickOption));
      }
      setFooter(more ? t('scrollForMore') : '');
    }

    async function loadOptions(opts) {
      const q = searchInput.value || '';
      if (q.length < minSearchLength && minSearchLength > 0) {
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
        renderListEmptyState();
        return;
      }

      const requestedPage = opts && opts.page ? opts.page : 1;
      const requestedUrl = opts && opts.url ? String(opts.url) : '';
      const append = !!(opts && opts.append);
      if (append && loading) return;

      setLoading(true);
      if (!append) {
        filteredOptions = [];
        page = 1;
        more = false;
        nextPage = null;
        nextUrl = null;
        removeFooter();
      } else {
        preserveScrollTop(ul, () => setFooter(t('loadingMore')));
      }
      try {
        let url = requestedUrl;
        if (!url) {
          url = `${ajaxUrl}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(String(requestedPage))}`;
          const forwardData = buildForwardData(forwardConfig);
          if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        const incoming = normalizeOptionsFromDal(data);
        if (append) {
          const beforeLen = filteredOptions.length;
          filteredOptions = mergeUniqueByValue(filteredOptions, incoming);
          const newUnique = filteredOptions.slice(beforeLen);
          preserveScrollTop(ul, () => {
            removeFooter();
            for (const opt of newUnique) {
              ul.appendChild(buildSingleOption(opt, String(opt.value) === selected, pickOption));
            }
          });
        } else {
          filteredOptions = incoming;
        }
        page = requestedPage;
        const state = getPaginationState(data, incoming.length, requestedPage, 20);
        more = !!state.more;
        nextPage = state.nextPage;
        nextUrl = state.nextUrl;
      } catch (e) {
        console.error('select3Widgets comboboxAjax fetch error', e);
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
      }
      setLoading(false);

      if (append) {
        preserveScrollTop(ul, () => setFooter(more ? t('scrollForMore') : ''));
      } else {
        renderListEmptyState();
        ul.scrollTop = 0;
      }
    }

    function open() {
      isOpen = true;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
      display.hidden = true;
      searchInput.hidden = false;
      searchInput.placeholder = placeholder;
      searchInput.focus();
      setExpanded(searchInput, ul, true);
      renderListEmptyState();
      if (minSearchLength === 0) {
        lastQuery = searchInput.value || '';
        loadOptions({ page: 1, append: false });
      }
    }

    function debounceSearch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastQuery = searchInput.value || '';
        loadOptions({ page: 1, append: false });
      }, 300);
    }

    display.hidden = !(selected && !isOpen);
    searchInput.hidden = !!(selected && !isOpen);
    if (selected && !isOpen) displayText.textContent = selectedLabel;
    clearBtn.hidden = !(allowClear && selected);
    if (spinner) spinner.hidden = true;

    display.addEventListener('click', () => open());
    searchInput.addEventListener('focus', () => open());
    searchInput.addEventListener('input', () => debounceSearch());
    searchInput.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen) {
        ev.preventDefault();
        close();
      }
    });

    ul.addEventListener('scroll', () => {
      const q = searchInput.value || '';
      if (!isOpen || loading || !more) return;
      if (minSearchLength > 0 && q.length < minSearchLength) return;
      if ((lastQuery || '') !== q) return;
      if (!isNearBottom(ul, 40)) return;
      if (nextUrl) loadOptions({ url: nextUrl, page: (page || 1) + 1, append: true });
      else if (typeof nextPage === 'number') loadOptions({ page: nextPage, append: true });
      else loadOptions({ page: (page || 1) + 1, append: true });
    });

    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = '';
        selectedLabel = '';
        setHiddenValue(hiddenInput, '');
        display.hidden = true;
        searchInput.hidden = false;
        clearBtn.hidden = true;
      });
    }

    root.addEventListener('combobox:set-value', (e) => {
      const { value, label } = e.detail || {};
      if (value === undefined) return;
      selected = String(value);
      selectedLabel = label || '';
      setHiddenValue(hiddenInput, selected);
      displayText.textContent = selectedLabel;
      close();
    });

    const removeOutside = onClickOutside([display, searchInput, panel], () => close());
    const onReposition = () => {
      if (!isOpen) return;
      const anchor = searchInput.hidden ? display : searchInput;
      const dir = chooseDropDirection(anchor, 280);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  /* ----------------------------- MultiSelect (static) ----------------------------- */

  function initMultiselectStatic(root) {
    const hiddenContainer = root.querySelector('[data-select3-hidden-container]');
    const input = root.querySelector('[data-select3-input]');
    const badges = root.querySelector('[data-select3-badges]');
    const clearBtn = root.querySelector('[data-select3-clear]');

    const name = root.dataset.name || '';
    const placeholder = root.dataset.placeholder || t('multiPlaceholder');
    const allowClear = root.dataset.allowClear !== 'false';

    const options = parseJsonSafe(root.dataset.optionsJson || '[]', []);
    let selected = parseJsonSafe(root.dataset.values || '[]', []).map(String);
    let isOpen = false;

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);

    function syncHiddenInputs() {
      hiddenContainer.innerHTML = '';
      for (const id of selected) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = id;
        hiddenContainer.appendChild(inp);
      }
      const first = hiddenContainer.querySelector('input[type="hidden"]');
      if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function renderBadges() {
      badges.innerHTML = '';
      for (const id of selected) {
        const opt = options.find((o) => String(o.value) === String(id));
        badges.appendChild(
          buildBadge(opt ? opt.label : 'Item', () => {
            selected = selected.filter((x) => x !== String(id));
            syncHiddenInputs();
            renderBadges();
            renderList(input.value || '');
            updatePlaceholder();
          })
        );
      }
    }

    function updatePlaceholder() {
      input.placeholder = placeholder;
      clearBtn.hidden = !(allowClear && selected.length > 0);
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      setExpanded(input, ul, false);
      updatePlaceholder();
    }

    function open() {
      isOpen = true;
      const anchor = root.querySelector('[data-select3-anchor]') || root;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
      updatePlaceholder();
      input.focus();
      setExpanded(input, ul, true);
      renderList(input.value || '');
    }

    function toggle(opt) {
      const v = String(opt.value);
      if (selected.includes(v)) selected = selected.filter((x) => x !== v);
      else selected = [...selected, v];
      syncHiddenInputs();
      renderBadges();
      renderList(input.value || '');
      updatePlaceholder();
    }

    function renderList(q) {
      const qLower = (q || '').toLowerCase();
      const filtered = options.filter((o) => (o.label || '').toLowerCase().includes(qLower));
      ul.innerHTML = '';
      if (!filtered.length) {
        ul.appendChild(makeMessageLi(q ? t('noResults') : t('noOptions')));
        return;
      }
      for (const opt of filtered) {
        ul.appendChild(buildMultiOption(opt, selected.includes(String(opt.value)), toggle));
      }
    }

    input.placeholder = placeholder;
    renderBadges();
    syncHiddenInputs();
    updatePlaceholder();

    const anchor = root.querySelector('[data-select3-anchor]') || root;
    anchor.addEventListener('click', () => {
      if (!isOpen) open();
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('focus', () => open());
    input.addEventListener('input', () => renderList(input.value || ''));
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen) {
        ev.preventDefault();
        close();
      }
    });
    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = [];
        syncHiddenInputs();
        renderBadges();
        renderList(input.value || '');
        updatePlaceholder();
      });
    }

    const removeOutside = onClickOutside([anchor, panel], () => close());
    const onReposition = () => {
      if (!isOpen) return;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  /* ----------------------------- MultiSelect (AJAX) ----------------------------- */

  function initMultiselectAjax(root) {
    const hiddenContainer = root.querySelector('[data-select3-hidden-container]');
    const input = root.querySelector('[data-select3-input]');
    const badges = root.querySelector('[data-select3-badges]');
    const clearBtn = root.querySelector('[data-select3-clear]');
    const spinner = root.querySelector('[data-select3-loading]');

    const name = root.dataset.name || '';
    const placeholder = root.dataset.placeholder || t('multiPlaceholder');
    const allowClear = root.dataset.allowClear !== 'false';
    const ajaxUrl = root.dataset.ajaxUrl || '';
    const minSearchLength = parseInt(root.dataset.minSearchLength || '2', 10);
    const forwardConfig = parseJsonSafe(root.dataset.forwardJson || '', null);

    let selected = parseJsonSafe(root.dataset.values || '[]', []).map(String);
    let selectedOptions = {};
    let filteredOptions = [];
    let isOpen = false;
    let loading = false;
    let debounceTimer = null;
    let page = 1;
    let more = false;
    let nextPage = null;
    let nextUrl = null;
    let lastQuery = '';

    const { panel, ul } = createDropdownPanel();
    document.body.appendChild(panel);
    const { removeFooter, setFooter } = makeFooterFactory(ul);

    function setLoading(v) {
      loading = v;
      if (spinner) spinner.hidden = !v;
    }

    function syncHiddenInputs() {
      hiddenContainer.innerHTML = '';
      for (const id of selected) {
        const inp = document.createElement('input');
        inp.type = 'hidden';
        inp.name = name;
        inp.value = id;
        hiddenContainer.appendChild(inp);
      }
      const first = hiddenContainer.querySelector('input[type="hidden"]');
      if (first) first.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function getSelectedOption(id) {
      return selectedOptions[String(id)] || null;
    }

    function renderBadges() {
      badges.innerHTML = '';
      for (const id of selected) {
        const opt = getSelectedOption(id);
        badges.appendChild(
          buildBadge(opt ? opt.label : t('loading'), () => {
            selected = selected.filter((x) => x !== String(id));
            syncHiddenInputs();
            renderBadges();
            renderList({ preserveScroll: true });
            updateUI();
          })
        );
      }
    }

    function updateUI() {
      clearBtn.hidden = !(allowClear && selected.length > 0 && !loading);
    }

    function close() {
      isOpen = false;
      panel.style.display = 'none';
      setExpanded(input, ul, false);
      updateUI();
    }

    function open() {
      isOpen = true;
      const anchor = root.querySelector('[data-select3-anchor]') || root;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
      input.focus();
      setExpanded(input, ul, true);
      renderList();
      updateUI();
    }

    function toggle(opt) {
      const v = String(opt.value);
      if (selected.includes(v)) selected = selected.filter((x) => x !== v);
      else selected = [...selected, v];
      selectedOptions[v] = opt;
      syncHiddenInputs();
      renderBadges();
      renderList({ preserveScroll: true });
      updateUI();
    }

    function renderList(opts) {
      const preserveScroll = !!(opts && opts.preserveScroll);
      const prevScrollTop = preserveScroll ? ul.scrollTop : 0;
      ul.innerHTML = '';
      const q = input.value || '';
      if (loading) {
        ul.appendChild(makeMessageLi(t('searching')));
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      if (q.length < minSearchLength && !filteredOptions.length) {
        ul.appendChild(makeMessageLi(t('minChars', { n: minSearchLength })));
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      if (!filteredOptions.length) {
        ul.appendChild(makeMessageLi(t('noResults')));
        if (preserveScroll) ul.scrollTop = prevScrollTop;
        return;
      }
      for (const opt of filteredOptions) {
        ul.appendChild(buildMultiOption(opt, selected.includes(String(opt.value)), toggle));
      }
      setFooter(more ? t('scrollForMore') : '');
      if (preserveScroll) ul.scrollTop = prevScrollTop;
    }

    async function loadOptions(opts) {
      const q = input.value || '';
      if (q.length < minSearchLength) {
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
        renderList();
        return;
      }

      const requestedPage = opts && opts.page ? opts.page : 1;
      const requestedUrl = opts && opts.url ? String(opts.url) : '';
      const append = !!(opts && opts.append);
      if (append && loading) return;

      setLoading(true);
      if (!append) {
        filteredOptions = [];
        page = 1;
        more = false;
        nextPage = null;
        nextUrl = null;
        removeFooter();
      } else {
        preserveScrollTop(ul, () => setFooter(t('loadingMore')));
      }
      try {
        let url = requestedUrl;
        if (!url) {
          url = `${ajaxUrl}?q=${encodeURIComponent(q)}&page=${encodeURIComponent(String(requestedPage))}`;
          const forwardData = buildForwardData(forwardConfig);
          if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        }
        const res = await fetch(url);
        const data = await res.json();
        const incoming = normalizeOptionsFromDal(data);
        if (append) {
          const beforeLen = filteredOptions.length;
          filteredOptions = mergeUniqueByValue(filteredOptions, incoming);
          const newUnique = filteredOptions.slice(beforeLen);
          preserveScrollTop(ul, () => {
            removeFooter();
            for (const opt of newUnique) {
              ul.appendChild(buildMultiOption(opt, selected.includes(String(opt.value)), toggle));
            }
          });
        } else {
          filteredOptions = incoming;
        }
        page = requestedPage;
        const state = getPaginationState(data, incoming.length, requestedPage, 20);
        more = !!state.more;
        nextPage = state.nextPage;
        nextUrl = state.nextUrl;
      } catch (e) {
        console.error('select3Widgets multiselectAjax fetch error', e);
        filteredOptions = [];
        more = false;
        page = 1;
        nextPage = null;
        nextUrl = null;
      }
      setLoading(false);

      if (append) {
        preserveScrollTop(ul, () => setFooter(more ? t('scrollForMore') : ''));
      } else {
        renderList();
        ul.scrollTop = 0;
      }
      updateUI();
    }

    async function resolveSelectedLabels() {
      if (!selected.length) return;
      try {
        let url = `${ajaxUrl}?q=`;
        const forwardData = buildForwardData(forwardConfig);
        if (forwardData) url += `&forward=${encodeURIComponent(JSON.stringify(forwardData))}`;
        const res = await fetch(url);
        const data = await res.json();
        const opts = normalizeOptionsFromDal(data);
        for (const opt of opts) {
          if (selected.includes(String(opt.value))) selectedOptions[String(opt.value)] = opt;
        }
      } catch {
        // ignore
      }
      renderBadges();
    }

    function debounceSearch() {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        lastQuery = input.value || '';
        loadOptions({ page: 1, append: false });
      }, 300);
    }

    if (spinner) spinner.hidden = true;
    input.placeholder = placeholder;
    syncHiddenInputs();
    resolveSelectedLabels();
    renderBadges();
    updateUI();

    const anchor = root.querySelector('[data-select3-anchor]') || root;
    anchor.addEventListener('click', () => {
      if (!isOpen) open();
    });
    input.addEventListener('click', (ev) => ev.stopPropagation());
    input.addEventListener('focus', () => open());
    input.addEventListener('input', () => debounceSearch());
    input.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && isOpen) {
        ev.preventDefault();
        close();
      }
    });

    ul.addEventListener('scroll', () => {
      const q = input.value || '';
      if (!isOpen || loading || !more) return;
      if (q.length < minSearchLength) return;
      if ((lastQuery || '') !== q) return;
      if (!isNearBottom(ul, 40)) return;
      if (nextUrl) loadOptions({ url: nextUrl, page: (page || 1) + 1, append: true });
      else if (typeof nextPage === 'number') loadOptions({ page: nextPage, append: true });
      else loadOptions({ page: (page || 1) + 1, append: true });
    });

    if (allowClear) {
      clearBtn.addEventListener('click', (ev) => {
        ev.preventDefault();
        ev.stopPropagation();
        selected = [];
        syncHiddenInputs();
        renderBadges();
        filteredOptions = [];
        renderList();
        updateUI();
      });
    }

    const removeOutside = onClickOutside([anchor, panel], () => close());
    const onReposition = () => {
      if (!isOpen) return;
      const dir = chooseDropDirection(anchor, 320);
      panel.setAttribute('style', calculateDropdownStyle(anchor, dir) + ' display: block;');
    };
    window.addEventListener('resize', onReposition);
    window.addEventListener('scroll', onReposition, true);

    root._select3Cleanup = () => {
      removeOutside();
      window.removeEventListener('resize', onReposition);
      window.removeEventListener('scroll', onReposition, true);
      panel.remove();
    };

    root.removeAttribute('data-select3-cloak');
  }

  /* ----------------------------- Bootstrap ----------------------------- */

  function initRoot(root) {
    const kind = root.dataset.select3;
    if (kind === 'combobox') return initComboboxStatic(root);
    if (kind === 'combobox-ajax') return initComboboxAjax(root);
    if (kind === 'multiselect') return initMultiselectStatic(root);
    if (kind === 'multiselect-ajax') return initMultiselectAjax(root);
  }

  function destroyRoot(root) {
    try {
      if (root && typeof root._select3Cleanup === 'function') root._select3Cleanup();
    } catch (e) {
      console.error('select3Widgets destroy error', e);
    } finally {
      if (root) {
        root._select3Cleanup = null;
        root._select3Initialized = false;
      }
    }
  }

  function collectRoots(container) {
    const scope = container || document;
    const roots = [];
    if (scope && scope.nodeType === 1 && scope.matches && scope.matches('[data-select3]')) roots.push(scope);
    if (scope && scope.querySelectorAll) scope.querySelectorAll('[data-select3]').forEach((el) => roots.push(el));
    return roots;
  }

  function initAll(container) {
    collectRoots(container).forEach((el) => {
      try {
        if (el._select3Initialized) return;
        el._select3Initialized = true;
        initRoot(el);
      } catch (e) {
        console.error('select3Widgets init error', e);
      }
    });
  }

  function destroyAll(container) {
    collectRoots(container).forEach((el) => {
      if (el && el._select3Initialized) destroyRoot(el);
    });
  }

  NS.initAll = initAll;
  NS.destroyAll = destroyAll;
  NS.destroy = destroyRoot;

  function startObserver() {
    if (CONFIG.observe === false) return null;
    if (!document.body || !window.MutationObserver) return null;

    const observer = new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.removedNodes && m.removedNodes.length) {
          m.removedNodes.forEach((n) => {
            if (!n || n.nodeType !== 1) return;
            if (n.matches && n.matches('[data-select3]')) destroyAll(n);
            else if (n.querySelectorAll && n.querySelectorAll('[data-select3]').length) destroyAll(n);
          });
        }
        if (m.addedNodes && m.addedNodes.length) {
          m.addedNodes.forEach((n) => {
            if (!n || n.nodeType !== 1) return;
            if (n.matches && n.matches('[data-select3]')) initAll(n);
            else if (n.querySelectorAll && n.querySelectorAll('[data-select3]').length) initAll(n);
          });
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    return observer;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      initAll(document);
      startObserver();
    });
  } else {
    initAll(document);
    startObserver();
  }
})();
