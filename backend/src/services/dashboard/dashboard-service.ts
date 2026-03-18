import { QueryService } from "../query/query-service.js";

export class DashboardService {
  private readonly queryService = new QueryService();

  getOverview(teamId: string) {
    return this.queryService.getDashboardSummary(teamId);
  }
}

