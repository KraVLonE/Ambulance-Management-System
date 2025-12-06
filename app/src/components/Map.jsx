import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Extracted coordinates from index.html to match the visual map exactly
const NODE_COORDS = {
    "1": { "x": 4.545454545454546, "y": 5.555555555555555 },
    "2": { "x": 13.636363636363637, "y": 5.555555555555555 },
    "3": { "x": 22.727272727272727, "y": 5.555555555555555 },
    "4": { "x": 31.818181818181817, "y": 5.555555555555555 },
    "5": { "x": 40.90909090909091, "y": 5.555555555555555 },
    "6": { "x": 50, "y": 5.555555555555555 },
    "7": { "x": 59.09090909090909, "y": 5.555555555555555 },
    "8": { "x": 68.18181818181819, "y": 5.555555555555555 },
    "9": { "x": 77.27272727272727, "y": 5.555555555555555 },
    "10": { "x": 86.36363636363636, "y": 5.555555555555555 },
    "11": { "x": 95.45454545454545, "y": 5.555555555555555 },
    "12": { "x": 4.545454545454546, "y": 16.666666666666668 },
    "13": { "x": 13.636363636363637, "y": 16.666666666666668 },
    "14": { "x": 22.727272727272727, "y": 16.666666666666668 },
    "15": { "x": 31.818181818181817, "y": 16.666666666666668 },
    "16": { "x": 40.90909090909091, "y": 16.666666666666668 },
    "17": { "x": 50, "y": 16.666666666666668 },
    "18": { "x": 59.09090909090909, "y": 16.666666666666668 },
    "19": { "x": 68.18181818181819, "y": 16.666666666666668 },
    "20": { "x": 77.27272727272727, "y": 16.666666666666668 },
    "21": { "x": 86.36363636363636, "y": 16.666666666666668 },
    "22": { "x": 95.45454545454545, "y": 16.666666666666668 },
    "23": { "x": 4.545454545454546, "y": 27.77777777777778 },
    "24": { "x": 13.636363636363637, "y": 27.77777777777778 },
    "25": { "x": 22.727272727272727, "y": 27.77777777777778 },
    "26": { "x": 31.818181818181817, "y": 27.77777777777778 },
    "27": { "x": 40.90909090909091, "y": 27.77777777777778 },
    "28": { "x": 50, "y": 27.77777777777778 },
    "29": { "x": 59.09090909090909, "y": 27.77777777777778 },
    "30": { "x": 68.18181818181819, "y": 27.77777777777778 },
    "31": { "x": 77.27272727272727, "y": 27.77777777777778 },
    "32": { "x": 86.36363636363636, "y": 27.77777777777778 },
    "33": { "x": 95.45454545454545, "y": 27.77777777777778 },
    "34": { "x": 4.545454545454546, "y": 38.888888888888886 },
    "35": { "x": 13.636363636363637, "y": 38.888888888888886 },
    "36": { "x": 22.727272727272727, "y": 38.888888888888886 },
    "37": { "x": 31.818181818181817, "y": 38.888888888888886 },
    "38": { "x": 40.90909090909091, "y": 38.888888888888886 },
    "39": { "x": 50, "y": 38.888888888888886 },
    "40": { "x": 59.09090909090909, "y": 38.888888888888886 },
    "41": { "x": 68.18181818181819, "y": 38.888888888888886 },
    "42": { "x": 77.27272727272727, "y": 38.888888888888886 },
    "43": { "x": 86.36363636363636, "y": 38.888888888888886 },
    "44": { "x": 95.45454545454545, "y": 38.888888888888886 },
    "45": { "x": 4.545454545454546, "y": 50 },
    "46": { "x": 13.636363636363637, "y": 50 },
    "47": { "x": 22.727272727272727, "y": 50 },
    "48": { "x": 31.818181818181817, "y": 50 },
    "49": { "x": 40.90909090909091, "y": 50 },
    "50": { "x": 50, "y": 50 },
    "51": { "x": 59.09090909090909, "y": 50 },
    "52": { "x": 68.18181818181819, "y": 50 },
    "53": { "x": 77.27272727272727, "y": 50 },
    "54": { "x": 86.36363636363636, "y": 50 },
    "55": { "x": 95.45454545454545, "y": 50 },
    "56": { "x": 4.545454545454546, "y": 61.111111111111114 },
    "57": { "x": 13.636363636363637, "y": 61.111111111111114 },
    "58": { "x": 22.727272727272727, "y": 61.111111111111114 },
    "59": { "x": 31.818181818181817, "y": 61.111111111111114 },
    "60": { "x": 40.90909090909091, "y": 61.111111111111114 },
    "61": { "x": 50, "y": 61.111111111111114 },
    "62": { "x": 59.09090909090909, "y": 61.111111111111114 },
    "63": { "x": 68.18181818181819, "y": 61.111111111111114 },
    "64": { "x": 77.27272727272727, "y": 61.111111111111114 },
    "65": { "x": 86.36363636363636, "y": 61.111111111111114 },
    "66": { "x": 95.45454545454545, "y": 61.111111111111114 },
    "67": { "x": 4.545454545454546, "y": 72.22222222222221 },
    "68": { "x": 13.636363636363637, "y": 72.22222222222221 },
    "69": { "x": 22.727272727272727, "y": 72.22222222222221 },
    "70": { "x": 31.818181818181817, "y": 72.22222222222221 },
    "71": { "x": 40.90909090909091, "y": 72.22222222222221 },
    "72": { "x": 50, "y": 72.22222222222221 },
    "73": { "x": 59.09090909090909, "y": 72.22222222222221 },
    "74": { "x": 68.18181818181819, "y": 72.22222222222221 },
    "75": { "x": 77.27272727272727, "y": 72.22222222222221 },
    "76": { "x": 86.36363636363636, "y": 72.22222222222221 },
    "77": { "x": 95.45454545454545, "y": 72.22222222222221 },
    "78": { "x": 4.545454545454546, "y": 83.33333333333334 },
    "79": { "x": 13.636363636363637, "y": 83.33333333333334 },
    "80": { "x": 22.727272727272727, "y": 83.33333333333334 },
    "81": { "x": 31.818181818181817, "y": 83.33333333333334 },
    "82": { "x": 40.90909090909091, "y": 83.33333333333334 },
    "83": { "x": 50, "y": 83.33333333333334 },
    "84": { "x": 59.09090909090909, "y": 83.33333333333334 },
    "85": { "x": 68.18181818181819, "y": 83.33333333333334 },
    "86": { "x": 77.27272727272727, "y": 83.33333333333334 },
    "87": { "x": 86.36363636363636, "y": 83.33333333333334 },
    "88": { "x": 95.45454545454545, "y": 83.33333333333334 },
    "89": { "x": 4.545454545454546, "y": 94.44444444444444 },
    "90": { "x": 13.636363636363637, "y": 94.44444444444444 },
    "91": { "x": 22.727272727272727, "y": 94.44444444444444 },
    "92": { "x": 31.818181818181817, "y": 94.44444444444444 },
    "93": { "x": 40.90909090909091, "y": 94.44444444444444 },
    "94": { "x": 50, "y": 94.44444444444444 },
    "95": { "x": 59.09090909090909, "y": 94.44444444444444 },
    "96": { "x": 68.18181818181819, "y": 94.44444444444444 }
};

