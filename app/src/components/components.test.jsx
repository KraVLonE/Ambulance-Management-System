import { describe, expect, test, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import LoginPage from './LoginPage';
import HospitalList from './HospitalList';
import DispatchPanel from './DispatchPanel';
import RequestModal from './RequestModal';
import { permissions } from '../lib/format';
import { api } from '../lib/api';

// No real network or socket in component tests.
vi.mock('../lib/api', () => ({
    socket: { on: vi.fn(), off: vi.fn(), connect: vi.fn(), disconnect: vi.fn() },
    errorMessage: (err) => err.response?.data?.error || 'Something went wrong. Please try again.',
    setUnauthorizedHandler: vi.fn(),
    api: {
        setAmbulances: vi.fn(() => Promise.resolve({})),
        addUnit: vi.fn(() => Promise.resolve({})),
        updateUnit: vi.fn(() => Promise.resolve({})),
        deleteUnit: vi.fn(() => Promise.resolve({})),
        reverseGeocode: vi.fn(() => Promise.resolve('Sector 17, Chandigarh')),
    },
}));

beforeEach(() => vi.clearAllMocks());

const hospitals = [
    { id: 41, name: 'Healing Hospital', lat: 30.726, lng: 76.765, bedsAvailable: 30, capabilities: ['cardiac'], units: 2, ambulancesAvailable: 1, deployed: 1, outOfService: 0 },
    { id: 16, name: 'Santokh Hospital', lat: 30.713, lng: 76.784, bedsAvailable: 0, capabilities: [], units: 0, ambulancesAvailable: 0, deployed: 0, outOfService: 0 },
];
const units = [
    { id: 'u1', callSign: 'A41-01', type: 'ALS', hospitalId: 41, status: 'available', crew: null, dispatchId: null },
    { id: 'u2', callSign: 'A41-02', type: 'BLS', hospitalId: 41, status: 'busy', crew: 'Asha', dispatchId: 'd1' },
];

describe('LoginPage', () => {
    test('signs in with the typed credentials and shows server errors', async () => {
        const onLogin = vi.fn().mockRejectedValue({ response: { data: { error: 'Wrong username or password.' } } });
        render(<LoginPage mode="login" onLogin={onLogin} onSetup={vi.fn()} />);
        fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' dee ' } });
        fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'secret-pass' } });
        fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

        expect(await screen.findByRole('alert')).toHaveProperty('textContent', 'Wrong username or password.');
        expect(onLogin).toHaveBeenCalledWith('dee', 'secret-pass');
        // The form is usable again after a failure.
        expect(screen.getByRole('button', { name: 'Sign in' })).toHaveProperty('disabled', false);
    });

    test('first-run setup refuses mismatched passwords without calling the server', () => {
        const onSetup = vi.fn();
        render(<LoginPage mode="setup" onLogin={vi.fn()} onSetup={onSetup} />);
        fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'boss' } });
        fireEvent.change(screen.getByLabelText(/^Password/), { target: { value: 'first-password' } });
        fireEvent.change(screen.getByLabelText('Repeat password'), { target: { value: 'other-password' } });
        fireEvent.click(screen.getByRole('button', { name: 'Create account' }));

        expect(screen.getByRole('alert').textContent).toMatch(/do not match/);
        expect(onSetup).not.toHaveBeenCalled();
    });
});

describe('HospitalList', () => {
    const renderList = (user, extra = {}) => render(
        <HospitalList hospitals={hospitals} units={units} loading={false} error={null} onRetry={vi.fn()}
            onHospitalClick={vi.fn()} onEditHospital={vi.fn()} permissions={permissions(user)} notify={vi.fn()} {...extra} />
    );

    test('a viewer sees counts but no controls', () => {
        renderList({ role: 'viewer' });
        expect(screen.getByText('Healing Hospital')).toBeTruthy();
        expect(screen.queryByRole('button', { name: /Add an ambulance/ })).toBeNull();
        expect(screen.queryByText('Edit details')).toBeNull();
        expect(screen.getByText('No beds free')).toBeTruthy();
    });

    test('a hospital admin gets controls for their own hospital only', () => {
        renderList({ role: 'hospital_admin', hospitalId: 41 });
        expect(screen.getByRole('button', { name: 'Add an ambulance to Healing Hospital' })).toBeTruthy();
        expect(screen.queryByRole('button', { name: 'Add an ambulance to Santokh Hospital' })).toBeNull();
    });

    test('the stepper asks the server for the new count', async () => {
        renderList({ role: 'admin' });
        fireEvent.click(screen.getByRole('button', { name: 'Add an ambulance to Healing Hospital' }));
        await waitFor(() => expect(api.setAmbulances).toHaveBeenCalledWith(41, 2));
        // Nothing to remove at a hospital with no ambulance at base.
        expect(screen.getByRole('button', { name: 'Remove an ambulance from Santokh Hospital' })).toHaveProperty('disabled', true);
    });

    test('typing an invalid count is rejected locally', () => {
        const notify = vi.fn();
        renderList({ role: 'admin' }, { notify });
        fireEvent.click(screen.getByRole('button', { name: /1 ambulances at base at Healing Hospital/ }));
        const input = screen.getByLabelText('Ambulances at base at Healing Hospital');
        fireEvent.change(input, { target: { value: '-3' } });
        fireEvent.keyDown(input, { key: 'Enter' });
        expect(notify).toHaveBeenCalledWith(expect.stringMatching(/whole number/), 'error');
        expect(api.setAmbulances).not.toHaveBeenCalled();
    });

    test('search filters hospitals and explains an empty result', () => {
        renderList({ role: 'viewer' });
        fireEvent.change(screen.getByLabelText('Search hospitals'), { target: { value: 'sant' } });
        expect(screen.queryByText('Healing Hospital')).toBeNull();
        expect(screen.getByText('Santokh Hospital')).toBeTruthy();
        fireEvent.change(screen.getByLabelText('Search hospitals'), { target: { value: 'zzz' } });
        expect(screen.getByText(/No hospitals match/)).toBeTruthy();
    });

    test('the unit list shows each ambulance; a unit on a call cannot be removed', () => {
        renderList({ role: 'admin' });
        fireEvent.click(screen.getByRole('button', { name: 'Show 2 ambulances' }));
        expect(screen.getByText('A41-01')).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Remove A41-01' })).toHaveProperty('disabled', false);
        expect(screen.getByRole('button', { name: 'Remove A41-02' })).toHaveProperty('disabled', true);
    });
});

