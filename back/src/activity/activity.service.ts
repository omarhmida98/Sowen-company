import {Injectable} from '@nestjs/common';
import {PrismaService} from '../prisma/prisma.service';
@Injectable()
export class ActivityService{constructor(private prisma:PrismaService){}list(organizationId:string,projectId?:string){return this.prisma.activityLog.findMany({where:{...(projectId?{projectId}:{}),OR:[{project:{organizationId}},{user:{organizationId}}]},include:{project:true,user:true},orderBy:{createdAt:'desc'},take:200})}}
