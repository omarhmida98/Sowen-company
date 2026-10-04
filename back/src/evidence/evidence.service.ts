import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {EvidenceReviewStatus} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {StorageService} from '../storage/storage.service';
import {fileResponse} from '../documents/documents.service';
import {checkUpload} from '../common/upload-content';

@Injectable()
export class EvidenceService{
  constructor(private p:PrismaService,private storage:StorageService){}

  list(observationId:string,organizationId:string){
    return this.p.observationEvidence.findMany({
      where:{observationId,observation:{project:{organizationId}}},
      include:{document:true},
      orderBy:{createdAt:'desc'}
    })
  }

  async upload(observationId:string,type:any,note:string|undefined,file:Express.Multer.File,organizationId:string,userId:string){
    const obs=await this.p.observation.findUnique({where:{id:observationId},include:{project:true}});
    if(!obs)throw new NotFoundException('Observation not found');
    if(obs.project.organizationId!==organizationId)throw new ForbiddenException('Observation does not belong to your organization');
    checkUpload(file,'general');
    const storageKey=await this.storage.save({projectId:obs.projectId,folder:'evidence',originalName:file.originalname,buffer:file.buffer,contentType:file.mimetype});
    let ev;
    try{
      const doc=await this.p.document.create({data:{projectId:obs.projectId,type:'EVIDENCE',name:file.originalname,storageKey,mimeType:file.mimetype,sizeBytes:file.size}});
      ev=await this.p.observationEvidence.create({data:{observationId,documentId:doc.id,type,note:note||null,submittedByCompany:false},include:{document:true}});
    }catch(error){await this.storage.remove(storageKey);throw error}
    await this.p.activityLog.create({data:{projectId:obs.projectId,userId,action:'Preuve ajoutée',entityType:'ObservationEvidence',entityId:ev.id}});
    return ev
  }

  // The evidence must belong to the caller's organization; anything else is "not found".
  async download(id:string,organizationId:string){
    const evidence=await this.p.observationEvidence.findFirst({where:{id,observation:{project:{organizationId}}},select:{document:{select:{name:true,mimeType:true,storageKey:true}}}});
    if(!evidence?.document)throw new NotFoundException('Fichier introuvable');
    return fileResponse(await this.storage.read(evidence.document.storageKey),evidence.document.name,evidence.document.mimeType);
  }

  async review(id:string,status:EvidenceReviewStatus,note:string|undefined,organizationId:string,userId:string){
    if(status==='PENDING')throw new BadRequestException('Use APPROVED or REJECTED when reviewing evidence');
    const reason=String(note||'').trim();
    // A refusal is shown to the company: it has to say what is wrong.
    if(status==='REJECTED'&&!reason)throw new BadRequestException('Indiquez le motif du refus : il est transmis à l’entreprise.');
    const evidence=await this.p.observationEvidence.findFirst({
      where:{id,observation:{project:{organizationId}}},
      include:{observation:true,document:true}
    });
    if(!evidence)throw new NotFoundException('Evidence not found');

    const updated=await this.p.observationEvidence.update({
      where:{id},
      data:{reviewStatus:status,reviewNote:reason||null,reviewedAt:new Date(),reviewedById:userId},
      include:{document:true}
    });

    // Every review decision is written in the observation history. A refusal sends the observation back to the
    // company ("À relancer"); an approval never closes it: closing is a separate, explicit action.
    const current=evidence.observation.status;
    const name=evidence.document?.name||'justificatif';
    const next=current==='RESOLVED'?current:status==='REJECTED'?'TO_RELAUNCH':['SENT','TO_RELAUNCH'].includes(current)?'WAITING':current;
    if(next!==current)await this.p.observation.update({where:{id:evidence.observationId},data:{status:next}});
    await this.p.observationHistory.create({
      data:{observationId:evidence.observationId,fromStatus:current,toStatus:next,note:status==='APPROVED'?`Justificatif validé : ${name}`:`Justificatif refusé : ${name} — ${reason}`}
    });

    await this.p.activityLog.create({
      data:{
        projectId:evidence.observation.projectId,
        userId,
        action:status==='APPROVED'?'Preuve validée':'Preuve refusée',
        entityType:'ObservationEvidence',
        entityId:id,
        metadata:{observationId:evidence.observationId,note:reason||null,submittedByCompany:evidence.submittedByCompany}
      }
    });
    return updated;
  }
}
