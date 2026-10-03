import {BadRequestException,ForbiddenException,Injectable,Logger,NotFoundException,OnModuleInit} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {EvidenceType} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {StorageService} from '../storage/storage.service';
import {MailerService} from '../mailer/mailer.service';
import {fileResponse} from '../documents/documents.service';
import {linkBase} from '../auth/account-links';
import {accessState,companyStatus,portalSecret,portalToken,portalTtlDays,verifyPortalToken} from './portal-tokens';

const INVALID='Ce lien est invalide, expiré ou révoqué.';
const NOT_IN_SCOPE='Cette observation n’est pas accessible depuis ce portail.';
const ACTIVE=()=>({revokedAt:null,OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]});
// An observation reaches the company portal only once it has really been sent to that company, and never when
// the AI finding was rejected internally.
const VISIBLE={generatedEmails:{some:{sentAt:{not:null},status:{not:'ERROR' as const}}},OR:[{reviewStatus:null},{reviewStatus:{not:'REJECTED' as const}}]};

@Injectable()
export class PortalService implements OnModuleInit{
  private readonly logger=new Logger(PortalService.name);
  constructor(private p:PrismaService,private storage:StorageService,private config:ConfigService,private mailer:MailerService){}

  // The key that signs portal links, or null when none may be used (see portalSecret). Never logged.
  private secret():string|null{
    return portalSecret({PORTAL_TOKEN_SECRET:this.config.get('PORTAL_TOKEN_SECRET'),JWT_ACCESS_SECRET:this.config.get('JWT_ACCESS_SECRET'),NODE_ENV:this.config.get('NODE_ENV'),PUBLIC_APP_URL:this.config.get('PUBLIC_APP_URL')})?.secret??null;
  }

  onModuleInit(){
    const key=portalSecret({PORTAL_TOKEN_SECRET:this.config.get('PORTAL_TOKEN_SECRET'),JWT_ACCESS_SECRET:this.config.get('JWT_ACCESS_SECRET'),NODE_ENV:this.config.get('NODE_ENV'),PUBLIC_APP_URL:this.config.get('PUBLIC_APP_URL')});
    if(key?.source==='development-fallback')this.logger.warn('PORTAL_TOKEN_SECRET is not set: company portal links use a development key derived from the JWT secret. Set PORTAL_TOKEN_SECRET before going to production.');
  }

  // Address of the portal. `public` is false when only the local development address is known: such a link is
  // shown to the team but never put in an email.
  linkFor(accessId:string):{url:string;public:boolean}|null{
    const base=linkBase({publicAppUrl:this.mailer.publicAppUrl(),webUrl:this.config.get<string>('WEB_URL'),nodeEnv:this.config.get<string>('NODE_ENV')});
    const secret=this.secret();
    return base&&secret?{url:`${base.base}/portal/${portalToken(accessId,secret)}`,public:base.public}:null;
  }

  private async scope(companyId:string,projectId:string,organizationId:string){
    const [company,project]=await Promise.all([
      this.p.company.findUnique({where:{id:companyId},select:{id:true,name:true,organizationId:true}}),
      this.p.project.findUnique({where:{id:projectId},select:{id:true,name:true,organizationId:true}}),
    ]);
    if(!company||!project)throw new NotFoundException('Company or project not found');
    if(company.organizationId!==organizationId||project.organizationId!==organizationId)throw new ForbiddenException('Company/project does not belong to your organization');
    // The company must take part in the project: it holds a lot, or an observation of the project is addressed to it.
    const [lot,observation]=await Promise.all([this.p.projectLot.findFirst({where:{projectId,companyId},select:{id:true}}),this.p.observation.findFirst({where:{projectId,companyId},select:{id:true}})]);
    if(!lot&&!observation)throw new ForbiddenException('Company is not assigned to this project');
    return {company,project};
  }

  private view(a:{id:string;companyId:string;projectId:string;createdAt:Date;expiresAt:Date|null;revokedAt:Date|null;createdById?:string|null;company?:{id:string;name:string}},names:Record<string,string>={}){
    const state=accessState(a);
    return {id:a.id,companyId:a.companyId,projectId:a.projectId,company:a.company?{id:a.company.id,name:a.company.name}:undefined,createdAt:a.createdAt,expiresAt:a.expiresAt,revokedAt:a.revokedAt,createdBy:a.createdById?names[a.createdById]||null:null,state,
      // only an active access has a link, and it is only ever returned to administrators and editors
      link:state==='ACTIVE'?this.linkFor(a.id)?.url??null:null};
  }

