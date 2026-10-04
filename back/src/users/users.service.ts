import {BadRequestException,ForbiddenException,Injectable,Logger,NotFoundException} from '@nestjs/common';
import {ConfigService} from '@nestjs/config';
import {UserRole} from '@prisma/client';
import {PrismaService} from '../prisma/prisma.service';
import {MailerService,MailSendError} from '../mailer/mailer.service';
import {renderAccountEmail} from '../mailer/email-template';
import {AccountLinkType,accountLink,hashToken,isUsable,linkBase,linkTtlHours,newToken} from '../auth/account-links';
import {InviteUserDto} from './users.dto';

export type Delivery={delivery:'EMAIL_SENT'|'LINK_ONLY';link?:string;reason?:string;expiresAt:Date};

@Injectable()
export class UsersService{
  private readonly logger=new Logger(UsersService.name);
  constructor(private p:PrismaService,private mailer:MailerService,private config:ConfigService){}

  // Never returns the password hash: `status` says whether the account has a password yet.
  async list(organizationId:string){
    const users=await this.p.user.findMany({where:{organizationId},select:{id:true,email:true,displayName:true,role:true,createdAt:true,updatedAt:true,passwordHash:true,tokens:{where:{usedAt:null},orderBy:{createdAt:'desc'},take:1,select:{type:true,expiresAt:true}}},orderBy:{displayName:'asc'}});
    const now=new Date();
    return users.map(({passwordHash,tokens,...u})=>{const link=tokens[0];return {...u,status:passwordHash?'ACTIVE':link?.type==='PASSWORD_RESET'?'RESET_PENDING':'INVITED',linkExpiresAt:passwordHash?null:link?.expiresAt??null,linkExpired:passwordHash?false:!link||link.expiresAt<=now}});
  }

  // People who can be given an observation: accounts that are active.
  async assignable(organizationId:string){return (await this.list(organizationId)).filter(u=>u.status==='ACTIVE').map(({status,linkExpiresAt,linkExpired,...u})=>u)}

  private base(){
    const base=linkBase({publicAppUrl:this.mailer.publicAppUrl(),webUrl:this.config.get<string>('WEB_URL'),nodeEnv:this.config.get<string>('NODE_ENV')});
    if(!base)throw new BadRequestException('L’adresse publique de SOWEN (PUBLIC_APP_URL) doit être configurée pour envoyer une invitation.');
    return base;
  }

  // Creates the single valid link of the user and delivers it: by email when SOWEN has a public address and email
  // is configured, otherwise the link is returned once to the administrator, who passes it on.
  private async issue(user:{id:string;email:string;displayName:string|null},type:AccountLinkType,organizationId:string,actor:{id:string}):Promise<Delivery>{
    const base=this.base();
    const token=newToken();
    const hours=linkTtlHours(type,{INVITATION_TTL_HOURS:this.config.get('INVITATION_TTL_HOURS'),PASSWORD_RESET_TTL_HOURS:this.config.get('PASSWORD_RESET_TTL_HOURS')});
    const expiresAt=new Date(Date.now()+hours*3600000);
    await this.p.userToken.deleteMany({where:{userId:user.id}});
    await this.p.userToken.create({data:{userId:user.id,type,tokenHash:hashToken(token),expiresAt,createdById:actor.id}});
    const link=accountLink(base.base,token);
    if(!base.public)return {delivery:'LINK_ONLY',link,expiresAt,reason:'L’adresse publique de SOWEN n’est pas configurée : aucun email n’a été envoyé.'};
    if(!this.mailer.isConfigured())return {delivery:'LINK_ONLY',link,expiresAt,reason:'L’envoi d’emails n’est pas configuré : aucun email n’a été envoyé.'};
    const [organization,inviter]=await Promise.all([this.p.organization.findUnique({where:{id:organizationId},select:{name:true}}),this.p.user.findUnique({where:{id:actor.id},select:{displayName:true,email:true}})]);
    const subject=type==='INVITATION'?`Invitation à rejoindre ${organization?.name||'votre équipe'} sur SOWEN`:'Réinitialisation de votre mot de passe SOWEN';
    try{
      await this.mailer.send({to:user.email,subject,automated:true,...renderAccountEmail({type,subject,recipientName:user.displayName,organizationName:organization?.name,senderName:inviter?.displayName||inviter?.email,url:link,validHours:hours})});
      return {delivery:'EMAIL_SENT',expiresAt};
    }catch(e:any){
      this.logger.error(`Account email to user ${user.id} could not be sent: ${e?.message||'unknown error'}`);
      return {delivery:'LINK_ONLY',link,expiresAt,reason:`${(e instanceof MailSendError&&e.userMessage)||'L’envoi de l’email a échoué.'} Transmettez le lien vous-même.`};
    }
  }

