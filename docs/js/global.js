// ===== CONSTANTS =====
const RAW_BASE = 'https://raw.githubusercontent.com/Galeax/CVE2CAPEC/refs/heads/main/';
const CVE_REGEX = /CVE-\d{4}-\d{4,}/gi;

const KINDS = {
    CVE:    { label: 'CVE',     color: '#2a78d6' },
    CWE:    { label: 'CWE',     color: '#eb6834' },
    CAPEC:  { label: 'CAPEC',   color: '#1baf7a' },
    ATTACK: { label: 'ATT&CK',  color: '#eda100' },
    D3FEND: { label: 'D3FEND',  color: '#e87ba4' },
    ATLAS:  { label: 'ATLAS',   color: '#008300' },
};
// Terminal layers that can be hidden from the flow without breaking paths
const TOGGLEABLE_KINDS = new Set(['D3FEND', 'ATLAS']);

const INK = '#111827';
const INK_2 = '#475467';
const INK_3 = '#667085';
const BORDER = '#e4e7ec';
const FONT = 'Inter, ui-sans-serif, system-ui, sans-serif';

function kindOf(name) {
    if (name.startsWith('CVE-')) return 'CVE';
    if (name.startsWith('CWE-')) return 'CWE';
    if (name.startsWith('CAPEC-')) return 'CAPEC';
    if (name.startsWith('D3F-')) return 'D3FEND';
    if (name.startsWith('AML.')) return 'ATLAS';
    return 'ATTACK';
}

// ===== APPLICATION STATE =====
const App = {
    mode: 'enterprise-defend',
    graph: null,             // { links, nodes, inLinks, outLinks }
    hiddenKinds: new Set(),
    filter: null,            // { node } | { link: {source, target} }
    selection: { attack: [], defend: [], atlas: [] },
    scores: { defend: {}, atlas: {} },
    layers: { attack: null, atlas: null },
    busy: false,
    lastCves: [],
};

var chart;        // main Sankey
var modal_chart;  // sub-graph Sankey

// ===== SMALL HELPERS =====
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function plural(n, word, pluralWord = word + 's') {
    return `${n.toLocaleString('en-US')} ${n === 1 ? word : pluralWord}`;
}

function onIdle(fn, timeout = 2000) {
    if ('requestIdleCallback' in window) requestIdleCallback(fn, { timeout });
    else setTimeout(fn, 600);
}

function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { console.warn('localStorage unavailable', e); }
}

// ===== TOASTS =====
const TOAST_ICONS = { success: 'i-check', error: 'i-alert', warning: 'i-alert', info: 'i-check' };

function toast(message, type = 'info', duration = 3200) {
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.setAttribute('role', type === 'error' ? 'alert' : 'status');
    el.innerHTML = `<svg class="icon"><use href="#${TOAST_ICONS[type]}"/></svg><span></span>`;
    el.lastChild.textContent = message;
    $('#toaster').appendChild(el);

    let timer;
    const leave = () => {
        el.classList.add('leaving');
        setTimeout(() => el.remove(), 160);
    };
    const start = () => { timer = setTimeout(leave, duration); };
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);
    el.addEventListener('click', leave);
    start();
}

// ===== DATA LOADING (cached, parallel) =====
const requestCache = new Map();

function cached(key, loader) {
    if (!requestCache.has(key)) {
        requestCache.set(key, loader().catch(err => {
            requestCache.delete(key); // allow a retry on next generation
            throw err;
        }));
    }
    return requestCache.get(key);
}

async function fetchOk(url) {
    const response = await fetch(url);
    if (!response.ok) throw Object.assign(new Error(`Failed to fetch ${url}: ${response.status}`), { status: response.status });
    return response;
}

const loadJson = path => cached(path, async () => (await fetchOk(RAW_BASE + path)).json());

// Fetch a gzipped text resource and return the decompressed string.
// Uses the browser-native DecompressionStream API.
async function fetchGzippedText(url) {
    const response = await fetchOk(url);
    const decompressed = response.body.pipeThrough(new DecompressionStream('gzip'));
    return await new Response(decompressed).text();
}

function parseJsonl(text, onEntry) {
    for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        try {
            const obj = JSON.parse(line);
            for (const key in obj) onEntry(key, obj[key]);
        } catch (e) {
            console.error('Error parsing JSON line:', line, e);
        }
    }
}