  // Accesses of a project (optionally of one company), most recent first: the active one and the history.
  async list(projectId:string,companyId:string|undefined,organizationId:string){
    const project=await this.p.project.findFirst({where:{id:projectId,organizationId},select:{id:true}});
    if(!project)throw new NotFoundException('Project not found');
    const rows=await this.p.companyPortalAccess.findMany({where:{projectId,...(companyId?{companyId}:{})},include:{company:{select:{id:true,name:true}}},orderBy:{createdAt:'desc'},take:200});
    const ids=[...new Set(rows.map(r=>r.createdById).filter((v):v is string=>!!v))];
    const names:Record<string,string>={};
    for(const u of ids.length?await this.p.user.findMany({where:{id:{in:ids}},select:{id:true,displayName:true,email:true}}):[])names[u.id]=u.displayName||u.email;
    return rows.map(r=>this.view(r,names));
  }

  private async issue(companyId:string,projectId:string,expiresAt:Date|null|undefined,userId:string|null){
    const days=portalTtlDays(this.config.get('PORTAL_ACCESS_TTL_DAYS'));
    const expiry=expiresAt!==undefined?expiresAt:days>0?new Date(Date.now()+days*86400000):null;
    return this.p.companyPortalAccess.create({data:{companyId,projectId,expiresAt:expiry,createdById:userId}});
  }

  // One active access per company and project: creating one when another is active replaces it.
  async create(companyId:string,projectId:string,expiresAt:string|undefined,organizationId:string,userId:string){
    const {company}=await this.scope(companyId,projectId,organizationId);
    const expiry=expiresAt?new Date(expiresAt):undefined;
    if(expiry&&(Number.isNaN(expiry.getTime())||expiry<=new Date()))throw new BadRequestException('La date d’expiration doit être dans le futur.');
    const replaced=await this.p.companyPortalAccess.updateMany({where:{companyId,projectId,...ACTIVE()},data:{revokedAt:new Date(),revokedById:userId}});
    const row=await this.issue(companyId,projectId,expiry,userId);
    await this.p.activityLog.create({data:{projectId,userId,action:replaced.count?`Accès portail entreprise régénéré (${company.name})`:`Accès portail entreprise créé (${company.name})`,entityType:'CompanyPortalAccess',entityId:row.id,metadata:{companyId,expiresAt:row.expiresAt,replaced:replaced.count}}});
    return this.view({...row,company});
  }

  private async owned(id:string,organizationId:string){
    const row=await this.p.companyPortalAccess.findUnique({where:{id},include:{project:{select:{organizationId:true}},company:{select:{id:true,name:true}}}});
    if(!row)throw new NotFoundException('Portal access not found');
    if(row.project.organizationId!==organizationId)throw new ForbiddenException('Portal access does not belong to your organization');
    return row;
  }

  // The previous link stops working at once; the company needs the new one.
  async regenerate(id:string,organizationId:string,userId:string){
    const row=await this.owned(id,organizationId);
    await this.p.companyPortalAccess.updateMany({where:{companyId:row.companyId,projectId:row.projectId,revokedAt:null},data:{revokedAt:new Date(),revokedById:userId}});
    const created=await this.issue(row.companyId,row.projectId,undefined,userId);
    await this.p.activityLog.create({data:{projectId:row.projectId,userId,action:`Accès portail entreprise régénéré (${row.company.name})`,entityType:'CompanyPortalAccess',entityId:created.id,metadata:{companyId:row.companyId,previousId:id,expiresAt:created.expiresAt}}});
    return this.view({...created,company:row.company});
  }

  async revoke(id:string,organizationId:string,userId:string){
    const row=await this.owned(id,organizationId);
    const updated=row.revokedAt?row:await this.p.companyPortalAccess.update({where:{id},data:{revokedAt:new Date(),revokedById:userId}});
    if(!row.revokedAt)await this.p.activityLog.create({data:{projectId:row.projectId,userId,action:`Accès portail entreprise révoqué (${row.company.name})`,entityType:'CompanyPortalAccess',entityId:id,metadata:{companyId:row.companyId}}});
    return this.view({...updated,company:row.company});
  }

