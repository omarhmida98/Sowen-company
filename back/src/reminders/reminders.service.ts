import {ConflictException,Injectable,Logger,Optional} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {Cron,CronExpression} from '@nestjs/schedule';
import {MailerService} from '../mailer/mailer.service';
import {PrismaService} from '../prisma/prisma.service';
import {REMINDER_COOLDOWN_MS,ReminderSettings,emailDecision,reminderReason,reminderSettings,sendingWindow,sentReminderDays,wasSent} from './reminder-rules';
import {renderObservationEmail} from '../mailer/email-template';
import {PortalService} from '../portal/portal.service';

export type ScanTrigger='manual'|'auto';
export type ScanOptions={trigger?:ScanTrigger;dryRun?:boolean;now?:Date};
type ScanCandidate={observationId:string;title:string;project:string;company:string|null;reason:string;status:string;wouldMarkToRelaunch:boolean;escalationFrom:number;escalationTo:number;emails:{emailId:string;recipient:string|null;subject:string;decision:string;scanRemindersSoFar:number}[]};

const RUN_ENTITY='ReminderRun';
const RUN_RUNNING='Scan des relances en cours';
const RUN_DONE='Scan des relances terminé';
const RUN_STALE_MS=15*60*1000;        // a run still "en cours" after this long is considered crashed
const AUTO_RUN_SPACING_MS=50*60*1000; // at most one automatic run per organization and per hour
const RUN_HISTORY_MS=7*86400000;
const SCAN_REMINDER_ACTIONS=['Relance automatique envoyée','Relance escaladée envoyée'];
const EMPTY_SKIPS=()=>({neverSent:0,noRecipient:0,resolved:0,cooldown:0,maxReached:0,notConfigured:0,failed:0});
const SKIP_KEY:Record<string,keyof ReturnType<typeof EMPTY_SKIPS>>={NEVER_SENT:'neverSent',NO_RECIPIENT:'noRecipient',RESOLVED:'resolved',COOLDOWN:'cooldown',MAX_REACHED:'maxReached',NOT_CONFIGURED:'notConfigured'};

@Injectable()
export class RemindersService{
  private readonly logger=new Logger(RemindersService.name);
  constructor(private p:PrismaService,private config:ConfigService,private mailer:MailerService,@Optional() private portal?:PortalService){}