describe('DispatchPanel', () => {
    const base = { severity: 'urgent', caseType: 'general', lat: 30.74, lng: 76.78, address: 'Sector 17', note: null, createdAt: 1000, destHospitalName: 'Healing Hospital' };
    const queued = { ...base, id: 'q1', status: 'queued', severity: 'critical', address: 'Sector 22', legs: [] };
    const active = {
        ...base, id: 'a1', status: 'en_route', callSign: 'A41-02', unitType: 'BLS', hospitalName: 'Healing Hospital', distanceM: 2400, assignedAt: 1000,
        legs: [{ phase: 'en_route', path: [[0, 0], [0, 1]], startAt: 1000, endAt: 61000, durationS: 600, distanceM: 2400 }],
    };
    const renderPanel = (props = {}) => render(
        <DispatchPanel dispatches={[active, queued]} history={[]} serverNow={() => 1000} canDispatch
            onFocus={vi.fn()} onCancel={vi.fn(() => Promise.resolve())} onShare={vi.fn()} {...props} />
    );

    test('waiting requests are listed separately, above active trips', () => {
        renderPanel();
        const headings = screen.getAllByRole('heading', { level: 3 }).map(h => h.textContent);
        expect(headings[0]).toBe('Waiting for an ambulance (1)');
        expect(headings[1]).toBe('Active (1)');
        expect(screen.getByText('Waiting for a free ambulance')).toBeTruthy();
        expect(screen.getByText('Arrives in 10 min')).toBeTruthy();
    });

    test('cancel and share call back with the right dispatch', async () => {
        const onCancel = vi.fn(() => Promise.resolve());
        const onShare = vi.fn();
        renderPanel({ onCancel, onShare });
        const card = screen.getByText('Arrives in 10 min').closest('li');
        fireEvent.click(within(card).getByRole('button', { name: 'Share' }));
        expect(onShare).toHaveBeenCalledWith(active);
        fireEvent.click(within(card).getByRole('button', { name: 'Cancel' }));
        await waitFor(() => expect(onCancel).toHaveBeenCalledWith(active));
    });

    test('a read-only user gets no cancel button', () => {
        renderPanel({ canDispatch: false });
        expect(screen.queryByRole('button', { name: 'Cancel' })).toBeNull();
        expect(screen.getAllByRole('button', { name: 'Share' })).toHaveLength(2);
    });
});

describe('RequestModal', () => {
    const location = { lat: 30.74, lng: 76.78 };
    const renderModal = (props = {}) => {
        const onConfirm = vi.fn();
        render(<RequestModal location={location} hospitals={hospitals} units={units} loading={false} onClose={vi.fn()} onConfirm={onConfirm} {...props} />);
        return onConfirm;
    };

    test('looks up the address and submits the chosen details', async () => {
        const onConfirm = renderModal();
        expect(await screen.findByText('Sector 17, Chandigarh')).toBeTruthy();
        fireEvent.click(screen.getByLabelText(/Critical/));
        fireEvent.click(screen.getByLabelText(/Trauma/));
        fireEvent.change(screen.getByPlaceholderText(/chest pain/), { target: { value: ' fell from ladder ' } });
        fireEvent.click(screen.getByRole('button', { name: 'Dispatch ambulance' }));
        expect(onConfirm).toHaveBeenCalledWith({
            severity: 'critical', caseType: 'trauma', note: 'fell from ladder', address: 'Sector 17, Chandigarh',
            ambulanceId: undefined, destHospitalId: undefined,
        });
    });

    test('manual choice sends the picked ambulance and hospital', async () => {
        const onConfirm = renderModal();
        await screen.findByText('Sector 17, Chandigarh');
        fireEvent.click(screen.getByLabelText('Choose the ambulance or hospital myself'));
        fireEvent.change(screen.getByLabelText('Ambulance'), { target: { value: 'u1' } });
        fireEvent.change(screen.getByLabelText('Take patient to'), { target: { value: '16' } });
        fireEvent.click(screen.getByRole('button', { name: 'Dispatch ambulance' }));
        expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ ambulanceId: 'u1', destHospitalId: 16 }));
    });

    test('with no free ambulance the request can still be queued', async () => {
        renderModal({ units: units.filter(u => u.status !== 'available') });
        expect(await screen.findByText(/will be queued/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Add to queue' })).toHaveProperty('disabled', false);
    });

    test('a location outside the service area cannot be submitted', async () => {
        renderModal({ location: { lat: 28.6139, lng: 77.209 } });
        expect(await screen.findByText(/outside the service area/)).toBeTruthy();
        expect(screen.getByRole('button', { name: 'Dispatch ambulance' })).toHaveProperty('disabled', true);
    });

    test('a place picked from search keeps its name without another lookup', () => {
        renderModal({ location: { ...location, label: 'Rock Garden, Chandigarh' } });
        expect(screen.getByText('Rock Garden, Chandigarh')).toBeTruthy();
        expect(api.reverseGeocode).not.toHaveBeenCalled();
    });
});
