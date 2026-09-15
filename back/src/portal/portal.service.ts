import {ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {promises as fs} from 'fs';
import path from 'path';
import {PrismaService} from '../prisma/prisma.service';
@Injectable()
export class PortalService{
  constructor(private p:PrismaService){}
  async create(companyId:string,projectId:string,expiresAt:string|undefined,organizationId:string,userId:string){
    const [company,project,link]=await Promise.all([
      this.p.company.findUnique({where:{id:companyId},select:{organizationId:true}}),
      this.p.project.findUnique({where:{id:projectId},select:{organizationId:true}}),
      this.p.projectLot.findFirst({where:{projectId,companyId},select:{id:true}}),
    ]);
    if(!company||!project)throw new NotFoundException('Company or project not found');
    if(company.organizationId!==organizationId||project.organizationId!==organizationId)throw new ForbiddenException('Company/project does not belong to your organization');
    if(!link)throw new ForbiddenException('Company is not assigned to this project');
    const row=await this.p.companyPortalAccess.create({data:{companyId,projectId,expiresAt:expiresAt?new Date(expiresAt):null}});
    await this.p.activityLog.create({data:{projectId,userId,action:'Accès portail entreprise créé',entityType:'CompanyPortalAccess',entityId:row.id}});
    return row;
  }
  async revoke(id:string,organizationId:string,userId:string){
    const row=await this.p.companyPortalAccess.findUnique({where:{id},include:{project:{select:{organizationId:true}}}});if(!row)throw new NotFoundException('Portal access not found');if(row.project.organizationId!==organizationId)throw new ForbiddenException('Portal access does not belong to your organization');
    const updated=await this.p.companyPortalAccess.update({where:{id},data:{revokedAt:new Date()}});await this.p.activityLog.create({data:{projectId:row.projectId,userId,action:'Accès portail entreprise révoqué',entityType:'CompanyPortalAccess',entityId:id}});return updated;
  }
  private async access(token:string){const access=await this.p.companyPortalAccess.findUnique({where:{token},include:{company:true,project:true}});if(!access||access.revokedAt||(access.expiresAt&&access.expiresAt<new Date()))throw new NotFoundException('Portal link invalid or expired');return access}
  async get(token:string){const access=await this.access(token);const observations=await this.p.observation.findMany({where:{projectId:access.projectId,companyId:access.companyId},include:{lot:true,evidence:{include:{document:true}}},orderBy:{createdAt:'desc'}});return{access:{id:access.id,project:{id:access.project.id,name:access.project.name},company:{id:access.company.id,name:access.company.name},expiresAt:access.expiresAt},observations}}
  async addResponse(token:string,observationId:string,note:string){
    const access=await this.access(token);
    const obs=await this.p.observation.findFirst({where:{id:observationId,projectId:access.projectId,companyId:access.companyId}});if(!obs)throw new ForbiddenException('Observation is not available for this company portal');
    const ev=await this.p.observationEvidence.create({data:{observationId,type:'OTHER',note,submittedByCompany:true}});
    if(obs.status!=='RESOLVED'&&obs.status!=='WAITING'){await this.p.observation.update({where:{id:obs.id},data:{status:'WAITING'}});await this.p.observationHistory.create({data:{observationId:obs.id,fromStatus:obs.status,toStatus:'WAITING',note:'Réponse reçue via portail entreprise'}})}
    await this.p.activityLog.create({data:{projectId:obs.projectId,action:`Réponse entreprise reçue (${access.company.name})`,entityType:'ObservationEvidence',entityId:ev.id,metadata:{note}}});
    return ev;
  }

  async uploadEvidence(token:string,observationId:string,type:any,note:string|undefined,file:Express.Multer.File){
    const access=await this.access(token);
    const obs=await this.p.observation.findFirst({where:{id:observationId,projectId:access.projectId,companyId:access.companyId}});if(!obs)throw new ForbiddenException('Observation is not available for this company portal');
    const dir=path.resolve(process.cwd(),'uploads',obs.projectId,'evidence');await fs.mkdir(dir,{recursive:true});const safe=`${Date.now()}-${file.originalname.replace(/[^a-zA-Z0-9._-]/g,'_')}`;const full=path.join(dir,safe);await fs.writeFile(full,file.buffer);
    const doc=await this.p.document.create({data:{projectId:obs.projectId,type:'EVIDENCE',name:file.originalname,storageKey:full,mimeType:file.mimetype,sizeBytes:file.size}});const ev=await this.p.observationEvidence.create({data:{observationId,documentId:doc.id,type,note:note||null,submittedByCompany:true},include:{document:true}});
    if(obs.status!=='RESOLVED'&&obs.status!=='WAITING'){await this.p.observation.update({where:{id:obs.id},data:{status:'WAITING'}});await this.p.observationHistory.create({data:{observationId:obs.id,fromStatus:obs.status,toStatus:'WAITING',note:'Justificatif reçu via portail entreprise'}});}
    await this.p.activityLog.create({data:{projectId:obs.projectId,action:`Preuve ajoutée via portail (${access.company.name})`,entityType:'ObservationEvidence',entityId:ev.id}});return ev;
  }
}
