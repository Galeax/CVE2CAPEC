// ===== MITRE ATT&CK FUNCTIONS =====

async function create_mitre_layer() {
    var data_layer = {};
    
    // Get the list of techniques, some node.to maybe null
    var techniques_list = chart.getOption().series[0].links;
    var max_score = 0;
    var layer_type_raw = document.getElementById('layer_type').value;
    var wantDefend     = (layer_type_raw === 'enterprise-defend');
    var layer_type     = wantDefend ? 'enterprise' : layer_type_raw;   
    var enterprise_plateform = ["Windows", "Linux", "macOS", "Network", "PRE", "Containers", "Office 365", "SaaS", "Google Workspace", "IaaS", "Azure AD"];
    var mobile_plateform = ["Android", "iOS"];
    var ics_plateform = ["None"];

    for (var i = 0; i < techniques_list.length; i++) {
        var element = techniques_list[i];
        var technique = element.target;
        var score = element.value;
        if (!data_layer[technique]) {
            data_layer[technique] = score;
        } else {
            data_layer[technique] += score;
        }
    }

    var tmp = Object.assign({}, data_layer);
    for (var key in tmp) {
        if (key.match(/T\d+\.\d+/)) {
            var parent = key.split('.')[0];
            if (data_layer[parent]) {
                data_layer[parent] += data_layer[key];
            } else {
                data_layer[parent] = data_layer[key];
            }
        }
    }
    
    // Calculate the max score, max score is the highest score of a technique or subtechnique
    for (var key in data_layer) {
        var score = data_layer[key];
        if (score > max_score) {
            max_score = score;
        }
    }

    var layer = {
        "name": "CVE2CAPEC - New CVEs layer",
        "versions": {
            "attack": "18",
            "navigator": "5.1.0",
            "layer": "4.5"
        },
        "domain": layer_type + "-attack",
        "description": "",
        "filters": {
            "platforms": layer_type === "enterprise" ? enterprise_plateform : layer_type === "mobile" ? mobile_plateform : ics_plateform,
        },
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
        "selectSubtechniquesWithParent": false,
        "selectVisibleTechniques": false,
    };

    try {
        var response = await fetch('https://raw.githubusercontent.com/Galeax/CVE2CAPEC/refs/heads/main/resources/techniques_db.json');
        var responseText = await response.text();
    } catch (error) {
        console.error(error);
        Swal.fire({
            icon: 'error',
            title: 'An error occurred',
            text: 'Failed to fetch the techniques database',
        });
        return;
    }

    var techniques_db = JSON.parse(responseText);

    for (var key in data_layer) {
        var tactics = techniques_db[key];
        if (!tactics) {
            continue;
        }
        for (var j = 0; j < tactics.length; j++) {
            var tactic = tactics[j];
            var row = {
                "techniqueID": key,
                "tactic": tactic.toLowerCase().replaceAll(' ', '-'),
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
    }

    localStorage.setItem('layer', JSON.stringify(layer));
}

// Function to update ATT&CK statistics
function updateAttackStats() {
    const layer = localStorage.getItem('layer');
    if (!layer) return;
    
    try {
        const layerData = JSON.parse(layer);
        const techniques = layerData.techniques || [];
        
        // Count unique techniques
        const uniqueTechniques = new Set();
        let totalHits = 0;
        
        techniques.forEach(tech => {
            if (tech.score && tech.score > 0) {
                uniqueTechniques.add(tech.techniqueID);
                totalHits += tech.score;
            }
        });
        
        // Update the display
        document.getElementById('attack-techniques-count').textContent = uniqueTechniques.size;
        document.getElementById('attack-hits-count').textContent = totalHits;
        document.getElementById('attack-summary').style.display = 'block';
        
    } catch (e) {
        console.error('Error updating ATT&CK stats:', e);
    }
}

function waitForElm(selector) {
    return new Promise(resolve => {
        if (document.getElementById('mitre').contentWindow.document.querySelector(selector)) {
            return resolve(document.getElementById('mitre').contentWindow.document.querySelector(selector));
        }

        const observer = new MutationObserver(mutations => {
            if (document.getElementById('mitre').contentWindow.document.querySelector(selector)) {
                observer.disconnect();
                resolve(document.getElementById('mitre').contentWindow.document.querySelector(selector));
            }
        });

        // If you get "parameter 1 is not of type 'Node'" error, see https://stackoverflow.com/a/77855838/492336
        observer.observe(document.getElementById('mitre').contentWindow.document.body, {
            childList: true,
            subtree: true
        });
    });
}

async function print_mitre() {
    var layer = localStorage.getItem('layer');
    if (!layer) {
        Swal.fire({
            icon: 'warning',
            title: 'No layer found',
            text: 'Please enter CVEs and click on Process first.',
        });
        return;
    }
    
    // add iframe to display the MITRE ATT&CK matrix
    if (document.getElementById('mitre')) {
        document.getElementById('mitre').remove();
    }
    var iframe = document.createElement('iframe');
    iframe.src = 'mitre/';
    iframe.id = "mitre";
    iframe.allowFullscreen = true;
    iframe.style.width = "100%";
    iframe.style.height = "800px";
    iframe.style.border = "none";

    document.getElementById('frame').appendChild(iframe);
    document.getElementById('frame').hidden = false;

    iframe.onload = function() {
        // Vérifier si on peut accéder au contenu de l'iframe
        var iframe = document.getElementById('mitre');
        var iframeDoc = iframe.contentWindow.document;

        // Créer le bouton dynamiquement
        var div = iframeDoc.createElement('div');
        var div_sub_graph = iframeDoc.createElement('div');

        var button_screen = iframeDoc.createElement('button');

        button_screen.innerHTML = '<svg class="toggle-fullscreen-svg frame-full" width="28" height="28" viewBox="-2 -2 28 28"><g class="icon-fullscreen-enter"><path d="M 2 9 v -7 h 7" /><path d="M 22 9 v -7 h -7" /><path d="M 22 15 v 7 h -7" /><path d="M 2 15 v 7 h 7" /></g><g class="icon-fullscreen-leave"><path d="M 24 17 h -7 v 7" /><path d="M 0 17 h 7 v 7" /><path d="M 0 7 h 7 v -7" /><path d="M 24 7 h -7 v -7" /></g></svg>';
        button_screen.className = "js-toggle-fullscreen-btn toggle-fullscreen-btn";
        button_screen.title = "Enter fullscreen mode";
        button_screen.onclick = function() {
            parent.fullscreen();
        };

        var button_sub_graph = iframeDoc.createElement('button');

        button_sub_graph.type = "button";
        button_sub_graph.innerHTML = "Generate Sub graph<br>for selected Techniques";
        button_sub_graph.className = "btn btn-outline-secondary";
        button_sub_graph.style = "margin-right: 5px; color: white; font-size: 9pt;";
        button_sub_graph.onclick = function() {
            parent.show_modal();
        };

        div_sub_graph.className = "mat-mdc-tooltip-trigger control-row-button noselect";
        div_sub_graph.style = "display: inline-flex; margin-top: 5px;";

        var button_unselect = iframeDoc.createElement('button');

        button_unselect.type = "button";
        button_unselect.className = "btn btn-outline-secondary";
        button_unselect.style = "color: white; font-size: 9pt;";
        button_unselect.innerHTML = "Unselect all";
        button_unselect.onclick = function() {
            iframeDoc.getElementsByClassName("mat-mdc-tooltip-trigger control-row-button noselect")[2].click();
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
        `;
        iframeDoc.head.appendChild(style_balise);
        div.style = "position: absolute; top: 12px; right:50px;";

        waitForElm('.help-header').then((elm) => {
            div.appendChild(button_screen);
            elm.appendChild(div); 
        });
        waitForElm('.control-sections').then((elm) => {
            // ajoute un style à elm
            elm.style = elm.style + "margin-top: 5px;";
            var li_sub_graph = iframeDoc.createElement('li');
            li_sub_graph.className = "ng-star-inserted";
            div_sub_graph.appendChild(button_sub_graph);
            div_sub_graph.appendChild(button_unselect);
            li_sub_graph.appendChild(div_sub_graph);
            // add tmp as first child of elm
            elm.insertBefore(li_sub_graph, elm.firstChild);
        });
    };
}
