# Migration from existing Supabase to SOWEN V2 PostgreSQL

## Why keep the old Supabase project for now?

The current project already contains useful business data and logic, including tables around projects, lots, operational rules, regulation rules/regulations, remarks, generated emails, documents and profiles, plus SQL functions for generation and email resolution.

The new architecture does not depend on Supabase, but the old project is the best source for preserving that work.

## Migration sequence

1. Freeze destructive changes in old Supabase.
2. Export the public schema and useful table data.
3. Review duplicates between `operational_rules`, `regulation_rules` and `regulations`.
4. Map old rows into the new `Rule`, `RuleSource` and `RuleVersion` structure.
5. Map projects and project lots.
6. Map old remarks into observations/compliance checks depending on their meaning.
7. Map generated email history where useful.
8. Validate row counts and a sample of records.
9. Only after validation, retire Supabase from production.

## Suggested field mapping

### Old project data

- `projects` -> `Project`
- `lots` -> `Lot`
- `project_lots` -> `ProjectLot`
- old company/email fields on `project_lots` -> create/reuse `Company`, then attach to `ProjectLot`

### Old regulatory data

- `operational_rules` -> mainly `Rule`
- `regulation_rules` / `regulations` -> `Rule` + `RuleSource`
- original regulation reference -> `RuleSource.reference`
- old `summary` -> `Rule.summary`
- old `action_request` -> `Rule.actionRequest`
- old `building_type`, `erp_type`, `domain`, `lot_id` -> equivalent structured fields

Do not automatically merge rows solely because their titles are similar. Regulatory content needs manual review before deduplication.

### Old generated remarks

- preventive/anticipated findings -> `ComplianceCheck` where directly tied to a rule
- real control-office findings -> `Observation`

### Old generated emails

- `generated_mails` -> `GeneratedEmail`
- status/timestamps -> equivalent email status fields

## Authentication

Do not migrate Supabase password hashes. Create accounts in the new auth system and require users to set/reset a new password.

## Storage

The visible Supabase Storage workspace was empty at the time of planning, so document storage can start directly on R2/S3 without migrating buckets, unless files are added before migration.
