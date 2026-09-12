/**
 * The schedule and the findings, as document text.
 *
 * Not a picture of a table — a real one, so it can be selected, copied into an
 * email, read by a screen reader and printed. The 3D view is the part you look
 * at; this is the part that ends up on a drawing.
 */

const SEVERITY_WORD = { error: 'Fix', warning: 'Look at', note: 'Note' };
const SEVERITY_HEADING = { error: 'To fix', warning: 'To look at', note: 'Notes' };
const CATEGORY_WORD = {
  tree: 'Tree', shrub: 'Shrub / hedge', ground: 'Groundcover', hard: 'Hard landscape',
};

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'text') node.textContent = v;
    else if (k === 'class') node.className = v;
    else node.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

const n1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function createReportView(root) {
  const need = (selector) => {
    const node = root.querySelector(selector);
    if (!node) throw new Error(`Report hook ${selector} is missing from the page`);
    return node;
  };

  const nodes = {
    verdict: need('[data-verdict]'),
    counts: need('[data-counts]'),
    findings: need('[data-findings]'),
    empty: need('[data-empty]'),
    coverage: need('[data-coverage]'),
    table: need('[data-schedule-table]'),
    body: need('[data-schedule-body]'),
  };

  const COLUMNS = [
    ['Type', 'text'],
    ['Category', 'text'],
    ['No.', 'numeric'],
    ['Height m', 'numeric'],
    ['Spread m', 'numeric'],
    ['Spacing m', 'numeric'],
    ['Closest m', 'numeric'],
    ['Area m²', 'numeric'],
  ];

  function renderCounts(summary) {
    nodes.counts.replaceChildren(...[
      ['plants', 'plants', summary.plants],
      ['trees', 'trees', summary.trees],
      ['canopy', 'canopy cover', `${n1(summary.canopyPercent)}%`],
      ['hard', 'hard landscape', `${n1(summary.hardPercent)}%`],
      ['error', 'to fix', summary.error ?? 0],
      ['warning', 'to look at', summary.warning ?? 0],
    ].map(([kind, label, value]) => el('div', { class: 'count', 'data-kind': kind }, [
      el('span', { class: 'count__n', text: String(value) }),
      el('span', { class: 'count__label', text: label }),
    ])));
  }

  function renderFindings(result) {
    const { findings } = result;
    nodes.empty.hidden = findings.length > 0 || result.summary.plants > 0;
    nodes.findings.hidden = findings.length === 0;
    if (!findings.length) return;

    const sections = [];
    for (const severity of ['error', 'warning', 'note']) {
      const group = findings.filter((f) => f.severity === severity);
      if (!group.length) continue;
      sections.push(el('h3', {
        class: 'group', 'data-severity': severity, text: SEVERITY_HEADING[severity],
      }));
      for (const f of group) {
        sections.push(el('article', { class: 'finding', 'data-severity': f.severity }, [
          el('h4', { class: 'finding__title' }, [
            el('span', { class: 'tag', 'data-severity': f.severity, text: SEVERITY_WORD[f.severity] }),
            el('span', { text: f.title }),
          ]),
          el('p', { class: 'finding__detail', text: f.detail }),
          f.subjects.length
            ? el('ul', { class: `finding__subjects${f.subjects.length > 8 ? ' finding__subjects--dense' : ''}` },
              f.subjects.map((s) => el('li', { text: s })))
            : null,
          f.count > f.subjects.length
            ? el('p', { class: 'finding__more', text: `…and ${f.count - f.subjects.length} more.` })
            : null,
        ]));
      }
    }
    nodes.findings.replaceChildren(...sections);
  }

  function renderSchedule(schedule) {
    const head = nodes.table.querySelector('thead tr');
    head.replaceChildren(...COLUMNS.map(([label, kind]) => el('th', {
      scope: 'col', class: kind === 'numeric' ? 'numeric' : null, text: label,
    })));

    nodes.body.replaceChildren(...schedule.rows.map((r) => el('tr', { 'data-category': r.category }, [
      el('td', { text: r.label }),
      el('td', { class: 'muted', text: CATEGORY_WORD[r.category] || r.category }),
      el('td', { class: 'numeric', text: String(r.count) }),
      el('td', { class: 'numeric', text: `${n1(r.height.min)}–${n1(r.height.max)}` }),
      el('td', { class: 'numeric', text: `${n1(r.spread.min)}–${n1(r.spread.max)}` }),
      el('td', { class: 'numeric', text: n1(r.spacingNominal) }),
      el('td', { class: 'numeric', text: r.spacingAchieved === null ? '—' : n1(r.spacingAchieved) }),
      el('td', { class: 'numeric', text: String(Math.round(r.area)) }),
    ])));

    nodes.table.hidden = schedule.rows.length === 0;
  }

  function renderCoverage(result) {
    const list = (items, fallback) => (items.length
      ? items.map((i) => el('li', { text: i }))
      : [el('li', { class: 'muted', text: fallback })]);

    nodes.coverage.replaceChildren(
      el('div', { class: 'coverage__col' }, [
        el('h4', { text: 'Checked' }),
        el('ul', {}, list(result.checked, 'nothing yet')),
      ]),
      el('div', { class: 'coverage__col' }, [
        el('h4', { text: 'Not checked' }),
        el('ul', {}, list(result.skipped, 'everything applicable was checked')),
      ]),
    );
  }

  function render(result) {
    nodes.verdict.textContent = result.summary.verdict;
    nodes.verdict.dataset.state = result.summary.worst;
    renderCounts(result.summary);
    renderFindings(result);
    renderSchedule(result.schedule);
    renderCoverage(result);
  }

  return { render };
}
