import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
@Injectable()
export class AnalyticsService {
  constructor(private prisma: PrismaService) {}
  async projectScore(projectId:string, organizationId:string){
    const project=await this.prisma.project.findUnique({where:{id:projectId},select:{organizationId:true}});if(!project)throw new NotFoundException('Project not found');if(project.organizationId!==organizationId)throw new ForbiddenException('Project does not belong to your organization');
    const obs=await this.prisma.observation.findMany({where:{projectId},include:{lot:true}});
    const total=obs.length; const resolved=obs.filter(o=>o.status==='RESOLVED').length;
    const score=total===0?100:Math.round((resolved/total)*100);
    const byLot=new Map<string,{lotId:string|null;name:string;total:number;resolved:number}>();
    for(const o of obs){const key=o.lotId||'none';const row=byLot.get(key)||{lotId:o.lotId,name:o.lot?.name||'Sans lot',total:0,resolved:0};row.total++;if(o.status==='RESOLVED')row.resolved++;byLot.set(key,row)}
    return {projectId,score,total,resolved,open:total-resolved,byLot:[...byLot.values()].map(x=>({...x,score:x.total?Math.round(x.resolved/x.total*100):100}))};
  }
  async management(organizationId:string){
    const [projects,observations,companies]=await Promise.all([
      this.prisma.project.findMany({where:{organizationId},include:{_count:{select:{observations:true}}}}),
      this.prisma.observation.findMany({where:{project:{organizationId}},include:{company:true}}),
      this.prisma.company.findMany({where:{organizationId}}),
    ]);
    const now=Date.now(); const overdue=observations.filter(o=>o.dueDate&&new Date(o.dueDate).getTime()<now&&o.status!=='RESOLVED');
    const open=observations.filter(o=>o.status!=='RESOLVED'); const resolved=observations.filter(o=>o.status==='RESOLVED');
    const companyMap=new Map<string,{name:string;open:number;total:number}>();
    for(const c of companies)companyMap.set(c.id,{name:c.name,open:0,total:0});
    for(const o of observations){if(o.companyId){const x=companyMap.get(o.companyId);if(x){x.total++;if(o.status!=='RESOLVED')x.open++;}}}
    const projectRisk=await Promise.all(projects.map(async p=>{const s=await this.projectScore(p.id,organizationId);return {id:p.id,name:p.name,score:s.score,open:s.open,total:s.total}}));
    return {projects:projects.length,open:open.length,resolved:resolved.length,overdue:overdue.length,projectRisk:projectRisk.sort((a,b)=>a.score-b.score).slice(0,10),companies:[...companyMap.values()].sort((a,b)=>b.open-a.open).slice(0,10)};
  }
}
