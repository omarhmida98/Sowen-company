import {Injectable} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
@Injectable()
export class ActivityService{constructor(private prisma:PrismaService){}
  // Only the identity needed to show who did what: never the account record (password hash, token version…).
  // Sign-in events (who signed in, from which address) are for administrators only.
  list(organizationId:string,projectId?:string,role?:string){return this.prisma.activityLog.findMany({where:{...(projectId?{projectId}:{}),...(role==='ADMIN'?{}:{AND:[{OR:[{entityType:null},{entityType:{not:'Session'}}]}]}),OR:[{project:{organizationId}},{user:{organizationId}}]},include:{project:{select:{id:true,name:true}},user:{select:{id:true,displayName:true,email:true}}},orderBy:{createdAt:'desc'},take:200})}
}
