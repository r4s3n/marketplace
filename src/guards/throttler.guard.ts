import { Injectable } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';

@Injectable()
export class CustomThrottlerGuard extends ThrottlerGuard {
  protected getTracker(req: Record<string, string>): Promise<string> {
    return Promise.resolve(`${req.ip}-${req.headers['user-agent']}`);
  }
}