function loadDefendDb() {
    return cached('resources/defend_db.jsonl', async () => {
        const text = await (await fetchOk(RAW_BASE + 'resources/defend_db.jsonl')).text();
        const db = {};
        parseJsonl(text, (k, v) => { db[k] = v; });
        return db;
    });
}

// Lightweight CVE → CWE index served with the site (built by build_web_index.py).
// Falls back to the full yearly database when the index is unavailable.
function loadYearDb(year) {
    return cached(`database/CVE-${year}`, async () => {
        const db = new Map();
        try {
            const text = await (await fetchOk(`data/cwe/CVE-${year}.txt`)).text();
            for (const line of text.split('\n')) {
                const tab = line.indexOf('\t');
                if (tab < 0) continue;
                const cwes = line.slice(tab + 1);
                db.set(line.slice(0, tab), { CWE: cwes ? cwes.split(',') : [] });
            }
            return db;
        } catch (e) {
            if (e.status === 404) return db; // no CVE published for that year
            console.warn(`Web index unavailable for ${year}, using the full database`, e);
        }
        const text = await fetchGzippedText(`${RAW_BASE}database/CVE-${year}.jsonl.gz`);
        parseJsonl(text, (k, v) => db.set(k, v));
        return db;
    });
}

function loadCoreDbs(mode) {
    const wantDefend = mode === 'enterprise-defend';
    return Promise.all([
        loadJson('resources/techniques_association.json'),
        loadJson('resources/cwe_db.json'),
        loadJson('resources/capec_db.json'),
        loadJson('resources/techniques_db.json'),
        wantDefend ? loadDefendDb() : Promise.resolve({}),
        wantDefend ? loadJson('resources/atlas_db.json') : Promise.resolve({}),
    ]);
}

// ===== CVE INPUT PARSING =====
function extractCves(text) {
    const found = (text.match(CVE_REGEX) || []).map(c => c.toUpperCase());
    const unique = [...new Set(found)];
    return { list: unique, duplicates: found.length - unique.length };
}

function updateInputMeta() {
    const text = $('#cves').value;
    const { list, duplicates } = extractCves(text);
    const chip = $('#cve-count');
    chip.textContent = plural(list.length, 'CVE') + (duplicates ? ` · ${duplicates} dup.` : '');
    chip.classList.toggle('is-ok', list.length > 0);
    $('#btn-clear').hidden = !text.trim();
}

// ===== URL STATE =====
function compress(string, encoding) {
    const byteArray = new TextEncoder().encode(string);
    const cs = new CompressionStream(encoding);
    const writer = cs.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    return new Response(cs.readable).arrayBuffer();
}

function decompress(byteArray, encoding) {
    const cs = new DecompressionStream(encoding);
    const writer = cs.writable.getWriter();
    writer.write(byteArray);
    writer.close();
    return new Response(cs.readable).arrayBuffer().then(buf => new TextDecoder().decode(buf));
}

async function encodeCves(cves) {
    const bytes = new Uint8Array(await compress(cves.join(','), 'gzip'));
    let binary = '';
    for (const b of bytes) binary += String.fromCharCode(b);
    return btoa(binary);
}

async function writeUrlState(cves) {
    const b64 = await encodeCves(cves);
    const url = `?layer=${encodeURIComponent(App.mode)}&input=${encodeURIComponent(b64)}`;
    history.replaceState({}, '', url);
}

async function readUrlState() {
    const params = new URLSearchParams(window.location.search);
    const layer = params.get('layer');
    if (layer && $(`input[name="layer"][value="${CSS.escape(layer)}"]`)) {
        $(`input[name="layer"][value="${CSS.escape(layer)}"]`).checked = true;
        App.mode = layer;
    }
    const input = params.get('input');
    if (!input) return false;
    try {
        // Older links were not URL-encoded: '+' came back as ' '
        const binary = atob(input.replace(/ /g, '+'));
        const bytes = Uint8Array.from(binary, c => c.charCodeAt(0));
        const cves = await decompress(bytes, 'gzip');
        $('#cves').value = cves.split(',').filter(Boolean).join('\n');
        updateInputMeta();
        return true;
    } catch (e) {
        console.error('Invalid input parameter', e);
        toast('The shared link is invalid or truncated.', 'error');
        return false;
    }
}

