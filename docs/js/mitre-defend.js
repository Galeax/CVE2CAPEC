// ===== MITRE D3FEND FUNCTIONS =====

const D3FEND_ORDER = ["Model", "Harden", "Detect", "Isolate", "Deceive", "Evict", "Restore"];
const D3FEND_DESCRIPTIONS = {
    'Model': 'Modeling and analysis of system behavior',
    'Harden': 'Techniques to strengthen system defenses',
    'Detect': 'Identification of threats and anomalies',
    'Isolate': 'Containment and quarantine measures',
    'Deceive': 'Deception and misdirection tactics',
    'Evict': 'Removal of threats from the system',
    'Restore': 'Recovery and restoration procedures'
};

const CHEVRON = '<svg class="chev" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" d="m9 6 6 6-6 6"/></svg>';

const selectedDefendTechs = new Set();

function prefetchDefendMatrix() {
    return cached('d3fend-matrix', async () => (await fetchOk('https://d3fend.mitre.org/api/matrix.json')).json())
        .catch(e => { console.error('D3FEND fetch failed', e); });
}

function updateDefendStats() {
    const scores = App.scores.defend;
    const techniques = Object.keys(scores).length;
    const hits = Object.values(scores).reduce((sum, v) => sum + v, 0);
    $('#defend-stats').textContent = `${plural(techniques, 'countermeasure')} relevant · ${plural(hits, 'hit')}`;
    $('#defend-tab-count').textContent = techniques || '';
}

// Interpolate along the shared yellow → orange → red heat ramp
function defendHeat(value, max) {
    if (!value) return '';
    const stops = [[255, 246, 194], [255, 231, 102], [255, 149, 88], [255, 102, 102]];
    const t = Math.min(value / max, 1) * (stops.length - 1);
    const i = Math.min(Math.floor(t), stops.length - 2);
    const f = t - i;
    const c = stops[i].map((v, k) => Math.round(v + (stops[i + 1][k] - v) * f));
    return `rgb(${c.join(',')})`;
}

/**
 * Render the D3FEND matrix: one column per tactic, collapsible (sub-)groups, leaf technique tiles.
 */
