const NUM_TRUCKS = 5000;
const TICK_RATE_MS = 5000;

// Geofencing: Statewide Expansion of São Paulo
// Mathematically bounded to prevent Ocean generation (Coastline eq: lat >= 0.52 * lng)
const INLAND_MIN_LNG = -53.2; // Pres. Epitácio
const INLAND_MAX_LNG = -44.1; // Ubatuba
const INLAND_MIN_LAT = -25.3; // Cananéia
const INLAND_MAX_LAT = -19.7; // Populina/MG Border
const CENTER_LAT = -22.5; 
const CENTER_LNG = -48.65; 
const STATE_ZOOM = 6.0;

// Application State
let trucks = [];
let kpi = {
    errors: 0,
    costPerHour: 150000,
    fuelSaved: 0,
    efficiency: 100.0,
    prevCost: 150000
};

// Context Integration
let selectedTruckId = null;
let currentZoom = STATE_ZOOM;

// Traffic Zones (Inland area, e.g., Campinas region)
const TRAFFIC_LNG = -47.06;
const TRAFFIC_LAT = -22.90;
let trafficActive = false;
let trafficPoints = []; 

const STATUS = {
    NORMAL: 'NORMAL',
    MECHANICAL_FAILURE: 'MECHANICAL_FAILURE',
    CONNECTION_LOST: 'CONNECTION_LOST',
    ROUTE_DEVIATION: 'ROUTE_DEVIATION',
    TRAFFIC_DELAY: 'TRAFFIC_DELAY' 
};

// DOM Refs
const alertLog = document.getElementById('alert-log');
const telemetryPanel = document.getElementById('telemetry-panel');

// Framework Instances
const map = new maplibregl.Map({
    container: 'map',
    style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
    center: [CENTER_LNG, CENTER_LAT],
    zoom: STATE_ZOOM - 1, // maplibre translates deckgl implicitly
    pitch: 45,
    bearing: 0,
    interactive: false
});

const clusterIndex = new Supercluster({
    maxZoom: 13,
    radius: 60,
    map: (props) => ({ errs: (props.status === STATUS.MECHANICAL_FAILURE || props.status === STATUS.CONNECTION_LOST) ? 1 : 0 }),
    reduce: (accumulated, props) => { accumulated.errs += props.errs; }
});

const deckGl = new deck.Deck({
    canvas: 'deck-canvas',
    initialViewState: { longitude: CENTER_LNG, latitude: CENTER_LAT, zoom: STATE_ZOOM, pitch: 45, bearing: 0 },
    controller: true,
    onViewStateChange: ({viewState}) => {
        currentZoom = viewState.zoom;
        map.jumpTo({ center: [viewState.longitude, viewState.latitude], zoom: viewState.zoom, bearing: viewState.bearing, pitch: viewState.pitch });
        updateClusters();
    },
    layers: []
});

// Chart.js Context
const ctx = document.getElementById('efficiency-chart').getContext('2d');
const chartHistory = { labels: [], data: [], events: [] };
for(let i=0; i<30; i++) { chartHistory.labels.push(''); chartHistory.data.push(100); chartHistory.events.push(null); }

const effChart = new Chart(ctx, {
    type: 'line',
    data: {
        labels: chartHistory.labels,
        datasets: [{
            label: 'Eficiência %',
            data: chartHistory.data,
            borderColor: '#FF6600',
            backgroundColor: (context) => {
                const grad = context.chart.ctx.createLinearGradient(0, 0, 0, 200);
                grad.addColorStop(0, 'rgba(255, 102, 0, 0.4)');
                grad.addColorStop(1, 'rgba(255, 102, 0, 0.0)');
                return grad;
            },
            borderWidth: 2,
            pointRadius: (ctx) => chartHistory.events[ctx.dataIndex] ? 8 : 0, 
            pointBackgroundColor: '#FFF',
            pointBorderColor: '#FF6600',
            pointBorderWidth: 2,
            fill: true,
            tension: 0.3
        }]
    },
    options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: 300, easing: 'easeOutQuart' },
        layout: { padding: { top: 10, bottom: 5, left: -5, right: 10 } },
        scales: {
            y: { min: 80, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: '#666', font: { family: 'monospace', size: 10 } } },
            x: { grid: { display: false }, ticks: { display: false } }
        },
        plugins: {
            legend: { display: false },
            tooltip: {
                backgroundColor: 'rgba(5,5,5,0.95)',
                titleFont: { family: 'monospace', size: 11 },
                bodyFont: { family: 'monospace', size: 14, weight: 'bold' },
                borderColor: '#444',
                borderWidth: 1,
                callbacks: {
                    label: (context) => {
                        const val = `Eficiência: ${context.parsed.y.toFixed(1)}%`;
                        const evt = chartHistory.events[context.dataIndex];
                        return evt ? [val, '', `⚡ Evento Crítico Registrado: ${evt}`] : val;
                    }
                }
            }
        }
    }
});

