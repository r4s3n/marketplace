import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response } from 'express';

@Injectable()
export class LoggingMiddleware implements NestMiddleware {
  private readonly logger = new Logger('HTTP');
  use(req: Request, res: Response, next: () => void) {
    const { method, originalUrl, ip } = req;
    const userAgent = req.get('User-Agent') || '';
    const startTime = Date.now();

    this.logger.log(
      `Incoming request: ${method} ${originalUrl} - IP ${ip} - User-Agent: ${userAgent}`,
    );

    res.on('finish', () => {
      const { statusCode } = res;
      const contentLength = res.get('Content-Length');
      const duration = Date.now() - startTime;

      this.logger.log(
        `Outgoing request: ${method} ${originalUrl} - ${originalUrl} - ${contentLength || 0}b - ${duration}`,
      );
      // se tiver algum erro, traz o log de error
      if (statusCode >= 400) {
        this.logger.error(
          `Error response: ${method} ${originalUrl} - ${statusCode} - ${duration}ms`,
        );
      }
    });

    // log de erros
    res.on('error', (error) => {
      this.logger.error(
        `Response Error: ${method} ${originalUrl} - ${error.message}`,
      );
    });
    // log de timeout
    req.on('timeout', () => {
      this.logger.warn(
        `Response TimeOut: ${method} ${originalUrl} - ${Date.now()}`,
      );
    });
    next();
  }
}
