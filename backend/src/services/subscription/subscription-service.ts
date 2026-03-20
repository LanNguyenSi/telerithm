import { prisma } from "../../repositories/prisma.js";
import { createChildLogger } from "../../logger.js";

const log = createChildLogger("subscription-service");

export class SubscriptionService {
  async listByUser(userId: string, teamId: string) {
    return prisma.alertSubscription.findMany({
      where: { userId, teamId },
      include: { rule: { select: { id: true, name: true } } },
      orderBy: { createdAt: "desc" },
    });
  }

  async create(data: {
    userId: string;
    teamId: string;
    ruleId?: string;
    channel: "EMAIL" | "WEBHOOK" | "SLACK" | "MSTEAMS";
    config: Record<string, unknown>;
    severities?: string[];
  }) {
    const subscription = await prisma.alertSubscription.create({
      data: {
        userId: data.userId,
        teamId: data.teamId,
        ruleId: data.ruleId ?? null,
        channel: data.channel,
        config: data.config as Parameters<typeof prisma.alertSubscription.create>[0]["data"]["config"],
        severities: data.severities ?? [],
        enabled: true,
      },
    });
    log.info({ subscriptionId: subscription.id, userId: data.userId }, "Subscription created");
    return subscription;
  }

  async update(
    id: string,
    userId: string,
    data: {
      channel?: "EMAIL" | "WEBHOOK" | "SLACK" | "MSTEAMS";
      config?: Record<string, unknown>;
      severities?: string[];
      enabled?: boolean;
    },
  ) {
    const { config, ...rest } = data;
    return prisma.alertSubscription.update({
      where: { id, userId },
      data: {
        ...rest,
        ...(config !== undefined
          ? { config: config as Parameters<typeof prisma.alertSubscription.update>[0]["data"]["config"] }
          : {}),
      },
    });
  }

  async delete(id: string, userId: string) {
    return prisma.alertSubscription.delete({
      where: { id, userId },
    });
  }

  async findForIncident(ruleId: string, teamId: string, severity: string) {
    return prisma.alertSubscription.findMany({
      where: {
        teamId,
        enabled: true,
        OR: [{ ruleId }, { ruleId: null }],
        AND: [
          {
            OR: [{ severities: { isEmpty: true } }, { severities: { has: severity } }],
          },
        ],
      },
      include: { user: { select: { id: true, email: true, name: true } } },
    });
  }
}