// ===== GRAPH BUILDING =====
function buildGraph(cves, yearDbs, dbs, mode) {
    const [techniquesAssoc, cweDb, capecDb, , defendDb, atlasDb] = dbs;
    const linkMap = new Map();
    const notFound = [];

    const addLink = (source, target) => {
        const key = source + '\u0000' + target;
        const link = linkMap.get(key);
        if (link) link.value++;
        else linkMap.set(key, { source, target, value: 1 });
    };

    // Resolve CAPEC → technique ids once per CAPEC
    const capecTechniques = new Map();
    const techniquesOf = capec => {
        if (capecTechniques.has(capec)) return capecTechniques.get(capec);
        const related = new Set();
        const raw = capecDb[capec]?.techniques || '';
        const entries = raw.split('NAME:ATTACK:ENTRY ');
        for (let i = 1; i < entries.length; i++) {
            let id = entries[i].split(':')[1];
            if (mode === 'ics') id = techniquesAssoc[id]?.ics;
            else if (mode === 'mobile') id = techniquesAssoc[id]?.mobile;
            if (id) related.add('T' + id);
        }
        capecTechniques.set(capec, related);
        return related;
    };

    for (const cve of cves) {
        const year = cve.split('-')[1];
        const cveData = yearDbs.get(year)?.get(cve);
        if (!cveData) {
            notFound.push(cve);
            continue;
        }
        for (const cwe of cveData.CWE || []) {
            const cweKey = 'CWE-' + cwe;
            addLink(cve, cweKey);
            for (const capec of cweDb[cwe]?.RelatedAttackPatterns || []) {
                const capecKey = 'CAPEC-' + capec;
                addLink(cweKey, capecKey);
                for (const technique of techniquesOf(capec)) {
                    addLink(capecKey, technique);
                    for (const d of defendDb[technique] || []) addLink(technique, 'D3F-' + d.id);
                    for (const a of atlasDb[technique] || []) addLink(technique, a.id);
                }
            }
        }
    }

    const links = [...linkMap.values()];
    return { ...indexLinks(links), notFound };
}

function indexLinks(links) {
    const nodes = new Set();
    const inLinks = new Map();
    const outLinks = new Map();
    for (const l of links) {
        nodes.add(l.source);
        nodes.add(l.target);
        if (!outLinks.has(l.source)) outLinks.set(l.source, []);
        if (!inLinks.has(l.target)) inLinks.set(l.target, []);
        outLinks.get(l.source).push(l);
        inLinks.get(l.target).push(l);
    }
    return { links, nodes, inLinks, outLinks };
}

// Nodes reachable by walking edges backward (ancestors) or forward (descendants)
function reach(starts, adjacency, pick) {
    const seen = new Set(starts);
    const stack = [...starts];
    while (stack.length) {
        const n = stack.pop();
        for (const l of adjacency.get(n) || []) {
            const next = pick(l);
            if (!seen.has(next)) {
                seen.add(next);
                stack.push(next);
            }
        }
    }
    return seen;
}

const ancestorsOf = (graph, starts) => reach(starts, graph.inLinks, l => l.source);
const descendantsOf = (graph, starts) => reach(starts, graph.outLinks, l => l.target);

// Links lying on at least one CVE → leaf path through the selected node or link (graph is a DAG)
function pathsThrough(graph, filter) {
    const from = filter.node ?? filter.link.source;
    const to = filter.node ?? filter.link.target;
    const up = ancestorsOf(graph, [from]);
    const down = descendantsOf(graph, [to]);
    return graph.links.filter(l =>
        (up.has(l.source) && up.has(l.target)) ||
        (down.has(l.source) && down.has(l.target)) ||
        (filter.link && l.source === from && l.target === to));
}

// Everything upstream of the given nodes: the CVE → … → node paths
function upstreamLinks(targets) {
    const graph = App.graph;
    const present = targets.filter(t => graph.nodes.has(t));
    if (!present.length) return [];
    const up = ancestorsOf(graph, present);
    return graph.links.filter(l => up.has(l.source) && up.has(l.target));
}

// D3FEND fans out to dozens of countermeasures per technique: keep the flow readable
// by hiding it when large (it stays one click away in the legend and has its own tab)
const DENSE_LAYER_THRESHOLD = 30;
function autoHideDenseLayers() {
    App.hiddenKinds.clear();
    let d3fend = 0;
    App.graph.nodes.forEach(n => { if (n.startsWith('D3F-')) d3fend++; });
    if (d3fend > DENSE_LAYER_THRESHOLD) App.hiddenKinds.add('D3FEND');
}