  // Used when an observation is sent to a company: the email needs a portal to point to. Returns the active access
  // of that company on that project, creating it when there is none and `create` is set.
  async activeAccess(projectId:string,companyId:string,options:{create?:boolean;userId?:string|null}={}){
    const existing=await this.p.companyPortalAccess.findFirst({where:{projectId,companyId,...ACTIVE()},orderBy:{createdAt:'desc'}});
    if(existing||!options.create)return existing;
    const created=await this.issue(companyId,projectId,undefined,options.userId??null);
    await this.p.activityLog.create({data:{projectId,userId:options.userId??null,action:'Accès portail entreprise créé (envoi d’une observation)',entityType:'CompanyPortalAccess',entityId:created.id,metadata:{companyId,expiresAt:created.expiresAt}}});
    return created;
  }

  // The portal link of an email to a company. `cta` is the button ("Répondre dans SOWEN") and is only set when the
  // link is on the public address of the application; otherwise the email carries no link and `link` is given to
  // the team to pass on.
  async emailLink(projectId:string,companyId:string|null|undefined,options:{create?:boolean;userId?:string|null}={}):Promise<{cta:{label:string;url:string}|null;link:string|null}>{
    if(!companyId)return {cta:null,link:null};
    const access=await this.activeAccess(projectId,companyId,options);
    const link=access?this.linkFor(access.id):null;
    return {cta:link?.public?{label:'Répondre dans SOWEN',url:link.url}:null,link:link?.url??null};
  }

  // ---------- what the company can do, with nothing but its link ----------

  // Every public route goes through here. Unknown, badly signed, revoked and expired links get the same answer.
  private async access(token:string){
    const secret=this.secret();
    const id=secret?verifyPortalToken(token,secret):null;
    const access=id?await this.p.companyPortalAccess.findUnique({where:{id},include:{company:{select:{id:true,name:true}},project:{select:{id:true,name:true,address:true,organization:{select:{name:true}}}}}}):null;
    if(!access||accessState(access)!=='ACTIVE')throw new NotFoundException(INVALID);
    return access;
  }

  // The observation id comes from the company: it is only accepted inside the scope of the link.
  private async scoped(access:{projectId:string;companyId:string},observationId:string){
    const obs=typeof observationId==='string'?await this.p.observation.findFirst({where:{id:observationId,projectId:access.projectId,companyId:access.companyId,...VISIBLE}}):null;
    if(!obs)throw new ForbiddenException(NOT_IN_SCOPE);
    return obs;
  }

  // Only what the company needs: no internal status, assignee, history, internal evidence, storage key or other company.
  private evidenceView(e:{id:string;type:string;note:string|null;createdAt:Date;reviewStatus:string;reviewNote:string|null;reviewedAt:Date|null;document:{name:string;mimeType:string|null;sizeBytes:number|null}|null}){
    return {id:e.id,type:e.type,note:e.note,createdAt:e.createdAt,reviewStatus:e.reviewStatus,reviewNote:e.reviewStatus==='REJECTED'?e.reviewNote:null,reviewedAt:e.reviewedAt,fileName:e.document?.name??null,mimeType:e.document?.mimeType??null,sizeBytes:e.document?.sizeBytes??null};
  }

  async get(token:string){
    const access=await this.access(token);
    const observations=await this.p.observation.findMany({
      where:{projectId:access.projectId,companyId:access.companyId,...VISIBLE},
      select:{id:true,title:true,description:true,requiredAction:true,severity:true,reference:true,dueDate:true,status:true,closedAt:true,createdAt:true,lot:{select:{name:true}},
        responses:{where:{source:'PORTAL'},select:{id:true,message:true,createdAt:true},orderBy:{createdAt:'asc'}},
        evidence:{where:{submittedByCompany:true,documentId:{not:null}},select:{id:true,type:true,note:true,createdAt:true,reviewStatus:true,reviewNote:true,reviewedAt:true,document:{select:{name:true,mimeType:true,sizeBytes:true}}},orderBy:{createdAt:'desc'}}},
      orderBy:{createdAt:'desc'}});
    return {
      access:{organization:access.project.organization.name,project:{name:access.project.name,address:access.project.address},company:{name:access.company.name},expiresAt:access.expiresAt},
      observations:observations.map(o=>({id:o.id,title:o.title,description:o.description,requiredAction:o.requiredAction,severity:o.severity,reference:o.reference,lot:o.lot?.name??null,dueDate:o.dueDate,status:companyStatus(o.status),closedAt:o.status==='RESOLVED'?o.closedAt:null,responses:o.responses,evidence:o.evidence.map(e=>this.evidenceView(e))})),
    };
  }

