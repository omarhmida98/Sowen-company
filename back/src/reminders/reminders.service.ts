import {Injectable,Logger} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Cron,CronExpression} from '@nestjs/schedule';
import {Resend} from 'resend';
import {PrismaService} from '../prisma/prisma.service';

@Injectable()
export class RemindersService{
  private readonly logger=new Logger(RemindersService.name);
  constructor(private p:PrismaService,private config:ConfigService){}

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
    const [overdue,dueSoon,staleWaiting,needsRecipient,escalated]=await Promise.all([
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{lt:now}},include:{project:true,company:true,lot:true},orderBy:{dueDate:'asc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},dueDate:{gte:now,lte:dueSoonEnd}},include:{project:true,company:true,lot:true},orderBy:{dueDate:'asc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:'WAITING',updatedAt:{lt:staleThreshold}},include:{project:true,company:true,lot:true},orderBy:{updatedAt:'asc'},take:25}),
      this.p.generatedEmail.findMany({where:{project:{organizationId},OR:[{status:'NEEDS_RECIPIENT'},{recipientEmail:null}]},include:{project:true,observation:true},orderBy:{createdAt:'desc'},take:25}),
      this.p.observation.findMany({where:{project:{organizationId},status:{not:'RESOLVED'},escalationLevel:{gt:0}},include:{project:true,company:true,lot:true},orderBy:[{escalationLevel:'desc'},{dueDate:'asc'}],take:25}),
    ]);
    return{
      settings:org,
      summary:{overdue:overdue.length,dueSoon:dueSoon.length,staleWaiting:staleWaiting.length,needsRecipient:needsRecipient.length,escalated:escalated.length,total:overdue.length+dueSoon.length+staleWaiting.length+needsRecipient.length},
      overdue,dueSoon,staleWaiting,needsRecipient,escalated,
      generatedAt:now,
    };
  }

  async scan(organizationId:string,userId?:string){
    const now=new Date();
    const org=await this.p.organization.findUnique({where:{id:organizationId},select:{reminderDays:true,escalationDays:true}});
    const reminderDays=Math.max(1,org?.reminderDays||7);
    const escalationDays=Math.max(1,org?.escalationDays||7);
    const threshold=new Date(now.getTime()-reminderDays*86400000);
    const obs=await this.p.observation.findMany({
      where:{project:{organizationId},status:{not:'RESOLVED'},OR:[{dueDate:{lt:now}},{status:'WAITING',updatedAt:{lt:threshold}}]},
      include:{generatedEmails:true,project:true,company:true}
    });
    let marked=0,sent=0,escalated=0;
    const key=this.config.get<string>('RESEND_API_KEY'),from=this.config.get<string>('RESEND_FROM');
    const resend=key?new Resend(key):null;
    for(const o of obs){
      const overdueDays=o.dueDate?Math.max(0,Math.floor((now.getTime()-o.dueDate.getTime())/86400000)):0;
      const desiredEscalation=o.dueDate&&o.dueDate<now?Math.min(3,Math.floor(overdueDays/escalationDays)+1):0;
      if(o.status!=='TO_RELAUNCH'){
        await this.p.observation.update({where:{id:o.id},data:{status:'TO_RELAUNCH'}});
        await this.p.observationHistory.create({data:{observationId:o.id,fromStatus:o.status,toStatus:'TO_RELAUNCH',note:o.dueDate&&o.dueDate<now?'Échéance dépassée - relance requise':`Aucun retour depuis ${reminderDays} jours`}});
        await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:'Observation marquée à relancer',entityType:'Observation',entityId:o.id}});
        marked++;
      }
      if(desiredEscalation>o.escalationLevel){
        await this.p.observation.update({where:{id:o.id},data:{escalationLevel:desiredEscalation,lastEscalatedAt:now}});
        await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:`Escalade niveau ${desiredEscalation}`,entityType:'Observation',entityId:o.id,metadata:{overdueDays,company:o.company?.name||null}}});
        escalated++;
      }
      if(resend&&from){
        for(const email of o.generatedEmails.filter(e=>e.recipientEmail&&e.status!=='RESOLVED')){
          const cooldown=!email.lastRemindedAt||now.getTime()-email.lastRemindedAt.getTime()>24*3600*1000;
          if(!cooldown)continue;
          const level=Math.max(desiredEscalation,o.escalationLevel);
          const prefix=level>=2?'URGENT - ':level===1?'Relance - ':'';
          await resend.emails.send({from,to:email.recipientEmail!,subject:`${prefix}${email.subject}`,html:`Bonjour,<br/><br/>Une action est toujours attendue pour le point suivant :<br/><br/>${email.body.replace(/\n/g,'<br/>')}${level?`<br/><br/><strong>Niveau d'escalade : ${level}</strong>`:''}`});
          await this.p.generatedEmail.update({where:{id:email.id},data:{lastRemindedAt:now,reminderCount:{increment:1}}});
          await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:level?'Relance escaladée envoyée':'Relance automatique envoyée',entityType:'GeneratedEmail',entityId:email.id,metadata:{level}}});
          sent++;
        }
      }
    }
    return{checked:obs.length,markedForReminder:marked,escalated,emailsSent:sent,emailConfigured:!!(key&&from),runAt:now};
  }

  async scanAll(){
    const orgs=await this.p.organization.findMany({select:{id:true,name:true}});
    const results=[] as Array<any>;
    for(const org of orgs){const r=await this.scan(org.id);results.push({organizationId:org.id,organizationName:org.name,...r})}
    return {organizations:results.length,results};
  }
}
