export enum healthStatus {
  HEALTHY = 'healthy',
  UNHEALTHY = 'unhealthy',
  DEGRADED = 'degraded',
}

export interface ServiceHealth {
  name: string;
  url: string;
  status: healthStatus;
  responseTime: number;
  lastCheck: Date;
  error?: Error;
}
