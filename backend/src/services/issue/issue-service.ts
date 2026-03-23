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
    filters?: { query?: string; status?: IssueStatus; service?: string; level?: string },
    sort?: {
      sortBy?: "lastSeen" | "firstSeen" | "eventCount" | "service" | "level" | "status";
      sortDirection?: "asc" | "desc";
    },
    limit = 50,
    offset = 0,
  ) {
    const where: Record<string, unknown> = { teamId };
    if (filters?.query) {
      where.title = { contains: filters.query, mode: "insensitive" };
    }
    if (filters?.status) where.status = filters.status;
    if (filters?.service) {
      where.service = { contains: filters.service, mode: "insensitive" };
    }
    if (filters?.level) where.level = filters.level;
    const sortBy = sort?.sortBy ?? "lastSeen";
    const sortDirection = sort?.sortDirection ?? "desc";

    const [issues, total] = await Promise.all([
      prisma.issue.findMany({
        where,
        orderBy: { [sortBy]: sortDirection },
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
