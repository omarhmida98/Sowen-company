import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { PortalService } from './portal.service';

// Runs before the file is read: an invalid link, an observation outside its scope, too many uploads or a full quota
// are refused without the server receiving (and holding in memory) the file.
@Injectable()
export class PortalUploadGuard implements CanActivate {
  constructor(private portal: PortalService) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const announced = Number(req.headers?.['content-length']);
    await this.portal.assertUploadAllowed(String(req.params?.token ?? ''), String(req.query?.observationId ?? ''), Number.isFinite(announced) ? announced : 0);
    return true;
  }
}