function addChartEvent(eventName) {
    chartHistory.events[chartHistory.events.length - 1] = eventName;
}

// Global Logging
function addLog(msg, type = 'info') {
    const div = document.createElement('div');
    const time = new Date().toLocaleTimeString('pt-BR', { hour12: false });
    
    let icon = `<i class="ph-bold ph-info text-blue-400"></i>`;
    let colorClass = 'text-gray-300 border-l border-blue-500/30';
    let bgClass = 'bg-blue-900/10';
    
    if (type === 'error') {
        icon = `<i class="ph-fill ph-warning-circle text-red-500"></i>`;
        colorClass = 'text-red-300 border-l-[3px] border-red-500';
        bgClass = 'bg-red-900/20';
    } else if (type === 'warning') {
        icon = `<i class="ph-fill ph-warning text-yellow-500"></i>`;
        colorClass = 'text-amber-300 border-l-[3px] border-yellow-500';
        bgClass = 'bg-yellow-900/10';
    } else if (type === 'success') {
        icon = `<i class="ph-fill ph-check-circle text-green-500"></i>`;
        colorClass = 'text-green-300 border-l-[3px] border-green-500';
        bgClass = 'bg-green-900/10';
    }
    
    div.className = `alert-entry shrink-0 ${colorClass} ${bgClass} p-2 rounded mb-1.5 flex items-start gap-2 border-[0.5px] border-gray-800`;
    div.innerHTML = `
        <div class="mt-0.5 text-base border-r border-gray-700/50 pr-2">${icon}</div>
        <div class="flex-1">
            <span class="text-[9px] text-gray-500 w-12 tracking-tighter mr-2 font-bold">[${time}]</span>
            <span class="tracking-wide">${msg}</span>
        </div>
    `;
    
    alertLog.appendChild(div);
    if(alertLog.childElementCount > 60) alertLog.removeChild(alertLog.firstChild);
    alertLog.scrollTop = alertLog.scrollHeight;
}

const rand = (min, max) => Math.random() * (max - min) + min;

// Validates strictly to SP State bounds AND ensures lat >= 0.52 * lng (Mathematical Ocean Evasion)
function getReliableInlandPoint() {
    let lng, lat;
    do {
        lng = rand(INLAND_MIN_LNG, INLAND_MAX_LNG);
        lat = rand(INLAND_MIN_LAT, INLAND_MAX_LAT);
    } while (lat < 0.52 * lng); // Ocean Check boundary Ubatuba-Iguape
    
    return [lng, lat];
}

// Initializer
function init() {
    addLog('Booting EDA stream: Expansão Massiva em Todo Estado de São Paulo efetuada...', 'info');
    
    for (let i = 0; i < NUM_TRUCKS; i++) {
        trucks.push({
            id: `TRK-${i.toString().padStart(4,'0')}`,
            position: getReliableInlandPoint(),
            destination: getReliableInlandPoint(),
            speed: rand(45, 95),
            fuel: rand(20, 100),
            temp: rand(18, 23),
            status: STATUS.NORMAL,
        });
    }

    for(let i=0; i<800; i++) {
        trafficPoints.push({ position: [TRAFFIC_LNG + rand(-0.35, 0.35), TRAFFIC_LAT + rand(-0.35, 0.35)] });
    }

    updateClusters();
    addLog('Malha SP Integral Ativa. Litoral matematicamente blindado.', 'success');
    setInterval(logicTick, TICK_RATE_MS);
    requestAnimationFrame(renderLoop);
}

