import {Injectable,Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Cron,CronExpression} from '@nestjs/schedule';
import {MailerService} from '../mailer/mailer.service';
import {PrismaService} from '../prisma/prisma.service';
import {reminderReason,sentReminderDays,wasSent} from './reminder-rules';

@Injectable()
export class RemindersService{
  private readonly logger=new Logger(RemindersService.name);
  constructor(private p:PrismaService,private config:ConfigService,private mailer:MailerService){}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledScan(){
    const enabled=(this.config.get<string>('REMINDER_AUTOMATION_ENABLED')||'false').toLowerCase()==='true';
    if(!enabled)return;
    try{const result=await this.scanAll();this.logger.log(`Automatic reminder scan: ${result.organizations} organization(s)`)}
    catch(error:any){this.logger.error(`Automatic reminder scan failed: ${error?.message||error}`)}
  }

  async alerts(organizationId:string){
    const now=new Date();
    const org=await this.p.organization.findUniqueOrThrow({where:{id:organizationId},select:{reminderDays:true,dueSoonDays:true,escalationDays:true}});
    const dueSoonEnd=new Date(now.getTime()+Math.max(1,org.dueSoonDays)*86400000);
    const staleThreshold=new Date(now.getTime()-Math.max(1,org.reminderDays)*86400000);
    const sentDays=this.sentReminderDays();
    const staleSent=sentDays>0
      ?(await this.p.observation.findMany({where:{project:{organizationId},status:'SENT',generatedEmails:{some:{sentAt:{lt:new Date(now.getTime()-sentDays*86400000)}}}},include:{project:true,company:true,lot:true,generatedEmails:true},orderBy:{updatedAt:'asc'},take:50}))
        .filter(o=>reminderReason(o,now,{reminderDays:Math.max(1,org.reminderDays),sentReminderDays:sentDays})==='STALE_SENT').slice(0,25).map(({generatedEmails,...o})=>o)
      :[];
    const [overdue,dueSoon,staleWaiting,needsRecipient,escalated]=await Promise.all([
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{lt:now}},include:{project:true,company:true,lot:true},orderBy:{dueDate:'asc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{gte:now,lte:dueSoonEnd}},include:{project:true,company:true,lot:true},orderBy:{dueDate:'asc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:'WAITING',updatedAt:{lt:staleThreshold}},include:{project:true,company:true,lot:true},orderBy:{updatedAt:'asc'},take:25}),
      this.p.generatedEmail.findMany({where:{project:{organizationId},OR:[{status:'NEEDS_RECIPIENT'},{recipientEmail:null}]},include:{project:true,observation:true},orderBy:{createdAt:'desc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},escalationLevel:{gt:0}},include:{project:true,company:true,lot:true},orderBy:[{escalationLevel:'desc'},{dueDate:'asc'}],take:25}),
    ]);
    return{
      settings:{...org,sentReminderAfterDays:sentDays},
      summary:{overdue:overdue.length,dueSoon:dueSoon.length,staleWaiting:staleWaiting.length,staleSent:staleSent.length,needsRecipient:needsRecipient.length,escalated:escalated.length,total:overdue.length+dueSoon.length+staleWaiting.length+staleSent.length+needsRecipient.length},
      overdue,dueSoon,staleWaiting,staleSent,needsRecipient,escalated,
      generatedAt:now,
    };
  }