async function renderDefendMatrix(scoreTable = {}) {
    const host = document.getElementById('defend_matrix');
    host.innerHTML = '<p class="card-sub" style="padding:24px">Loading the D3FEND matrix…</p>';
    selectedDefendTechs.clear();
    setSelection('defend', []);

    const raw = await prefetchDefendMatrix();
    if (!raw) {
        host.innerHTML = '<p class="card-sub" style="padding:24px">Could not load the D3FEND matrix from d3fend.mitre.org.</p>';
        return;
    }

    const labelOf = n => n?.['rdfs:label'] || n?.name || (n?.['@id'] || '').split(':').pop();
    const kidsOf = n => Array.isArray(n?.children) ? n.children : [];

    const top = Array.isArray(raw) ? raw : (raw?.tactics || raw?.columns || []);
    if (!top.length) return;

    const toGroups = nodes => nodes.flatMap(n => {
        if (kidsOf(n).length) return [{ type: 'group', title: labelOf(n), items: toGroups(kidsOf(n)) }];
        const id = n['d3f:d3fend-id'];
        return id ? [{ type: 'tech', id, title: labelOf(n) }] : [];
    });

    const columns = [...top]
        .sort((a, b) => D3FEND_ORDER.indexOf(labelOf(a)) - D3FEND_ORDER.indexOf(labelOf(b)))
        .map(col => ({ tactic: labelOf(col), groups: toGroups(kidsOf(col)) }));

    const max = Math.max(...Object.values(scoreTable), 1);

    // Annotate groups with their hit statistics once
    const annotate = group => {
        let withHits = 0;
        for (const item of group.items) {
            if (item.type === 'group') {
                annotate(item);
                if (item.hasHits) withHits++;
            } else if (scoreTable[item.id] > 0) {
                withHits++;
            }
        }
        group.total = group.items.length;
        group.withHits = withHits;
        group.hasHits = withHits > 0;
    };

    const renderTile = item => {
        const hits = scoreTable[item.id] || 0;
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'd3f-tile' + (hits ? '' : ' empty');
        tile.dataset.techId = item.id;
        tile.setAttribute('aria-pressed', 'false');
        if (hits) tile.style.setProperty('--bg-heat', defendHeat(hits, max));
        tile.title = `${item.id} · ${item.title}\n${hits ? plural(hits, 'hit') : 'No hits'} · click to select`;
        tile.innerHTML = `<span></span>${hits ? `<span class="score">${hits}</span>` : ''}`;
        tile.firstChild.textContent = item.title;
        return tile;
    };

    const renderGroup = group => {
        const wrap = document.createElement('div');
        wrap.className = 'd3f-group' + (group.hasHits ? ' has-hits' : '');

        const head = document.createElement('button');
        head.type = 'button';
        head.className = 'd3f-group-head';
        head.setAttribute('aria-expanded', String(group.hasHits));
        head.innerHTML = `${CHEVRON}<span class="title"></span>${group.hasHits ? `<span class="ratio">${group.withHits}/${group.total}</span>` : ''}`;
        $('.title', head).textContent = group.title;

        const children = document.createElement('div');
        children.className = 'd3f-children';
        children.hidden = !group.hasHits;
        group.items.forEach(item => children.appendChild(item.type === 'tech' ? renderTile(item) : renderGroup(item)));

        wrap.append(head, children);
        return wrap;
    };

    const fragment = document.createDocumentFragment();
    for (const col of columns) {
        const wrap = document.createElement('div');
        wrap.className = 'd3f-col';

        let colHits = 0;
        col.groups.forEach(g => {
            if (g.type === 'group') { annotate(g); if (g.hasHits) colHits++; }
            else if (scoreTable[g.id] > 0) colHits++;
        });

        const head = document.createElement('div');
        head.className = 'd3f-head';
        head.title = D3FEND_DESCRIPTIONS[col.tactic] || 'Defensive tactic';
        head.innerHTML = `<span></span><small>${colHits ? `${colHits} affected` : ''}</small>`;
        head.firstChild.textContent = col.tactic;
        wrap.appendChild(head);

        col.groups.forEach(g => wrap.appendChild(g.type === 'tech' ? renderTile(g) : renderGroup(g)));

        const empty = document.createElement('div');
        empty.className = 'd3f-col-empty';
        empty.textContent = 'No relevant countermeasure';
        empty.hidden = colHits > 0;
        wrap.appendChild(empty);

        fragment.appendChild(wrap);
    }

    host.innerHTML = '';
    host.appendChild(fragment);
    host.classList.toggle('only-hits', $('#defend-only-hits').checked);
}

// One delegated handler for every tile and group header
document.addEventListener('DOMContentLoaded', () => {
    $('#defend_matrix').addEventListener('click', e => {
        const head = e.target.closest('.d3f-group-head');
        if (head) {
            const expanded = head.getAttribute('aria-expanded') === 'true';
            head.setAttribute('aria-expanded', String(!expanded));
            head.nextElementSibling.hidden = expanded;
            return;
        }
        const tile = e.target.closest('.d3f-tile');
        if (tile) toggleDefendTechSelection(tile.dataset.techId, tile);
    });
});

function toggleDefendTechSelection(techId, tile) {
    const on = !selectedDefendTechs.has(techId);
    if (on) selectedDefendTechs.add(techId);
    else selectedDefendTechs.delete(techId);
    tile.setAttribute('aria-pressed', String(on));
    setSelection('defend', [...selectedDefendTechs]);
}

function clearDefendSelection() {
    $$('#defend_matrix .d3f-tile[aria-pressed="true"]').forEach(tile => tile.setAttribute('aria-pressed', 'false'));
    selectedDefendTechs.clear();
    setSelection('defend', []);
}