// Logic Brain
function logicTick() {
    let errCount = 0;
    let cost = 150000;
    
    trucks.forEach(t => {
        if(t.status === STATUS.NORMAL || t.status === STATUS.TRAFFIC_DELAY || t.status === STATUS.ROUTE_DEVIATION) {
            
            if (t.status === STATUS.TRAFFIC_DELAY && !trafficActive) t.status = STATUS.NORMAL;

            let currentSpeed = t.speed;
            if (trafficActive) {
                const distToTraffic = Math.sqrt(Math.pow(t.position[0]-TRAFFIC_LNG, 2) + Math.pow(t.position[1]-TRAFFIC_LAT, 2));
                if (distToTraffic < 0.45) {
                    if (t.status === STATUS.NORMAL) {
                        t.status = STATUS.TRAFFIC_DELAY;
                    }
                    currentSpeed *= 0.10; 
                }
            }

            const dx = t.destination[0] - t.position[0];
            const dy = t.destination[1] - t.position[1];
            const dist = Math.sqrt(dx*dx + dy*dy);
            
            if (dist < 0.005) {
                t.destination = getReliableInlandPoint(); 
                if(t.status === STATUS.NORMAL) kpi.fuelSaved += rand(5, 20);
            } else {
                const moveModifier = currentSpeed * 0.0001; 
                t.position[0] += (dx / dist) * moveModifier;
                t.position[1] += (dy / dist) * moveModifier;
                t.fuel = Math.max(0, t.fuel - 0.08);
                if(t.fuel <= 0) t.fuel = 100;
                
                t.temp += rand(-0.2, 0.2);
                if(t.temp < 15) t.temp = 15;
                if(t.temp > 28) t.temp = 28;
            }

            // Real-time Oceanic Check (Strict execution)
            if (t.position[1] < 0.52 * t.position[0] || t.position[0] > INLAND_MAX_LNG || t.position[0] < INLAND_MIN_LNG || t.position[1] > INLAND_MAX_LAT) {
                t.position = getReliableInlandPoint();
                t.destination = getReliableInlandPoint();
            }

            // Organic Randomness
            const r = Math.random();
            if (r < 0.0001 && t.status === STATUS.NORMAL && !trafficActive) {
                t.status = STATUS.ROUTE_DEVIATION;
            } else if (r < 0.00005) {
                t.status = STATUS.CONNECTION_LOST;
                addLog(`PERDA TOTAL BLUETOOTH: Sinal perdido de ${t.id}`, 'warning');
            }
        }
        
        if (t.status === STATUS.MECHANICAL_FAILURE) { errCount++; cost += 1500; }
        if (t.status === STATUS.CONNECTION_LOST) { errCount++; cost += 500; }
        if (t.status === STATUS.ROUTE_DEVIATION) { cost += 200; }
        if (t.status === STATUS.TRAFFIC_DELAY) { cost += 800; } 
    });

    kpi.prevCost = kpi.costPerHour;

    kpi.errors = errCount;
    kpi.costPerHour = cost;
    kpi.efficiency = 100 - (errCount / NUM_TRUCKS * 100) - (trafficActive ? 6 : 0);
    
    chartHistory.data.push(kpi.efficiency);
    chartHistory.events.push(null); 
    chartHistory.data.shift();
    chartHistory.events.shift();
    effChart.update();

    updateDOMKPIs();
    updateClusters(); 
    
    if (selectedTruckId) {
        const trk = trucks.find(t => t.id === selectedTruckId);
        if(trk) renderTelemetry(trk);
    }
}

function updateDOMKPIs() {
    document.getElementById('kpi-errors').innerText = kpi.errors;
    document.getElementById('kpi-cost').innerText = `R$ ${(kpi.costPerHour).toLocaleString('pt-BR')}`;
    document.getElementById('kpi-economy').innerText = `+R$ ${Math.floor(kpi.fuelSaved).toLocaleString('pt-BR')}`;
    
    const trCost = document.getElementById('trend-cost');
    if (kpi.costPerHour > kpi.prevCost) {
        trCost.className = "ph-bold ph-trend-up text-red-500 text-sm";
    } else if (kpi.costPerHour < kpi.prevCost) {
        trCost.className = "ph-bold ph-trend-down text-green-500 text-sm";
    }
}

let clusterData = [];
function updateClusters() {
    const geoJsonFeatures = trucks.map(t => ({
        type: 'Feature',
        properties: { cluster: false, id: t.id, status: t.status },
        geometry: { type: 'Point', coordinates: t.position }
    }));
    
    clusterIndex.load(geoJsonFeatures);
    clusterData = clusterIndex.getClusters([-180, -90, 180, 90], Math.floor(currentZoom));
}