  async scan(organizationId:string,userId?:string){
    const now=new Date();
    const org=await this.p.organization.findUnique({where:{id:organizationId},select:{reminderDays:true,escalationDays:true}});
    const reminderDays=Math.max(1,org?.reminderDays||7);
    const escalationDays=Math.max(1,org?.escalationDays||7);
    const threshold=new Date(now.getTime()-reminderDays*86400000);
    const sentDays=this.sentReminderDays();
    const sentThreshold=new Date(now.getTime()-sentDays*86400000);
    const candidates=await this.p.observation.findMany({
      where:{project:{organizationId},status:{not:'RESOLVED'},OR:[{dueDate:{lt:now}},{status:'WAITING',updatedAt:{lt:threshold}},...(sentDays>0?[{status:'SENT' as const,generatedEmails:{some:{sentAt:{lt:sentThreshold}}}}]:[])]},
      include:{generatedEmails:true,project:true,company:true}
    });
    // The query is a superset; reminderReason() is the single place that decides.
    const obs=candidates.map(o=>({o,reason:reminderReason(o,now,{reminderDays,sentReminderDays:sentDays})})).filter(x=>x.reason);
    let marked=0,sent=0,escalated=0;
    const canSend=this.mailer.isConfigured();
    for(const {o,reason} of obs){
      const overdueDays=o.dueDate?Math.max(0,Math.floor((now.getTime()-o.dueDate.getTime())/86400000)):0;
      const desiredEscalation=o.dueDate&&o.dueDate<now?Math.min(3,Math.floor(overdueDays/escalationDays)+1):0;
      if(o.status!=='TO_RELAUNCH'){
        await this.p.observation.update({where:{id:o.id},data:{status:'TO_RELAUNCH'}});
        await this.p.observationHistory.create({data:{observationId:o.id,fromStatus:o.status,toStatus:'TO_RELAUNCH',note:reason==='OVERDUE'?'Échéance dépassée - relance requise':reason==='STALE_SENT'?`Aucune réponse de l’entreprise ${sentDays} jour(s) après l’envoi`:`Aucun retour depuis ${reminderDays} jours`}});
        await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:'Observation marquée à relancer',entityType:'Observation',entityId:o.id}});
        marked++;
      }
      if(desiredEscalation>o.escalationLevel){
        await this.p.observation.update({where:{id:o.id},data:{escalationLevel:desiredEscalation,lastEscalatedAt:now}});
        await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:`Escalade niveau ${desiredEscalation}`,entityType:'Observation',entityId:o.id,metadata:{overdueDays,company:o.company?.name||null}}});
        escalated++;
      }
      if(canSend){
        // A sent observation with no response is followed up on the email that was actually sent, most recent only.
        const toRemind=reason==='STALE_SENT'
          ?o.generatedEmails.filter(e=>e.recipientEmail&&e.status!=='RESOLVED'&&wasSent(e)).sort((a,b)=>b.sentAt!.getTime()-a.sentAt!.getTime()).slice(0,1)
          :o.generatedEmails.filter(e=>e.recipientEmail&&e.status!=='RESOLVED');
        for(const email of toRemind){
          const cooldown=!email.lastRemindedAt||now.getTime()-email.lastRemindedAt.getTime()>24*3600*1000;
          if(!cooldown)continue;
          const level=Math.max(desiredEscalation,o.escalationLevel);
          const prefix=level>=2?'URGENT - ':level===1?'Relance - ':'';
          try{await this.mailer.send({to:email.recipientEmail!,subject:`${prefix}${email.subject}`,html:`Bonjour,<br/><br/>Une action est toujours attendue pour le point suivant :<br/><br/>${email.body.replace(/\n/g,'<br/>')}${level?`<br/><br/><strong>Niveau d'escalade : ${level}</strong>`:''}`})}
          catch(error:any){this.logger.error(`Reminder for email ${email.id} could not be sent: ${error?.message}`);continue}
          await this.p.generatedEmail.update({where:{id:email.id},data:{lastRemindedAt:now,reminderCount:{increment:1}}});
          await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:level?'Relance escaladée envoyée':'Relance automatique envoyée',entityType:'GeneratedEmail',entityId:email.id,metadata:{level}}});
          sent++;
        }
      }
    }
    return{checked:obs.length,markedForReminder:marked,escalated,emailsSent:sent,emailConfigured:canSend,sentReminderAfterDays:sentDays,runAt:now};
  }

  private sentReminderDays(){return sentReminderDays(this.config.get<string>('SENT_REMINDER_AFTER_DAYS'))}

  async scanAll(){
    const orgs=await this.p.organization.findMany({select:{id:true,name:true}});
    const results=[] as Array<any>;
    for(const org of orgs){const r=await this.scan(org.id);results.push({organizationId:org.id,organizationName:org.name,...r})}
    return {organizations:results.length,results};
  }
}
