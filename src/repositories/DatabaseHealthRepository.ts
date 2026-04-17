import { prisma } from "../config/Prisma.js";

export class DatabaseHealthRepository {
  async isHealthy(): Promise<boolean> {
    try {
      await prisma.$queryRawUnsafe("SELECT 1");
      return true;
    } catch {
      return false;
    }
  }
}
