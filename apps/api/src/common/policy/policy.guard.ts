import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PolicyService } from './policy.service';

@Injectable()
export class PolicyGuard implements CanActivate {
  constructor(private readonly policy: PolicyService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    this.policy.inspectRequest(request);
    return true;
  }
}
