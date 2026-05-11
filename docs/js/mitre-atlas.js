// ===== MITRE ATLAS FUNCTIONS =====

async function create_atlas_layer() {
    var data_layer = {};

    // Aggregate scores by AML technique from the Sankey links
    var techniques_list = chart.getOption().series[0].links;
    var max_score = 0;

    for (var i = 0; i < techniques_list.length; i++) {
        var element = techniques_list[i];
        var technique = element.target;
        if (typeof technique !== 'string' || !technique.startsWith('AML.')) {
            continue;
        }
        var score = element.value;
        if (!data_layer[technique]) {
            data_layer[technique] = score;
        } else {
            data_layer[technique] += score;
        }
    }

    // Sub-techniques score also bubbles up to parent
    var tmp = Object.assign({}, data_layer);
    for (var key in tmp) {
        if (key.match(/^AML\.T\d+\.\d+$/)) {
            var parent = key.split('.').slice(0, 2).join('.');
            if (data_layer[parent]) {
                data_layer[parent] += data_layer[key];
            } else {
                data_layer[parent] = data_layer[key];
            }
        }
    }

    for (var key in data_layer) {
        var score = data_layer[key];
        if (score > max_score) {
            max_score = score;
        }
    }

    var layer = {
        "name": "CVE2CAPEC - ATLAS layer",
        "versions": {
            "navigator": "5.1.0",
            "layer": "4.5"
        },
        "domain": "atlas",
        "description": "ATLAS techniques mapped from the selected CVE list",
        "sorting": 3,
        "layout": {
            "layout": "side",
            "aggregateFunction": "average",
            "showID": false,
            "showName": true,
            "showAggregateScores": false,
            "countUnscored": false,
            "expandedSubtechniques": "none"
        },
        "hideDisabled": false,
        "techniques": [],
        "gradient": {
            "colors": [
                "#ffe766ff",
                "#ff9558",
                "#ff6666ff"
            ],
            "minValue": 0,
            "maxValue": max_score
        },
        "legendItems": [],
        "metadata": [],
        "links": [],
        "showTacticRowBackground": false,
        "tacticRowBackground": "#dddddd",
        "selectTechniquesAcrossTactics": true,
        "selectSubtechniquesWithParent": true,
        "selectVisibleTechniques": false,
    };

    for (var key in data_layer) {
        var row = {
            "techniqueID": key,
            "color": "",
            "comment": "",
            "enabled": true,
            "metadata": [],
            "links": [],
            "showSubtechniques": false
        };
        if (data_layer[key] > 0) {
            row["score"] = data_layer[key];
        }
        layer.techniques.push(row);
    }

    localStorage.setItem('atlas-layer', JSON.stringify(layer));
}

// Function to update ATLAS statistics
function updateAtlasStats() {
    const layer = localStorage.getItem('atlas-layer');
    if (!layer) return;

    try {
        const layerData = JSON.parse(layer);
        const techniques = layerData.techniques || [];

        const uniqueTechniques = new Set();
        let totalHits = 0;

        techniques.forEach(tech => {
            if (tech.score && tech.score > 0) {
                uniqueTechniques.add(tech.techniqueID);
                totalHits += tech.score;
            }
        });

        document.getElementById('atlas-techniques-count').textContent = uniqueTechniques.size;
        document.getElementById('atlas-hits-count').textContent = totalHits;
        document.getElementById('atlas-summary').style.display = uniqueTechniques.size > 0 ? 'block' : 'none';
    } catch (e) {
        console.error('Error updating ATLAS stats:', e);
    }
}

function waitForAtlasElm(selector) {
    return new Promise(resolve => {
        if (document.getElementById('atlas').contentWindow.document.querySelector(selector)) {
            return resolve(document.getElementById('atlas').contentWindow.document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.getElementById('atlas').contentWindow.document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.getElementById('atlas').contentWindow.document.querySelector(selector));
            }
        });

        observer.observe(document.getElementById('atlas').contentWindow.document.body, {
            childList: true,
            subtree: true
        });
    });
}