// Render Pipeline
function renderLoop() {
    const tPulse = Date.now() / 400;
    const pulseRed = [255, Math.sin(tPulse) * 100, Math.sin(tPulse) * 100];

    const getColor = (status) => {
        if(status === STATUS.MECHANICAL_FAILURE) return [220, 38, 38]; 
        if(status === STATUS.ROUTE_DEVIATION) return [249, 115, 22]; 
        if(status === STATUS.CONNECTION_LOST) return [250, 204, 21]; 
        if(status === STATUS.TRAFFIC_DELAY) return [251, 113, 133]; 
        return [34, 197, 94]; 
    };

    const scatterData = [];
    const textData = [];

    clusterData.forEach(c => {
        if (c.properties.cluster) {
            const errRatio = c.properties.errs / c.properties.point_count;
            const hasHighErrs = errRatio > 0.05;
            
            scatterData.push({
                position: c.geometry.coordinates,
                radius: 20 + Math.log(c.properties.point_count)*5,
                color: hasHighErrs ? pulseRed : [249, 115, 22, 190], 
                stc: hasHighErrs ? [255,0,0,255] : [255,102,0,255],
                isCluster: true
            });
            textData.push({
                position: c.geometry.coordinates,
                text: c.properties.point_count_abbreviated,
            });
        } else {
            let renderColor = getColor(c.properties.status);
            
            if (c.properties.id === selectedTruckId) {
                renderColor = [34, 211, 238, 255];
            }

            scatterData.push({
                position: c.geometry.coordinates,
                radius: (c.properties.id === selectedTruckId) ? 25 : 15, 
                color: renderColor,
                stc: renderColor,
                id: c.properties.id,
                isCluster: false,
                status: c.properties.status
            });
        }
    });

    const layers = [];

    // Traffic Zone visual heat region
    if (trafficActive) {
        layers.push(new deck.ScatterplotLayer({
            id: 'traffic-layer',
            data: trafficPoints,
            getPosition: d => d.position,
            getFillColor: [220, 38, 38, 60],
            getRadius: 800,
            radiusUnits: 'meters'
        }));
    }

    // Active Highlight Route Flow
    if (selectedTruckId) {
        const tk = trucks.find(x => x.id === selectedTruckId);
        if (tk) {
            layers.push(new deck.LineLayer({
                id: 'active-route',
                data: [{ source: tk.position, target: tk.destination }],
                getSourcePosition: d => d.source,
                getTargetPosition: d => d.target,
                getColor: [34, 211, 238, 255],
                getWidth: 6
            }));
            
            layers.push(new deck.ScatterplotLayer({
                id: 'target-halo',
                data: [tk],
                getPosition: d => d.position,
                getFillColor: [34, 211, 238, 50],
                getLineColor: [34, 211, 238, 255],
                lineWidthMinPixels: 2,
                stroked: true,
                radiusScale: 1,
                getRadius: 60 + Math.sin(tPulse)*15,
                radiusMinPixels: 20
            }));
        }
    }

    layers.push(new deck.ScatterplotLayer({
        id: 'truck-points',
        data: scatterData,
        pickable: true,
        opacity: 1,
        stroked: true,
        getLineWidth: 2,
        getLineColor: [0,0,0, 255],
        radiusScale: 1,
        radiusMinPixels: 6, 
        radiusMaxPixels: 110, 
        updateTriggers: {
            getFillColor: [selectedTruckId, tPulse],
            getRadius: [selectedTruckId]
        },
        getPosition: d => d.position,
        getFillColor: d => d.color,
        getRadius: d => d.radius,
        onClick: (info) => {
            if (info.object && !info.object.isCluster) {
                inspectVehicle(info.object.id);
            }
        }
    }));

    layers.push(new deck.TextLayer({
        id: 'cluster-text',
        data: textData,
        getPosition: d => d.position,
        getText: d => d.text,
        getSize: 14,
        getColor: [255, 255, 255],
        fontFamily: 'monospace',
        fontWeight: 'bold'
    }));
    
    deckGl.setProps({ layers });
    requestAnimationFrame(renderLoop);
}

// Global Commands
function inspectVehicle(id) {
    selectedTruckId = id;
    telemetryPanel.classList.add('animate-glow-cyan'); 

    const tk = trucks.find(x => x.id === id);
    if(tk) renderTelemetry(tk);

    flyCameraTo(tk.position[0], tk.position[1], 11);
}