  private async target(id:string,organizationId:string){
    const target=await this.p.user.findUnique({where:{id},select:{id:true,organizationId:true,email:true,displayName:true,passwordHash:true}});
    if(!target)throw new NotFoundException('User not found');
    if(target.organizationId!==organizationId)throw new ForbiddenException('User does not belong to your organization');
    return target;
  }

  // The administrator gives a name, an email and a role. The account has no password until the person follows the link.
  async invite(dto:InviteUserDto,organizationId:string,actorId:string){
    const email=dto.email.trim().toLowerCase();
    if(await this.p.user.findUnique({where:{email}}))throw new BadRequestException('Cette adresse email est déjà utilisée.');
    this.base();
    const user=await this.p.user.create({data:{organizationId,email,displayName:dto.displayName.trim(),passwordHash:null,role:dto.role},select:{id:true,email:true,displayName:true,role:true,createdAt:true}});
    const delivery=await this.issue(user,'INVITATION',organizationId,{id:actorId});
    await this.p.activityLog.create({data:{userId:actorId,action:`Utilisateur invité (${user.email})`,entityType:'User',entityId:user.id,metadata:{role:user.role,delivery:delivery.delivery}}});
    return {user:{...user,status:'INVITED'},...delivery};
  }

  async resendInvitation(id:string,organizationId:string,actorId:string){
    const target=await this.target(id,organizationId);
    if(target.passwordHash)throw new BadRequestException('Ce compte est déjà actif. Utilisez la réinitialisation du mot de passe.');
    const pending=await this.p.userToken.findFirst({where:{userId:id,usedAt:null},orderBy:{createdAt:'desc'},select:{type:true}});
    const delivery=await this.issue(target,pending?.type==='PASSWORD_RESET'?'PASSWORD_RESET':'INVITATION',organizationId,{id:actorId});
    await this.p.activityLog.create({data:{userId:actorId,action:`Lien d’accès renvoyé (${target.email})`,entityType:'User',entityId:id,metadata:{delivery:delivery.delivery}}});
    return delivery;
  }

  // An administrator resets another user's password: the old password stops working, every session of that user
  // ends, and the user chooses a new password through a time-limited link. Nobody is shown or sets a password for them.
  async resetPassword(id:string,organizationId:string,actorId:string){
    if(id===actorId)throw new BadRequestException('Pour votre propre compte, utilisez « Changer mon mot de passe ».');
    const target=await this.target(id,organizationId);
    await this.p.user.update({where:{id},data:{passwordHash:null,tokenVersion:{increment:1}}});
    await this.p.authSession.updateMany({where:{userId:id,revokedAt:null},data:{revokedAt:new Date(),revokedReason:'password-reset'}});
    const delivery=await this.issue(target,target.passwordHash?'PASSWORD_RESET':'INVITATION',organizationId,{id:actorId});
    await this.p.activityLog.create({data:{userId:actorId,action:`Mot de passe réinitialisé par un administrateur (${target.email})`,entityType:'User',entityId:id,metadata:{delivery:delivery.delivery}}});
    return delivery;
  }

  async updateRole(id:string,role:UserRole,organizationId:string,actorId:string){if(id===actorId)throw new BadRequestException('You cannot change your own role');const target=await this.target(id,organizationId);const user=await this.p.user.update({where:{id},data:{role},select:{id:true,email:true,displayName:true,role:true,updatedAt:true}});await this.p.activityLog.create({data:{userId:actorId,action:`Rôle utilisateur modifié (${target.email} → ${role})`,entityType:'User',entityId:id}});return user}
  async remove(id:string,organizationId:string,actorId:string){if(id===actorId)throw new BadRequestException('You cannot delete your own account');const target=await this.target(id,organizationId);await this.p.user.delete({where:{id}});await this.p.activityLog.create({data:{userId:actorId,action:`Utilisateur supprimé (${target.email})`,entityType:'User',entityId:id}});return {deleted:true,id}}
}
