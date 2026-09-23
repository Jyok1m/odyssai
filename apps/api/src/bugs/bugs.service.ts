import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@odyssai/db';
import {
  SCREENSHOT_TYPES,
  type BugReport,
  type BugReportPage,
  type BugReportRequest,
} from '@odyssai/schemas';
import { PRISMA } from '../prisma/prisma.module.js';

const PAGE_SIZE = 25;

// Ce que multer rend d'un fichier, sans dependre de ses types.
export interface UploadedImage {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

/*
  Les bugs signales depuis le jeu.

  Meme forme que les messages de contact : une liste paginee par curseur au
  tableau de bord, un etat « traite » qui se bascule. La capture est servie a
  part, par son identifiant, derriere les deux gardes : une image dans la
  liste ferait peser chaque page de tous les ecrans envoyes.
*/
@Injectable()
export class BugsService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async submit(
    userId: string,
    request: BugReportRequest,
    userAgent: string,
    screenshot?: UploadedImage,
  ): Promise<void> {
    if (screenshot && !(SCREENSHOT_TYPES as readonly string[]).includes(screenshot.mimetype)) {
      throw new BadRequestException({ code: 'invalid_screenshot' });
    }

    await this.prisma.bugReport.create({
      data: {
        userId,
        page: request.page,
        message: request.message,
        userAgent: userAgent.slice(0, 400),
        screenshot: screenshot ? new Uint8Array(screenshot.buffer) : null,
        screenshotType: screenshot?.mimetype ?? null,
      },
    });
  }

  async list(cursor?: string, pendingOnly = false): Promise<BugReportPage> {
    const rows = await this.prisma.bugReport.findMany({
      where: pendingOnly ? { handledAt: null } : undefined,
      orderBy: { id: 'desc' },
      take: PAGE_SIZE + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      select: this.summary,
    });

    const page = rows.slice(0, PAGE_SIZE);
    const pending = await this.prisma.bugReport.count({ where: { handledAt: null } });

    return {
      reports: page.map((row) => this.toReport(row)),
      nextCursor: rows.length > PAGE_SIZE ? (page.at(-1)?.id ?? null) : null,
      pending,
    };
  }

  async setHandled(id: string, handled: boolean): Promise<BugReport> {
    const row = await this.prisma.bugReport.update({
      where: { id },
      data: { handledAt: handled ? new Date() : null },
      select: this.summary,
    });

    return this.toReport(row);
  }

  async screenshot(id: string): Promise<{ data: Uint8Array; type: string }> {
    const row = await this.prisma.bugReport.findUnique({
      where: { id },
      select: { screenshot: true, screenshotType: true },
    });
    if (!row?.screenshot || !row.screenshotType) {
      throw new NotFoundException({ code: 'not_found' });
    }

    return { data: row.screenshot, type: row.screenshotType };
  }

  // Sans les octets de la capture : la liste ne les porte jamais.
  private readonly summary = {
    id: true,
    page: true,
    message: true,
    userAgent: true,
    screenshotType: true,
    handledAt: true,
    createdAt: true,
    user: { select: { username: true, email: true } },
  } as const;

  private toReport(row: {
    id: string;
    page: string;
    message: string;
    userAgent: string;
    screenshotType: string | null;
    handledAt: Date | null;
    createdAt: Date;
    user: { username: string | null; email: string | null } | null;
  }): BugReport {
    return {
      id: row.id,
      username: row.user?.username ?? null,
      email: row.user?.email ?? null,
      page: row.page,
      message: row.message,
      userAgent: row.userAgent,
      hasScreenshot: row.screenshotType !== null,
      handledAt: row.handledAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }
}
