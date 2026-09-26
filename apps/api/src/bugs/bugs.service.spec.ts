import { BadRequestException, NotFoundException } from '@nestjs/common';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@odyssai/db';
import { BugsService, type UploadedImage } from './bugs.service.js';

const PAGE_SIZE = 25;

function row(
  id: string,
  overrides: Partial<{ screenshotType: string | null; handledAt: Date | null }> = {},
) {
  return {
    id,
    page: '/play',
    message: 'Le bouton ne repond plus',
    userAgent: 'Mozilla/5.0',
    screenshotType: null,
    handledAt: null,
    createdAt: new Date('2026-09-01T10:00:00.000Z'),
    user: { username: 'ulysse', email: 'ulysse@example.com' },
    ...overrides,
  };
}

function image(mimetype: string): UploadedImage {
  const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
  return { buffer, mimetype, size: buffer.length };
}

describe('BugsService', () => {
  let bugReport: {
    create: ReturnType<typeof vi.fn>;
    findMany: ReturnType<typeof vi.fn>;
    count: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    findUnique: ReturnType<typeof vi.fn>;
  };
  let service: BugsService;

  beforeEach(() => {
    bugReport = {
      create: vi.fn().mockResolvedValue({}),
      findMany: vi.fn().mockResolvedValue([]),
      count: vi.fn().mockResolvedValue(0),
      update: vi.fn(),
      findUnique: vi.fn(),
    };
    service = new BugsService({ bugReport } as unknown as PrismaClient);
  });

  describe('submit', () => {
    const request = { page: '/play', message: 'Le bouton ne repond plus' };

    it('enregistre la capture quand son type est accepte', async () => {
      const screenshot = image('image/png');

      await service.submit('user-1', request, 'Mozilla/5.0', screenshot);

      expect(bugReport.create).toHaveBeenCalledWith({
        data: {
          userId: 'user-1',
          page: '/play',
          message: 'Le bouton ne repond plus',
          userAgent: 'Mozilla/5.0',
          screenshot: new Uint8Array(screenshot.buffer),
          screenshotType: 'image/png',
        },
      });
    });

    it('enregistre sans capture et borne le user agent', async () => {
      await service.submit('user-1', request, 'x'.repeat(1000));

      const { data } = bugReport.create.mock.calls[0][0];
      expect(data.userAgent).toHaveLength(400);
      expect(data.screenshot).toBeNull();
      expect(data.screenshotType).toBeNull();
    });

    it('refuse une capture dont le type n est pas accepte', async () => {
      const promise = service.submit('user-1', request, 'Mozilla/5.0', image('image/svg+xml'));

      await expect(promise).rejects.toBeInstanceOf(BadRequestException);
      await expect(promise).rejects.toMatchObject({
        response: { code: 'invalid_screenshot' },
      });
      expect(bugReport.create).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('demande une ligne de plus que la page et rend un curseur quand il en reste', async () => {
      const rows = Array.from({ length: PAGE_SIZE + 1 }, (_, i) => row(`id-${i}`));
      bugReport.findMany.mockResolvedValue(rows);
      bugReport.count.mockResolvedValue(7);

      const page = await service.list();

      expect(bugReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ take: PAGE_SIZE + 1, orderBy: { id: 'desc' }, where: undefined }),
      );
      expect(bugReport.findMany.mock.calls[0][0]).not.toHaveProperty('cursor');
      expect(page.reports).toHaveLength(PAGE_SIZE);
      expect(page.nextCursor).toBe(`id-${PAGE_SIZE - 1}`);
      expect(page.pending).toBe(7);
    });

    it('rend un curseur nul sur la derniere page', async () => {
      bugReport.findMany.mockResolvedValue([row('id-0'), row('id-1')]);

      const page = await service.list();

      expect(page.reports).toHaveLength(2);
      expect(page.nextCursor).toBeNull();
    });

    it('reprend apres le curseur et filtre les rapports en attente', async () => {
      await service.list('id-24', true);

      expect(bugReport.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { handledAt: null },
          cursor: { id: 'id-24' },
          skip: 1,
        }),
      );
    });

    it('ne demande jamais les octets de la capture', async () => {
      bugReport.findMany.mockResolvedValue([row('id-0', { screenshotType: 'image/png' })]);

      const page = await service.list();

      expect(bugReport.findMany.mock.calls[0][0].select).not.toHaveProperty('screenshot');
      expect(page.reports[0]).toEqual({
        id: 'id-0',
        username: 'ulysse',
        email: 'ulysse@example.com',
        page: '/play',
        message: 'Le bouton ne repond plus',
        userAgent: 'Mozilla/5.0',
        hasScreenshot: true,
        handledAt: null,
        createdAt: '2026-09-01T10:00:00.000Z',
      });
    });
  });

  describe('setHandled', () => {
    it('date le rapport quand il est traite', async () => {
      const handledAt = new Date('2026-09-02T08:00:00.000Z');
      bugReport.update.mockResolvedValue(row('id-0', { handledAt }));

      const report = await service.setHandled('id-0', true);

      const call = bugReport.update.mock.calls[0][0];
      expect(call.where).toEqual({ id: 'id-0' });
      expect(call.data.handledAt).toBeInstanceOf(Date);
      expect(report.handledAt).toBe('2026-09-02T08:00:00.000Z');
    });

    it('remet le rapport en attente', async () => {
      bugReport.update.mockResolvedValue(row('id-0'));

      const report = await service.setHandled('id-0', false);

      expect(bugReport.update.mock.calls[0][0].data).toEqual({ handledAt: null });
      expect(report.handledAt).toBeNull();
    });
  });

  describe('screenshot', () => {
    it('rend les octets et leur type', async () => {
      const data = new Uint8Array([1, 2, 3]);
      bugReport.findUnique.mockResolvedValue({ screenshot: data, screenshotType: 'image/webp' });

      await expect(service.screenshot('id-0')).resolves.toEqual({ data, type: 'image/webp' });
    });

    it.each([
      ['rapport introuvable', null],
      ['rapport sans capture', { screenshot: null, screenshotType: null }],
      ['octets manquants', { screenshot: null, screenshotType: 'image/png' }],
      ['type manquant', { screenshot: new Uint8Array([1]), screenshotType: null }],
    ])('rend 404 : %s', async (_name, found) => {
      bugReport.findUnique.mockResolvedValue(found);

      await expect(service.screenshot('id-0')).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
