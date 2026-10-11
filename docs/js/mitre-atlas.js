// ===== MITRE ATLAS FUNCTIONS =====

function create_atlas_layer() {
    const scores = techniqueScores(
        id => kindOf(id) === 'ATLAS',
        id => /^AML\.T\d+\.\d+$/.test(id) ? id.split('.').slice(0, 2).join('.') : null
    );
    const maxScore = Math.max(0, ...Object.values(scores));

    const layer = navigatorLayer({
        "name": "CVE2CAPEC - ATLAS layer",
        "versions": { "navigator": "5.1.0", "layer": "4.5" },
        "domain": "atlas",
        "description": "ATLAS techniques mapped from the selected CVE list",
        "gradient": { "colors": HEAT_GRADIENT, "minValue": 0, "maxValue": maxScore },
    });

    for (const [id, score] of Object.entries(scores)) {
        const row = {
            "techniqueID": id,
            "color": "",
            "comment": "",
            "enabled": true,
            "metadata": [],
            "links": [],
            "showSubtechniques": false
        };
        if (score > 0) row.score = score;
        layer.techniques.push(row);
    }

    safeStorageSet('atlas-layer', JSON.stringify(layer));
    return layer;
}

function updateAtlasStats() {
    const { techniques, hits } = layerStats(App.layers.atlas);
    $('#atlas-stats').textContent = `${plural(techniques, 'technique')} affected · ${plural(hits, 'hit')}`;
    $('#atlas-tab-count').textContent = techniques || '';
}

function print_atlas() {
    if (!App.layers.atlas) return;
    mountNavigator({ id: 'atlas', src: 'atlas/', host: 'atlas-frame' });
}
