// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { RestingMonitorService } from '../companions/resting-monitor.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// Mock: Logger (avoids NestJS Logger initialization, must be a class for `new`)
// ---------------------------------------------------------------------------
vi.mock('@nestjs/common', async () => {
  const actual = await vi.importActual<typeof import('@nestjs/common')>('@nestjs/common');
  class MockLogger {
    log = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  }
  return {
    ...actual,
    Logger: MockLogger,
  };
});

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('RestingMonitorService', () => {
  let service: RestingMonitorService;
  let mockPrisma: MockPrisma;
  let wsGateway: { sendCommand: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.useFakeTimers();
    mockPrisma = createMockPrisma();
    wsGateway = { sendCommand: vi.fn() };
    service = new RestingMonitorService(mockPrisma as any, wsGateway as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // =========================================================================
  // startResting()
  // =========================================================================
  describe('startResting', () => {
    it('should set a 1-hour timer and send shutdown when companion is still RESTING', async () => {
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'RESTING' });

      service.startResting('comp-001');

      // Advance time by 1 hour + 1ms
      vi.advanceTimersByTime(60 * 60 * 1000 + 1);

      // Need to let the async callback run
      await vi.runAllTimersAsync();

      expect(mockPrisma.companion.findUnique).toHaveBeenCalledWith({
        where: { id: 'comp-001' },
        select: { status: true },
      });
      expect(wsGateway.sendCommand).toHaveBeenCalledWith('comp-001', 'shutdown');
    });

    it('should NOT send shutdown when companion is no longer RESTING after timer fires', async () => {
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'AVAILABLE' });

      service.startResting('comp-001');

      vi.advanceTimersByTime(60 * 60 * 1000 + 1);
      await vi.runAllTimersAsync();

      expect(mockPrisma.companion.findUnique).toHaveBeenCalled();
      expect(wsGateway.sendCommand).not.toHaveBeenCalled();
    });

    it('should clear existing timer before starting a new one', async () => {
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'RESTING' });

      // Start first timer
      service.startResting('comp-001');
      // Start second timer (should clear the first)
      service.startResting('comp-001');

      expect(clearSpy).toHaveBeenCalled();

      clearSpy.mockRestore();
    });
  });

  // =========================================================================
  // clearTimer()
  // =========================================================================
  describe('clearTimer', () => {
    it('should clear a running timer', () => {
      const clearSpy = vi.spyOn(global, 'clearTimeout');
      mockPrisma.companion.findUnique.mockResolvedValue({ status: 'RESTING' });

      service.startResting('comp-001');
      service.clearTimer('comp-001');

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });

    it('should handle clearing a non-existent timer gracefully', () => {
      // Should not throw
      expect(() => service.clearTimer('nonexistent')).not.toThrow();
    });
  });
});
