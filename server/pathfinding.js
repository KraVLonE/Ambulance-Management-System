// Grid Constants (Must match frontend)
const ROWS = 12;
const COLS = 8;
const LAT_START = 30.7800;
const LAT_END = 30.6500;
const LNG_START = 76.7000;
const LNG_END = 76.8800;

const LAT_STEP = (LAT_END - LAT_START) / (ROWS - 1);
const LNG_STEP = (LNG_END - LNG_START) / (COLS - 1);

// Real Hospital Coordinates (Must match database/frontend)
const hospitalsData = [
    { id: 16, lat: 30.7130, lng: 76.7840 },
    { id: 25, lat: 30.7420, lng: 76.7260 },
    { id: 41, lat: 30.7260, lng: 76.7650 },
    { id: 49, lat: 30.6420, lng: 76.8160 },
    { id: 51, lat: 30.7070, lng: 76.7110 },
    { id: 53, lat: 30.7180, lng: 76.7580 },
    { id: 58, lat: 30.6970, lng: 76.8450 },
    { id: 59, lat: 30.6900, lng: 76.8700 },
    { id: 63, lat: 30.6940, lng: 76.7380 },
    { id: 67, lat: 30.7050, lng: 76.7950 },
    { id: 74, lat: 30.6750, lng: 76.7350 },
    { id: 96, lat: 30.6860, lng: 76.8550 }
];

const nodes = [];
const nodeCoords = {};

// 1. Generate Base Grid Coords
for (let col = 1; col <= COLS; col++) {
    for (let row = 1; row <= ROWS; row++) {
        const nodeId = (col - 1) * ROWS + row;
        const lat = LAT_START + (row - 1) * LAT_STEP;
        const lng = LNG_START + (col - 1) * LNG_STEP;
        nodeCoords[nodeId] = { lat, lng };
        nodes.push({ id: nodeId });
    }
}

// 2. Override with Real Hospital Coords
hospitalsData.forEach(h => {
    if (nodeCoords[h.id]) {
        nodeCoords[h.id] = { lat: h.lat, lng: h.lng };
    }
});

// Helper to calculate distance (Euclidean approximation for cost)
function getDistance(id1, id2) {
    const n1 = nodeCoords[id1];
    const n2 = nodeCoords[id2];
    if (!n1 || !n2) return Infinity;
    const dLat = n1.lat - n2.lat;
    const dLng = n1.lng - n2.lng;
    return Math.sqrt(dLat * dLat + dLng * dLng);
}

const edges = [];

for (let row = 1; row <= 12; row++) {
    for (let col = 1; col <= 8; col++) {
        const nodeId = (col - 1) * 12 + row;

        const leftNeighborId = nodeId - 1; 

        const northId = nodeId - 1;
        const southId = nodeId + 1;
        const westId = nodeId - 12;
        const eastId = nodeId + 12;

        // Check and add edges
        if (row > 1) {
            const cost = getDistance(nodeId, northId);
            edges.push({ from: nodeId, to: northId, cost: cost });
            edges.push({ from: northId, to: nodeId, cost: cost });
        }
        if (row < 12) {
            const cost = getDistance(nodeId, southId);
            edges.push({ from: nodeId, to: southId, cost: cost });
            edges.push({ from: southId, to: nodeId, cost: cost });
        }
        if (col < 8) {
            const cost = getDistance(nodeId, eastId);
            edges.push({ from: nodeId, to: eastId, cost: cost });
            edges.push({ from: eastId, to: nodeId, cost: cost });
        }
    }
}

function dijkstra(startNode, endNode) {
    const graph = {};
    for (const edge of edges) {
        if (!graph[edge.from]) graph[edge.from] = [];
        if (!graph[edge.to]) graph[edge.to] = [];
        graph[edge.from].push({ to: edge.to, cost: edge.cost });
        graph[edge.to].push({ to: edge.from, cost: edge.cost }); // Ensure undirected
    }

    const visited = {};
    const distances = {};
    const previousNodes = {};

    for (let i = 1; i <= 96; i++) {
        distances[i] = Infinity;
        previousNodes[i] = null;
    }
    distances[startNode] = 0;

    const unvisited = new Set();
    for (let i = 1; i <= 96; i++) unvisited.add(i);

    while (unvisited.size > 0) {
        let closestNode = null;
        let closestDistance = Infinity;

        for (const node of unvisited) {
            if (distances[node] < closestDistance) {
                closestNode = node;
                closestDistance = distances[node];
            }
        }

        if (closestNode === null || closestDistance === Infinity) break;
        if (parseInt(closestNode) === parseInt(endNode)) break;

        unvisited.delete(closestNode);
        visited[closestNode] = true;

        if (graph[closestNode]) {
            for (const neighbor of graph[closestNode]) {
                if (visited[neighbor.to]) continue;

                const potentialDistance = distances[closestNode] + neighbor.cost;

                if (potentialDistance < distances[neighbor.to]) {
                    distances[neighbor.to] = potentialDistance;
                    previousNodes[neighbor.to] = closestNode;
                }
            }
        }
    }

    const shortestPath = [];
    let currentNode = endNode;
    while (currentNode !== null && currentNode !== undefined) {
        shortestPath.unshift(parseInt(currentNode));
        currentNode = previousNodes[currentNode];
        if (parseInt(currentNode) === parseInt(startNode)) {
            shortestPath.unshift(parseInt(currentNode));
            break;
        }
    }

    // If path doesn't start with startNode, it means no path found (unless start==end)
    if (shortestPath[0] !== parseInt(startNode) && parseInt(startNode) !== parseInt(endNode)) {
        return { shortestPath: [], pathLength: Infinity, numberOfNodes: 0 };
    }

    const pathLength = distances[endNode];

    return {
        shortestPath,
        pathLength,
        numberOfNodes: shortestPath.length,
    };
}

module.exports = {
    dijkstra, // Keep for now if needed, or remove if fully replacing
    nodeCoords
};