const Map = ({ onNodeClick, activePath, onAnimationComplete }) => {
    const [ambulancePosition, setAmbulancePosition] = useState(null);

    // Helper to get coordinates (%)
    const getCoords = (id) => {
        return NODE_COORDS[id] || { x: 0, y: 0 };
    };

    useEffect(() => {
        if (activePath && activePath.length > 0) {
            animatePath(activePath);
        }
    }, [activePath]);

    const animatePath = async (path) => {
        // Start at first node
        const start = getCoords(path[0]);
        setAmbulancePosition(start);

        // Sequential animation
        for (let i = 0; i < path.length; i++) {
            const nodeId = path[i];
            const coords = getCoords(nodeId);
            setAmbulancePosition(coords);
            // Wait for animation
            await new Promise(r => setTimeout(r, 500));
        }

        // Clear after done
        setTimeout(() => {
            setAmbulancePosition(null);
            if (onAnimationComplete) onAnimationComplete();
        }, 1000);
    };

    // Generate nodes for rendering
    const nodes = Array.from({ length: 96 }, (_, i) => i + 1);

    return (
        <div className="relative w-full max-w-5xl mx-auto aspect-[1177/639] bg-gray-200 rounded-xl overflow-hidden shadow-2xl border-4 border-white">
            <img
                src="/assets/Img.png"
                alt="City Map"
                className="absolute inset-0 w-full h-full object-cover pointer-events-none opacity-90"
            />

            {/* Grid Overlay for Nodes */}
            <div className="absolute inset-0">
                {nodes.map((nodeId) => {
                    const coords = getCoords(nodeId);
                    return (
                        <div
                            key={nodeId}
                            onClick={() => onNodeClick(nodeId)}
                            className="absolute group cursor-pointer hover:bg-blue-500/10 transition-colors border border-transparent hover:border-blue-300/30 w-[9%] h-[11%]"
                            style={{
                                left: `${coords.x}%`,
                                top: `${coords.y}%`,
                                transform: 'translate(-50%, -50%)'
                            }}
                        >
                            {/* Tooltip */}
                            <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 hidden group-hover:block bg-gray-900 text-white text-[10px] px-2 py-1 rounded shadow-lg z-20 pointer-events-none whitespace-nowrap">
                                Area {nodeId}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Path Visualization (SVG Lines) */}
            <svg className="absolute inset-0 w-full h-full pointer-events-none z-10">
                {activePath && activePath.length > 1 && activePath.map((nodeId, i) => {
                    if (i === activePath.length - 1) return null;
                    const start = getCoords(nodeId);
                    const end = getCoords(activePath[i + 1]);
                    return (
                        <line
                            key={i}
                            x1={`${start.x}%`}
                            y1={`${start.y}%`}
                            x2={`${end.x}%`}
                            y2={`${end.y}%`}
                            stroke="#e63946"
                            strokeWidth="0.5%"
                            strokeLinecap="round"
                            className="drop-shadow-md"
                        />
                    );
                })}
            </svg>

            {/* Ambulance Animation Layer */}
            <AnimatePresence>
                {ambulancePosition && (
                    <motion.div
                        initial={false}
                        animate={{
                            left: `${ambulancePosition.x}%`,
                            top: `${ambulancePosition.y}%`
                        }}
                        transition={{ duration: 0.5, ease: "linear" }}
                        className="absolute w-8 h-8 z-30 bg-white rounded-full p-1 shadow-lg border-2 border-red-500 flex items-center justify-center"
                        style={{ marginLeft: '-16px', marginTop: '-16px' }} // Center anchor
                    >
                        <img src="/assets/ambulance.png" alt="Ambulance" className="w-full h-full object-contain" />
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
};

export default Map;