function visibleGraph() {
    const graph = App.graph;
    if (!App.hiddenKinds.size) return graph;
    return indexLinks(graph.links.filter(l => !App.hiddenKinds.has(kindOf(l.target))));
}

// ===== SANKEY =====
function sankeyOption(links, { highlight = null } = {}) {
    const names = new Set();
    links.forEach(l => { names.add(l.source); names.add(l.target); });
    const inMap = new Map(), outMap = new Map();
    links.forEach(l => {
        (inMap.get(l.target) || inMap.set(l.target, []).get(l.target)).push(l.source);
        (outMap.get(l.source) || outMap.set(l.source, []).get(l.source)).push(l.target);
    });

    const list = (arr) => {
        const shown = arr.slice(0, 10).map(n => `<span style="font-family:'JetBrains Mono',monospace">${escapeHtml(n)}</span>`).join(', ');
        return arr.length > 10 ? `${shown} <span style="color:${INK_3}">+${arr.length - 10} more</span>` : shown;
    };

    return {
        animation: links.length < 1500,
        animationDuration: 300,
        tooltip: {
            trigger: 'item',
            confine: true,
            backgroundColor: '#fff',
            borderColor: BORDER,
            borderWidth: 1,
            padding: [10, 12],
            textStyle: { color: INK, fontFamily: FONT, fontSize: 12 },
            extraCssText: 'border-radius:10px;box-shadow:0 12px 24px -8px rgba(16,24,40,.18);max-width:360px;white-space:normal;',
            formatter: (p) => {
                if (p.dataType === 'node') {
                    const name = p.data.name;
                    const kind = KINDS[kindOf(name)];
                    const incoming = inMap.get(name) || [];
                    const outgoing = outMap.get(name) || [];
                    let html = `<div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
                        <span style="width:8px;height:8px;border-radius:2px;background:${kind.color}"></span>
                        <span style="color:${INK_3}">${kind.label}</span></div>
                        <div style="font-weight:600;font-size:13px;font-family:'JetBrains Mono',monospace">${escapeHtml(name)}</div>`;
                    if (incoming.length) html += `<div style="margin-top:8px;color:${INK_2}"><b style="color:${INK}">From</b> ${list(incoming)}</div>`;
                    if (outgoing.length) html += `<div style="margin-top:6px;color:${INK_2}"><b style="color:${INK}">To</b> ${list(outgoing)}</div>`;
                    if (highlight !== false) html += `<div style="margin-top:8px;color:${INK_3};font-size:11px">Click to isolate paths</div>`;
                    return html;
                }
                return `<span style="font-family:'JetBrains Mono',monospace">${escapeHtml(p.data.source)} → ${escapeHtml(p.data.target)}</span><br><span style="color:${INK_3}">weight ${p.data.value}</span>`;
            },
        },
        series: [{
            type: 'sankey',
            left: 8,
            right: 130,
            top: 16,
            bottom: 16,
            nodeAlign: 'left',
            nodeWidth: 10,
            nodeGap: 6,
            layoutIterations: links.length > 3000 ? 16 : 48,
            draggable: true,
            emphasis: { focus: 'trajectory', lineStyle: { opacity: 0.55 } },
            blur: { lineStyle: { opacity: 0.06 }, itemStyle: { opacity: 0.25 }, label: { opacity: 0.35 } },
            label: { color: INK_2, fontFamily: FONT, fontSize: 11 },
            lineStyle: { color: 'source', opacity: 0.22, curveness: 0.5 },
            itemStyle: { borderWidth: 0, borderRadius: 2 },
            data: [...names].map(name => ({ name, itemStyle: { color: KINDS[kindOf(name)].color } })),
            links,
        }],
    };
}

function chartHeightFor(links) {
    const perKind = {};
    const seen = new Set();
    links.forEach(l => [l.source, l.target].forEach(n => {
        if (seen.has(n)) return;
        seen.add(n);
        const k = kindOf(n);
        perKind[k] = (perKind[k] || 0) + 1;
    }));
    const tallest = Math.max(0, ...Object.values(perKind));
    return Math.round(Math.min(3200, Math.max(460, tallest * 17 + 40)));
}

function renderFlow() {
    if (!App.graph) return;
    const graph = visibleGraph();
    const links = App.filter ? pathsThrough(graph, App.filter) : graph.links;

    const height = chartHeightFor(links);
    const container = $('#container');
    container.style.height = height + 'px';
    $('#flow-body').style.setProperty('--chart-h', height + 'px');
    chart.resize();
    chart.setOption(sankeyOption(links), { notMerge: true });

    const bar = $('#filter-bar');
    bar.hidden = !App.filter;
    if (App.filter) {
        $('#filter-label').textContent = App.filter.node ?? `${App.filter.link.source} → ${App.filter.link.target}`;
    }
}

