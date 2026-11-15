import { describe, expect, test } from 'vitest';
import { permissions, formatMinutes, formatDistance, availabilityLevel, placeOf } from './format';

describe('permissions', () => {
    test('admin can do everything', () => {
        const can = permissions({ role: 'admin' });
        expect(can.dispatch).toBe(true);
        expect(can.admin).toBe(true);
        expect(can.manageHospital(7)).toBe(true);
    });

    test('dispatcher dispatches but manages nothing', () => {
        const can = permissions({ role: 'dispatcher' });
        expect(can.dispatch).toBe(true);
        expect(can.admin).toBe(false);
        expect(can.manageHospital(7)).toBe(false);
    });

    test('hospital admin manages only their own hospital', () => {
        const can = permissions({ role: 'hospital_admin', hospitalId: 7 });
        expect(can.dispatch).toBe(false);
        expect(can.manageHospital(7)).toBe(true);
        expect(can.manageHospital(8)).toBe(false);
    });

    test('viewer and signed-out users can change nothing', () => {
        for (const user of [{ role: 'viewer' }, null, undefined]) {
            const can = permissions(user);
            expect(can.dispatch).toBe(false);
            expect(can.admin).toBe(false);
            expect(can.manageHospital(7)).toBe(false);
        }
    });
});

describe('formatting', () => {
    test('minutes never read as zero', () => {
        expect(formatMinutes(0)).toBe('under a minute');
        expect(formatMinutes(44)).toBe('under a minute');
        expect(formatMinutes(50)).toBe('1 min');
        expect(formatMinutes(600)).toBe('10 min');
    });

    test('distance switches from metres to kilometres', () => {
        expect(formatDistance(254)).toBe('250 m');
        expect(formatDistance(1500)).toBe('1.5 km');
        expect(formatDistance(null)).toBe('');
    });

    test('availability levels', () => {
        expect(availabilityLevel(0)).toBe('none');
        expect(availabilityLevel(2)).toBe('low');
        expect(availabilityLevel(3)).toBe('good');
    });

    test('placeOf prefers the address and falls back to coordinates', () => {
        expect(placeOf({ address: 'Sector 17', lat: 1, lng: 2 })).toBe('Sector 17');
        expect(placeOf({ address: null, lat: 30.74, lng: 76.78 })).toBe('30.7400, 76.7800');
    });
});
