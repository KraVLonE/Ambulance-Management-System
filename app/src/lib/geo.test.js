import { describe, expect, test } from 'vitest';
import { distanceM, measurePath, pointAlong, tripProgress, tripPosition, coverageGrid, boundsOf, estimateSeconds } from './geo';

const leg = (phase, path, startAt, endAt, durationS) => ({ phase, path, startAt, endAt, durationS, distanceM: 0 });
const trip = {
    status: 'en_route',
    legs: [
        leg('en_route', [[0, 0], [0, 1]], 1000, 2000, 600),
        leg('on_scene', [[0, 1]], 2000, 2500, 0),
        leg('transporting', [[0, 1], [0, 3]], 2500, 4500, 300),
        leg('returning', [[0, 3], [0, 0]], 4500, 6500, 900),
    ],
};

describe('path geometry', () => {
    test('distance between two known cities', () => {
        const km = distanceM([30.7333, 76.7794], [28.6139, 77.209]) / 1000; // Chandigarh to Delhi
        expect(km).toBeGreaterThan(225);
        expect(km).toBeLessThan(245);
    });

    test('pointAlong moves at constant speed over uneven segments', () => {
        const measured = measurePath([[0, 0], [0, 1], [0, 4]]);
        expect(pointAlong(measured, 0).point).toEqual([0, 0]);
        expect(pointAlong(measured, 1).point).toEqual([0, 4]);
        const half = pointAlong(measured, 0.5);
        expect(half.point[1]).toBeCloseTo(2, 5);
        expect(half.index).toBe(1);
    });

    test('pointAlong copes with degenerate paths', () => {
        expect(pointAlong(measurePath([]), 0.5)).toBeNull();
        expect(pointAlong(measurePath([[5, 5]]), 0.5).point).toEqual([5, 5]);
        expect(pointAlong(measurePath([[1, 1], [1, 1]]), 0.5).point).toEqual([1, 1]);
    });
});

describe('tripProgress', () => {
    test('en route: counts down to the patient and on to the hospital', () => {
        const p = tripProgress(trip, 1500);
        expect(p.phase).toBe('en_route');
        expect(p.fraction).toBeCloseTo(0.5);
        expect(p.toPickupS).toBeCloseTo(300);
        expect(p.toHospitalS).toBeCloseTo(600);
    });

    test('each later phase', () => {
        expect(tripProgress(trip, 2200)).toMatchObject({ phase: 'on_scene', toPickupS: 0, toHospitalS: 300 });
        const transporting = tripProgress(trip, 3500);
        expect(transporting.phase).toBe('transporting');
        expect(transporting.toHospitalS).toBeCloseTo(150);
        expect(tripProgress(trip, 5000)).toMatchObject({ phase: 'returning', toPickupS: null, toHospitalS: null });
    });

    test('clamps before the start and after the end', () => {
        expect(tripProgress(trip, 0)).toMatchObject({ phase: 'en_route', fraction: 0 });
        expect(tripProgress(trip, 99999)).toMatchObject({ phase: 'returning', fraction: 1 });
    });

    test('a queued request has no trip yet', () => {
        const queued = { status: 'queued', legs: [] };
        expect(tripProgress(queued, 1000)).toMatchObject({ phase: 'queued', leg: null });
        expect(tripPosition(queued, 1000)).toBeNull();
    });

    test('tripPosition follows the current leg', () => {
        expect(tripPosition(trip, 1500)[1]).toBeCloseTo(0.5, 5);
        expect(tripPosition(trip, 2200)).toEqual([0, 1]);
    });
});

describe('coverage', () => {
    const bounds = [[30, 76], [31, 77]];

    test('cells nearer a free ambulance have shorter times', () => {
        const cells = coverageGrid(bounds, [[30, 76]], 4);
        expect(cells).toHaveLength(16);
        const nearest = cells[0];
        const farthest = cells[15];
        expect(nearest.minutes).toBeLessThan(farthest.minutes);
        expect(nearest.minutes).toBeCloseTo(estimateSeconds(distanceM([30.125, 76.125], [30, 76])) / 60, 5);
    });

    test('no free ambulance means no coverage anywhere', () => {
        expect(coverageGrid(bounds, [], 2).every(c => c.minutes === Infinity)).toBe(true);
    });

    test('boundsOf pads the box and handles no points', () => {
        expect(boundsOf([{ lat: 1, lng: 2 }, { lat: 3, lng: 5 }], 0.5)).toEqual([[0.5, 1.5], [3.5, 5.5]]);
        expect(boundsOf([])).toBeNull();
    });
});