function setFilter(filter) {
    App.filter = filter;
    renderFlow();
}

function onFlowClick(params) {
    const current = App.filter;
    if (params.dataType === 'node') {
        const name = params.data.name;
        setFilter(current?.node === name ? null : { node: name });
    } else if (params.dataType === 'edge') {
        const { source, target } = params.data;
        const same = current?.link && current.link.source === source && current.link.target === target;
        setFilter(same ? null : { link: { source, target } });
    }
}

// ===== LEGEND & STATS =====
function renderLegend() {
    const legend = $('#flow-legend');
    legend.innerHTML = '';
    if (!App.graph) return;
    const present = new Set([...App.graph.nodes].map(kindOf));
    for (const [kind, meta] of Object.entries(KINDS)) {
        if (!present.has(kind)) continue;
        const toggleable = TOGGLEABLE_KINDS.has(kind);
        const el = document.createElement(toggleable ? 'button' : 'span');
        el.className = 'legend-item';
        el.dataset.kind = kind;
        el.innerHTML = `<b>${escapeHtml(meta.label)}</b>`;
        if (toggleable) {
            el.type = 'button';
            const shown = !App.hiddenKinds.has(kind);
            el.setAttribute('aria-pressed', String(shown));
            el.title = shown ? `Hide ${meta.label} from the flow` : `Show ${meta.label} in the flow`;
            if (!shown) el.insertAdjacentHTML('beforeend', '<span>hidden · show</span>');
            el.addEventListener('click', () => {
                if (App.hiddenKinds.has(kind)) App.hiddenKinds.delete(kind);
                else App.hiddenKinds.add(kind);
                App.filter = null;
                renderLegend();
                renderFlow();
            });
        }
        legend.appendChild(el);
    }
}

function renderStats(cvesCount) {
    const counts = {};
    App.graph.nodes.forEach(n => { const k = kindOf(n); counts[k] = (counts[k] || 0) + 1; });
    const notFound = App.graph.notFound.length;
    const stats = $('#stats');
    stats.innerHTML = '';
    for (const [kind, meta] of Object.entries(KINDS)) {
        if (kind !== 'CVE' && !counts[kind]) {
            if (kind === 'D3FEND' || kind === 'ATLAS') {
                if (App.mode !== 'enterprise-defend') continue;
            }
        }
        const value = kind === 'CVE' ? cvesCount - notFound : (counts[kind] || 0);
        const div = document.createElement('div');
        div.className = 'stat';
        div.dataset.kind = kind;
        div.innerHTML = `<dt>${escapeHtml(meta.label)}</dt><dd>${value.toLocaleString('en-US')}${kind === 'CVE' && notFound ? `<small>${notFound} missing</small>` : ''}</dd>`;
        stats.appendChild(div);
    }
    stats.hidden = false;
}

function renderNotFound() {
    const list = App.graph.notFound;
    $('#not-found').hidden = list.length === 0;
    $('#not-found-list').textContent = list.join(', ');
}

// ===== LOADING UI =====
function setLoading(on, text) {
    App.busy = on;
    const btn = $('#btn-generate');
    btn.classList.toggle('is-loading', on);
    btn.setAttribute('aria-busy', String(on));
    $('.btn-label', btn).textContent = on ? 'Generating…' : 'Generate';
    const body = $('#flow-body');
    body.classList.toggle('is-loading', on);
    $('#flow-loading').hidden = !on || body.classList.contains('has-data');
    $('#flow-empty').hidden = on || body.classList.contains('has-data');
    if (text) $('#loading-text').textContent = text;
}

