// craftsman-ignore: TS001,TS003
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HeartbeatService, HeartbeatData, HeartbeatUser } from '../ws/heartbeat.service';
import { createMockPrisma, MockPrisma } from '../__mocks__/prisma.mock';

// ---------------------------------------------------------------------------
// Mock: logger (avoids winston initialization in test)
// ---------------------------------------------------------------------------
vi.mock('../common/logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ---------------------------------------------------------------------------
// Mock: WsGateway
// ---------------------------------------------------------------------------
function mockWsGateway() {
  const emit = vi.fn();
  return {
    server: {
      to: vi.fn().mockReturnValue({ emit }),
    },
    sendCommand: vi.fn(),
  } as any;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const BASE_USER: HeartbeatUser = {
  id: 'user-001',
  username: 'testuser',
  role: 'COMPANION',
  studioId: 'studio-001',
  companionId: 'companion-001',
};

const BASE_DATA: HeartbeatData = {
  agentVersion: '2.0.0',
  currentMode: 'ENTERTAINMENT',
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe('HeartbeatService', () => {
  let service: HeartbeatService;
  let mockPrisma: MockPrisma;
  let wsGateway: ReturnType<typeof mockWsGateway>;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    wsGateway = mockWsGateway();
    service = new HeartbeatService(mockPrisma as any, wsGateway as any);
    vi.clearAllMocks();
  });

  // =========================================================================
  // process() — no companionId
  // =========================================================================
  describe('process', () => {
    it('should return early when user has no companionId', async () => {
      const user: HeartbeatUser = { ...BASE_USER, companionId: undefined };

      await service.process(BASE_DATA, user);

      expect(mockPrisma.companionPC.upsert).not.toHaveBeenCalled();
      expect(mockPrisma.companionTimeLog.findFirst).not.toHaveBeenCalled();
    });

    // =======================================================================
    // CompanionPC upsert
    // =======================================================================
    it('should upsert CompanionPC record with heartbeat data', async () => {
      // No open time log — skip that branch
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);

      await service.process(
        {
          agentVersion: '3.1.0',
          currentMode: 'BUSY',
          isThrottled: true,
          throttleLimitKB: 512,
        },
        BASE_USER,
      );

      expect(mockPrisma.companionPC.upsert).toHaveBeenCalledTimes(1);
      const upsertCall = mockPrisma.companionPC.upsert.mock.calls[0][0];
      expect(upsertCall.where).toEqual({ companionId: 'companion-001' });
      expect(upsertCall.create.agentVersion).toBe('3.1.0');
      expect(upsertCall.create.currentMode).toBe('BUSY');
      expect(upsertCall.create.isThrottled).toBe(true);
      expect(upsertCall.create.throttleLimitKB).toBe(512);
      expect(upsertCall.create.lastHeartbeat).toBeInstanceOf(Date);
    });

    it('should use defaults when heartbeat data fields are missing', async () => {
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);

      await service.process({}, BASE_USER);

      const upsertCall = mockPrisma.companionPC.upsert.mock.calls[0][0];
      expect(upsertCall.create.agentVersion).toBe('0.0.0');
      expect(upsertCall.create.currentMode).toBe('ENTERTAINMENT');
      expect(upsertCall.create.isThrottled).toBe(false);
      expect(upsertCall.create.throttleLimitKB).toBeNull();
    });

    // =======================================================================
    // Open time log duration update
    // =======================================================================
    it('should update duration on open time log', async () => {
      const startedAt = new Date(Date.now() - 120_000); // 2 minutes ago
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-001',
        companionId: 'companion-001',
        mode: 'AVAILABLE',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      });

      await service.process(BASE_DATA, BASE_USER);

      expect(mockPrisma.companionTimeLog.update).toHaveBeenCalledTimes(1);
      const updateCall = mockPrisma.companionTimeLog.update.mock.calls[0][0];
      expect(updateCall.where.id).toBe('log-001');
      expect(updateCall.data.durationSeconds).toBeGreaterThanOrEqual(119);
      expect(updateCall.data.durationSeconds).toBeLessThanOrEqual(121);
    });

    // =======================================================================
    // Balance warning — ≤ 30 minutes remaining
    // =======================================================================
    it('should emit warning when entertainment balance is running low', async () => {
      const startedAt = new Date(Date.now() - 30 * 60 * 1000); // 30 min ago
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-002',
        companionId: 'companion-001',
        mode: 'ENTERTAINMENT',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      });
      // Balance = 30, deposit = 0 → available = 30
      // Rate = 60/hour = 1/min → remaining = 30 minutes
      mockPrisma.companion.findUnique.mockResolvedValue({
        balance: 30,
        deposit: 0,
        status: 'ENTERTAINMENT',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ key: 'entertainment.hourly_rate', value: 60 });

      await service.process(BASE_DATA, BASE_USER);

      // Warning should fire because remainingMinutes (≤ 30) and > 0
      const emit = wsGateway.server.to('').emit;
      expect(emit).toHaveBeenCalledWith(
        'entertainment:warning',
        expect.objectContaining({
          remainingMinutes: expect.any(Number),
        }),
      );
    });

    it('should NOT emit warning when remaining balance is sufficient (>30 min)', async () => {
      const startedAt = new Date(Date.now() - 10 * 60 * 1000); // 10 min ago
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-003',
        companionId: 'companion-001',
        mode: 'ENTERTAINMENT',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      });
      // Balance = 500, deposit = 0 → available = 500
      // Rate = 60/hour = 1/min → remaining = 500 minutes
      mockPrisma.companion.findUnique.mockResolvedValue({
        balance: 500,
        deposit: 0,
        status: 'ENTERTAINMENT',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ key: 'entertainment.hourly_rate', value: 60 });

      await service.process(BASE_DATA, BASE_USER);

      const emit = wsGateway.server.to('').emit;
      // Warning should NOT fire (remainingMinutes 500 > 30)
      const warningCalls = emit.mock.calls.filter((c: any[]) => c[0] === 'entertainment:warning');
      expect(warningCalls).toHaveLength(0);
    });

    // =======================================================================
    // Force switch to AVAILABLE when balance exhausted
    // =======================================================================
    it('should force-switch to AVAILABLE and close entertainment log when balance exhausted', async () => {
      const startedAt = new Date(Date.now() - 30 * 60 * 1000);
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-004',
        companionId: 'companion-001',
        mode: 'ENTERTAINMENT',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      });
      // Balance exhausted
      mockPrisma.companion.findUnique.mockResolvedValue({
        balance: 0,
        deposit: 0,
        status: 'ENTERTAINMENT',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ key: 'entertainment.hourly_rate', value: 60 });

      await service.process(BASE_DATA, BASE_USER);

      // Should update companion status to AVAILABLE
      expect(mockPrisma.companion.update).toHaveBeenCalledWith({
        where: { id: 'companion-001' },
        data: { status: 'AVAILABLE' },
      });

      // Should close entertainment time logs
      expect(mockPrisma.companionTimeLog.updateMany).toHaveBeenCalledWith({
        where: { companionId: 'companion-001', mode: 'ENTERTAINMENT', endedAt: null },
        data: { endedAt: expect.any(Date) },
      });

      // Should create a new AVAILABLE log
      expect(mockPrisma.companionTimeLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            companionId: 'companion-001',
            mode: 'AVAILABLE',
            endedAt: null,
          }),
        }),
      );

      // Should emit forceIdle and status:broadcast
      const emit = wsGateway.server.to('').emit;
      expect(emit).toHaveBeenCalledWith('entertainment:forceIdle', expect.any(Object));
    });

    // =======================================================================
    // No switch when companion is not in ENTERTAINMENT status
    // =======================================================================
    it('should NOT force-switch when companion status is not ENTERTAINMENT', async () => {
      const startedAt = new Date(Date.now() - 60 * 60 * 1000); // 1 hour ago
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-005',
        companionId: 'companion-001',
        mode: 'ENTERTAINMENT',
        startedAt,
        endedAt: null,
        durationSeconds: 0,
      });
      // Balance exhausted but companion status is BUSY, not ENTERTAINMENT
      mockPrisma.companion.findUnique.mockResolvedValue({
        balance: 0,
        deposit: 0,
        status: 'BUSY',
      });
      mockPrisma.systemConfig.findUnique.mockResolvedValue({ key: 'entertainment.hourly_rate', value: 60 });

      await service.process(BASE_DATA, BASE_USER);

      // Should NOT update companion status
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
      // Should NOT close time logs
      expect(mockPrisma.companionTimeLog.updateMany).not.toHaveBeenCalled();
    });

    // =======================================================================
    // Legacy workSec handling
    // =======================================================================
    it('should create backdated time log for legacy workSec data', async () => {
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);

      await service.process({ ...BASE_DATA, workSec: 120 }, BASE_USER);

      expect(mockPrisma.companionTimeLog.create).toHaveBeenCalledTimes(1);
      const createCall = mockPrisma.companionTimeLog.create.mock.calls[0][0];
      expect(createCall.data.durationSeconds).toBe(120);
      expect(createCall.data.endedAt).not.toBeNull();
      expect(createCall.data.startedAt).toBeInstanceOf(Date);
    });

    it('should NOT create workSec log when workSec is zero or undefined', async () => {
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue(null);

      await service.process({ ...BASE_DATA, workSec: 0 }, BASE_USER);
      expect(mockPrisma.companionTimeLog.create).not.toHaveBeenCalled();

      await service.process({ ...BASE_DATA, workSec: undefined }, BASE_USER);
      expect(mockPrisma.companionTimeLog.create).not.toHaveBeenCalled();
    });

    // =======================================================================
    // Missing companion gracefully handled
    // =======================================================================
    it('should handle missing companion gracefully during balance check', async () => {
      mockPrisma.companionTimeLog.findFirst.mockResolvedValue({
        id: 'log-006',
        companionId: 'companion-001',
        mode: 'ENTERTAINMENT',
        startedAt: new Date(Date.now() - 30 * 60 * 1000),
        endedAt: null,
        durationSeconds: 0,
      });
      // Companion not found
      mockPrisma.companion.findUnique.mockResolvedValue(null);

      // Should not throw
      await expect(service.process(BASE_DATA, BASE_USER)).resolves.toBeUndefined();

      // No switch / warning should fire when companion is null
      expect(mockPrisma.companion.update).not.toHaveBeenCalled();
    });
  });
});
