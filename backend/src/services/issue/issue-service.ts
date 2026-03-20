import type { IssueStatus } from "@prisma/client";
import { prisma } from "../../repositories/prisma.js";
import { computeFingerprint, normalizeMessage } from "../ingestion/fingerprint.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("issue-service");

export class IssueService {
  async trackError(teamId: string, level: string, service: string, message: string) {
    const fingerprint = computeFingerprint(level, service, message);
    const title = normalizeMessage(message).slice(0, 200);
    const now = new Date();

    try {
      await prisma.issue.upsert({
        where: { teamId_fingerprint: { teamId, fingerprint } },
        create: {
          teamId,
          fingerprint,
          title,
          level,
          service,
          status: "NEW",
          firstSeen: now,
          lastSeen: now,
          eventCount: 1,
        },
        update: {
          lastSeen: now,
          eventCount: { increment: 1 },
          status: "ONGOING",
        },
      });
    } catch (err) {
      log.error({ err, teamId, fingerprint }, "Failed to track issue");
    }
  }

  async list(
    teamId: string,
    filters?: { status?: IssueStatus; service?: string; level?: string },
    limit = 50,
    offset = 0,
  ) {
    const where: Record<string, unknown> = { teamId };
    if (filters?.status) where.status = filters.status;
    if (filters?.service) where.service = filters.service;
    if (filters?.level) where.level = filters.level;

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        orderBy: { lastSeen: "desc" },
        take: limit,
        skip: offset,
        include: { assignee: { select: { id: true, name: true, email: true } } },
      }),
      prisma.issue.count({ where }),
    ]);

    return { issues, total };
  }

  async getById(id: string) {
    return prisma.issue.findUnique({
      where: { id },
      include: { assignee: { select: { id: true, name: true, email: true } } },
    });
  }

  async updateStatus(id: string, status: IssueStatus) {
    return prisma.issue.update({
      where: { id },
      data: { status },
    });
  }

  async assign(id: string, assigneeId: string | null) {
    return prisma.issue.update({
      where: { id },
      data: { assigneeId },
    });
  }
}