// ===== MAIN PROCESSING =====
async function process(fromUrl = false) {
    if (App.busy) return;
    const textarea = $('#cves');
    const { list: cves } = extractCves(textarea.value);

    if (!cves.length) {
        if (!fromUrl) {
            toast('No CVE identifiers found. Expected format: CVE-2024-12345.', 'warning');
            textarea.focus();
        }
        return;
    }

    // Normalise the input to one unique CVE per line
    textarea.value = cves.join('\n');
    updateInputMeta();

    const mode = App.mode;
    const years = [...new Set(cves.map(c => c.split('-')[1]))];

    setLoading(true, 'Loading reference databases…');
    let dbs;
    const yearDbs = new Map();
    try {
        const corePromise = loadCoreDbs(mode);
        let loaded = 0;
        const yearPromises = years.map(year => loadYearDb(year)
            .then(db => { yearDbs.set(year, db); })
            .catch(err => { console.error(err); toast(`Could not load the ${year} CVE database.`, 'error'); })
            .finally(() => {
                loaded++;
                $('#loading-text').textContent = `Loading CVE databases… ${loaded}/${years.length}`;
            }));
        [dbs] = await Promise.all([corePromise, Promise.all(yearPromises)]);
    } catch (error) {
        console.error(error);
        toast('Failed to fetch the reference databases. Check your connection and retry.', 'error', 5000);
        setLoading(false);
        return;
    }

    $('#loading-text').textContent = 'Building graph…';
    await new Promise(requestAnimationFrame);

    App.graph = buildGraph(cves, yearDbs, dbs, mode);
    App.filter = null;
    autoHideDenseLayers();
    App.lastCves = cves;
    App.selection = { attack: [], defend: [], atlas: [] };
    ['attack', 'defend', 'atlas'].forEach(updateSelectionUI);

    if (!App.graph.links.length) {
        setLoading(false);
        renderNotFound();
        toast('No CWE / CAPEC mapping found for these CVEs.', 'warning', 5000);
        return;
    }

    $('#flow-body').classList.add('has-data');
    setLoading(false);
    $('#flow-tools').hidden = false;
    $('#btn-share').disabled = false;

    renderLegend();
    renderFlow();
    renderStats(cves.length);
    renderNotFound();
    writeUrlState(cves);

    await renderResults(dbs[3]);

    if (!fromUrl) {
        gtag('event', 'generate', { mode, cves: cves.length });
    }
}

// ===== RESULTS (MATRICES) =====
async function renderResults(techniquesDb) {
    const wantDefend = App.mode === 'enterprise-defend';
    $('#results').hidden = false;

    // ATT&CK
    App.layers.attack = create_mitre_layer(techniquesDb);
    updateAttackStats();
    print_mitre();

    // D3FEND & ATLAS (rendered lazily on first tab activation)
    $('#defend-tab').hidden = !wantDefend;
    $('#atlas-tab').hidden = !wantDefend;
    App.scores.defend = {};
    App.scores.atlas = {};
    if (wantDefend) {
        App.graph.links.forEach(l => {
            if (l.target.startsWith('D3F-')) {
                const id = l.target.slice(4);
                App.scores.defend[id] = (App.scores.defend[id] || 0) + l.value;
            }
        });
        App.layers.atlas = create_atlas_layer();
        updateAtlasStats();
        updateDefendStats();
        markPaneDirty('defend');
        markPaneDirty('atlas');
        prefetchDefendMatrix();
    }

    const active = $('.tab[aria-selected="true"]');
    selectTab(active && !active.hidden ? active.id.replace('-tab', '') : 'attack', false);
}

const dirtyPanes = new Set();
function markPaneDirty(name) { dirtyPanes.add(name); }

function selectTab(name, focus = true) {
    $$('.tab').forEach(tab => {
        const on = tab.id === `${name}-tab`;
        tab.setAttribute('aria-selected', String(on));
        tab.tabIndex = on ? 0 : -1;
        $('#' + tab.getAttribute('aria-controls')).hidden = !on;
        if (on && focus) tab.focus();
    });
    if (dirtyPanes.has(name)) {
        dirtyPanes.delete(name);
        if (name === 'defend') renderDefendMatrix(App.scores.defend);
        if (name === 'atlas') print_atlas();
    }
}

// ===== SELECTION (shared by the three matrices) =====
function updateSelectionUI(kind) {
    const count = App.selection[kind].length;
    const label = $(`#${kind}-selected`);
    label.textContent = `${count} selected`;
    label.classList.toggle('has-selection', count > 0);
    $(`[data-subgraph="${kind}"]`).disabled = count === 0;
    $(`[data-clear="${kind}"]`).disabled = count === 0;
}

function setSelection(kind, items) {
    App.selection[kind] = [...new Set(items)];
    updateSelectionUI(kind);
}

// Called from the ATT&CK Navigator iframe on technique selection (see mitre/main.js)
function mitre_selection(techniques) {
    setSelection('attack', (techniques || []).map(t => String(t).split('^')[0]).filter(Boolean));
}

