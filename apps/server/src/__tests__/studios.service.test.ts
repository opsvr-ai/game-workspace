import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StudiosService } from '../studios/studios.service';
import { createMockPrisma, type MockPrisma } from '../__mocks__/prisma.mock';

// Mock bcryptjs so password hashing is deterministic
vi.mock('bcryptjs', () => ({
  default: {
    hash: vi.fn((password: string, _rounds: number) => Promise.resolve(`hashed_${password}`)),
  },
  hash: vi.fn((password: string, _rounds: number) => Promise.resolve(`hashed_${password}`)),
}));

describe('StudiosService', () => {
  let service: StudiosService;
  let mockPrisma: MockPrisma;

  beforeEach(() => {
    mockPrisma = createMockPrisma();
    // Set up default empty return values for groupBy/findMany used in getEmployees
    mockPrisma.order.groupBy.mockResolvedValue([]);
    mockPrisma.order.findMany.mockResolvedValue([]);
    service = new StudiosService(mockPrisma as any);
    vi.clearAllMocks();
  });

  describe('findAll', () => {
    it('returns all studios with user and companion counts', async () => {
      const mockStudios = [
        {
          id: 'studio-1',
          name: 'Studio Alpha',
          createdAt: new Date('2026-01-01'),
          _count: { users: 5, companions: 3 },
        },
        {
          id: 'studio-2',
          name: 'Studio Beta',
          createdAt: new Date('2026-02-01'),
          _count: { users: 3, companions: 1 },
        },
      ];

      mockPrisma.studio.findMany.mockResolvedValue(mockStudios);

      const result = await service.findAll();

      expect(result).toEqual(mockStudios);
      expect(result).toHaveLength(2);
      expect(result[0]._count.users).toBe(5);
      expect(result[0]._count.companions).toBe(3);
      expect(mockPrisma.studio.findMany).toHaveBeenCalledWith({
        include: { _count: { select: { users: true, companions: true } } },
      });
    });
  });

  describe('create', () => {
    it('creates a studio with manager account', async () => {
      const bcrypt = await import('bcryptjs');
      const mockStudio = {
        id: 'studio-new',
        name: 'New Studio',
        createdAt: new Date(),
      };

      mockPrisma.studio.create.mockResolvedValue(mockStudio);
      mockPrisma.user.create.mockResolvedValue({ id: 'user-new', username: 'admin', role: 'ADMIN' });

      const result = await service.create('New Studio', 'GAMING', 'admin', 'pass123');

      expect(bcrypt.hash).toHaveBeenCalledWith('pass123', 10);
      expect(result).toEqual(mockStudio);
      expect(result.name).toBe('New Studio');
      expect(mockPrisma.studio.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ name: 'New Studio' }),
      });
    });
  });

  describe('update', () => {
    it('renames studio', async () => {
      const mockUpdated = {
        id: 'studio-1',
        name: 'Renamed Studio',
        createdAt: new Date('2026-01-01'),
      };

      mockPrisma.studio.update.mockResolvedValue(mockUpdated);

      const result = await service.update('studio-1', 'Renamed Studio');

      expect(result).toEqual(mockUpdated);
      expect(result.name).toBe('Renamed Studio');
      expect(mockPrisma.studio.update).toHaveBeenCalledWith({
        where: { id: 'studio-1' },
        data: { name: 'Renamed Studio' },
      });
    });
  });

  describe('getEmployees', () => {
    it('returns employees for studio', async () => {
      const mockEmployees = [
        {
          id: 'user-1',
          username: 'admin1',
          role: 'ADMIN',
          studioId: 'studio-1',
          studio: { id: 'studio-1', name: 'Studio Alpha' },
          companion: null,
        },
        {
          id: 'user-2',
          username: 'zhangsan',
          role: 'COMPANION',
          studioId: 'studio-1',
          studio: { id: 'studio-1', name: 'Studio Alpha' },
          companion: {
            id: 'comp-1',
            status: 'ONLINE',
            monthlyRevenue: 5000,
            games: 'LOL',
          },
        },
      ];

      mockPrisma.user.findMany.mockResolvedValue(mockEmployees);

      const result = await service.getEmployees('studio-1');

      expect(result).toEqual(mockEmployees);
      expect(result).toHaveLength(2);
      expect(result[0].role).not.toBe('OWNER');
      expect(result[1].role).not.toBe('OWNER');

      expect(mockPrisma.user.findMany).toHaveBeenCalledWith({
        where: { studioId: 'studio-1', role: { not: 'OWNER' } },
        select: expect.objectContaining({
          id: true,
          username: true,
          role: true,
          studioId: true,
        }),
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('createEmployee', () => {
    it('creates user and companion for COMPANION role', async () => {
      const bcrypt = await import('bcryptjs');
      const mockUser = {
        id: 'user-new',
        username: 'newcompanion',
        role: 'COMPANION',
        studioId: 'studio-1',
        passwordHash: 'hashed_pass123',
        companion: {
          id: 'comp-new',
          studioId: 'studio-1',
          billingCode: expect.any(String),
        },
      };

      mockPrisma.user.create.mockResolvedValue(mockUser);

      const result = await service.createEmployee('studio-1', {
        username: 'newcompanion',
        password: 'pass123',
        role: 'COMPANION',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('pass123', 10);
      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'newcompanion',
          passwordHash: 'hashed_pass123',
          role: 'COMPANION',
          studioId: 'studio-1',
          isAuthorized: true,
          companion: expect.objectContaining({
            create: expect.objectContaining({
              studioId: 'studio-1',
            }),
          }),
        }),
      });
    });

    it('creates ADMIN user without companion', async () => {
      const bcrypt = await import('bcryptjs');
      const mockUser = {
        id: 'user-admin',
        username: 'newadmin',
        role: 'ADMIN',
        studioId: 'studio-1',
        passwordHash: 'hashed_admin123',
      };

      mockPrisma.user.create.mockResolvedValue(mockUser);

      const result = await service.createEmployee('studio-1', {
        username: 'newadmin',
        password: 'admin123',
        role: 'ADMIN',
      });

      expect(bcrypt.hash).toHaveBeenCalledWith('admin123', 10);
      expect(result).toEqual(mockUser);
      expect(mockPrisma.user.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          username: 'newadmin',
          passwordHash: 'hashed_admin123',
          role: 'ADMIN',
          studioId: 'studio-1',
          isAuthorized: true,
          companion: undefined,
        }),
      });
    });
  });

  describe('resetPassword', () => {
    it('updates password hash', async () => {
      const bcrypt = await import('bcryptjs');
      const mockUpdated = {
        id: 'user-1',
        username: 'zhangsan',
        passwordHash: 'hashed_newpass',
      };

      mockPrisma.user.update.mockResolvedValue(mockUpdated);

      const result = await service.resetPassword('user-1', 'newpass');

      expect(bcrypt.hash).toHaveBeenCalledWith('newpass', 10);
      expect(result).toEqual(mockUpdated);
      expect(result.passwordHash).toBe('hashed_newpass');
      expect(mockPrisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: { passwordHash: 'hashed_newpass' },
      });
    });
  });
});
