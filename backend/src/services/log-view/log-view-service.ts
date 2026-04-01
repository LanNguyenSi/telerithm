import { Prisma } from "@prisma/client";
import { prisma } from "../../repositories/prisma.js";
import type { SavedLogView, SavedLogViewDefinition } from "../../types/domain.js";

function mapView(view: {
  id: string;
  teamId: string;
  ownerUserId: string | null;
  name: string;
  isShared: boolean;
  isDefault: boolean;
  definition: unknown;
  createdAt: Date;
  updatedAt: Date;
}): SavedLogView {
  return {
    id: view.id,
    teamId: view.teamId,
    ownerUserId: view.ownerUserId,
    name: view.name,
    isShared: view.isShared,
    isDefault: view.isDefault,
    definition: view.definition as SavedLogViewDefinition,
    createdAt: view.createdAt.toISOString(),
    updatedAt: view.updatedAt.toISOString(),
  };
}

function toPrismaJson(value: SavedLogViewDefinition): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export class LogViewService {
  async list(teamId: string, userId: string): Promise<SavedLogView[]> {
    const views = await prisma.logView.findMany({
      where: {
        teamId,
        OR: [{ isShared: true }, { ownerUserId: userId }],
      },
      orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
    });
    return views.map(mapView);
  }

  async create(input: {
    teamId: string;
    userId: string;
    name: string;
    isShared: boolean;
    isDefault: boolean;
    definition: SavedLogViewDefinition;
  }): Promise<SavedLogView> {
    if (input.isDefault) {
      await prisma.logView.updateMany({
        where: { teamId: input.teamId, OR: [{ ownerUserId: input.userId }, { isShared: true }] },
        data: { isDefault: false },
      });
    }

    const view = await prisma.logView.create({
      data: {
        teamId: input.teamId,
        ownerUserId: input.userId,
        name: input.name,
        isShared: input.isShared,
        isDefault: input.isDefault,
        definition: toPrismaJson(input.definition),
      },
    });
    return mapView(view);
  }

  async update(
    id: string,
    input: {
      teamId: string;
      userId: string;
      canManageShared: boolean;
      name?: string;
      isShared?: boolean;
      isDefault?: boolean;
      definition?: SavedLogViewDefinition;
    },
  ): Promise<SavedLogView> {
    const existing = await prisma.logView.findUnique({ where: { id } });
    if (!existing || existing.teamId !== input.teamId) {
      throw new Error("Saved view not found");
    }
    if (!this.canMutate(existing, input.userId, input.canManageShared)) {
      throw new Error("Forbidden");
    }

    if (input.isDefault === true) {
      await prisma.logView.updateMany({
        where: { teamId: input.teamId, OR: [{ ownerUserId: input.userId }, { isShared: true }] },
        data: { isDefault: false },
      });
    }

    const updated = await prisma.logView.update({
      where: { id },
      data: {
        name: input.name,
        isShared: input.isShared,
        isDefault: input.isDefault,
        definition: input.definition ? toPrismaJson(input.definition) : undefined,
      },
    });
    return mapView(updated);
  }

  async duplicate(
    id: string,
    input: { teamId: string; userId: string; canManageShared: boolean; name?: string },
  ): Promise<SavedLogView> {
    const existing = await prisma.logView.findUnique({ where: { id } });
    if (!existing || existing.teamId !== input.teamId) {
      throw new Error("Saved view not found");
    }
    if (!this.canRead(existing, input.userId)) {
      throw new Error("Forbidden");
    }
    const duplicate = await prisma.logView.create({
      data: {
        teamId: input.teamId,
        ownerUserId: input.userId,
        name: input.name?.trim() || `${existing.name} (copy)`,
        isShared: existing.isShared && input.canManageShared,
        isDefault: false,
        definition: (existing.definition ?? {}) as Prisma.InputJsonValue,
      },
    });
    return mapView(duplicate);
  }

  async remove(
    id: string,
    input: { teamId: string; userId: string; canManageShared: boolean },
  ): Promise<void> {
    const existing = await prisma.logView.findUnique({ where: { id } });
    if (!existing || existing.teamId !== input.teamId) {
      throw new Error("Saved view not found");
    }
    if (!this.canMutate(existing, input.userId, input.canManageShared)) {
      throw new Error("Forbidden");
    }
    await prisma.logView.delete({ where: { id } });
  }

  private canRead(view: { isShared: boolean; ownerUserId: string | null }, userId: string): boolean {
    return view.isShared || view.ownerUserId === userId;
  }

  private canMutate(
    view: { isShared: boolean; ownerUserId: string | null },
    userId: string,
    canManageShared: boolean,
  ): boolean {
    if (view.ownerUserId === userId) return true;
    if (view.isShared && canManageShared) return true;
    return false;
  }
}
