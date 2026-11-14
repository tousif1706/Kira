(function () {
  const DEFAULT_STARTER_CODE = {
    Python: `def add(a, b):\n    return a+b\n`,
    'C++': `int add(int a, int b) {\n    return a+b;\n}\n`,
    Java: `public class Main {\n    public static int add(int a, int b) {\n        return a+b;\n    }\n}\n`,
  };

  const PRESETS = {
    'py-default': {
      language: 'Python',
      code: DEFAULT_STARTER_CODE.Python,
    },
    'py-invoice': {
      language: 'Python',
      code: `def calculate_order_total(items, discount_code, tax_rate=0.08):\n    total = 0\n    for i in range(len(items)):\n        item = items[i]\n        if item["price"] > 0:\n            total = total + item["price"] * item["qty"]\n    if discount_code == "SAVE20":\n        total = total - (total * 0.2)\n    elif discount_code == "FLAT50":\n        total = total - 50\n    if total == 0:\n        return 0\n    final_price = total + (total * tax_rate)\n    return round(final_price, 2)\n`,
    },
    'cpp-search': {
      language: 'C++',
      code: `#include <vector>\nusing namespace std;\n\nint binarySearch(vector<int> arr, int target) {\n    int left = 0;\n    int right = arr.size();\n    while (left <= right) {\n        int mid = (left + right) / 2;\n        if (arr[mid] == target) {\n            return mid;\n        } else if (arr[mid] < target) {\n            left = mid + 1;\n        } else {\n            right = mid - 1;\n        }\n    }\n    return -1;\n}\n`,
    },
    'java-cache': {
      language: 'Java',
      code: `import java.util.*;\n\npublic class SessionManager {\n    private Map<String, String> sessions = new HashMap<>();\n\n    public String getUserRole(String token) {\n        String user = sessions.get(token);\n        if (user.equals("admin")) {\n            return "FULL_ACCESS";\n        } else if (user.equals("editor")) {\n            return "WRITE_ACCESS";\n        }\n        return "READ_ONLY";\n    }\n\n    public void addSession(String token, String role) {\n        if (token != "" && role != null) {\n            sessions.put(token, role);\n        }\n    }\n}\n`,
    },
  };

  const state = {
    language: 'Python',
    code: DEFAULT_STARTER_CODE.Python,
    review: null,
    complexity: null,
    isLoading: false,
    error: null,
    activeTab: 'bugs',
    expandedBugIndex: 0,
    highlightedLine: null,
  };

  // DOM Elements
  const languageButtons = Array.from(document.querySelectorAll('#language-selector .lang-btn'));
  const heroLanguageEl = document.getElementById('hero-active-language');
  const editorMetaEl = document.getElementById('editor-meta');
  const presetSelect = document.getElementById('preset-select');
  const codeTextarea = document.getElementById('code-textarea');
  const lineGutter = document.getElementById('line-gutter');
  const copyCodeBtn = document.getElementById('copy-code-btn');
  const clearResultsBtn = document.getElementById('clear-results-btn');
  const runReviewBtn = document.getElementById('run-review-btn');
  const topbarReviewBtn = document.getElementById('topbar-review-btn');
  const navLoadExampleBtn = document.getElementById('nav-load-example');
  const resultsPanel = document.getElementById('results-panel');

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function parseFirstLineNumber(lineText) {
    const match = String(lineText ?? '').match(/\d+/);
    return match ? Number(match[0]) : null;
  }

  function getScoreMeta(score) {
    if (score >= 8) {
      return {
        label: 'Healthy',
        textClass: 'text-green',
        barClass: 'bg-green',
        summary: 'This code is in great shape with strong clarity and low defect risk.',
      };
    }
    if (score >= 5) {
      return {
        label: 'Needs Improvement',
        textClass: 'text-amber',
        barClass: 'bg-amber',
        summary:
          'Decent foundation, but addressing the flagged bugs and suggestions will improve reliability.',
      };
    }
    return {
      label: 'Critical Attention',
      textClass: 'text-red',
      barClass: 'bg-red',
      summary:
        'Significant defects or structural risks were detected that should be resolved before shipping.',
    };
  }

  function getSeverityMeta(severity) {
    switch (severity) {
      case 'critical':
        return { label: 'Critical', textClass: 'text-red' };
      case 'high':
        return { label: 'High', textClass: 'text-red' };
      case 'medium':
        return { label: 'Medium', textClass: 'text-amber' };
      case 'low':
        return { label: 'Low', textClass: 'text-sky' };
      default:
        return { label: 'Info', textClass: 'text-muted' };
    }
  }

  function renderGutterAndMeta() {
    const lines = state.code.split(/\r?\n/);
    const lineCount = lines.length;
    const charCount = state.code.length;

    editorMetaEl.textContent = `${state.language} · ${lineCount} ${
      lineCount === 1 ? 'line' : 'lines'
    } · ${charCount} chars`;

    let gutterHtml = '';
    for (let i = 1; i <= lineCount; i++) {
      const cls = state.highlightedLine === i ? 'gutter-line is-highlighted' : 'gutter-line';
      gutterHtml += `<div class="${cls}">${i}</div>`;
    }
    lineGutter.innerHTML = gutterHtml;
  }

  function updateLanguageUI() {
    heroLanguageEl.textContent = state.language;
    languageButtons.forEach((btn) => {
      const isSelected = btn.getAttribute('data-lang') === state.language;
      btn.classList.toggle('is-selected', isSelected);
      btn.setAttribute('aria-checked', String(isSelected));
    });
    renderGutterAndMeta();
  }

  function updateButtonsState() {
    const hasOutput = Boolean(state.review || state.error);
    clearResultsBtn.classList.toggle('hidden', !hasOutput);
    clearResultsBtn.disabled = state.isLoading;
    runReviewBtn.disabled = state.isLoading;
    topbarReviewBtn.disabled = state.isLoading;
    runReviewBtn.textContent = state.isLoading ? 'Reviewing Code...' : 'Review Code';
    topbarReviewBtn.textContent = state.isLoading ? 'Reviewing...' : 'Review Code';
  }

  function renderBugsTab(bugs) {
    if (!bugs.length) {
      return `
        <div class="bugs-clean-box">
          <div class="bugs-clean-title">No bugs found. Nice and clean.</div>
          <div class="bugs-clean-desc">
            No runtime defects, bounds issues, or logic errors were detected in this snippet.
          </div>
        </div>
      `;
    }

    const itemsHtml = bugs
      .map((bug, idx) => {
        const sev = getSeverityMeta(bug.severity);
        const isOpen = state.expandedBugIndex === idx;
        return `
          <div class="accordion-item">
            <button
              type="button"
              class="accordion-trigger"
              data-bug-index="${idx}"
              aria-expanded="${isOpen}"
            >
              <div>
                <div class="accordion-title">${escapeHtml(bug.title)}</div>
                <div class="accordion-meta tabular-nums">
                  Line ${escapeHtml(bug.line)} · <span class="${sev.textClass}">${sev.label}</span>
                </div>
              </div>
              <span class="accordion-chevron">${isOpen ? '▲' : '▼'}</span>
            </button>
            ${
              isOpen
                ? `
              <div class="accordion-body">
                <p class="accordion-desc">${escapeHtml(bug.description)}</p>
                ${
                  bug.fix
                    ? `
                  <div class="fix-box">
                    <span class="fix-label">Suggested Fix</span>
                    <div class="fix-text">${escapeHtml(bug.fix)}</div>
                  </div>
                `
                    : ''
                }
              </div>
            `
                : ''
            }
          </div>
        `;
      })
      .join('');

    return `<div class="accordion-list">${itemsHtml}</div>`;
  }

  function renderImprovementsTab(improvements) {
    if (!improvements.length) {
      return `<p class="error-message">No specific improvements suggested for this snippet.</p>`;
    }

    return improvements
      .map(
        (item) => `
      <div class="improvement-item">
        <div class="improvement-head">
          <h3 class="improvement-title">${escapeHtml(item.title)}</h3>
          <span class="improvement-cat">${escapeHtml(item.category)}</span>
        </div>
        <p class="improvement-desc">${escapeHtml(item.description)}</p>
        ${
          item.suggestion
            ? `<pre class="improvement-code">${escapeHtml(item.suggestion)}</pre>`
            : ''
        }
      </div>
    `
      )
      .join('');
  }

  function renderComplexityTab(complexity, review) {
    if (!complexity) return '';

    const rowsHtml = (complexity.details || [])
      .map(
        (row) => `
      <tr>
        <td class="mono">${escapeHtml(row.name)}</td>
        <td class="mono tabular-nums text-right">${escapeHtml(row.line)}</td>
        <td class="mono tabular-nums text-right">${escapeHtml(row.complexity)}</td>
        <td class="mono tabular-nums text-right">${escapeHtml(row.nesting)}</td>
        <td class="mono tabular-nums text-right">${escapeHtml(row.rank)}</td>
      </tr>
    `
      )
      .join('');

    return `
      <div class="metrics-grid tabular-nums">
        <div class="metric-tile">
          <span class="metric-tile-label">Method</span>
          <span class="metric-tile-value">${escapeHtml(complexity.method)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-tile-label">Avg. Complexity</span>
          <span class="metric-tile-value">${escapeHtml(complexity.average_complexity)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-tile-label">Rating</span>
          <span class="metric-tile-value">${escapeHtml(complexity.rating)}</span>
        </div>
        <div class="metric-tile">
          <span class="metric-tile-label">Maintainability</span>
          <span class="metric-tile-value">${escapeHtml(complexity.maintainability_index)}/100</span>
        </div>
      </div>

      ${
        rowsHtml
          ? `
        <div>
          <div class="subblock-title">Function Breakdown</div>
          <div class="table-wrapper">
            <table class="data-table compact">
              <thead>
                <tr>
                  <th>Block / Function</th>
                  <th class="text-right">Line</th>
                  <th class="text-right">Cyclomatic</th>
                  <th class="text-right">Nesting</th>
                  <th class="text-right">Rank</th>
                </tr>
              </thead>
              <tbody>${rowsHtml}</tbody>
            </table>
          </div>
        </div>
      `
          : ''
      }

      ${
        review.complexity_notes
          ? `
        <div class="complexity-notes">
          <div class="subblock-title">AI Complexity Notes</div>
          <p>${escapeHtml(review.complexity_notes)}</p>
        </div>
      `
          : ''
      }
    `;
  }

  function renderScoreTab(review, complexity) {
    const score = Number(review.overall_score ?? 0);
    const meta = getScoreMeta(score);
    const pct = Math.min(100, Math.max(0, score * 10));
    const loc = complexity?.loc ?? state.code.split(/\r?\n/).length;

    return `
      <div>
        <span class="metric-tile-label">Overall Code Health</span>
        <h3 class="score-heading tabular-nums">
          ${score}/10 <span class="score-heading-sub">— ${meta.label}</span>
        </h3>
        <div class="progress-track">
          <div class="progress-fill ${meta.barClass}" style="width: ${pct}%"></div>
        </div>
      </div>

      <div class="score-status-box">
        <div class="score-status-label ${meta.textClass}">${meta.label}</div>
        <p class="score-status-desc">${meta.summary}</p>
      </div>

      <div class="score-stats-row tabular-nums">
        <div>
          <span class="metric-tile-label">Bugs Detected</span>
          <span class="metric-tile-value">${(review.bugs || []).length}</span>
        </div>
        <div>
          <span class="metric-tile-label">Suggestions</span>
          <span class="metric-tile-value">${(review.improvements || []).length}</span>
        </div>
        <div>
          <span class="metric-tile-label">Lines Reviewed</span>
          <span class="metric-tile-value">${loc}</span>
        </div>
      </div>
    `;
  }

  function renderVerticalCodeLines(codeText) {
    const lines = String(codeText ?? '').split(/\r?\n/);
    return lines
      .map(
        (line, index) =>
          `<div class="diff-code-line"><span class="diff-line-num tabular-nums">${index + 1}</span><span class="diff-line-text">${line.length ? escapeHtml(line) : ' '}</span></div>`
      )
      .join('');
  }

  function renderDiffTab(review) {
    if (!review.improved_code) {
      return `<p class="error-message">No improved version was returned for this code.</p>`;
    }

    return `
      <div class="diff-toolbar">
        <span class="results-empty-lang">Before / After comparison (${escapeHtml(state.language)})</span>
        <div class="panel-controls">
          <button type="button" id="copy-improved-btn" class="btn btn-outline btn-xs">
            Copy Improved
          </button>
          <button type="button" id="apply-improved-btn" class="btn btn-primary btn-xs">
            Apply to Editor
          </button>
        </div>
      </div>

      <div class="diff-grid">
        <div class="diff-pane">
          <div class="diff-pane-header">Original</div>
          <div class="diff-pre mono">${renderVerticalCodeLines(state.code)}</div>
        </div>
        <div class="diff-pane is-improved">
          <div class="diff-pane-header">AI-Improved</div>
          <div class="diff-pre mono">${renderVerticalCodeLines(review.improved_code)}</div>
        </div>
      </div>
    `;
  }

  function renderResults() {
    updateButtonsState();

    if (state.isLoading) {
      resultsPanel.innerHTML = `
        <div class="results-loading">
          <div class="skeleton" style="height: 22px; width: 160px;"></div>
          <div class="skeleton" style="height: 64px; width: 100%;"></div>
          <div class="skeleton" style="height: 36px; width: 100%;"></div>
          <div class="skeleton" style="height: 82px; width: 100%;"></div>
          <div class="skeleton" style="height: 82px; width: 100%;"></div>
        </div>
      `;
      return;
    }

    if (state.error) {
      resultsPanel.innerHTML = `
        <div class="results-error">
          <h2 class="error-title">Review could not complete</h2>
          <p class="error-message">${escapeHtml(state.error)}</p>
          <div>
            <button type="button" id="retry-review-btn" class="btn btn-primary btn-md">
              Try Again
            </button>
          </div>
        </div>
      `;
      document.getElementById('retry-review-btn')?.addEventListener('click', runReview);
      return;
    }

    if (!state.review) {
      resultsPanel.innerHTML = `
        <div class="results-empty">
          <div>
            <h2>Review Results</h2>
            <p>
              Paste your code in the editor and click <strong>Review Code</strong> to run a full inspection across five modules.
            </p>
            <div class="module-list">
              <div class="module-row">
                <span class="module-name">01. Bugs &amp; Edge Cases</span>
                <span class="module-desc">Pinpoints line-level logic defects and boundary risks.</span>
              </div>
              <div class="module-row">
                <span class="module-name">02. Refactoring Improvements</span>
                <span class="module-desc">Actionable suggestions for readability and safety.</span>
              </div>
              <div class="module-row">
                <span class="module-name">03. Cyclomatic Complexity</span>
                <span class="module-desc">Function branch count, nesting depth, and maintainability.</span>
              </div>
              <div class="module-row">
                <span class="module-name">04. Overall Health Score</span>
                <span class="module-desc">Clear 0–10 code health rating paired with justification.</span>
              </div>
              <div class="module-row">
                <span class="module-name">05. Before / After Diff</span>
                <span class="module-desc">Side-by-side comparison with one-click apply to editor.</span>
              </div>
            </div>
          </div>

          <div class="results-empty-footer">
            <span class="results-empty-lang">Active language: ${escapeHtml(state.language)}</span>
            <button type="button" id="empty-review-btn" class="btn btn-outline btn-md">
              Review Current Code
            </button>
          </div>
        </div>
      `;
      document.getElementById('empty-review-btn')?.addEventListener('click', runReview);
      return;
    }

    const review = state.review;
    const complexity = state.complexity;
    const scoreMeta = getScoreMeta(review.overall_score);
    const bugs = review.bugs || [];
    const improvements = review.improvements || [];

    const tabs = [
      { id: 'bugs', label: `Bugs (${bugs.length})` },
      { id: 'improvements', label: `Improvements (${improvements.length})` },
      { id: 'complexity', label: 'Complexity' },
      { id: 'score', label: `Score (${review.overall_score}/10)` },
      { id: 'diff', label: 'Before / After' },
    ];

    let activeBodyHtml = '';
    if (state.activeTab === 'bugs') activeBodyHtml = renderBugsTab(bugs);
    else if (state.activeTab === 'improvements') activeBodyHtml = renderImprovementsTab(improvements);
    else if (state.activeTab === 'complexity') activeBodyHtml = renderComplexityTab(complexity, review);
    else if (state.activeTab === 'score') activeBodyHtml = renderScoreTab(review, complexity);
    else if (state.activeTab === 'diff') activeBodyHtml = renderDiffTab(review);

    resultsPanel.innerHTML = `
      <div class="results-summary-header">
        <div class="results-top-row">
          <h2 class="panel-title">Review Results</h2>
          <div class="results-score-inline tabular-nums ${scoreMeta.textClass}">
            Score ${escapeHtml(review.overall_score)}/10 · ${scoreMeta.label}
            ${
              complexity
                ? `<span style="color:#64748b"> · MI ${escapeHtml(complexity.maintainability_index)}/100</span>`
                : ''
            }
          </div>
        </div>
        ${
          review.summary
            ? `<p class="summary-callout">${escapeHtml(review.summary)}</p>`
            : ''
        }
      </div>

      <div role="tablist" aria-label="Review sections" class="tabs-bar">
        ${tabs
          .map(
            (tab) => `
          <button
            type="button"
            role="tab"
            data-tab="${tab.id}"
            aria-selected="${state.activeTab === tab.id}"
            class="tab-btn ${state.activeTab === tab.id ? 'is-active' : ''}"
          >
            ${escapeHtml(tab.label)}
          </button>
        `
          )
          .join('')}
      </div>

      <div class="tab-content">${activeBodyHtml}</div>
    `;

    // Bind Tab Clicks
    resultsPanel.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const nextTab = btn.getAttribute('data-tab');
        state.activeTab = nextTab;
        if (nextTab !== 'bugs') {
          state.highlightedLine = null;
          renderGutterAndMeta();
        }
        renderResults();
      });
    });

    // Bind Bug Accordion Clicks
    resultsPanel.querySelectorAll('.accordion-trigger').forEach((btn) => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-bug-index'));
        const nextIdx = state.expandedBugIndex === idx ? null : idx;
        state.expandedBugIndex = nextIdx;
        state.highlightedLine =
          nextIdx !== null ? parseFirstLineNumber(bugs[nextIdx]?.line) : null;
        renderGutterAndMeta();
        renderResults();
      });
    });

    // Bind Diff Actions
    const copyImprovedBtn = document.getElementById('copy-improved-btn');
    if (copyImprovedBtn) {
      copyImprovedBtn.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(review.improved_code);
          copyImprovedBtn.textContent = 'Copied';
          setTimeout(() => {
            copyImprovedBtn.textContent = 'Copy Improved';
          }, 1500);
        } catch {
          // Clipboard unavailable
        }
      });
    }

    const applyImprovedBtn = document.getElementById('apply-improved-btn');
    if (applyImprovedBtn) {
      applyImprovedBtn.addEventListener('click', () => {
        state.code = review.improved_code;
        codeTextarea.value = state.code;
        state.highlightedLine = null;
        renderGutterAndMeta();
        renderResults();
      });
    }
  }

  async function runReview() {
    if (!state.code.trim()) {
      state.error = 'Please paste some code first before running a review.';
      renderResults();
      return;
    }

    state.isLoading = true;
    state.error = null;
    state.highlightedLine = null;
    renderGutterAndMeta();
    renderResults();

    try {
      const response = await fetch('/api/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: state.code, language: state.language }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Something went wrong during review.');
      }

      state.review = data.review;
      state.complexity = data.complexity;
      state.activeTab = 'bugs';
      state.expandedBugIndex = 0;
    } catch (err) {
      state.error = err instanceof Error ? err.message : 'Unable to complete code review.';
    } finally {
      state.isLoading = false;
      renderResults();
    }
  }

  function setLanguage(nextLang) {
    const isUsingDefault = Object.values(DEFAULT_STARTER_CODE).some(
      (snippet) => snippet.trim() === state.code.trim()
    );
    state.language = nextLang;
    if (isUsingDefault || !state.code.trim()) {
      state.code = DEFAULT_STARTER_CODE[nextLang];
      codeTextarea.value = state.code;
    }
    state.highlightedLine = null;
    updateLanguageUI();
    if (!state.review && !state.error) {
      renderResults();
    }
  }

  function loadPreset(presetId) {
    const preset = PRESETS[presetId];
    if (!preset) return;
    state.language = preset.language;
    state.code = preset.code;
    codeTextarea.value = state.code;
    state.highlightedLine = null;
    updateLanguageUI();
    renderResults();
  }

  // Event Listeners
  languageButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      setLanguage(btn.getAttribute('data-lang'));
    });
  });

  presetSelect.addEventListener('change', (e) => {
    loadPreset(e.target.value);
  });

  navLoadExampleBtn.addEventListener('click', () => {
    loadPreset('py-invoice');
    presetSelect.value = 'py-invoice';
    document.getElementById('workspace')?.scrollIntoView({ behavior: 'smooth' });
  });

  codeTextarea.addEventListener('input', (e) => {
    state.code = e.target.value;
    renderGutterAndMeta();
  });

  codeTextarea.addEventListener('scroll', () => {
    lineGutter.scrollTop = codeTextarea.scrollTop;
  });

  codeTextarea.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      e.preventDefault();
      const start = codeTextarea.selectionStart;
      const end = codeTextarea.selectionEnd;
      state.code = state.code.substring(0, start) + '  ' + state.code.substring(end);
      codeTextarea.value = state.code;
      codeTextarea.selectionStart = start + 2;
      codeTextarea.selectionEnd = start + 2;
      renderGutterAndMeta();
    } else if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      if (!state.isLoading) runReview();
    }
  });

  copyCodeBtn.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(state.code);
      copyCodeBtn.textContent = 'Copied';
      setTimeout(() => {
        copyCodeBtn.textContent = 'Copy';
      }, 1500);
    } catch {
      // Clipboard unavailable
    }
  });

  clearResultsBtn.addEventListener('click', () => {
    state.review = null;
    state.complexity = null;
    state.error = null;
    state.highlightedLine = null;
    renderGutterAndMeta();
    renderResults();
  });

  runReviewBtn.addEventListener('click', runReview);
  topbarReviewBtn.addEventListener('click', runReview);

  // Initial Render
  codeTextarea.value = state.code;
  updateLanguageUI();
  renderResults();
})();
