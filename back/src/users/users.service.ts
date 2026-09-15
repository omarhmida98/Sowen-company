import {BadRequestException,ForbiddenException,Injectable,NotFoundException} from '@nestjs/common';
import {UserRole} from '@prisma/client';
import * as bcrypt from 'bcryptjs';
import {PrismaService} from '../prisma/prisma.service';
import {CreateUserDto} from './users.dto';
@Injectable()
export class UsersService{
  constructor(private p:PrismaService){}
  list(organizationId:string){return this.p.user.findMany({where:{organizationId},select:{id:true,email:true,displayName:true,role:true,createdAt:true,updatedAt:true},orderBy:{displayName:'asc'}})}
  async create(dto:CreateUserDto,organizationId:string,actorId:string){const email=dto.email.trim().toLowerCase();if(await this.p.user.findUnique({where:{email}}))throw new BadRequestException('Email already used');const passwordHash=await bcrypt.hash(dto.password,12);const user=await this.p.user.create({data:{organizationId,email,displayName:dto.displayName.trim(),passwordHash,role:dto.role},select:{id:true,email:true,displayName:true,role:true,createdAt:true}});await this.p.activityLog.create({data:{userId:actorId,action:`Utilisateur ajouté (${user.email})`,entityType:'User',entityId:user.id}});return user}
  async updateRole(id:string,role:UserRole,organizationId:string,actorId:string){if(id===actorId)throw new BadRequestException('You cannot change your own role');const target=await this.p.user.findUnique({where:{id},select:{organizationId:true,email:true}});if(!target)throw new NotFoundException('User not found');if(target.organizationId!==organizationId)throw new ForbiddenException('User does not belong to your organization');const user=await this.p.user.update({where:{id},data:{role},select:{id:true,email:true,displayName:true,role:true,updatedAt:true}});await this.p.activityLog.create({data:{userId:actorId,action:`Rôle utilisateur modifié (${target.email} → ${role})`,entityType:'User',entityId:id}});return user}
  async remove(id:string,organizationId:string,actorId:string){if(id===actorId)throw new BadRequestException('You cannot delete your own account');const target=await this.p.user.findUnique({where:{id},select:{organizationId:true,email:true}});if(!target)throw new NotFoundException('User not found');if(target.organizationId!==organizationId)throw new ForbiddenException('User does not belong to your organization');await this.p.user.delete({where:{id}});await this.p.activityLog.create({data:{userId:actorId,action:`Utilisateur supprimé (${target.email})`,entityType:'User',entityId:id}});return {deleted:true,id}}
}