// Called from the ATLAS Navigator iframe on technique selection (see atlas/main.js)
function atlas_selection(techniques) {
    setSelection('atlas', (techniques || []).map(t => String(t).split('^')[0]).filter(Boolean));
}

// Expand parent techniques to include their sub-techniques present in the graph
function withSubTechniques(ids) {
    const out = new Set(ids);
    for (const id of ids) {
        for (const node of App.graph.nodes) {
            if (node.startsWith(id + '.')) out.add(node);
        }
    }
    return [...out];
}

function subgraphTargets(kind) {
    const sel = App.selection[kind];
    if (kind === 'defend') return sel.map(id => 'D3F-' + id);
    return withSubTechniques(sel);
}

function show_modal(kind = null) {
    kind = kind || $('.tab[aria-selected="true"]').id.replace('-tab', '');
    const links = upstreamLinks(subgraphTargets(kind));
    if (!links.length) {
        toast('None of the selected techniques come from these CVEs. Pick a highlighted (scored) technique.', 'warning', 4500);
        return;
    }
    const sel = App.selection[kind];
    const label = { attack: 'ATT&CK', defend: 'D3FEND', atlas: 'ATLAS' }[kind];
    $('#modal-title').textContent = `Trace ${plural(sel.length, label + ' technique')} to CVEs`;
    const cves = new Set(links.filter(l => l.source.startsWith('CVE-')).map(l => l.source));
    $('#modal-sub').textContent = `${plural(cves.size, 'CVE')} lead to: ${sel.slice(0, 8).join(', ')}${sel.length > 8 ? ` +${sel.length - 8} more` : ''}`;

    const dialog = $('#modal');
    dialog.showModal();
    modal_chart.resize();
    modal_chart.setOption(sankeyOption(links, { highlight: false }), { notMerge: true });
}

function clearSelection(kind) {
    if (kind === 'defend') {
        clearDefendSelection();
        return;
    }
    const iframe = document.getElementById(kind === 'attack' ? 'mitre' : 'atlas');
    try {
        const buttons = iframe.contentWindow.document.getElementsByClassName('mat-mdc-tooltip-trigger control-row-button noselect');
        if (buttons.length >= 3) buttons[2].click();
    } catch (e) {
        console.error('Could not reach the Navigator iframe', e);
    }
    setSelection(kind, []);
}

// ===== EXPORTS =====
function downloadJson(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

function saveChartImage(instance, name) {
    const a = document.createElement('a');
    a.href = instance.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#fff' });
    a.download = name + '.png';
    a.click();
}

async function share() {
    try {
        await navigator.clipboard.writeText(window.location.href);
        toast('Link copied to clipboard', 'success');
    } catch (err) {
        console.error('Failed to copy: ', err);
        toast('Could not copy the link. Copy it from the address bar.', 'error');
    }
}

function toggleFullscreen(el) {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (el.requestFullscreen) el.requestFullscreen();
    else toast('Fullscreen is not supported by this browser', 'error');
}

// Kept for the Navigator iframes
function fullscreen() { toggleFullscreen(document.documentElement); }

// ===== HEADER EXTRAS =====
async function loadStars() {
    try {
        let stars = sessionStorage.getItem('gh-stars');
        if (!stars) {
            const res = await fetchOk('https://api.github.com/repos/Galeax/CVE2CAPEC');
            stars = String((await res.json()).stargazers_count);
            sessionStorage.setItem('gh-stars', stars);
        }
        const el = $('#star-count');
        $('span', el).textContent = Number(stars).toLocaleString('en-US');
        el.hidden = false;
    } catch (e) { /* optional */ }
}

async function loadLastUpdate() {
    try {
        const text = (await (await fetchOk(RAW_BASE + 'lastUpdate.txt')).text()).trim();
        const date = new Date(text);
        if (!isNaN(date)) {
            $('#last-update').textContent = `Last update: ${date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}.`;
        }
    } catch (e) { /* optional */ }
}

// ===== INIT =====
function initCharts() {
    chart = echarts.init($('#container'), null, { renderer: 'canvas' });
    modal_chart = echarts.init($('#subgraph'), null, { renderer: 'canvas' });
    chart.on('click', onFlowClick);
    new ResizeObserver(() => chart.resize()).observe($('#flow-body'));
    new ResizeObserver(() => modal_chart.resize()).observe($('#subgraph'));
}

function initInput() {
    const textarea = $('#cves');
    textarea.addEventListener('input', updateInputMeta);
    textarea.addEventListener('keydown', e => {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            process();
        }
    });
    textarea.addEventListener('focus', () => onIdle(() => loadCoreDbs(App.mode).catch(() => {})), { once: true });

    // Drag & drop a text file
    const zone = $('#dropzone');
    let depth = 0;
    zone.addEventListener('dragenter', e => { e.preventDefault(); depth++; zone.classList.add('dragging'); });
    zone.addEventListener('dragover', e => e.preventDefault());
    zone.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; zone.classList.remove('dragging'); } });
    zone.addEventListener('drop', async e => {
        e.preventDefault();
        depth = 0;
        zone.classList.remove('dragging');
        const file = e.dataTransfer.files[0];
        const text = file ? await file.text() : e.dataTransfer.getData('text');
        const { list } = extractCves(text || '');
        if (!list.length) {
            toast('No CVE identifiers found in the dropped content.', 'warning');
            return;
        }
        const existing = extractCves(textarea.value).list;
        textarea.value = [...new Set([...existing, ...list])].join('\n');
        updateInputMeta();
        toast(`Imported ${plural(list.length, 'CVE')}`, 'success');
    });

    $('#input-form').addEventListener('submit', e => { e.preventDefault(); process(); });
    $('#btn-example').addEventListener('click', () => {
        textarea.value = 'CVE-2024-37079\nCVE-2018-17924';
        updateInputMeta();
        process();
    });
    $('#btn-clear').addEventListener('click', () => {
        textarea.value = '';
        updateInputMeta();
        textarea.focus();
    });
    $('#btn-share').addEventListener('click', share);

    $$('input[name="layer"]').forEach(radio => radio.addEventListener('change', () => {
        App.mode = radio.value;
        if (App.graph) process();
    }));
}

