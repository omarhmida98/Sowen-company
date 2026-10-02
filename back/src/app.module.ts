import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './config.validation';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './prisma/prisma.module';
import { MailerModule } from './mailer/mailer.module';
import { HealthModule } from './health/health.module';
import { AuthModule } from './auth/auth.module';
import { ProjectsModule } from './projects/projects.module';
import { RulesModule } from './rules/rules.module';
import { ObservationsModule } from './observations/observations.module';
import { ReportsModule } from './reports/reports.module';
import { EmailsModule } from './emails/emails.module';
import { DocumentsModule } from './documents/documents.module';
import { CompaniesModule } from './companies/companies.module';
import { LotsModule } from './lots/lots.module';
import { ProjectLotsModule } from './project-lots/project-lots.module';
import { ComplianceModule } from './compliance/compliance.module';
import { ActivityModule } from './activity/activity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { SystemModule } from './system/system.module';
import { ExportsModule } from './exports/exports.module';
import { TemplatesModule } from './templates/templates.module';
import { RemindersModule } from './reminders/reminders.module';
import { PortalModule } from './portal/portal.module';
import { EvidenceModule } from './evidence/evidence.module';
import { SearchModule } from './search/search.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { UsersModule } from './users/users.module';
import { AiModule } from './ai/ai.module';
import { NotificationsModule } from './notifications/notifications.module';
import { AuthGuard } from './auth/guards/auth.guard';
import { RolesGuard } from './auth/guards/roles.guard';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    ScheduleModule.forRoot(),
    PrismaModule,
    MailerModule,
    AiModule,
    NotificationsModule,
    HealthModule,
    AuthModule,
    ProjectsModule,
    RulesModule,
    ObservationsModule,
    ReportsModule,
    EmailsModule,
    DocumentsModule,
    CompaniesModule,
    LotsModule,
    ProjectLotsModule,
    ComplianceModule,
    ActivityModule,
    OrganizationsModule,
    SystemModule,
    UsersModule,
    AnalyticsModule,
    SearchModule,
    EvidenceModule,
    PortalModule,
    RemindersModule,
    TemplatesModule,
    ExportsModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
