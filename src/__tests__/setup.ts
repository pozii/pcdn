import { Logger } from '../utils/Logger';

// Mock Logger to avoid console output during tests
jest.mock('../utils/Logger', () => ({
  Logger: jest.fn().mockImplementation(() => ({
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  }))
}));

// Global test setup
beforeAll(() => {
  // Setup code that runs before all tests
});

afterAll(() => {
  // Cleanup code that runs after all tests
});

// Reset mocks before each test
beforeEach(() => {
  jest.clearAllMocks();
});