function initResults() {
    // Tabs with arrow-key navigation
    const tabs = $$('.tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => selectTab(tab.id.replace('-tab', ''), false));
        tab.addEventListener('keydown', e => {
            if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
            const visible = tabs.filter(t => !t.hidden);
            const i = visible.indexOf(tab) + (e.key === 'ArrowRight' ? 1 : -1);
            const next = visible[(i + visible.length) % visible.length];
            selectTab(next.id.replace('-tab', ''));
        });
    });

    $$('[data-subgraph]').forEach(btn => btn.addEventListener('click', () => show_modal(btn.dataset.subgraph)));
    $$('[data-clear]').forEach(btn => btn.addEventListener('click', () => clearSelection(btn.dataset.clear)));
    $$('[data-fullscreen]').forEach(btn => btn.addEventListener('click', () => toggleFullscreen(document.getElementById(btn.dataset.fullscreen))));
    $$('[data-download]').forEach(btn => btn.addEventListener('click', () => {
        const kind = btn.dataset.download;
        downloadJson(App.layers[kind], `cve2capec-${kind === 'attack' ? App.mode.replace('-defend', '') : 'atlas'}-layer.json`);
    }));

    $('#defend-only-hits').addEventListener('change', e => {
        $('#defend_matrix').classList.toggle('only-hits', e.target.checked);
    });

    // Flow tools
    $('#flow-save').addEventListener('click', () => saveChartImage(chart, 'CVE2CAPEC - data flow'));
    $('#flow-full').addEventListener('click', () => toggleFullscreen($('#flow-body')));
    $('#filter-clear').addEventListener('click', () => setFilter(null));

    // Dialog
    const dialog = $('#modal');
    $('#modal-close').addEventListener('click', () => dialog.close());
    $('#modal-save').addEventListener('click', () => saveChartImage(modal_chart, 'CVE2CAPEC - sub-graph'));
    dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

    document.addEventListener('keydown', e => {
        if (e.key === 'Escape' && App.filter && !dialog.open && !document.fullscreenElement) setFilter(null);
    });
    document.addEventListener('fullscreenchange', () => {
        requestAnimationFrame(() => { chart.resize(); });
    });
}

document.addEventListener('DOMContentLoaded', async () => {
    initCharts();
    initInput();
    initResults();
    updateInputMeta();

    const fromUrl = await readUrlState();
    if (fromUrl) process(true);
    else onIdle(() => loadCoreDbs(App.mode).catch(() => {}));

    onIdle(loadStars);
    onIdle(loadLastUpdate);
});