window.simControls = {
    cancelInspection: () => {
        selectedTruckId = null;
        
        telemetryPanel.classList.remove('animate-glow-cyan');
        telemetryPanel.classList.remove('animate-flash-red');
        
        telemetryPanel.innerHTML = `
            <div class="text-[10px] font-bold uppercase tracking-widest text-gray-500 absolute top-4 left-4">Status</div>
            <div class="text-center text-gray-600 py-10 italic flex flex-col items-center gap-3">
                <div class="relative"><i class="ph border border-dashed border-gray-700 rounded-full p-4 ph-crosshair text-4xl text-gray-700 animate-spin-slow"></i></div>
                <span class="text-[11px] uppercase tracking-widest">Visão Global (Nenhum Alvo)</span>
            </div>
        `;
    },

    forceFailures: () => {
        let i = 0;
        let firstFailPos = null;
        trucks.forEach(t => {
            if(t.status === STATUS.NORMAL && i < 5) {
                t.status = STATUS.MECHANICAL_FAILURE;
                if(i===0) firstFailPos = t.position;
                addLog(`CRÍTICO DANO: Múltiplas falhas mecânicas iniciadas. ${t.id} comprometido.`, 'error');
                i++;
            }
        });
        addChartEvent('Estresse Crítico Múltiplo');
        logicTick(); 
        
        if (firstFailPos) flyCameraTo(firstFailPos[0], firstFailPos[1], 10);
    },

    forceTraffic: () => {
        trafficActive = true;
        addLog(`RISCO REGIONAL: Retenção severa imposta via Comando Tático na zona viária central!`, 'error');
        addChartEvent('Colapso Viário Manual');
        logicTick();
        flyCameraTo(TRAFFIC_LNG, TRAFFIC_LAT, 8.5);
    },

    clearTraffic: () => {
        trafficActive = false;
        trucks.forEach(t => {
            if(t.status !== STATUS.NORMAL) t.status = STATUS.NORMAL;
        });
        addLog(`COMANDO MESTRE: Malha total normalizada com sucesso.`, 'success');
        addChartEvent('Normalização Definitiva');
        logicTick();
    },

    // Interactive Legend API Extension
    findByStatus: (statusValue) => {
        const matches = trucks.filter(t => t.status === statusValue);
        if (matches.length > 0) {
            const randomPick = matches[Math.floor(Math.random() * matches.length)];
            addLog(`SISTEMA DE BUSCA: Analisando anomalia tipo ${statusValue}. Alvo ${randomPick.id} encontrado.`, 'info');
            inspectVehicle(randomPick.id);
        } else {
            addLog(`SISTEMA DE BUSCA: Nenhum evento '${statusValue}' registrado na malha neste momento.`, 'warning');
        }
    },

    globalView: () => {
        window.simControls.cancelInspection();
        addLog(`Visão restabelecida: Retornando ao panorama unificado do Estado de São Paulo.`, 'info');
        flyCameraTo(CENTER_LNG, CENTER_LAT, STATE_ZOOM);
    }
};

function flyCameraTo(lng, lat, zoomTarget) {
    deckGl.setProps({
        initialViewState: { longitude: lng, latitude: lat, zoom: zoomTarget, pitch: 50, bearing: 0, transitionDuration: 1800, transitionInterpolator: new deck.FlyToInterpolator() }
    });
}