async function print_atlas() {
    var layer = localStorage.getItem('atlas-layer');
    if (!layer) {
        return;
    }

    if (document.getElementById('atlas')) {
        document.getElementById('atlas').remove();
    }
    var iframe = document.createElement('iframe');
    iframe.src = 'atlas/';
    iframe.id = "atlas";
    iframe.allowFullscreen = true;
    iframe.style.width = "100%";
    iframe.style.height = "800px";
    iframe.style.border = "none";

    document.getElementById('atlas-frame').appendChild(iframe);
    document.getElementById('atlas-frame').hidden = false;

    iframe.onload = function () {
        var iframe = document.getElementById('atlas');
        var iframeDoc = iframe.contentWindow.document;

        // Force the Navigator's built-in dark theme so unscored cells render with white text on dark background
        iframeDoc.body.classList.add('theme-override-dark');
        new MutationObserver(() => {
            if (!iframeDoc.body.classList.contains('theme-override-dark')) {
                iframeDoc.body.classList.add('theme-override-dark');
            }
        }).observe(iframeDoc.body, { attributes: true, attributeFilter: ['class'] });

        var div = iframeDoc.createElement('div');
        var div_sub_graph = iframeDoc.createElement('div');

        var button_screen = iframeDoc.createElement('button');
        button_screen.innerHTML = '<svg class="toggle-fullscreen-svg frame-full" width="28" height="28" viewBox="-2 -2 28 28"><g class="icon-fullscreen-enter"><path d="M 2 9 v -7 h 7" /><path d="M 22 9 v -7 h -7" /><path d="M 22 15 v 7 h -7" /><path d="M 2 15 v 7 h 7" /></g><g class="icon-fullscreen-leave"><path d="M 24 17 h -7 v 7" /><path d="M 0 17 h 7 v 7" /><path d="M 0 7 h 7 v -7" /><path d="M 24 7 h -7 v -7" /></g></svg>';
        button_screen.className = "js-toggle-fullscreen-btn toggle-fullscreen-btn";
        button_screen.title = "Enter fullscreen mode";
        button_screen.onclick = function () {
            parent.fullscreen();
        };

        var button_sub_graph = iframeDoc.createElement('button');
        button_sub_graph.type = "button";
        button_sub_graph.innerHTML = "Generate Sub graph<br>for selected Techniques";
        button_sub_graph.className = "btn btn-outline-secondary";
        button_sub_graph.style = "margin-right: 5px; color: white; font-size: 9pt;";
        button_sub_graph.onclick = function () {
            parent.show_modal();
        };

        div_sub_graph.className = "mat-mdc-tooltip-trigger control-row-button noselect";
        div_sub_graph.style = "display: inline-flex; margin-top: 5px;";

        var button_unselect = iframeDoc.createElement('button');
        button_unselect.type = "button";
        button_unselect.className = "btn btn-outline-secondary";
        button_unselect.style = "color: white; font-size: 9pt;";
        button_unselect.innerHTML = "Unselect all";
        button_unselect.onclick = function () {
            var selectionButtons = iframeDoc.getElementsByClassName("mat-mdc-tooltip-trigger control-row-button noselect");
            if (selectionButtons.length >= 3) {
                selectionButtons[2].click();
            }
        };

        var style_balise = iframeDoc.createElement('style');
        var bootstrap_style = iframeDoc.createElement('link');
        bootstrap_style.rel = "stylesheet";
        bootstrap_style.href = "https://cdn.jsdelivr.net/npm/bootstrap@5.1.0/dist/css/bootstrap.min.css";
        iframeDoc.head.appendChild(bootstrap_style);
        style_balise.innerHTML = `
            .toggle-fullscreen-btn {
                background: none;
                border: 0;
                padding: 0;
            }
            .toggle-fullscreen-svg path {
                transform-box: view-box;
                transform-origin: 12px 12px;
                fill: none;
                stroke: hsl(225, 10%, 8%);
                stroke-width: 4;
                transition: .15s;
            }
            .toggle-fullscreen-btn:hover path:nth-child(1),
            .toggle-fullscreen-btn:focus path:nth-child(1) {
                transform: translate(-2px, -2px);
            }
            .toggle-fullscreen-btn:hover path:nth-child(2),
            .toggle-fullscreen-btn:focus path:nth-child(2) {
                transform: translate(2px, -2px);
            }
            .toggle-fullscreen-btn:hover path:nth-child(3),
            .toggle-fullscreen-btn:focus path:nth-child(3) {
                transform: translate(2px, 2px);
            }
            .toggle-fullscreen-btn:hover path:nth-child(4),
            .toggle-fullscreen-btn:focus path:nth-child(4) {
                transform: translate(-2px, 2px);
            }
            .toggle-fullscreen-btn:not(.on) .icon-fullscreen-leave {
                display: none;
            }
            .toggle-fullscreen-btn.on .icon-fullscreen-enter {
                display: none;
            }
            .frame-full path {
                stroke: white;
            }
            .technique-cell:not([style*="color"]),
            .technique-cell:not([style*="color"]) * {
                color: white !important;
            }
        `;
        iframeDoc.head.appendChild(style_balise);
        div.style = "position: absolute; top: 12px; right:50px;";

        waitForAtlasElm('.help-header').then((elm) => {
            div.appendChild(button_screen);
            elm.appendChild(div);
        });
        waitForAtlasElm('.control-sections').then((elm) => {
            elm.style = elm.style + "margin-top: 5px;";
            var li_sub_graph = iframeDoc.createElement('li');
            li_sub_graph.className = "ng-star-inserted";
            div_sub_graph.appendChild(button_sub_graph);
            div_sub_graph.appendChild(button_unselect);
            li_sub_graph.appendChild(div_sub_graph);
            elm.insertBefore(li_sub_graph, elm.firstChild);
        });
    };
}