  @Cron(CronExpression.EVERY_HOUR)
  async scheduledScan(){
    try{
      const result=await this.scanAll();
      if(result.ran)this.logger.log(`Automatic reminder scan: ${result.organizations} organization(s), ${result.results.reduce((n:number,r:any)=>n+(r.emailsSent||0),0)} reminder(s) sent`);
      else if(result.reason!=='disabled')this.logger.log(`Automatic reminder scan skipped: ${result.reason}`);
    }catch(error:any){this.logger.error(`Automatic reminder scan failed: ${error?.message||error}`)}
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

  // What the scan would do, or did, for one organization. With dryRun nothing is written and nothing is sent.
  async scan(organizationId:string,userId?:string,options:ScanOptions={}){
    const trigger:ScanTrigger=options.trigger||'manual';
    const dryRun=Boolean(options.dryRun);
    const now=options.now||new Date();
    const settings=this.settings();
    const window=sendingWindow(now,settings);
    const base={trigger,dryRun,window,maxAutomaticReminders:settings.maxAutomaticReminders,sentReminderAfterDays:this.sentReminderDays(),emailConfigured:this.mailer.isConfigured(),runAt:now};
    const idle={checked:0,markedForReminder:0,escalated:0,emailsSent:0,skipped:EMPTY_SKIPS(),candidates:[] as ScanCandidate[]};
    // A preview is always available, whatever the time; `window` in the result says whether a real automatic run would be allowed now.
    if(dryRun)return{ran:true,reason:null,...(await this.process(organizationId,userId,now,settings,true)),...base};
    // Automatic runs stay inside working hours; a manual scan is a deliberate action and is not restricted.
    if(trigger==='auto'&&!window.allowed)return{ran:false,reason:window.reason as string,...idle,...base};

    const run=await this.acquireRun(organizationId,trigger,userId,now);
    if(!run.id){
      if(trigger==='manual')throw new ConflictException('Un scan des relances est déjà en cours. Réessayez dans un instant.');
      return{ran:false,reason:run.reason as string,...idle,...base};
    }
    try{
      const result=await this.process(organizationId,userId,now,settings,false);
      await this.p.activityLog.update({where:{id:run.id},data:{action:RUN_DONE,metadata:{trigger,checked:result.checked,markedForReminder:result.markedForReminder,escalated:result.escalated,emailsSent:result.emailsSent}}}).catch(()=>{});
      return{ran:true,reason:null,...result,...base};
    }catch(error){
      // A failed run must not block the next one.
      await this.p.activityLog.delete({where:{id:run.id}}).catch(()=>{});
      throw error;
    }
  }

  // One run at a time per organization, across requests and backend instances. The advisory lock makes
  // "check for a run, then record ours" atomic; the record itself is what other runs see.
  private async acquireRun(organizationId:string,trigger:ScanTrigger,userId:string|undefined,now:Date):Promise<{id:string|null;reason:string|null}>{
    return this.p.$transaction(async tx=>{
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sowen-reminder-run:${organizationId}`}))`;
      const inProgress=await tx.activityLog.findFirst({where:{entityType:RUN_ENTITY,entityId:{startsWith:`${organizationId}:`},action:RUN_RUNNING,createdAt:{gt:new Date(now.getTime()-RUN_STALE_MS)}},select:{id:true}});
      if(inProgress)return{id:null,reason:'in-progress'};
      if(trigger==='auto'){
        // The internal scheduler and an external cron both fire hourly: the second one within the hour is dropped.
        const recent=await tx.activityLog.findFirst({where:{entityType:RUN_ENTITY,entityId:`${organizationId}:auto`,action:RUN_DONE,createdAt:{gt:new Date(now.getTime()-AUTO_RUN_SPACING_MS)}},select:{id:true}});
        if(recent)return{id:null,reason:'recent-run'};
      }
      await tx.activityLog.deleteMany({where:{entityType:RUN_ENTITY,entityId:{startsWith:`${organizationId}:`},createdAt:{lt:new Date(now.getTime()-RUN_HISTORY_MS)}}});
      const row=await tx.activityLog.create({data:{userId:userId||null,action:RUN_RUNNING,entityType:RUN_ENTITY,entityId:`${organizationId}:${trigger}`,createdAt:now,metadata:{trigger}},select:{id:true}});
      return{id:row.id,reason:null};
    });
  }

  private async process(organizationId:string,userId:string|undefined,now:Date,settings:ReminderSettings,dryRun:boolean){
    const org=await this.p.organization.findUnique({where:{id:organizationId},select:{reminderDays:true,escalationDays:true}});
    const reminderDays=Math.max(1,org?.reminderDays||7);
    const escalationDays=Math.max(1,org?.escalationDays||7);
    const threshold=new Date(now.getTime()-reminderDays*86400000);
    const sentDays=this.sentReminderDays();
    const sentThreshold=new Date(now.getTime()-sentDays*86400000);
    const found=await this.p.observation.findMany({
      where:{project:{organizationId},status:{not:'RESOLVED'},OR:[{dueDate:{lt:now}},{status:'WAITING',updatedAt:{lt:threshold}},...(sentDays>0?[{status:'SENT' as const,generatedEmails:{some:{sentAt:{lt:sentThreshold}}}}]:[])]},
      include:{generatedEmails:true,project:{include:{organization:{select:{name:true}}}},company:true,evidence:{select:{createdAt:true,submittedByCompany:true,reviewStatus:true,reviewedAt:true}},responses:{select:{createdAt:true}}}
    });
    // The query is a superset; reminderReason() is the single place that decides.
    const obs=found.map(o=>({o,reason:reminderReason(o,now,{reminderDays,sentReminderDays:sentDays})})).filter(x=>x.reason);
    // How many reminders the scan has already sent for each email (manual "Relancer" clicks are not counted).
    const emailIds=obs.flatMap(x=>x.o.generatedEmails.map(e=>e.id));
    const counts=new Map<string,number>();
    if(emailIds.length){
      for(const g of await this.p.activityLog.groupBy({by:['entityId'],where:{entityType:'GeneratedEmail',entityId:{in:emailIds},action:{in:SCAN_REMINDER_ACTIONS}},_count:{_all:true}}))counts.set(g.entityId as string,g._count._all);
    }
    let marked=0,sent=0,escalated=0;
    const skipped=EMPTY_SKIPS();
    const candidates:ScanCandidate[]=[];
    const canSend=this.mailer.isConfigured();
    for(const {o,reason} of obs){
      const overdueDays=o.dueDate?Math.max(0,Math.floor((now.getTime()-o.dueDate.getTime())/86400000)):0;
      const desiredEscalation=o.dueDate&&o.dueDate<now?Math.min(3,Math.floor(overdueDays/escalationDays)+1):0;
      const candidate:ScanCandidate={observationId:o.id,title:o.title,project:o.project.name,company:o.company?.name||null,reason:reason as string,status:o.status,wouldMarkToRelaunch:o.status!=='TO_RELAUNCH',escalationFrom:o.escalationLevel,escalationTo:Math.max(desiredEscalation,o.escalationLevel),emails:[]};
      candidates.push(candidate);
      if(o.status!=='TO_RELAUNCH'){
        if(!dryRun){
          await this.p.observation.update({where:{id:o.id},data:{status:'TO_RELAUNCH'}});
          await this.p.observationHistory.create({data:{observationId:o.id,fromStatus:o.status,toStatus:'TO_RELAUNCH',note:reason==='OVERDUE'?'Échéance dépassée - relance requise':reason==='STALE_SENT'?`Aucune réponse de l’entreprise ${sentDays} jour(s) après l’envoi`:`Aucun retour depuis ${reminderDays} jours`}});
          await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:'Observation marquée à relancer',entityType:'Observation',entityId:o.id}});
        }
        marked++;
      }
      if(desiredEscalation>o.escalationLevel){
        if(!dryRun){
          await this.p.observation.update({where:{id:o.id},data:{escalationLevel:desiredEscalation,lastEscalatedAt:now}});
          await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:`Escalade niveau ${desiredEscalation}`,entityType:'Observation',entityId:o.id,metadata:{overdueDays,company:o.company?.name||null}}});
        }
        escalated++;
      }
      // A sent observation with no response is followed up on the most recent email that was actually sent.
      const latestSent=o.generatedEmails.filter(wasSent).sort((a,b)=>b.sentAt!.getTime()-a.sentAt!.getTime())[0];
      const considered=reason==='STALE_SENT'?o.generatedEmails.filter(e=>e.id===latestSent?.id):o.generatedEmails;
      for(const email of considered){
        const decision=!canSend?'NOT_CONFIGURED':emailDecision(email,now,counts.get(email.id)||0,settings.maxAutomaticReminders);
        const level=Math.max(desiredEscalation,o.escalationLevel);
        // Every reminder is labelled as one; no all-caps wording, which reads as spam.
        const prefix=level>=2?'Relance urgente - ':email.subject.startsWith('Relance')?'':'Relance - ';
        const subject=`${prefix}${email.subject}`;
        candidate.emails.push({emailId:email.id,recipient:email.recipientEmail,subject,decision,scanRemindersSoFar:counts.get(email.id)||0});
        if(decision!=='SEND'){skipped[SKIP_KEY[decision]]++;continue}
        if(dryRun){sent++;continue}
        // Claim the email before sending: the cooldown test and the update are one statement, so two runs cannot both send.
        const claim=await this.p.generatedEmail.updateMany({where:{id:email.id,OR:[{lastRemindedAt:null},{lastRemindedAt:{lt:new Date(now.getTime()-REMINDER_COOLDOWN_MS)}}]},data:{lastRemindedAt:now,reminderCount:{increment:1}}});
        if(!claim.count){skipped.cooldown++;candidate.emails[candidate.emails.length-1].decision='COOLDOWN';continue}
        try{await this.mailer.send({to:email.recipientEmail!,subject,automated:true,...renderObservationEmail({subject,body:email.body,projectName:o.project.name,observationTitle:o.title,reference:o.reference,organizationName:o.project.organization?.name,cta:(await this.portal?.emailLink(o.projectId,o.companyId))?.cta??null,reminder:{level}})})}
        catch(error:any){
          this.logger.error(`Reminder for email ${email.id} could not be sent: ${error?.message}`);
          // Nothing went out: give the claim back so the next run can retry.
          await this.p.generatedEmail.update({where:{id:email.id},data:{lastRemindedAt:email.lastRemindedAt??null,reminderCount:{decrement:1}}}).catch(()=>{});
          skipped.failed++;candidate.emails[candidate.emails.length-1].decision='FAILED';continue;
        }
        await this.p.activityLog.create({data:{projectId:o.projectId,userId:userId||null,action:level?'Relance escaladée envoyée':'Relance automatique envoyée',entityType:'GeneratedEmail',entityId:email.id,metadata:{level}}});
        sent++;
      }
    }
    return{checked:obs.length,markedForReminder:marked,escalated,emailsSent:sent,skipped,candidates};
  }

  settings(){return reminderSettings(key=>this.config.get<string>(key))}
  private sentReminderDays(){return sentReminderDays(this.config.get<string>('SENT_REMINDER_AFTER_DAYS'))}
  automationEnabled(){return (this.config.get<string>('REMINDER_AUTOMATION_ENABLED')||'false').toLowerCase()==='true'}

  // Automatic entry point, shared by the internal scheduler and the external cron endpoint.
  async scanAll(options:{dryRun?:boolean;now?:Date}={}){
    const now=options.now||new Date();
    const dryRun=Boolean(options.dryRun);
    // A preview is always allowed; real automatic sending needs the feature switched on.
    if(!dryRun&&!this.automationEnabled())return{ran:false,reason:'disabled',organizations:0,results:[] as any[]};
    const window=sendingWindow(now,this.settings());
    if(!dryRun&&!window.allowed)return{ran:false,reason:window.reason,window,organizations:0,results:[] as any[]};
    const orgs=await this.p.organization.findMany({select:{id:true,name:true}});
    const results=[] as Array<any>;
    for(const org of orgs){const r=await this.scan(org.id,undefined,{trigger:'auto',dryRun,now});results.push({organizationId:org.id,organizationName:org.name,...r})}
    return{ran:true,reason:null,window,organizations:results.length,results};
  }
}