// Side Panel Render Complete Map
function renderTelemetry(t) {
    const distToDest = Math.sqrt(Math.pow(t.destination[0]-t.position[0], 2) + Math.pow(t.destination[1]-t.position[1], 2));
    const etaMin = Math.max(1, Math.floor((distToDest / 0.005) * 5 / 60));

    let statusRender = `<span class="px-2 py-0.5 text-[9px] uppercase tracking-widest rounded bg-green-900 border border-green-500 text-green-300 shadow-[0_0_10px_rgba(34,197,94,0.3)]"><i class="ph-fill ph-check-circle mr-1"></i>Estável</span>`;
    
    if(t.status === STATUS.MECHANICAL_FAILURE) statusRender = `<span class="px-2 py-0.5 text-[9px] uppercase font-bold tracking-widest rounded bg-red-900 border border-red-500 text-red-100 animate-pulse shadow-[0_0_15px_rgba(220,38,38,0.8)]"><i class="ph-bold ph-warning-octagon mr-1"></i>Falha Mecânica</span>`;
    if(t.status === STATUS.CONNECTION_LOST) statusRender = `<span class="px-2 py-0.5 text-[9px] uppercase tracking-widest rounded bg-yellow-900 border border-yellow-500 text-yellow-300"><i class="ph-bold ph-wifi-slash mr-1"></i>Sinal Perdido</span>`;
    if(t.status === STATUS.ROUTE_DEVIATION) statusRender = `<span class="px-2 py-0.5 text-[9px] uppercase tracking-widest rounded bg-orange-900 border border-orange-500 text-orange-200"><i class="ph-bold ph-arrows-split mr-1"></i>Desvio</span>`;
    if(t.status === STATUS.TRAFFIC_DELAY) statusRender = `<span class="px-2 py-0.5 text-[9px] uppercase tracking-widest rounded bg-rose-900 border border-rose-500 text-rose-200"><i class="ph-bold ph-traffic-sign mr-1"></i>Retenção Acionada</span>`;
    
    telemetryPanel.innerHTML = `
        <div class="absolute top-3 right-4 z-50">
            <button onclick="window.simControls.cancelInspection()" class="bg-gray-800/80 hover:bg-gray-700 hover:text-white border border-gray-600 text-gray-300 rounded px-2 py-1 text-[9px] uppercase tracking-widest flex items-center gap-1 transition-all"><i class="ph-bold ph-x"></i> Limpar Seleção</button>
        </div>

        <div class="flex justify-between items-start mb-5 border-b border-gray-800 pb-3 mt-3">
            <div>
                <h3 class="font-bold text-3xl text-cyan-400 tracking-widest font-mono drop-shadow-[0_0_8px_rgba(34,211,238,0.5)]">${t.id}</h3>
                <div class="mt-2">${statusRender}</div>
            </div>
            <i class="ph-fill ph-truck text-4xl text-gray-600 drop-shadow-lg"></i>
        </div>
        
        <div class="grid grid-cols-2 gap-4 mb-5">
            <div class="border border-cyan-900/60 rounded p-3 bg-black shadow-[inset_0_2px_15px_rgba(34,211,238,0.1)] flex flex-col justify-center items-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1"><i class="ph-bold ph-speedometer"></i>Velocidade Global</div>
                <div class="font-mono text-3xl font-black text-white tracking-wider">${Math.floor(t.speed)} <span class="text-xs text-gray-500 font-bold">km/h</span></div>
            </div>
            <div class="border border-purple-900/50 rounded p-3 bg-black shadow-[inset_0_2px_15px_rgba(168,85,247,0.1)] flex flex-col justify-center items-center">
                <div class="text-[10px] text-gray-500 uppercase tracking-widest mb-1 flex items-center gap-1"><i class="ph-bold ph-thermometer"></i>Compartimento Frio</div>
                <div class="font-mono text-3xl font-black text-purple-400 tracking-wider drop-shadow-[0_0_5px_rgba(168,85,247,0.5)]">${t.temp.toFixed(1)}<span class="text-xs text-gray-500 font-bold">ºC</span></div>
            </div>
        </div>

        <div class="space-y-4 text-xs font-mono mb-2 bg-[#080808] p-5 rounded-xl border border-gray-800/80 shadow-lg">
            <div class="flex flex-col gap-1.5 group">
                <div class="flex justify-between items-center">
                    <span class="text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2 transition-colors"><i class="ph-fill ph-gas-pump text-lg"></i> Nível Energético do Tanque:</span> 
                    <span class="text-${t.fuel < 20 ? 'red' : 'green'}-400 font-black tracking-wider text-base">${t.fuel.toFixed(1)}%</span>
                </div>
                <div class="w-full bg-gray-900 h-2.5 rounded-full overflow-hidden shadow-inner border border-gray-800">
                    <div class="bg-${t.fuel < 20 ? 'red' : 'green'}-500 h-full shadow-[0_0_10px_currentColor]" style="width: ${t.fuel}%"></div>
                </div>
            </div>
            
            <div class="flex justify-between items-center pt-3 border-t border-gray-800/80">
                <span class="text-gray-400 font-bold uppercase tracking-widest flex items-center gap-2"><i class="ph-bold ph-hourglass-high text-lg"></i> ETA Calculado Pelo Motor:</span> 
                <span class="text-white tracking-widest font-black text-sm bg-gray-800 px-3 py-1 rounded">~${etaMin} min</span>
            </div>
        </div>
    `;
    
    if (t.status === STATUS.MECHANICAL_FAILURE) {
        telemetryPanel.classList.remove('animate-glow-cyan');
        telemetryPanel.classList.add('animate-flash-red');
    } else {
        telemetryPanel.classList.remove('animate-flash-red');
    }
}

// Start Main Kernel
map.on('load', () => init());
