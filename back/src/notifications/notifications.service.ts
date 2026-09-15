import {Injectable,Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Cron} from '@nestjs/schedule';
import {Resend} from 'resend';
import {PrismaService} from '../prisma/prisma.service';

@Injectable()
export class NotificationsService{
  private readonly logger=new Logger(NotificationsService.name);
  constructor(private p:PrismaService,private config:ConfigService){}

  private async upsertForUsers(organizationId:string,dedupeBase:string,data:{kind:any;priority:any;title:string;message:string;href?:string}){
    const users=await this.p.user.findMany({where:{organizationId},select:{id:true}});
    for(const u of users){
      const dedupeKey=`${u.id}:${dedupeBase}`;
      await this.p.notification.upsert({where:{dedupeKey},create:{organizationId,userId:u.id,dedupeKey,...data},update:{...data}});
    }
  }

  async sync(organizationId:string){
    const now=new Date();
    const org=await this.p.organization.findUniqueOrThrow({where:{id:organizationId},select:{dueSoonDays:true}});
    const dueSoonEnd=new Date(now.getTime()+Math.max(1,org.dueSoonDays)*86400000);
    const [overdue,dueSoon,escalated,needsRecipient,pendingEvidence]=await Promise.all([
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{lt:now}},include:{project:true,company:true},take:100}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{gte:now,lte:dueSoonEnd}},include:{project:true,company:true},take:100}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},escalationLevel:{gt:0}},include:{project:true,company:true},take:100}),
      this.p.generatedEmail.findMany({where:{project:{organizationId},OR:[{status:'NEEDS_RECIPIENT'},{recipientEmail:null}]},include:{project:true,observation:true},take:100}),
      this.p.observationEvidence.findMany({where:{observation:{project:{organizationId}},reviewStatus:'PENDING'},include:{observation:{include:{project:true,company:true}},document:true},take:100}),
    ]);
    for(const o of overdue)await this.upsertForUsers(organizationId,`overdue:${o.id}:${o.dueDate?.toISOString()}`,{kind:'OVERDUE',priority:o.severity==='CRITICAL'?'CRITICAL':'HIGH',title:`Échéance dépassée · ${o.project.name}`,message:`${o.title}${o.company?.name?` · ${o.company.name}`:''}`,href:`/observations/${o.id}`});
    for(const o of dueSoon)await this.upsertForUsers(organizationId,`due-soon:${o.id}:${o.dueDate?.toISOString()}`,{kind:'DUE_SOON',priority:o.severity==='CRITICAL'?'HIGH':'MEDIUM',title:`Échéance proche · ${o.project.name}`,message:o.title,href:`/observations/${o.id}`});
    for(const o of escalated)await this.upsertForUsers(organizationId,`escalation:${o.id}:${o.escalationLevel}`,{kind:'ESCALATION',priority:o.escalationLevel>=3?'CRITICAL':'HIGH',title:`Escalade niveau ${o.escalationLevel}`,message:`${o.project.name} · ${o.title}`,href:`/observations/${o.id}`});
    for(const e of needsRecipient)await this.upsertForUsers(organizationId,`recipient:${e.id}`,{kind:'EMAIL',priority:'MEDIUM',title:'Destinataire manquant',message:`${e.project.name} · ${e.subject}`,href:'/mails'});
    for(const ev of pendingEvidence)await this.upsertForUsers(organizationId,`evidence:${ev.id}`,{kind:'EVIDENCE',priority:'MEDIUM',title:'Justificatif à valider',message:`${ev.observation.project.name} · ${ev.observation.title}${ev.document?.name?` · ${ev.document.name}`:''}`,href:`/observations/${ev.observationId}`});
    return {overdue:overdue.length,dueSoon:dueSoon.length,escalated:escalated.length,needsRecipient:needsRecipient.length,pendingEvidence:pendingEvidence.length};
  }

  async list(userId:string,organizationId:string,unreadOnly=false){
    await this.sync(organizationId);
    return this.p.notification.findMany({where:{userId,organizationId,...(unreadOnly?{readAt:null}:{})},orderBy:[{readAt:'asc'},{createdAt:'desc'}],take:100});
  }
  async summary(userId:string,organizationId:string){
    await this.sync(organizationId);
    const [unread,critical,latest]=await Promise.all([
      this.p.notification.count({where:{userId,organizationId,readAt:null}}),
      this.p.notification.count({where:{userId,organizationId,readAt:null,priority:'CRITICAL'}}),
      this.p.notification.findMany({where:{userId,organizationId,readAt:null},orderBy:{createdAt:'desc'},take:5}),
    ]);
    return {unread,critical,latest};
  }
  markRead(id:string,userId:string){return this.p.notification.updateMany({where:{id,userId},data:{readAt:new Date()}})}
  markAllRead(userId:string){return this.p.notification.updateMany({where:{userId,readAt:null},data:{readAt:new Date()}})}

  async sendDigestForOrganization(organizationId:string){
    const key=this.config.get<string>('RESEND_API_KEY'),from=this.config.get<string>('RESEND_FROM');
    if(!key||!from)return {sent:0,configured:false};
    const resend=new Resend(key);
    await this.sync(organizationId);
    const users=await this.p.user.findMany({where:{organizationId,role:{in:['ADMIN','EDITOR']}},select:{id:true,email:true,displayName:true}});
    let sent=0;
    for(const u of users){
      const rows=await this.p.notification.findMany({where:{userId:u.id,readAt:null},orderBy:{createdAt:'desc'},take:20});
      if(!rows.length)continue;
      const items=rows.map(n=>`<li><strong>${n.title}</strong><br/>${n.message}</li>`).join('');
      await resend.emails.send({from,to:u.email,subject:`SOWEN · ${rows.length} point(s) à traiter`,html:`Bonjour ${u.displayName||''},<br/><br/>Voici votre synthèse SOWEN :<ul>${items}</ul><br/>Connectez-vous à SOWEN pour traiter ces points.`});
      sent++;
    }
    return {sent,configured:true};
  }

  @Cron('0 8 * * *')
  async scheduledDigest(){
    const enabled=(this.config.get<string>('DAILY_DIGEST_ENABLED')||'false').toLowerCase()==='true';
    if(!enabled)return;
    try{const orgs=await this.p.organization.findMany({select:{id:true}});for(const org of orgs)await this.sendDigestForOrganization(org.id);this.logger.log(`Daily digest processed for ${orgs.length} organization(s)`)}catch(e:any){this.logger.error(e?.message||e)}
  }
}