  // A response or a proof from the company puts the observation in "En attente": it is now the project team's turn.
  private async engaged(obs:{id:string;status:string;projectId:string},note:string){
    const next=['SENT','TO_RELAUNCH','OPEN','TO_SEND'].includes(obs.status)?'WAITING':obs.status;
    if(next!==obs.status)await this.p.observation.update({where:{id:obs.id},data:{status:'WAITING'}});
    await this.p.observationHistory.create({data:{observationId:obs.id,fromStatus:obs.status as any,toStatus:next as any,note}});
  }

  async addResponse(token:string,observationId:string,message:string){
    const access=await this.access(token);
    const obs=await this.scoped(access,observationId);
    if(obs.status==='RESOLVED')throw new BadRequestException('Cette observation est clôturée : elle n’accepte plus de réponse.');
    const text=String(message||'').trim();
    if(!text)throw new BadRequestException('Le message est obligatoire.');
    if(text.length>4000)throw new BadRequestException('Le message est trop long (4000 caractères au maximum).');
    const response=await this.p.observationResponse.create({data:{observationId:obs.id,source:'PORTAL',message:text,companyId:access.companyId,portalAccessId:access.id},select:{id:true,message:true,createdAt:true}});
    await this.engaged(obs,`Réponse de l’entreprise reçue via le portail (${access.company.name})`);
    await this.p.activityLog.create({data:{projectId:obs.projectId,action:`Réponse entreprise reçue via le portail (${access.company.name})`,entityType:'Observation',entityId:obs.id,metadata:{responseId:response.id,companyId:access.companyId}}});
    return response;
  }

  async uploadEvidence(token:string,observationId:string,type:string,note:string|undefined,file:Express.Multer.File){
    const access=await this.access(token);
    const obs=await this.scoped(access,observationId);
    if(obs.status==='RESOLVED')throw new BadRequestException('Cette observation est clôturée : elle n’accepte plus de justificatif.');
    if(!Object.values(EvidenceType).includes(type as EvidenceType))throw new BadRequestException('Type de justificatif invalide.');
    const storageKey=await this.storage.save({projectId:obs.projectId,folder:'evidence',originalName:file.originalname,buffer:file.buffer,contentType:file.mimetype});
    let ev;
    try{
      const doc=await this.p.document.create({data:{projectId:obs.projectId,type:'EVIDENCE',name:file.originalname,storageKey,mimeType:file.mimetype,sizeBytes:file.size}});
      ev=await this.p.observationEvidence.create({data:{observationId:obs.id,documentId:doc.id,type:type as EvidenceType,note:String(note||'').trim().slice(0,500)||null,submittedByCompany:true},select:{id:true,type:true,note:true,createdAt:true,reviewStatus:true,reviewNote:true,reviewedAt:true,document:{select:{name:true,mimeType:true,sizeBytes:true}}}});
    }catch(error){await this.storage.remove(storageKey);throw error}
    await this.engaged(obs,`Justificatif reçu via le portail (${access.company.name}) : ${file.originalname}`);
    await this.p.activityLog.create({data:{projectId:obs.projectId,action:`Justificatif reçu via le portail (${access.company.name})`,entityType:'ObservationEvidence',entityId:ev.id,metadata:{observationId:obs.id,companyId:access.companyId}}});
    return this.evidenceView(ev);
  }

  // A company downloads only a file it sent itself, on an observation inside the scope of its link.
  async downloadEvidence(token:string,evidenceId:string){
    const access=await this.access(token);
    const evidence=await this.p.observationEvidence.findFirst({where:{id:evidenceId,submittedByCompany:true,observation:{projectId:access.projectId,companyId:access.companyId,...VISIBLE}},select:{document:{select:{name:true,mimeType:true,storageKey:true}}}});
    if(!evidence?.document)throw new NotFoundException('Fichier introuvable');
    return fileResponse(await this.storage.read(evidence.document.storageKey),evidence.document.name,evidence.document.mimeType);
  }
}
