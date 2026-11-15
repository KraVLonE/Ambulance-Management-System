import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Unmount whatever each test rendered so tests can't see each other's DOM.
afterEach(cleanup);
